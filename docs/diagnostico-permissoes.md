# Diagnóstico de Permissões e Modelo de Acesso — Ricci Task

**Projeto:** Ricci Task (Gestão de Controles e Providências)  
**Backend:** Supabase (PostgreSQL, Auth e Edge Functions)  
**Módulo Central:** Gestor de Acessos Ricci (`core_*`)  
**Data do Diagnóstico:** Setembro de 2026  
**Status da Entrega:** Análise técnica preliminar para decisão e planejamento (sem execução de SQL, sem alterações de banco e sem publicação).

---

## 1. Mapeamento da Autenticação, Perfis e Hierarquia no Gestor de Acessos Ricci

### 1.1 Estrutura do Gestor de Acessos Ricci (`core_*`)

O sistema Ricci Task utiliza como fonte corporativa e unificada de verdade as tabelas do schema central (`public.core_*`):

1. **`public.core_sistemas`**:
   - `id`: UUID (PK).
   - `codigo`: `CONECTAI`, `GESTOR_ACESSO`, `RICCI_TASK`.
   - `ativo`: `boolean` (indica se o módulo/sistema está operacional).
2. **`public.core_perfis`**:
   - Perfis cadastrados para o sistema `RICCI_TASK`:
     - `ADMINISTRADOR` (UUID `2dfd2cc1-adb3-4926-8122-9b60bb9ac1b8`): Acesso irrestrito a configurações, todos os casos e rotinas manuais de alerta.
     - `GESTOR` (UUID `e8ebc3c5-6d76-4140-a83e-78abe3c5a1c5`): Gestão de equipe e casos sob sua responsabilidade ou de seus subordinados diretos.
     - `OPERACIONAL` (UUID `4ff41219-3ba6-495a-9b67-e945b70c2323`): Execução e acompanhamento exclusivo dos casos próprios.
3. **`public.core_usuarios`**:
   - `id`: UUID (PK, o identificador corporativo persistido em `responsavel_core_usuario_id` e `executor_core_usuario_id`).
   - `auth_user_id`: UUID (FK para `auth.users.id`, unívoco via constraint `core_usuarios_auth_user_id_key`).
   - `nome`: `text` (Nome civil/corporativo do operador).
   - `email`: `text` (E-mail corporativo normalizado em minúsculas).
   - `ativo`: `boolean` (Bloqueio mestre de usuário corporativo).
   - `gestor_id`: UUID (FK auto-referenciada para `core_usuarios.id` com índice `idx_core_usuarios_gestor_id`). **Este campo é a definição única e oficial da equipe/hierarquia no core.**
4. **`public.core_usuario_sistemas`**:
   - `id`: UUID (PK).
   - `usuario_id`: UUID (FK `core_usuarios.id`).
   - `sistema_id`: UUID (FK `core_sistemas.id`).
   - `perfil_id`: UUID (FK `core_perfis.id`).
   - `ativo`: `boolean` (Permissão de acesso ativada/desativada por sistema).
   - Constraint de unicidade: `core_usuario_sistemas_usuario_sistema_uk (usuario_id, sistema_id)`.

### 1.2 Onde a Equipe do Gestor está Definida no Core (SEM Hierarquia Local)

- **Vínculo Oficial:** A hierarquia entre gestores e subordinados está mapeada exclusivamente na coluna `core_usuarios.gestor_id`.
- Um usuário $U$ pertence à equipe do Gestor $G$ se e somente se:
  $$U.\text{gestor\_id} = G.\text{id}$$
- A identificação do usuário logado no core ocorre via:
  $$auth.uid() \rightarrow core\_usuarios.\text{auth\_user\_id} = auth.uid() \implies core\_usuarios.\text{id}$$
