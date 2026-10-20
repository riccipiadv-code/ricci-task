-- ============================================================================
-- SQL COMPLEMENTAR: REGRA DE DATAS (PROVIDÊNCIA <= CONCLUSÃO DO CASO)
-- E POLÍTICAS / TRIGGERS DE SEGURANÇA
-- SISTEMA: RICCI TASK
-- ARQUIVO: docs/sql/complemento-regra-datas-providencias-adiamento.sql
-- NOTA IMPORTANTE: ESTE ARQUIVO É EXCLUSIVAMENTE PARA REVISÃO E APLICAÇÃO
-- MANUAL PELO USUÁRIO (NÃO É UMA MIGRATION AUTOMATIZADA).
-- NENHUM COMANDO DESTE SCRIPT FOI EXECUTADO NO BANCO DE DADOS PELO AGENTE.
-- ============================================================================
-- CONTEXTO DE EXECUÇÃO:
-- O usuário já aplicou MANUALMENTE no banco:
--   1. Coluna public.core_usuarios.adiamento (boolean NOT NULL DEFAULT false)
--   2. Tabela public.task_solicitacoes_adiamento (com PK, FKs, CHECKs, UNIQUE em
--      chave_idempotencia, índices e RLS ENABLED com ZERO policies)
--
-- O QUE ESTE SCRIPT COMPLEMENTAR CONTÉM (EM UMA TRANSAÇÃO ATÔMICA):
--   1. POLICY DE SELECT PARA task_solicitacoes_adiamento:
--      Acesso de leitura restrito a: solicitante OU administrador da solicitação
--      OU administrador do sistema via task_is_admin().
--      NÃO são criadas policies de escrita (INSERT/UPDATE/DELETE) para authenticated,
--      pois as solicitações são gravadas exclusivamente via Edge Function autenticada
--      (service_role) e mantêm o acesso direto PostgREST restrito/bloqueado.
--   2. TRIGGER DE PROTEÇÃO DE core_usuarios.adiamento:
--      Trigger BEFORE UPDATE OF adiamento impedindo qualquer alteração direta
--      ou autoedição via app Ricci Task. Apenas Administrador do Gestor de
--      Acessos Ricci (core_is_gestor_acesso_admin() = true) ou service_role/postgres
--      podem alterar a permissão.
--   3. CONSTRAINT TRIGGERS DEFERRADOS ANTI-BYPASS DA REGRA DE DATAS:
--      - task_providencias: AFTER INSERT OR UPDATE OF prazo_conclusao, tarefa_id, deleted_at, data_conclusao
--        DEFERRABLE INITIALLY DEFERRED.
--        Garante que prazo_conclusao da providência <= prazo_conclusao do caso.
--        Validação roda no COMMIT contra o estado final da transação, evitando que
--        a ordem intermediária dos UPDATEs (na RPC ou escrita direta) rejeite um estado
--        final válido (ex.: ampliar prazo do caso e de providência juntos).
--        Pula validação quando não há mudança de prazo, tarefa ou situação de exclusão.
--        Conclusão NULL no caso permite qualquer data; igualdade permitida.
--        Ignora providências excluídas (deleted_at IS NOT NULL) ou com data_conclusao preenchida.
--      - task_tarefas: AFTER UPDATE OF prazo_conclusao DEFERRABLE INITIALLY DEFERRED.
--        Ao reduzir/alterar o prazo do caso, verifica todas as providências ativas
--        (deleted_at IS NULL e data_conclusao IS NULL) contra o novo prazo no COMMIT.
--      - Com INITIALLY DEFERRED, se houver violação no COMMIT, uma exceção é lançada
--        provocando rollback integral da transação e preservando atomicidade total.
--   4. RPC task_salvar_controle_transacional CORRIGIDA:
--      - Validação antecipada movida estritamente para o ramo CRIACAO.
--      - Na EDICAO, validação do loop condicionada a: v_operacao = 'CRIACAO' OR
--        (v_operacao = 'EDICAO' AND v_tarefa.prazo_conclusao IS DISTINCT FROM v_prazo_conclusao::date).
--      - Validação de prazo reduzido do caso preservada (com verificação se a providência
--        em conflito já está sendo corrigida no mesmo payload).
--      - Ordem transacional preservada: UPDATE do caso ocorre com sucesso antes de triggers
--        que consultem o novo prazo; RPC possui controle FOR UPDATE e rollback integral.
--      - Preserva 100% dos escopos (GESTOR estrito a responsável/executor central,
--        sem subordinados nem fallback legado), auditoria, eventos e contratos.
--   5. Verificações prévias e posteriores somente leitura (DO $$ ... RAISE NOTICE).
--   6. Rollback completo comentado ao final.
-- ============================================================================


