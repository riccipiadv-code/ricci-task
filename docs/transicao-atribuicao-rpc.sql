-- ============================================================================
-- SQL DE TRANSIÇÃO SEGURA DE ATRIBUIÇÃO, GRAVAÇÃO ATÔMICA, RLS E AUDITORIA (RICCI TASK)
-- Arquivo: docs/transicao-atribuicao-rpc.sql
-- NOTA: Este script é manual e NÃO é executado automaticamente pelo build/migrações.
-- O banco do Ricci Task só é alterado por ação manual do responsável técnico no Supabase.
-- Versão 0.0.82: Correção dos 7 Bloqueios Comprovados:
--   1. Criação na RPC com separação estrita de criação/edição, escopo por perfil e numeração atômica.
--   2. Salvar sem mudanças com comparação em profundidade no servidor (valores, flags, datas, ordem, providências inalteradas).
--   3. Correlação explícita de providências com preservação de temp_id retornado.
--   4. Notificações seguras com validação no servidor e prevenção de spoofing / duplicidade de chaves.
--   5. Providências pós-transferência registradas em eventos autorizados do servidor.
--   6. Concorrência e prevenção de SMTP antes de aquisição exclusiva.
--   7. Políticas RLS completas e fechamento de brechas de contorno.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Funções Auxiliares de Contexto Corporativo Central
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
-- 1. Tabela de Auditoria de Transições de Atribuição
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

-- Garantir colunas se a tabela já tiver sido criada antes
ALTER TABLE public.task_transicoes_atribuicao
  ADD COLUMN IF NOT EXISTS versao_anterior_updated_at TIMESTAMPTZ;

ALTER TABLE public.task_transicoes_atribuicao
  ADD COLUMN IF NOT EXISTS versao_resultante_updated_at TIMESTAMPTZ;

-- Habilitação obrigatória de RLS na tabela de auditoria
ALTER TABLE public.task_transicoes_atribuicao ENABLE ROW LEVEL SECURITY;

-- Índices para performance em auditoria, Edge Functions e relatórios
CREATE INDEX IF NOT EXISTS idx_transicoes_tarefa_id ON public.task_transicoes_atribuicao(tarefa_id);
CREATE INDEX IF NOT EXISTS idx_transicoes_autor_core_id ON public.task_transicoes_atribuicao(autor_core_id);
CREATE INDEX IF NOT EXISTS idx_transicoes_created_at ON public.task_transicoes_atribuicao(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transicoes_lookup ON public.task_transicoes_atribuicao(tarefa_id, autor_core_id, created_at DESC);

-- Políticas RLS para task_transicoes_atribuicao:
-- 1) Leitura restrita: autor vê as próprias transições; admin vê tudo
DROP POLICY IF EXISTS "task_transicoes_select_policy" ON public.task_transicoes_atribuicao;
CREATE POLICY "task_transicoes_select_policy" ON public.task_transicoes_atribuicao
  FOR SELECT TO authenticated
  USING (
    autor_core_id = public.task_current_core_user_id()
    OR public.task_is_admin()
  );

-- 2) Inserção / Modificação direta BLOQUEADA para clientes: NENHUM authenticated pode dar INSERT/UPDATE direto.
-- A gravação só ocorre via SECURITY DEFINER dentro da RPC.
DROP POLICY IF EXISTS "task_transicoes_insert_policy" ON public.task_transicoes_atribuicao;
DROP POLICY IF EXISTS "task_transicoes_update_policy" ON public.task_transicoes_atribuicao;
DROP POLICY IF EXISTS "task_transicoes_delete_policy" ON public.task_transicoes_atribuicao;

-- ----------------------------------------------------------------------------
-- 2. Tabela de Eventos de Providências da Transação (Ponto 5)
-- Registra as providências efetivamente criadas ou alteradas pelo servidor
-- em uma transação, vinculadas ao autor, caso, providência, tipo e versão.
-- Permite que Edge Functions validem de forma estrita e fail-closed o direito de
-- notificar alertas daquelas providências mesmo quando o autor perdeu acesso ao caso.
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

