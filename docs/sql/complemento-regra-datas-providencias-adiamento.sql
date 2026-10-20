-- ============================================================================
-- SQL COMPLEMENTAR: REGRA DE DATAS (PROVIDÊNCIA <= CONCLUSÃO DO CASO)
-- E POLÍTICAS / TRIGGERS DE SEGURANÇA
-- SISTEMA: RICCI TASK
-- ARQUIVO: docs/sql/complemento-regra-datas-providencias-adiamento.sql
-- VERSÃO: 0.0.112 (REVISÃO DE ESTADO FINAL PERSISTIDO, DATAS E FLAG ADIAMENTO)
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
--      O uso de task_email_eventos (`event_key = 'adiamento:{id}'`) é comprovadamente
--      isento de colisão com eventos de atribuição (`atribuicao:...`, `providencia_inclusao:...`,
--      `providencia_atualizacao:...`) ou atraso (`providencia_atraso:...`).
--   2. TRIGGER DE PROTEÇÃO DE core_usuarios.adiamento (INSERT e UPDATE):
--      Trigger BEFORE INSERT OR UPDATE OF adiamento impedindo qualquer alteração direta,
--      autoedição via app Ricci Task ou bypass via RPCs SECURITY DEFINER genéricas.
--      Não confia apenas em current_user (que em SECURITY DEFINER se torna o owner).
--      Identifica o chamador REAL através da role da sessão/PostgREST (`session_user`,
--      claims JWT `request.jwt.claims` -> role) e valida que apenas chamadas genuínas
--      de service_role ou o Administrador do Gestor de Acessos Ricci legítimo
--      (core_is_gestor_acesso_admin() = true) possam conceder `adiamento = true`.
--   3. CONSTRAINT TRIGGERS DEFERRADOS ANTI-BYPASS DA REGRA DE DATAS:
--      - NÃO dispensa providências concluídas (data_conclusao preenchida ou status finalizador).
--        Conforme regra de negócio estrita: providência concluída NÃO está dispensada da
--        regra de datas. Apenas providências logicamente excluídas (deleted_at IS NOT NULL) são ignoradas.
--        Alterar status ou preencher data_conclusao não serve de contorno para violar o prazo.
--      - Re-leitura do estado final persistido da linha no momento da checagem do trigger
--        (SELECT por PK), validando o resultado persistido atual em vez de somente a imagem NEW
--        de uma operação intermediária.
--      - Preserva alterações conjuntas válidas, múltiplos UPDATEs da mesma linha na mesma
--        transação e serialização de transações concorrentes via row locks.
--      - task_providencias: AFTER INSERT OR UPDATE OF prazo_conclusao, tarefa_id, deleted_at, data_conclusao, status_id
--        DEFERRABLE INITIALLY DEFERRED.
--      - task_tarefas: AFTER UPDATE OF prazo_conclusao DEFERRABLE INITIALLY DEFERRED.
--   4. RPC task_salvar_controle_transacional CORRIGIDA:
--      - Validação antecipada estritamente no ramo CRIACAO.
--      - No loop de providências da EDICAO, valida contra o prazo do caso quando:
--        v_operacao = 'CRIACAO' OR (v_operacao = 'EDICAO' AND v_tarefa.prazo_conclusao IS DISTINCT FROM v_prazo_conclusao::date).
--      - Sem dispensa para providências concluídas (data_conclusao preenchida continua validada).
--      - Preserva 100% dos escopos (GESTOR estrito a responsável/executor central,
--        sem subordinados nem fallback legado), auditoria, eventos e contratos.
--   5. Verificações prévias e posteriores somente leitura comentadas (DO $$ ... RAISE NOTICE).
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
-- PARTE 2: PROTEÇÃO SERVER-SIDE DE core_usuarios.adiamento (INSERT E UPDATE)
-- ============================================================================
-- A permissão de adiamento é administrada EXCLUSIVAMENTE pelo Gestor de Acessos Ricci.
-- Usuários comuns, operações de autoedição pelo Ricci Task, requisições PostgREST
-- diretas ou chamadas via RPCs SECURITY DEFINER genéricas (onde current_user = postgres)
-- são sumariamente bloqueadas.
--
-- ANÁLISE DE SEGURANÇA SOBRE current_user vs. session_user vs. JWT Claims:
-- - Em funções PostgreSQL com declaração SECURITY DEFINER, `current_user` assume a
--   identidade do dono da função (geralmente 'postgres' ou o superusuário do banco).
--   Portanto, confiar somente em `current_user IN ('postgres', 'service_role')` abre brecha
--   crítica: qualquer RPC SECURITY DEFINER existente ou futura que realize INSERT/UPDATE
--   em core_usuarios (mesmo sem autorização de Gestor de Acessos) teria bypass automático!
-- - Por outro lado, `session_user` mantém o usuário inicial da conexão física/pool do Postgres.
-- - No ambiente Supabase/PostgREST, o chamador real e seu perfil são propagados pelo PostgREST
--   através do JWT na configuração de sessão: `current_setting('request.jwt.claims', true)`.
--   O papel (role) do token PostgREST é extraído de:
--     coalesce(current_setting('request.jwt.claim.role', true),
--              (current_setting('request.jwt.claims', true)::jsonb->>'role'))
--   Quando o PostgREST executa uma requisição com a chave de serviço (service_role),
--   a claim 'role' é estritamente 'service_role'.
-- - Quando uma requisição autenticada de usuário final chama uma RPC (mesmo SECURITY DEFINER),
--   a claim 'role' é 'authenticated' e `auth.uid()` identifica o chamador humano.
-- - Para conexões administrativas puras diretas (ex.: psql, scripts de migração pelo console
--   onde não há requisição HTTP/PostgREST e portanto request.jwt.claims é NULL),
--   `session_user IN ('postgres', 'supabase_admin')` garante a execução legítima de DDL/scripts.
--
-- REGRAS DA ALLOWLIST (ESTRITA):
-- 1. No INSERT: se NEW.adiamento = true, o chamador DEVE ser service_role genuíno,
--    administrador do console (session_user postgres/supabase_admin sem JWT) ou
--    um Gestor de Acesso Admin corporativo legítimo (core_is_gestor_acesso_admin() = true).
--    Criação com o valor padrão (false) ou NULL é sempre permitida.
-- 2. No UPDATE: se o valor de `adiamento` estiver sofrendo alteração real
--    (OLD.adiamento IS DISTINCT FROM NEW.adiamento), a alteração só passa se o chamador
--    for service_role genuíno, administrador do console ou core_is_gestor_acesso_admin().