-- ============================================================================
-- VERIFICAÇÕES PRÉVIAS (SOMENTE LEITURA — ANTES DE EXECUTAR O BLOCO DA TRANSAÇÃO)
-- ============================================================================
/*
-- Execute estas consultas antes de rodar o bloco BEGIN; ... COMMIT; para conferir
-- que a estrutura básica necessária já existe no banco:

DO $$
BEGIN
  -- 1. Conferir coluna core_usuarios.adiamento
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_usuarios' AND column_name = 'adiamento'
  ) THEN
    RAISE EXCEPTION 'Pré-requisito ausente: coluna core_usuarios.adiamento não existe.';
  END IF;

  -- 2. Conferir tabela task_solicitacoes_adiamento
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'task_solicitacoes_adiamento'
  ) THEN
    RAISE EXCEPTION 'Pré-requisito ausente: tabela task_solicitacoes_adiamento não existe.';
  END IF;

  -- 3. Conferir constraint UNIQUE em chave_idempotencia
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.task_solicitacoes_adiamento'::regclass
      AND contype = 'u'
      AND conname LIKE '%chave_idempotencia%'
  ) THEN
    RAISE EXCEPTION 'Pré-requisito ausente: constraint UNIQUE em chave_idempotencia não encontrada.';
  END IF;

  -- 4. Conferir funções auxiliares requeridas
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'task_current_core_user_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'task_is_admin'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'core_is_gestor_acesso_admin'
  ) THEN
    RAISE EXCEPTION 'Pré-requisito ausente: uma das funções auxiliares (task_current_core_user_id, task_is_admin, core_is_gestor_acesso_admin) não existe.';
  END IF;

  RAISE NOTICE 'Todas as verificações prévias foram satisfeitas. Pronto para aplicar o script complementar.';
END $$;
*/


-- ============================================================================
-- INÍCIO DA TRANSAÇÃO COMPLEMENTAR
-- ============================================================================
BEGIN;

-- ============================================================================
-- PARTE 1: RLS POLICY DE SELECT PARA public.task_solicitacoes_adiamento
-- ============================================================================
-- A tabela já possui ROW LEVEL SECURITY ENABLED e zero policies.
-- Conforme especificação:
--   - Criar APENAS a policy de SELECT restrita.
--   - NÃO criar policies de INSERT, UPDATE ou DELETE para authenticated.
--     Toda a inserção de solicitações é orquestrada pela Edge Function autenticada
--     ('solicitacao-adiamento') que roda com service_role e valida as regras de negócio
--     e elegibilidade no servidor.
--   - Não adicionar grants novos.
--
-- Regra da Policy de Leitura (SELECT):
-- Permite leitura se o usuário autenticado for:
--   (a) O próprio solicitante (solicitante_core_usuario_id = task_current_core_user_id());
--   (b) O administrador destinatário da solicitação (administrador_core_usuario_id = task_current_core_user_id());
--   (c) Um administrador geral do sistema (task_is_admin() = true).

DROP POLICY IF EXISTS "task_solicitacoes_adiamento_select_policy" ON public.task_solicitacoes_adiamento;
CREATE POLICY "task_solicitacoes_adiamento_select_policy"
  ON public.task_solicitacoes_adiamento
  FOR SELECT
  TO authenticated
  USING (
    task_is_admin()
    OR solicitante_core_usuario_id = task_current_core_user_id()
    OR administrador_core_usuario_id = task_current_core_user_id()
  );

COMMENT ON POLICY "task_solicitacoes_adiamento_select_policy" ON public.task_solicitacoes_adiamento IS
  'Permite leitura de solicitações de adiamento apenas ao solicitante, ao administrador destinatário ou aos administradores do sistema. Escrita direta por authenticated permanece bloqueada.';


-- ============================================================================
-- PARTE 2: PROTEÇÃO SERVER-SIDE DE core_usuarios.adiamento
-- ============================================================================
-- A permissão de adiamento é administrada EXCLUSIVAMENTE pelo Gestor de Acessos Ricci.
-- Usuários comuns, operações de autoedição pelo Ricci Task ou requisições PostgREST
-- não autorizadas são sumariamente bloqueadas.