- **Constatação Crítica:** O Ricci Task **não possui e não deve criar tabelas locais de equipe** (ex.: `task_equipes`, `departamentos_usuarios` ou equivalentes). Toda a consulta hierárquica baseia-se diretamente em `core_usuarios.gestor_id`.
- No Conectaí, existia herança legada em `profiles.gestor_id` e `core_managed_operational_ids()`; no Ricci Task, a consulta deve ser direta sobre `core_usuarios` unindo com `task_tarefas.responsavel_core_usuario_id` e `task_tarefas.executor_core_usuario_id`.

---

## 2. Regra de Negócio Proposta

A proposta padroniza as regras de acesso em 3 níveis estritos:

| Perfil Central    | Escopo de Visualização e Edição de Casos                                                                                                            | Providências e Ações Operacionais                                 | Casos Arquivados                                     |
| :---------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------- | :--------------------------------------------------- |
| **ADMINISTRADOR** | Todos os casos de todos os nomes de controle                                                                                                        | Irrestrito (criar, editar, excluir providências de qualquer caso) | Acesso irrestrito a todos os arquivados              |
| **GESTOR**        | Casos onde seja **Responsável** ou **Executor**, OU casos onde o Responsável ou Executor pertença à sua **equipe direta** (`gestor_id = gestor.id`) | Apenas nos casos sob seu escopo (próprios + equipe)               | Apenas arquivados sob seu escopo (próprios + equipe) |
| **OPERACIONAL**   | Casos onde seja **Responsável** ou **Executor** ("casos próprios")                                                                                  | Apenas providências de seus casos próprios                        | Apenas arquivados de seus casos próprios             |

### 2.1 Conceito Estrito de "Caso Próprio"

Um caso é considerado "próprio" do usuário central $C$ se:
$$(\text{tarefa}.\text{responsavel\_core\_usuario\_id} = C) \lor (\text{tarefa}.\text{executor\_core\_usuario\_id} = C)$$

### 2.2 Conceito Estrito de "Caso da Equipe" (para GESTOR)

Um caso pertence à equipe do gestor $G$ se:
$$\text{tarefa}.\text{responsavel\_core\_usuario\_id} \in \{U \mid U.\text{gestor\_id} = G\} \lor \text{tarefa}.\text{executor\_core\_usuario\_id} \in \{U \mid U.\text{gestor\_id} = G\}$$

### 2.3 Imediatismo da Mudança de Atribuição

Como as permissões de SELECT, UPDATE e das tabelas filhas (providências, comentários, anexos) são avaliadas contra os IDs centrais gravados em `task_tarefas`:

- No momento em que uma tarefa tem seu `responsavel_core_usuario_id` ou `executor_core_usuario_id` alterado no banco, o acesso anterior é revogado e o novo operador/gestor passa a ter acesso instantâneo na próxima requisição, sem necessidade de sincronização assíncrona ou reinício de sessão.

---

## 3. Identificação das Proteções Necessárias

Para garantir segurança ponta a ponta (defesa em profundidade), as proteções devem cobrir quatro camadas:

### 3.1 Camada 1: Frontend (React / Vite)

1. **Filtros e Visões na Listagem de Tarefas (`src/pages/Tarefas.tsx` e `src/pages/ControlesArquivados.tsx`):**
   - O hook `useAuth()` já resolve o `corePerfil` (`ADMINISTRADOR`, `GESTOR`, `OPERACIONAL`) e o `coreUser.id`.
   - Para perfil `OPERACIONAL`, a UI deve ocultar ou desabilitar o filtro global e aplicar visualmente o escopo "Meus Casos", sem exibir a opção de listar todos os casos da organização.
   - Para perfil `GESTOR`, a UI deve disponibilizar abas/filtros: "Meus Casos", "Casos da Minha Equipe" e "Todos Permitidos".
2. **Edição e Modal (`src/components/ControleModal.tsx`):**
   - Se um usuário `OPERACIONAL` tentar abrir diretamente uma URL ou caso do qual não é parte, a tela deve exibir erro de autorização ou impedir abertura.
