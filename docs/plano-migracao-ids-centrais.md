# Plano de Migração e Corte Definitivo para IDs Centrais — Ricci Task (v0.0.68)

## 1. Contexto e Motivação

O sistema Ricci Task historicamente utilizava uma tabela local (`public.task_usuarios`) para mapear responsáveis e executores de tarefas. Com a unificação da governança corporativa no **Gestor de Acessos Ricci** (`core_usuarios`, `core_sistemas`, `core_perfis`, `core_usuario_sistemas`), as tarefas passaram a conter campos centrais (`responsavel_core_usuario_id` e `executor_core_usuario_id`).

A versão **0.0.68** realiza o corte definitivo de ponta a ponta:

- Elimina a exigência de registros operacionais em `task_usuarios` ("ponte operacional").
- Migra a seleção, filtros, detecção de alteração de responsáveis/executores e disparos de e-mail exclusivamente para os IDs centrais.
- Preserva histórico, dados arquivados, idempotência estável em `task_email_eventos` e leitura autorizada de nomes históricos (inclusive inativos).

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
  4. Adiciona trigger temporário de compatibilidade reversa (`trg_task_tarefas_compat_core`), garantindo que tanto a versão antiga (que envia IDs de `task_usuarios`) quanto a versão nova (que envia IDs centrais) consigam inserir e atualizar tarefas simultaneamente sem erro de FK ou nulo.
  5. Cria índices para performance nas colunas centrais.

### Fase 2: Publicação do Frontend e Edge Functions

- **Ação**:
  1. Build e publicação da versão 0.0.68 do frontend do Ricci Task.
  2. Deploy das duas Edge Functions atualizadas:
     - `notify-task-assignment`
     - `notify-task-overdue`
- **Comportamento nesta fase**:
  - Usuários que recarregam a página já entram na v0.0.68 operando 100% sobre IDs centrais.
  - Usuários com abas antigas abertas ainda conseguem salvar casos sem erros técnicos, graças ao trigger de compatibilidade da Fase 1.
  - Nenhuma notificação ou busca em Edge Functions consulta `task_usuarios`.

### Fase 3: Exclusão e Limpeza Definitiva (Pós-Transição)

- **Quando executar**: Somente após 24h a 48h da publicação da Fase 2, quando todos os usuários tiverem encerrado as sessões antigas.
- **O que faz**:
  1. Remove o trigger temporário de compatibilidade.
  2. Executa `DROP TABLE public.task_email_notificacoes CASCADE`.
  3. Remove as FKs legadas de `task_tarefas` para `task_usuarios`.
  4. Remove as colunas legadas `responsavel_usuario_id` e `executor_usuario_id` de `task_tarefas`.
  5. Executa `DROP FUNCTION public.task_listar_usuarios_elegiveis()`.
  6. Executa `DROP TABLE public.task_usuarios CASCADE`.

---

## 4. Garantia de Idempotência e Tokens Históricos

- Eventos gravados anteriormente em `task_email_eventos` mantêm suas chaves intactas.
- Chaves antigas no formato `atribuicao:{tarefa.id}:{timestamp}:{execId}:{respId}` continuam existindo e impedindo reenvios duplicados (`already_sent`).
- Novos casos e edições na versão 0.0.68 compõem a chave utilizando os **IDs centrais** dos envolvidos (`executor_core_usuario_id` e `responsavel_core_usuario_id`), mantendo a estabilidade e previsibilidade de chaves.
- Salvar um caso sem alterações não executa UPDATE em `task_tarefas`, preservando `updated_at` e mantendo a integridade da chave de idempotência.