CREATE OR REPLACE FUNCTION public.core_usuarios_proteger_coluna_adiamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Se o valor da coluna 'adiamento' estiver sendo alterado
  IF OLD.adiamento IS DISTINCT FROM NEW.adiamento THEN
    -- Permite se a role da sessão for postgres / service_role
    IF current_user IN ('postgres', 'service_role') THEN
      RETURN NEW;
    END IF;

    -- Permite se o usuário autenticado for Administrador no sistema GESTOR_ACESSO
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
-- PARTE 3: CONSTRAINT TRIGGERS DEFERRADOS ANTI-BYPASS DA REGRA DE DATAS
-- ============================================================================
-- REGRA DE NEGÓCIO:
-- "A data da providência não pode ser maior que a data de conclusão do caso (prazo_conclusao)."
-- Convenção:
-- - task_providencias.prazo_conclusao (DATE NOT NULL)
-- - task_tarefas.prazo_conclusao (DATE nullable)
-- - Comparação estrita de calendário: providência <= caso.
-- - Igualdade é estritamente PERMITIDA.
-- - Caso com prazo NULL não impõe limite superior pela regra.
-- - Providências soft-deleted (deleted_at IS NOT NULL) ou já concluídas
--   (data_conclusao IS NOT NULL) não impedem alteração de datas.
-- - Pula validação quando não há mudança relevante de dados.
--
-- DESENHO DEFERRADO (DEFERRABLE INITIALLY DEFERRED):
-- - Por que AFTER e DEFERRABLE:
--   A RPC task_salvar_controle_transacional (e processos transacionais similares)
--   na EDICAO grava as providências PRIMEIRO e só depois faz UPDATE do caso.
--   Se os triggers fossem BEFORE imediatos, a gravação de uma providência com prazo
--   estendido (ex. 29/10) dispararia antes do UPDATE do caso (ainda em 30/09),
--   rejeitando um estado final perfeitamente válido (caso que seria atualizado para 30/10).
--   Com CONSTRAINT TRIGGER ... AFTER ... DEFERRABLE INITIALLY DEFERRED, a checagem
--   é postergada para o COMMIT da transação, quando o caso e as providências já
--   estão em seus estados FINAIS.
-- - Se no COMMIT o estado final violar a regra de datas, o trigger lança exceção
--   provocando ROLLBACK integral da transação, preservando atomicidade e impedindo contornos.
-- - Constraint triggers só aceitam timing AFTER e operam FOR EACH ROW.
-- - O valor de retorno em triggers AFTER FOR EACH ROW é ignorado pelo PostgreSQL
--   (RETURN NEW é mantido por padronização da linguagem PL/pgSQL).

-- ----------------------------------------------------------------------------
-- 3.1 Constraint Trigger Deferrado em task_providencias
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

  -- Se a providência já estiver concluída (data_conclusao preenchida), não bloqueia
  IF NEW.data_conclusao IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Se for UPDATE e não alterou o prazo nem a tarefa nem a situação de exclusão, pula
  -- (só valida quando prazo, caso ou situação de exclusão mudarem — restauração de excluída continua validada)
  IF TG_OP = 'UPDATE'
     AND OLD.prazo_conclusao = NEW.prazo_conclusao
     AND OLD.tarefa_id = NEW.tarefa_id
     AND OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    RETURN NEW;
  END IF;

  -- Busca o prazo_conclusao do caso correspondente (no estado corrente da transação / commit)
  SELECT prazo_conclusao, deleted_at, identificacao_caso, numero_caso
  INTO v_caso_prazo, v_caso_deleted, v_caso_identificacao, v_caso_numero
  FROM public.task_tarefas
  WHERE id = NEW.tarefa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso vinculado (ID %) não foi localizado.', NEW.tarefa_id
      USING ERRCODE = '23503';
  END IF;

  -- Se o caso tiver prazo_conclusao definido, a providência ativa NÃO pode ultrapassá-lo
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
CREATE CONSTRAINT TRIGGER trg_task_providencias_validar_data_limite
  AFTER INSERT OR UPDATE OF prazo_conclusao, tarefa_id, deleted_at, data_conclusao ON public.task_providencias
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.task_providencias_validar_data_limite_caso();

COMMENT ON TRIGGER trg_task_providencias_validar_data_limite ON public.task_providencias IS
  'Garante no COMMIT (deferrado) que o prazo de conclusão da providência não ultrapasse o prazo de conclusão do caso associado.';


