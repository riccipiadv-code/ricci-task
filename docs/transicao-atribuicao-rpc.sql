-- ============================================================================
-- SQL DE TRANSIÇÃO SEGURA DE ATRIBUIÇÃO E AUDITORIA (RICCI TASK)
-- Arquivo: docs/transicao-atribuicao-rpc.sql
-- NOTA: Este script é manual e NÃO é executado automaticamente.
-- O banco do Ricci Task só é alterado por ação manual do responsável técnico no Supabase.
-- ============================================================================

-- 1. Tabela de Auditoria de Transições de Atribuição
CREATE TABLE IF NOT EXISTS public.task_transicoes_atribuicao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID NOT NULL REFERENCES public.task_tarefas(id) ON DELETE CASCADE,
  responsavel_anterior_core_id UUID,
  executor_anterior_core_id UUID,
  novo_responsavel_core_id UUID NOT NULL REFERENCES public.core_usuarios(id),
  novo_executor_core_id UUID NOT NULL REFERENCES public.core_usuarios(id),
  motivo TEXT,
  autor_core_id UUID NOT NULL REFERENCES public.core_usuarios(id),
  autor_perfil TEXT NOT NULL,
  perda_acesso_autor BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitação obrigatória de RLS na tabela de auditoria
ALTER TABLE public.task_transicoes_atribuicao ENABLE ROW LEVEL SECURITY;

-- Índices para performance em auditoria e relatórios
CREATE INDEX IF NOT EXISTS idx_transicoes_tarefa_id ON public.task_transicoes_atribuicao(tarefa_id);
CREATE INDEX IF NOT EXISTS idx_transicoes_autor_core_id ON public.task_transicoes_atribuicao(autor_core_id);
CREATE INDEX IF NOT EXISTS idx_transicoes_created_at ON public.task_transicoes_atribuicao(created_at DESC);

-- Políticas RLS para task_transicoes_atribuicao:
-- Leitura restrita ao autor da transição e a administradores
DROP POLICY IF EXISTS "task_transicoes_select_policy" ON public.task_transicoes_atribuicao;
CREATE POLICY "task_transicoes_select_policy" ON public.task_transicoes_atribuicao
  FOR SELECT TO authenticated
  USING (
    autor_core_id = public.task_current_core_user_id()
    OR public.task_is_admin()
  );

-- Inserção permitida para chamadas autenticadas pelo sistema/RPC
DROP POLICY IF EXISTS "task_transicoes_insert_policy" ON public.task_transicoes_atribuicao;
CREATE POLICY "task_transicoes_insert_policy" ON public.task_transicoes_atribuicao
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_core_id = public.task_current_core_user_id()
    OR public.task_is_admin()
  );

-- 2. RPC SECURITY DEFINER: task_transferir_atribuicao
-- Valida o escopo ANTERIOR da linha em task_tarefas com bloqueio FOR UPDATE,
-- impede ataques de falsificação de estado anterior pelo cliente,
-- aplica a reatribuição, registra auditoria e retorna metadados completos.
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
BEGIN
  -- Identifica o usuário corporativo logado
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

  -- 1. Trava e lê o estado ANTERIOR real da tarefa (SELECT ... FOR UPDATE)
  SELECT
    id,
    responsavel_core_usuario_id,
    executor_core_usuario_id,
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

  -- 2. Avalia a autorização no estado ANTERIOR da própria linha
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
      -- Checa se o responsável ou executor anterior pertenciam à equipe direta do gestor
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

  -- 3. Aplica o UPDATE dos novos IDs centrais
  UPDATE public.task_tarefas
  SET
    responsavel_core_usuario_id = p_novo_responsavel_core_id,
    executor_core_usuario_id = p_novo_executor_core_id,
    responsavel_usuario_id = NULL,
    executor_usuario_id = NULL,
    updated_at = v_now,
    updated_by = v_caller_auth_id::text
  WHERE id = p_tarefa_id
  RETURNING updated_at INTO v_updated_at;

  -- 4. Avalia se o chamador perdeu acesso após a reatribuição
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

  -- 5. Registra o evento na tabela de auditoria
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
    v_now
  );

  -- 6. Retorna resultado seguro para a aplicação
  RETURN jsonb_build_object(
    'success', true,
    'tarefa_id', p_tarefa_id,
    'updated_at', v_updated_at,
    'perda_acesso', v_perda_acesso,
    'novo_responsavel_core_id', p_novo_responsavel_core_id,
    'novo_executor_core_id', p_novo_executor_core_id
  );
END;
$$;

-- Permite execução para usuários autenticados
GRANT EXECUTE ON FUNCTION public.task_transferir_atribuicao(UUID, UUID, UUID, TEXT) TO authenticated;
