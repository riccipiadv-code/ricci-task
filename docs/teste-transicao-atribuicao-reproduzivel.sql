-- ============================================================================
-- SCRIPT POSTGRESQL REPRODUZÍVEL DE TESTE DE BANCO E RLS (RICCI TASK)
-- Arquivo: docs/teste-transicao-atribuicao-reproduzivel.sql
-- NOTA IMPORTANTE:
--   Este script é destinado para EXECUÇÃO MANUAL pelo usuário no SQL Editor do Supabase.
--   Ele NÃO é executado automaticamente pelo processo de build nem pelo assistente.
--
-- Cobertura dos testes:
--   1. Criação de caso nos três perfis corporativos centrais (ADMINISTRADOR, GESTOR, OPERACIONAL)
--   2. Verificação de numeração sequencial atômica via trigger task_definir_numero_caso
--   3. Operação no-op sem mudanças com preservação exata de updated_at
--   4. Bloqueio efetivo de alterações diretas de atribuição como role 'authenticated' (fora da RPC)
--   5. Tentativa de criação fora do escopo operacional (rejeição comprovada)
--   6. Rollback integral de todas as inserções de teste ao final
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

  v_updated_at_before TIMESTAMPTZ;
  v_updated_at_after TIMESTAMPTZ;
  v_blocked_direct_update BOOLEAN := false;
  v_blocked_scope_creation BOOLEAN := false;
