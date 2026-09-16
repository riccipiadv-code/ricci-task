import { useState, useMemo } from 'react'
import {
  FolderKanban,
  Plus,
  Search,
  Edit2,
  Trash2,
  Power,
  RotateCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Loader2,
} from 'lucide-react'
import { useControles } from '@/hooks/useControles'
import { TaskNomeControleRecord } from '@/types/task'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export default function NomesControlePage() {
  const {
    nomesControle,
    loading,
    refreshNomesControle,
    saveNomeControle,
    toggleNomeControleAtivo,
    excluirNomeControle,
  } = useControles()

  const { toast } = useToast()

  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [itemEmEdicao, setItemEmEdicao] = useState<TaskNomeControleRecord | null>(null)
  const [nomeForm, setNomeForm] = useState('')
  const [ativoForm, setAtivoForm] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Confirmação de exclusão lógica
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [itemParaExcluir, setItemParaExcluir] = useState<TaskNomeControleRecord | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  // Filtragem e ordenação alfabética
  const listaFiltrada = useMemo(() => {
    let list = [...nomesControle]
    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      list = list.filter((n) => n.nome.toLowerCase().includes(q))
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [nomesControle, busca])

  const handleOpenNovo = () => {
    setItemEmEdicao(null)
    setNomeForm('')
    setAtivoForm(true)
    setFormError(null)
    setModalOpen(true)
  }

  const handleOpenEditar = (item: TaskNomeControleRecord) => {
    setItemEmEdicao(item)
    setNomeForm(item.nome)
    setAtivoForm(item.ativo)
    setFormError(null)
    setModalOpen(true)
  }

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const nomeTrim = nomeForm.trim()
    if (!nomeTrim) {
      setFormError('O Nome do Controle é obrigatório.')
      return
    }
    if (nomeTrim.length > 500) {
      setFormError('O Nome do Controle deve ter no máximo 500 caracteres.')
      return
    }
    if (!/[\p{L}\p{N}]/u.test(nomeTrim)) {
      setFormError('O nome não pode ser composto apenas por espaços ou pontuação.')
      return
    }

    setSalvando(true)
    try {
      await saveNomeControle({
        id: itemEmEdicao?.id,
        nome: nomeTrim,
        ativo: ativoForm,
      })
      toast({
        title: itemEmEdicao ? 'Nome do Controle atualizado' : 'Nome do Controle adicionado',
        description: `"${nomeTrim}" salvo com sucesso.`,
      })
      setModalOpen(false)
    } catch (err: any) {
      console.error('Erro ao salvar Nome do Controle:', err)
      if (
        err?.code === '23505' ||
        err?.message?.includes('23505') ||
        err?.message?.includes('Já existe um Nome do Controle equivalente')
      ) {
        setFormError('Já existe um Nome do Controle equivalente a este.')
      } else {
        setFormError(err?.message || 'Falha ao salvar. Tente novamente.')
      }
    } finally {
      setSalvando(false)
    }
  }

  const handleToggleAtivo = async (item: TaskNomeControleRecord) => {
    try {
      await toggleNomeControleAtivo(item.id, !item.ativo)
      toast({
        title: item.ativo ? 'Controle desativado' : 'Controle ativado',
        description: `O registro "${item.nome}" foi ${item.ativo ? 'desativado' : 'ativado'}.`,
      })
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao alterar status',
        description: err?.message || 'Não foi possível atualizar o status.',
      })
    }
  }

  const handleOpenExcluir = (item: TaskNomeControleRecord) => {
    setItemParaExcluir(item)
    setDeleteModalOpen(true)
  }

  const handleConfirmExclusao = async () => {
    if (!itemParaExcluir) return
    setExcluindo(true)
    try {
      await excluirNomeControle(itemParaExcluir.id)
      toast({
        title: 'Nome do Controle excluído',
        description: `"${itemParaExcluir.nome}" foi removido com sucesso.`,
      })
      setDeleteModalOpen(false)
      setItemParaExcluir(null)
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Não é possível excluir',
        description: err?.message || 'Falha ao excluir o Nome do Controle.',
      })
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in w-full min-w-0">
      {/* Cabeçalho */}
      <PageHeader
        title="Nomes dos Controles"
        subtitle="Administração dos títulos oficiais de acompanhamento vinculados aos casos"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refreshNomesControle()}
              disabled={loading}
              className="h-10 rounded-xl px-3 border-border hover:bg-muted"
              title="Atualizar listagem"
            >
              <RotateCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>
            <Button
              onClick={handleOpenNovo}
              className="h-10 px-4 rounded-xl font-semibold bg-primary hover:bg-[#4A4AC2] text-primary-foreground shadow-sm flex items-center gap-2"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Adicionar Nome do Controle</span>
            </Button>
          </div>
        }
      />

      {/* Barra de Busca e Métricas rápidas */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-card flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Buscar por nome do controle..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9 pr-8 h-10 rounded-xl bg-background text-sm"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded"
              title="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground self-end sm:self-center">
          <span>
            Total: <strong className="text-foreground">{nomesControle.length}</strong>
          </span>
          <span>•</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
            Ativos: {nomesControle.filter((n) => n.ativo).length}
          </span>
          <span>•</span>
          <span className="text-muted-foreground">
            Inativos: {nomesControle.filter((n) => !n.ativo).length}
          </span>
        </div>
      </div>

      {/* Listagem Ordenada Alfabeticamente */}
      <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span>Carregando Nomes dos Controles...</span>
          </div>
        ) : listaFiltrada.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FolderKanban className="w-10 h-10 text-muted-foreground/60 mx-auto" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground text-sm">
                {busca ? 'Nenhum resultado encontrado' : 'Nenhum Nome do Controle cadastrado'}
              </p>
              <p className="text-xs text-muted-foreground">
                {busca
                  ? 'Tente ajustar sua busca por outros termos.'
                  : 'Cadastre o primeiro nome de controle usando o botão acima.'}
              </p>
            </div>
            {busca && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBusca('')}
                className="rounded-xl text-xs"
              >
                Limpar busca
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {listaFiltrada.map((item) => (
              <div
                key={item.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-semibold text-sm text-foreground leading-snug break-words">
                      {item.nome}
                    </span>
                    {item.ativo ? (
                      <Badge
                        variant="secondary"
                        className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Ativo</span>
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="bg-muted text-muted-foreground border border-border text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" />
                        <span>Inativo</span>
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Registros inativos continuam visíveis nos casos já associados, mas não ficam
                    disponíveis para novas seleções.
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleAtivo(item)}
                    className={cn(
                      'h-8 px-2.5 text-xs rounded-xl transition-colors',
                      item.ativo
                        ? 'text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10'
                        : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10',
                    )}
                    title={item.ativo ? 'Desativar este nome' : 'Ativar este nome'}
                  >
                    <Power className="w-3.5 h-3.5 mr-1" />
                    <span>{item.ativo ? 'Desativar' : 'Ativar'}</span>
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenEditar(item)}
                    className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-foreground"
                    title="Editar"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenExcluir(item)}
                    className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Excluir (lógico)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de Criação / Edição */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-primary" />
              <span>{itemEmEdicao ? 'Editar Nome do Controle' : 'Adicionar Nome do Controle'}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Títulos oficiais usados para agrupar e identificar os casos no sistema.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSalvar} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="nome-controle-input"
                className="text-xs font-semibold text-foreground"
              >
                Nome do Controle <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nome-controle-input"
                autoFocus
                value={nomeForm}
                onChange={(e) => {
                  setNomeForm(e.target.value)
                  if (formError) setFormError(null)
                }}
                maxLength={500}
                className={cn(
                  'h-10 rounded-xl bg-background',
                  formError && 'border-destructive focus-visible:ring-destructive',
                )}
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Máximo de 500 caracteres (trim aplicado automaticamente)</span>
                <span>{nomeForm.trim().length}/500</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-foreground">Status do Cadastro</span>
                <p className="text-[11px] text-muted-foreground">
                  Registros ativos aparecem para seleção ao criar ou editar casos.
                </p>
              </div>
              <Button
                type="button"
                variant={ativoForm ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAtivoForm((prev) => !prev)}
                className="h-8 rounded-lg text-xs"
              >
                {ativoForm ? 'Ativo' : 'Inativo'}
              </Button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2 animate-fade-in">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                className="h-10 rounded-xl text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={salvando}
                className="h-10 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-[#4A4AC2]"
              >
                {salvando && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <span>{itemEmEdicao ? 'Salvar Alterações' : 'Cadastrar'}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão lógica */}
      <DeleteConfirmDialog
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        title="Excluir Nome do Controle?"
        description={`Tem certeza de que deseja excluir "${itemParaExcluir?.nome}"? O registro passará por exclusão lógica no Supabase. Caso esteja em uso por algum caso ativo, a exclusão será bloqueada.`}
        confirmButtonText={excluindo ? 'Excluindo...' : 'Sim, excluir'}
        onConfirm={handleConfirmExclusao}
      />
    </div>
  )
}
