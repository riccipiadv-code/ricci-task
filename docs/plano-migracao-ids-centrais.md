# Plano de Migração e Corte Definitivo para IDs Centrais — Ricci Task (v0.0.74)

## 1. Contexto e Motivação

O sistema Ricci Task historicamente utilizava uma tabela local (`public.task_usuarios`) para mapear responsáveis e executores de tarefas. Com a unificação da governança corporativa no **Gestor de Acessos Ricci** (`core_usuarios`, `core_sistemas`, `core_perfis`, `core_usuario_sistemas`), as tarefas passaram a conter campos centrais (`responsavel_core_usuario_id` e `executor_core_usuario_id`).

A versão **0.0.74** consolida o corte definitivo de ponta a ponta:

- Elimina qualquer dependência operacional ou de salvamento da tabela `task_usuarios`.
- Migra a seleção, filtros, detecção de alteração de responsáveis/executores e disparos de e-mail exclusivamente para os IDs centrais.
- Preserva histórico, dados arquivados, idempotência estável em `task_email_eventos` e leitura autorizada de nomes históricos (inclusive inativos).
- **As colunas de tokens históricos (`task_tarefas.responsavel_usuario_id` e `task_tarefas.executor_usuario_id`) PERMANECEM em `task_tarefas`** (sem FK) para garantir que as chaves de idempotência antigas continuem idênticas e resolvíveis determinísticamente.

---

## 2. Achados da Investigação no Banco de Dados

A inspeção estrutural das tabelas e funções do PostgreSQL revelou:

1. **Foreign Keys e Constraints**:
   - `task_tarefas.responsavel_usuario_id`: `NOT NULL`, FK para `task_usuarios(id)`.
   - `task_tarefas.executor_usuario_id`: `NOT NULL`, FK para `task_usuarios(id)`.
   - `task_tarefas.responsavel_core_usuario_id`: `NULLABLE`, FK para `core_usuarios(id)`.
   - `task_tarefas.executor_core_usuario_id`: `NULLABLE`, FK para `core_usuarios(id)`.
   - `task_email_notificacoes`: possui FKs para `task_usuarios(id)` (`executor_usuario_id`, `responsavel_usuario_id`).
   - `task_email_eventos`: possui FKs apenas para `task_tarefas` e `task_providencias`. Não referencia `task_usuarios`.

2. **Diagnóstico dos Dados**:
   - Total de tarefas em `task_tarefas`: **23**.
   - Total com `responsavel_core_usuario_id` preenchido: **23 (100%)**.
   - Total com `executor_core_usuario_id` preenchido: **23 (100%)**.
   - Tabela `task_email_notificacoes`: **0 registros** (tabela legada inativa).
   - Tabela `task_email_eventos`: **11 eventos registrados**, utilizando a regra padrão com chaves estáveis.

3. **Elegibilidade Central**:
   - A função RPC `public.task_listar_usuarios_core_elegiveis()` valida a autorização central do chamador via `task_has_core_access()` e retorna os usuários ativos vinculados ao sistema `RICCI_TASK` com perfis `ADMINISTRADOR`, `GESTOR` ou `OPERACIONAL`.
   - Não depende de nenhuma tabela operacional local.

---

## 3. Ordem Correta de Execução das Fases

Para garantir zero indisponibilidade e permitir que **sessões abertas na versão antiga continuem operando normalmente durante a janela de transição**, as fases devem ser executadas na seguinte ordem:

```
[ Fase 1: Preparação do Banco (SQL manual) ]
                   │
                   ▼
[ Fase 2: Publicação do Frontend e Edge Functions ]
                   │
                   ▼ (Aguardar encerramento de todas as sessões v0.0.67: 24h a 48h)
[ Fase 3: Limpeza e Exclusão das Tabelas Antigas (SQL manual) ]
```

### Fase 1: Preparação do Banco de Dados (Antes do Deploy)

