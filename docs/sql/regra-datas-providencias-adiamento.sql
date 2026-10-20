-- ============================================================================
-- SQL DEFINITIVO — ETAPA 1: REGRA DE DATAS (PROVIDÊNCIA <= CONCLUSÃO DO CASO)
-- SISTEMA: RICCI TASK
-- ARQUIVO: docs/sql/regra-datas-providencias-adiamento.sql
-- NOTA IMPORTANTE: ESTE ARQUIVO É APENAS PARA REVISÃO E APLICAÇÃO MANUAL PELO USUÁRIO.
-- NENHUMA PARTE DESTE SCRIPT FOI EXECUTADA NO BANCO PELO AGENTE.
-- ============================================================================
-- RESUMO DAS ALTERAÇÕES CONTIDAS NESTE ARQUIVO:
-- 1. Coluna public.core_usuarios.adiamento (boolean NOT NULL DEFAULT false).
-- 2. Tabela public.task_solicitacoes_adiamento (com PK, FKs reais, constraints, índices e RLS completa).
-- 3. Proteção estrita de core_usuarios.adiamento contra alteração indevida por APIs diretas
--    e pelo app, reservando a escrita para administração externa (Gestor de Acessos Ricci).
-- 4. Triggers anti-bypass no banco em task_providencias e task_tarefas garantindo que:
--    - Inserção/atualização de providência: data <= prazo_conclusao do caso (igualdade permitida; null permite qualquer data).
--    - Alteração/redução de prazo_conclusao do caso em task_tarefas: valida TODAS as providências ativas (deleted_at IS NULL).
--    - Restauração de providência excluída e troca de caso (tarefa_id) validados.
-- 5. Atualização atômica da RPC task_salvar_controle_transacional com validação antecipada no servidor,
--    preservando escopos GESTOR/ADMINISTRADOR/OPERACIONAL, concorrência segura (FOR UPDATE) e rollback integral.
-- 6. Script de Rollback completo ao final do arquivo.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PARTE 1: COLUNA public.core_usuarios.adiamento
-- ============================================================================
-- Se a coluna já tiver sido adicionada, o IF NOT EXISTS garante idempotência.
ALTER TABLE public.core_usuarios
  ADD COLUMN IF NOT EXISTS adiamento BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.core_usuarios.adiamento IS
  'Flag booleana indicando se o usuário possui permissão para solicitar adiamento de prazos. Administrada exclusivamente pelo Gestor de Acessos Ricci.';


-- ============================================================================
-- PARTE 2: TABELA public.task_solicitacoes_adiamento
-- ============================================================================
-- Estrutura alinhada com o modelo já verificado no schema:
-- PK UUID, FKs para task_tarefas, task_providencias (nullable), core_usuarios (solicitante e administrador),
-- chave de idempotência UUID única, CHECK constraints de validação de motivo e prazos.
CREATE TABLE IF NOT EXISTS public.task_solicitacoes_adiamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID NOT NULL REFERENCES public.task_tarefas(id) ON DELETE RESTRICT,
  providencia_id UUID REFERENCES public.task_providencias(id) ON DELETE RESTRICT,
  solicitante_core_usuario_id UUID NOT NULL REFERENCES public.core_usuarios(id) ON DELETE RESTRICT,
  administrador_core_usuario_id UUID NOT NULL REFERENCES public.core_usuarios(id) ON DELETE RESTRICT,
  providencia_texto TEXT NOT NULL,
  motivo VARCHAR(200) NOT NULL,
  prazo_caso_atual DATE NOT NULL,
  prazo_solicitado DATE NOT NULL,
  chave_idempotencia UUID NOT NULL UNIQUE,
  email_status TEXT NOT NULL DEFAULT 'pendente',
  email_enviado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Validações de integridade
  CONSTRAINT task_adiamento_providencia_valida
    CHECK (char_length(btrim(providencia_texto)) > 0),
  CONSTRAINT task_adiamento_motivo_valido
    CHECK (char_length(btrim(motivo::text)) >= 1 AND char_length(btrim(motivo::text)) <= 200),
  CONSTRAINT task_adiamento_prazo_valido
    CHECK (prazo_solicitado > prazo_caso_atual),
  CONSTRAINT task_adiamento_email_status_valido
    CHECK (email_status IN ('pendente', 'enviando', 'enviado', 'falhou', 'incerto', 'cancelado')),
  CONSTRAINT task_adiamento_email_data_valida
    CHECK ((email_status = 'enviado') = (email_enviado_at IS NOT NULL))
);