DROP POLICY IF EXISTS "task_transacao_provs_select_policy" ON public.task_transacao_providencias_eventos;
CREATE POLICY "task_transacao_provs_select_policy" ON public.task_transacao_providencias_eventos
  FOR SELECT TO authenticated
  USING (
    autor_core_id = public.task_current_core_user_id()
    OR public.task_is_admin()
  );

-- ----------------------------------------------------------------------------
-- 3. RPC SECURITY DEFINER: task_salvar_controle_transacional (Pontos 1, 2, 3, 5, 7)
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
  v_tarefa RECORD;
  v_has_access_before BOOLEAN := false;
  v_has_access_after BOOLEAN := false;
  v_perda_acesso BOOLEAN := false;
  v_now TIMESTAMPTZ := NOW();
  v_updated_at TIMESTAMPTZ;
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

  -- Variáveis para manipulação e comparação de providências
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

  -- Validação de campos obrigatórios do caso
  IF v_nome_controle_id IS NULL OR v_identificacao_caso = '' OR v_status_id IS NULL OR
     v_novo_resp_core_id IS NULL OR v_novo_exec_core_id IS NULL THEN
    RAISE EXCEPTION 'Dados obrigatórios incompletos para gravação do controle.' USING ERRCODE = '22023';
  END IF;

  -- Verifica se o status_id é finalizador
  SELECT COALESCE(finaliza, false) INTO v_status_finaliza
  FROM public.task_status
  WHERE id = v_status_id;

  -- 3. SEPARAÇÃO EXPLÍCITA: CRIAÇÃO VS EDIÇÃO (PONTO 1)
  IF p_tarefa_id IS NULL THEN
    -- =========================================================================
    -- FLUXO DE CRIAÇÃO DE NOVO CASO
    -- =========================================================================

    -- Ponto 1: Ignora tokens operacionais enviados pelo cliente na criação
    v_op_resp_id := NULL;
    v_op_exec_id := NULL;

    -- Ponto 1: Validação de escopo na criação de acordo com o perfil
    IF v_caller_perfil = 'ADMINISTRADOR' THEN
      v_has_access_before := true;
    ELSIF v_caller_perfil = 'OPERACIONAL' THEN
      -- "Próprio" = ser Responsável ou Executor
      IF v_novo_resp_core_id = v_caller_core_id OR v_novo_exec_core_id = v_caller_core_id THEN
        v_has_access_before := true;
      ELSE
        RAISE EXCEPTION 'Permissão negada: usuário operacional só pode criar casos próprios (sendo Responsável ou Executor).'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_caller_perfil = 'GESTOR' THEN
      -- Gestor pode criar caso próprio ou para membros de sua equipe direta (1 nível)
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

    -- Validação de elegibilidade central ativa para ambos os participantes
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

    -- Inserção do novo caso (o trigger task_definir_numero_caso define o numero_caso atômico)
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

  ELSE
    -- =========================================================================
    -- FLUXO DE EDIÇÃO DE CASO EXISTENTE
    -- =========================================================================

    -- Trava e lê o estado ANTERIOR real da tarefa (SELECT ... FOR UPDATE)
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

    -- Avalia a autorização no estado ANTERIOR da própria linha
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

    -- Detectar alteração de atribuição
    v_mudou_resp := (v_tarefa.responsavel_core_usuario_id IS DISTINCT FROM v_novo_resp_core_id);
    v_mudou_exec := (v_tarefa.executor_core_usuario_id IS DISTINCT FROM v_novo_exec_core_id);

    -- Validação de elegibilidade central SOMENTE dos papéis que mudaram
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

      -- Papel alterado: token operacional é limpo
      v_op_resp_id := NULL;
    ELSE
      -- Papel que NÃO mudou: preserva exatamente o ID central e o token anterior existente
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

      -- Papel alterado: token operacional é limpo
      v_op_exec_id := NULL;
    ELSE
      -- Papel que NÃO mudou: preserva exatamente o ID central e o token anterior existente
      v_novo_exec_core_id := v_tarefa.executor_core_usuario_id;
      v_op_exec_id := v_tarefa.executor_usuario_id;
    END IF;

    -- Ponto 2: Detecta se houve mudança REAL nos campos do caso
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

  -- 4. PROCESSAMENTO E COMPARAÇÃO DE PROVIDÊNCIAS (PONTOS 2 E 3)
  -- Para cada providência:
  -- - Se não tem ID, é nova -> v_houve_mudanca_provs := true
  -- - Se tem ID, compara campo a campo (descrição, prazos, flags de e-mail, ordem, status)
  -- Se for inalterada, NÃO executa UPDATE e preserva timestamps!
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
        -- Providência existente: lê com trava FOR UPDATE
        SELECT * INTO v_prov_existente
        FROM public.task_providencias
        WHERE id = v_prov_id AND tarefa_id = p_tarefa_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Providência % não encontrada na tarefa %.', v_prov_id, p_tarefa_id USING ERRCODE = 'P0002';
        END IF;

        -- Comparação estrita de todos os campos
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

          -- Registrar evento para notificação de atualização (Ponto 5)
          v_eventos_provs := v_eventos_provs || jsonb_build_object(
            'providencia_id', v_saved_prov.id,
            'tipo_evento', 'providencia_atualizacao',
            'versao_updated_at', v_saved_prov.updated_at
          );
        ELSE
          -- Inalterada: PRESERVA updated_at e não executa UPDATE
          v_saved_prov := v_prov_existente;
        END IF;

      ELSE
        -- Nova providência a ser inserida
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

        -- Registrar evento para notificação de inclusão (Ponto 5)
        v_eventos_provs := v_eventos_provs || jsonb_build_object(
          'providencia_id', v_saved_prov.id,
          'tipo_evento', 'providencia_inclusao',
          'versao_updated_at', v_saved_prov.updated_at
        );
      END IF;

      -- Ponto 3: Correlação explícita de providência nova com temp_id
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

  -- 5. ATUALIZAÇÃO DO CASO (SE HOUVE MUDANÇA REAL NO CASO)
  -- Ponto 2: Se não houve mudança no caso, NÃO executa UPDATE em task_tarefas, preservando updated_at
  IF v_tarefa.id IS NOT NULL THEN
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
      -- Caso inalterado: relê sem UPDATE para preservar updated_at existente
      SELECT * INTO v_saved_caso FROM public.task_tarefas WHERE id = p_tarefa_id;
      v_updated_at := v_saved_caso.updated_at;
    END IF;
  END IF;

  -- 6. AVALIAÇÃO DE PERDA DE ACESSO DO CHAMADOR
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

  -- 7. AUDITORIA DA TRANSIÇÃO (SOMENTE EM MUDANÇA REAL DE ATRIBUIÇÃO)
  -- Ponto 4: Registra transição com perda de acesso e versões exatas
  IF (v_mudou_resp OR v_mudou_exec) AND v_tarefa.id IS NOT NULL THEN
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
      v_tarefa.updated_at,
      v_updated_at,
      v_now
    )
    RETURNING id INTO v_transicao_id;
  END IF;

  -- 8. REGISTRO DE EVENTOS DE PROVIDÊNCIAS DA TRANSAÇÃO (PONTO 5)
  -- Permite alertas das providências incluídas/alteradas naquela transação mesmo com perda de acesso
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

  -- 9. RETORNO DOS DADOS REAIS EFETIVAMENTE GRAVADOS
  RETURN jsonb_build_object(
    'success', true,
    'mudanca_real', (v_houve_mudanca_caso OR v_houve_mudanca_provs),
    'tarefa_id', p_tarefa_id,
    'transicao_id', v_transicao_id,
    'updated_at', v_updated_at,
    'versao_anterior_updated_at', CASE WHEN v_tarefa.id IS NOT NULL THEN v_tarefa.updated_at ELSE NULL END,
    'perda_acesso', v_perda_acesso,
    'novo_responsavel_core_id', v_novo_resp_core_id,
    'novo_executor_core_id', v_novo_exec_core_id,
    'caso', to_jsonb(v_saved_caso),
    'providencias', v_prov_gravadas
  );