3. **Menu e Configurações:**
   - Abas administrativas (ex.: `Configuracoes.tsx`, gestão de nomes de controle em `NomesControle.tsx`, disparos manuais) restritas estritamente para `corePerfil === 'ADMINISTRADOR'`.

### 3.2 Camada 2: Banco de Dados — Row Level Security (RLS)

Atualmente, as políticas RLS de `task_tarefas` e `task_providencias` utilizam:

```sql
-- Estado Atual em task_tarefas:
USING (true AND task_has_core_access())
```

Isso permite que qualquer usuário com acesso ao Ricci Task visualize e altere qualquer tarefa via chamadas REST/PostgREST diretas (bypass do frontend).

**Proteções RLS Necessárias na Implementação Futura:**

1. **Função Auxiliar `SECURITY DEFINER` de Resolução de Permissão de Caso:**
   - Criar uma função de escopo estável, ex.: `public.task_can_access_tarefa(p_tarefa_id uuid, p_modo text) -> boolean`.
   - A função avalia:
     1. Se o usuário autenticado (`auth.uid()`) é `ADMINISTRADOR` no `RICCI_TASK` $\rightarrow$ `true`.
     2. Se é `GESTOR` no `RICCI_TASK` $\rightarrow$ verifica se o `responsavel_core_usuario_id` ou `executor_core_usuario_id` da tarefa é o próprio gestor ou algum subordinado direto (`core_usuarios.gestor_id = gestor.id`).
     3. Se é `OPERACIONAL` no `RICCI_TASK` $\rightarrow$ verifica se `responsavel_core_usuario_id` ou `executor_core_usuario_id` é igual ao `core_usuarios.id` do chamador.
     4. Caso contrário $\rightarrow$ `false`.
2. **Políticas em `task_tarefas`:**
   - `SELECT`: `USING (task_can_access_tarefa(id, 'read'))`
   - `UPDATE`: `USING (task_can_access_tarefa(id, 'write')) WITH CHECK (task_can_access_tarefa(id, 'write'))`
   - `INSERT`: Administradores e Gestores podem inserir para qualquer um; Operacionais só podem inserir se forem definidos como Responsável ou Executor do novo caso.
3. **Políticas em `task_providencias`:**
   - `task_providencias` possui FK `tarefa_id`.
   - `SELECT`, `INSERT`, `UPDATE`, `DELETE`: `USING (task_can_access_tarefa(tarefa_id, 'write'))`.
4. **Políticas em Tabelas Auxiliares:**
   - `task_nomes_controle`, `task_status`, `task_tipos_prazo`: Leitura permitida para todos com `task_has_core_access()`; alteração/inclusão restrita a `ADMINISTRADOR`.

### 3.3 Camada 3: RPCs e Funções de Banco

1. **`task_listar_usuarios_core_elegiveis()`:**
   - Hoje retorna todos os usuários ativos do sistema para seleção nos selects de Responsável e Executor.
   - Administradores e Gestores precisam listar os operadores para atribuir casos.
   - Para Operacional, avaliar se a listagem deve ser completa (para atribuição/transferência) ou se operacionais têm restrição para reatribuir casos a terceiros.
2. **`task_controle_contadores_caso` / `task_definir_numero_caso`:**
   - O trigger `task_definir_numero_caso` roda automaticamente no `INSERT` da tarefa (`BEFORE INSERT`), garantindo numeração atômica independentemente do perfil.

### 3.4 Camada 4: Edge Functions com `SERVICE_ROLE_KEY` (Proteção contra Bypass)

Edge Functions utilizam a chave privilegiada `SUPABASE_SERVICE_ROLE_KEY`, que desativa o RLS internamente. Por essa razão, a autorização e o escopo de dados devem ser verificados explicitamente no código da Edge Function antes de qualquer consulta ou disparo:

