-- ============================================================================
-- GUIA DE MIGRAÇÃO: CORTE DEFINITIVO DO RICCI TASK PARA OS IDS CENTRAIS
-- Documento de Execução Manual e Roteiro de Transição
-- Sistema: Ricci Task (Versão 0.0.68)
-- Backend: Supabase / PostgreSQL (Schema: public)
-- ATENÇÃO: NÃO executar este script via migração automatizada.
-- Este documento foi preparado para execução MANUAL pelo administrador do banco.
-- ============================================================================

/*
--------------------------------------------------------------------------------
SUMÁRIO EXECUTIVO & DIAGNÓSTICO DO BANCO
--------------------------------------------------------------------------------
1. Objetos Legados que dependiam de `task_usuarios`:
   - `task_tarefas.responsavel_usuario_id` (UUID, NOT NULL, FK -> task_usuarios)
   - `task_tarefas.executor_usuario_id` (UUID, NOT NULL, FK -> task_usuarios)
   - `task_tarefas.responsavel_core_usuario_id` (UUID, NULLABLE, FK -> core_usuarios)
   - `task_tarefas.executor_core_usuario_id` (UUID, NULLABLE, FK -> core_usuarios)
   - `task_email_notificacoes` (Tabela legada com FKs para task_usuarios e task_tarefas; 0 registros)
   - `task_usuarios` (Tabela operacional local com FK -> core_usuarios)
   - Função RPC `task_listar_usuarios_elegiveis()` (faz upsert de ponte em task_usuarios)

2. Estado Atual dos Dados (Verificado na v0.0.67):
   - 100% das tarefas existentes em `task_tarefas` (23 registros) já possuem
     `responsavel_core_usuario_id` e `executor_core_usuario_id` devidamente preenchidos.
   - A tabela `task_email_notificacoes` possui 0 registros (a idempotência oficial
     já é exercida pela tabela `task_email_eventos`).
   - Todos os eventos em `task_email_eventos` possuem event_keys estáveis que não
     podem sofrer alteração para manter idempotência histórica.

3. Compatibilidade com Sessões Abertas na Versão Antiga:
   - Durante a janela de transição, haverá usuários com abas abertas executando a versão 0.0.67.
   - A versão antiga grava tanto os campos `*_usuario_id` quanto `*_core_usuario_id`.
   - Se os campos antigos `*_usuario_id` fossem removidos imediatamente, as sessões antigas
     quebrassem com erro de coluna inexistente ou violação de NOT NULL.
   - Por isso, a migração é dividida em 3 FASES ESTRITAS.
*/

-- ============================================================================
-- FASE 1: PREPARAÇÃO DO BANCO (EXECUTAR ANTES DE PUBLICAR FRONTEND/FUNCTIONS)
-- ============================================================================
-- Objetivo: Garantir integridade dos IDs centrais, permitir que campos legados
-- se tornem opcionais (NULL) e manter retrocompatibilidade com a v0.0.67.

BEGIN;

-- 1.1 Garantir que nenhuma tarefa ativa ou arquivada tenha IDs centrais nulos.
-- Backfill de segurança a partir da ponte task_usuarios caso exista alguma linha antiga:
UPDATE public.task_tarefas t
SET responsavel_core_usuario_id = tu.core_usuario_id
FROM public.task_usuarios tu
WHERE t.responsavel_usuario_id = tu.id
  AND t.responsavel_core_usuario_id IS NULL
  AND tu.core_usuario_id IS NOT NULL;

UPDATE public.task_tarefas t
SET executor_core_usuario_id = tu.core_usuario_id
FROM public.task_usuarios tu
WHERE t.executor_usuario_id = tu.id
  AND t.executor_core_usuario_id IS NULL
  AND tu.core_usuario_id IS NOT NULL;

-- 1.2 Tornar os campos centrais NOT NULL em task_tarefas
-- Agora a autoridade primária reside em responsavel_core_usuario_id e executor_core_usuario_id.
ALTER TABLE public.task_tarefas
  ALTER COLUMN responsavel_core_usuario_id SET NOT NULL,
  ALTER COLUMN executor_core_usuario_id SET NOT NULL;

-- 1.3 Tornar os campos operacionais legados NULLABLE
-- Isso permite que novas versões do frontend (v0.0.68+) gravem NULL ou o próprio ID central,
-- sem falhar por restrição NOT NULL, enquanto sessões antigas (v0.0.67) ainda conseguem
-- enviar seus IDs operacionais sem conflito.
ALTER TABLE public.task_tarefas
  ALTER COLUMN responsavel_usuario_id DROP NOT NULL,
  ALTER COLUMN executor_usuario_id DROP NOT NULL;

