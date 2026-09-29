-- ============================================================================
-- SQL DE TRANSIÇÃO SEGURA DE ATRIBUIÇÃO E AUDITORIA (RICCI TASK)
-- Arquivo: docs/transicao-atribuicao-rpc.sql
-- NOTA: Este script é manual e NÃO é executado automaticamente.
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garantir coluna versao_anterior_updated_at se tabela já tiver sido criada antes
ALTER TABLE public.task_transicoes_atribuicao
  ADD COLUMN IF NOT EXISTS versao_anterior_updated_at TIMESTAMPTZ;

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
-- A gravação só ocorre via SECURITY DEFINER da RPC task_transferir_atribuicao.
DROP POLICY IF EXISTS "task_transicoes_insert_policy" ON public.task_transicoes_atribuicao;
-- Nenhum CREATE POLICY para INSERT é concedido a authenticated/anon.

-- ----------------------------------------------------------------------------
-- 2. RPC SECURITY DEFINER: task_transferir_atribuicao
-- Valida o escopo ANTERIOR da linha em task_tarefas com bloqueio FOR UPDATE,
-- valida elegibilidade central estrita dos novos responsáveis/executores no RICCI_TASK,
-- preserva o token histórico do papel que NÃO mudou,
-- detecta ausência de mudança real (sem UPDATE nem auditoria espúria),
-- aplica a reatribuição, registra auditoria e retorna metadados completos.
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
  v_mudou_resp BOOLEAN := false;
  v_mudou_exec BOOLEAN := false;
  v_novo_resp_usuario_id UUID;
  v_novo_exec_usuario_id UUID;
  v_resp_elegivel BOOLEAN := false;
  v_exec_elegivel BOOLEAN := false;
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
    RAISE EXCEPTION 'Acesso negado: perfil % não autorizado para reatribuição.', v_caller_perfil USING ERRCODE = '42501';
  END IF;

  -- 2. Validação de elegibilidade central dos novos responsável e executor no RICCI_TASK
  -- (ativo em core_usuarios, vínculo ativo em core_usuario_sistemas com sistema RICCI_TASK ativo e perfil ativo)
  SELECT EXISTS (
    SELECT 1
    FROM public.core_usuarios u
    JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
    JOIN public.core_sistemas s ON s.id = us.sistema_id
    JOIN public.core_perfis p ON p.id = us.perfil_id
    WHERE u.id = p_novo_responsavel_core_id
      AND u.ativo = true
      AND us.ativo = true
      AND s.codigo = 'RICCI_TASK'
      AND s.ativo = true
      AND p.ativo = true
  ) INTO v_resp_elegivel;

  IF NOT v_resp_elegivel THEN
    RAISE EXCEPTION 'Novo Responsável (ID %) não possui vínculo central ativo e elegível no Ricci Task.', p_novo_responsavel_core_id
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.core_usuarios u
    JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
    JOIN public.core_sistemas s ON s.id = us.sistema_id
    JOIN public.core_perfis p ON p.id = us.perfil_id
    WHERE u.id = p_novo_executor_core_id
      AND u.ativo = true
      AND us.ativo = true
      AND s.codigo = 'RICCI_TASK'
      AND s.ativo = true
      AND p.ativo = true
  ) INTO v_exec_elegivel;

  IF NOT v_exec_elegivel THEN
    RAISE EXCEPTION 'Novo Executor (ID %) não possui vínculo central ativo e elegível no Ricci Task.', p_novo_executor_core_id
      USING ERRCODE = '42501';
  END IF;

  -- 3. Trava e lê o estado ANTERIOR real da tarefa (SELECT ... FOR UPDATE)
  SELECT
    id,
    responsavel_core_usuario_id,
    executor_core_usuario_id,
    responsavel_usuario_id,
    executor_usuario_id,
    updated_at,
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
    RAISE EXCEPTION 'Permissão negada: o chamador não possui escopo sobre o caso no estado anterior à reatribuição.' USING ERRCODE = '42501';
  END IF;

  -- 5. Detectar se houve mudança real nos IDs centrais
  v_mudou_resp := (v_tarefa.responsavel_core_usuario_id IS DISTINCT FROM p_novo_responsavel_core_id);
  v_mudou_exec := (v_tarefa.executor_core_usuario_id IS DISTINCT FROM p_novo_executor_core_id);

  IF NOT v_mudou_resp AND NOT v_mudou_exec THEN
    -- Sem mudança real: não executa UPDATE nem auditoria
    RETURN jsonb_build_object(
      'success', true,
      'mudanca_real', false,
      'tarefa_id', p_tarefa_id,
      'transicao_id', NULL,
      'updated_at', v_tarefa.updated_at,
      'perda_acesso', false,
      'novo_responsavel_core_id', v_tarefa.responsavel_core_usuario_id,
      'novo_executor_core_id', v_tarefa.executor_core_usuario_id
    );
  END IF;

  -- 6. Preservação de tokens históricos:
  -- Papel que mudou: token operacional é limpo (NULL), pois recebe novo ID central;
  -- Papel que NÃO mudou: preserva exatamente o token operacional anterior existente.
  IF v_mudou_resp THEN
    v_novo_resp_usuario_id := NULL;
  ELSE
    v_novo_resp_usuario_id := v_tarefa.responsavel_usuario_id;
  END IF;

  IF v_mudou_exec THEN
    v_novo_exec_usuario_id := NULL;
  ELSE
    v_novo_exec_usuario_id := v_tarefa.executor_usuario_id;
  END IF;

  -- 7. Aplica o UPDATE dos novos IDs centrais e updated_at
  UPDATE public.task_tarefas
  SET
    responsavel_core_usuario_id = p_novo_responsavel_core_id,
    executor_core_usuario_id = p_novo_executor_core_id,
    responsavel_usuario_id = v_novo_resp_usuario_id,
    executor_usuario_id = v_novo_exec_usuario_id,
    updated_at = v_now,
    updated_by = v_caller_auth_id::text
  WHERE id = p_tarefa_id
  RETURNING updated_at INTO v_updated_at;

  -- 8. Avalia se o chamador perdeu acesso após a reatribuição
  IF v_caller_perfil = 'ADMINISTRADOR' THEN
    v_has_access_after := true;
  ELSIF v_caller_perfil = 'OPERACIONAL' THEN
    v_has_access_after := (
      p_novo_responsavel_core_id = v_caller_core_id OR
      p_novo_executor_core_id = v_caller_core_id
    );
  ELSIF v_caller_perfil = 'GESTOR' THEN
    IF (p_novo_responsavel_core_id = v_caller_core_id OR
        p_novo_executor_core_id = v_caller_core_id) THEN
      v_has_access_after := true;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.core_usuarios
        WHERE gestor_id = v_caller_core_id
          AND ativo = true
          AND id IN (p_novo_responsavel_core_id, p_novo_executor_core_id)
      ) INTO v_has_access_after;
    END IF;
  END IF;

  v_perda_acesso := NOT v_has_access_after;

  -- 9. Registra o evento na tabela de auditoria
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
    created_at
  ) VALUES (
    p_tarefa_id,
    v_tarefa.responsavel_core_usuario_id,
    v_tarefa.executor_core_usuario_id,
    p_novo_responsavel_core_id,
    p_novo_executor_core_id,
    p_motivo,
    v_caller_core_id,
    v_caller_perfil,
    v_perda_acesso,
    v_tarefa.updated_at,
    v_now
  )
  RETURNING id INTO v_transicao_id;

  -- 10. Retorna resultado seguro com identificador da transição e updated_at efetivo
  RETURN jsonb_build_object(
    'success', true,
    'mudanca_real', true,
    'tarefa_id', p_tarefa_id,
    'transicao_id', v_transicao_id,
    'updated_at', v_updated_at,
    'versao_anterior_updated_at', v_tarefa.updated_at,
    'perda_acesso', v_perda_acesso,
    'novo_responsavel_core_id', p_novo_responsavel_core_id,
    'novo_executor_core_id', p_novo_executor_core_id
  );
END;
$$;

-- Restringe privilégios de execução estritamente:
REVOKE ALL ON FUNCTION public.task_transferir_atribuicao(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_current_core_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_current_core_perfil() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_is_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.task_transferir_atribuicao(UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_current_core_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_current_core_perfil() TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_is_admin() TO authenticated;
