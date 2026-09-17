import { useState, useEffect, useMemo, useCallback } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Plus,
  Trash2,
  Calendar,
  Clock,
  User,
  CheckCircle2,
  FileText,
  Loader2,
  UserCheck,
  AlertCircle,
  Search,
  FolderKanban,
} from 'lucide-react'
import {
  TaskControleRecord,
  TaskNomeControleRecord,
  TaskUsuarioAtivoRecord,
  TaskStatusRecord,
  TaskStatusProvidenciaRecord,
  TaskTipoPrazoRecord,
  SaveControleInput,
} from '@/types/task'
import { formatDateTimeBR } from '@/lib/formatters'
import { controleService } from '@/services/controleService'
import { useToast } from '@/hooks/use-toast'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { cn } from '@/lib/utils'

interface ControleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  controleToEdit?: TaskControleRecord | null
  statusList: TaskStatusRecord[]
  statusProvidenciaList?: TaskStatusProvidenciaRecord[]
  tiposPrazoList: TaskTipoPrazoRecord[]
  usuariosAtivos?: TaskUsuarioAtivoRecord[]
  onSaved: (controle: TaskControleRecord) => void
}

interface DraftProvidenciaItem {
  id?: string // se já existe no banco
  tempId: string
  providencia: string
  prazo_conclusao: string
  tipo_prazo_id: string
  status_id: string
  ordem: number
  isPersisted?: boolean
}

