import { TaskCategory, TaskPriority, TaskStatus } from '@/types/task'

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  trabalho: 'Trabalho',
  pessoal: 'Pessoal',
  estudos: 'Estudos',
  outros: 'Outros',
}

export const CATEGORY_COLORS: Record<
  TaskCategory,
  { bg: string; text: string; border: string; rawHex: string }
> = {
  trabalho: {
    bg: 'bg-[#5B5BD6]/10 dark:bg-[#5B5BD6]/20',
    text: 'text-[#5B5BD6] dark:text-[#7C7CF8]',
    border: 'border-[#5B5BD6]/30',
    rawHex: '#5B5BD6',
  },
  pessoal: {
    bg: 'bg-[#EC4899]/10 dark:bg-[#EC4899]/20',
    text: 'text-[#EC4899] dark:text-[#F472B6]',
    border: 'border-[#EC4899]/30',
    rawHex: '#EC4899',
  },
  estudos: {
    bg: 'bg-[#06B6D4]/10 dark:bg-[#06B6D4]/20',
    text: 'text-[#06B6D4] dark:text-[#22D3EE]',
    border: 'border-[#06B6D4]/30',
    rawHex: '#06B6D4',
  },
  outros: {
    bg: 'bg-[#8B5CF6]/10 dark:bg-[#8B5CF6]/20',
    text: 'text-[#8B5CF6] dark:text-[#A78BFA]',
    border: 'border-[#8B5CF6]/30',
    rawHex: '#8B5CF6',
  },
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
}

export const PRIORITY_COLORS: Record<
  TaskPriority,
  { bg: string; text: string; dot: string; rawHex: string }
> = {
  alta: {
    bg: 'bg-[#EF4444]/10 dark:bg-[#EF4444]/20',
    text: 'text-[#EF4444] dark:text-[#F87171]',
    dot: 'bg-[#EF4444]',
    rawHex: '#EF4444',
  },
  media: {
    bg: 'bg-[#F59E0B]/10 dark:bg-[#F59E0B]/20',
    text: 'text-[#D97706] dark:text-[#FBBF24]',
    dot: 'bg-[#F59E0B]',
    rawHex: '#F59E0B',
  },
  baixa: {
    bg: 'bg-[#10B981]/10 dark:bg-[#10B981]/20',
    text: 'text-[#10B981] dark:text-[#34D399]',
    dot: 'bg-[#10B981]',
    rawHex: '#10B981',
  },
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em Andamento',
  concluida: 'Concluída',
}

export const STATUS_COLORS: Record<TaskStatus, { bg: string; text: string; border: string }> = {
  pendente: {
    bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-500/20',
  },
  em_andamento: {
    bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/20',
  },
  concluida: {
    bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-500/20',
  },
}

/**
 * Formata data ISO para dd/mm/aaaa
 */
export function formatDateBR(isoString: string): string {
  if (!isoString) return ''
  try {
    const cleanDate = isoString.split('T')[0]
    const [year, month, day] = cleanDate.split('-')
    if (year && month && day) {
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`
    }
    const d = new Date(isoString)
    return d.toLocaleDateString('pt-BR')
  } catch {
    return isoString
  }
}

/**
 * Verifica se a data de vencimento já passou (ontem ou antes) e a tarefa não está concluída
 */
export function isTaskOverdue(dueDateIso: string, status: TaskStatus): boolean {
  if (status === 'concluida' || !dueDateIso) return false
  try {
    const cleanDate = dueDateIso.split('T')[0]
    const today = new Date().toISOString().split('T')[0]
    return cleanDate < today
  } catch {
    return false
  }
}

/**
 * Retorna se a data é hoje
 */
export function isToday(isoString: string): boolean {
  if (!isoString) return false
  const cleanDate = isoString.split('T')[0]
  const today = new Date().toISOString().split('T')[0]
  return cleanDate === today
}

/**
 * Retorna a saudação do dia baseada na hora local
 */
export function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) {
    return 'Bom dia'
  } else if (hour >= 12 && hour < 18) {
    return 'Boa tarde'
  } else {
    return 'Boa noite'
  }
}

/**
 * Retorna a data completa formatada em português brasileiro: "Segunda-feira, 24 de junho de 2025"
 */
export function getFullDateFormattedBR(): string {
  const now = new Date()
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }
  const formatted = now.toLocaleDateString('pt-BR', options)
  // Capitaliza o primeiro caractere
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}
