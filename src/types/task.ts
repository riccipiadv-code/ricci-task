// Tipos do Domínio Ricci Task — Fase Controles de Casos
// Alinhado exclusivamente com as tabelas task_* no Supabase

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

export interface TaskResponsavelControleRecord {
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

export interface TaskExecutorRecord {
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

export interface TaskProvidenciaRecord {
  id: string
  tarefa_id: string
  providencia: string
  prazo_conclusao: string
  tipo_prazo_id: string
  status_id: string
  ordem: number
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
  identificacao_caso: string
  status_id: string
  data_autorizacao: string | null
  prazo_conclusao: string | null
  responsavel_controle_id: string
  executor_id: string | null
  pasta_cliente: string | null
  pasta_ricci: string | null
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
  deleted_at: string | null
  deleted_by: string | null

  // Joins hidratados para a UI
  nome_controle?: string | null
  responsavel_nome?: string | null
  executor_nome?: string | null
  status?: TaskStatusRecord | null
  responsavel_controle?: TaskResponsavelControleRecord | null
  executor?: TaskExecutorRecord | null

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
  responsavel_controle_id: string
  executor_id: string
  pasta_cliente?: string | null
  pasta_ricci?: string | null
}

export interface SaveProvidenciaInput {
  id?: string
  tarefa_id: string
  providencia: string
  prazo_conclusao: string
  tipo_prazo_id: string
  status_id: string
  ordem?: number
}

export interface DraftProvidencia {
  id?: string
  tempId?: string
  providencia: string
  prazo_conclusao: string
  tipo_prazo_id: string
  status_id: string
  ordem?: number
  deleted?: boolean
}

export interface SaveNomeControleInput {
  id?: string
  nome: string
  ativo?: boolean
}

export interface SaveResponsavelControleInput {
  id?: string
  nome: string
  ativo?: boolean
}

export interface SaveExecutorInput {
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