export function ControleModal({
  open,
  onOpenChange,
  controleToEdit,
  statusList,
  statusProvidenciaList = [],
  tiposPrazoList,
  usuariosAtivos: usuariosProp,
  onSaved,
}: ControleModalProps) {
  const { toast } = useToast()

  // Listas auxiliares (Nomes, Usuários Ativos da RPC, Status Providência)
  const [nomesLista, setNomesLista] = useState<TaskNomeControleRecord[]>([])
  const [usuariosLista, setUsuariosLista] = useState<TaskUsuarioAtivoRecord[]>(usuariosProp || [])
  const [statusProvLista, setStatusProvLista] =
    useState<TaskStatusProvidenciaRecord[]>(statusProvidenciaList)
  const [loadingListas, setLoadingListas] = useState(false)

  // Modal de cadastro rápido (+) exclusivo para Nome do Controle
  const [quickNomeModalOpen, setQuickNomeModalOpen] = useState(false)
  const [quickNomeInput, setQuickNomeInput] = useState('')
  const [quickNomeError, setQuickNomeError] = useState<string | null>(null)
  const [quickNomeSaving, setQuickNomeSaving] = useState(false)

  // Filtros de busca inline para os seletores
  const [buscaNomeSelect, setBuscaNomeSelect] = useState('')
  const [buscaRespSelect, setBuscaRespSelect] = useState('')
  const [buscaExecSelect, setBuscaExecSelect] = useState('')

  // Aba ativa: dados | providencias
  const [activeTab, setActiveTab] = useState<'dados' | 'providencias'>('dados')

  // Estado do formulário: Dados do Caso
  const [nomeControleId, setNomeControleId] = useState('')
  const [identificacaoCaso, setIdentificacaoCaso] = useState('')
  const [statusId, setStatusId] = useState('')
  const getTodayLocalDate = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const [dataAutorizacao, setDataAutorizacao] = useState('')
  const [prazoConclusao, setPrazoConclusao] = useState('')
  const [responsavelUsuarioId, setResponsavelUsuarioId] = useState('')
  const [executorUsuarioId, setExecutorUsuarioId] = useState('')
  const [pastaCliente, setPastaCliente] = useState('')
  const [pastaRicci, setPastaRicci] = useState('')
  const [updatedAtDisplay, setUpdatedAtDisplay] = useState<string | null>(null)

  // Estado das Providências
  const [providencias, setProvidencias] = useState<DraftProvidenciaItem[]>([])
  const [providenciaToDelete, setProvidenciaToDelete] = useState<DraftProvidenciaItem | null>(null)
  const [deleteProvConfirmOpen, setDeleteProvConfirmOpen] = useState(false)

  // Erros de validação
  const [nomeControleError, setNomeControleError] = useState(false)
  const [identificacaoError, setIdentificacaoError] = useState(false)
  const [statusError, setStatusError] = useState(false)
  const [responsavelError, setResponsavelError] = useState(false)
  const [executorError, setExecutorError] = useState(false)
  const [saving, setSaving] = useState(false)

  // Status de providência padrão: providência nova deve iniciar como "Em andamento"
  const statusProvPadraoId = useMemo(() => {
    const emAndamento = statusProvLista.find(
      (s) => s.codigo === 'em_andamento' || s.nome.toLowerCase() === 'em andamento',
    )
    return emAndamento?.id || statusProvLista[0]?.id || ''
  }, [statusProvLista])

  // Status geral do controle padrão: controle novo inicia como "Pendente" ou primeiro por ordem
  const statusPadraoId = useMemo(() => {
    const pendente = statusList.find(
      (s) => s.codigo === 'pendente' || s.nome.toLowerCase() === 'pendente',
    )
    return pendente?.id || statusList[0]?.id || ''
  }, [statusList])

  // Tipo de prazo padrão
  const tipoPrazoPadraoId = useMemo(() => {
    return tiposPrazoList[0]?.id || ''
  }, [tiposPrazoList])

  // Carrega listas auxiliares
  const carregarListasAuxiliares = useCallback(async () => {
    setLoadingListas(true)
    try {
      const [nomes, users, stProv] = await Promise.all([
        controleService.getNomesControle({ incluirInativos: true }),
        controleService.getUsuariosAtivos().catch((fetchErr) => {
          console.error('Falha ao carregar usuários de task_usuarios:', fetchErr)
          toast({
            variant: 'destructive',
            title: 'Erro ao carregar usuários',
            description:
              'Não foi possível obter a lista de usuários disponíveis. Verifique a conexão.',
          })
          return [] as TaskUsuarioAtivoRecord[]
        }),
        statusProvidenciaList.length > 0
          ? Promise.resolve(statusProvidenciaList)
          : controleService.getStatusProvidencia(),
      ])

      // Se estiver editando e o responsável/executor atual não estiver na lista de ativos,
      // buscamos todos os usuários para garantir que o valor existente seja preservado legivelmente
      let listaCombinada = [...users]
      const respId = controleToEdit?.responsavel_usuario_id
      const execId = controleToEdit?.executor_usuario_id
      const respFalta = respId && !listaCombinada.some((u) => u.id === respId)
      const execFalta = execId && !listaCombinada.some((u) => u.id === execId)

      if (respFalta || execFalta) {
        try {
          const todos = await controleService.getTodosUsuarios()
          todos.forEach((tu) => {
            if (
              (tu.perfil_id === respId || tu.perfil_id === execId) &&
              !listaCombinada.some((u) => u.id === tu.perfil_id)
            ) {
              listaCombinada.push({
                id: tu.perfil_id,
                nome: tu.nome,
                email: tu.email,
                ativo: tu.ativo,
                ativo_no_conectai: tu.ativo_no_conectai,
              })
            }
          })
        } catch (err) {
          console.error('Aviso ao preservar usuário existente em edição:', err)
        }
      }

      setNomesLista(nomes)
      setUsuariosLista(listaCombinada)
      setStatusProvLista(stProv)
    } catch (err) {
      console.error('Erro ao carregar listas auxiliares no ControleModal:', err)
    } finally {
      setLoadingListas(false)
    }
  }, [statusProvidenciaList, toast])

  // Popula o formulário ao abrir
  useEffect(() => {
    if (!open) return

    carregarListasAuxiliares()
    setActiveTab('dados')
    setNomeControleError(false)
    setIdentificacaoError(false)
    setStatusError(false)
    setResponsavelError(false)
    setExecutorError(false)
    setBuscaNomeSelect('')
    setBuscaRespSelect('')
    setBuscaExecSelect('')

    if (controleToEdit) {
      setNomeControleId(controleToEdit.nome_controle_id || '')
      setIdentificacaoCaso(controleToEdit.identificacao_caso || '')
      setStatusId(controleToEdit.status_id || statusPadraoId)
      setDataAutorizacao(
        controleToEdit.data_autorizacao ? controleToEdit.data_autorizacao.split('T')[0] : '',
      )
      setPrazoConclusao(
        controleToEdit.prazo_conclusao ? controleToEdit.prazo_conclusao.split('T')[0] : '',
      )
      setResponsavelUsuarioId(controleToEdit.responsavel_usuario_id || '')
      setExecutorUsuarioId(controleToEdit.executor_usuario_id || '')
      setPastaCliente(controleToEdit.pasta_cliente || '')
      setPastaRicci(controleToEdit.pasta_ricci || '')
      setUpdatedAtDisplay(controleToEdit.updated_at || null)

      // Carrega providências existentes
      const draftList: DraftProvidenciaItem[] = (controleToEdit.providencias || []).map(
        (p, idx) => ({
          id: p.id,
          tempId: p.id || `existing-${idx}`,
          providencia: p.providencia || '',
          prazo_conclusao: p.prazo_conclusao ? p.prazo_conclusao.split('T')[0] : '',
          tipo_prazo_id: p.tipo_prazo_id || tipoPrazoPadraoId,
          status_id: p.status_id || statusProvPadraoId,
          ordem: p.ordem ?? idx,
          isPersisted: true,
        }),
      )
      setProvidencias(draftList)
    } else {
      // Novo controle
      setNomeControleId('')
      setIdentificacaoCaso('')
      setStatusId(statusPadraoId)
      setDataAutorizacao(getTodayLocalDate())
      setPrazoConclusao('')
      setResponsavelUsuarioId('')
      setExecutorUsuarioId('')
      setPastaCliente('')
      setPastaRicci('')
      setUpdatedAtDisplay(null)
      setProvidencias([])
    }
  }, [
    open,
    controleToEdit,
    statusPadraoId,
    tipoPrazoPadraoId,
    statusProvPadraoId,
    carregarListasAuxiliares,
  ])

  // Opções de Status do Controle
  const opcoesStatusControle = useMemo(() => {
    return statusList
      .filter((st) => st.ativo || st.id === statusId)
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  }, [statusList, statusId])

  // Opções de Nomes dos Controles
  const opcoesNomes = useMemo(() => {
    let list = nomesLista.filter((n) => n.ativo || n.id === nomeControleId)
    if (buscaNomeSelect.trim()) {
      const q = buscaNomeSelect.trim().toLowerCase()
      list = list.filter((n) => n.nome.toLowerCase().includes(q))
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [nomesLista, nomeControleId, buscaNomeSelect])

  // Opções de Responsáveis (task_usuarios com ativo e ativo_no_conectai = true, ou o já selecionado)
  const opcoesResponsaveis = useMemo(() => {
    let list = usuariosLista.filter((u) => {
      // Sempre permitir o usuário que já está selecionado na edição (para preservá-lo)
      if (u.id === responsavelUsuarioId) return true
      // Novos ou outras seleções: apenas ativos em ambos
      return (u.ativo ?? true) && (u.ativo_no_conectai ?? true)
    })
    if (buscaRespSelect.trim()) {
      const q = buscaRespSelect.trim().toLowerCase()
      list = list.filter(
        (u) => u.nome.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)),
      )
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [usuariosLista, responsavelUsuarioId, buscaRespSelect])

  // Opções de Executores (task_usuarios com ativo e ativo_no_conectai = true, ou o já selecionado)
  const opcoesExecutores = useMemo(() => {
    let list = usuariosLista.filter((u) => {
      // Sempre permitir o usuário que já está selecionado na edição (para preservá-lo)
      if (u.id === executorUsuarioId) return true
      // Novos ou outras seleções: apenas ativos em ambos
      return (u.ativo ?? true) && (u.ativo_no_conectai ?? true)
    })
    if (buscaExecSelect.trim()) {
      const q = buscaExecSelect.trim().toLowerCase()
      list = list.filter(
        (u) => u.nome.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)),
      )
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [usuariosLista, executorUsuarioId, buscaExecSelect])

  // Ordenação visual dos cards de providências pelo prazo de conclusão crescente.
  const providenciasExibicao = useMemo(() => {
    return [...providencias].sort((a, b) => {
      if (!a.prazo_conclusao && !b.prazo_conclusao) return a.ordem - b.ordem
      if (!a.prazo_conclusao) return 1
      if (!b.prazo_conclusao) return -1
      if (a.prazo_conclusao !== b.prazo_conclusao) {
        return a.prazo_conclusao.localeCompare(b.prazo_conclusao)
      }
      return a.ordem - b.ordem
    })
  }, [providencias])

  // Adicionar nova providência
  const handleAdicionarProvidencia = () => {
    const novoItem: DraftProvidenciaItem = {
      tempId: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      providencia: '',
      prazo_conclusao: '',
      tipo_prazo_id: tipoPrazoPadraoId,
      status_id: statusProvPadraoId,
      ordem: providencias.length,
      isPersisted: false,
    }
    setProvidencias((prev) => [...prev, novoItem])
  }

  // Atualizar campo de uma providência específica
  const handleUpdateProvidencia = (
    tempId: string,
    field: keyof DraftProvidenciaItem,
    value: any,
  ) => {
    setProvidencias((prev) =>
      prev.map((item) => (item.tempId === tempId ? { ...item, [field]: value } : item)),
    )
  }

  // Solicitar remoção de uma providência
  const handleSolicitarRemocaoProvidencia = (item: DraftProvidenciaItem) => {
    if (item.isPersisted && item.id) {
      setProvidenciaToDelete(item)
      setDeleteProvConfirmOpen(true)
    } else {
      setProvidencias((prev) => prev.filter((p) => p.tempId !== item.tempId))
      toast({ title: 'Providência removida' })
    }
  }

  // Confirmar exclusão lógica de providência já persistida no banco
  const handleConfirmarExclusaoProvidencia = async () => {
    if (!providenciaToDelete?.id) return
    try {
      await controleService.deleteProvidencia(providenciaToDelete.id)
      setProvidencias((prev) => prev.filter((p) => p.id !== providenciaToDelete.id))
      toast({ title: 'Providência excluída com sucesso' })
      if (controleToEdit?.id) {
        const freshUpdated = await controleService.getControleUpdatedAt(controleToEdit.id)
        if (freshUpdated) setUpdatedAtDisplay(freshUpdated)
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir providência',
        description: err?.message || 'Falha na exclusão lógica.',
      })
    } finally {
      setProvidenciaToDelete(null)
      setDeleteProvConfirmOpen(false)
    }
  }

  // Cadastro rápido de Nome do Controle
  const handleSalvarQuickNome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (quickNomeSaving) return
    setQuickNomeError(null)
    const clean = quickNomeInput.trim()
    if (!clean) {
      setQuickNomeError('O Nome do Controle é obrigatório.')
      return
    }
    if (clean.length > 500) {
      setQuickNomeError('Máximo de 500 caracteres.')
      return
    }
    if (!/[\p{L}\p{N}]/u.test(clean)) {
      setQuickNomeError('Deve conter letras ou números.')
      return
    }

    setQuickNomeSaving(true)
    try {
      const saved = await controleService.saveNomeControle({ nome: clean, ativo: true })
      await carregarListasAuxiliares()
      setNomeControleId(saved.id)
      setNomeControleError(false)
      setQuickNomeModalOpen(false)
      setQuickNomeInput('')
      toast({
        title: 'Nome do Controle cadastrado',
        description: `"${saved.nome}" foi selecionado automaticamente.`,
      })
    } catch (err: any) {
      if (
        err?.code === '23505' ||
        err?.message?.includes('23505') ||
        err?.message?.includes('Já existe um Nome do Controle equivalente')
      ) {
        setQuickNomeError('Já existe um Nome do Controle equivalente a este.')
      } else {
        setQuickNomeError(err?.message || 'Erro ao cadastrar nome do controle.')
      }
    } finally {
      setQuickNomeSaving(false)
    }
  }

  // Submit principal do controle (impede duplo envio com flag saving)
  const handleSubmitControle = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (saving) return

    let hasError = false
    if (!nomeControleId) {
      setNomeControleError(true)
      hasError = true
    }
    if (!identificacaoCaso.trim()) {
      setIdentificacaoError(true)
      hasError = true
    }
    if (!statusId) {
      setStatusError(true)
      hasError = true
    }
    if (!responsavelUsuarioId) {
      setResponsavelError(true)
      hasError = true
    }
    if (!executorUsuarioId) {
      setExecutorError(true)
      hasError = true
    }

    if (hasError) {
      setActiveTab('dados')
      toast({
        variant: 'destructive',
        title: 'Campos obrigatórios',
        description:
          'Preencha Nome do Controle, Identificação do Caso, Status, Responsável e Executor.',
      })
      return
    }

    // Validação das providências incluídas
    for (let i = 0; i < providencias.length; i++) {
      const p = providencias[i]
      if (!p.providencia.trim() || !p.prazo_conclusao || !p.tipo_prazo_id || !p.status_id) {
        setActiveTab('providencias')
        toast({
          variant: 'destructive',
          title: 'Providência incompleta',
          description: `Preencha todos os campos obrigatórios (Providência, Prazo, Tipo e Status) da providência #${i + 1}.`,
        })
        return
      }
    }

    const payload: SaveControleInput = {
      id: controleToEdit?.id,
      nome_controle_id: nomeControleId,
      identificacao_caso: identificacaoCaso.trim(),
      status_id: statusId,
      data_autorizacao: dataAutorizacao || null,
      prazo_conclusao: prazoConclusao || null,
      responsavel_usuario_id: responsavelUsuarioId,
      executor_usuario_id: executorUsuarioId,
      pasta_cliente: pastaCliente.trim() || null,
      pasta_ricci: pastaRicci.trim() || null,
    }

    setSaving(true)
    try {
      // 1. Salva o controle principal em task_tarefas
      const savedControle = await controleService.saveControle(payload, usuariosLista)

      // 2. Salva as providências (inserção ou atualização individual)
      if (providencias.length > 0) {
        for (let i = 0; i < providencias.length; i++) {
          const p = providencias[i]
          await controleService.saveProvidencia({
            id: p.id,
            tarefa_id: savedControle.id,
            providencia: p.providencia.trim(),
            prazo_conclusao: p.prazo_conclusao,
            tipo_prazo_id: p.tipo_prazo_id,
            status_id: p.status_id,
            ordem: i,
          })
        }
      }

      // 3. Recarrega controle completo com relacionamentos hidratados
      const fullyLoaded = await controleService.getControleById(savedControle.id, usuariosLista)
      onSaved(fullyLoaded || savedControle)

      toast({
        title: controleToEdit ? 'Controle atualizado' : 'Controle criado com sucesso',
        description: `Caso: ${savedControle.identificacao_caso}`,
      })
      onOpenChange(false)
    } catch (err: any) {
      console.error('Erro ao salvar controle:', err)
      toast({
        variant: 'destructive',
        title: 'Falha ao salvar controle',
        description: err?.message || 'Ocorreu um erro no banco de dados Supabase.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col p-0 rounded-2xl border-border bg-card">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/70 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  <span>
                    {controleToEdit ? 'Editar Controle de Caso' : 'Novo Controle de Caso'}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  Gerenciamento de controles com acompanhamento por providências.
                </DialogDescription>
              </div>

              {updatedAtDisplay && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-muted/60 border border-border text-[11px] text-muted-foreground">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  <span>Última atualização:</span>
                  <strong className="text-foreground">{formatDateTimeBR(updatedAtDisplay)}</strong>
                </div>
              )}
            </div>

            {/* Abas: Apenas Dados do Caso | Providência (N) */}
            <Tabs
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as 'dados' | 'providencias')}
              className="w-full mt-3"
            >
              <TabsList className="grid w-full grid-cols-2 rounded-xl bg-muted/60 p-1">
                <TabsTrigger value="dados" className="rounded-lg text-xs font-semibold">
                  Dados do Caso
                </TabsTrigger>
                <TabsTrigger value="providencias" className="rounded-lg text-xs font-semibold">
                  Providência ({providencias.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </DialogHeader>

          {/* Conteúdo com scroll */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* ============================================================= */}
            {/* ABA 1: DADOS DO CASO                                          */}
            {/* ============================================================= */}
            {activeTab === 'dados' && (
              <div className="space-y-5">
                {/* Bloco 1: Nome do Controle e Identificação do Caso */}
                <div className="space-y-4">
                  {/* Nome do Controle (task_nomes_controle) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="nome-controle-select"
                        className="text-xs font-semibold text-foreground flex items-center gap-1"
                      >
                        <span>Nome do Controle</span>
                        <span className="text-destructive">*</span>
                      </Label>
                      <span className="text-[11px] text-muted-foreground">
                        Tabela task_nomes_controle
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Select
                          value={nomeControleId}
                          onValueChange={(val) => {
                            setNomeControleId(val)
                            if (nomeControleError) setNomeControleError(false)
                          }}
                        >
                          <SelectTrigger
                            id="nome-controle-select"
                            className={cn(
                              'h-11 rounded-xl bg-background font-medium text-left truncate text-xs sm:text-sm',
                              nomeControleError &&
                                'border-destructive focus-visible:ring-destructive',
                            )}
                          >
                            <SelectValue placeholder="Selecione o Nome do Controle..." />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl max-h-80 w-[var(--radix-select-trigger-width)]">
                            <div className="p-2 border-b border-border sticky top-0 bg-popover z-10">
                              <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                <Input
                                  placeholder="Filtrar nomes..."
                                  value={buscaNomeSelect}
                                  onChange={(e) => setBuscaNomeSelect(e.target.value)}
                                  className="h-8 pl-8 pr-2 text-xs rounded-lg"
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                />
                              </div>
                            </div>

                            {loadingListas ? (
                              <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                <span>Carregando nomes...</span>
                              </div>
                            ) : opcoesNomes.length === 0 ? (
                              <div className="p-4 text-center text-xs text-muted-foreground">
                                Nenhum Nome do Controle encontrado.
                              </div>
                            ) : (
                              opcoesNomes.map((n) => (
                                <SelectItem key={n.id} value={n.id} className="py-2.5">
                                  <div className="flex items-center justify-between w-full gap-2">
                                    <span className="font-semibold text-foreground text-xs leading-snug break-words">
                                      {n.nome}
                                    </span>
                                    {!n.ativo && (
                                      <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-muted text-muted-foreground border shrink-0">
                                        Inativo
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Botão + compacto mantido para Nomes de Controles */}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setQuickNomeInput('')
                          setQuickNomeError(null)
                          setQuickNomeModalOpen(true)
                        }}
                        className="h-11 w-11 p-0 rounded-xl shrink-0 border-border hover:bg-primary/10 hover:text-primary hover:border-primary/40"
                        title="Cadastrar novo Nome do Controle"
                      >
                        <Plus className="w-5 h-5 stroke-[2.5]" />
                      </Button>
                    </div>

                    {nomeControleError && (
                      <p className="text-xs text-destructive font-medium">
                        O Nome do Controle é obrigatório. Selecione uma opção válida.
                      </p>
                    )}
                  </div>

                  {/* Identificação do Caso */}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="ident-caso"
                      className="text-xs font-semibold text-foreground flex items-center justify-between"
                    >
                      <span>
                        Identificação do Caso <span className="text-destructive">*</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">Obrigatório</span>
                    </Label>
                    <Input
                      id="ident-caso"
                      value={identificacaoCaso}
                      onChange={(e) => {
                        setIdentificacaoCaso(e.target.value)
                        if (identificacaoError && e.target.value.trim()) {
                          setIdentificacaoError(false)
                        }
                      }}
                      className={cn(
                        'h-10 rounded-xl bg-background font-medium',
                        identificacaoError && 'border-destructive focus-visible:ring-destructive',
                      )}
                    />
                    {identificacaoError && (
                      <p className="text-xs text-destructive font-medium">
                        A Identificação do Caso é obrigatória.
                      </p>
                    )}
                  </div>
                </div>

                {/* Bloco 2: Seção Status do Controle (Status, Data de Autorização, Prazo de Conclusão) */}
                <div className="p-4 rounded-xl bg-muted/30 border border-border/60 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                    <span>Status do Controle</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Status (obrigatório, task_status) */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Status <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={statusId}
                        onValueChange={(val) => {
                          setStatusId(val)
                          if (statusError) setStatusError(false)
                        }}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-10 rounded-xl bg-background',
                            statusError && 'border-destructive focus-visible:ring-destructive',
                          )}
                        >
                          <SelectValue placeholder="Selecione o status" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          {opcoesStatusControle.map((st) => (
                            <SelectItem key={st.id} value={st.id}>
                              <div className="flex items-center gap-2">
                                <span>{st.nome}</span>
                                {!st.ativo && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-muted text-muted-foreground border shrink-0">
                                    Inativo
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {statusError && (
                        <p className="text-xs text-destructive font-medium">Selecione um status.</p>
                      )}
                    </div>

                    {/* Data de Autorização */}
                    <div className="space-y-1.5">
                      <Label htmlFor="data-autorizacao" className="text-xs font-semibold">
                        Data de Autorização
                      </Label>
                      <Input
                        id="data-autorizacao"
                        type="date"
                        value={dataAutorizacao}
                        onChange={(e) => setDataAutorizacao(e.target.value)}
                        className="h-10 rounded-xl bg-background"
                      />
                    </div>

                    {/* Prazo de Conclusão */}
                    <div className="space-y-1.5">
                      <Label htmlFor="prazo-conclusao" className="text-xs font-semibold">
                        Prazo de Conclusão
                      </Label>
                      <Input
                        id="prazo-conclusao"
                        type="date"
                        value={prazoConclusao}
                        onChange={(e) => setPrazoConclusao(e.target.value)}
                        className="h-10 rounded-xl bg-background"
                      />
                    </div>
                  </div>
                </div>

                {/* Bloco 3: Responsável e Executor (única fonte: task_usuarios) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Responsável */}
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                        <User className="w-4 h-4 text-primary" />
                        <span>
                          Responsável <span className="text-destructive">*</span>
                        </span>
                      </div>
                    </div>

                    <div className="relative">
                      <Select
                        value={responsavelUsuarioId}
                        onValueChange={(val) => {
                          setResponsavelUsuarioId(val)
                          if (responsavelError) setResponsavelError(false)
                        }}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-12 rounded-xl bg-background text-sm font-medium',
                            responsavelError && 'border-destructive focus-visible:ring-destructive',
                          )}
                        >
                          <SelectValue placeholder="Selecione o responsável..." />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl max-h-80 w-[var(--radix-select-trigger-width)]">
                          <div className="p-2 border-b border-border sticky top-0 bg-popover z-10">
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                              <Input
                                placeholder="Filtrar por nome ou e-mail..."
                                value={buscaRespSelect}
                                onChange={(e) => setBuscaRespSelect(e.target.value)}
                                className="h-8 pl-8 pr-2 text-xs rounded-lg"
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              />
                            </div>
                          </div>

                          {loadingListas ? (
                            <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              <span>Carregando responsáveis...</span>
                            </div>
                          ) : opcoesResponsaveis.length === 0 ? (
                            <div className="p-4 text-center text-xs text-muted-foreground">
                              Nenhum responsável disponível encontrado.
                            </div>
                          ) : (
                            opcoesResponsaveis.map((r) => {
                              const isInativoLocal = r.ativo === false
                              const isInativoConectai = r.ativo_no_conectai === false
                              return (
                                <SelectItem key={r.id} value={r.id} className="py-2">
                                  <div className="flex flex-col gap-0.5 text-left">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-foreground text-xs">
                                        {r.nome}
                                      </span>
                                      {(isInativoLocal || isInativoConectai) && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                                          {isInativoConectai ? 'Inativo Conectaí' : 'Inativo RT'}
                                        </span>
                                      )}
                                    </div>
                                    {r.email && (
                                      <span className="text-[11px] text-muted-foreground font-normal">
                                        {r.email}
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              )
                            })
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {responsavelError && (
                      <p className="text-xs text-destructive font-medium">
                        O Responsável é obrigatório.
                      </p>
                    )}
                  </div>

                  {/* Executor */}
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                        <UserCheck className="w-4 h-4 text-primary" />
                        <span>
                          Executor <span className="text-destructive">*</span>
                        </span>
                      </div>
                    </div>

                    <div className="relative">
                      <Select
                        value={executorUsuarioId}
                        onValueChange={(val) => {
                          setExecutorUsuarioId(val)
                          if (executorError) setExecutorError(false)
                        }}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-12 rounded-xl bg-background text-sm font-medium',
                            executorError && 'border-destructive focus-visible:ring-destructive',
                          )}
                        >
                          <SelectValue placeholder="Selecione o executor..." />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl max-h-80 w-[var(--radix-select-trigger-width)]">
                          <div className="p-2 border-b border-border sticky top-0 bg-popover z-10">
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                              <Input
                                placeholder="Filtrar por nome ou e-mail..."
                                value={buscaExecSelect}
                                onChange={(e) => setBuscaExecSelect(e.target.value)}
                                className="h-8 pl-8 pr-2 text-xs rounded-lg"
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              />
                            </div>
                          </div>

                          {loadingListas ? (
                            <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              <span>Carregando executores...</span>
                            </div>
                          ) : opcoesExecutores.length === 0 ? (
                            <div className="p-4 text-center text-xs text-muted-foreground">
                              Nenhum executor disponível encontrado.
                            </div>
                          ) : (
                            opcoesExecutores.map((e) => {
                              const isInativoLocal = e.ativo === false
                              const isInativoConectai = e.ativo_no_conectai === false
                              return (
                                <SelectItem key={e.id} value={e.id} className="py-2">
                                  <div className="flex flex-col gap-0.5 text-left">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-foreground text-xs">
                                        {e.nome}
                                      </span>
                                      {(isInativoLocal || isInativoConectai) && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                                          {isInativoConectai ? 'Inativo Conectaí' : 'Inativo RT'}
                                        </span>
                                      )}
                                    </div>
                                    {e.email && (
                                      <span className="text-[11px] text-muted-foreground font-normal">
                                        {e.email}
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              )
                            })
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {executorError && (
                      <p className="text-xs text-destructive font-medium">
                        O Executor é obrigatório.
                      </p>
                    )}
                  </div>
                </div>

                {/* Bloco 4: Pasta Cliente e Pasta Ricci (sem placeholders demonstrativos) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="pasta-cliente"
                      className="text-xs font-semibold text-foreground"
                    >
                      Pasta Cliente
                    </Label>
                    <Input
                      id="pasta-cliente"
                      value={pastaCliente}
                      onChange={(e) => setPastaCliente(e.target.value)}
                      className="h-10 rounded-xl bg-background"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="pasta-ricci" className="text-xs font-semibold text-foreground">
                      Pasta Ricci
                    </Label>
                    <Input
                      id="pasta-ricci"
                      value={pastaRicci}
                      onChange={(e) => setPastaRicci(e.target.value)}
                      className="h-10 rounded-xl bg-background"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* ABA 2: PROVIDÊNCIA (MÚLTIPLAS)                                */}
            {/* ============================================================= */}
            {activeTab === 'providencias' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Providências do Controle</h3>
                    <p className="text-xs text-muted-foreground">
                      Adicione e gerencie providências com prazo, tipo e status individual.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAdicionarProvidencia}
                    className="h-9 rounded-xl px-3.5 bg-primary text-primary-foreground font-semibold text-xs flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                    <span>Adicionar providência</span>
                  </Button>
                </div>

                {providencias.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-2xl bg-muted/20 space-y-2">
                    <Calendar className="w-8 h-8 text-muted-foreground mx-auto" />
                    <p className="text-xs text-muted-foreground">
                      Nenhuma providência adicionada a este controle.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAdicionarProvidencia}
                      className="rounded-xl text-xs"
                    >
                      + Adicionar providência
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {providenciasExibicao.map((item, index) => {
                      return (
                        <div
                          key={item.tempId}
                          className="p-4 rounded-xl border border-border bg-card shadow-xs space-y-3 relative group"
                        >
                          {/* Topo do card da providência */}
                          <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                            <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-bold">
                                {index + 1}
                              </span>
                              <span>Providência #{index + 1}</span>
                              {item.isPersisted && (
                                <span className="text-[10px] text-muted-foreground font-normal">
                                  (salva no banco)
                                </span>
                              )}
                            </span>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSolicitarRemocaoProvidencia(item)}
                              className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Remover providência"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>

                          {/* Campos da providência */}
                          <div className="space-y-3">
                            {/* Campo 1: Providência (textarea) */}
                            <div className="space-y-1">
                              <Label className="text-xs font-semibold flex items-center justify-between">
                                <span>
                                  Providência <span className="text-destructive">*</span>
                                </span>
                                <span className="text-[11px] text-muted-foreground font-normal">
                                  Descrição detalhada
                                </span>
                              </Label>
                              <Textarea
                                rows={2}
                                value={item.providencia}
                                onChange={(e) =>
                                  handleUpdateProvidencia(
                                    item.tempId,
                                    'providencia',
                                    e.target.value,
                                  )
                                }
                                className="resize-y min-h-[60px] rounded-xl bg-background text-xs sm:text-sm"
                              />
                            </div>

                            {/* Campos 2, 3 e 4 em grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {/* Campo 2: Prazo de Conclusão (date) */}
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold">
                                  Prazo de Conclusão <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                  type="date"
                                  value={item.prazo_conclusao}
                                  onChange={(e) =>
                                    handleUpdateProvidencia(
                                      item.tempId,
                                      'prazo_conclusao',
                                      e.target.value,
                                    )
                                  }
                                  className="h-9 rounded-xl bg-background text-xs"
                                />
                              </div>

                              {/* Campo 3: Tipo de Prazo */}
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold">
                                  Tipo de Prazo <span className="text-destructive">*</span>
                                </Label>
                                <Select
                                  value={item.tipo_prazo_id}
                                  onValueChange={(val) =>
                                    handleUpdateProvidencia(item.tempId, 'tipo_prazo_id', val)
                                  }
                                >
                                  <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                                    <SelectValue placeholder="Selecione o tipo..." />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-xl">
                                    {tiposPrazoList.map((tp) => (
                                      <SelectItem key={tp.id} value={tp.id}>
                                        {tp.nome}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Campo 4: Status (task_status_providencia) */}
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold">
                                  Status <span className="text-destructive">*</span>
                                </Label>
                                <Select
                                  value={item.status_id}
                                  onValueChange={(val) =>
                                    handleUpdateProvidencia(item.tempId, 'status_id', val)
                                  }
                                >
                                  <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                                    <SelectValue placeholder="Selecione o status..." />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-xl">
                                    {statusProvLista.map((sp) => (
                                      <SelectItem key={sp.id} value={sp.id}>
                                        <div className="flex items-center gap-1.5">
                                          <span>{sp.nome}</span>
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer fixo */}
          <DialogFooter className="px-6 py-4 border-t border-border/70 shrink-0 bg-muted/20 flex flex-row items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground hidden sm:block">
              Campos marcados com <span className="text-destructive">*</span> são obrigatórios.
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => onOpenChange(false)}
                className="h-10 px-4 rounded-xl text-xs"
              >
                Cancelar
              </Button>

              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => handleSubmitControle()}
                className="h-10 px-5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-[#4A4AC2]"
              >
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <span>{controleToEdit ? 'Salvar Alterações' : 'Criar Controle'}</span>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de Exclusão de Providência */}
      <DeleteConfirmDialog
        open={deleteProvConfirmOpen}
        onOpenChange={setDeleteProvConfirmOpen}
        title="Excluir providência"
        description="Tem certeza de que deseja remover esta providência salva no banco de dados? A alteração é imediata."
        confirmButtonText="Sim, excluir providência"
        onConfirm={handleConfirmarExclusaoProvidencia}
      />

      {/* Modal Compacto (+) para cadastrar novo Nome do Controle */}
      <Dialog open={quickNomeModalOpen} onOpenChange={setQuickNomeModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-primary" />
              <span>Novo Nome do Controle</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Cadastre um novo nome do controle para selecioná-lo imediatamente neste caso.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSalvarQuickNome} className="space-y-3.5 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="quick-nome-input" className="text-xs font-semibold text-foreground">
                Nome do Controle <span className="text-destructive">*</span>
              </Label>
              <Input
                id="quick-nome-input"
                autoFocus
                value={quickNomeInput}
                onChange={(e) => {
                  setQuickNomeInput(e.target.value)
                  if (quickNomeError) setQuickNomeError(null)
                }}
                maxLength={500}
                className={cn(
                  'h-10 rounded-xl bg-background text-sm',
                  quickNomeError && 'border-destructive focus-visible:ring-destructive',
                )}
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Máx. 500 caracteres</span>
                <span>{quickNomeInput.trim().length}/500</span>
              </div>
            </div>

            {quickNomeError && (
              <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{quickNomeError}</span>
              </div>
            )}

            <DialogFooter className="pt-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQuickNomeModalOpen(false)}
                className="h-9 rounded-xl text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={quickNomeSaving}
                className="h-9 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-[#4A4AC2]"
              >
                {quickNomeSaving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                <span>Salvar e Selecionar</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