1. **`notify-task-assignment`:**
   - **Chamador:** Já valida `verifyRicciTaskCaller(supabase, user.id)` garantindo vínculo ativo e perfil permitido (`ADMINISTRADOR`, `GESTOR`, `OPERACIONAL`).
   - **Proteção adicional de escopo:** Verificar se o chamador possui autorização para disparar notificação sobre aquele caso:
     - Se `ADMINISTRADOR` $\rightarrow$ permitido.
     - Se `GESTOR` $\rightarrow$ permitido apenas se o caso pertencer a si ou a sua equipe.
     - Se `OPERACIONAL` $\rightarrow$ permitido apenas se for o Responsável ou Executor do caso.
     - Isso impede que um operador autenticado chame `POST /functions/v1/notify-task-assignment` informando o UUID de uma tarefa confidencial de outra área.
2. **`notify-task-overdue`:**
   - Já possui autorização segregada em duas vias:
     - Segredo de cron estrito (`x-task-cron-secret` via `TASK_OVERDUE_CRON_SECRET`).
     - Execução manual restrita a usuários com perfil `ADMINISTRADOR` central no `RICCI_TASK` via `verifyRicciTaskAdmin()`. Usuários Gestores e Operacionais recebem 403. Mantém-se essa proteção irrestrita.

---

## 4. Ordem Segura de Implementação (Roadmap)

A migração deve ocorrer em etapas sequenciais para não interromper a operação e garantir compatibilidade com casos históricos:

```
[Etapa 1: Resolução de Usuário e Perfis no Contexto Central]
       │
       ▼
[Etapa 2: Funções Utilitárias de Banco (PL/pgSQL) para Hierarquia Core]
       │
       ▼
[Etapa 3: Tratamento de Casos Históricos com IDs Nulos ou Legados]
       │
       ▼
[Etapa 4: Aplicação de RLS em task_tarefas e task_providencias]
       │
       ▼
[Etapa 5: Endurecimento de Escopo nas Edge Functions]
       │
       ▼
[Etapa 6: Ajustes de UI no Frontend (Filtros e Menus por Perfil)]
       │
       ▼
[Etapa 7: Homologação e Testes de Invasão/Bypass da API]
```

### Detalhamento das Etapas:

1. **Etapa 1 — Resolução Central do Usuário Logado:**
   - Criação da função SQL estável `core_current_usuario_id()` que mapeia `auth.uid()` para `core_usuarios.id` e `core_perfis.codigo`.
2. **Etapa 2 — Criação da Função de Hierarquia de Casos:**
   - Criar `task_can_access_tarefa(p_tarefa_id uuid, p_operacao text)` que encapsula as regras de Administrador, Gestor (via `core_usuarios.gestor_id`) e Operacional.
3. **Etapa 3 — Validação dos Casos Históricos:**
   - Verificar casos antigos onde `responsavel_core_usuario_id` ou `executor_core_usuario_id` possam estar nulos. Definir comportamento para casos sem atribuição:
     - Casos sem responsável/executor atribuído devem ser visíveis para Administradores e Gestores gerais, evitando que se tornem "invisíveis" no sistema.
4. **Etapa 4 — Atualização das Políticas RLS:**
   - Substituir as políticas abertas `(true AND task_has_core_access())` pelas políticas estritas baseadas na função de acesso.
5. **Etapa 5 — Validação de Escopo nas Edge Functions:**
   - Adicionar checagem de pertencimento do caso ao chamador em `notify-task-assignment`.
6. **Etapa 6 — Ajustes no Frontend:**
   - Exibição de mensagens amigáveis de acesso restrito, abas de equipe para gestores e ocultação de controles de outros usuários para operacionais.
7. **Etapa 7 — Verificação e Testes:**
   - Testes de chamadas diretas via PostgREST simulando token de usuário Operacional tentando acessar ou alterar tarefa de terceiro (garantir retorno vazio ou 403).

---

_Fim do documento de diagnóstico._