- **Ação**: Execução manual pelo administrador do script `docs/migracao-corte-ids-centrais.sql` (Bloco FASE 1).
- **O que faz**:
  1. Assegura que todas as linhas de `task_tarefas` possuam IDs centrais preenchidos.
  2. Altera `responsavel_core_usuario_id` e `executor_core_usuario_id` para `NOT NULL`.
  3. Torna `responsavel_usuario_id` e `executor_usuario_id` em `NULLABLE` (removendo restrição `NOT NULL`).
  4. Adiciona trigger temporário de compatibilidade reversa (`trg_task_tarefas_compat_core`), operando exclusivamente quando uma sessão antiga envia apenas as colunas operacionais (sem preenchimento reverso para gravações novas).
  5. Cria índices para performance nas colunas centrais.

### Fase 2: Publicação do Frontend e Edge Functions

- **Ação**:
  1. Build e publicação da versão do frontend do Ricci Task.
  2. Deploy das duas Edge Functions atualizadas:
     - `notify-task-assignment`
     - `notify-task-overdue`
- **Comportamento nesta fase**:
  - Usuários que recarregam a página já entram na versão nova operando 100% sobre IDs centrais.
  - Pessoas novas sem vínculo com `task_usuarios` gravam normalmente com as colunas centrais preenchidas e colunas operacionais nulas.
  - Nenhuma notificação ou busca em Edge Functions consulta `task_usuarios`.

### Fase 3: Exclusão e Limpeza Definitiva Manual (Pós-Transição)

- **Quando executar**: Somente após 24h a 48h da publicação da Fase 2, e após confirmar que não há mais sessões abertas na versão anterior.
- **O que faz (Execução Manual SEM CASCADE)**:
  1. Remove explicitamente triggers e funções: `trg_task_tarefas_compat_core`, `trg_sync_task_usuarios_to_core`, `trg_task_tarefas_compat_core_ids()` e `fn_sync_task_usuarios_to_core()`.
  2. Remove as Foreign Keys legadas de `task_tarefas` apontando para `task_usuarios` (`task_tarefas_responsavel_usuario_id_fkey`, `task_tarefas_executor_usuario_id_fkey`, etc.).
  3. **IMPORTANTE: As colunas `task_tarefas.responsavel_usuario_id` e `executor_usuario_id` NÃO são removidas**. Elas permanecem desvinculadas (sem FK) preservando os tokens históricos para idempotência de e-mails antigos.
  4. Remove explicitamente as FKs de `task_email_notificacoes` e depois remove a tabela `DROP TABLE IF EXISTS task_email_notificacoes` (sem CASCADE).
  5. Remove a função legada `DROP FUNCTION IF EXISTS task_listar_usuarios_elegiveis()`.
  6. Remove a tabela `DROP TABLE IF EXISTS task_usuarios` (sem CASCADE).

---

## 4. Garantia de Idempotência e Tokens Históricos

- Eventos gravados anteriormente em `task_email_eventos` mantêm suas chaves intactas.
- A Edge Function `notify-task-assignment` resolve os tokens da chave via `resolveEventKeyToken(historicalToken, coreId)`:
  - Se a coluna operacional estiver preenchida (`tarefa.executor_usuario_id` / `tarefa.responsavel_usuario_id`), usa o token histórico operacional.
  - Caso contrário (novas atribuições sem coluna operacional), usa o ID central.
  - Se nenhum estiver presente, usa `'sem_token'`.
- Chave composta: `atribuicao:{tarefa.id}:{tarefa.updated_at||tarefa.created_at||'sem_timestamp'}:{execToken}:{respToken}`.
- Chaves antigas no formato `atribuicao:{tarefa.id}:{timestamp}:{execId}:{respId}` continuam existindo e impedindo reenvios duplicados (`already_sent`).
- Salvar um caso sem alterações não executa UPDATE em `task_tarefas`, preservando `updated_at` e mantendo a integridade da chave de idempotência.
- Quando há reatribuição de responsável ou executor, a operação é executada via RPC `public.task_transferir_atribuicao`:
  - O papel que foi alterado tem seu token histórico limpo (`NULL`), assumindo seu novo ID central corporativo.
  - O papel que NÃO foi alterado preserva seu token histórico intacto.
  - Sem mudança real de atribuição, a RPC não atualiza nem grava auditoria.
