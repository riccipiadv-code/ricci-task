import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Task, TaskCategory, TaskPriority, TaskStatus } from '@/types/task'
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS } from '@/lib/formatters'
import { cn } from '@/lib/utils'

interface TaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskToEdit?: Task | null
  onSave: (taskData: {
    id?: string
    title: string
    description: string
    category: TaskCategory
    priority: TaskPriority
    status: TaskStatus
    dueDate: string
  }) => void
}

export function TaskModal({ open, onOpenChange, taskToEdit, onSave }: TaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<TaskCategory>('trabalho')
  const [priority, setPriority] = useState<TaskPriority>('media')
  const [status, setStatus] = useState<TaskStatus>('pendente')
  const [dueDate, setDueDate] = useState('')
  const [titleError, setTitleError] = useState(false)

  // Pre-fill form when editing or resetting
  useEffect(() => {
    if (taskToEdit) {
      setTitle(taskToEdit.title)
      setDescription(taskToEdit.description || '')
      setCategory(taskToEdit.category)
      setPriority(taskToEdit.priority)
      setStatus(taskToEdit.status)
      setDueDate(taskToEdit.dueDate ? taskToEdit.dueDate.split('T')[0] : '')
    } else {
      setTitle('')
      setDescription('')
      setCategory('trabalho')
      setPriority('media')
      setStatus('pendente')
      // Default to today
      setDueDate(new Date().toISOString().split('T')[0])
    }
    setTitleError(false)
  }, [taskToEdit, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setTitleError(true)
      return
    }

    onSave({
      id: taskToEdit?.id,
      title: title.trim(),
      description: description.trim(),
      category,
      priority,
      status,
      dueDate: dueDate || new Date().toISOString().split('T')[0],
    })

    onOpenChange(false)
  }

  const priorityOptions: { value: TaskPriority; label: string; activeColor: string }[] = [
    { value: 'baixa', label: PRIORITY_LABELS.baixa, activeColor: 'bg-emerald-500 text-white' },
    { value: 'media', label: PRIORITY_LABELS.media, activeColor: 'bg-amber-500 text-white' },
    { value: 'alta', label: PRIORITY_LABELS.alta, activeColor: 'bg-red-500 text-white' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-6 transition-all duration-200">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {taskToEdit ? 'Editar Tarefa' : 'Nova Tarefa'}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            {taskToEdit
              ? 'Atualize os detalhes da tarefa selecionada.'
              : 'Preencha os campos abaixo para adicionar uma nova atividade.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Título */}
          <div className="space-y-1.5">
            <Label htmlFor="task-title" className="text-sm font-semibold flex items-center gap-1">
              Título <span className="text-destructive">*</span>
            </Label>
            <Input
              id="task-title"
              placeholder="Ex: Entregar relatório trimestral"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                if (titleError && e.target.value.trim()) setTitleError(false)
              }}
              className={cn(
                'h-11 rounded-xl bg-background transition-all',
                titleError && 'border-destructive focus-visible:ring-destructive',
              )}
            />
            {titleError && (
              <p className="text-xs font-medium text-destructive">
                O título da tarefa é obrigatório.
              </p>
            )}
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="task-desc" className="text-sm font-semibold">
              Descrição
            </Label>
            <Textarea
              id="task-desc"
              placeholder="Adicione detalhes, observações ou links úteis..."
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none rounded-xl bg-background"
            />
          </div>

          {/* Grid de Categoria e Data */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Categoria</Label>
              <Select value={category} onValueChange={(val: TaskCategory) => setCategory(val)}>
                <SelectTrigger className="h-11 rounded-xl bg-background">
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {(Object.keys(CATEGORY_LABELS) as TaskCategory[]).map((catKey) => (
                    <SelectItem key={catKey} value={catKey}>
                      {CATEGORY_LABELS[catKey]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-due-date" className="text-sm font-semibold">
                Data de Vencimento
              </Label>
              <Input
                id="task-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-11 rounded-xl bg-background"
              />
            </div>
          </div>

          {/* Prioridade - Segmented Control */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Prioridade</Label>
            <div className="grid grid-cols-3 gap-2 p-1 bg-muted/60 rounded-xl border border-border">
              {priorityOptions.map((opt) => {
                const isSelected = priority === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    className={cn(
                      'py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150',
                      isSelected
                        ? opt.activeColor + ' shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Status</Label>
            <Select value={status} onValueChange={(val: TaskStatus) => setStatus(val)}>
              <SelectTrigger className="h-11 rounded-xl bg-background">
                <SelectValue placeholder="Selecione o status" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="em_andamento">Em Andamento</SelectItem>
                <SelectItem value="concluida">Concluída</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="pt-3 gap-2 sm:gap-0 flex-col-reverse sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-11 rounded-xl px-5 border-border"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="h-11 rounded-xl px-6 bg-primary text-primary-foreground hover:bg-[#4A4AC2] transition-transform hover:scale-[1.02]"
            >
              {taskToEdit ? 'Atualizar Tarefa' : 'Salvar Tarefa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