CREATE OR REPLACE FUNCTION public.core_usuarios_proteger_coluna_adiamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_claims_raw TEXT;
  v_jwt_claims JSONB;
  v_jwt_role TEXT;
  v_eh_service_role BOOLEAN := false;
  v_eh_admin_gestor BOOLEAN := false;
  v_eh_conexao_direta_admin BOOLEAN := false;
BEGIN
  -- Se for INSERT e adiamento for false (ou null), não está tentando elevar privilégio: permite
  IF TG_OP = 'INSERT' AND COALESCE(NEW.adiamento, false) = false THEN
    NEW.adiamento := false;
    RETURN NEW;
  END IF;

  -- Se for UPDATE e não alterou o valor de adiamento: permite
  IF TG_OP = 'UPDATE' AND (OLD.adiamento IS NOT DISTINCT FROM NEW.adiamento) THEN
    RETURN NEW;
  END IF;

  -- A partir deste ponto: está tentando criar com adiamento = true OU alterar o valor em UPDATE.
  -- Exige autorização estrita da allowlist.

  -- 1. Extração segura da role contida no JWT da requisição PostgREST/Supabase
  BEGIN
    v_jwt_claims_raw := current_setting('request.jwt.claims', true);
    IF v_jwt_claims_raw IS NOT NULL AND v_jwt_claims_raw <> '' THEN
      v_jwt_claims := v_jwt_claims_raw::jsonb;
      v_jwt_role := v_jwt_claims->>'role';
    ELSE
      -- Fallback para setting direto exposto por algumas versões do PostgREST
      v_jwt_role := current_setting('request.jwt.claim.role', true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- 2. Identifica se a chamada é de infraestrutura via service_role autenticada
  IF v_jwt_role = 'service_role' THEN
    v_eh_service_role := true;
  END IF;

  -- 3. Identifica se é conexão direta de administração (psql/console sem camada PostgREST/JWT)
  -- Importante: checa session_user (usuário físico da conexão), e NÃO current_user (que poderia
  -- ser assumido por funções SECURITY DEFINER de chamadores autenticados normais).
  IF v_jwt_role IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN
    v_eh_conexao_direta_admin := true;
  END IF;

  -- 4. Identifica se o chamador autenticado é Gestor de Acessos Admin legítimo
  -- A função core_is_gestor_acesso_admin() consulta auth.uid() contra core_usuario_sistemas
  -- no sistema 'GESTOR_ACESSO' com perfil 'ADMINISTRADOR'.
  IF auth.uid() IS NOT NULL THEN
    v_eh_admin_gestor := public.core_is_gestor_acesso_admin();
  END IF;

  -- 5. Avaliação da Allowlist:
  IF v_eh_service_role OR v_eh_conexao_direta_admin OR v_eh_admin_gestor THEN
    RETURN NEW;
  END IF;

  -- Caso contrário: bloqueio sumário com exceção 42501 (insufficient_privilege)
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Criação indevida bloqueada: a concessão da permissão de adiamento (core_usuarios.adiamento = true) na criação de usuários só é permitida ao Administrador do Gestor de Acessos Ricci ou via serviço corporativo autorizado.'
      USING ERRCODE = '42501';
  ELSE
    RAISE EXCEPTION 'Alteração indevida bloqueada: a permissão de adiamento (core_usuarios.adiamento) só pode ser modificada pelo Gestor de Acessos Ricci por um Administrador autorizado.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_core_usuarios_proteger_adiamento ON public.core_usuarios;
CREATE TRIGGER trg_core_usuarios_proteger_adiamento
  BEFORE INSERT OR UPDATE OF adiamento ON public.core_usuarios
  FOR EACH ROW
  EXECUTE FUNCTION public.core_usuarios_proteger_coluna_adiamento();

COMMENT ON TRIGGER trg_core_usuarios_proteger_adiamento ON public.core_usuarios IS
  'Impede criação ou alteração indevida da flag adiamento por APIs, usuários do Ricci Task ou RPCs SECURITY DEFINER genéricas, restringindo-a ao Gestor de Acessos Ricci e service_role.';


-- ============================================================================
-- PARTE 3: CONSTRAINT TRIGGERS DEFERRADOS ANTI-BYPASS DA REGRA DE DATAS
-- ============================================================================
-- REGRA DE NEGÓCIO:
-- "A data da providência não pode ser maior que a data de conclusão do caso (prazo_conclusao)."
-- Convenção de campos:
-- - task_providencias.prazo_conclusao (DATE NOT NULL)
-- - task_tarefas.prazo_conclusao (DATE nullable)
-- - Comparação estrita de calendário: providência <= caso.
-- - Igualdade é estritamente PERMITIDA.
-- - Caso com prazo NULL não impõe limite superior pela regra.
-- - Providência concluída NÃO ESTÁ DISPENSADA da regra de datas:
--   preencher `data_conclusao` ou alterar status para finalizador NÃO serves de contorno.
-- - Apenas providências logicamente excluídas (deleted_at IS NOT NULL) são ignoradas.
-- - Inconsistências históricas sem alteração relevante continuam preservadas (pula validação),
--   mas qualquer alteração de prazo_conclusao, tarefa_id, deleted_at (restauração),
--   data_conclusao ou status_id dispara e valida a linha contra o prazo do caso.
--
-- ARQUITETURA DE CONSTRAINT TRIGGERS DEFERRADOS E ESTADO FINAL PERSISTIDO:
-- 1. Por que AFTER e DEFERRABLE INITIALLY DEFERRED:
--    - Operações transacionais (como a RPC `task_salvar_controle_transacional` ou requisições
--      PostgREST em transação) gravam providências e o caso em ordens variadas (ex.: amplia o
--      prazo do caso para 30/10 e ajusta a providência para 29/10). Se a validação fosse BEFORE
--      imediata, uma providência salva antes da atualização do caso dispararia um erro
--      prematuro contra o prazo antigo (30/09), inviabilizando alterações conjuntas válidas.
--    - Com `DEFERRABLE INITIALLY DEFERRED`, os triggers row-level têm seus eventos enfileirados
--      para avaliação no momento do COMMIT da transação.
--
-- 2. Problema dos eventos enfileirados e Consulta do Estado Final Persistido:
--    - No PostgreSQL, constraint triggers row-level disparam UMA VEZ POR OPERAÇÃO enfileirada.
--    - A variável NEW contém a imagem da linha NAQUELE MOMENTO em que o comando ocorreu.
--    - Se uma linha sofre múltiplos UPDATEs na mesma transação (ex.: etapa 1 seta data temporária;
--      etapa 2 na mesma transação define o valor final correto), múltiplos eventos do trigger
--      são enfileirados.
--    - Se o trigger validasse estritamente NEW, o primeiro evento (intermediário) abortaria
--      indevidamente uma transação cujo resultado final é 100% válido!
--    - SOLUÇÃO: A função do trigger consulta o ESTADO ATUAL PERSISTIDO DA LINHA NA TABELA
--      (via `SELECT ... WHERE id = NEW.id`), em vez de validar cegamente a imagem estática de NEW.
--      Se a linha foi excluída (hard delete) ou marcada como soft-deleted (deleted_at IS NOT NULL),
--      não há violação. Se o estado persistido atual na transação satisfaz a regra (prazo <= caso),
--      o trigger passa com sucesso, aceitando operações conjuntas e múltiplos updates.
--
-- 3. Concorrência e Bloqueios (Locking & Serialização):
--    - Bloqueios na RPC: `task_salvar_controle_transacional` executa `SELECT ... FROM task_tarefas WHERE id = ... FOR UPDATE`
--      adquirindo lock exclusivo de linha (RowExclusive / Exclusive tuple lock) sobre o caso, e
--      `SELECT ... FROM task_providencias WHERE id = ... FOR UPDATE` sobre as providências existentes.
--    - Bloqueios em escrita direta: Qualquer INSERT ou UPDATE adquire automaticamente row lock exclusivo
--      nas tuplas modificadas até o encerramento da transação (COMMIT ou ROLLBACK).
--    - Serialização com triggers DEFERRED: Transações concorrentes que tentem modificar o prazo
--      do mesmo caso e/ou de suas providências são serializadas nos locks de linha do PostgreSQL.
--      A segunda transação aguarda o COMMIT da primeira. Quando a segunda prossegue, seus triggers
--      DEFERRED consultam o estado commitado atualizado pela primeira transação, impedindo
--      qualquer inconsistência de corrida (race condition).
--    - Ordem de aquisição e Prevenção de Deadlock:
--      A ordem canônica recomendada é sempre bloquear/atualizar o CASO (pai) antes das PROVIDÊNCIAS
--      (filhas), ou ordenar o acesso às providências por chave primária (id ASC). A RPC mantém
--      o lock FOR UPDATE no caso no início da transação antes de iterar pelas providências,
--      garantindo que nenhuma outra transação paralela dispute os registros em ordem inversa.

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
  v_prov_atual RECORD;
  v_caso_prazo DATE;
  v_caso_deleted TIMESTAMPTZ;
  v_caso_identificacao TEXT;
  v_caso_numero INT;
BEGIN
  -- 1. Re-leitura do estado final persistido da providência no momento do trigger.
  -- Se a linha foi fisicamente removida nesta transação, nada a validar.
  SELECT id, tarefa_id, prazo_conclusao, deleted_at, data_conclusao, status_id
  INTO v_prov_atual
  FROM public.task_providencias
  WHERE id = NEW.id;

  IF NOT FOUND THEN
    -- Linha foi removida fisicamente na transação; dispensa validação.
    RETURN NEW;
  END IF;

  -- 2. Se no estado persistido atual a providência estiver soft-deleted, não bloqueia
  IF v_prov_atual.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 3. Preservação de dados históricos sem alteração relevante:
  -- Se for UPDATE e o estado persistido atual não alterou prazo, caso, deleted_at,
  -- data_conclusao ou status em relação a OLD, pula a validação.
  -- (Garante que edições puramente administrativas de outros campos não bloqueiem histórico,
  -- mas qualquer tentativa de contorno via data_conclusao, status ou prazo força a checagem).
  IF TG_OP = 'UPDATE'
     AND v_prov_atual.prazo_conclusao = OLD.prazo_conclusao
     AND v_prov_atual.tarefa_id = OLD.tarefa_id
     AND v_prov_atual.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND v_prov_atual.data_conclusao IS NOT DISTINCT FROM OLD.data_conclusao
     AND v_prov_atual.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;

  -- 4. Busca o estado final persistido do caso vinculado
  SELECT prazo_conclusao, deleted_at, identificacao_caso, numero_caso
  INTO v_caso_prazo, v_caso_deleted, v_caso_identificacao, v_caso_numero
  FROM public.task_tarefas
  WHERE id = v_prov_atual.tarefa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso vinculado (ID %) não foi localizado.', v_prov_atual.tarefa_id
      USING ERRCODE = '23503';
  END IF;

  -- 5. Se o caso foi soft-deleted na transação, não bloqueia
  IF v_caso_deleted IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 6. Validação estrita da regra de datas contra o estado persistido:
  -- Providência concluída NÃO é dispensada da regra de datas.
  -- Se o caso tiver prazo_conclusao definido, o prazo_conclusao da providência NÃO pode ultrapassá-lo.
  -- (Igualdade é estritamente permitida: v_prov_atual.prazo_conclusao <= v_caso_prazo).
  IF v_caso_prazo IS NOT NULL THEN
    IF v_prov_atual.prazo_conclusao > v_caso_prazo THEN
      RAISE EXCEPTION 'A data da providência (%) não pode ser maior que a data de conclusão do caso (% - Caso #%: "%"). Providências concluídas também devem respeitar o limite de conclusão do caso.',
        to_char(v_prov_atual.prazo_conclusao, 'DD/MM/YYYY'),
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
  AFTER INSERT OR UPDATE OF prazo_conclusao, tarefa_id, deleted_at, data_conclusao, status_id ON public.task_providencias
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.task_providencias_validar_data_limite_caso();

COMMENT ON TRIGGER trg_task_providencias_validar_data_limite ON public.task_providencias IS
  'Garante no COMMIT (deferrado) que o prazo de conclusão da providência (mesmo concluída) não ultrapasse o prazo de conclusão final persistido do caso associado.';


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
  v_caso_atual RECORD;
  v_prov_invalida RECORD;
BEGIN
  -- 1. Re-leitura do estado final persistido do caso no momento do trigger.
  SELECT id, prazo_conclusao, deleted_at
  INTO v_caso_atual
  FROM public.task_tarefas
  WHERE id = NEW.id;

  IF NOT FOUND THEN
    -- Caso removido fisicamente; nada a validar
    RETURN NEW;
  END IF;

  -- 2. Se o caso estiver soft-deleted no estado persistido atual, não bloqueia
  IF v_caso_atual.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 3. Se no estado persistido final o prazo_conclusao for NULL, não impõe limite superior
  IF v_caso_atual.prazo_conclusao IS NULL THEN
    RETURN NEW;
  END IF;

  -- 4. Se for UPDATE e o prazo_conclusao final for idêntico ao OLD original, pula
  IF TG_OP = 'UPDATE' AND OLD.prazo_conclusao IS NOT DISTINCT FROM v_caso_atual.prazo_conclusao THEN
    RETURN NEW;
  END IF;

  -- 5. Localiza providência ativa (deleted_at IS NULL) que excede o prazo_conclusao final do caso.
  -- NOTA IMPORTANTE: Providências concluídas (data_conclusao IS NOT NULL) NÃO são ignoradas!
  -- Apenas providências com deleted_at IS NOT NULL são ignoradas.
  SELECT id, providencia, prazo_conclusao, data_conclusao
  INTO v_prov_invalida
  FROM public.task_providencias
  WHERE tarefa_id = v_caso_atual.id
    AND deleted_at IS NULL
    AND prazo_conclusao > v_caso_atual.prazo_conclusao
  ORDER BY prazo_conclusao DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'A conclusão do caso (%) não pode ser reduzida para uma data anterior ao prazo da providência "%" (%). Ajuste o prazo da providência primeiro ou solicite adiamento.',
      to_char(v_caso_atual.prazo_conclusao, 'DD/MM/YYYY'),
      v_prov_invalida.providencia,
      to_char(v_prov_invalida.prazo_conclusao, 'DD/MM/YYYY')
      USING ERRCODE = '23514'; -- check_violation
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
  'Impede no COMMIT (deferrado) redução do prazo de conclusão do caso se o estado final persistido contiver providências (inclusive concluídas) com data posterior à nova conclusão.';


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
    -- Valida se há providências ativas persistidas que excedem o novo prazo e que NÃO estão no payload.
    -- NOTA: Providências concluídas NÃO estão dispensadas da regra de datas.
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
      -- Na EDICAO, valida se o prazo do caso foi alterado/definido ou se a operação for de criação.
      -- Providência concluída NÃO está dispensada da regra de datas (data_conclusao preenchida continua validada).
      IF v_prazo_conclusao IS NOT NULL THEN
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
  AND tgname = 'trg_task_providencias_validar_data_limite';
-- Esperado: tgdeferrable = true, tginitdeferred = true, contype = 't' (trigger constraint), condeferrable = true, condeferred = true

-- Validação de isolamento do evento de adiamento em task_email_eventos (sem colisão com atribuição):
-- O padrão de chave para adiamento é 'adiamento:{solicitacao_id}', enquanto atribuições usam
-- 'atribuicao:{tarefa_id}:{stamp}:{exec}:{resp}', inclusões 'providencia_inclusao:{prov_id}',
-- atualizações 'providencia_atualizacao:{prov_id}:{stamp}' e atrasos 'providencia_atraso:{prov_id}:{data}'.
SELECT id, event_key, tipo_evento, status, created_at
FROM public.task_email_eventos
WHERE event_key LIKE 'adiamento:%'
LIMIT 5;
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
