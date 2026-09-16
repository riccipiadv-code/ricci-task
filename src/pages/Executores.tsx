import { useState, useMemo } from 'react'
import {
  Users,
  Plus,
  Search,
  Pencil,
  Trash2,
  RefreshCw,
  Power,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useControles } from '@/hooks/useControles'
import { controleService } from '@/services/controleService'
import { TaskExecutorRecord } from '@/types/task'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export default function ExecutoresPage() {
  const { executores, loading, refreshCadastros } = useControles()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<TaskExecutorRecord | null>(null)
  const [nomeValue, setNomeValue] = useState('')
  const [saving, setSaving] = useState(false)

  // Confirmação de exclusão lógica
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<TaskExecutorRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Alternância de status ativo/inativo
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const filteredItems = useMemo(() => {
    let list = [...executores]
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter((item) => item.nome.toLowerCase().includes(q))
    }
    // Ordenação alfabética
    list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
    return list
  }, [executores, search])

  const handleOpenCreate = () => {
    setEditingItem(null)
    setNomeValue('')
    setModalOpen(true)
  }

  const handleOpenEdit = (item: TaskExecutorRecord) => {
    setEditingItem(item)
    setNomeValue(item.nome)
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = nomeValue.trim()

    if (!trimmed) {
      toast({
        variant: 'destructive',
        title: 'Nome obrigatório',
        description: 'Informe o nome do executor.',
      })
      return
    }

    // Impede valores compostos apenas de pontuação/espaços
    const hasLettersOrNumbers = /[\p{L}\p{N}]/u.test(trimmed)
    if (!hasLettersOrNumbers) {
      toast({
        variant: 'destructive',
        title: 'Nome inválido',
        description: 'O nome não pode conter apenas pontuação ou caracteres especiais.',
      })
      return
    }

    if (trimmed.length > 255) {
      toast({
        variant: 'destructive',
        title: 'Nome muito longo',
        description: 'O nome deve ter no máximo 255 caracteres.',
      })
      return
    }

    setSaving(true)
    try {
      await controleService.saveExecutor({
        id: editingItem?.id,
        nome: trimmed,
        ativo: editingItem ? editingItem.ativo : true,
      })

      toast({
        title: editingItem ? 'Executor atualizado' : 'Executor cadastrado',
        description: `"${trimmed}" foi salvo com sucesso.`,
      })

      setModalOpen(false)
      await refreshCadastros()
    } catch (err: any) {
      console.error('Erro ao salvar executor:', err)
      const isUniqueError =
        err?.code === '23505' ||
        err?.message?.includes('duplicate key') ||
        err?.message?.includes('task_executores_nome_key')

      toast({
        variant: 'destructive',
        title: 'Não foi possível salvar',
        description: isUniqueError
          ? 'Já existe um Executor equivalente a este.'
          : err?.message || 'Erro inesperado ao salvar executor.',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleAtivo = async (item: TaskExecutorRecord) => {
    setTogglingId(item.id)
    try {
      await controleService.toggleAtivoExecutor(item.id, !item.ativo)
      toast({
        title: item.ativo ? 'Executor desativado' : 'Executor ativado',
        description: `"${item.nome}" foi ${item.ativo ? 'desativado' : 'ativado'} com sucesso.`,
      })
      await refreshCadastros()
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao alterar status',
        description: err?.message || 'Não foi possível alterar a situação do executor.',
      })
    } finally {
      setTogglingId(null)
    }
  }

  const handleOpenDelete = async (item: TaskExecutorRecord) => {
    // Validação preventiva: verificar se há controles ativos associados
    try {
      const emUso = await controleService.isExecutorInUse(item.id)
      if (emUso) {
        toast({
          variant: 'destructive',
          title: 'Executor em uso',
          description: `O executor "${item.nome}" está associado a controles de casos ativos e não pode ser excluído. Você pode desativá-lo para impedir novas atribuições.`,
        })
        return
      }
    } catch (err) {
      console.warn('Não foi possível verificar uso prévio do executor:', err)
    }

    setItemToDelete(item)
    setDeleteConfirmOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return
    setDeleting(true)
    try {
      await controleService.softDeleteExecutor(itemToDelete.id)
      toast({
        title: 'Executor excluído',
        description: `"${itemToDelete.nome}" foi removido com sucesso.`,
      })
      setDeleteConfirmOpen(false)
      setItemToDelete(null)
      await refreshCadastros()
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir',
        description:
          err?.message ||
          'Este executor está vinculado a controles ativos e não pode ser removido.',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      {/* Header com Ação Principal */}
      <PageHeader
        title="Executores do Controle"
        subtitle="Pessoas e departamentos responsáveis pela execução operacional dos controles de casos"
        actions={
          <Button
            type="button"
            onClick={handleOpenCreate}
            className="rounded-xl h-10 px-4 bg-primary text-primary-foreground font-semibold shadow-xs flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Executor</span>
          </Button>
        }
      />

      {/* Barra de Filtro e Busca */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-card flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar executor por nome..."
            className="pl-9.5 h-10 rounded-xl bg-background border-border text-sm"
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground self-end sm:self-auto font-medium">
          <span>Total:</span>
          <Badge variant="secondary" className="font-bold text-foreground px-2 py-0.5 rounded-lg">
            {filteredItems.length}
          </Badge>
        </div>
      </div>

      {/* Listagem */}
      {loading ? (
        <div className="p-16 text-center bg-card border border-border rounded-2xl shadow-card space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-sm font-semibold text-foreground">Carregando executores...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-12 text-center bg-card border border-border rounded-2xl shadow-card space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto text-muted-foreground">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Nenhum executor encontrado</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
              {search
                ? 'Nenhum resultado corresponde à sua pesquisa.'
                : 'Cadastre o primeiro executor operacional para vincular aos controles de casos.'}
            </p>
          </div>
          {!search && (
            <Button
              type="button"
              onClick={handleOpenCreate}
              className="rounded-xl text-xs bg-primary text-primary-foreground font-semibold"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Adicionar Executor
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/80 bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  <th className="py-3 px-4 w-12 text-center">#</th>
                  <th className="py-3 px-4">Nome do Executor</th>
                  <th className="py-3 px-4 w-32 text-center">Situação</th>
                  <th className="py-3 px-4 w-36 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredItems.map((item, index) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="py-3 px-4 text-center text-muted-foreground font-mono text-[11px]">
                      {index + 1}
                    </td>

                    <td className="py-3 px-4 font-semibold text-foreground text-sm">
                      <div className="flex items-center gap-2">
                        <span>{item.nome}</span>
                        {!item.ativo && (
                          <span className="text-[10px] text-muted-foreground italic font-normal">
                            (inativo para novos casos)
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleAtivo(item)}
                        disabled={togglingId === item.id}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all duration-200 cursor-pointer hover:opacity-85',
                          item.ativo
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            : 'bg-muted text-muted-foreground border-border/70',
                        )}
                        title={item.ativo ? 'Clique para desativar' : 'Clique para ativar'}
                      >
                        {item.ativo ? (
                          <>
                            <ShieldCheck className="w-3 h-3 text-emerald-500" />
                            <span>Ativo</span>
                          </>
                        ) : (
                          <>
                            <ShieldAlert className="w-3 h-3 text-muted-foreground" />
                            <span>Inativo</span>
                          </>
                        )}
                      </button>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleAtivo(item)}
                          disabled={togglingId === item.id}
                          className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                          title={item.ativo ? 'Desativar executor' : 'Ativar executor'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(item)}
                          className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                          title="Editar nome"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDelete(item)}
                          className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Excluir executor"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Criação / Edição */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md p-6">
          <form onSubmit={handleSave} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <span>{editingItem ? 'Editar Executor' : 'Novo Executor'}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground block">
                Nome do Executor <span className="text-destructive">*</span>
              </label>
              <Input
                value={nomeValue}
                onChange={(e) => setNomeValue(e.target.value)}
                placeholder="Ex.: Lucas Mendes ou Setor de Cálculos"
                maxLength={255}
                autoFocus
                className="h-10 rounded-xl bg-background border-border text-sm"
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Utilizado na atribuição operacional dos controles de casos. Não são aceitos nomes
                compostos apenas por pontuação ou espaços.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border/60">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="h-9 rounded-xl text-xs font-medium"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving || !nomeValue.trim()}
                className="h-9 rounded-xl text-xs font-semibold bg-primary text-primary-foreground"
              >
                {saving ? 'Salvando...' : editingItem ? 'Salvar Alterações' : 'Cadastrar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão lógica */}
      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={handleConfirmDelete}
        title="Excluir executor?"
        description={`Deseja excluir o executor "${itemToDelete?.nome}"? O registro será arquivado logicamente no banco de dados e não aparecerá nas opções para novos controles.`}
        confirmButtonText={deleting ? 'Excluindo...' : 'Excluir Executor'}
      />
    </div>
  )
}