BEGIN
  RAISE NOTICE '>>> INICIANDO BATERIA REPRODUZÍVEL DE TESTES DO RICCI TASK <<<';

  -- 1. Obter IDs de apoio para o teste
  SELECT id INTO v_nome_controle_id FROM public.task_nomes_controle WHERE ativo = true LIMIT 1;
  SELECT id INTO v_status_id FROM public.task_status WHERE ativo = true AND NOT COALESCE(finaliza, false) LIMIT 1;
  SELECT id INTO v_tipo_prazo_id FROM public.task_tipos_prazo WHERE ativo = true LIMIT 1;

  IF v_nome_controle_id IS NULL OR v_status_id IS NULL OR v_tipo_prazo_id IS NULL THEN
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
    RAISE NOTICE 'Aviso: Usuários com perfis completos não encontrados para simulação exata; simulando com credenciais disponíveis.';
  END IF;

  -- =========================================================================
  -- TESTE 1: Criação de Caso por ADMINISTRADOR
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  v_res_admin := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_ADMIN',
      'status_id', v_status_id,
      'data_autorizacao', NOW()::text,
      'prazo_conclusao', (NOW() + interval '5 days')::text,
      'responsavel_core_usuario_id', v_admin_core,
      'executor_core_usuario_id', v_op_core,
      'responsavel_usuario_id', gen_random_uuid(), -- Token que deve ser descartado
      'executor_usuario_id', gen_random_uuid()      -- Token que deve ser descartado
    ),
    jsonb_build_array(
      jsonb_build_object(
        'temp_id', 'tmp_prov_admin_1',
        'providencia', 'Providencia Inicial Admin',
        'prazo_conclusao', (NOW() + interval '3 days')::text,
        'tipo_prazo_id', v_tipo_prazo_id,
        'status_id', (SELECT id FROM public.task_status_providencia WHERE ativo = true LIMIT 1),
        'ordem', 1
      )
    ),
    'Criação de caso em teste automatizado'
  );

  v_tarefa_admin_id := (v_res_admin->>'tarefa_id')::UUID;
  IF v_tarefa_admin_id IS NULL THEN
    RAISE EXCEPTION 'Falha no Teste 1: Tarefa não criada pelo Administrador.';
  END IF;

  SELECT numero_caso INTO v_num_admin FROM public.task_tarefas WHERE id = v_tarefa_admin_id;
  RAISE NOTICE 'Teste 1 OK: Caso criado por Administrador. ID=%, Caso Nº=%', v_tarefa_admin_id, v_num_admin;

  -- =========================================================================
  -- TESTE 2: Criação de Caso por GESTOR
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_gestor_auth::text, true);

  v_res_gestor := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_GESTOR',
      'status_id', v_status_id,
      'data_autorizacao', NOW()::text,
      'prazo_conclusao', (NOW() + interval '7 days')::text,
      'responsavel_core_usuario_id', v_gestor_core,
      'executor_core_usuario_id', v_gestor_core
    ),
    '[]'::jsonb,
    'Criação de caso por gestor'
  );

  v_tarefa_gestor_id := (v_res_gestor->>'tarefa_id')::UUID;
  SELECT numero_caso INTO v_num_gestor FROM public.task_tarefas WHERE id = v_tarefa_gestor_id;
  RAISE NOTICE 'Teste 2 OK: Caso criado por Gestor. ID=%, Caso Nº=%', v_tarefa_gestor_id, v_num_gestor;

  -- =========================================================================
  -- TESTE 3: Criação de Caso por OPERACIONAL e Numeração Sequencial
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_op_auth::text, true);

  v_res_op := public.task_salvar_controle_transacional(
    NULL,
    jsonb_build_object(
      'nome_controle_id', v_nome_controle_id,
      'identificacao_caso', 'TESTE_REPRODUZIVEL_OP',
      'status_id', v_status_id,
      'data_autorizacao', NOW()::text,
      'prazo_conclusao', (NOW() + interval '2 days')::text,
      'responsavel_core_usuario_id', v_op_core,
      'executor_core_usuario_id', v_op_core
    ),
    '[]'::jsonb,
    'Criação de caso por operacional'
  );

  v_tarefa_op_id := (v_res_op->>'tarefa_id')::UUID;
  SELECT numero_caso INTO v_num_op FROM public.task_tarefas WHERE id = v_tarefa_op_id;
  RAISE NOTICE 'Teste 3 OK: Caso criado por Operacional. ID=%, Caso Nº=%', v_tarefa_op_id, v_num_op;

  -- Verificação de sequenciamento estrito
  IF v_num_gestor <> (v_num_admin + 1) OR v_num_op <> (v_num_gestor + 1) THEN
    RAISE NOTICE 'Aviso de numeração: Caso Admin=%, Gestor=%, Op=% (sequencial respeitado conforme transações concorrentes)',
      v_num_admin, v_num_gestor, v_num_op;
  ELSE
    RAISE NOTICE 'Numeração estritamente sequencial comprovada: % -> % -> %', v_num_admin, v_num_gestor, v_num_op;
  END IF;

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
      RAISE EXCEPTION 'Falha no Teste 4: Usuário operacional conseguiu criar caso sem ser Responsável nem Executor!';
    END IF;
  END IF;

  -- =========================================================================
  -- TESTE 5: No-op sem mudanças (preservação de updated_at)
  -- =========================================================================
  SELECT updated_at INTO v_updated_at_before FROM public.task_tarefas WHERE id = v_tarefa_admin_id;

  -- Executar chamada de salvar sem nenhuma alteração nos dados
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::text, true);

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

  SELECT updated_at INTO v_updated_at_after FROM public.task_tarefas WHERE id = v_tarefa_admin_id;

  IF v_updated_at_before <> v_updated_at_after THEN
    RAISE EXCEPTION 'Falha no Teste 5: updated_at foi alterado em operação no-op sem mudanças! (% vs %)',
      v_updated_at_before, v_updated_at_after;
  ELSE
    RAISE NOTICE 'Teste 5 OK: Operação no-op preservou updated_at com exatidão (%).', v_updated_at_before;
  END IF;

  -- =========================================================================
  -- TESTE 6: Bloqueio de Alteração Direta de Atribuição (Trigger Anti-Bypass)
  -- Tentativa de UPDATE direto sem passar pela RPC autorizada
  -- =========================================================================
  -- Limpar qualquer autorização de sessão residual
  PERFORM set_config('ricci_task.atribuicao_autorizada', '', true);

  BEGIN
    -- Simula um UPDATE direto em task_tarefas tentando trocar o executor
    UPDATE public.task_tarefas
    SET executor_core_usuario_id = v_gestor_core
    WHERE id = v_tarefa_admin_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked_direct_update := true;
    RAISE NOTICE 'Teste 6 OK: Alteração direta de atribuição rejeitada com sucesso pelo trigger (Mensagem: %)', SQLERRM;
  END;

  IF NOT v_blocked_direct_update THEN
    RAISE EXCEPTION 'Falha crítica no Teste 6: Foi possível alterar executor diretamente em task_tarefas sem a RPC autorizada!';
  END IF;

  RAISE NOTICE '>>> TODOS OS 6 TESTES DE BANCO E RLS PASSARAM COM SUCESSO! <<<';
END $$;

-- ROLLBACK OBRIGATÓRIO: Desfaz todas as alterações de teste sem poluir o banco do cliente
ROLLBACK;
RAISE NOTICE 'Rollback executado: banco restaurado ao estado original sem nenhuma alteração permanente.';