-- ----------------------------------------------------------------------------
-- 3.2 Constraint Trigger Deferrado em task_tarefas (ao alterar/reduzir prazo_conclusao do caso)
-- ----------------------------------------------------------------------------
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
    -- Se o prazo_conclusao anterior era idêntico ao novo, pula validação
    IF TG_OP = 'UPDATE' AND OLD.prazo_conclusao IS NOT DISTINCT FROM NEW.prazo_conclusao THEN
      RETURN NEW;
    END IF;

    -- Localiza a providência ativa (não excluída e não concluída) que excede o novo prazo
    SELECT id, providencia, prazo_conclusao
    INTO v_prov_invalida
    FROM public.task_providencias
    WHERE tarefa_id = NEW.id
      AND deleted_at IS NULL
      AND data_conclusao IS NULL
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
CREATE CONSTRAINT TRIGGER trg_task_tarefas_validar_providencias_prazo
  AFTER UPDATE OF prazo_conclusao ON public.task_tarefas
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.task_tarefas_validar_providencias_ao_alterar_prazo();

COMMENT ON TRIGGER trg_task_tarefas_validar_providencias_prazo ON public.task_tarefas IS
  'Impede no COMMIT (deferrado) redução ou alteração do prazo de conclusão do caso se houver providências ativas com data posterior à nova conclusão.';


-- ============================================================================
-- PARTE 4: RPC task_salvar_controle_transacional CORRIGIDA
-- ============================================================================
-- CORREÇÕES IMPLEMENTADAS EM RELAÇÃO AO DOC ANTERIOR:
-- 1. A validação antecipada das providências do payload foi movida estritamente
--    para dentro do ramo CRIACAO (onde todas as novas providências devem respeitar o prazo do caso).
-- 2. Na validação do loop de providências (item 4 da RPC), a validação contra o
--    prazo do caso é condicionada a:
--      v_operacao = 'CRIACAO' OR
--      (v_operacao = 'EDICAO' AND v_tarefa.prazo_conclusao IS DISTINCT FROM v_prazo_conclusao::date)
--    Dessa forma, edições de casos onde o prazo do caso não mudou não são bloqueadas
--    por providências pré-existentes, evitando bloquear dados históricos sem alteração de prazos.
-- 3. A validação de prazo reduzido do caso na EDICAO (verificando providências
--    no banco que excedam o novo prazo e que não estejam ajustadas no payload)
--    permanece ativa e segura.
-- 4. Preserva 100% dos escopos vigentes no banco (GESTOR restrito a responsável/executor,
--    sem subordinados nem fallback legado), auditoria da transição, eventos de
--    providências, atomicidade e concorrência segura (FOR UPDATE).

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

  -- 3. PROCESSAMENTO CONFORME O MODO
  IF v_operacao = 'CRIACAO' THEN
    -- =========================================================================
    -- MODO CRIACAO: SEM NENHUM ACESSO A v_tarefa
    -- =========================================================================

    -- VALIDAÇÃO ANTECIPADA DA REGRA DE DATAS (RAMO CRIACAO):
    -- Se o caso criado tiver prazo_conclusao definido, nenhuma providência enviada
    -- no payload de criação pode exceder essa data (comparação em DATE, igualdade permitida).
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

    -- Inserção do novo caso (numeração gerada via trigger trg_task_definir_numero_caso)
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
      -- Escopo estrito GESTOR: apenas casos próprios (responsável ou executor)
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
        AND data_conclusao IS NULL
        AND prazo_conclusao > v_prazo_conclusao::date
      ORDER BY prazo_conclusao DESC
      LIMIT 1;

      IF FOUND THEN
        -- Verifica se essa providência em conflito está sendo corrigida no payload
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

      -- Validação de limite contra o prazo do caso:
      -- Na CRIACAO, valida sempre se o prazo do caso estiver preenchido.
      -- Na EDICAO, valida apenas se o prazo do caso foi alterado/definido ou se a operação for de criação.
      -- Se a providência já estiver concluída (v_prov_data_conclusao NOT NULL), não bloqueia.
      IF v_prov_data_conclusao IS NULL AND v_prazo_conclusao IS NOT NULL THEN
        IF (v_operacao = 'CRIACAO') OR
           (v_operacao = 'EDICAO' AND v_tarefa.prazo_conclusao IS DISTINCT FROM v_prazo_conclusao::date) THEN
          IF (v_prov_prazo::date > v_prazo_conclusao::date) THEN
            RAISE EXCEPTION 'A data da providência "%" (%) não pode ser maior que a data de conclusão do caso (%).',
              v_prov_desc,
              to_char(v_prov_prazo::date, 'DD/MM/YYYY'),
              to_char(v_prazo_conclusao::date, 'DD/MM/YYYY')
              USING ERRCODE = '23514';
          END IF;
        END IF;
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
    -- Escopo estrito GESTOR: apenas casos próprios (responsável ou executor)
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
-- VERIFICAÇÕES PÓS-COMMIT (SOMENTE LEITURA — APÓS APLICAR O SCRIPT)
-- ============================================================================
/*
-- Execute estas consultas após o COMMIT para validar a aplicação:

SELECT polname, polcmd, polroles, polqual
FROM pg_policy
WHERE polrelid = 'public.task_solicitacoes_adiamento'::regclass;
-- Esperado: 1 policy (task_solicitacoes_adiamento_select_policy) para cmd 'r' (SELECT)

SELECT tgname, tgenabled, tgtype, tgqual
FROM pg_trigger
WHERE tgrelid = 'public.core_usuarios'::regclass
  AND tgname = 'trg_core_usuarios_proteger_adiamento';
-- Esperado: trigger ativo

-- Validação dos CONSTRAINT TRIGGERS deferrados em pg_trigger e pg_constraint:
SELECT
  tg.tgname,
  tg.tgenabled,
  tg.tgdeferrable,
  tg.tginitdeferred,
  c.conname,
  c.contype,
  c.condeferrable,
  c.condeferred
FROM pg_trigger tg
LEFT JOIN pg_constraint c ON c.oid = tg.tgconstraint
WHERE tg.tgrelid = 'public.task_providencias'::regclass
  AND tg.tgname = 'trg_task_providencias_validar_data_limite';
-- Esperado: tgdeferrable = true, tginitdeferred = true, contype = 't' (trigger constraint), condeferrable = true, condeferred = true

SELECT
  tg.tgname,
  tg.tgenabled,
  tg.tgdeferrable,
  tg.tginitdeferred,
  c.conname,
  c.contype,
  c.condeferrable,
  c.condeferred
FROM pg_trigger tg
LEFT JOIN pg_constraint c ON c.oid = tg.tgconstraint
WHERE tg.tgrelid = 'public.task_tarefas'::regclass
  AND tg.tgname = 'trg_task_tarefas_validar_providencias_prazo';
-- Esperado: tgdeferrable = true, tginitdeferred = true, contype = 't' (trigger constraint), condeferrable = true, condeferred = true

SELECT proname, prorettype::regtype, prosrc
FROM pg_proc
WHERE proname = 'task_salvar_controle_transacional';
-- Esperado: função atualizada com retorno jsonb
*/


