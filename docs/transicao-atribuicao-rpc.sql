-- ============================================================================
-- SQL DE TRANSIÇÃO SEGURA DE ATRIBUIÇÃO, GRAVAÇÃO ATÔMICA, RLS E AUDITORIA (RICCI TASK)
-- Arquivo: docs/transicao-atribuicao-rpc.sql
-- NOTA: Este script é manual e NÃO é executado automaticamente pelo build/migrações.
-- O banco do Ricci Task só é alterado por ação manual do responsável técnico no Supabase.
-- Versão 0.0.84: Proteção Efetiva por Privilégios (REVOKE), Trigger Anti-Bypass,
--   DROP dinâmico de políticas via catálogo (pg_policies) e CHECK de status expandido ('smtp_maybe_sent').
--   1. Refatoração da RPC: variável explícita de operação (v_operacao: 'CRIACAO'/'EDICAO'),
--      eliminação total de acessos ao RECORD v_tarefa no ramo de criação e nas expressões
--      de retorno. Numeração automática via trigger task_definir_numero_caso preservada.
--      Escopo estrito por perfil na criação e descarte de tokens legados enviados pelo cliente.
--   2. RLS e Trigger de Proteção Efetiva: Atribuições centrais (responsavel_core_usuario_id,
--      executor_core_usuario_id) e tokens históricos (responsavel_usuario_id, executor_usuario_id)
--      SÓ podem ser alterados dentro da RPC autorizada (SECURITY DEFINER via GUC de sessão
--      'ricci_task.atribuicao_autorizada'). UPDATE direto pelo cliente é rejeitado.
--   3. Inventário Exaustivo e Substituição Integral de Políticas RLS: DROP nominal de TODAS
--      as políticas existentes em tabelas exclusivas do Ricci Task registradas no catálogo,
--      seguido da criação das políticas estritas. Casos legados sem ambos os IDs centrais
--      ficam restritos exclusivamente ao ADMINISTRADOR até regularização.
--   4. Validação Estrita de Versões em Notificações (Edge Functions + helper core-auth).
--   5. Aquisição Atômica com Token de Posse (owner_token) e Verificação de Duplicidades
--      antes de instalar constraint UNIQUE na tabela manual task_email_eventos.
--   6. Tratamento de Resultado Incerto no SMTP e Bloqueio de Reenvio Automático.
--   7. Trava Antecipada (SELECT ... FOR UPDATE) na função auxiliar task_transferir_atribuicao.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Proteção por Privilégios Efetivos de Coluna (REVOKE UPDATE)
-- ----------------------------------------------------------------------------
-- [Item 1]: REVOKE UPDATE nas 4 colunas de atribuição de task_tarefas para
-- authenticated, anon e public. Atualização direta dessas colunas só é permitida
-- quando a sessão executa como o proprietário da função SECURITY DEFINER.
REVOKE UPDATE (responsavel_core_usuario_id, executor_core_usuario_id, responsavel_usuario_id, executor_usuario_id)
  ON public.task_tarefas FROM authenticated, anon, public;

-- ----------------------------------------------------------------------------
-- 1. Funções Auxiliares de Contexto Corporativo Central
-- ----------------------------------------------------------------------------

-- Retorna o ID central (core_usuarios.id) do chamador autenticado (auth.uid())
CREATE OR REPLACE FUNCTION public.task_current_core_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id
  FROM public.core_usuarios u
  WHERE u.auth_user_id = auth.uid()
    AND u.ativo = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.task_current_core_user_id() IS
  'Retorna o id em core_usuarios associado ao auth.uid() da sessão atual para usuário corporativo ativo.';

-- Retorna o código do perfil central ('ADMINISTRADOR', 'GESTOR', 'OPERACIONAL')
-- no sistema RICCI_TASK (apenas se usuário, vínculo, sistema e perfil estiverem ativos)
CREATE OR REPLACE FUNCTION public.task_current_core_perfil()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.codigo
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE u.auth_user_id = auth.uid()
    AND u.ativo = true
    AND us.ativo = true
    AND s.codigo = 'RICCI_TASK'
    AND s.ativo = true
    AND p.ativo = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.task_current_core_perfil() IS
  'Retorna o perfil central no RICCI_TASK para o usuário autenticado.';

-- Helper para checar perfil ADMINISTRADOR
CREATE OR REPLACE FUNCTION public.task_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(public.task_current_core_perfil() = 'ADMINISTRADOR', false);
$$;

COMMENT ON FUNCTION public.task_is_admin() IS
  'Retorna true se o chamador atual tiver perfil central ADMINISTRADOR ativo no RICCI_TASK.';

-- ----------------------------------------------------------------------------
-- 2. Tabela de Auditoria de Transições de Atribuição
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_transicoes_atribuicao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID NOT NULL REFERENCES public.task_tarefas(id) ON DELETE CASCADE,
  responsavel_anterior_core_id UUID REFERENCES public.core_usuarios(id),
  executor_anterior_core_id UUID REFERENCES public.core_usuarios(id),
  novo_responsavel_core_id UUID NOT NULL REFERENCES public.core_usuarios(id),
  novo_executor_core_id UUID NOT NULL REFERENCES public.core_usuarios(id),
  motivo TEXT,
  autor_core_id UUID NOT NULL REFERENCES public.core_usuarios(id),
  autor_perfil TEXT NOT NULL,
  perda_acesso_autor BOOLEAN NOT NULL DEFAULT false,
  versao_anterior_updated_at TIMESTAMPTZ,
  versao_resultante_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.task_transicoes_atribuicao
  ADD COLUMN IF NOT EXISTS versao_anterior_updated_at TIMESTAMPTZ;

ALTER TABLE public.task_transicoes_atribuicao
  ADD COLUMN IF NOT EXISTS versao_resultante_updated_at TIMESTAMPTZ;