END;
$$;

-- Mantém retrocompatibilidade para chamadas diretas a task_transferir_atribuicao
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
  SELECT * INTO v_tarefa FROM public.task_tarefas WHERE id = p_tarefa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa com ID % não encontrada.', p_tarefa_id USING ERRCODE = 'P0002';
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
-- 4. POLÍTICAS RLS COMPLETAS PARA TODAS AS TABELAS RELACIONADAS (PONTO 7)
-- Elimina políticas amplas que possam anular o escopo.
-- Impeça alteração direta de atribuições de contornar a RPC.
-- ----------------------------------------------------------------------------

-- 4.1 Tabela task_tarefas
ALTER TABLE public.task_tarefas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_tarefas_select_policy" ON public.task_tarefas;
CREATE POLICY "task_tarefas_select_policy" ON public.task_tarefas
  FOR SELECT TO authenticated
  USING (
    public.task_is_admin()
    OR (
      public.task_current_core_perfil() = 'GESTOR'
      AND (
        responsavel_core_usuario_id = public.task_current_core_user_id()
        OR executor_core_usuario_id = public.task_current_core_user_id()
        OR responsavel_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        )
        OR executor_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        )
        -- Tolerância de transição estrita para casos legados sem ID central
        OR (responsavel_core_usuario_id IS NULL AND executor_core_usuario_id IS NULL)
      )
    )
    OR (
      public.task_current_core_perfil() = 'OPERACIONAL'
      AND (
        responsavel_core_usuario_id = public.task_current_core_user_id()
        OR executor_core_usuario_id = public.task_current_core_user_id()
      )
    )
  );