-- 1.4 Criar trigger de compatibilidade reversa para sessões antigas (Opcional, mas recomendado)
-- Se uma sessão antiga enviar responsavel_usuario_id sem responsavel_core_usuario_id,
-- o trigger preenche automaticamente o ID central a partir de task_usuarios.
CREATE OR REPLACE FUNCTION public.trg_task_tarefas_compat_core_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.responsavel_core_usuario_id IS NULL AND NEW.responsavel_usuario_id IS NOT NULL THEN
    SELECT core_usuario_id INTO NEW.responsavel_core_usuario_id
    FROM public.task_usuarios
    WHERE id = NEW.responsavel_usuario_id;
  END IF;

  IF NEW.executor_core_usuario_id IS NULL AND NEW.executor_usuario_id IS NOT NULL THEN
    SELECT core_usuario_id INTO NEW.executor_core_usuario_id
    FROM public.task_usuarios
    WHERE id = NEW.executor_usuario_id;
  END IF;

  -- Se a versão nova enviar apenas core_usuario_id e os campos legados forem NULL,
  -- preenche os campos legados com o correspondente em task_usuarios se existir,
  -- evitando quebrar views ou relatórios legados durante a transição:
  IF NEW.responsavel_usuario_id IS NULL AND NEW.responsavel_core_usuario_id IS NOT NULL THEN
    SELECT id INTO NEW.responsavel_usuario_id
    FROM public.task_usuarios
    WHERE core_usuario_id = NEW.responsavel_core_usuario_id
    ORDER BY ativo DESC, created_at ASC
    LIMIT 1;
  END IF;

  IF NEW.executor_usuario_id IS NULL AND NEW.executor_core_usuario_id IS NOT NULL THEN
    SELECT id INTO NEW.executor_usuario_id
    FROM public.task_usuarios
    WHERE core_usuario_id = NEW.executor_core_usuario_id
    ORDER BY ativo DESC, created_at ASC
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_tarefas_compat_core ON public.task_tarefas;
CREATE TRIGGER trg_task_tarefas_compat_core
  BEFORE INSERT OR UPDATE ON public.task_tarefas
  FOR EACH ROW EXECUTE FUNCTION public.trg_task_tarefas_compat_core_ids();

-- 1.5 Índices de performance para os campos centrais
CREATE INDEX IF NOT EXISTS idx_task_tarefas_responsavel_core_usuario_id
  ON public.task_tarefas (responsavel_core_usuario_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_task_tarefas_executor_core_usuario_id
  ON public.task_tarefas (executor_core_usuario_id)
  WHERE deleted_at IS NULL;

COMMIT;

-- FIM DA FASE 1: O banco agora suporta tanto a versão 0.0.67 quanto a 0.0.68.


-- ============================================================================
-- FASE 2: PUBLICAÇÃO DO FRONTEND E EDGE FUNCTIONS (AÇÃO DE DEPLOY)
-- ============================================================================
/*
Nesta fase:
1. Publicar a nova versão do Frontend (v0.0.68) contendo:
   - Seleção, filtros, listagem e gravação direto pelos IDs centrais.
   - Remoção de checagem/etiqueta de "Sem ponte".
   - Detecção de alteração e disparos comparando IDs centrais.
2. Fazer deploy das duas Edge Functions:
   - notify-task-assignment
   - notify-task-overdue
   com o helper supabase/functions/_shared/core-auth.ts sem qualquer consulta à tabela task_usuarios.
3. Aguardar a expiração do cache e encerramento de todas as sessões anteriores dos navegadores.
*/


-- ============================================================================
-- FASE 3: LIMPEZA E EXCLUSÃO DAS TABELAS E OBJETOS ANTIGOS
-- ============================================================================
-- ATENÇÃO: EXECUTAR ESTA FASE APENAS QUANDO NÃO HOUVER MAIS SESSÕES ABERTAS NA VERSÃO 0.0.67.
-- Recomendado: aguardar de 24 a 48 horas após a Fase 2.

BEGIN;

-- 3.1 Remover o trigger de compatibilidade da transição
DROP TRIGGER IF EXISTS trg_task_tarefas_compat_core ON public.task_tarefas;
DROP FUNCTION IF EXISTS public.trg_task_tarefas_compat_core_ids();

-- 3.2 Remover a tabela legada de notificações de e-mail (não utilizada pelo sistema)
DROP TABLE IF EXISTS public.task_email_notificacoes CASCADE;

-- 3.3 Remover as FKs de task_tarefas apontando para task_usuarios
ALTER TABLE public.task_tarefas
  DROP CONSTRAINT IF EXISTS task_tarefas_responsavel_task_usuario_fkey,
  DROP CONSTRAINT IF EXISTS task_tarefas_executor_task_usuario_fkey;

-- 3.4 Remover as colunas operacionais legadas de task_tarefas
ALTER TABLE public.task_tarefas
  DROP COLUMN IF EXISTS responsavel_usuario_id,
  DROP COLUMN IF EXISTS executor_usuario_id;

-- 3.5 Remover a função RPC legada de sincronização de ponte
DROP FUNCTION IF EXISTS public.task_listar_usuarios_elegiveis();

-- 3.6 Excluir a tabela legada task_usuarios
DROP TABLE IF EXISTS public.task_usuarios CASCADE;

COMMIT;

-- FIM DA MIGRAÇÃO: O Ricci Task agora opera 100% nativo com IDs centrais do Gestor de Acessos.
