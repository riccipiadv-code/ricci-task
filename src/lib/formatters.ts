import { TaskControleRecord, TaskStatusRecord } from '@/types/task'

/**
 * Formata data ISO (YYYY-MM-DD ou ISO full) para dd/mm/aaaa
 */
export function formatDateBR(dateString?: string | null): string {
  if (!dateString) return '—'
  try {
    const clean = dateString.split('T')[0]
    const parts = clean.split('-')
    if (parts.length === 3) {
      const [year, month, day] = parts
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`
    }
    const d = new Date(dateString)
    return d.toLocaleDateString('pt-BR')
  } catch {
    return dateString
  }
}

/**
 * Formata data e hora para dd/mm/aaaa HH:mm
 */
export function formatDateTimeBR(dateString?: string | null): string {
  if (!dateString) return '—'
  try {
    const d = new Date(dateString)
    if (isNaN(d.getTime())) return dateString
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateString
  }
}

/**
 * Retorna se uma data YYYY-MM-DD está vencida (estritamente menor que hoje).
 * Regra do spec: "Não considere vencido um controle cujo status tenha finaliza = true."
 */
export function isPrazoOverdue(dateIso?: string | null, status?: TaskStatusRecord | null): boolean {
  if (!dateIso || !status) return false
  if (status.finaliza) return false
  const cleanDate = dateIso.split('T')[0]
  const today = new Date().toISOString().split('T')[0]
  return cleanDate < today
}

/**
 * Retorna se um follow-up está vencido (estritamente menor que hoje).
 * Regra do spec: Não considera vencido se finaliza = true.
 */
export function isFollowUpOverdue(
  dateIso?: string | null,
  status?: TaskStatusRecord | null,
): boolean {
  return isPrazoOverdue(dateIso, status)
}

/**
 * Retorna se uma data é exatamente hoje
 */
export function isToday(dateIso?: string | null): boolean {
  if (!dateIso) return false
  const cleanDate = dateIso.split('T')[0]
  const today = new Date().toISOString().split('T')[0]
  return cleanDate === today
}

/**
 * Saudação contextual por horário
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
 * Data por extenso em português
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
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

/**
 * Cores discretas para status da tabela e badges (conforme spec: "Etiquetas de status de cor discreta")
 */
export function getStatusBadgeStyle(
  codigo?: string,
  finaliza?: boolean,
): {
  bg: string
  text: string
  border: string
  dot: string
} {
  if (finaliza) {
    return {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200 dark:border-emerald-800/60',
      dot: 'bg-emerald-500',
    }
  }

  switch (codigo) {
    case 'em_andamento':
      return {
        bg: 'bg-blue-50 dark:bg-blue-950/40',
        text: 'text-blue-700 dark:text-blue-300',
        border: 'border-blue-200 dark:border-blue-800/60',
        dot: 'bg-blue-500',
      }
    case 'aguardando_autorizacao':
      return {
        bg: 'bg-violet-50 dark:bg-violet-950/40',
        text: 'text-violet-700 dark:text-violet-300',
        border: 'border-violet-200 dark:border-violet-800/60',
        dot: 'bg-violet-500',
      }
    case 'aguardando_cliente':
    case 'aguardando_terceiro':
      return {
        bg: 'bg-amber-50 dark:bg-amber-950/40',
        text: 'text-amber-700 dark:text-amber-300',
        border: 'border-amber-200 dark:border-amber-800/60',
        dot: 'bg-amber-500',
      }
    case 'urgente':
      return {
        bg: 'bg-red-50 dark:bg-red-950/40',
        text: 'text-red-700 dark:text-red-300',
        border: 'border-red-200 dark:border-red-800/60',
        dot: 'bg-red-500',
      }
    case 'suspenso':
      return {
        bg: 'bg-slate-100 dark:bg-slate-800/60',
        text: 'text-slate-700 dark:text-slate-300',
        border: 'border-slate-300 dark:border-slate-700',
        dot: 'bg-slate-400',
      }
    case 'acompanhamento':
    default:
      return {
        bg: 'bg-sky-50 dark:bg-sky-950/40',
        text: 'text-sky-700 dark:text-sky-300',
        border: 'border-sky-200 dark:border-sky-800/60',
        dot: 'bg-sky-500',
      }
  }
}