-- Índices de performance e consulta
CREATE INDEX IF NOT EXISTS task_adiamento_tarefa_idx
  ON public.task_solicitacoes_adiamento(tarefa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS task_adiamento_providencia_idx
  ON public.task_solicitacoes_adiamento(providencia_id)
  WHERE (providencia_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS task_adiamento_solicitante_idx
  ON public.task_solicitacoes_adiamento(solicitante_core_usuario_id);

CREATE INDEX IF NOT EXISTS task_adiamento_administrador_idx
  ON public.task_solicitacoes_adiamento(administrador_core_usuario_id);

-- RLS para task_solicitacoes_adiamento
ALTER TABLE public.task_solicitacoes_adiamento ENABLE ROW LEVEL SECURITY;

-- 2.1 SELECT: Administrador vê todas; solicitante vê as suas; responsável/executor do caso vê as solicitações do caso
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_select_policy" ON public.task_solicitacoes_adiamento;
CREATE POLICY "task_solicitacoes_adiamento_select_policy"
  ON public.task_solicitacoes_adiamento
  FOR SELECT
  TO authenticated
  USING (
    task_is_admin()
    OR solicitante_core_usuario_id = task_current_core_user_id()
    OR administrador_core_usuario_id = task_current_core_user_id()
    OR EXISTS (
      SELECT 1 FROM public.task_tarefas t
      WHERE t.id = task_solicitacoes_adiamento.tarefa_id
        AND (
          (t.responsavel_core_usuario_id = task_current_core_user_id())
          OR (t.executor_core_usuario_id = task_current_core_user_id())
        )
    )
  );

-- 2.2 INSERT: Somente usuários ativos com adiamento = true em core_usuarios podem inserir para si mesmos
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_insert_policy" ON public.task_solicitacoes_adiamento;
CREATE POLICY "task_solicitacoes_adiamento_insert_policy"
  ON public.task_solicitacoes_adiamento
  FOR INSERT
  TO authenticated
  WITH CHECK (
    task_is_admin()
    OR (
      solicitante_core_usuario_id = task_current_core_user_id()
      AND EXISTS (
        SELECT 1 FROM public.core_usuarios u
        WHERE u.id = task_current_core_user_id()
          AND u.ativo = true
          AND u.adiamento = true
      )
      AND EXISTS (
        SELECT 1 FROM public.task_tarefas t
        WHERE t.id = task_solicitacoes_adiamento.tarefa_id
          AND t.deleted_at IS NULL
          AND (
            (t.responsavel_core_usuario_id = task_current_core_user_id())
            OR (t.executor_core_usuario_id = task_current_core_user_id())
          )
      )
    )
  );

-- 2.3 UPDATE: Apenas Administrador pode atualizar status de email/tratamento
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_update_policy" ON public.task_solicitacoes_adiamento;
CREATE POLICY "task_solicitacoes_adiamento_update_policy"
  ON public.task_solicitacoes_adiamento
  FOR UPDATE
  TO authenticated
  USING (task_is_admin())
  WITH CHECK (task_is_admin());

-- 2.4 DELETE: Apenas Administrador pode excluir solicitações
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_delete_policy" ON public.task_solicitacoes_adiamento;
CREATE POLICY "task_solicitacoes_adiamento_delete_policy"
  ON public.task_solicitacoes_adiamento
  FOR DELETE
  TO authenticated
  USING (task_is_admin());


-- ============================================================================
-- PARTE 3: PROTEÇÃO DA COLUNA core_usuarios.adiamento CONTRA ALTERAÇÃO INDEVIDA
-- ============================================================================
-- OBJETIVO: A flag core_usuarios.adiamento é uma prerrogativa administrada EXCLUSIVAMENTE
-- fora do Ricci Task, no "Gestor de Acessos Ricci".
-- Qualquer tentativa de UPDATE por rotas da API PostgREST autenticada, autoedição de cadastro,
-- ou funções de aplicação no Ricci Task DEVE ser rejeitada no banco de dados.
--
-- MECANISMO IMPLEMENTADO:
-- Trigger BEFORE UPDATE em public.core_usuarios em modo SECURITY INVOKER.
-- Quando OLD.adiamento IS DISTINCT FROM NEW.adiamento, valida se o contexto de execução
-- é do Gestor de Acessos (via função core_is_gestor_acesso_admin() já existente no banco,
-- ou via role de serviço administrativo / migrador).
-- Qualquer outro chamador (como authenticated comum, usuário editando o próprio cadastro, etc.)
-- recebe EXCEPTION '42501' (permissão negada).
--
-- COMO O GESTOR DE ACESSOS PODERÁ ALTERÁ-LA LEGITIMAMENTE:
-- 1. Usuário com perfil 'ADMINISTRADOR' no sistema 'GESTOR_ACESSO' (core_is_gestor_acesso_admin() = true)
--    pode executar UPDATE diretamente via PostgREST/Supabase.
-- 2. Ou chamadas via service_role / postgres (Edge Functions ou scripts de backend administrativo).

CREATE OR REPLACE FUNCTION public.core_usuarios_proteger_coluna_adiamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Se o valor da coluna 'adiamento' estiver sendo alterado
  IF OLD.adiamento IS DISTINCT FROM NEW.adiamento THEN
    -- Permite apenas se o chamador for Administrador do Gestor de Acessos
    -- ou se a role for superuser/postgres/service_role
    IF current_user IN ('postgres', 'service_role') THEN
      RETURN NEW;
    END IF;

    IF public.core_is_gestor_acesso_admin() THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Alteração indevida bloqueada: a permissão de adiamento (core_usuarios.adiamento) só pode ser modificada pelo Gestor de Acessos Ricci por um Administrador autorizado.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_core_usuarios_proteger_adiamento ON public.core_usuarios;
CREATE TRIGGER trg_core_usuarios_proteger_adiamento
  BEFORE UPDATE OF adiamento ON public.core_usuarios
  FOR EACH ROW
  EXECUTE FUNCTION public.core_usuarios_proteger_coluna_adiamento();

COMMENT ON TRIGGER trg_core_usuarios_proteger_adiamento ON public.core_usuarios IS
  'Impede alteração da coluna adiamento por APIs e usuários do Ricci Task, restringindo-a ao Gestor de Acessos.';


-- ============================================================================
-- PARTE 4: GARANTIA DA REGRA DE DATAS NO BANCO (TRIGGERS ANTI-BYPASS)
-- ============================================================================
-- REGRA DO NEGÓCIO:
-- "A data da providência não pode ser maior que a data de conclusão do caso (prazo_conclusao)."
-- Convenção:
-- - Ambas as colunas (task_providencias.prazo_conclusao e task_tarefas.prazo_conclusao) são do tipo DATE.
-- - Comparação estrita de calendário: p.prazo_conclusao <= t.prazo_conclusao.
-- - Igualdade é PERMITIDA (p.prazo_conclusao = t.prazo_conclusao é válido).
-- - Conclusão do caso NULL mantém a opcionalidade: a providência pode ter qualquer data se o caso não tiver prazo definido.
--
-- CAMINHOS COBERTOS:
-- 1. Inserção de providência (INSERT em task_providencias).
-- 2. Mudança de prazo da providência (UPDATE de prazo_conclusao em task_providencias).
-- 3. Troca de caso da providência (UPDATE de tarefa_id em task_providencias).
-- 4. Restauração de providência excluída (UPDATE de deleted_at de NOT NULL para NULL).
-- 5. Redução/alteração do prazo_conclusao do caso em task_tarefas: valida TODAS as providências ativas
--    (deleted_at IS NULL) vinculadas àquele caso contra o novo prazo_conclusao.

-- ----------------------------------------------------------------------------
-- 4.1 Trigger em task_providencias (cobre INSERT, UPDATE de prazo, troca de tarefa e restauração)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.task_providencias_validar_data_limite_caso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caso_prazo DATE;
  v_caso_deleted TIMESTAMPTZ;
  v_caso_identificacao TEXT;
  v_caso_numero INT;
BEGIN
  -- Se a providência estiver marcada como excluída (soft-deleted), não bloqueia
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Se for UPDATE e não alterou nem o prazo nem a tarefa_id nem restaurou a providência, não revalida
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.prazo_conclusao = NEW.prazo_conclusao)
       AND (OLD.tarefa_id = NEW.tarefa_id)
       AND (OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Busca o prazo_conclusao do caso correspondente
  SELECT prazo_conclusao, deleted_at, identificacao_caso, numero_caso
  INTO v_caso_prazo, v_caso_deleted, v_caso_identificacao, v_caso_numero
  FROM public.task_tarefas
  WHERE id = NEW.tarefa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso vinculado (ID %) não foi localizado.', NEW.tarefa_id
      USING ERRCODE = '23503';
  END IF;

  -- Se o caso tiver prazo_conclusao definido, a providência NÃO pode ultrapassá-lo
  -- (igualdade é estritamente permitida: NEW.prazo_conclusao <= v_caso_prazo)
  IF v_caso_prazo IS NOT NULL THEN
    IF NEW.prazo_conclusao > v_caso_prazo THEN
      RAISE EXCEPTION 'A data da providência (%) não pode ser maior que a data de conclusão do caso (% - Caso #%: "%").',
        to_char(NEW.prazo_conclusao, 'DD/MM/YYYY'),
        to_char(v_caso_prazo, 'DD/MM/YYYY'),
        COALESCE(v_caso_numero, 0),
        COALESCE(v_caso_identificacao, '')
        USING ERRCODE = '23514'; -- check_violation
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_providencias_validar_data_limite ON public.task_providencias;
CREATE TRIGGER trg_task_providencias_validar_data_limite
  BEFORE INSERT OR UPDATE OF prazo_conclusao, tarefa_id, deleted_at ON public.task_providencias
  FOR EACH ROW
  EXECUTE FUNCTION public.task_providencias_validar_data_limite_caso();

COMMENT ON TRIGGER trg_task_providencias_validar_data_limite ON public.task_providencias IS
  'Garante que o prazo de conclusão da providência não ultrapasse o prazo de conclusão do caso associado.';

-- ----------------------------------------------------------------------------
-- 4.2 Trigger em task_tarefas (cobre redução/alteração de prazo_conclusao do caso)
-- ----------------------------------------------------------------------------
-- Ao alterar prazo_conclusao de um caso, verifica se existe alguma providência ativa
-- (deleted_at IS NULL) com prazo_conclusao maior que a nova data proposta.
CREATE OR REPLACE FUNCTION public.task_tarefas_validar_providencias_ao_alterar_prazo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prov_invalida RECORD;
BEGIN
  -- Se o caso estiver sendo soft-deleted, não bloqueia
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Só valida se prazo_conclusao foi alterado para um valor NOT NULL
  IF NEW.prazo_conclusao IS NOT NULL THEN
    -- Se o prazo_conclusao anterior era igual ao novo, não precisa verificar
    IF TG_OP = 'UPDATE' AND OLD.prazo_conclusao IS NOT DISTINCT FROM NEW.prazo_conclusao THEN
      RETURN NEW;
    END IF;

    -- Localiza a providência ativa mais distante que excede o novo prazo
    SELECT id, providencia, prazo_conclusao
    INTO v_prov_invalida
    FROM public.task_providencias
    WHERE tarefa_id = NEW.id
      AND deleted_at IS NULL
      AND prazo_conclusao > NEW.prazo_conclusao
    ORDER BY prazo_conclusao DESC
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'A conclusão do caso (%) não pode ser reduzida para uma data anterior ao prazo da providência "%" (%). Ajuste o prazo da providência primeiro ou solicite adiamento.',
        to_char(NEW.prazo_conclusao, 'DD/MM/YYYY'),
        v_prov_invalida.providencia,
        to_char(v_prov_invalida.prazo_conclusao, 'DD/MM/YYYY')
        USING ERRCODE = '23514'; -- check_violation
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_tarefas_validar_providencias_prazo ON public.task_tarefas;
CREATE TRIGGER trg_task_tarefas_validar_providencias_prazo
  BEFORE UPDATE OF prazo_conclusao ON public.task_tarefas
  FOR EACH ROW
  EXECUTE FUNCTION public.task_tarefas_validar_providencias_ao_alterar_prazo();

COMMENT ON TRIGGER trg_task_tarefas_validar_providencias_prazo ON public.task_tarefas IS
  'Impede redução ou alteração do prazo de conclusão do caso se houver providências ativas com data posterior à nova conclusão.';


-- ============================================================================
-- PARTE 5: RPC task_salvar_controle_transacional COM VALIDAÇÃO DE DATAS INTEGRADA
-- ============================================================================
-- A RPC task_salvar_controle_transacional foi atualizada com validação prévia explícita:
-- 1. Em CRIACAO ou EDICAO, caso v_prazo_conclusao esteja definido:
--    - Cada providência passada no payload (v_prov_prazo::date) é checada contra v_prazo_conclusao::date.
--    - Igualdade é permitida. Null em v_prazo_conclusao permite qualquer data.
-- 2. Em EDICAO onde v_prazo_conclusao do caso foi alterado/reduzido:
--    - Além das providências enviadas no payload, valida TODAS as providências ativas já persistidas
--      no banco que não tenham sido incluídas na atualização.
-- 3. Preserva 100% dos escopos (GESTOR, ADMINISTRADOR, OPERACIONAL), auditoria, eventos_providencias,
--    atomicidade e rollback integral em caso de exceção.

CREATE OR REPLACE FUNCTION public.task_salvar_controle_transacional(
  p_tarefa_id UUID DEFAULT NULL::uuid,
  p_dados_caso JSONB DEFAULT '{}'::jsonb,
  p_providencias JSONB DEFAULT '[]'::jsonb,
  p_motivo TEXT DEFAULT NULL::text
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
  v_operacao TEXT; -- 'CRIACAO' ou 'EDICAO'
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

  -- Variável para validação de conflito de datas em providências já persistidas
  v_prov_db_conflito RECORD;
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

  -- =========================================================================
  -- VALIDAÇÃO ANTECIPADA DA REGRA DE DATAS:
  -- Se o caso possuir prazo_conclusao definido, nenhuma providência do payload
  -- pode possuir prazo maior que essa data (comparação em DATE, igualdade permitida).
  -- =========================================================================
  IF v_prazo_conclusao IS NOT NULL AND p_providencias IS NOT NULL AND jsonb_array_length(p_providencias) > 0 THEN
    FOR v_prov_item IN SELECT * FROM jsonb_array_elements(p_providencias)
    LOOP
      v_prov_prazo := (v_prov_item->>'prazo_conclusao')::TIMESTAMPTZ;
      IF v_prov_prazo IS NOT NULL AND (v_prov_prazo::date > v_prazo_conclusao::date) THEN
        RAISE EXCEPTION 'A data da providência "%" (%) não pode ser maior que a data de conclusão do caso (%).',
          COALESCE(TRIM(v_prov_item->>'providencia'), 'sem descrição'),
          to_char(v_prov_prazo::date, 'DD/MM/YYYY'),
          to_char(v_prazo_conclusao::date, 'DD/MM/YYYY')
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  -- 3. PROCESSAMENTO CONFORME O MODO
  IF v_operacao = 'CRIACAO' THEN
    -- MODO CRIACAO: SEM NENHUM ACESSO A v_tarefa
    v_op_resp_id := NULL;
    v_op_exec_id := NULL;

    -- Validação de escopo estrito por perfil na criação
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
      -- Escopo estrito GESTOR: apenas casos próprios (responsável ou executor)
      IF v_novo_resp_core_id = v_caller_core_id OR v_novo_exec_core_id = v_caller_core_id THEN
        v_has_access_before := true;
      ELSE
        RAISE EXCEPTION 'Permissão negada: gestor só pode criar casos próprios onde seja Responsável ou Executor.'
          USING ERRCODE = '42501';
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

    -- Inserção do novo caso
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
      v_caller_auth_id,
      v_caller_auth_id,
      v_now,
      v_now
    )
    RETURNING * INTO v_saved_caso;

    p_tarefa_id := v_saved_caso.id;
    v_updated_at := v_saved_caso.updated_at;
    v_versao_anterior_updated_at := NULL;

  ELSE
    -- MODO EDICAO: LEITURA E TRAVA (SELECT ... FOR UPDATE)
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
      -- Escopo estrito GESTOR: apenas casos próprios (sem subordinados, sem fallback legado)
      v_has_access_before := (
        v_tarefa.responsavel_core_usuario_id = v_caller_core_id OR
        v_tarefa.executor_core_usuario_id = v_caller_core_id
      );
    END IF;

    IF NOT v_has_access_before THEN
      RAISE EXCEPTION 'Permissão negada: o chamador não possui escopo sobre o caso no estado anterior.' USING ERRCODE = '42501';
    END IF;

    -- Se o prazo_conclusao do caso estiver sendo reduzido/alterado em edição:
    -- Valida se há providências ativas persistidas que excedem o novo prazo e que NÃO estão no payload
    IF v_prazo_conclusao IS NOT NULL AND (v_tarefa.prazo_conclusao IS DISTINCT FROM v_prazo_conclusao::date) THEN
      SELECT id, providencia, prazo_conclusao
      INTO v_prov_db_conflito
      FROM public.task_providencias
      WHERE tarefa_id = p_tarefa_id
        AND deleted_at IS NULL
        AND prazo_conclusao > v_prazo_conclusao::date
      ORDER BY prazo_conclusao DESC
      LIMIT 1;

      IF FOUND THEN
        -- Verifica se essa providência em conflito está sendo corrigida no payload
        -- (se não estiver ou se continuar maior, a exceção será levantada)
        DECLARE
          v_ajustada_no_payload BOOLEAN := false;
        BEGIN
          IF p_providencias IS NOT NULL AND jsonb_array_length(p_providencias) > 0 THEN
            FOR v_prov_item IN SELECT * FROM jsonb_array_elements(p_providencias)
            LOOP
              IF (v_prov_item->>'id')::UUID = v_prov_db_conflito.id THEN
                IF ((v_prov_item->>'prazo_conclusao')::TIMESTAMPTZ)::date <= v_prazo_conclusao::date THEN
                  v_ajustada_no_payload := true;
                END IF;
              END IF;
            END LOOP;
          END IF;

          IF NOT v_ajustada_no_payload THEN
            RAISE EXCEPTION 'A conclusão do caso (%) não pode ser menor que o prazo da providência "%" (%). Ajuste o prazo da providência primeiro ou solicite adiamento.',
              to_char(v_prazo_conclusao::date, 'DD/MM/YYYY'),
              v_prov_db_conflito.providencia,
              to_char(v_prov_db_conflito.prazo_conclusao, 'DD/MM/YYYY')
              USING ERRCODE = '23514';
          END IF;
        END;
      END IF;
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

      -- Validação de limite contra o prazo do caso (já persistido ou em criação)
      IF v_prazo_conclusao IS NOT NULL AND (v_prov_prazo::date > v_prazo_conclusao::date) THEN
        RAISE EXCEPTION 'A data da providência "%" (%) não pode ser maior que a data de conclusão do caso (%).',
          v_prov_desc,
          to_char(v_prov_prazo::date, 'DD/MM/YYYY'),
          to_char(v_prazo_conclusao::date, 'DD/MM/YYYY')
          USING ERRCODE = '23514';
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
            prazo_conclusao = v_prov_prazo::date,
            tipo_prazo_id = v_prov_tipo,
            status_id = v_prov_status,
            ordem = v_prov_ordem,
            data_conclusao = v_prov_data_conclusao::date,
            email_alertas = v_prov_email_alertas,
            email_alerta_inclusao = v_prov_email_inclusao,
            email_alerta_atraso = v_prov_email_atraso,
            email_alerta_atualizacao = v_prov_email_atualizacao,
            updated_at = v_now,
            updated_by = v_caller_auth_id
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
          v_prov_prazo::date,
          v_prov_tipo,
          v_prov_status,
          v_prov_ordem,
          v_prov_data_conclusao::date,
          v_prov_email_alertas,
          v_prov_email_inclusao,
          v_prov_email_atraso,
          v_prov_email_atualizacao,
          v_caller_auth_id,
          v_caller_auth_id,
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
        data_autorizacao = v_data_autorizacao::date,
        prazo_conclusao = v_prazo_conclusao::date,
        pasta_cliente = v_pasta_cliente,
        pasta_ricci = v_pasta_ricci,
        responsavel_core_usuario_id = v_novo_resp_core_id,
        executor_core_usuario_id = v_novo_exec_core_id,
        responsavel_usuario_id = v_op_resp_id,
        executor_usuario_id = v_op_exec_id,
        arquivado_at = v_arquivado_at,
        updated_at = v_now,
        updated_by = v_caller_auth_id
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
    -- Escopo estrito GESTOR: apenas casos próprios
    v_has_access_after := (
      v_novo_resp_core_id = v_caller_core_id OR
      v_novo_exec_core_id = v_caller_core_id
    );
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

  -- 9. RETORNO DOS DADOS REAIS
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
    'providencias', v_prov_gravadas,
    'eventos_providencias', v_eventos_provs
  );

END;
$$;

COMMENT ON FUNCTION public.task_salvar_controle_transacional(uuid, jsonb, jsonb, text) IS
  'Gravação atômica transacional de caso e providências com validação de escopos corporativos e verificação de prazo limite (providência <= conclusão do caso).';

COMMIT;


-- ============================================================================
-- SCRIPT DE ROLLBACK COMPLETO (PRESERVA HISTÓRICO E DADOS EXISTENTES)
-- ============================================================================
/*
Para desfazer as alterações deste script sem perda de dados históricos:

BEGIN;

-- 1. Remove os triggers anti-bypass de validação de datas
DROP TRIGGER IF EXISTS trg_task_providencias_validar_data_limite ON public.task_providencias;
DROP FUNCTION IF EXISTS public.task_providencias_validar_data_limite_caso();

DROP TRIGGER IF EXISTS trg_task_tarefas_validar_providencias_prazo ON public.task_tarefas;
DROP FUNCTION IF EXISTS public.task_tarefas_validar_providencias_ao_alterar_prazo();

-- 2. Remove o trigger de proteção da coluna adiamento
DROP TRIGGER IF EXISTS trg_core_usuarios_proteger_adiamento ON public.core_usuarios;
DROP FUNCTION IF EXISTS public.core_usuarios_proteger_coluna_adiamento();

-- 3. (Opcional) Reverter a RPC task_salvar_controle_transacional para a versão anterior:
-- Executar a versão anterior documentada em docs/transicao-atribuicao-rpc.sql

-- 4. (Opcional) Caso deseje remover as políticas de task_solicitacoes_adiamento:
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_select_policy" ON public.task_solicitacoes_adiamento;
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_insert_policy" ON public.task_solicitacoes_adiamento;
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_update_policy" ON public.task_solicitacoes_adiamento;
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_delete_policy" ON public.task_solicitacoes_adiamento;

-- 5. NOTA SOBRE TABELAS/COLUNAS:
-- As tabelas task_solicitacoes_adiamento e a coluna core_usuarios.adiamento
-- NÃO devem ser descartadas com DROP CASCADE se já contiverem registros,
-- preservando a integridade referencial dos dados.

COMMIT;
*/