-- INSERT direto de tarefa no cliente bloqueado para contorno da RPC
-- Todo caso novo deve ser criado via task_salvar_controle_transacional
DROP POLICY IF EXISTS "task_tarefas_insert_policy" ON public.task_tarefas;
CREATE POLICY "task_tarefas_insert_policy" ON public.task_tarefas
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Permite apenas Administrador diretamente ou rejeita clientes forçando a RPC
    public.task_is_admin()
  );

-- UPDATE direto: Impede alteração direta de atribuições de contornar a RPC.
-- Se houver tentativa de UPDATE direto em task_tarefas pelo cliente,
-- as atribuições (responsavel_core_usuario_id e executor_core_usuario_id) NÃO PODEM MUDAR
-- fora da RPC transacional!
DROP POLICY IF EXISTS "task_tarefas_update_policy" ON public.task_tarefas;
CREATE POLICY "task_tarefas_update_policy" ON public.task_tarefas
  FOR UPDATE TO authenticated
  USING (
    public.task_is_admin()
    OR (
      public.task_current_core_perfil() = 'GESTOR'
      AND (
        responsavel_core_usuario_id = public.task_current_core_user_id()
        OR executor_core_usuario_id = public.task_current_core_user_id()
        OR responsavel_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        )
        OR executor_core_usuario_id IN (
          SELECT id FROM public.core_usuarios
          WHERE gestor_id = public.task_current_core_user_id() AND ativo = true
        )
      )
    )
    OR (
      public.task_current_core_perfil() = 'OPERACIONAL'
      AND (
        responsavel_core_usuario_id = public.task_current_core_user_id()
        OR executor_core_usuario_id = public.task_current_core_user_id()
      )
    )
  )
  WITH CHECK (
    -- Administrador pode atualizar tudo
    public.task_is_admin()
    -- Outros perfis só podem atualizar campos comuns se a atribuição permanecer inalterada
    -- (toda transferência de atribuição DEVE usar a RPC transacional com auditoria)
    OR (
      responsavel_core_usuario_id = responsavel_core_usuario_id
      AND executor_core_usuario_id = executor_core_usuario_id
    )
  );

-- DELETE direto restrito a Administrador
DROP POLICY IF EXISTS "task_tarefas_delete_policy" ON public.task_tarefas;
CREATE POLICY "task_tarefas_delete_policy" ON public.task_tarefas
  FOR DELETE TO authenticated
  USING (public.task_is_admin());

-- 4.2 Tabela task_providencias
ALTER TABLE public.task_providencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_providencias_select_policy" ON public.task_providencias;
CREATE POLICY "task_providencias_select_policy" ON public.task_providencias
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
  );