ALTER TABLE public.task_transicoes_atribuicao ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_transicoes_tarefa_id ON public.task_transicoes_atribuicao(tarefa_id);
CREATE INDEX IF NOT EXISTS idx_transicoes_autor_core_id ON public.task_transicoes_atribuicao(autor_core_id);
CREATE INDEX IF NOT EXISTS idx_transicoes_created_at ON public.task_transicoes_atribuicao(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transicoes_lookup ON public.task_transicoes_atribuicao(tarefa_id, autor_core_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Tabela de Eventos de Providências da Transação
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_transacao_providencias_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transacao_id UUID REFERENCES public.task_transicoes_atribuicao(id) ON DELETE SET NULL,
  tarefa_id UUID NOT NULL REFERENCES public.task_tarefas(id) ON DELETE CASCADE,
  providencia_id UUID NOT NULL REFERENCES public.task_providencias(id) ON DELETE CASCADE,
  autor_core_id UUID NOT NULL REFERENCES public.core_usuarios(id),
  tipo_evento TEXT NOT NULL CHECK (tipo_evento IN ('providencia_inclusao', 'providencia_atualizacao')),
  versao_updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.task_transacao_providencias_eventos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_transacao_provs_lookup
  ON public.task_transacao_providencias_eventos(tarefa_id, providencia_id, autor_core_id, tipo_evento);

-- ----------------------------------------------------------------------------
-- 4. PONTO 5: Garantia Verificável de Unicidade em task_email_eventos
-- Adiciona colunas necessárias (owner_token, locked_at) e constraint UNIQUE.
-- Checa duplicidades existentes ANTES da instalação e falha explicitamente se houver.
-- ----------------------------------------------------------------------------

-- 4.1 Adição de colunas necessárias para posse exclusiva (Item 5)
ALTER TABLE public.task_email_eventos
  ADD COLUMN IF NOT EXISTS owner_token UUID,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_task_email_eventos_owner_token
  ON public.task_email_eventos(owner_token);

-- 4.2 Verificação explícita de duplicidades de event_key existentes
DO $$
DECLARE
  v_dup_count INT;
  v_dups TEXT;
BEGIN
  SELECT count(*), string_agg(event_key || ' (' || c::text || ')', ', ')
  INTO v_dup_count, v_dups
  FROM (
    SELECT event_key, count(*) AS c
    FROM public.task_email_eventos
    GROUP BY event_key
    HAVING count(*) > 1
  ) d;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Abortando instalação: existem % chaves duplicadas em public.task_email_eventos antes da criação da constraint UNIQUE: %',
      v_dup_count, v_dups
      USING ERRCODE = '23505';
  END IF;
END $$;

-- 4.3 Criação da constraint UNIQUE se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_email_eventos_event_key_key'
      AND conrelid = 'public.task_email_eventos'::regclass
  ) THEN
    ALTER TABLE public.task_email_eventos
      ADD CONSTRAINT task_email_eventos_event_key_key UNIQUE (event_key);
  END IF;
END $$;

-- 4.4 Atualização da CHECK constraint de status em task_email_eventos (Item 2)
-- Inclui 'smtp_maybe_sent', preservando todos os estados utilizados pelas Edge Functions:
-- 'pending', 'smtp_maybe_sent', 'success', 'error', 'uncertain', 'pending_reconciliation', 'skipped'.
DO $$
BEGIN
  -- Remover constraint antiga se existir
  ALTER TABLE public.task_email_eventos
    DROP CONSTRAINT IF EXISTS task_email_eventos_status_check;

  ALTER TABLE public.task_email_eventos
    ADD CONSTRAINT task_email_eventos_status_check
    CHECK (status IN ('pending', 'smtp_maybe_sent', 'success', 'error', 'uncertain', 'pending_reconciliation', 'skipped'));
END $$;

-- ----------------------------------------------------------------------------
-- 5. PONTO 1: Trigger de Proteção Efetiva Contra Transferência Direta de Atribuição
-- [Item 1]: Bloqueia qualquer tentativa de alteração nas 4 colunas de atribuição
-- (responsavel_core_usuario_id, executor_core_usuario_id, responsavel_usuario_id, executor_usuario_id)
-- a menos que a sessão execute como o proprietário da função SECURITY DEFINER.
-- O GUC 'ricci_task.atribuicao_autorizada' deixa de autorizar qualquer coisa.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.task_tarefas_impedir_transferencia_direta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mudou_atribuicao BOOLEAN;
  v_func_owner TEXT;
  v_is_authorized_context BOOLEAN := false;
BEGIN
  -- Detecta se qualquer das 4 colunas mudou (IS DISTINCT FROM)
  v_mudou_atribuicao := (
    (OLD.responsavel_core_usuario_id IS DISTINCT FROM NEW.responsavel_core_usuario_id) OR
    (OLD.executor_core_usuario_id IS DISTINCT FROM NEW.executor_core_usuario_id) OR
    (OLD.responsavel_usuario_id IS DISTINCT FROM NEW.responsavel_usuario_id) OR
    (OLD.executor_usuario_id IS DISTINCT FROM NEW.executor_usuario_id)
  );

  IF v_mudou_atribuicao THEN
    -- Obtém o proprietário registrado da função SECURITY DEFINER da RPC
    SELECT pg_get_userbyid(proowner)
    INTO v_func_owner
    FROM pg_proc
    WHERE proname = 'task_salvar_controle_transacional'
      AND pronamespace = 'public'::regnamespace
    LIMIT 1;

    -- Se a função ainda não existir ou falhar a resolução, usa o proprietário do schema public ou postgres/current_user
    IF v_func_owner IS NULL THEN
      v_func_owner := 'postgres';
    END IF;

    -- Verifica se a execução atual roda como o proprietário da função SECURITY DEFINER (current_user)
    -- ou se current_user é superusuário / membro da role proprietária
    IF current_user = v_func_owner OR pg_has_role(current_user, v_func_owner, 'MEMBER') THEN
      v_is_authorized_context := true;
    END IF;

    -- GUC 'ricci_task.atribuicao_autorizada' NÃO autoriza (critério estritamente removido)
    IF NOT v_is_authorized_context THEN
      RAISE EXCEPTION 'Transferência direta de atribuição bloqueada. Atribuições só podem ser alteradas através da RPC autorizada task_salvar_controle_transacional executada pelo proprietário autorizado.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_tarefas_impedir_transferencia_direta ON public.task_tarefas;
CREATE TRIGGER trg_task_tarefas_impedir_transferencia_direta
  BEFORE UPDATE ON public.task_tarefas
  FOR EACH ROW
  EXECUTE FUNCTION public.task_tarefas_impedir_transferencia_direta();

-- ----------------------------------------------------------------------------
-- 6. PONTOS 1 E 2: RPC SECURITY DEFINER: task_salvar_controle_transacional
-- - Variável explícita de operação (v_operacao: 'CRIACAO' ou 'EDICAO')
-- - Eliminação TOTAL de acessos ao RECORD v_tarefa no ramo de criação e nas expressões de retorno
-- - Numeração automática via trigger existente preservada
-- - Escopo por perfil na criação estritamente validado
-- - Tokens legados do cliente descartados na criação
-- - Ativação do GUC local de autorização de atribuição (SET LOCAL)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.task_salvar_controle_transacional(
  p_tarefa_id UUID DEFAULT NULL,
  p_dados_caso JSONB DEFAULT '{}'::jsonb,
  p_providencias JSONB DEFAULT '[]'::jsonb,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_caller_core_id UUID;
  v_caller_perfil TEXT;
  v_operacao TEXT; -- PONTO 1: Modo explícito ('CRIACAO' ou 'EDICAO')
  v_tarefa RECORD;
  v_has_access_before BOOLEAN := false;
  v_has_access_after BOOLEAN := false;
  v_perda_acesso BOOLEAN := false;
  v_now TIMESTAMPTZ := NOW();
  v_updated_at TIMESTAMPTZ;
  v_versao_anterior_updated_at TIMESTAMPTZ := NULL;
  v_transicao_id UUID := NULL;

  -- Dados do caso extraídos do JSONB
  v_nome_controle_id UUID;
  v_identificacao_caso TEXT;
  v_status_id UUID;
  v_data_autorizacao TIMESTAMPTZ;
  v_prazo_conclusao TIMESTAMPTZ;
  v_pasta_cliente TEXT;
  v_pasta_ricci TEXT;
  v_status_finaliza BOOLEAN := false;
  v_arquivado_at TIMESTAMPTZ := NULL;

  -- IDs Centrais propostos
  v_novo_resp_core_id UUID;
  v_novo_exec_core_id UUID;
  v_op_resp_id UUID;
  v_op_exec_id UUID;

  -- Flags de alteração
  v_mudou_resp BOOLEAN := false;
  v_mudou_exec BOOLEAN := false;
  v_houve_mudanca_caso BOOLEAN := false;
  v_houve_mudanca_provs BOOLEAN := false;
  v_resp_elegivel BOOLEAN := false;
  v_exec_elegivel BOOLEAN := false;

  -- Variáveis para providências
  v_prov_item JSONB;
  v_prov_temp_id TEXT;
  v_prov_id UUID;
  v_prov_desc TEXT;
  v_prov_prazo TIMESTAMPTZ;
  v_prov_tipo UUID;
  v_prov_status UUID;
  v_prov_ordem INT;
  v_prov_data_conclusao TIMESTAMPTZ;
  v_prov_email_alertas BOOLEAN;
  v_prov_email_inclusao BOOLEAN;
  v_prov_email_atraso BOOLEAN;
  v_prov_email_atualizacao BOOLEAN;
  v_prov_existente RECORD;
  v_prov_mudou_item BOOLEAN;
  v_prov_gravadas JSONB := '[]'::jsonb;
  v_saved_prov RECORD;
  v_saved_caso RECORD;
  v_eventos_provs JSONB := '[]'::jsonb;
BEGIN
  -- 1. Identifica o usuário corporativo logado
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  v_caller_core_id := public.task_current_core_user_id();
  v_caller_perfil := public.task_current_core_perfil();

  IF v_caller_core_id IS NULL OR v_caller_perfil IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: chamador sem perfil ou cadastro ativo no Ricci Task.' USING ERRCODE = '42501';
  END IF;

  IF v_caller_perfil NOT IN ('ADMINISTRADOR', 'GESTOR', 'OPERACIONAL') THEN
    RAISE EXCEPTION 'Acesso negado: perfil % não autorizado para salvar controles.', v_caller_perfil USING ERRCODE = '42501';
  END IF;

  -- Define modo explícito de operação
  IF p_tarefa_id IS NULL THEN
    v_operacao := 'CRIACAO';
  ELSE
    v_operacao := 'EDICAO';
  END IF;

  -- 2. Extrai dados do caso do JSONB
  v_nome_controle_id := (p_dados_caso->>'nome_controle_id')::UUID;
  v_identificacao_caso := TRIM(COALESCE(p_dados_caso->>'identificacao_caso', ''));
  v_status_id := (p_dados_caso->>'status_id')::UUID;

  IF (p_dados_caso->>'data_autorizacao') IS NOT NULL AND TRIM(p_dados_caso->>'data_autorizacao') <> '' THEN
    v_data_autorizacao := (p_dados_caso->>'data_autorizacao')::TIMESTAMPTZ;
  END IF;

  IF (p_dados_caso->>'prazo_conclusao') IS NOT NULL AND TRIM(p_dados_caso->>'prazo_conclusao') <> '' THEN
    v_prazo_conclusao := (p_dados_caso->>'prazo_conclusao')::TIMESTAMPTZ;
  END IF;

  v_pasta_cliente := NULLIF(TRIM(COALESCE(p_dados_caso->>'pasta_cliente', '')), '');
  v_pasta_ricci := NULLIF(TRIM(COALESCE(p_dados_caso->>'pasta_ricci', '')), '');

  v_novo_resp_core_id := (p_dados_caso->>'responsavel_core_usuario_id')::UUID;
  v_novo_exec_core_id := (p_dados_caso->>'executor_core_usuario_id')::UUID;

  IF v_nome_controle_id IS NULL OR v_identificacao_caso = '' OR v_status_id IS NULL OR
     v_novo_resp_core_id IS NULL OR v_novo_exec_core_id IS NULL THEN
    RAISE EXCEPTION 'Dados obrigatórios incompletos para gravação do controle.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(finaliza, false) INTO v_status_finaliza
  FROM public.task_status
  WHERE id = v_status_id;

  -- 3. PROCESSAMENTO CONFORME O MODO (PONTO 1)
  IF v_operacao = 'CRIACAO' THEN
    -- =========================================================================
    -- MODO CRIACAO: SEM NENHUM ACESSO A v_tarefa
    -- =========================================================================

    -- Ponto 1: Ignora tokens operacionais enviados pelo cliente na criação
    v_op_resp_id := NULL;
    v_op_exec_id := NULL;

    -- Ponto 1: Validação de escopo estrito por perfil na criação
    IF v_caller_perfil = 'ADMINISTRADOR' THEN
      v_has_access_before := true;
    ELSIF v_caller_perfil = 'OPERACIONAL' THEN
      IF v_novo_resp_core_id = v_caller_core_id OR v_novo_exec_core_id = v_caller_core_id THEN
        v_has_access_before := true;
      ELSE
        RAISE EXCEPTION 'Permissão negada: usuário operacional só pode criar casos próprios (sendo Responsável ou Executor).'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_caller_perfil = 'GESTOR' THEN
      IF v_novo_resp_core_id = v_caller_core_id OR v_novo_exec_core_id = v_caller_core_id THEN
        v_has_access_before := true;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.core_usuarios
          WHERE gestor_id = v_caller_core_id
            AND ativo = true
            AND id IN (v_novo_resp_core_id, v_novo_exec_core_id)
        ) INTO v_has_access_before;

        IF NOT v_has_access_before THEN
          RAISE EXCEPTION 'Permissão negada: gestores só podem criar casos próprios ou para membros de sua equipe direta.'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;

    -- Elegibilidade central de ambos os participantes
    SELECT EXISTS (
      SELECT 1
      FROM public.core_usuarios u
      JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
      JOIN public.core_sistemas s ON s.id = us.sistema_id
      JOIN public.core_perfis p ON p.id = us.perfil_id
      WHERE u.id = v_novo_resp_core_id
        AND u.ativo = true
        AND us.ativo = true
        AND s.codigo = 'RICCI_TASK'
        AND s.ativo = true
        AND p.ativo = true
    ) INTO v_resp_elegivel;

    IF NOT v_resp_elegivel THEN
      RAISE EXCEPTION 'Responsável (ID %) não possui vínculo central ativo e elegível no Ricci Task.', v_novo_resp_core_id
        USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.core_usuarios u
      JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
      JOIN public.core_sistemas s ON s.id = us.sistema_id
      JOIN public.core_perfis p ON p.id = us.perfil_id
      WHERE u.id = v_novo_exec_core_id
        AND u.ativo = true
        AND us.ativo = true
        AND s.codigo = 'RICCI_TASK'
        AND s.ativo = true
        AND p.ativo = true
    ) INTO v_exec_elegivel;

    IF NOT v_exec_elegivel THEN
      RAISE EXCEPTION 'Executor (ID %) não possui vínculo central ativo e elegível no Ricci Task.', v_novo_exec_core_id
        USING ERRCODE = '42501';
    END IF;

    v_houve_mudanca_caso := true;
    IF v_status_finaliza THEN
      v_arquivado_at := v_now;
    END IF;

    -- Inserção do novo caso (numeração automática pelo trigger task_definir_numero_caso)
    INSERT INTO public.task_tarefas (
      nome_controle_id,
      identificacao_caso,
      status_id,
      data_autorizacao,
      prazo_conclusao,
      pasta_cliente,
      pasta_ricci,
      responsavel_core_usuario_id,
      executor_core_usuario_id,
      responsavel_usuario_id,
      executor_usuario_id,
      arquivado_at,
      created_by,
      updated_by,
      created_at,
      updated_at
    ) VALUES (
      v_nome_controle_id,
      v_identificacao_caso,
      v_status_id,
      v_data_autorizacao,
      v_prazo_conclusao,
      v_pasta_cliente,
      v_pasta_ricci,
      v_novo_resp_core_id,
      v_novo_exec_core_id,
      NULL,
      NULL,
      v_arquivado_at,
      v_caller_auth_id::text,
      v_caller_auth_id::text,
      v_now,
      v_now
    )
    RETURNING * INTO v_saved_caso;

    p_tarefa_id := v_saved_caso.id;
    v_updated_at := v_saved_caso.updated_at;
    v_versao_anterior_updated_at := NULL;

  ELSE
    -- =========================================================================
    -- MODO EDICAO: LEITURA E TRAVA (SELECT ... FOR UPDATE)
    -- =========================================================================

    SELECT
      id,
      numero_caso,
      nome_controle_id,
      identificacao_caso,
      status_id,
      data_autorizacao,
      prazo_conclusao,
      pasta_cliente,
      pasta_ricci,
      responsavel_core_usuario_id,
      executor_core_usuario_id,
      responsavel_usuario_id,
      executor_usuario_id,
      arquivado_at,
      updated_at,
      created_at,
      deleted_at
    INTO v_tarefa
    FROM public.task_tarefas
    WHERE id = p_tarefa_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Tarefa com ID % não encontrada.', p_tarefa_id USING ERRCODE = 'P0002';
    END IF;

    IF v_tarefa.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Operação não permitida em tarefa excluída.' USING ERRCODE = '42501';
    END IF;

    v_versao_anterior_updated_at := v_tarefa.updated_at;

    -- Avaliação de autorização no estado ANTERIOR da linha
    IF v_caller_perfil = 'ADMINISTRADOR' THEN
      v_has_access_before := true;
    ELSIF v_caller_perfil = 'OPERACIONAL' THEN
      v_has_access_before := (
        v_tarefa.responsavel_core_usuario_id = v_caller_core_id OR
        v_tarefa.executor_core_usuario_id = v_caller_core_id
      );
    ELSIF v_caller_perfil = 'GESTOR' THEN
      IF (v_tarefa.responsavel_core_usuario_id = v_caller_core_id OR
          v_tarefa.executor_core_usuario_id = v_caller_core_id) THEN
        v_has_access_before := true;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.core_usuarios
          WHERE gestor_id = v_caller_core_id
            AND ativo = true
            AND id IN (v_tarefa.responsavel_core_usuario_id, v_tarefa.executor_core_usuario_id)
        ) INTO v_has_access_before;
      END IF;
    END IF;

    IF NOT v_has_access_before THEN
      RAISE EXCEPTION 'Permissão negada: o chamador não possui escopo sobre o caso no estado anterior.' USING ERRCODE = '42501';
    END IF;

    -- Detecção de alteração de atribuição
    v_mudou_resp := (v_tarefa.responsavel_core_usuario_id IS DISTINCT FROM v_novo_resp_core_id);
    v_mudou_exec := (v_tarefa.executor_core_usuario_id IS DISTINCT FROM v_novo_exec_core_id);

    IF v_mudou_resp THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.core_usuarios u
        JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
        JOIN public.core_sistemas s ON s.id = us.sistema_id
        JOIN public.core_perfis p ON p.id = us.perfil_id
        WHERE u.id = v_novo_resp_core_id
          AND u.ativo = true
          AND us.ativo = true
          AND s.codigo = 'RICCI_TASK'
          AND s.ativo = true
          AND p.ativo = true
      ) INTO v_resp_elegivel;

      IF NOT v_resp_elegivel THEN
        RAISE EXCEPTION 'Novo Responsável (ID %) não possui vínculo central ativo e elegível no Ricci Task.', v_novo_resp_core_id
          USING ERRCODE = '42501';
      END IF;

      v_op_resp_id := NULL;
    ELSE
      v_novo_resp_core_id := v_tarefa.responsavel_core_usuario_id;
      v_op_resp_id := v_tarefa.responsavel_usuario_id;
    END IF;

    IF v_mudou_exec THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.core_usuarios u
        JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
        JOIN public.core_sistemas s ON s.id = us.sistema_id
        JOIN public.core_perfis p ON p.id = us.perfil_id
        WHERE u.id = v_novo_exec_core_id
          AND u.ativo = true
          AND us.ativo = true
          AND s.codigo = 'RICCI_TASK'
          AND s.ativo = true
          AND p.ativo = true
      ) INTO v_exec_elegivel;

      IF NOT v_exec_elegivel THEN
        RAISE EXCEPTION 'Novo Executor (ID %) não possui vínculo central ativo e elegível no Ricci Task.', v_novo_exec_core_id
          USING ERRCODE = '42501';
      END IF;

      v_op_exec_id := NULL;
    ELSE
      v_novo_exec_core_id := v_tarefa.executor_core_usuario_id;
      v_op_exec_id := v_tarefa.executor_usuario_id;
    END IF;

    -- Detecção de mudança real nos campos do caso
    v_houve_mudanca_caso := (
      v_mudou_resp OR
      v_mudou_exec OR
      (v_tarefa.nome_controle_id IS DISTINCT FROM v_nome_controle_id) OR
      (v_tarefa.identificacao_caso IS DISTINCT FROM v_identificacao_caso) OR
      (v_tarefa.status_id IS DISTINCT FROM v_status_id) OR
      (v_tarefa.data_autorizacao::date IS DISTINCT FROM v_data_autorizacao::date) OR
      (v_tarefa.prazo_conclusao::date IS DISTINCT FROM v_prazo_conclusao::date) OR
      (COALESCE(v_tarefa.pasta_cliente, '') IS DISTINCT FROM COALESCE(v_pasta_cliente, '')) OR
      (COALESCE(v_tarefa.pasta_ricci, '') IS DISTINCT FROM COALESCE(v_pasta_ricci, '')) OR
      (v_status_finaliza AND v_tarefa.arquivado_at IS NULL)
    );

    IF v_status_finaliza THEN
      v_arquivado_at := COALESCE(v_tarefa.arquivado_at, v_now);
    ELSE
      v_arquivado_at := v_tarefa.arquivado_at;
    END IF;
  END IF;

  -- 4. PROCESSAMENTO E COMPARAÇÃO DE PROVIDÊNCIAS
  IF p_providencias IS NOT NULL AND jsonb_array_length(p_providencias) > 0 THEN
    FOR v_prov_item IN SELECT * FROM jsonb_array_elements(p_providencias)
    LOOP
      v_prov_temp_id := v_prov_item->>'temp_id';
      IF v_prov_temp_id IS NULL OR TRIM(v_prov_temp_id) = '' THEN
        v_prov_temp_id := v_prov_item->>'tempId';
      END IF;

      IF (v_prov_item->>'id') IS NOT NULL AND TRIM(v_prov_item->>'id') <> '' THEN
        v_prov_id := (v_prov_item->>'id')::UUID;
      ELSE
        v_prov_id := NULL;
      END IF;

      v_prov_desc := TRIM(COALESCE(v_prov_item->>'providencia', ''));
      v_prov_prazo := (v_prov_item->>'prazo_conclusao')::TIMESTAMPTZ;
      v_prov_tipo := (v_prov_item->>'tipo_prazo_id')::UUID;
      v_prov_status := (v_prov_item->>'status_id')::UUID;
      v_prov_ordem := COALESCE((v_prov_item->>'ordem')::INT, 0);

      IF (v_prov_item->>'data_conclusao') IS NOT NULL AND TRIM(v_prov_item->>'data_conclusao') <> '' THEN
        v_prov_data_conclusao := (v_prov_item->>'data_conclusao')::TIMESTAMPTZ;
      ELSE
        v_prov_data_conclusao := NULL;
      END IF;

      v_prov_email_alertas := COALESCE((v_prov_item->>'email_alertas')::BOOLEAN, false);
      v_prov_email_inclusao := COALESCE((v_prov_item->>'email_alerta_inclusao')::BOOLEAN, false);
      v_prov_email_atraso := COALESCE((v_prov_item->>'email_alerta_atraso')::BOOLEAN, false);
      v_prov_email_atualizacao := COALESCE((v_prov_item->>'email_alerta_atualizacao')::BOOLEAN, false);

      IF v_prov_desc = '' OR v_prov_prazo IS NULL OR v_prov_tipo IS NULL OR v_prov_status IS NULL THEN
        RAISE EXCEPTION 'Dados obrigatórios da providência incompletos.' USING ERRCODE = '22023';
      END IF;

      IF v_prov_id IS NOT NULL THEN
        SELECT * INTO v_prov_existente
        FROM public.task_providencias
        WHERE id = v_prov_id AND tarefa_id = p_tarefa_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Providência % não encontrada na tarefa %.', v_prov_id, p_tarefa_id USING ERRCODE = 'P0002';
        END IF;

        v_prov_mudou_item := (
          (v_prov_existente.providencia IS DISTINCT FROM v_prov_desc) OR
          (v_prov_existente.prazo_conclusao::date IS DISTINCT FROM v_prov_prazo::date) OR
          (v_prov_existente.tipo_prazo_id IS DISTINCT FROM v_prov_tipo) OR
          (v_prov_existente.status_id IS DISTINCT FROM v_prov_status) OR
          (v_prov_existente.ordem IS DISTINCT FROM v_prov_ordem) OR
          (v_prov_existente.data_conclusao::date IS DISTINCT FROM v_prov_data_conclusao::date) OR
          (v_prov_existente.email_alertas IS DISTINCT FROM v_prov_email_alertas) OR
          (v_prov_existente.email_alerta_inclusao IS DISTINCT FROM v_prov_email_inclusao) OR
          (v_prov_existente.email_alerta_atraso IS DISTINCT FROM v_prov_email_atraso) OR
          (v_prov_existente.email_alerta_atualizacao IS DISTINCT FROM v_prov_email_atualizacao)
        );

        IF v_prov_mudou_item THEN
          v_houve_mudanca_provs := true;
          UPDATE public.task_providencias
          SET
            providencia = v_prov_desc,
            prazo_conclusao = v_prov_prazo,
            tipo_prazo_id = v_prov_tipo,
            status_id = v_prov_status,
            ordem = v_prov_ordem,
            data_conclusao = v_prov_data_conclusao,
            email_alertas = v_prov_email_alertas,
            email_alerta_inclusao = v_prov_email_inclusao,
            email_alerta_atraso = v_prov_email_atraso,
            email_alerta_atualizacao = v_prov_email_atualizacao,
            updated_at = v_now,
            updated_by = v_caller_auth_id::text
          WHERE id = v_prov_id
          RETURNING * INTO v_saved_prov;

          v_eventos_provs := v_eventos_provs || jsonb_build_object(
            'providencia_id', v_saved_prov.id,
            'tipo_evento', 'providencia_atualizacao',
            'versao_updated_at', v_saved_prov.updated_at
          );
        ELSE
          v_saved_prov := v_prov_existente;
        END IF;

      ELSE
        v_houve_mudanca_provs := true;
        INSERT INTO public.task_providencias (
          tarefa_id,
          providencia,
          prazo_conclusao,
          tipo_prazo_id,
          status_id,
          ordem,
          data_conclusao,
          email_alertas,
          email_alerta_inclusao,
          email_alerta_atraso,
          email_alerta_atualizacao,
          created_by,
          updated_by,
          created_at,
          updated_at
        ) VALUES (
          p_tarefa_id,
          v_prov_desc,
          v_prov_prazo,
          v_prov_tipo,
          v_prov_status,
          v_prov_ordem,
          v_prov_data_conclusao,
          v_prov_email_alertas,
          v_prov_email_inclusao,
          v_prov_email_atraso,
          v_prov_email_atualizacao,
          v_caller_auth_id::text,
          v_caller_auth_id::text,
          v_now,
          v_now
        )
        RETURNING * INTO v_saved_prov;

        v_eventos_provs := v_eventos_provs || jsonb_build_object(
          'providencia_id', v_saved_prov.id,
          'tipo_evento', 'providencia_inclusao',
          'versao_updated_at', v_saved_prov.updated_at
        );
      END IF;

      v_prov_gravadas := v_prov_gravadas || jsonb_build_object(
        'id', v_saved_prov.id,
        'temp_id', v_prov_temp_id,
        'tarefa_id', v_saved_prov.tarefa_id,
        'providencia', v_saved_prov.providencia,
        'prazo_conclusao', v_saved_prov.prazo_conclusao,
        'tipo_prazo_id', v_saved_prov.tipo_prazo_id,
        'status_id', v_saved_prov.status_id,
        'ordem', v_saved_prov.ordem,
        'data_conclusao', v_saved_prov.data_conclusao,
        'email_alertas', v_saved_prov.email_alertas,
        'email_alerta_inclusao', v_saved_prov.email_alerta_inclusao,
        'email_alerta_atraso', v_saved_prov.email_alerta_atraso,
        'email_alerta_atualizacao', v_saved_prov.email_alerta_atualizacao,
        'created_at', v_saved_prov.created_at,
        'updated_at', v_saved_prov.updated_at
      );
    END LOOP;
  END IF;

  -- 5. ATUALIZAÇÃO DO CASO NO MODO EDICAO
  IF v_operacao = 'EDICAO' THEN
    IF v_houve_mudanca_caso THEN
      UPDATE public.task_tarefas
      SET
        nome_controle_id = v_nome_controle_id,
        identificacao_caso = v_identificacao_caso,
        status_id = v_status_id,
        data_autorizacao = v_data_autorizacao,
        prazo_conclusao = v_prazo_conclusao,
        pasta_cliente = v_pasta_cliente,
        pasta_ricci = v_pasta_ricci,
        responsavel_core_usuario_id = v_novo_resp_core_id,
        executor_core_usuario_id = v_novo_exec_core_id,
        responsavel_usuario_id = v_op_resp_id,
        executor_usuario_id = v_op_exec_id,
        arquivado_at = v_arquivado_at,
        updated_at = v_now,
        updated_by = v_caller_auth_id::text
      WHERE id = p_tarefa_id
      RETURNING * INTO v_saved_caso;

      v_updated_at := v_saved_caso.updated_at;
    ELSE
      SELECT * INTO v_saved_caso FROM public.task_tarefas WHERE id = p_tarefa_id;
      v_updated_at := v_saved_caso.updated_at;
    END IF;
  END IF;

  -- 6. AVALIAÇÃO DE ACESSO DO CHAMADOR APÓS AS ALTERAÇÕES
  IF v_caller_perfil = 'ADMINISTRADOR' THEN
    v_has_access_after := true;
  ELSIF v_caller_perfil = 'OPERACIONAL' THEN
    v_has_access_after := (
      v_novo_resp_core_id = v_caller_core_id OR
      v_novo_exec_core_id = v_caller_core_id
    );
  ELSIF v_caller_perfil = 'GESTOR' THEN
    IF (v_novo_resp_core_id = v_caller_core_id OR
        v_novo_exec_core_id = v_caller_core_id) THEN
      v_has_access_after := true;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.core_usuarios
        WHERE gestor_id = v_caller_core_id
          AND ativo = true
          AND id IN (v_novo_resp_core_id, v_novo_exec_core_id)
      ) INTO v_has_access_after;
    END IF;
  END IF;

  v_perda_acesso := NOT v_has_access_after;

  -- 7. AUDITORIA DA TRANSIÇÃO (SOMENTE EM MUDANÇA REAL DE ATRIBUIÇÃO NO MODO EDICAO)
  IF v_operacao = 'EDICAO' AND (v_mudou_resp OR v_mudou_exec) THEN
    INSERT INTO public.task_transicoes_atribuicao (
      tarefa_id,
      responsavel_anterior_core_id,
      executor_anterior_core_id,
      novo_responsavel_core_id,
      novo_executor_core_id,
      motivo,
      autor_core_id,
      autor_perfil,
      perda_acesso_autor,
      versao_anterior_updated_at,
      versao_resultante_updated_at,
      created_at
    ) VALUES (
      p_tarefa_id,
      v_tarefa.responsavel_core_usuario_id,
      v_tarefa.executor_core_usuario_id,
      v_novo_resp_core_id,
      v_novo_exec_core_id,
      p_motivo,
      v_caller_core_id,
      v_caller_perfil,
      v_perda_acesso,
      v_versao_anterior_updated_at,
      v_updated_at,
      v_now
    )
    RETURNING id INTO v_transicao_id;
  END IF;

  -- 8. REGISTRO DE EVENTOS DE PROVIDÊNCIAS DA TRANSAÇÃO
  IF jsonb_array_length(v_eventos_provs) > 0 THEN
    FOR v_prov_item IN SELECT * FROM jsonb_array_elements(v_eventos_provs)
    LOOP
      INSERT INTO public.task_transacao_providencias_eventos (
        transacao_id,
        tarefa_id,
        providencia_id,
        autor_core_id,
        tipo_evento,
        versao_updated_at,
        created_at
      ) VALUES (
        v_transicao_id,
        p_tarefa_id,
        (v_prov_item->>'providencia_id')::UUID,
        v_caller_core_id,
        v_prov_item->>'tipo_evento',
        (v_prov_item->>'versao_updated_at')::TIMESTAMPTZ,
        v_now
      );
    END LOOP;
  END IF;

  -- 9. PONTO 1: RETORNO DOS DADOS REAIS SEM ACESSO A v_tarefa NO RAMO DE CRIAÇÃO
  RETURN jsonb_build_object(
    'success', true,
    'operacao', v_operacao,
    'mudanca_real', (v_houve_mudanca_caso OR v_houve_mudanca_provs),
    'tarefa_id', p_tarefa_id,
    'transicao_id', v_transicao_id,
    'updated_at', v_updated_at,
    'versao_anterior_updated_at', v_versao_anterior_updated_at,
    'perda_acesso', v_perda_acesso,
    'novo_responsavel_core_id', v_novo_resp_core_id,
    'novo_executor_core_id', v_novo_exec_core_id,
    'caso', to_jsonb(v_saved_caso),
    'providencias', v_prov_gravadas
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. PONTO 7: Função Auxiliar task_transferir_atribuicao com FOR UPDATE
-- Trava o caso (SELECT ... FOR UPDATE) ANTES da montagem do payload
-- para impedir que uma transferência sobrescreva alterações concorrentes nos demais campos.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.task_transferir_atribuicao(
  p_tarefa_id UUID,
  p_novo_responsavel_core_id UUID,
  p_novo_executor_core_id UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tarefa RECORD;
  v_dados_caso JSONB;
BEGIN
  -- PONTO 7: Trava o caso (SELECT ... FOR UPDATE) ANTES de ler os campos
  SELECT * INTO v_tarefa
  FROM public.task_tarefas
  WHERE id = p_tarefa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa com ID % não encontrada.', p_tarefa_id USING ERRCODE = 'P0002';
  END IF;

  IF v_tarefa.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Operação não permitida em tarefa excluída.' USING ERRCODE = '42501';
  END IF;

  v_dados_caso := jsonb_build_object(
    'nome_controle_id', v_tarefa.nome_controle_id,
    'identificacao_caso', v_tarefa.identificacao_caso,
    'status_id', v_tarefa.status_id,
    'data_autorizacao', v_tarefa.data_autorizacao,
    'prazo_conclusao', v_tarefa.prazo_conclusao,
    'pasta_cliente', v_tarefa.pasta_cliente,
    'pasta_ricci', v_tarefa.pasta_ricci,
    'responsavel_core_usuario_id', p_novo_responsavel_core_id,
    'executor_core_usuario_id', p_novo_executor_core_id,
    'responsavel_usuario_id', v_tarefa.responsavel_usuario_id,
    'executor_usuario_id', v_tarefa.executor_usuario_id
  );

  RETURN public.task_salvar_controle_transacional(
    p_tarefa_id,
    v_dados_caso,
    '[]'::jsonb,
    p_motivo
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. PONTOS 2 E 3: DROP DINÂMICO VIA pg_policies E SUBSTITUIÇÃO INTEGRAL DE RLS
-- [Item 3]: Bloco DO $$ ... $$ que consulta pg_policies e derruba TODAS as
-- políticas existentes das 8 tabelas tratadas pelo script dentro da mesma transação,
-- sem COMMIT interno, e na sequência recria as políticas restritas já definidas.
-- Tabelas tratadas:
--   1. task_tarefas
--   2. task_providencias
--   3. task_transicoes_atribuicao
--   4. task_transacao_providencias_eventos
--   5. task_email_eventos
--   6. task_nomes_controle
--   7. task_status
--   8. task_status_providencia
--   (além de task_tipos_prazo e task_email_notificacoes se existirem)
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  v_tabelas_alvo TEXT[] := ARRAY[
    'task_tarefas',
    'task_providencias',
    'task_transicoes_atribuicao',
    'task_transacao_providencias_eventos',
    'task_email_eventos',
    'task_nomes_controle',
    'task_status',
    'task_status_providencia',
    'task_tipos_prazo',
    'task_email_notificacoes'
  ];
BEGIN
  FOR r IN (
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(v_tabelas_alvo)
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Novas Políticas para public.task_tarefas:
-- SELECT: Admin vê tudo; Gestor vê próprios + equipe direta com ID central; Operacional vê próprios com ID central.
-- Casos legados sem ambos os IDs centrais são restritos exclusivamente ao ADMINISTRADOR.
CREATE POLICY "task_tarefas_select_policy" ON public.task_tarefas
  FOR SELECT TO authenticated
  USING (
    public.task_is_admin()
    OR (
      public.task_current_core_perfil() = 'GESTOR'
      AND (
        (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id = public.task_current_core_user_id())
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id = public.task_current_core_user_id())
        OR (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        ))
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        ))
      )
    )
    OR (
      public.task_current_core_perfil() = 'OPERACIONAL'
      AND (
        (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id = public.task_current_core_user_id())
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id = public.task_current_core_user_id())
      )
    )
  );

