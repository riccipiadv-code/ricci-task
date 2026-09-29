# Mapeamento e Especificação de Políticas RLS do Ricci Task

Este documento complementa o diagnóstico técnico (`docs/diagnostico-permissoes.md`) e detalha as expressões lógicas exatas, tabelas, operações (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) e a ordem recomendada de aplicação das políticas de Row-Level Security (RLS) no Supabase.

> **IMPORTANTE**: Este documento é estritamente descritivo e analítico. **Nenhuma migração ou execução de SQL foi disparada automaticamente**. O SQL pronto para execução manual no Supabase será fornecido e executado separadamente pelo responsável técnico.

---

## 1. Princípios e Regras de Negócio

1. **Autoridade Central de Autenticação e Perfis**:
   - A identificação do usuário corporativo autenticado é obtida via:
     `auth.uid() = core_usuarios.auth_user_id`
   - O perfil ativo no Ricci Task é verificado via:
     `core_usuario_sistemas` associado a `core_sistemas.codigo = 'RICCI_TASK'` e `core_perfis.ativo = true`.
   - Perfis canônicos:
     - `ADMINISTRADOR`: Acesso irrestrito a todos os registros, menus, configurações e casos (ativos e arquivados).
     - `GESTOR`: Acesso a casos próprios e casos cuja equipe direta seja liderada pelo gestor.
     - `OPERACIONAL`: Acesso restrito exclusivamente aos casos em que é Responsável ou Executor pelo seu ID central (`core_usuarios.id`).

2. **Definição de "Próprio" e Hierarquia**:
   - **Próprio**: O `core_usuarios.id` do usuário logado coincide com `task_tarefas.responsavel_core_usuario_id` OU `task_tarefas.executor_core_usuario_id`.
   - **Equipe Direta (Gestor)**: A equipe direta é estrita a um nível (`core_usuarios.gestor_id = gestor_core_id`). Sem hierarquia em árvore recursiva ou estruturas locais.
   - **Histórico**: Casos históricos em fase de transição (onde `responsavel_core_usuario_id` ou `executor_core_usuario_id` ainda não estejam preenchidos) permanecem visíveis ao Administrador e ao Gestor correspondente via contingência histórica segura.

3. **Mesma Regra para Todas as Telas e Ações**:
   - Casos ativos e casos arquivados (`arquivado_at IS NOT NULL`).
   - Leitura (`SELECT`), inclusão (`INSERT`), edição/atribuição (`UPDATE`).
   - Providências (`task_providencias`): o escopo de acesso é herdado da tarefa-pai (`task_tarefas`).

---

## 2. Helper Functions Recomendadas (PostgreSQL)

Para garantir alto desempenho e evitar reconsultas pesadas em cada linha avaliada pelo RLS, recomenda-se criar funções utilitárias `SECURITY DEFINER` e `STABLE`:

1. `public.task_current_core_user_id() RETURNS uuid`:
   - Retorna o `id` de `core_usuarios` onde `auth_user_id = auth.uid()` e `ativo = true`.
2. `public.task_current_core_perfil() RETURNS text`:
   - Retorna o código do perfil (`ADMINISTRADOR`, `GESTOR`, `OPERACIONAL`) do usuário atual em `core_usuario_sistemas` para o sistema `RICCI_TASK` (apenas se usuário, vínculo, sistema e perfil estiverem ativos).
3. `public.task_is_admin() RETURNS boolean`:
   - Retorna `true` se `task_current_core_perfil() = 'ADMINISTRADOR'`.
4. `public.task_can_access_tarefa(tarefa_responsavel_id uuid, tarefa_executor_id uuid) RETURNS boolean`:
   - Avalia se o usuário atual pode acessar uma tarefa com base nos IDs centrais:
     - Se `task_is_admin()`: `true`.
     - Se `task_current_core_perfil() = 'GESTOR'`:
       - `true` se usuário for o responsável ou executor;
       - OU `true` se o responsável ou executor tiverem `core_usuarios.gestor_id = task_current_core_user_id()`;
       - OU `true` para casos históricos não migrados se o gestor tiver membros sob sua liderança.
     - Se `task_current_core_perfil() = 'OPERACIONAL'`:
       - `true` se `tarefa_responsavel_id = task_current_core_user_id()` OU `tarefa_executor_id = task_current_core_user_id()`.
     - Caso contrário: `false`.

---

## 3. Políticas RLS Necessárias por Tabela

### 3.1. Tabela `task_tarefas`

- **SELECT** (`task_tarefas_select_policy`):
  - **Lógica**:
    ```sql
    task_is_admin()
    OR (
      task_current_core_perfil() = 'GESTOR'
      AND (
        responsavel_core_usuario_id = task_current_core_user_id()
        OR executor_core_usuario_id = task_current_core_user_id()
        OR responsavel_core_usuario_id IN (
          SELECT id FROM core_usuarios WHERE gestor_id = task_current_core_user_id() AND ativo = true
        )
        OR executor_core_usuario_id IN (
          SELECT id FROM core_usuarios WHERE gestor_id = task_current_core_user_id() AND ativo = true
        )
        -- Tolerância de transição para casos históricos sem ID central
        OR (responsavel_core_usuario_id IS NULL AND executor_core_usuario_id IS NULL)
      )
    )
    OR (
      task_current_core_perfil() = 'OPERACIONAL'
      AND (
        responsavel_core_usuario_id = task_current_core_user_id()
        OR executor_core_usuario_id = task_current_core_user_id()
      )
    )
    ```

