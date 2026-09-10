export type TaskCategory = 'trabalho' | 'pessoal' | 'estudos' | 'outros'
export type TaskPriority = 'baixa' | 'media' | 'alta'
export type TaskStatus = 'pendente' | 'em_andamento' | 'concluida'

export interface Task {
  id: string
  title: string
  description: string
  category: TaskCategory
  priority: TaskPriority
  status: TaskStatus
  dueDate: string // ISO string YYYY-MM-DD or full ISO
  createdAt: string // ISO string
}

export type ThemeMode = 'claro' | 'escuro'
export type DefaultViewFilter = 'todas' | 'pendentes' | 'concluidas'

export interface Settings {
  theme: ThemeMode
  defaultView: DefaultViewFilter
  notificationsEnabled: boolean
}

export interface RicciTaskData {
  tasks: Task[]
  settings: Settings
}
