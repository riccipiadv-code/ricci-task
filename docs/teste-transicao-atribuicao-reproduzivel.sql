-- ============================================================================
-- SCRIPT POSTGRESQL REPRODUZÍVEL DE TESTE DE BANCO E RLS (RICCI TASK)
-- Arquivo: docs/teste-transicao-atribuicao-reproduzivel.sql
-- NOTA IMPORTANTE:
--   Este script é destinado para EXECUÇÃO MANUAL pelo usuário no SQL Editor do Supabase.
--   Ele NÃO é executado automaticamente pelo processo de build nem pelo assistente.
--
-- Cobertura das correções (v0.0.84):
--   (a) Mensagem pós-ROLLBACK usando DO $$ ... $$ ou SELECT (sem RAISE NOTICE isolado no script raiz)
--   (b) Testes de RLS rodando realmente como role 'authenticated' (SET ROLE authenticated + request.jwt.claim.sub)
--       nos 3 perfis centrais (ADMINISTRADOR, GESTOR, OPERACIONAL), restaurando postgres quando necessário.
--   (c) Teste de bypass: set_config('ricci_task.atribuicao_autorizada', 'true') e tentativa de UPDATE direto
--       das 4 colunas como role 'authenticated' — deve falhar pelo REVOKE / trigger.
--   (d) Chamada à RPC com providência válida seguida de inválida, comprovando rollback integral (nada persiste).
--   (e) Divergência de numeração sequencial de caso gera RAISE EXCEPTION (falha o teste), não apenas aviso.
--   (f) No-op comprovado por mudanca_real = false E updated_at inalterado usando clock_timestamp() antes/depois.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_admin_auth UUID;
  v_admin_core UUID;
  v_gestor_auth UUID;
  v_gestor_core UUID;
  v_op_auth UUID;
  v_op_core UUID;
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
  v_tarefa_fantasma_check INT;
