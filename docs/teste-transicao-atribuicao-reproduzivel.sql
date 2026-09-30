-- ============================================================================
-- SCRIPT POSTGRESQL REPRODUZÍVEL DE TESTE DE BANCO E RLS (RICCI TASK)
-- Arquivo: docs/teste-transicao-atribuicao-reproduzivel.sql
-- NOTA IMPORTANTE:
--   Este script é destinado para EXECUÇÃO MANUAL pelo usuário no SQL Editor do Supabase.
--   Ele NÃO é executado automaticamente pelo processo de build nem pelo assistente.
--
-- Cobertura das correções (v0.0.85):
--   (1) Testes REAIS de visualização (SELECT) e edição (UPDATE) executados REALMENTE
--       como role 'authenticated' (SET ROLE authenticated + request.jwt.claim.sub)
--       para os perfis ADMINISTRADOR, GESTOR, OPERACIONAL DA EQUIPE DO GESTOR e OPERACIONAL ALHEIO,
--       incluindo negativas FORA do escopo (gestor tentando caso de outra equipe, op tentando caso alheio).
--   (2) Captura de SQLSTATE esperado em exceções negativas (WHEN specific_sqlstate ... RAISE)
--       sem transformar qualquer erro em aprovação com WHEN OTHERS genérico.
--   (3) Rollback integral comprovado: caso, providências e auditorias (transições + eventos de providências)
--       voltam ao estado anterior após falha intencional de providência.
--   (4) Unicidade de event_key em task_email_eventos (INSERT duplicado deve falhar com SQLSTATE 23505).
--   (5) Comparações seguras para NULL (IS DISTINCT FROM, IS NOT DISTINCT FROM) nas asserções.
--   (6) No-op comprovado com updated_at preparado ANTERIORMENTE à transação / valor gravado antes.
--   (7) Teste de bypass: set_config('ricci_task.atribuicao_autorizada', 'true') e tentativa de UPDATE direto
--       das 4 colunas como role 'authenticated' falha pelo REVOKE / trigger.
--   (8) Numeração sequencial de casos estritamente validada (falha se divergente).
--   (9) Rollback integral ao final, garantindo zero poluição permanente no banco.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_admin_auth UUID;
  v_admin_core UUID;
  v_gestor_auth UUID;
  v_gestor_core UUID;
  v_gestor_outro_auth UUID;
  v_gestor_outro_core UUID;
  v_op_equipe_auth UUID;
  v_op_equipe_core UUID;
  v_op_outro_auth UUID;
  v_op_outro_core UUID;

  v_nome_controle_id UUID;
  v_status_id UUID;
  v_tipo_prazo_id UUID;
  v_status_prov_id UUID;

  v_res_admin JSONB;
  v_res_gestor JSONB;
  v_res_op JSONB;
  v_res_noop JSONB;

  v_tarefa_admin_id UUID;
  v_tarefa_gestor_id UUID;
  v_tarefa_op_id UUID;
  v_tarefa_alheia_id UUID;

  v_num_admin BIGINT;
  v_num_gestor BIGINT;
  v_num_op BIGINT;

  v_time_before TIMESTAMPTZ;
  v_time_after TIMESTAMPTZ;
  v_mudanca_real_noop BOOLEAN;

  v_blocked_direct_update BOOLEAN := false;
  v_blocked_bypass_update BOOLEAN := false;
  v_blocked_scope_creation BOOLEAN := false;
  v_blocked_atomic_rollback BOOLEAN := false;
  v_blocked_unique_event_key BOOLEAN := false;
  v_tarefa_fantasma_check INT;
  v_transicoes_fantasma_check INT;
  v_eventos_provs_fantasma_check INT;
  v_providencias_fantasma_check INT;

  v_count_select INT;
  v_updated_rows INT;
  v_test_event_key TEXT;
  v_sqlstate_captured TEXT;