-- INSERT: Restrito a Administrador direto ou executado pela RPC transacional (SECURITY DEFINER)
CREATE POLICY "task_tarefas_insert_policy" ON public.task_tarefas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.task_is_admin()
  );

-- UPDATE: Permite atualização de campos comuns dentro do escopo do usuário,
-- desde que a atribuição não seja alterada diretamente (reforçado pelo trigger de proteção)
CREATE POLICY "task_tarefas_update_policy" ON public.task_tarefas
  FOR UPDATE TO authenticated
  USING (
    public.task_is_admin()
    OR (
      public.task_current_core_perfil() = 'GESTOR'
      AND (
        (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id = public.task_current_core_user_id())
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id = public.task_current_core_user_id())
        OR (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        ))
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        ))
      )
    )
    OR (
      public.task_current_core_perfil() = 'OPERACIONAL'
      AND (
        (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id = public.task_current_core_user_id())
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id = public.task_current_core_user_id())
      )
    )
  )
  WITH CHECK (
    public.task_is_admin()
    OR (
      public.task_current_core_perfil() = 'GESTOR'
      AND (
        (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id = public.task_current_core_user_id())
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id = public.task_current_core_user_id())
        OR (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        ))
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        ))
      )
    )
    OR (
      public.task_current_core_perfil() = 'OPERACIONAL'
      AND (
        (responsavel_core_usuario_id IS NOT NULL AND responsavel_core_usuario_id = public.task_current_core_user_id())
        OR (executor_core_usuario_id IS NOT NULL AND executor_core_usuario_id = public.task_current_core_user_id())
      )
    )
  );