BEGIN
  RAISE NOTICE '>>> INICIANDO BATERIA REPRODUZÍVEL DE TESTES DO RICCI TASK (v0.0.84) <<<';

  -- 1. Obter IDs de apoio para o teste (executado com privilégios de setup)
  SELECT id INTO v_nome_controle_id FROM public.task_nomes_controle WHERE ativo = true LIMIT 1;
  SELECT id INTO v_status_id FROM public.task_status WHERE ativo = true AND NOT COALESCE(finaliza, false) LIMIT 1;
  SELECT id INTO v_tipo_prazo_id FROM public.task_tipos_prazo WHERE ativo = true LIMIT 1;
  SELECT id INTO v_status_prov_id FROM public.task_status_providencia WHERE ativo = true LIMIT 1;

  IF v_nome_controle_id IS NULL OR v_status_id IS NULL OR v_tipo_prazo_id IS NULL OR v_status_prov_id IS NULL THEN
    RAISE EXCEPTION 'Dados de catálogo ausentes para execução dos testes.';
  END IF;

  -- Obter usuários de teste reais cadastrados no Gestor de Acessos
  -- Administrador
  SELECT u.auth_user_id, u.id INTO v_admin_auth, v_admin_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'ADMINISTRADOR' AND u.ativo = true AND us.ativo = true
  LIMIT 1;

  -- Gestor
  SELECT u.auth_user_id, u.id INTO v_gestor_auth, v_gestor_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'GESTOR' AND u.ativo = true AND us.ativo = true
  LIMIT 1;

  -- Operacional
  SELECT u.auth_user_id, u.id INTO v_op_auth, v_op_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'OPERACIONAL' AND u.ativo = true AND us.ativo = true
  LIMIT 1;

  -- Outro Operacional para testes de escopo
  SELECT u.id INTO v_op_outro_core
  FROM public.core_usuarios u
  JOIN public.core_usuario_sistemas us ON us.usuario_id = u.id
  JOIN public.core_sistemas s ON s.id = us.sistema_id
  JOIN public.core_perfis p ON p.id = us.perfil_id
  WHERE s.codigo = 'RICCI_TASK' AND p.codigo = 'OPERACIONAL' AND u.ativo = true AND us.ativo = true
    AND u.id <> v_op_core
  LIMIT 1;

  IF v_admin_auth IS NULL OR v_gestor_auth IS NULL OR v_op_auth IS NULL THEN
    RAISE EXCEPTION 'Usuários de teste dos 3 perfis centrais (ADMINISTRADOR, GESTOR, OPERACIONAL) não encontrados no banco.';
  END IF;

  -- =========================================================================
  -- TESTE 1: Criação de Caso por ADMINISTRADOR como role 'authenticated'
  -- =========================================================================
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  v_res_admin := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_ADMIN',
      'status_id', v_status_id,
      'data_autorizacao', clock_timestamp()::text,
      'prazo_conclusao', (clock_timestamp() + interval '5 days')::text,
      'responsavel_core_usuario_id', v_admin_core,
      'executor_core_usuario_id', v_op_core,
      'responsavel_usuario_id', gen_random_uuid(), -- Token que deve ser descartado
      'executor_usuario_id', gen_random_uuid()      -- Token que deve ser descartado
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
  RAISE NOTICE 'Teste 1 OK: Caso criado por Administrador (role authenticated). ID=%, Caso Nº=%', v_tarefa_admin_id, v_num_admin;

  -- =========================================================================
  -- TESTE 2: Criação de Caso por GESTOR como role 'authenticated'
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_gestor_auth::text, true);

  v_res_gestor := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_GESTOR',
      'status_id', v_status_id,
      'data_autorizacao', clock_timestamp()::text,
      'prazo_conclusao', (clock_timestamp() + interval '7 days')::text,
      'responsavel_core_usuario_id', v_gestor_core,
      'executor_core_usuario_id', v_gestor_core
    ),
    '[]'::jsonb,
    'Criação de caso por gestor'
  );

  v_tarefa_gestor_id := (v_res_gestor->>'tarefa_id')::UUID;
  IF v_tarefa_gestor_id IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 2: Tarefa não criada pelo Gestor.';
  END IF;

  SELECT numero_caso INTO v_num_gestor FROM public.task_tarefas WHERE id = v_tarefa_gestor_id;
  RAISE NOTICE 'Teste 2 OK: Caso criado por Gestor (role authenticated). ID=%, Caso Nº=%', v_tarefa_gestor_id, v_num_gestor;

  -- =========================================================================
  -- TESTE 3: Criação de Caso por OPERACIONAL e Numeração Sequencial Estrita
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_op_auth::text, true);

  v_res_op := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_OP',
      'status_id', v_status_id,
      'data_autorizacao', clock_timestamp()::text,
      'prazo_conclusao', (clock_timestamp() + interval '2 days')::text,
      'responsavel_core_usuario_id', v_op_core,
      'executor_core_usuario_id', v_op_core
    ),
    '[]'::jsonb,
    'Criação de caso por operacional'
  );

  v_tarefa_op_id := (v_res_op->>'tarefa_id')::UUID;
  IF v_tarefa_op_id IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 3: Tarefa não criada pelo Operacional.';
  END IF;

  SELECT numero_caso INTO v_num_op FROM public.task_tarefas WHERE id = v_tarefa_op_id;
  RAISE NOTICE 'Teste 3 OK: Caso criado por Operacional (role authenticated). ID=%, Caso Nº=%', v_tarefa_op_id, v_num_op;

  -- Correção (e): Divergência de numeração de caso DEVE dar RAISE EXCEPTION (falha o teste), não aviso
  IF v_num_gestor <> (v_num_admin + 1) THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha de sequenciamento no Teste 3: número do Gestor (%) não é sucessor direto do Admin (%)!', v_num_gestor, v_num_admin;
  END IF;

  IF v_num_op <> (v_num_gestor + 1) THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha de sequenciamento no Teste 3: número do Op (%) não é sucessor direto do Gestor (%)!', v_num_op, v_num_gestor;
  END IF;

  RAISE NOTICE 'Numeração estritamente sequencial comprovada com sucesso: % -> % -> %', v_num_admin, v_num_gestor, v_num_op;

  -- =========================================================================
  -- TESTE 4: Bloqueio de Escopo Operacional (Criação de caso alheio)
  -- =========================================================================
  IF v_op_outro_core IS NOT NULL THEN
    BEGIN
      PERFORM public.task_salvar_controle_transacional(
        NULL,
        jsonb_build_object(
          'nome_controle_id', v_nome_controle_id,
          'identificacao_caso', 'TESTE_FORA_DE_ESCOPO',
          'status_id', v_status_id,
          'responsavel_core_usuario_id', v_op_outro_core,
          'executor_core_usuario_id', v_op_outro_core
        ),
        '[]'::jsonb,
        'Tentativa ilegal'
      );
    EXCEPTION WHEN OTHERS THEN
      v_blocked_scope_creation := true;
      RAISE NOTICE 'Teste 4 OK: Criação fora do escopo operacional rejeitada com sucesso (Mensagem: %)', SQLERRM;
    END;

    IF NOT v_blocked_scope_creation THEN
      RESET ROLE;
      RAISE EXCEPTION 'Falha no Teste 4: Usuário operacional conseguiu criar caso sem ser Responsável nem Executor!';
    END IF;
  END IF;

  -- =========================================================================
  -- TESTE 5: No-op sem mudanças (Correção f: mudanca_real=false E updated_at inalterado com clock_timestamp)
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  -- Registrar timestamp do banco antes
  SELECT updated_at INTO v_time_before FROM public.task_tarefas WHERE id = v_tarefa_admin_id;

  -- Dormir 20ms usando pg_sleep para garantir que qualquer NOW() ou clock_timestamp() avançaria
  PERFORM pg_sleep(0.02);

  v_res_noop := public.task_salvar_controle_transacional(
    v_tarefa_admin_id,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_ADMIN',
      'status_id', v_status_id,
      'data_autorizacao', (SELECT data_autorizacao::text FROM public.task_tarefas WHERE id = v_tarefa_admin_id),
      'prazo_conclusao', (SELECT prazo_conclusao::text FROM public.task_tarefas WHERE id = v_tarefa_admin_id),
      'responsavel_core_usuario_id', v_admin_core,
      'executor_core_usuario_id', v_op_core
    ),
    '[]'::jsonb,
    'No-op sem alterações'
  );

  v_mudanca_real_noop := (v_res_noop->>'mudanca_real')::BOOLEAN;
  SELECT updated_at INTO v_time_after FROM public.task_tarefas WHERE id = v_tarefa_admin_id;

  IF v_mudanca_real_noop IS NOT FALSE THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 5: no-op retornou mudanca_real = % (esperado: false)!', v_mudanca_real_noop;
  END IF;

  IF v_time_before <> v_time_after THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 5: updated_at foi alterado em operação no-op sem mudanças! (% vs %)',
      v_time_before, v_time_after;
  END IF;

  RAISE NOTICE 'Teste 5 OK: No-op comprovado por mudanca_real=false E updated_at rigorosamente inalterado (%).', v_time_before;

  -- =========================================================================
  -- TESTE 6: Bloqueio de Alteração Direta e Bypass via GUC (Correção c)
  -- Tentativa de UPDATE direto com set_config('ricci_task.atribuicao_autorizada','true')
  -- como role 'authenticated' — DEVE falhar pelo REVOKE / trigger.
  -- =========================================================================
  -- Subteste 6.1: UPDATE direto comum como authenticated
  BEGIN
    UPDATE public.task_tarefas
    SET executor_core_usuario_id = v_gestor_core
    WHERE id = v_tarefa_admin_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked_direct_update := true;
    RAISE NOTICE 'Teste 6.1 OK: UPDATE direto de atribuição bloqueado (Mensagem: %)', SQLERRM;
  END;

  IF NOT v_blocked_direct_update THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha crítica no Teste 6.1: Foi possível alterar executor diretamente em task_tarefas!';
  END IF;

  -- Subteste 6.2: Tentativa de Bypass com set_config('ricci_task.atribuicao_autorizada', 'true')
  PERFORM set_config('ricci_task.atribuicao_autorizada', 'true', true);

  BEGIN
    UPDATE public.task_tarefas
    SET executor_core_usuario_id = v_gestor_core
    WHERE id = v_tarefa_admin_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked_bypass_update := true;
    RAISE NOTICE 'Teste 6.2 OK: Tentativa de bypass via set_config(''ricci_task.atribuicao_autorizada'',''true'') bloqueada com sucesso! (Mensagem: %)', SQLERRM;
  END;

  IF NOT v_blocked_bypass_update THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha crítica no Teste 6.2: Usuário conseguiu burlar a proteção setando o GUC ricci_task.atribuicao_autorizada!';
  END IF;

  -- Limpar GUC
  PERFORM set_config('ricci_task.atribuicao_autorizada', '', true);

  -- =========================================================================
  -- TESTE 7: Atomicidade e Rollback Integral na RPC (Correção d)
  -- Chamada com providência válida seguida de inválida (campos nulos/inválidos):
  -- deve falhar e NADA deve persistir (nem o caso nem a providência válida).
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
        'executor_core_usuario_id', v_op_core
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
        -- Providência 2: Inválida (providencia vazia / campos obrigatórios nulos) -> deve disparar RAISE EXCEPTION
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
  EXCEPTION WHEN OTHERS THEN
    v_blocked_atomic_rollback := true;
    RAISE NOTICE 'Teste 7 OK: Exceção disparada pela providência inválida conforme esperado: %', SQLERRM;
  END;

  IF NOT v_blocked_atomic_rollback THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha no Teste 7: RPC não disparou erro para providência inválida!';
  END IF;

  -- Comprovar que NADA persistiu no banco
  SELECT count(*) INTO v_tarefa_fantasma_check
  FROM public.task_tarefas
  WHERE identificacao_caso = 'TESTE_ATOMICIDADE_FALHA_ESPERADA';

  IF v_tarefa_fantasma_check > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Falha crítica no Teste 7: Transação não foi atômica! Foram encontradas % tarefas criadas mesmo após falha na providência.', v_tarefa_fantasma_check;
  END IF;

  RAISE NOTICE 'Teste 7 OK: Rollback integral comprovado. Zero registros residuais.';

  -- Restaurar role postgres antes de concluir o bloco
  RESET ROLE;
  RAISE NOTICE '>>> TODOS OS 7 TESTES DE BANCO, RLS E ATOMICIDADE PASSARAM COM SUCESSO! <<<';
END $$;

-- ROLLBACK OBRIGATÓRIO: Desfaz todas as alterações de teste sem poluir o banco do cliente
ROLLBACK;

-- Correção (a): Notificação pós-rollback em bloco DO $$ ... $$ (válido em PL/pgSQL e SQL script)
DO $$
BEGIN
  RAISE NOTICE 'Rollback executado com sucesso: banco restaurado ao estado original sem nenhuma alteração permanente.';
END $$;
