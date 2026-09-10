export interface TaskStatusRecord {
  id: string
  codigo: string
  nome: string
  ordem: number
  finaliza: boolean
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface TaskTipoPrazoRecord {
  id: string
  codigo: string
  nome: string
  ordem: number
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface TaskResponsavelRecord {
  id: string
  nome: string
  tipo: 'equipe' | 'terceiro'
  ordem: number
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface LegaldeskUsuarioRecord {
  id: string
  source_id: string
  nome: string
  sigla: string | null
  email: string | null
  ativo: boolean | null
  tipo_usuario: string | null
  departamento: string | null
}

export type ResponsavelGrupo = 'interno' | 'catalogo'

export interface ResponsavelOption {
  value: string // formato: "interno:UUID" ou "catalogo:UUID"
  id: string
  grupo: ResponsavelGrupo
  nome: string
  detalhe?: string
  tipo?: 'equipe' | 'terceiro' | 'interno'
}

export interface TaskPrazoRecord {
  id: string
  tarefa_id: string
  data_prazo: string // YYYY-MM-DD
  tipo_prazo_id: string | null
  descricao: string | null
  principal: boolean
  ativo: boolean
  created_at: string
  created_by?: string | null
  updated_at: string
  updated_by?: string | null
  tipo_prazo?: TaskTipoPrazoRecord | null
}

export interface TaskAndamentoRecord {
  id: string
  tarefa_id: string
  data_andamento: string // YYYY-MM-DD
  descricao: string
  created_at: string
  created_by?: string | null
  updated_at: string
  updated_by?: string | null
  autor_nome?: string | null
}

export interface TaskControleRecord {
  id: string
  controle_cliente: string | null
  controle_ricci: string | null
  identificacao_caso: string
  status_id: string
  descricao_status: string | null
  proximas_providencias: string | null
  responsavel_legaldesk_id: string | null
  responsavel_id: string | null
  follow_up: string | null // YYYY-MM-DD
  data_referencia: string // YYYY-MM-DD
  created_at: string
  created_by?: string | null
  updated_at: string
  updated_by?: string | null
  deleted_at?: string | null
  deleted_by?: string | null

  // Relações resolvidas
  status?: TaskStatusRecord | null
  responsavel_interno?: LegaldeskUsuarioRecord | null
  responsavel_catalogo?: TaskResponsavelRecord | null
  prazos?: TaskPrazoRecord[]
  andamentos?: TaskAndamentoRecord[]

  // Auxiliares calculados para a listagem
  responsavel_nome?: string
  responsavel_tipo_badge?: string
  prazo_destaque?: TaskPrazoRecord | null // principal ativo ou próximo ativo
}

export interface SaveControleInput {
  id?: string
  controle_cliente?: string | null
  controle_ricci?: string | null
  identificacao_caso: string
  status_id: string
  descricao_status?: string | null
  proximas_providencias?: string | null
  responsavel_legaldesk_id?: string | null
  responsavel_id?: string | null
  follow_up?: string | null
  data_referencia?: string
}

export interface SavePrazoInput {
  id?: string
  tarefa_id: string
  data_prazo: string
  tipo_prazo_id?: string | null
  descricao?: string | null
  principal: boolean
  ativo?: boolean
}

export interface SaveAndamentoInput {
  id?: string
  tarefa_id: string
  data_andamento: string
  descricao: string
}

export interface DashboardMetrics {
  emAndamento: number
  aguardandoAutorizacao: number
  prazosVencidos: number
  followUpsVencidos: number
  concluidos: number
  total: number
}

// Configurações salvas apenas para preferências de visualização do app
export type ThemeMode = 'claro' | 'escuro'
export type DefaultControleViewFilter =
  | 'todos'
  | 'em_andamento'
  | 'aguardando_autorizacao'
  | 'vencidos'
  | 'concluidos'

export interface AppSettings {
  theme: ThemeMode
  defaultView: DefaultControleViewFilter
  notificationsEnabled: boolean
}
