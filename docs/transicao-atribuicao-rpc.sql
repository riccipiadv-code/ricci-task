-- ============================================================================
-- SQL DE TRANSIÇÃO SEGURA DE ATRIBUIÇÃO, GRAVAÇÃO ATÔMICA E AUDITORIA (RICCI TASK)
-- Arquivo: docs/transicao-atribuicao-rpc.sql
-- NOTA: Este script é manual e NÃO é executado automaticamente pelo build/migrações.
-- O banco do Ricci Task só é alterado por ação manual do responsável técnico no Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Funções Auxiliares de Contexto Corporativo Central (se não existirem)
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

-- 2) Inserção direta BLOQUEADA para clientes: NENHUM authenticated pode dar INSERT direto.
-- A gravação só ocorre via SECURITY DEFINER dentro da RPC.
DROP POLICY IF EXISTS "task_transicoes_insert_policy" ON public.task_transicoes_atribuicao;
-- Nenhum CREATE POLICY para INSERT é concedido a authenticated/anon.

-- ----------------------------------------------------------------------------
-- 2. RPC SECURITY DEFINER: task_salvar_controle_transacional
-- Executa em UMA ÚNICA TRANSAÇÃO no servidor:
--  - Validação de autenticação e contexto corporativo do chamador;
--  - Validação de escopo no estado ANTERIOR do caso com SELECT ... FOR UPDATE;
--  - Validação de elegibilidade central seletiva (APENAS para papéis que mudaram);
--  - Preservação do participante histórico e token para papel que NÃO mudou;
--  - Atualização dos dados do caso (ou criação, se p_tarefa_id for NULL);
--  - Inclusão / atualização / exclusão de providências (all-or-nothing);
--  - Registro de auditoria em task_transicoes_atribuicao SOMENTE se houve alteração de atribuição;
--  - Retorno completo dos dados reais efetivamente gravados.
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

  -- Variáveis para manipulação de providências
  v_prov_item JSONB;
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
  v_prov_gravadas JSONB := '[]'::jsonb;
  v_saved_prov RECORD;
  v_saved_caso RECORD;
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

  IF (p_dados_caso->>'responsavel_usuario_id') IS NOT NULL AND TRIM(p_dados_caso->>'responsavel_usuario_id') <> '' THEN
    v_op_resp_id := (p_dados_caso->>'responsavel_usuario_id')::UUID;
  END IF;

  IF (p_dados_caso->>'executor_usuario_id') IS NOT NULL AND TRIM(p_dados_caso->>'executor_usuario_id') <> '' THEN
    v_op_exec_id := (p_dados_caso->>'executor_usuario_id')::UUID;
  END IF;

  -- Validação de campos obrigatórios do caso
  IF v_nome_controle_id IS NULL OR v_identificacao_caso = '' OR v_status_id IS NULL OR
     v_novo_resp_core_id IS NULL OR v_novo_exec_core_id IS NULL THEN
    RAISE EXCEPTION 'Dados obrigatórios incompletos para gravação do controle.' USING ERRCODE = '22023';
  END IF;

  -- Verifica se o status_id é finalizador
  SELECT COALESCE(finaliza, false) INTO v_status_finaliza
  FROM public.task_status
  WHERE id = v_status_id;

  -- 3. EDICÃO OU CRIAÇÃO
  IF p_tarefa_id IS NOT NULL THEN
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

    -- 4. Avalia a autorização no estado ANTERIOR da própria linha
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

    -- 5. Detectar alteração de atribuição
    v_mudou_resp := (v_tarefa.responsavel_core_usuario_id IS DISTINCT FROM v_novo_resp_core_id);
    v_mudou_exec := (v_tarefa.executor_core_usuario_id IS DISTINCT FROM v_novo_exec_core_id);

    -- PONTO 4: Validação de elegibilidade central SOMENTE dos papéis que mudaram!
    -- O papel que NÃO mudou preserva o participante histórico (mesmo inativo) e token histórico.
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

    -- Detecta se houve mudança real nos campos do caso
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

  ELSE
    -- CRIAÇÃO DE CASO NOVO
    -- Valida ambos os participantes centrais obrigatoriamente
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
  END IF;

  -- 6. PROCESSAMENTO DAS PROVIDÊNCIAS DENTRO DA MESMA TRANSAÇÃO
  -- Se qualquer providência falhar (validação ou erro de BD), toda a transação faz rollback!
  IF p_providencias IS NOT NULL AND jsonb_array_length(p_providencias) > 0 THEN
    v_houve_mudanca_provs := true;
  END IF;

  -- Se for edição e não houve mudança nem no caso nem nas providências fornecidas,
  -- retorna estado atual sem UPDATE para proteger updated_at
  IF p_tarefa_id IS NOT NULL AND NOT v_houve_mudanca_caso AND NOT v_houve_mudanca_provs THEN
    SELECT * INTO v_saved_caso FROM public.task_tarefas WHERE id = p_tarefa_id;
    RETURN jsonb_build_object(
      'success', true,
      'mudanca_real', false,
      'tarefa_id', p_tarefa_id,
      'transicao_id', NULL,
      'updated_at', v_saved_caso.updated_at,
      'perda_acesso', false,
      'caso', to_jsonb(v_saved_caso),
      'providencias', '[]'::jsonb
    );
  END IF;

  -- 7. GRAVAÇÃO DO CASO (INSERT OU UPDATE)
  IF p_tarefa_id IS NOT NULL THEN
    IF v_houve_mudanca_caso OR v_houve_mudanca_provs THEN
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
  ELSE
    -- Caso novo
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
      v_op_resp_id,
      v_op_exec_id,
      v_arquivado_at,
      v_caller_auth_id::text,
      v_caller_auth_id::text,
      v_now,
      v_now
    )
    RETURNING * INTO v_saved_caso;

    p_tarefa_id := v_saved_caso.id;
    v_updated_at := v_saved_caso.updated_at;
  END IF;

  -- 8. GRAVAÇÃO DAS PROVIDÊNCIAS
  IF p_providencias IS NOT NULL AND jsonb_array_length(p_providencias) > 0 THEN
    FOR v_prov_item IN SELECT * FROM jsonb_array_elements(p_providencias)
    LOOP
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
        -- Atualização de providência existente
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
        WHERE id = v_prov_id AND tarefa_id = p_tarefa_id
        RETURNING * INTO v_saved_prov;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Providência % não encontrada na tarefa %.', v_prov_id, p_tarefa_id USING ERRCODE = 'P0002';
        END IF;
      ELSE
        -- Inclusão de nova providência
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
      END IF;

      v_prov_gravadas := v_prov_gravadas || to_jsonb(v_saved_prov);
    END LOOP;
  END IF;

  -- 9. AVALIAÇÃO DE PERDA DE ACESSO
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

  -- 10. AUDITORIA DA TRANSIÇÃO (SOMENTE EM MUDANÇA REAL DE ATRIBUIÇÃO)
  -- Ponto 3 & 4: registra versao_anterior_updated_at e versao_resultante_updated_at (v_updated_at)
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

  -- 11. RETORNO DOS DADOS REAIS EFETIVAMENTE GRAVADOS
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

-- Restringe privilégios de execução estritamente:
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