-- ============================================================================
-- SCRIPT DE ROLLBACK COMPLETO (PRESERVA DADOS E HISTÓRICO EXISTENTES)
-- ============================================================================
/*
Para reverter as alterações deste script sem perda de dados:

ATENÇÃO — ANTES DE EXECUTAR O SCRIPT PRINCIPAL:
Recomenda-se extrair e salvar o código da RPC atual no banco com:
  SELECT pg_get_functiondef('public.task_salvar_controle_transacional(uuid,jsonb,jsonb,text)'::regprocedure);
Dessa forma, caso seja necessário o rollback da RPC, ela poderá ser restaurada
para a versão exata que estava publicada anteriormente.

BEGIN;

-- 1. Remove os triggers anti-bypass de validação de datas
DROP TRIGGER IF EXISTS trg_task_providencias_validar_data_limite ON public.task_providencias;
DROP FUNCTION IF EXISTS public.task_providencias_validar_data_limite_caso();

DROP TRIGGER IF EXISTS trg_task_tarefas_validar_providencias_prazo ON public.task_tarefas;
DROP FUNCTION IF EXISTS public.task_tarefas_validar_providencias_ao_alterar_prazo();

-- 2. Remove o trigger de proteção da coluna adiamento
DROP TRIGGER IF EXISTS trg_core_usuarios_proteger_adiamento ON public.core_usuarios;
DROP FUNCTION IF EXISTS public.core_usuarios_proteger_coluna_adiamento();

-- 3. Remove a policy de SELECT de task_solicitacoes_adiamento
DROP POLICY IF EXISTS "task_solicitacoes_adiamento_select_policy" ON public.task_solicitacoes_adiamento;

-- 4. Reverter a RPC task_salvar_controle_transacional para a versão anterior:
-- Reaplicar o fonte salvo pelo pg_get_functiondef indicado acima.
-- (A versão imediatamente anterior já contemplava escopos GESTOR sem validação de datas).

COMMIT;
*/
