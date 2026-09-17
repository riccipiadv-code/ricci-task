import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Users,
  Search,
  RotateCw,
  CheckCircle2,
  XCircle,
  X,
  Loader2,
  Mail,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { controleService } from '@/services/controleService'
import { TaskUsuarioRecord } from '@/types/task'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export default function UsuariosPage() {
  const { toast } = useToast()

  const [usuarios, setUsuarios] = useState<TaskUsuarioRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')

  // Estado do Modal de Cadastro / Edição
  const [modalOpen, setModalOpen] = useState(false)
  const [usuarioEditando, setUsuarioEditando] = useState<TaskUsuarioRecord | null>(null)
  const [formNome, setFormNome] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formAtivo, setFormAtivo] = useState(true)
  const [formNomeError, setFormNomeError] = useState<string | null>(null)
  const [formEmailError, setFormEmailError] = useState<string | null>(null)
  const [formGeralError, setFormGeralError] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Estado do Modal de Confirmação de Exclusão
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [usuarioParaExcluir, setUsuarioParaExcluir] = useState<TaskUsuarioRecord | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  const carregarUsuarios = useCallback(async () => {
    setLoading(true)
    try {
      const data = await controleService.getTodosUsuarios()
      setUsuarios(data)
    } catch (err: any) {
      console.error('Erro ao carregar usuários:', err)
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar usuários',
        description: 'Não foi possível carregar a lista de usuários. Verifique sua conexão.',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    carregarUsuarios()
  }, [carregarUsuarios])

  // Abrir modal de criação
  const handleNovoUsuario = () => {
    setUsuarioEditando(null)
    setFormNome('')
    setFormEmail('')
    setFormAtivo(true)
    setFormNomeError(null)
    setFormEmailError(null)
    setFormGeralError(null)
    setModalOpen(true)
  }

  // Abrir modal de edição
  const handleEditarUsuario = (u: TaskUsuarioRecord) => {
    setUsuarioEditando(u)
    setFormNome(u.nome)
    setFormEmail(u.email)
    setFormAtivo(u.ativo)
    setFormNomeError(null)
    setFormEmailError(null)
    setFormGeralError(null)
    setModalOpen(true)
  }

  // Submeter formulário (criação / edição)
  const handleSalvarUsuario = async (e: React.FormEvent) => {
    e.preventDefault()
    if (salvando) return

    setFormNomeError(null)
    setFormEmailError(null)
    setFormGeralError(null)

    const nomeClean = formNome.trim()
    const emailClean = formEmail.trim().toLowerCase()

    let hasError = false
    if (!nomeClean) {
      setFormNomeError('O nome é obrigatório.')
      hasError = true
    }

    if (!emailClean) {
      setFormEmailError('O e-mail é obrigatório.')
      hasError = true
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
      setFormEmailError('Informe um e-mail válido.')
      hasError = true
    }

    if (hasError) return

    setSalvando(true)
    try {
      const saved = await controleService.saveUsuario({
        id: usuarioEditando?.id,
        nome: nomeClean,
        email: emailClean,
        ativo: formAtivo,
      })

      if (usuarioEditando) {
        setUsuarios((prev) => prev.map((u) => (u.id === saved.id ? saved : u)))
        toast({
          title: 'Usuário atualizado com sucesso',
          description: `Os dados de "${saved.nome}" foram alterados.`,
        })
      } else {
        setUsuarios((prev) => [...prev, saved])
        toast({
          title: 'Usuário cadastrado com sucesso',
          description: `"${saved.nome}" foi adicionado aos usuários.`,
        })
      }

      setModalOpen(false)
    } catch (err: any) {
      console.error('Erro ao salvar usuário:', err)
      const errorMsg = String(err?.message || '')
      const isUniqueEmail =
        err?.code === '23505' ||
        errorMsg.includes('23505') ||
        errorMsg.includes('task_usuarios_email_normalizado_uidx') ||
        errorMsg.includes('task_usuarios_email_key') ||
        errorMsg.toLowerCase().includes('duplicate key')

      if (isUniqueEmail) {
        setFormEmailError('Já existe um usuário cadastrado com este e-mail.')
      } else {
        setFormGeralError(err?.message || 'Ocorreu um erro ao salvar o usuário. Tente novamente.')
      }
    } finally {
      setSalvando(false)
    }
  }

  // Iniciar exclusão de usuário
  const handleSolicitarExclusao = (u: TaskUsuarioRecord) => {
    setUsuarioParaExcluir(u)
    setDeleteConfirmOpen(true)
  }

  // Confirmar exclusão real (DELETE)
  const handleConfirmarExclusao = async () => {
    if (!usuarioParaExcluir || excluindo) return

    setExcluindo(true)
    try {
      await controleService.deleteUsuario(usuarioParaExcluir.id)
      setUsuarios((prev) => prev.filter((u) => u.id !== usuarioParaExcluir.id))
      setDeleteConfirmOpen(false)
      toast({
        title: 'Usuário excluído',
        description: `O usuário "${usuarioParaExcluir.nome}" foi removido com sucesso.`,
      })
      setUsuarioParaExcluir(null)
    } catch (err: any) {
      console.error('Erro ao excluir usuário:', err)
      setDeleteConfirmOpen(false)

      const errorMsg = String(err?.message || '')
      const isFkError =
        err?.code === '23503' ||
        errorMsg.includes('23503') ||
        errorMsg.toLowerCase().includes('foreign key') ||
        errorMsg.toLowerCase().includes('violates foreign key constraint') ||
        errorMsg.toLowerCase().includes('task_tarefas')

      if (isFkError) {
        toast({
          variant: 'destructive',
          title: 'Não é possível excluir',
          description:
            'Este usuário possui controles vinculados e não pode ser excluído. Desative-o para preservar o histórico.',
        })
      } else {
        toast({
          variant: 'destructive',
          title: 'Erro ao excluir usuário',
          description: err?.message || 'Falha ao excluir o usuário. Tente novamente.',
        })
      }
    } finally {
      setExcluindo(false)
    }
  }

  // Filtragem e ordenação por nome
  const listaFiltrada = useMemo(() => {
    let list = [...usuarios]
    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      list = list.filter(
        (u) =>
          (u.nome && u.nome.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q)),
      )
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [usuarios, busca])

  return (
    <div className="space-y-6 animate-fade-in w-full min-w-0">
      {/* Cabeçalho */}
      <PageHeader
        title="Usuários"
        subtitle="Gerenciamento de responsáveis e executores do Ricci Task"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={carregarUsuarios}
              disabled={loading || salvando || excluindo}
              className="h-10 rounded-xl px-3 border-border hover:bg-muted"
              title="Recarregar listagem"
            >
              <RotateCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>
            <Button
              onClick={handleNovoUsuario}
              className="h-10 px-4 rounded-xl font-semibold bg-primary hover:bg-[#4A4AC2] text-primary-foreground shadow-sm flex items-center gap-2"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Novo Usuário</span>
            </Button>
          </div>
        }
      />

      {/* Barra de Busca e Contadores */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-card flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
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

        <div className="flex items-center gap-3 text-xs text-muted-foreground self-end sm:self-center flex-wrap">
          <span>
            Total: <strong className="text-foreground">{usuarios.length}</strong>
          </span>
          <span>•</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
            Ativos: {usuarios.filter((u) => u.ativo).length}
          </span>
          <span>•</span>
          <span className="text-muted-foreground">
            Inativos: {usuarios.filter((u) => !u.ativo).length}
          </span>
        </div>
      </div>

      {/* Tabela de Usuários */}
      <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span>Carregando usuários...</span>
          </div>
        ) : listaFiltrada.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Users className="w-10 h-10 text-muted-foreground/60 mx-auto" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground text-sm">
                {busca ? 'Nenhum usuário encontrado' : 'Nenhum usuário cadastrado'}
              </p>
              <p className="text-xs text-muted-foreground">
                {busca
                  ? 'Tente buscar por outro termo ou nome.'
                  : 'Clique no botão "Novo Usuário" para cadastrar.'}
              </p>
            </div>
            {busca ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBusca('')}
                className="rounded-xl text-xs"
              >
                Limpar busca
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleNovoUsuario}
                className="rounded-xl text-xs bg-primary text-primary-foreground hover:bg-[#4A4AC2]"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Novo Usuário
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/80 bg-muted/40 text-xs font-semibold text-muted-foreground">
                  <th className="py-3 px-4">Nome</th>
                  <th className="py-3 px-4">E-mail</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-sm">
                {listaFiltrada.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    {/* Coluna Nome */}
                    <td className="py-3.5 px-4 font-semibold text-foreground">{item.nome}</td>

                    {/* Coluna E-mail */}
                    <td className="py-3.5 px-4 text-muted-foreground text-xs sm:text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
                        <span>{item.email}</span>
                      </span>
                    </td>

                    {/* Coluna Status */}
                    <td className="py-3.5 px-4">
                      {item.ativo ? (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Ativo</span>
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-muted text-muted-foreground border border-border text-xs font-medium px-2.5 py-0.5 rounded-full inline-flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" />
                          <span>Inativo</span>
                        </Badge>
                      )}
                    </td>

                    {/* Coluna Ações */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditarUsuario(item)}
                          className="h-8 px-2.5 text-xs rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Editar usuário"
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          <span>Editar</span>
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSolicitarExclusao(item)}
                          className="h-8 px-2.5 text-xs rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Excluir usuário"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          <span>Excluir</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Cadastro / Edição de Usuário */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl p-6">
          <form onSubmit={handleSalvarUsuario} className="space-y-5">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-bold text-foreground">
                {usuarioEditando ? 'Editar Usuário' : 'Novo Usuário'}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {usuarioEditando
                  ? 'Atualize os dados e a situação do usuário.'
                  : 'Preencha os campos para cadastrar um novo usuário.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Campo Nome */}
              <div className="space-y-1.5">
                <Label htmlFor="usuario-nome" className="text-xs font-semibold text-foreground">
                  Nome <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="usuario-nome"
                  type="text"
                  placeholder="Nome completo do usuário"
                  value={formNome}
                  onChange={(e) => {
                    setFormNome(e.target.value)
                    if (formNomeError) setFormNomeError(null)
                  }}
                  disabled={salvando}
                  className={cn(
                    'h-10 rounded-xl bg-background text-sm',
                    formNomeError && 'border-destructive focus-visible:ring-destructive',
                  )}
                  autoFocus
                />
                {formNomeError && (
                  <p className="text-xs text-destructive font-medium">{formNomeError}</p>
                )}
              </div>

              {/* Campo E-mail */}
              <div className="space-y-1.5">
                <Label htmlFor="usuario-email" className="text-xs font-semibold text-foreground">
                  E-mail <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="usuario-email"
                  type="email"
                  placeholder="exemplo@email.com"
                  value={formEmail}
                  onChange={(e) => {
                    setFormEmail(e.target.value)
                    if (formEmailError) setFormEmailError(null)
                  }}
                  disabled={salvando}
                  className={cn(
                    'h-10 rounded-xl bg-background text-sm',
                    formEmailError && 'border-destructive focus-visible:ring-destructive',
                  )}
                />
                {formEmailError && (
                  <p className="text-xs text-destructive font-medium">{formEmailError}</p>
                )}
              </div>

              {/* Campo Status (Ativo / Inativo) */}
              <div className="p-3.5 rounded-xl bg-muted/40 border border-border flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="usuario-status"
                    className="text-xs font-semibold text-foreground cursor-pointer"
                  >
                    Status
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    {formAtivo
                      ? 'Usuário ativo e disponível para seleção nos controles.'
                      : 'Usuário inativo. Não aparecerá para seleção em novos controles.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      formAtivo
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-muted-foreground',
                    )}
                  >
                    {formAtivo ? 'Ativo' : 'Inativo'}
                  </span>
                  <Switch
                    id="usuario-status"
                    checked={formAtivo}
                    onCheckedChange={setFormAtivo}
                    disabled={salvando}
                  />
                </div>
              </div>

              {/* Erro geral */}
              {formGeralError && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formGeralError}</span>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                disabled={salvando}
                className="h-10 rounded-xl text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={salvando}
                className="h-10 px-5 rounded-xl text-xs font-semibold bg-primary hover:bg-[#4A4AC2] text-primary-foreground shadow-sm"
              >
                {salvando && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                <span>{salvando ? 'Salvando...' : 'Salvar'}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação de Exclusão (Requisito 4) */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[420px] rounded-2xl p-6">
          <DialogHeader className="flex flex-col items-start gap-2">
            <div className="h-10 w-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-foreground">Excluir usuário</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Deseja excluir esse usuário?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0 flex-col-reverse sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={excluindo}
              onClick={() => {
                setDeleteConfirmOpen(false)
                setUsuarioParaExcluir(null)
              }}
              className="h-10 rounded-xl"
            >
              Não
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={excluindo}
              onClick={handleConfirmarExclusao}
              className="h-10 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold"
            >
              {excluindo && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              <span>{excluindo ? 'Excluindo...' : 'Sim'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