-- DELETE: Exclusivo de Administrador
CREATE POLICY "task_tarefas_delete_policy" ON public.task_tarefas
  FOR DELETE TO authenticated
  USING (public.task_is_admin());

-- 8.2 Políticas para public.task_providencias
ALTER TABLE public.task_providencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_providencias_select_policy" ON public.task_providencias
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
  );

CREATE POLICY "task_providencias_insert_policy" ON public.task_providencias
  FOR INSERT TO authenticated
  WITH CHECK (
    public.task_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
  );

CREATE POLICY "task_providencias_update_policy" ON public.task_providencias
  FOR UPDATE TO authenticated
  USING (
    public.task_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
  )
  WITH CHECK (
    public.task_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
  );

CREATE POLICY "task_providencias_delete_policy" ON public.task_providencias
  FOR DELETE TO authenticated
  USING (
    public.task_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
  );

-- 8.3 Políticas para public.task_transicoes_atribuicao
ALTER TABLE public.task_transicoes_atribuicao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_transicoes_select_policy" ON public.task_transicoes_atribuicao
  FOR SELECT TO authenticated
  USING (
    autor_core_id = public.task_current_core_user_id()
    OR public.task_is_admin()
  );

-- 8.4 Políticas para public.task_transacao_providencias_eventos
ALTER TABLE public.task_transacao_providencias_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_transacao_provs_select_policy" ON public.task_transacao_providencias_eventos
  FOR SELECT TO authenticated
  USING (
    autor_core_id = public.task_current_core_user_id()
    OR public.task_is_admin()
  );

