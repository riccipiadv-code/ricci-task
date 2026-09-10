import { Task, Settings, RicciTaskData } from '@/types/task'

const STORAGE_KEY = 'ricci_task_data'
const CHANGE_EVENT_NAME = 'ricci_task_data_changed'

const DEFAULT_SETTINGS: Settings = {
  theme: 'claro',
  defaultView: 'todas',
  notificationsEnabled: true,
}

// Data atual no formato YYYY-MM-DD para garantir tarefas de hoje e datas realistas
const getIsoDateOffset = (offsetDays: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().split('T')[0]
}

const getTodayIsoDate = (): string => {
  return new Date().toISOString().split('T')[0]
}

export const INITIAL_TASKS: Task[] = [
  {
    id: 'seed-task-1',
    title: 'Planejar roadmap de produto Ricci Task v2',
    description: 'Definir arquitetura para sincronização em nuvem e autenticação de usuários.',
    category: 'trabalho',
    priority: 'alta',
    status: 'em_andamento',
    dueDate: getIsoDateOffset(2),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
  },
  {
    id: 'seed-task-2',
    title: 'Revisar relatório financeiro mensal',
    description:
      'Conferir despesas fixas, assinaturas de software e projeção para o próximo trimestre.',
    category: 'trabalho',
    priority: 'media',
    status: 'pendente',
    dueDate: getIsoDateOffset(3),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
  },
  {
    id: 'seed-task-3',
    title: 'Finalizar módulo de TypeScript avançado',
    description:
      'Assistir às últimas aulas sobre utility types, generics complexos e inferência de tipos.',
    category: 'estudos',
    priority: 'alta',
    status: 'concluida',
    dueDate: getTodayIsoDate(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  },
  {
    id: 'seed-task-4',
    title: 'Comprar itens da feira e mercado',
    description: 'Frutas da estação, legumes frescos, café em grão e aveia.',
    category: 'pessoal',
    priority: 'baixa',
    status: 'pendente',
    dueDate: getIsoDateOffset(1),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
  {
    id: 'seed-task-5',
    title: 'Organizar biblioteca de design tokens',
    description:
      'Mapear cores semânticas primárias, espaçamentos e raios de borda para novo projeto.',
    category: 'outros',
    priority: 'media',
    status: 'concluida',
    dueDate: getTodayIsoDate(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
]

function emitChangeEvent() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT_NAME))
  }
}

function readData(): RicciTaskData {
  if (typeof window === 'undefined') {
    return { tasks: INITIAL_TASKS, settings: DEFAULT_SETTINGS }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const initial: RicciTaskData = {
        tasks: INITIAL_TASKS,
        settings: DEFAULT_SETTINGS,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
      return initial
    }
    const parsed = JSON.parse(raw) as RicciTaskData
    // Garantir estrutura mínima
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : INITIAL_TASKS
    const settings = parsed.settings
      ? { ...DEFAULT_SETTINGS, ...parsed.settings }
      : DEFAULT_SETTINGS
    return { tasks, settings }
  } catch (error) {
    console.error('Erro ao ler ricci_task_data do localStorage:', error)
    return { tasks: INITIAL_TASKS, settings: DEFAULT_SETTINGS }
  }
}

function writeData(data: RicciTaskData): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    emitChangeEvent()
  } catch (error) {
    console.error('Erro ao salvar ricci_task_data no localStorage:', error)
  }
}

export const taskService = {
  subscribe(callback: () => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const handler = () => callback()
    window.addEventListener(CHANGE_EVENT_NAME, handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener(CHANGE_EVENT_NAME, handler)
      window.removeEventListener('storage', handler)
    }
  },

  getTasks(): Task[] {
    return readData().tasks
  },

  getTaskById(id: string): Task | undefined {
    return readData().tasks.find((t) => t.id === id)
  },

  saveTask(taskData: Omit<Task, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Task {
    const data = readData()
    const now = new Date().toISOString()
    const newTask: Task = {
      ...taskData,
      id: taskData.id || `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: taskData.createdAt || now,
    }

    const updatedTasks = [newTask, ...data.tasks]
    writeData({ ...data, tasks: updatedTasks })
    return newTask
  },

  updateTask(id: string, updates: Partial<Omit<Task, 'id'>>): Task {
    const data = readData()
    const index = data.tasks.findIndex((t) => t.id === id)
    if (index === -1) {
      throw new Error(`Tarefa com ID ${id} não encontrada.`)
    }

    const updatedTask: Task = {
      ...data.tasks[index],
      ...updates,
    }

    const updatedTasks = [...data.tasks]
    updatedTasks[index] = updatedTask
    writeData({ ...data, tasks: updatedTasks })
    return updatedTask
  },

  deleteTask(id: string): boolean {
    const data = readData()
    const initialLength = data.tasks.length
    const filtered = data.tasks.filter((t) => t.id !== id)
    if (filtered.length === initialLength) return false
    writeData({ ...data, tasks: filtered })
    return true
  },

  getSettings(): Settings {
    return readData().settings
  },

  saveSettings(updates: Partial<Settings>): Settings {
    const data = readData()
    const updatedSettings: Settings = {
      ...data.settings,
      ...updates,
    }
    writeData({ ...data, settings: updatedSettings })
    return updatedSettings
  },

  seedData(): void {
    const data = readData()
    writeData({
      tasks: INITIAL_TASKS,
      settings: data.settings || DEFAULT_SETTINGS,
    })
  },

  resetAllData(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
    writeData({
      tasks: INITIAL_TASKS,
      settings: DEFAULT_SETTINGS,
    })
  },

  exportData(): string {
    const data = readData()
    return JSON.stringify(data, null, 2)
  },
}