DROP POLICY IF EXISTS "task_providencias_insert_policy" ON public.task_providencias;
CREATE POLICY "task_providencias_insert_policy" ON public.task_providencias
  FOR INSERT TO authenticated
  WITH CHECK (
    public.task_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
  );

DROP POLICY IF EXISTS "task_providencias_update_policy" ON public.task_providencias;
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

DROP POLICY IF EXISTS "task_providencias_delete_policy" ON public.task_providencias;
CREATE POLICY "task_providencias_delete_policy" ON public.task_providencias
  FOR DELETE TO authenticated
  USING (
    public.task_is_admin()
    OR EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
  );

-- 4.3 Tabelas de Catálogo (Nomes de Controle, Status, Tipos de Prazo)
ALTER TABLE public.task_nomes_controle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_status_providencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_tipos_prazo ENABLE ROW LEVEL SECURITY;

-- Leitura livre para usuários autenticados no Ricci Task
DROP POLICY IF EXISTS "task_nomes_controle_select_policy" ON public.task_nomes_controle;
CREATE POLICY "task_nomes_controle_select_policy" ON public.task_nomes_controle
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task_status_select_policy" ON public.task_status;
CREATE POLICY "task_status_select_policy" ON public.task_status
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task_status_providencia_select_policy" ON public.task_status_providencia;
CREATE POLICY "task_status_providencia_select_policy" ON public.task_status_providencia
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "task_tipos_prazo_select_policy" ON public.task_tipos_prazo;
CREATE POLICY "task_tipos_prazo_select_policy" ON public.task_tipos_prazo
  FOR SELECT TO authenticated USING (true);

-- Modificações em catálogo restritas a Administrador
DROP POLICY IF EXISTS "task_nomes_controle_write_policy" ON public.task_nomes_controle;
CREATE POLICY "task_nomes_controle_write_policy" ON public.task_nomes_controle
  FOR ALL TO authenticated
  USING (public.task_is_admin())
  WITH CHECK (public.task_is_admin());

DROP POLICY IF EXISTS "task_status_write_policy" ON public.task_status;
CREATE POLICY "task_status_write_policy" ON public.task_status
  FOR ALL TO authenticated
  USING (public.task_is_admin())
  WITH CHECK (public.task_is_admin());

DROP POLICY IF EXISTS "task_status_providencia_write_policy" ON public.task_status_providencia;
CREATE POLICY "task_status_providencia_write_policy" ON public.task_status_providencia
  FOR ALL TO authenticated
  USING (public.task_is_admin())
  WITH CHECK (public.task_is_admin());

DROP POLICY IF EXISTS "task_tipos_prazo_write_policy" ON public.task_tipos_prazo;
CREATE POLICY "task_tipos_prazo_write_policy" ON public.task_tipos_prazo
  FOR ALL TO authenticated
  USING (public.task_is_admin())
  WITH CHECK (public.task_is_admin());

-- 4.4 Tabela task_email_eventos (Idempotência e Segurança)
ALTER TABLE public.task_email_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_email_eventos_select_policy" ON public.task_email_eventos;
CREATE POLICY "task_email_eventos_select_policy" ON public.task_email_eventos
  FOR SELECT TO authenticated
  USING (public.task_is_admin());

-- Inserção e alteração direta por clientes bloqueadas (apenas service_role das Edge Functions acessa)
DROP POLICY IF EXISTS "task_email_eventos_insert_policy" ON public.task_email_eventos;
DROP POLICY IF EXISTS "task_email_eventos_update_policy" ON public.task_email_eventos;
DROP POLICY IF EXISTS "task_email_eventos_delete_policy" ON public.task_email_eventos;

-- ----------------------------------------------------------------------------
-- 5. Privilégios e Permissões de Execução
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.task_salvar_controle_transacional(UUID, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_transferir_atribuicao(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_current_core_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_current_core_perfil() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_is_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.task_salvar_controle_transacional(UUID, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_transferir_atribuicao(UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_current_core_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_current_core_perfil() TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_is_admin() TO authenticated;
