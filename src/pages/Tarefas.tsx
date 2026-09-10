import { useState, useMemo } from 'react'
import {
  Plus,
  Search,
  FilterX,
  Calendar,
  Check,
  Pencil,
  Trash2,
  ListFilter,
  CheckCircle,
} from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { Task, TaskCategory, TaskPriority } from '@/types/task'
import { PageHeader } from '@/components/PageHeader'
import { TaskModal } from '@/components/TaskModal'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
} from '@/lib/formatters'
import { cn } from '@/lib/utils'

type FilterStatus = 'todas' | 'pendentes' | 'em_andamento' | 'concluidas'
type SortOption = 'recentes' | 'vencimento' | 'prioridade'

export default function TarefasPage() {
  const { tasks, settings, saveTask, updateTask, deleteTask, toggleTaskStatus } = useTasks()
  const { toast } = useToast()

  // Filtro inicial baseado nas configurações salvas do usuário ('todas' | 'pendentes' | 'concluidas')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>(() => {
    if (settings.defaultView === 'pendentes') return 'pendentes'
    if (settings.defaultView === 'concluidas') return 'concluidas'
    return 'todas'
  })

  const [categoryFilter, setCategoryFilter] = useState<string>('todas')
  const [sortBy, setSortBy] = useState<SortOption>('recentes')
  const [searchQuery, setSearchQuery] = useState('')

  // Modais de tarefa e exclusão
  const [modalOpen, setModalOpen] = useState(false)
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null)

  // Contagens para os chips de status
  const counts = useMemo(() => {
    return {
      todas: tasks.length,
      pendentes: tasks.filter((t) => t.status === 'pendente').length,
      em_andamento: tasks.filter((t) => t.status === 'em_andamento').length,
      concluidas: tasks.filter((t) => t.status === 'concluida').length,
    }
  }, [tasks])

  // Lista filtrada e ordenada
  const filteredTasks = useMemo(() => {
    let result = [...tasks]

    // Filtro por status
    if (statusFilter === 'pendentes') {
      result = result.filter((t) => t.status === 'pendente')
    } else if (statusFilter === 'em_andamento') {
      result = result.filter((t) => t.status === 'em_andamento')
    } else if (statusFilter === 'concluidas') {
      result = result.filter((t) => t.status === 'concluida')
    }

    // Filtro por categoria
    if (categoryFilter !== 'todas') {
      result = result.filter((t) => t.category === categoryFilter)
    }

    // Busca textual por título ou descrição
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)),
      )
    }

    // Ordenação
    result.sort((a, b) => {
      if (sortBy === 'recentes') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }
      if (sortBy === 'vencimento') {
        const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
        const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
        return dateA - dateB
      }
      if (sortBy === 'prioridade') {
        const priorityWeight: Record<TaskPriority, number> = {
          alta: 3,
          media: 2,
          baixa: 1,
        }
        return priorityWeight[b.priority] - priorityWeight[a.priority]
      }
      return 0
    })

    return result
  }, [tasks, statusFilter, categoryFilter, searchQuery, sortBy])

  const handleToggleCheck = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const { concluded } = toggleTaskStatus(id)
    if (concluded) {
      toast({
        title: 'Tarefa concluída!',
        description: 'Sua tarefa foi marcada como concluída.',
      })
    }
  }

  const handleOpenCreate = () => {
    setTaskToEdit(null)
    setModalOpen(true)
  }

  const handleOpenEdit = (task: Task) => {
    setTaskToEdit(task)
    setModalOpen(true)
  }

  const handleOpenDeleteConfirm = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation()
    setTaskToDelete(task)
    setDeleteConfirmOpen(true)
  }

  const handleConfirmDelete = () => {
    if (taskToDelete) {
      deleteTask(taskToDelete.id)
      toast({
        title: 'Tarefa excluída',
        description: `"${taskToDelete.title}" foi removida com sucesso.`,
      })
      setTaskToDelete(null)
    }
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

  const handleClearFilters = () => {
    setStatusFilter('todas')
    setCategoryFilter('todas')
    setSearchQuery('')
    setSortBy('recentes')
  }

  const hasActiveFilters =
    statusFilter !== 'todas' ||
    categoryFilter !== 'todas' ||
    searchQuery.trim() !== '' ||
    sortBy !== 'recentes'

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header da Tela */}
      <PageHeader
        title="Tarefas"
        subtitle="Gerencie suas atividades diárias"
        actions={
          <Button
            onClick={handleOpenCreate}
            className="h-11 px-5 rounded-xl font-semibold bg-primary hover:bg-[#4A4AC2] text-primary-foreground shadow-sm transition-transform hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4 mr-2 stroke-[2.5]" />
            Nova Tarefa
          </Button>
        }
      />

      {/* Filter Bar (horizontal, scrollable on mobile) */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-card space-y-4">
        {/* Status Chips - com scroll horizontal no mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setStatusFilter('todas')}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
              statusFilter === 'todas'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <span>Todas</span>
            <span
              className={cn(
                'text-[11px] px-1.5 py-0.2 rounded-full font-bold',
                statusFilter === 'todas'
                  ? 'bg-white/20 text-white'
                  : 'bg-background text-muted-foreground',
              )}
            >
              {counts.todas}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('pendentes')}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
              statusFilter === 'pendentes'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <span>Pendentes</span>
            <span
              className={cn(
                'text-[11px] px-1.5 py-0.2 rounded-full font-bold',
                statusFilter === 'pendentes'
                  ? 'bg-white/20 text-white'
                  : 'bg-background text-muted-foreground',
              )}
            >
              {counts.pendentes}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('em_andamento')}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
              statusFilter === 'em_andamento'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <span>Em Andamento</span>
            <span
              className={cn(
                'text-[11px] px-1.5 py-0.2 rounded-full font-bold',
                statusFilter === 'em_andamento'
                  ? 'bg-white/20 text-white'
                  : 'bg-background text-muted-foreground',
              )}
            >
              {counts.em_andamento}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('concluidas')}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
              statusFilter === 'concluidas'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <span>Concluídas</span>
            <span
              className={cn(
                'text-[11px] px-1.5 py-0.2 rounded-full font-bold',
                statusFilter === 'concluidas'
                  ? 'bg-white/20 text-white'
                  : 'bg-background text-muted-foreground',
              )}
            >
              {counts.concluidas}
            </span>
          </button>
        </div>

        {/* Filtros adicionais: Busca, Categoria, Ordenação */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-2 border-t border-border/60">
          {/* Busca por texto */}
          <div className="relative sm:col-span-2 lg:col-span-6">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Buscar por título ou descrição..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10 rounded-xl bg-background"
            />
          </div>

          {/* Select de Categoria */}
          <div className="lg:col-span-3">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-10 rounded-xl bg-background">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="todas">Todas as categorias</SelectItem>
                {(Object.keys(CATEGORY_LABELS) as TaskCategory[]).map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Select de Ordenação */}
          <div className="lg:col-span-3">
            <Select value={sortBy} onValueChange={(val: SortOption) => setSortBy(val)}>
              <SelectTrigger className="h-10 rounded-xl bg-background">
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="recentes">Mais recentes</SelectItem>
                <SelectItem value="vencimento">Data de vencimento</SelectItem>
                <SelectItem value="prioridade">Prioridade</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground border-t border-border/40">
            <span>
              Mostrando <strong className="text-foreground">{filteredTasks.length}</strong> de{' '}
              {tasks.length} tarefas
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="h-7 text-xs text-primary hover:text-primary/90 font-medium px-2"
            >
              <FilterX className="w-3.5 h-3.5 mr-1" />
              Limpar filtros
            </Button>
          </div>
        )}
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          /* Empty State com ícone ilustrado */
          <div className="bg-card border border-border rounded-2xl p-10 sm:p-14 text-center shadow-card flex flex-col items-center justify-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <ListFilter className="w-8 h-8 stroke-[1.8]" />
            </div>
            <h3 className="text-lg font-bold text-foreground">Nenhuma tarefa encontrada</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1">
              Não encontramos nenhuma tarefa com os critérios selecionados. Tente ajustar os filtros
              ou crie uma nova tarefa.
            </p>
            <div className="mt-5 flex items-center gap-3">
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  onClick={handleClearFilters}
                  className="rounded-xl h-10 px-4"
                >
                  <FilterX className="w-4 h-4 mr-2" />
                  Limpar filtros
                </Button>
              )}
              <Button
                onClick={handleOpenCreate}
                className="rounded-xl h-10 px-4 bg-primary text-primary-foreground hover:bg-[#4A4AC2]"
              >
                <Plus className="w-4 h-4 mr-2 stroke-[2.5]" />
                Nova Tarefa
              </Button>
            </div>
          </div>
        ) : (
          /* Cards de Tarefa */
          filteredTasks.map((task) => {
            const isOverdue = isTaskOverdue(task.dueDate, task.status)
            const catColor = CATEGORY_COLORS[task.category]
            const prioColor = PRIORITY_COLORS[task.priority]
            const statusColor = STATUS_COLORS[task.status]

            return (
              <div
                key={task.id}
                onClick={() => handleOpenEdit(task)}
                className="group relative bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-card hover:shadow-card-hover transition-all duration-200 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {/* Custom Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => handleToggleCheck(e, task.id)}
                    className={cn(
                      'mt-0.5 h-6 w-6 rounded-lg border flex items-center justify-center shrink-0 transition-all duration-200',
                      task.status === 'concluida'
                        ? 'bg-primary border-primary text-primary-foreground shadow-xs'
                        : 'border-border bg-background hover:border-primary',
                    )}
                    aria-label="Alternar status da tarefa"
                  >
                    {task.status === 'concluida' && (
                      <Check className="w-4 h-4 stroke-[3] animate-in zoom-in-75" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3
                        className={cn(
                          'text-base font-bold tracking-tight transition-all',
                          task.status === 'concluida'
                            ? 'line-through text-muted-foreground'
                            : 'text-foreground group-hover:text-primary',
                        )}
                      >
                        {task.title}
                      </h3>
                    </div>

                    {task.description && (
                      <p className="text-sm text-muted-foreground truncate leading-relaxed">
                        {task.description}
                      </p>
                    )}

                    {/* Meta info chips em linha */}
                    <div className="flex items-center gap-2 flex-wrap pt-1.5">
                      {/* Categoria */}
                      <span
                        className={cn(
                          'text-xs font-semibold px-2.5 py-0.5 rounded-lg border',
                          catColor.bg,
                          catColor.text,
                          catColor.border,
                        )}
                      >
                        {CATEGORY_LABELS[task.category]}
                      </span>

                      {/* Prioridade */}
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-lg',
                          prioColor.bg,
                          prioColor.text,
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', prioColor.dot)} />
                        {PRIORITY_LABELS[task.priority]}
                      </span>

                      {/* Status */}
                      <span
                        className={cn(
                          'text-xs font-semibold px-2.5 py-0.5 rounded-lg border',
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
                            'inline-flex items-center gap-1.5 text-xs font-medium ml-1',
                            isOverdue ? 'text-destructive font-bold' : 'text-muted-foreground',
                          )}
                          title={isOverdue ? 'Tarefa atrasada!' : 'Data de vencimento'}
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{formatDateBR(task.dueDate)}</span>
                          {isOverdue && (
                            <span className="text-[10px] uppercase font-bold">(Vencida)</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Ações: Editar e Excluir
                    Desktop: visíveis on hover do card
                    Mobile: sempre visíveis
                */}
                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenEdit(task)
                    }}
                    className="h-9 w-9 p-0 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted"
                    title="Editar tarefa"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleOpenDeleteConfirm(e, task)}
                    className="h-9 w-9 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Excluir tarefa"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Modal de Nova/Editar Tarefa */}
      <TaskModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        taskToEdit={taskToEdit}
        onSave={handleSaveModal}
      />

      {/* Modal de Confirmação de Exclusão */}
      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={handleConfirmDelete}
        title="Excluir tarefa?"
        description={`Tem certeza que deseja apagar a tarefa "${taskToDelete?.title}"? Esta ação não pode ser desfeita.`}
        confirmButtonText="Excluir"
      />
    </div>
  )
}
