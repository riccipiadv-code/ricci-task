// Tipos do Domínio Ricci Task — Fase Controles de Casos
// Alinhado exclusivamente com as tabelas task_* no Supabase (task_usuarios como única fonte de usuários)

export interface TaskStatusRecord {
  id: string
  codigo: string
  nome: string
  ordem: number
  finaliza: boolean
  ativo: boolean
  created_at?: string
  created_by?: string | null
  updated_at?: string
  updated_by?: string | null
}

export interface TaskStatusProvidenciaRecord {
  id: string
  codigo: string
  nome: string
  ordem: number
  finaliza: boolean
  ativo: boolean
  created_at?: string
  created_by?: string | null
  updated_at?: string
  updated_by?: string | null
}

export interface TaskTipoPrazoRecord {
  id: string
  codigo: string
  nome: string
  ordem: number
  ativo: boolean
  created_at?: string
  created_by?: string | null
  updated_at?: string
  updated_by?: string | null
}

export interface TaskNomeControleRecord {
  id: string
  nome: string
  nome_normalizado?: string
  ativo: boolean
  created_at?: string
  created_by?: string | null
  updated_at?: string
  updated_by?: string | null
  deleted_at?: string | null
  deleted_by?: string | null
}

export interface TaskUsuarioAtivoRecord {
  id: string // core_usuarios.id
  nome: string
  email?: string
  ativo?: boolean
  core_usuario_id?: string | null
  task_usuario_id?: string | null // mantido opcional para retrocompatibilidade (token histórico)
}

export interface TaskUsuarioRecord {
  id: string
  nome: string
  email: string
  ativo: boolean
  core_usuario_id?: string | null
  created_at?: string
  updated_at?: string
}

export interface SaveUsuarioInput {
  id?: string
  nome: string
  email: string
  ativo?: boolean
}

export interface TaskProvidenciaRecord {
  id: string
  tarefa_id: string
  providencia: string
  prazo_conclusao: string
  tipo_prazo_id: string
  status_id: string
  ordem: number
  data_conclusao?: string | null
  email_alertas?: boolean
  email_alerta_inclusao?: boolean
  email_alerta_atraso?: boolean
  email_alerta_atualizacao?: boolean
  created_at?: string
  created_by?: string | null
  updated_at?: string
  updated_by?: string | null
  deleted_at?: string | null
  deleted_by?: string | null

  // Relacionamentos expandidos
  tipo_prazo?: TaskTipoPrazoRecord | null
  status?: TaskStatusProvidenciaRecord | null
}

export interface TaskControleRecord {
  id: string
  nome_controle_id: string
  numero_caso: number
  identificacao_caso: string
  status_id: string
  data_autorizacao: string | null
  prazo_conclusao: string | null
  responsavel_usuario_id?: string | null // opcional e nullable (tokens históricos)
  executor_usuario_id?: string | null // opcional e nullable (tokens históricos)
  responsavel_core_usuario_id: string // Autoridade definitiva obrigatória
  executor_core_usuario_id: string // Autoridade definitiva obrigatória
  pasta_cliente: string | null
  pasta_ricci: string | null
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
  deleted_at: string | null
  deleted_by: string | null
  arquivado_at?: string | null

  // Hidratados para a UI
  nome_controle?: string | null
  responsavel_nome?: string | null
  executor_nome?: string | null
  status?: TaskStatusRecord | null
  responsavel_usuario?: TaskUsuarioAtivoRecord | null
  executor_usuario?: TaskUsuarioAtivoRecord | null

  // Providências vinculadas
  providencias?: TaskProvidenciaRecord[]
  // Próxima providência aberta calculada para a listagem (status com finaliza = false)
  proxima_providencia?: TaskProvidenciaRecord | null
}

export interface SaveControleInput {
  id?: string
  nome_controle_id: string
  identificacao_caso: string
  status_id: string
  data_autorizacao?: string | null
  prazo_conclusao?: string | null
  responsavel_usuario_id?: string | null // opcional e nullable (tokens históricos)
  executor_usuario_id?: string | null // opcional e nullable (tokens históricos)
  responsavel_core_usuario_id: string // Campo central obrigatório
  executor_core_usuario_id: string // Campo central obrigatório
  pasta_cliente?: string | null
  pasta_ricci?: string | null
  providencias?: Omit<SaveProvidenciaInput, 'tarefa_id'>[]
  motivo_transicao?: string | null
}

export interface SaveControleResult {
  controle: TaskControleRecord
  transicao_id?: string | null
  perda_acesso?: boolean
  providencias?: TaskProvidenciaRecord[]
}

export interface SaveProvidenciaInput {
  id?: string
  temp_id?: string
  tempId?: string
  tarefa_id: string
  providencia: string
  prazo_conclusao: string
  tipo_prazo_id: string
  status_id: string
  ordem?: number
  data_conclusao?: string | null
  email_alertas?: boolean
  email_alerta_inclusao?: boolean
  email_alerta_atraso?: boolean
  email_alerta_atualizacao?: boolean
}

export interface DraftProvidencia {
  id?: string
  tempId?: string
  providencia: string
  prazo_conclusao: string
  tipo_prazo_id: string
  status_id: string
  ordem?: number
  data_conclusao?: string | null
  email_alertas?: boolean
  email_alerta_inclusao?: boolean
  email_alerta_atraso?: boolean
  email_alerta_atualizacao?: boolean
  deleted?: boolean
}

export interface SaveNomeControleInput {
  id?: string
  nome: string
  ativo?: boolean
}

export interface ControleMetrics {
  total: number
  pendentes: number
  emAndamento: number
  prazosVencidos: number
  concluidos: number
}

export type DefaultControleViewFilter =
  | 'todos'
  | 'pendente'
  | 'em_andamento'
  | 'vencidos'
  | 'concluidos'

export type ThemeMode = 'claro' | 'escuro'

export interface UserSettings {
  theme: ThemeMode
  defaultView: DefaultControleViewFilter
  notificationsEnabled: boolean
}