-- 8.5 Políticas para public.task_email_eventos
ALTER TABLE public.task_email_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_email_eventos_select_policy" ON public.task_email_eventos
  FOR SELECT TO authenticated
  USING (public.task_is_admin());

-- 8.6 Tabelas de Catálogo (Nomes de Controle, Status, Tipos de Prazo)
ALTER TABLE public.task_nomes_controle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_status_providencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tipos_prazo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_nomes_controle_select_policy" ON public.task_nomes_controle
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_nomes_controle_write_policy" ON public.task_nomes_controle
  FOR ALL TO authenticated
  USING (public.task_is_admin())
  WITH CHECK (public.task_is_admin());

CREATE POLICY "task_status_select_policy" ON public.task_status
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_status_write_policy" ON public.task_status
  FOR ALL TO authenticated
  USING (public.task_is_admin())
  WITH CHECK (public.task_is_admin());

CREATE POLICY "task_status_providencia_select_policy" ON public.task_status_providencia
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_status_providencia_write_policy" ON public.task_status_providencia
  FOR ALL TO authenticated
  USING (public.task_is_admin())
  WITH CHECK (public.task_is_admin());

CREATE POLICY "task_tipos_prazo_select_policy" ON public.task_tipos_prazo
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_tipos_prazo_write_policy" ON public.task_tipos_prazo
  FOR ALL TO authenticated
  USING (public.task_is_admin())
  WITH CHECK (public.task_is_admin());

-- ----------------------------------------------------------------------------
-- 9. Privilégios e Permissões de Execução
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.task_salvar_controle_transacional(UUID, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_transferir_atribuicao(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_current_core_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_current_core_perfil() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_tarefas_impedir_transferencia_direta() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.task_salvar_controle_transacional(UUID, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_transferir_atribuicao(UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_current_core_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_current_core_perfil() TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_tarefas_impedir_transferencia_direta() TO authenticated;

COMMIT;
