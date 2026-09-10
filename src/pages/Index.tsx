import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  PlayCircle,
  CheckCircle2,
  ListTodo,
  ArrowRight,
  Plus,
  Calendar,
  Sparkles,
  Check,
} from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { Task } from '@/types/task'
import { TaskModal } from '@/components/TaskModal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  STATUS_LABELS,
  STATUS_COLORS,
  formatDateBR,
  isTaskOverdue,
  isToday,
  getTimeOfDayGreeting,
  getFullDateFormattedBR,
} from '@/lib/formatters'
import { cn } from '@/lib/utils'

export default function Index() {
  const { tasks, saveTask, updateTask, toggleTaskStatus } = useTasks()
  const { toast } = useToast()

  const [modalOpen, setModalOpen] = useState(false)
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null)

  // Estatísticas calculadas
  const stats = useMemo(() => {
    const pendentes = tasks.filter((t) => t.status === 'pendente').length
    const emAndamento = tasks.filter((t) => t.status === 'em_andamento').length
    const concluidasHoje = tasks.filter(
      (t) => t.status === 'concluida' && isToday(t.dueDate || t.createdAt),
    ).length
    const total = tasks.length
    const concluidasTotal = tasks.filter((t) => t.status === 'concluida').length
    const taxaConclusao = total > 0 ? Math.round((concluidasTotal / total) * 100) : 0

    // Distribuição por prioridade
    const altaCount = tasks.filter((t) => t.priority === 'alta').length
    const mediaCount = tasks.filter((t) => t.priority === 'media').length
    const baixaCount = tasks.filter((t) => t.priority === 'baixa').length

    const altaPct = total > 0 ? Math.round((altaCount / total) * 100) : 0
    const mediaPct = total > 0 ? Math.round((mediaCount / total) * 100) : 0
    const baixaPct = total > 0 ? Math.round((baixaCount / total) * 100) : 0

    return {
      pendentes,
      emAndamento,
      concluidasHoje,
      total,
      concluidasTotal,
      taxaConclusao,
      priorities: {
        alta: { count: altaCount, pct: altaPct },
        media: { count: mediaCount, pct: mediaPct },
        baixa: { count: baixaCount, pct: baixaPct },
      },
    }
  }, [tasks])

  // 5 tarefas mais recentes (ordenadas por createdAt desc)
  const recentTasks = useMemo(() => {
    return [...tasks]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
  }, [tasks])

  const greeting = getTimeOfDayGreeting()
  const fullDate = getFullDateFormattedBR()

  const handleToggleCheck = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const { concluded } = toggleTaskStatus(id)
    if (concluded) {
      toast({
        title: 'Tarefa concluída!',
        description: 'Bom trabalho completando suas metas.',
      })
    }
  }

  const handleOpenEdit = (task: Task) => {
    setTaskToEdit(task)
    setModalOpen(true)
  }

  const handleOpenCreate = () => {
    setTaskToEdit(null)
    setModalOpen(true)
  }

  const handleSaveModal = (data: {
    id?: string
    title: string
    description: string
    category: any
    priority: any
    status: any
    dueDate: string
  }) => {
    if (data.id) {
      updateTask(data.id, data)
      toast({
        title: 'Tarefa atualizada com sucesso',
      })
    } else {
      saveTask(data)
      toast({
        title: 'Tarefa criada com sucesso',
      })
    }
  }

  // Raio e perímetro para o anel de progresso circular animado
  const circleRadius = 42
  const circleCircumference = 2 * Math.PI * circleRadius
  const strokeDashoffset = circleCircumference - (stats.taxaConclusao / 100) * circleCircumference

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary font-semibold text-xs sm:text-sm mb-1 uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>Visão Geral</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            {greeting}, Ricci 👋
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1 font-normal">{fullDate}</p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleOpenCreate}
            className="h-11 px-5 rounded-xl font-semibold bg-primary hover:bg-[#4A4AC2] text-primary-foreground shadow-sm transition-transform hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4 mr-2 stroke-[2.5]" />
            Nova Tarefa
          </Button>
        </div>
      </div>

      {/* 4 Cards de Estatísticas com fade-in escalonado e hover translate */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Card 1: Pendentes */}
        <div
          className="group relative bg-card border border-border rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 animate-fade-in-up"
          style={{ animationDelay: '50ms' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Tarefas Pendentes</span>
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-500 dark:text-amber-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <Clock className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground tracking-tight">
              {stats.pendentes}
            </span>
            <span className="text-xs text-muted-foreground font-medium">a fazer</span>
          </div>
        </div>

        {/* Card 2: Em Andamento */}
        <div
          className="group relative bg-card border border-border rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 animate-fade-in-up"
          style={{ animationDelay: '100ms' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Em Andamento</span>
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-500 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <PlayCircle className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground tracking-tight">
              {stats.emAndamento}
            </span>
            <span className="text-xs text-muted-foreground font-medium">em execução</span>
          </div>
        </div>

        {/* Card 3: Concluídas Hoje */}
        <div
          className="group relative bg-card border border-border rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 animate-fade-in-up"
          style={{ animationDelay: '150ms' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Concluídas Hoje</span>
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <CheckCircle2 className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground tracking-tight">
              {stats.concluidasHoje}
            </span>
            <span className="text-xs text-muted-foreground font-medium">finalizadas</span>
          </div>
        </div>

        {/* Card 4: Total de Tarefas */}
        <div
          className="group relative bg-card border border-border rounded-2xl p-5 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 animate-fade-in-up"
          style={{ animationDelay: '200ms' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Total de Tarefas</span>
            <div className="h-10 w-10 rounded-xl bg-[#8B5CF6]/10 text-[#8B5CF6] dark:text-[#A78BFA] flex items-center justify-center transition-transform group-hover:scale-110">
              <ListTodo className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground tracking-tight">
              {stats.total}
            </span>
            <span className="text-xs text-muted-foreground font-medium">cadastradas</span>
          </div>
        </div>
      </div>

      {/* Grid com Card de Progresso e Gráfico de Prioridades */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Card de Progresso com anel circular animado */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-card flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Progresso Geral</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Percentual de tarefas concluídas</p>
          </div>

          <div className="py-6 flex flex-col items-center justify-center">
            <div className="relative flex items-center justify-center w-36 h-36">
              <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                {/* Trilha do anel */}
                <circle
                  cx="50"
                  cy="50"
                  r={circleRadius}
                  className="stroke-muted/50 fill-transparent"
                  strokeWidth="8"
                />
                {/* Arco do progresso */}
                <circle
                  cx="50"
                  cy="50"
                  r={circleRadius}
                  className="stroke-primary fill-transparent transition-all duration-600 ease-out"
                  strokeWidth="8"
                  strokeDasharray={circleCircumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>
              {/* Texto central */}
              <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-extrabold text-foreground">
                  {stats.taxaConclusao}%
                </span>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  concluído
                </span>
              </div>
            </div>

            <p className="mt-4 text-sm font-medium text-foreground text-center">
              <span className="font-bold text-primary">{stats.concluidasTotal}</span> de{' '}
              <span className="font-bold text-foreground">{stats.total}</span> tarefas concluídas
            </p>
          </div>

          <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Status das tarefas</span>
            <span className="font-semibold text-foreground">
              {stats.pendentes + stats.emAndamento} ativas
            </span>
          </div>
        </div>

        {/* Mini Gráfico de Barras Horizontais: Distribuição por Prioridade */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 shadow-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">Distribuição por Prioridade</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Proporção de demandas divididas por nível de urgência
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground">
                {stats.total} tarefas
              </span>
            </div>
          </div>

          <div className="my-6 space-y-4">
            {/* Alta */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm font-semibold">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]" />
                  <span>Alta Prioridade</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground font-medium">
                  <span>{stats.priorities.alta.count} tarefas</span>
                  <span className="font-bold text-foreground">({stats.priorities.alta.pct}%)</span>
                </div>
              </div>
              <div className="h-3 w-full bg-muted/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#EF4444] rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${stats.priorities.alta.pct}%` }}
                />
              </div>
            </div>

            {/* Média */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm font-semibold">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
                  <span>Média Prioridade</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground font-medium">
                  <span>{stats.priorities.media.count} tarefas</span>
                  <span className="font-bold text-foreground">({stats.priorities.media.pct}%)</span>
                </div>
              </div>
              <div className="h-3 w-full bg-muted/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#F59E0B] rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${stats.priorities.media.pct}%` }}
                />
              </div>
            </div>

            {/* Baixa */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm font-semibold">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]" />
                  <span>Baixa Prioridade</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground font-medium">
                  <span>{stats.priorities.baixa.count} tarefas</span>
                  <span className="font-bold text-foreground">({stats.priorities.baixa.pct}%)</span>
                </div>
              </div>
              <div className="h-3 w-full bg-muted/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#10B981] rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${stats.priorities.baixa.pct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Urgência recomendada</span>
            <span className="font-semibold text-foreground">
              {stats.priorities.alta.count > 0
                ? `${stats.priorities.alta.count} pendência(s) de atenção imediata`
                : 'Nenhuma pendência crítica pendente'}
            </span>
          </div>
        </div>
      </div>

      {/* Seção Tarefas Recentes */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Tarefas Recentes</h2>
            <p className="text-xs text-muted-foreground">
              Últimas 5 tarefas adicionadas ao Ricci Task
            </p>
          </div>
          <Button
            variant="ghost"
            asChild
            className="text-primary hover:text-primary/90 font-semibold text-sm"
          >
            <Link to="/tarefas" className="flex items-center gap-1.5">
              Ver todas
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>

        {recentTasks.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground space-y-3">
            <p className="text-sm">Nenhuma tarefa cadastrada ainda.</p>
            <Button onClick={handleOpenCreate} variant="outline" className="rounded-xl">
              Criar primeira tarefa
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentTasks.map((task) => {
              const isOverdue = isTaskOverdue(task.dueDate, task.status)
              const catColor = CATEGORY_COLORS[task.category]
              const prioColor = PRIORITY_COLORS[task.priority]
              const statusColor = STATUS_COLORS[task.status]

              return (
                <div
                  key={task.id}
                  onClick={() => handleOpenEdit(task)}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 px-3 -mx-3 rounded-xl cursor-pointer transition-colors group"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    {/* Checkbox circular customizado */}
                    <button
                      type="button"
                      onClick={(e) => handleToggleCheck(e, task.id)}
                      className={cn(
                        'mt-0.5 sm:mt-0 h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
                        task.status === 'concluida'
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-border hover:border-primary',
                      )}
                      aria-label="Alternar conclusão da tarefa"
                    >
                      {task.status === 'concluida' && (
                        <Check className="w-3.5 h-3.5 stroke-[3] animate-in zoom-in-75" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'text-sm font-semibold truncate transition-all',
                            task.status === 'concluida'
                              ? 'line-through text-muted-foreground'
                              : 'text-foreground group-hover:text-primary',
                          )}
                        >
                          {task.title}
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-md sm:max-w-lg mt-0.5">
                          {task.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0 ml-8 sm:ml-0">
                    {/* Chip de categoria */}
                    <span
                      className={cn(
                        'text-[11px] font-semibold px-2 py-0.5 rounded-md border',
                        catColor.bg,
                        catColor.text,
                        catColor.border,
                      )}
                    >
                      {CATEGORY_LABELS[task.category]}
                    </span>

                    {/* Dot de prioridade */}
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md',
                        prioColor.bg,
                        prioColor.text,
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', prioColor.dot)} />
                      {PRIORITY_LABELS[task.priority]}
                    </span>

                    {/* Status badge */}
                    <span
                      className={cn(
                        'text-[11px] font-semibold px-2 py-0.5 rounded-md border',
                        statusColor.bg,
                        statusColor.border,
                      )}
                    >
                      {STATUS_LABELS[task.status]}
                    </span>

                    {/* Due Date */}
                    {task.dueDate && (
                      <span
                        className={cn(
                          'flex items-center gap-1 text-[11px] font-medium',
                          isOverdue ? 'text-destructive font-bold' : 'text-muted-foreground',
                        )}
                      >
                        <Calendar className="w-3 h-3" />
                        {formatDateBR(task.dueDate)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal de Criação / Edição */}
      <TaskModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        taskToEdit={taskToEdit}
        onSave={handleSaveModal}
      />
    </div>
  )
}