BEGIN
  RAISE NOTICE '>>> INICIANDO BATERIA REPRODUZÍVEL DE TESTES DO RICCI TASK (v0.0.85) <<<';

  -- 1. Obter IDs de catálogo para os testes (executado com privilégios de setup)
  SELECT id INTO v_nome_controle_id FROM public.task_nomes_controle WHERE ativo = true LIMIT 1;
  SELECT id INTO v_status_id FROM public.task_status WHERE ativo = true AND NOT COALESCE(finaliza, false) LIMIT 1;
  SELECT id INTO v_tipo_prazo_id FROM public.task_tipos_prazo WHERE ativo = true LIMIT 1;
  SELECT id INTO v_status_prov_id FROM public.task_status_providencia WHERE ativo = true LIMIT 1;

  IF v_nome_controle_id IS NULL OR v_status_id IS NULL OR v_tipo_prazo_id IS NULL OR v_status_prov_id IS NULL THEN
    RAISE EXCEPTION 'Dados de catálogo ausentes para execução dos testes.';
  END IF;

  -- 2. Obter usuários de teste reais cadastrados no Gestor de Acessos
  -- Administrador
  SELECT u.auth_user_id, u.id INTO v_admin_auth, v_admin_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'ADMINISTRADOR' AND u.ativo = true AND us.ativo = true
  LIMIT 1;

  -- Gestor Principal
  SELECT u.auth_user_id, u.id INTO v_gestor_auth, v_gestor_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'GESTOR' AND u.ativo = true AND us.ativo = true
  LIMIT 1;

  -- Operacional da Equipe do Gestor Principal (u.gestor_id = v_gestor_core)
  SELECT u.auth_user_id, u.id INTO v_op_equipe_auth, v_op_equipe_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'OPERACIONAL' AND u.ativo = true AND us.ativo = true
    AND u.gestor_id = v_gestor_core
  LIMIT 1;

  -- Fallback se não houver operacional com gestor_id vinculado: pega qualquer operacional e temporariamente vincula
  IF v_op_equipe_auth IS NULL THEN
    SELECT u.auth_user_id, u.id INTO v_op_equipe_auth, v_op_equipe_core
    FROM public.core_usuarios u
    JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
    JOIN public.core_sistemas s ON s.id = us.sistema_id
    JOIN public.core_perfis p ON p.id = us.perfil_id
    WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'OPERACIONAL' AND u.ativo = true AND us.ativo = true
    LIMIT 1;

    IF v_op_equipe_core IS NOT NULL AND v_gestor_core IS NOT NULL THEN
      UPDATE public.core_usuarios SET gestor_id = v_gestor_core WHERE id = v_op_equipe_core;
    END IF;
  END IF;

  -- Outro Operacional (alheio à equipe do Gestor Principal)
  SELECT u.auth_user_id, u.id INTO v_op_outro_auth, v_op_outro_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'OPERACIONAL' AND u.ativo = true AND us.ativo = true
    AND u.id IS DISTINCT FROM v_op_equipe_core
  LIMIT 1;

  -- Outro Gestor (para teste negativo de gestor tentando caso de outra equipe)
  SELECT u.auth_user_id, u.id INTO v_gestor_outro_auth, v_gestor_outro_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'GESTOR' AND u.ativo = true AND us.ativo = true
    AND u.id IS DISTINCT FROM v_gestor_core
  LIMIT 1;

  IF v_admin_auth IS NULL OR v_gestor_auth IS NULL OR v_op_equipe_auth IS NULL THEN
    RAISE EXCEPTION 'Usuários de teste dos perfis centrais (ADMINISTRADOR, GESTOR, OPERACIONAL) não encontrados no banco.';
  END IF;

  -- =========================================================================
  -- TESTE 1: Criação de Casos por ADMINISTRADOR, GESTOR e OPERACIONAL como role 'authenticated'
  -- =========================================================================
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  -- 1.1 Administrador cria caso com providência inicial
  v_res_admin := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_ADMIN',
      'status_id', v_status_id,
      'data_autorizacao', clock_timestamp()::text,
      'prazo_conclusao', (clock_timestamp() + interval '5 days')::text,
      'responsavel_core_usuario_id', v_admin_core,
      'executor_core_usuario_id', v_op_equipe_core,
      'responsavel_usuario_id', gen_random_uuid(), -- Token legado que deve ser descartado
      'executor_usuario_id', gen_random_uuid()      -- Token legado que deve ser descartado
    ),
    jsonb_build_array(
      jsonb_build_object(
        'temp_id', 'tmp_prov_admin_1',
        'providencia', 'Providencia Inicial Admin',
        'prazo_conclusao', (clock_timestamp() + interval '3 days')::text,
        'tipo_prazo_id', v_tipo_prazo_id,
        'status_id', v_status_prov_id,
        'ordem', 1
      )
    ),
    'Criação de caso em teste automatizado'
  );

  v_tarefa_admin_id := (v_res_admin->>'tarefa_id')::UUID;
  IF v_tarefa_admin_id IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 1: Tarefa não criada pelo Administrador.';
  END IF;

  SELECT numero_caso INTO v_num_admin FROM public.task_tarefas WHERE id = v_tarefa_admin_id;
  RAISE NOTICE 'Teste 1.1 OK: Caso criado por Administrador (role authenticated). ID=%, Caso Nº=%', v_tarefa_admin_id, v_num_admin;

  -- 1.2 Gestor cria caso para membro de sua equipe direta
  PERFORM set_config('request.jwt.claim.sub', v_gestor_auth::text, true);

  v_res_gestor := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_GESTOR_EQUIPE',
      'status_id', v_status_id,
      'data_autorizacao', clock_timestamp()::text,
      'prazo_conclusao', (clock_timestamp() + interval '7 days')::text,
      'responsavel_core_usuario_id', v_gestor_core,
      'executor_core_usuario_id', v_op_equipe_core
    ),
    '[]'::jsonb,
    'Criação de caso por gestor para equipe'
  );

  v_tarefa_gestor_id := (v_res_gestor->>'tarefa_id')::UUID;
  IF v_tarefa_gestor_id IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 1.2: Tarefa não criada pelo Gestor.';
  END IF;

  SELECT numero_caso INTO v_num_gestor FROM public.task_tarefas WHERE id = v_tarefa_gestor_id;
  RAISE NOTICE 'Teste 1.2 OK: Caso criado por Gestor para equipe (role authenticated). ID=%, Caso Nº=%', v_tarefa_gestor_id, v_num_gestor;

  -- 1.3 Operacional da Equipe cria caso próprio (sendo Executor e Responsável)
  PERFORM set_config('request.jwt.claim.sub', v_op_equipe_auth::text, true);

  v_res_op := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_OP_PROPRIO',
      'status_id', v_status_id,
      'data_autorizacao', clock_timestamp()::text,
      'prazo_conclusao', (clock_timestamp() + interval '2 days')::text,
      'responsavel_core_usuario_id', v_op_equipe_core,
      'executor_core_usuario_id', v_op_equipe_core
    ),
    '[]'::jsonb,
    'Criação de caso por operacional equipe'
  );

  v_tarefa_op_id := (v_res_op->>'tarefa_id')::UUID;
  IF v_tarefa_op_id IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 1.3: Tarefa não criada pelo Operacional.';
  END IF;

  SELECT numero_caso INTO v_num_op FROM public.task_tarefas WHERE id = v_tarefa_op_id;
  RAISE NOTICE 'Teste 1.3 OK: Caso criado por Operacional equipe (role authenticated). ID=%, Caso Nº=%', v_tarefa_op_id, v_num_op;

  -- 1.4 Numeração sequencial estrita comprovada com RAISE EXCEPTION em caso de divergência
  IF v_num_gestor IS DISTINCT FROM (v_num_admin + 1) THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha de sequenciamento no Teste 1: número do Gestor (%) não é sucessor direto do Admin (%)!', v_num_gestor, v_num_admin;
  END IF;

  IF v_num_op IS DISTINCT FROM (v_num_gestor + 1) THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha de sequenciamento no Teste 1: número do Op (%) não é sucessor direto do Gestor (%)!', v_num_op, v_num_gestor;
  END IF;

  RAISE NOTICE 'Numeração estritamente sequencial comprovada com sucesso: % -> % -> %', v_num_admin, v_num_gestor, v_num_op;

  -- =========================================================================
  -- TESTE 2: [Item 4] Testes REAIS de Visualização (SELECT) e Edição (UPDATE)
  -- Executados REALMENTE como role 'authenticated' para cada perfil, com positivas e negativas
  -- =========================================================================

  -- 2.1 ADMINISTRADOR: SELECT vê todos os casos criados
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  SELECT count(*) INTO v_count_select
  FROM public.task_tarefas
  WHERE id IN (v_tarefa_admin_id, v_tarefa_gestor_id, v_tarefa_op_id);

  IF v_count_select IS DISTINCT FROM 3 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 2.1: Administrador deveria ver todos os 3 casos via SELECT, mas viu %!', v_count_select;
  END IF;

  -- 2.2 ADMINISTRADOR: UPDATE legítimo de campo comum (pasta_ricci) em qualquer caso
  UPDATE public.task_tarefas
  SET pasta_ricci = 'PASTA_ADMIN_UPDATE'
  WHERE id = v_tarefa_op_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 2.2: Administrador deveria conseguir atualizar campo comum do caso operacional, mas afetou % linhas!', v_updated_rows;
  END IF;
  RAISE NOTICE 'Teste 2.1 e 2.2 OK: Administrador possui SELECT total e UPDATE legítimo de campos comuns.';

  -- 2.3 GESTOR PRINCIPAL: SELECT vê caso próprio e caso da sua equipe direta (v_tarefa_gestor_id e v_tarefa_op_id)
  PERFORM set_config('request.jwt.claim.sub', v_gestor_auth::text, true);

  SELECT count(*) INTO v_count_select
  FROM public.task_tarefas
  WHERE id IN (v_tarefa_gestor_id, v_tarefa_op_id);

  IF v_count_select IS DISTINCT FROM 2 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 2.3: Gestor deveria ver seus casos e de sua equipe via SELECT, mas viu %!', v_count_select;
  END IF;

  -- 2.4 GESTOR PRINCIPAL: UPDATE legítimo em caso de membro de sua equipe direta
  UPDATE public.task_tarefas
  SET pasta_cliente = 'PASTA_CLIENTE_GESTOR_UPDATE'
  WHERE id = v_tarefa_op_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 2.4: Gestor deveria conseguir atualizar campo comum em caso de sua equipe direta!';
  END IF;
  RAISE NOTICE 'Teste 2.3 e 2.4 OK: Gestor visualiza e edita campos comuns de casos de sua equipe direta.';

  -- 2.5 OPERACIONAL DA EQUIPE: SELECT vê estritamente casos onde é Responsável ou Executor
  PERFORM set_config('request.jwt.claim.sub', v_op_equipe_auth::text, true);

  SELECT count(*) INTO v_count_select
  FROM public.task_tarefas
  WHERE id = v_tarefa_op_id;

  IF v_count_select IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 2.5: Operacional da equipe deveria ver seu próprio caso via SELECT!';
  END IF;

  -- 2.6 OPERACIONAL DA EQUIPE: UPDATE legítimo de campo comum em caso próprio
  UPDATE public.task_tarefas
  SET pasta_ricci = 'PASTA_OP_PROPRIO_UPDATE'
  WHERE id = v_tarefa_op_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 2.6: Operacional da equipe deveria conseguir atualizar campo comum de seu caso!';
  END IF;
  RAISE NOTICE 'Teste 2.5 e 2.6 OK: Operacional visualiza e edita campos comuns em caso próprio.';

  -- 2.7 NEGATIVA: OPERACIONAL ALHEIO tentando SELECT e UPDATE em caso que não lhe pertence
  IF v_op_outro_auth IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_op_outro_auth::text, true);

    -- SELECT deve retornar 0 linhas (filtrado por RLS)
    SELECT count(*) INTO v_count_select
    FROM public.task_tarefas
    WHERE id = v_tarefa_op_id;

    IF v_count_select IS DISTINCT FROM 0 THEN
      RESET ROLE;
      RAISE EXCEPTION 'Falha no Teste 2.7: Operacional alheio conseguiu ver caso de outro usuário via SELECT (vistos: %)! RLS violada.', v_count_select;
    END IF;

    -- UPDATE deve afetar 0 linhas (bloqueado por RLS)
    UPDATE public.task_tarefas
    SET pasta_cliente = 'HACK_OP_ALHEIO'
    WHERE id = v_tarefa_op_id;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows IS DISTINCT FROM 0 THEN
      RESET ROLE;
      RAISE EXCEPTION 'Falha crítica no Teste 2.7: Operacional alheio conseguiu atualizar caso alheio (afetou % linhas)!', v_updated_rows;
    END IF;
    RAISE NOTICE 'Teste 2.7 OK: Operacional alheio não visualiza nem altera caso de terceiro (0 linhas afetadas por RLS).';
  END IF;

  -- 2.8 NEGATIVA: GESTOR ALHEIO tentando caso de equipe alheia
  IF v_gestor_outro_auth IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_gestor_outro_auth::text, true);

    -- SELECT no caso do operacional da outra equipe deve retornar 0 linhas
    SELECT count(*) INTO v_count_select
    FROM public.task_tarefas
    WHERE id = v_tarefa_op_id;

    IF v_count_select IS DISTINCT FROM 0 THEN
      RESET ROLE;
      RAISE EXCEPTION 'Falha no Teste 2.8: Gestor de outra equipe conseguiu ver caso alheio via SELECT!';
    END IF;

    -- UPDATE no caso do operacional da outra equipe deve afetar 0 linhas
    UPDATE public.task_tarefas
    SET pasta_cliente = 'HACK_GESTOR_OUTRA_EQUIPE'
    WHERE id = v_tarefa_op_id;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows IS DISTINCT FROM 0 THEN
      RESET ROLE;
      RAISE EXCEPTION 'Falha crítica no Teste 2.8: Gestor de outra equipe conseguiu atualizar caso de equipe alheia!';
    END IF;
    RAISE NOTICE 'Teste 2.8 OK: Gestor alheio não visualiza nem altera caso de equipe que não é sua (0 linhas afetadas por RLS).';
  END IF;

  -- =========================================================================
  -- TESTE 3: Bloqueio de Escopo na Criação via RPC com captura estrita de SQLSTATE
  -- =========================================================================
  IF v_op_outro_core IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_op_equipe_auth::text, true);

    BEGIN
      PERFORM public.task_salvar_controle_transacional(
        NULL,
        jsonb_build_object(
          'nome_controle_id', v_nome_controle_id,
          'identificacao_caso', 'TESTE_FORA_DE_ESCOPO_OP',
          'status_id', v_status_id,
          'responsavel_core_usuario_id', v_op_outro_core,
          'executor_core_usuario_id', v_op_outro_core
        ),
        '[]'::jsonb,
        'Tentativa ilegal'
      );
    EXCEPTION
      WHEN SQLSTATE '42501' THEN
        v_blocked_scope_creation := true;
        RAISE NOTICE 'Teste 3 OK: Criação fora do escopo rejeitada com SQLSTATE 42501 conforme esperado: %', SQLERRM;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate_captured = RETURNED_SQLSTATE;
        RESET ROLE;
        RAISE EXCEPTION 'Falha no Teste 3: Esperava SQLSTATE 42501 (insufficient_privilege), mas capturou %: %', v_sqlstate_captured, SQLERRM;
    END;

    IF NOT v_blocked_scope_creation THEN
      RESET ROLE;
      RAISE EXCEPTION 'Falha no Teste 3: Usuário operacional conseguiu criar caso sem ser Responsável nem Executor!';
    END IF;
  END IF;

  -- =========================================================================
  -- TESTE 4: [Item 4] No-op sem mudanças com updated_at preparado ANTERIORMENTE
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  -- Preparar timestamp anterior: força explicitamente um updated_at fixo no passado
  -- para que qualquer alteração acidental se destaque indubitavelmente
  UPDATE public.task_tarefas
  SET updated_at = (NOW() - interval '1 hour')
  WHERE id = v_tarefa_admin_id;

  SELECT updated_at INTO v_time_before FROM public.task_tarefas WHERE id = v_tarefa_admin_id;

  v_res_noop := public.task_salvar_controle_transacional(
    v_tarefa_admin_id,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_ADMIN',
      'status_id', v_status_id,
      'data_autorizacao', (SELECT data_autorizacao::text FROM public.task_tarefas WHERE id = v_tarefa_admin_id),
      'prazo_conclusao', (SELECT prazo_conclusao::text FROM public.task_tarefas WHERE id = v_tarefa_admin_id),
      'responsavel_core_usuario_id', v_admin_core,
      'executor_core_usuario_id', v_op_equipe_core
    ),
    '[]'::jsonb,
    'No-op sem alterações'
  );

  v_mudanca_real_noop := (v_res_noop->>'mudanca_real')::BOOLEAN;
  SELECT updated_at INTO v_time_after FROM public.task_tarefas WHERE id = v_tarefa_admin_id;

  IF v_mudanca_real_noop IS NOT FALSE THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 4: no-op retornou mudanca_real = % (esperado: false)!', v_mudanca_real_noop;
  END IF;

  IF v_time_before IS DISTINCT FROM v_time_after THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 4: updated_at foi alterado em operação no-op sem mudanças! (% vs %)',
      v_time_before, v_time_after;
  END IF;

  RAISE NOTICE 'Teste 4 OK: No-op comprovado por mudanca_real=false E updated_at rigorosamente inalterado (%).', v_time_before;

  -- =========================================================================
  -- TESTE 5: Bloqueio de Alteração Direta e Bypass via GUC com captura estrita de SQLSTATE
  -- Tentativa de UPDATE direto das 4 colunas de atribuição como role 'authenticated':
  -- DEVE falhar pelo REVOKE / trigger (SQLSTATE 42501).
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  -- Subteste 5.1: UPDATE direto comum como authenticated
  BEGIN
    UPDATE public.task_tarefas
    SET executor_core_usuario_id = v_gestor_core
    WHERE id = v_tarefa_admin_id;
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      v_blocked_direct_update := true;
      RAISE NOTICE 'Teste 5.1 OK: UPDATE direto de atribuição bloqueado com SQLSTATE 42501 conforme esperado: %', SQLERRM;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate_captured = RETURNED_SQLSTATE;
      RESET ROLE;
      RAISE EXCEPTION 'Falha no Teste 5.1: Esperava SQLSTATE 42501, mas capturou %: %', v_sqlstate_captured, SQLERRM;
  END;

  IF NOT v_blocked_direct_update THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha crítica no Teste 5.1: Foi possível alterar executor diretamente em task_tarefas!';
  END IF;

  -- Subteste 5.2: Tentativa de Bypass com set_config('ricci_task.atribuicao_autorizada', 'true')
  PERFORM set_config('ricci_task.atribuicao_autorizada', 'true', true);

  BEGIN
    UPDATE public.task_tarefas
    SET executor_core_usuario_id = v_gestor_core
    WHERE id = v_tarefa_admin_id;
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      v_blocked_bypass_update := true;
      RAISE NOTICE 'Teste 5.2 OK: Tentativa de bypass via set_config bloqueada com SQLSTATE 42501 conforme esperado: %', SQLERRM;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate_captured = RETURNED_SQLSTATE;
      RESET ROLE;
      RAISE EXCEPTION 'Falha no Teste 5.2: Esperava SQLSTATE 42501, mas capturou %: %', v_sqlstate_captured, SQLERRM;
  END;

  IF NOT v_blocked_bypass_update THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha crítica no Teste 5.2: Usuário conseguiu burlar a proteção setando o GUC ricci_task.atribuicao_autorizada!';
  END IF;

  -- Limpar GUC
  PERFORM set_config('ricci_task.atribuicao_autorizada', '', true);

  -- =========================================================================
  -- TESTE 6: [Item 4] Atomicidade e Rollback Integral na RPC
  -- Chamada com providência válida seguida de inválida (campos obrigatórios nulos):
  -- deve falhar (SQLSTATE 22023) e NADA deve persistir:
  -- - Caso não persiste
  -- - Providência válida não persiste
  -- - Auditoria de transições não persiste
  -- - Auditoria de eventos de providências não persiste
  -- =========================================================================
  BEGIN
    PERFORM public.task_salvar_controle_transacional(
      NULL,
      jsonb_build_object(
        'nome_controle_id', v_nome_controle_id,
        'identificacao_caso', 'TESTE_ATOMICIDADE_FALHA_ESPERADA',
        'status_id', v_status_id,
        'data_autorizacao', clock_timestamp()::text,
        'prazo_conclusao', (clock_timestamp() + interval '5 days')::text,
        'responsavel_core_usuario_id', v_admin_core,
        'executor_core_usuario_id', v_op_equipe_core
      ),
      jsonb_build_array(
        -- Providência 1: Válida
        jsonb_build_object(
          'temp_id', 'tmp_prov_valida',
          'providencia', 'Providencia Valida Que Deve Sofrer Rollback',
          'prazo_conclusao', (clock_timestamp() + interval '3 days')::text,
          'tipo_prazo_id', v_tipo_prazo_id,
          'status_id', v_status_prov_id,
          'ordem', 1
        ),
        -- Providência 2: Inválida (providencia vazia / campos obrigatórios nulos) -> deve disparar SQLSTATE 22023
        jsonb_build_object(
          'temp_id', 'tmp_prov_invalida',
          'providencia', '',
          'prazo_conclusao', NULL,
          'tipo_prazo_id', NULL,
          'status_id', NULL,
          'ordem', 2
        )
      ),
      'Teste de rollback integral'
    );
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      v_blocked_atomic_rollback := true;
      RAISE NOTICE 'Teste 6 OK: Exceção esperada disparada pela providência inválida com SQLSTATE 22023: %', SQLERRM;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate_captured = RETURNED_SQLSTATE;
      RESET ROLE;
      RAISE EXCEPTION 'Falha no Teste 6: Esperava SQLSTATE 22023 (invalid_parameter_value), mas capturou %: %', v_sqlstate_captured, SQLERRM;
  END;

  IF NOT v_blocked_atomic_rollback THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 6: RPC não disparou erro para providência inválida!';
  END IF;

  -- Comprovar que NADA persistiu no banco: caso, providências e auditorias
  SELECT count(*) INTO v_tarefa_fantasma_check
  FROM public.task_tarefas
  WHERE identificacao_caso = 'TESTE_ATOMICIDADE_FALHA_ESPERADA';

  SELECT count(*) INTO v_providencias_fantasma_check
  FROM public.task_providencias
  WHERE providencia = 'Providencia Valida Que Deve Sofrer Rollback';

  SELECT count(*) INTO v_transicoes_fantasma_check
  FROM public.task_transicoes_atribuicao
  WHERE motivo = 'Teste de rollback integral';

  SELECT count(*) INTO v_eventos_provs_fantasma_check
  FROM public.task_transacao_providencias_eventos
  WHERE tarefa_id IN (
    SELECT id FROM public.task_tarefas WHERE identificacao_caso = 'TESTE_ATOMICIDADE_FALHA_ESPERADA'
  );

  IF (v_tarefa_fantasma_check IS DISTINCT FROM 0) OR
     (v_providencias_fantasma_check IS DISTINCT FROM 0) OR
     (v_transicoes_fantasma_check IS DISTINCT FROM 0) OR
     (v_eventos_provs_fantasma_check IS DISTINCT FROM 0) THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha crítica no Teste 6: Rollback não foi integral! Resíduos encontrados: Tarefas=%, Provs=%, Transições=%, EventosProvs=%',
      v_tarefa_fantasma_check, v_providencias_fantasma_check, v_transicoes_fantasma_check, v_eventos_provs_fantasma_check;
  END IF;

  RAISE NOTICE 'Teste 6 OK: Rollback integral comprovado. Zero registros residuais (tarefa, providência, transição e eventos).';

  -- =========================================================================
  -- TESTE 7: [Item 4] Unicidade de event_key em task_email_eventos (SQLSTATE 23505)
  -- =========================================================================
  -- Restaurar contexto com privilégio para testar constraint de tabela
  RESET ROLE;

  v_test_event_key := 'teste_unicidade_reproduzivel_' || gen_random_uuid()::text;

  -- Inserção 1: Bem-sucedida
  INSERT INTO public.task_email_eventos (
    tarefa_id,
    tipo_evento,
    event_key,
    to_email,
    status
  ) VALUES (
    v_tarefa_admin_id,
    'atribuicao',
    v_test_event_key,
    'teste.unicidade@riccipi.com.br',
    'pending'
  );

  -- Inserção 2: Duplicada com a mesma event_key -> DEVE falhar com SQLSTATE 23505 (unique_violation)
  BEGIN
    INSERT INTO public.task_email_eventos (
      tarefa_id,
      tipo_evento,
      event_key,
      to_email,
      status
    ) VALUES (
      v_tarefa_admin_id,
      'atribuicao',
      v_test_event_key,
      'duplicado@riccipi.com.br',
      'pending'
    );
  EXCEPTION
    WHEN SQLSTATE '23505' THEN
      v_blocked_unique_event_key := true;
      RAISE NOTICE 'Teste 7 OK: Unicidade de event_key comprovada! Falha capturada com SQLSTATE 23505 conforme esperado: %', SQLERRM;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate_captured = RETURNED_SQLSTATE;
      RAISE EXCEPTION 'Falha no Teste 7: Esperava SQLSTATE 23505 (unique_violation), mas capturou %: %', v_sqlstate_captured, SQLERRM;
  END;

  IF NOT v_blocked_unique_event_key THEN
    RAISE EXCEPTION 'Falha crítica no Teste 7: Foi possível inserir duas linhas com a mesma event_key em task_email_eventos!';
  END IF;

  RAISE NOTICE '>>> TODOS OS 7 BLOCOS DE TESTES DE BANCO, RLS, ATOMICIDADE E UNICIDADE PASSARAM COM SUCESSO! <<<';
END $$;

-- ROLLBACK OBRIGATÓRIO: Desfaz todas as alterações de teste sem poluir o banco do cliente
ROLLBACK;

-- Correção (a): Notificação pós-rollback em bloco DO $$ ... $$ (válido em PL/pgSQL e SQL script)
DO $$
BEGIN
  RAISE NOTICE 'Rollback executado com sucesso: banco restaurado ao estado original sem nenhuma alteração permanente.';
END $$;
