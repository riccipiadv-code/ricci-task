import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  title?: string
  description?: string
  confirmButtonText?: string
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = 'Excluir tarefa?',
  description = 'Esta ação não pode ser desfeita.',
  confirmButtonText = 'Excluir',
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] rounded-2xl p-6">
        <DialogHeader className="flex flex-col items-start gap-2">
          <div className="h-10 w-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle className="text-lg font-bold text-foreground">{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 gap-2 sm:gap-0 flex-col-reverse sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-xl"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
            className="h-10 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {confirmButtonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