- **INSERT** (`task_tarefas_insert_policy`):
  - **WITH CHECK**:
    ```sql
    task_is_admin()
    OR (
      task_current_core_perfil() = 'GESTOR'
      AND (
        responsavel_core_usuario_id = task_current_core_user_id()
        OR executor_core_usuario_id = task_current_core_user_id()
        OR responsavel_core_usuario_id IN (
          SELECT id FROM core_usuarios WHERE gestor_id = task_current_core_user_id() AND ativo = true
        )
        OR executor_core_usuario_id IN (
          SELECT id FROM core_usuarios WHERE gestor_id = task_current_core_user_id() AND ativo = true
        )
      )
    )
    OR (
      task_current_core_perfil() = 'OPERACIONAL'
      AND (
        responsavel_core_usuario_id = task_current_core_user_id()
        OR executor_core_usuario_id = task_current_core_user_id()
      )
    )
    ```

- **UPDATE** (`task_tarefas_update_policy`):
  - **USING**: Mesma expressão do `SELECT` (o chamador só atualiza casos dentro do seu escopo atual).
  - **WITH CHECK**:
    - Para `ADMINISTRADOR`: permite qualquer alteração válida.
    - Para `GESTOR`: permite salvar se os novos responsável/executor continuarem dentro de si mesmo ou de sua equipe direta. Se reatribuir para alguém de fora, o gestor perde o acesso no instante seguinte.
    - Para `OPERACIONAL`: permite atualizar se continuar sendo responsável ou executor; caso transfira ambos para outro usuário, o acesso é revogado imediatamente após o commit.

- **DELETE** (`task_tarefas_delete_policy`):
  - Restrito a `ADMINISTRADOR` (a exclusão padrão no Ricci Task é lógica via `deleted_at`, que passa por `UPDATE`).

---

### 3.2. Tabela `task_providencias`

As providências herdam o escopo de `task_tarefas`.

- **SELECT** (`task_providencias_select_policy`):
  - **USING**:
    ```sql
    EXISTS (
      SELECT 1 FROM task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
      -- A política de SELECT em task_tarefas já restringe as tarefas visíveis
    )
    ```

- **INSERT / UPDATE / DELETE** (`task_providencias_write_policy`):
  - **USING / WITH CHECK**:
    ```sql
    EXISTS (
      SELECT 1 FROM task_tarefas t
      WHERE t.id = task_providencias.tarefa_id
    )
    ```

---

### 3.3. Tabelas de Catálogo e Apoio

- `task_nomes_controle`:
  - **SELECT**: Todos os usuários autenticados com acesso ao sistema (`ADMINISTRADOR`, `GESTOR`, `OPERACIONAL`).
  - **INSERT / UPDATE / DELETE**: Restrito a `ADMINISTRADOR` (Gestores e Operacionais não realizam gestão da tabela).
- `task_status`, `task_status_providencia`, `task_tipos_prazo`:
  - **SELECT**: Todos os usuários autenticados no Ricci Task.
  - **INSERT / UPDATE / DELETE**: Restrito a `ADMINISTRADOR`.
- `task_email_eventos`:
  - Escrita e leitura restritas ao fluxo de notificações do backend e administradores.

---

## 4. Ordem Segura de Aplicação (Plano de Ativação)

Quando o administrador for executar o SQL manual no Supabase, a seguinte ordem deve ser rigorosamente seguida para evitar bloqueios acidentais e indisponibilidade:

1. **Passo 1: Criar/Validar Funções Auxiliares (`SECURITY DEFINER`)**:
   - `task_current_core_user_id()`
   - `task_current_core_perfil()`
   - `task_is_admin()`
   - Testar o retorno das funções com usuários de teste de cada perfil.

2. **Passo 2: Habilitar RLS em Tabelas Auxiliares Primeiro**:
   - `task_nomes_controle`, `task_status`, `task_status_providencia`, `task_tipos_prazo`.
   - Validar que a leitura continua livre para todos os perfis.

3. **Passo 3: Habilitar RLS em `task_providencias`**:
   - Aplicar política baseada em `EXISTS (SELECT 1 FROM task_tarefas WHERE id = tarefa_id)`.

4. **Passo 4: Habilitar RLS em `task_tarefas` com Cláusula de Transição Ativa**:
   - Manter a regra de tolerância para casos com `responsavel_core_usuario_id IS NULL AND executor_core_usuario_id IS NULL`, permitindo acesso a Administrador e Gestores para não "esconder" casos históricos legados.

5. **Passo 5: Validação em Produção com Usuários Reais**:
   - Logar com usuário Operacional e checar se visualiza somente seus casos.
   - Logar com Gestor e checar visualização de seus casos e equipe direta (`gestor_id`).
   - Logar com Administrador e checar visualização global e telas administrativas.

6. **Passo 6: Remoção da Cláusula de Transição (Futuro)**:
   - Somente após conclusão do script manual de preenchimento dos IDs centrais legados.
