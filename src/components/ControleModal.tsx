import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Plus,
  Trash2,
  Calendar,
  Calendar as CalendarIcon,
  Clock,
  User,
  CheckCircle2,
  FileText,
  Loader2,
  UserCheck,
  AlertCircle,
  RefreshCw,
  Search,
  FolderKanban,
  Bell,
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
  initialTab?: 'dados' | 'providencias'
  autoAddNewProvidencia?: boolean
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
  data_conclusao?: string | null
  email_alertas?: boolean
  email_alerta_inclusao?: boolean
  email_alerta_atraso?: boolean
  email_alerta_atualizacao?: boolean
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
  initialTab = 'dados',
  autoAddNewProvidencia = false,
  onSaved,
}: ControleModalProps) {
  const { toast } = useToast()

  // Listas auxiliares (Nomes, Usuários Ativos da RPC, Status Providência)
  const [nomesLista, setNomesLista] = useState<TaskNomeControleRecord[]>([])
  const [usuariosLista, setUsuariosLista] = useState<TaskUsuarioAtivoRecord[]>(usuariosProp || [])
  const [statusProvLista, setStatusProvLista] =
    useState<TaskStatusProvidenciaRecord[]>(statusProvidenciaList)
  const [loadingListas, setLoadingListas] = useState(false)
  const [erroListasAuxiliares, setErroListasAuxiliares] = useState<string | null>(null)

  // Controle de versão sequencial de requisição para evitar race conditions em respostas assíncronas concorrentes
  const activeRequestIdRef = useRef<number>(0)

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
  const [executorIsResponsavel, setExecutorIsResponsavel] = useState(false)
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

  // Validação central de usuários: três estados explícitos ('carregando' | 'válida' | 'falhou')
  const [validacaoUsuariosStatus, setValidacaoUsuariosStatus] = useState<
    'carregando' | 'válida' | 'falhou'
  >('carregando')
  const [erroUsuariosCentrais, setErroUsuariosCentrais] = useState<string | null>(null)

  // Carrega listas auxiliares e validação central com versionamento por requestId
  const carregarListasAuxiliares = useCallback(async () => {
    const requestId = ++activeRequestIdRef.current
    setLoadingListas(true)
    setValidacaoUsuariosStatus('carregando')
    setErroUsuariosCentrais(null)
    setErroListasAuxiliares(null)

    try {
      let fetchUsersError: Error | null = null
      let fetchAuxError: Error | null = null
      let usersValidados: TaskUsuarioAtivoRecord[] = []
      let nomes: TaskNomeControleRecord[] = []
      let stProv: TaskStatusProvidenciaRecord[] = []

      // 1. Carregar listas auxiliares (nomes de controle e status de providência)
      try {
        const [nomesRes, stProvRes] = await Promise.all([
          controleService.getNomesControle({ incluirInativos: true }),
          statusProvidenciaList.length > 0
            ? Promise.resolve(statusProvidenciaList)
            : controleService.getStatusProvidencia(),
        ])
        nomes = nomesRes
        stProv = stProvRes
      } catch (auxErr: any) {
        console.error('Falha ao carregar listas auxiliares no ControleModal:', auxErr)
        fetchAuxError = auxErr
      }

      // 2. Carregar validação central de usuários
      try {
        usersValidados = await controleService.getUsuariosAtivos()
      } catch (fetchErr: any) {
        console.error('Falha ao carregar usuários elegíveis com dados centrais:', fetchErr)
        fetchUsersError = fetchErr
      }

      // Ignora respostas obsoletas de carregamentos simultâneos anteriores
      if (requestId !== activeRequestIdRef.current) {
        return
      }

      if (fetchAuxError) {
        const msgAux =
          (fetchAuxError as any)?.message ||
          'Falha técnica ao carregar listas auxiliares do controle.'
        setErroListasAuxiliares(msgAux)
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar listas auxiliares',
          description: msgAux,
        })
      }

      if (fetchUsersError) {
        const errorMsg =
          (fetchUsersError as any)?.message ||
          'Falha técnica ao consultar dados centrais no Gestor de Acessos. Novos vínculos estão temporariamente suspensos.'
        setErroUsuariosCentrais(errorMsg)
        setValidacaoUsuariosStatus('falhou')
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar usuários elegíveis',
          description: errorMsg,
        })
      } else if (fetchAuxError) {
        // Se a lista auxiliar falhou, também marcamos falha para bloquear novas ações
        setValidacaoUsuariosStatus('falhou')
      } else {
        setValidacaoUsuariosStatus('válida')
      }

      // Fail-closed & Preservação Histórica:
      // Preserva sempre os responsáveis e executores históricos já gravados no caso em todos os estados
      // (carregando, falhou, válida), nunca deixando o histórico desaparecer do modal.
      let listaCombinada = [...usersValidados]
      const respCore =
        controleToEdit?.responsavel_core_usuario_id || controleToEdit?.responsavel_usuario_id
      const execCore =
        controleToEdit?.executor_core_usuario_id || controleToEdit?.executor_usuario_id
      const respFalta = respCore && !listaCombinada.some((u) => u.id === respCore)
      const execFalta = execCore && !listaCombinada.some((u) => u.id === execCore)

      if (respFalta || execFalta) {
        try {
          const missingIds: string[] = []
          if (respCore && !listaCombinada.some((u) => u.id === respCore)) missingIds.push(respCore)
          if (execCore && !listaCombinada.some((u) => u.id === execCore)) missingIds.push(execCore)

          const fetched = await controleService.getCoreUsuariosByIds(missingIds)
          if (requestId !== activeRequestIdRef.current) return

          for (const [uid, u] of fetched.entries()) {
            if (!listaCombinada.some((cand) => cand.id === uid)) {
              listaCombinada.push({
                id: u.id,
                nome: u.nome,
                email: u.email,
                ativo: u.ativo,
                core_usuario_id: u.id,
              })
            }
          }
        } catch (err) {
          console.error('Aviso ao preservar usuário central existente em edição:', err)
        }
      }

      if (requestId !== activeRequestIdRef.current) return

      if (nomes.length > 0) {
        setNomesLista(nomes)
      }
      setUsuariosLista(listaCombinada)
      if (stProv.length > 0) {
        setStatusProvLista(stProv)
      }
    } catch (err: any) {
      if (requestId === activeRequestIdRef.current) {
        console.error('Erro geral ao carregar dados no ControleModal:', err)
        setValidacaoUsuariosStatus('falhou')
        setErroListasAuxiliares(err?.message || 'Falha ao sincronizar dados do formulário.')
      }
    } finally {
      if (requestId === activeRequestIdRef.current) {
        setLoadingListas(false)
      }
    }
  }, [statusProvidenciaList, toast, controleToEdit])

  // Popula o formulário ao abrir
  useEffect(() => {
    if (!open) return

    carregarListasAuxiliares()
    setActiveTab(initialTab || 'dados')
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
      const editRespId =
        controleToEdit.responsavel_core_usuario_id || controleToEdit.responsavel_usuario_id || ''
      const editExecId =
        controleToEdit.executor_core_usuario_id || controleToEdit.executor_usuario_id || ''
      setResponsavelUsuarioId(editRespId)
      setExecutorUsuarioId(editExecId)
      const sameUser = Boolean(editRespId && editExecId && editRespId === editExecId)
      setExecutorIsResponsavel(sameUser)
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
          data_conclusao: p.data_conclusao ? p.data_conclusao.split('T')[0] : '',
          email_alertas: p.email_alertas ?? false,
          email_alerta_inclusao: p.email_alerta_inclusao ?? false,
          email_alerta_atraso: p.email_alerta_atraso ?? false,
          email_alerta_atualizacao: p.email_alerta_atualizacao ?? false,
          isPersisted: true,
        }),
      )

      if (autoAddNewProvidencia) {
        const maiorOrdem = draftList.reduce((max, p) => Math.max(max, p.ordem ?? 0), -1)
        const autoTempId = `draft-auto-${Date.now()}`
        draftList.push({
          tempId: autoTempId,
          providencia: '',
          prazo_conclusao: '',
          tipo_prazo_id: tipoPrazoPadraoId,
          status_id: statusProvPadraoId,
          ordem: maiorOrdem + 1,
          data_conclusao: null,
          email_alertas: false,
          email_alerta_inclusao: false,
          email_alerta_atraso: false,
          email_alerta_atualizacao: false,
          isPersisted: false,
        })
        setFocusNewProvId(autoTempId)
      }

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
      setExecutorIsResponsavel(false)
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
    initialTab,
    autoAddNewProvidencia,
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

  // Opções de Responsáveis:
  // Três estados da validação central: 'carregando', 'válida' ou 'falhou'.
  // Durante o carregamento inicial e durante "Tentar novamente" (estado !== 'válida'),
  // NÃO permite selecionar novos candidatos; mantém exclusivamente o responsável histórico
  // já gravado visível na edição. Libera novas escolhas somente após a validação completa ('válida').
  const opcoesResponsaveis = useMemo(() => {
    const editRespId =
      controleToEdit?.responsavel_core_usuario_id || controleToEdit?.responsavel_usuario_id
    let list = usuariosLista.filter((u) => {
      // Sempre permitir o usuário histórico que já está gravado no caso (para preservá-lo na visualização)
      if (editRespId && (u.id === editRespId || u.core_usuario_id === editRespId)) return true
      // Durante carregando ou falhou, NÃO oferece candidatos novos
      if (validacaoUsuariosStatus !== 'válida') return false
      return u.ativo ?? true
    })
    if (buscaRespSelect.trim()) {
      const q = buscaRespSelect.trim().toLowerCase()
      list = list.filter(
        (u) => u.nome.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)),
      )
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [usuariosLista, controleToEdit, validacaoUsuariosStatus, buscaRespSelect])

  // Opções de Executores:
  // Durante carregamento inicial e "Tentar novamente" (estado !== 'válida'),
  // NÃO permite selecionar novos candidatos; mantém exclusivamente o executor histórico
  // já gravado visível na edição. Libera novas escolhas somente após a validação completa ('válida').
  const opcoesExecutores = useMemo(() => {
    const editExecId =
      controleToEdit?.executor_core_usuario_id || controleToEdit?.executor_usuario_id
    let list = usuariosLista.filter((u) => {
      // Sempre permitir o usuário histórico que já está gravado no caso (para preservá-lo na visualização)
      if (editExecId && (u.id === editExecId || u.core_usuario_id === editExecId)) return true
      // Durante carregando ou falhou, NÃO oferece candidatos novos
      if (validacaoUsuariosStatus !== 'válida') return false
      return u.ativo ?? true
    })
    if (buscaExecSelect.trim()) {
      const q = buscaExecSelect.trim().toLowerCase()
      list = list.filter(
        (u) => u.nome.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)),
      )
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [usuariosLista, controleToEdit, validacaoUsuariosStatus, buscaExecSelect])

  // Ref para o container de scroll interno do modal
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // ID da providência recém-adicionada que deve receber foco
  const [focusNewProvId, setFocusNewProvId] = useState<string | null>(null)

  // Ordenação visual dos cards na edição:
  // 1. Primeiro providências novas não salvas (drafts / isPersisted !== true), da mais recente para a mais antiga (ordem decrescente)
  // 2. Depois providências já salvas (isPersisted === true), da mais recente para a mais antiga (ordem decrescente de inserção/ordem)
  // Cada item recebe seu `numeroHumano` calculado sequencialmente:
  // - Ordem temporal crescente de criação: persistidas mais antigas primeiro (#1..#M), depois drafts na ordem em que foram criados (#M+1..#N)
  // - Exibição visual decrescente: o mais recente no topo exibe o maior número (#N, #N-1, ...)
  const providenciasExibicao = useMemo(() => {
    const drafts = providencias.filter((p) => !p.isPersisted)
    const persistidas = providencias.filter((p) => p.isPersisted)

    // Drafts em ordem decrescente de ordem (a mais recente adicionada fica no topo)
    drafts.sort((a, b) => (b.ordem ?? 0) - (a.ordem ?? 0))

    // Persistidas em ordem decrescente de ordem histórica
    persistidas.sort((a, b) => (b.ordem ?? 0) - (a.ordem ?? 0))

    const listaOrdenada = [...drafts, ...persistidas]
    const total = listaOrdenada.length

    return listaOrdenada.map((item, index) => ({
      ...item,
      numeroHumano: total - index,
    }))
  }, [providencias])

  // Mapeamento tempId -> numeroHumano para mensagens de validação e feedback amigáveis
  const numeroHumanoMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of providenciasExibicao) {
      map.set(item.tempId, item.numeroHumano)
    }
    return map
  }, [providenciasExibicao])

  // Adicionar nova providência
  const handleAdicionarProvidencia = () => {
    // Sequência superior à maior ordem já existente para preservar a ordem histórica
    const maiorOrdem = providencias.reduce((max, p) => Math.max(max, p.ordem ?? 0), -1)
    const proximaOrdem = maiorOrdem + 1

    const newTempId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const novoItem: DraftProvidenciaItem = {
      tempId: newTempId,
      providencia: '',
      prazo_conclusao: '',
      tipo_prazo_id: tipoPrazoPadraoId,
      status_id: statusProvPadraoId,
      ordem: proximaOrdem,
      data_conclusao: null,
      email_alertas: false,
      email_alerta_inclusao: false,
      email_alerta_atraso: false,
      email_alerta_atualizacao: false,
      isPersisted: false,
    }

    setActiveTab('providencias')
    setProvidencias((prev) => [...prev, novoItem])
    setFocusNewProvId(newTempId)

    // Levar o scroll interno do modal para o topo imediatamente
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      }
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
        }
      }, 50)
    })
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

  // Atualizar múltiplos campos de uma providência específica
  const handleBatchUpdateProvidencia = (tempId: string, updates: Partial<DraftProvidenciaItem>) => {
    setProvidencias((prev) =>
      prev.map((item) => (item.tempId === tempId ? { ...item, ...updates } : item)),
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
        const fullyLoaded = await controleService.getControleById(controleToEdit.id, usuariosLista)
        if (fullyLoaded) onSaved(fullyLoaded)
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
    const existingRespId =
      controleToEdit?.responsavel_core_usuario_id || controleToEdit?.responsavel_usuario_id
    const existingExecId =
      controleToEdit?.executor_core_usuario_id || controleToEdit?.executor_usuario_id

    if (!responsavelUsuarioId) {
      setResponsavelError(true)
      hasError = true
    } else {
      const isHistoricoPreservado =
        controleToEdit &&
        (responsavelUsuarioId === existingRespId ||
          responsavelUsuarioId === controleToEdit.responsavel_usuario_id)
      if (!isHistoricoPreservado) {
        if (validacaoUsuariosStatus !== 'válida' || loadingListas) {
          setResponsavelError(true)
          hasError = true
          toast({
            variant: 'destructive',
            title: 'Atribuição bloqueada',
            description:
              validacaoUsuariosStatus === 'carregando' || loadingListas
                ? 'A validação central de usuários ou carregamento das listas está em andamento. Aguarde para salvar novas atribuições.'
                : 'A validação de usuários ou listas auxiliares falhou. Não é possível alterar ou atribuir novo responsável.',
          })
        }
      }
    }

    if (!executorUsuarioId) {
      setExecutorError(true)
      hasError = true
    } else {
      const isHistoricoPreservado =
        controleToEdit &&
        (executorUsuarioId === existingExecId ||
          executorUsuarioId === controleToEdit.executor_usuario_id)
      if (!isHistoricoPreservado) {
        if (validacaoUsuariosStatus !== 'válida' || loadingListas) {
          setExecutorError(true)
          hasError = true
          toast({
            variant: 'destructive',
            title: 'Atribuição bloqueada',
            description:
              validacaoUsuariosStatus === 'carregando' || loadingListas
                ? 'A validação central de usuários ou carregamento das listas está em andamento. Aguarde para salvar novas atribuições.'
                : 'A validação de usuários ou listas auxiliares falhou. Não é possível alterar ou atribuir novo executor.',
          })
        }
      }
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
      const numProv = numeroHumanoMap.get(p.tempId) ?? i + 1
      if (!p.providencia.trim() || !p.prazo_conclusao || !p.tipo_prazo_id || !p.status_id) {
        setActiveTab('providencias')
        toast({
          variant: 'destructive',
          title: 'Providência incompleta',
          description: `Preencha todos os campos obrigatórios (Providência, Prazo, Tipo e Status) da providência #${numProv}.`,
        })
        return
      }

      const st = statusProvLista.find((s) => s.id === p.status_id)
      const cod = st?.codigo?.toLowerCase() || ''
      if (cod === 'cancelado' || cod === 'concluido' || cod === 'suspenso') {
        if (!p.data_conclusao || !p.data_conclusao.trim()) {
          setActiveTab('providencias')
          toast({
            variant: 'destructive',
            title: 'Data de Conclusão obrigatória',
            description: `A providência #${numProv} está com status "${st?.nome || cod}" e exige o preenchimento da Data de Conclusão.`,
          })
          return
        }
      }
    }

    // Resolve os vínculos centrais a partir da lista validada ou preservada:
    const isEditMode = Boolean(controleToEdit?.id)
    const prevRespCore =
      controleToEdit?.responsavel_core_usuario_id || controleToEdit?.responsavel_usuario_id
    const prevExecCore =
      controleToEdit?.executor_core_usuario_id || controleToEdit?.executor_usuario_id

    const respNaoMudou = isEditMode && responsavelUsuarioId === prevRespCore
    const execNaoMudou = isEditMode && executorUsuarioId === prevExecCore

    const selectedResp = usuariosLista.find(
      (u) => u.id === responsavelUsuarioId || u.core_usuario_id === responsavelUsuarioId,
    )
    const selectedExec = usuariosLista.find(
      (u) => u.id === executorUsuarioId || u.core_usuario_id === executorUsuarioId,
    )

    const respCoreId = respNaoMudou
      ? prevRespCore || selectedResp?.core_usuario_id || responsavelUsuarioId
      : selectedResp?.core_usuario_id || responsavelUsuarioId

    const execCoreId = execNaoMudou
      ? prevExecCore || selectedExec?.core_usuario_id || executorUsuarioId
      : selectedExec?.core_usuario_id || executorUsuarioId

    // Preservação do par operacional histórico:
    // Apenas quando for edição e a atribuição histórica do papel correspondente NÃO tiver mudado.
    // Na criação ou na edição com troca de atribuição, NÃO colar o ID central nas colunas operacionais
    // (deve ser undefined/null, central-only quando não há ponte ou quando houver nova atribuição).
    const opRespPreservado =
      respNaoMudou && controleToEdit?.responsavel_usuario_id && controleToEdit.responsavel_usuario_id !== respCoreId
        ? controleToEdit.responsavel_usuario_id
        : undefined

    const opExecPreservado =
      execNaoMudou && controleToEdit?.executor_usuario_id && controleToEdit.executor_usuario_id !== execCoreId
        ? controleToEdit.executor_usuario_id
        : undefined

    const payload: SaveControleInput = {
      id: controleToEdit?.id,
      nome_controle_id: nomeControleId,
      identificacao_caso: identificacaoCaso.trim(),
      status_id: statusId,
      data_autorizacao: dataAutorizacao || null,
      prazo_conclusao: prazoConclusao || null,
      responsavel_usuario_id: opRespPreservado,
      executor_usuario_id: opExecPreservado,
      responsavel_core_usuario_id: respCoreId,
      executor_core_usuario_id: execCoreId,
      pasta_cliente: pastaCliente.trim() || null,
      pasta_ricci: pastaRicci.trim() || null,
    }

    // Detecção de reatribuição (para disparar notificação): compara IDs CENTRAIS
    let tipoNotificacao: 'nova_atribuicao' | 'alteracao_atribuicao' | null = null
    if (!isEditMode) {
      tipoNotificacao = 'nova_atribuicao'
    } else {
      const mudouExecutor = prevExecCore !== execCoreId
      const mudouResponsavel = prevRespCore !== respCoreId
      if (mudouExecutor || mudouResponsavel) {
        tipoNotificacao = 'alteracao_atribuicao'
      }
    }

    setSaving(true)
    try {
      // 1. Mapa dos valores anteriores das providências existentes antes de salvar (para detecção de alteração real)
      const prevProvidenciasMap = new Map<
        string,
        {
          providencia: string
          prazo_conclusao: string | null
          tipo_prazo_id: string | null
          status_id: string | null
        }
      >()
      if (controleToEdit?.providencias) {
        for (const p of controleToEdit.providencias) {
          if (p.id) {
            prevProvidenciasMap.set(p.id, {
              providencia: (p.providencia || '').trim(),
              prazo_conclusao: p.prazo_conclusao ? p.prazo_conclusao.split('T')[0] : null,
              tipo_prazo_id: p.tipo_prazo_id || null,
              status_id: p.status_id || null,
            })
          }
        }
      }

      // 2. Salva o controle principal em task_tarefas
      const savedControle = await controleService.saveControle(payload, usuariosLista)

      // 3. Salva as providências preservando rigorosamente a sequência (ordem) de cada uma e detecta eventos
      const providenciasParaNotificarInclusao: string[] = []
      const providenciasParaNotificarAtualizacao: string[] = []

      if (providencias.length > 0) {
        for (const p of providencias) {
          const st = statusProvLista.find((s) => s.id === p.status_id)
          const cod = st?.codigo?.toLowerCase() || ''
          const exigeData = cod === 'cancelado' || cod === 'concluido' || cod === 'suspenso'
          const dtConclusao = exigeData ? (p.data_conclusao ? p.data_conclusao.trim() : null) : null

          const isNovaProvidencia = !p.id || !p.isPersisted
          const pProvTrimmed = p.providencia.trim()
          const pPrazoClean = p.prazo_conclusao ? p.prazo_conclusao.split('T')[0] : null

          let houveMudancaReal = false
          if (!isNovaProvidencia && p.id) {
            const prev = prevProvidenciasMap.get(p.id)
            if (prev) {
              const mudouDesc = prev.providencia !== pProvTrimmed
              const mudouPrazo = prev.prazo_conclusao !== pPrazoClean
              const mudouTipo = prev.tipo_prazo_id !== p.tipo_prazo_id
              const mudouStatus = prev.status_id !== p.status_id
              houveMudancaReal = mudouDesc || mudouPrazo || mudouTipo || mudouStatus
            }
          }

          const savedProv = await controleService.saveProvidencia({
            id: p.id,
            tarefa_id: savedControle.id,
            providencia: pProvTrimmed,
            prazo_conclusao: p.prazo_conclusao,
            tipo_prazo_id: p.tipo_prazo_id,
            status_id: p.status_id,
            ordem: p.ordem ?? 0,
            data_conclusao: dtConclusao,
            email_alertas: p.email_alertas ?? false,
            email_alerta_inclusao: p.email_alerta_inclusao ?? false,
            email_alerta_atraso: p.email_alerta_atraso ?? false,
            email_alerta_atualizacao: p.email_alerta_atualizacao ?? false,
          })

          // Avaliar se deve enfileirar alerta de e-mail para esta providência salva
          if (isNovaProvidencia) {
            if (savedProv.email_alertas && savedProv.email_alerta_inclusao) {
              providenciasParaNotificarInclusao.push(savedProv.id)
            }
          } else {
            if (savedProv.email_alertas && savedProv.email_alerta_atualizacao && houveMudancaReal) {
              providenciasParaNotificarAtualizacao.push(savedProv.id)
            }
          }
        }
      }

      // 4. Recarrega controle completo com relacionamentos hidratados
      const fullyLoaded = await controleService.getControleById(savedControle.id, usuariosLista)
      onSaved(fullyLoaded || savedControle)

      // 5. Disparo de notificações por e-mail DEPOIS que controle e todas as providências foram salvos com sucesso
      let emailFalhou = false

      // 5.1. Atribuição principal
      if (tipoNotificacao) {
        try {
          const notifResult = await controleService.notifyAssignment(
            savedControle.id,
            tipoNotificacao,
          )
          if (!notifResult.success) {
            emailFalhou = true
            console.warn(
              'Aviso: notificação de atribuição por e-mail não pôde ser enviada:',
              notifResult.error || notifResult.reason,
            )
          } else if (notifResult.sent === false && notifResult.reason) {
            console.log(
              'Notificação de atribuição não enviada (motivo controlado):',
              notifResult.reason,
              notifResult.message,
            )
          }
        } catch (notifErr) {
          emailFalhou = true
          console.error('Falha segura ao disparar notificação de atribuição:', notifErr)
        }
      }

      // 5.2. Alertas de Providência — Inclusão
      for (const pId of providenciasParaNotificarInclusao) {
        try {
          const resInclusao = await controleService.notifyProvidenciaInclusao(savedControle.id, pId)
          if (!resInclusao.success) {
            emailFalhou = true
            console.warn('Aviso: notificação de inclusão de providência falhou:', resInclusao.error)
          }
        } catch (errInclusao) {
          emailFalhou = true
          console.error('Falha segura ao disparar alerta de inclusão de providência:', errInclusao)
        }
      }

      // 5.3. Alertas de Providência — Atualização
      for (const pId of providenciasParaNotificarAtualizacao) {
        try {
          const resAtualizacao = await controleService.notifyProvidenciaAtualizacao(
            savedControle.id,
            pId,
          )
          if (!resAtualizacao.success) {
            emailFalhou = true
            console.warn(
              'Aviso: notificação de atualização de providência falhou:',
              resAtualizacao.error,
            )
          }
        } catch (errAtualizacao) {
          emailFalhou = true
          console.error(
            'Falha segura ao disparar alerta de atualização de providência:',
            errAtualizacao,
          )
        }
      }

      if (emailFalhou) {
        toast({
          variant: 'destructive',
          title: controleToEdit ? 'Controle atualizado' : 'Controle criado com sucesso',
          description: 'Controle salvo, mas não foi possível enviar a notificação por e-mail.',
        })
      } else {
        toast({
          title: controleToEdit ? 'Controle atualizado' : 'Controle criado com sucesso',
          description: `Caso: ${savedControle.identificacao_caso}`,
        })
      }

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
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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

                {/* Alertas de carregamento e erro recuperável */}
                {loadingListas && (
                  <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/20 text-xs text-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                    <span>
                      Carregando listas auxiliares e validando usuários no Gestor de Acessos...
                    </span>
                  </div>
                )}

                {(validacaoUsuariosStatus === 'falhou' || erroListasAuxiliares) &&
                  !loadingListas && (
                    <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>
                          {erroUsuariosCentrais ||
                            erroListasAuxiliares ||
                            'Falha ao sincronizar listas auxiliares ou usuários.'}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={carregarListasAuxiliares}
                        disabled={loadingListas}
                        className="h-7 px-2.5 rounded-lg text-[11px] shrink-0 border-destructive/30 hover:bg-destructive/15 text-destructive"
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Tentar novamente
                      </Button>
                    </div>
                  )}

                {/* Bloco 3: Responsável e Executor (única fonte: task_usuarios com dados centrais) */}
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
                        disabled={
                          (validacaoUsuariosStatus !== 'válida' || loadingListas) &&
                          !controleToEdit?.responsavel_usuario_id
                        }
                        onValueChange={(val) => {
                          if (
                            (validacaoUsuariosStatus !== 'válida' || loadingListas) &&
                            val !== controleToEdit?.responsavel_usuario_id
                          ) {
                            toast({
                              variant: 'destructive',
                              title: 'Seleção bloqueada',
                              description:
                                validacaoUsuariosStatus === 'carregando' || loadingListas
                                  ? 'Aguarde o carregamento e validação concluir antes de fazer novas escolhas.'
                                  : 'Não é possível selecionar novos usuários durante falha das listas ou validação central.',
                            })
                            return
                          }
                          setResponsavelUsuarioId(val)
                          if (executorIsResponsavel) {
                            setExecutorUsuarioId(val)
                            if (val && executorError) setExecutorError(false)
                          }
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

                          {validacaoUsuariosStatus === 'carregando' ? (
                            <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              <span>Validando responsáveis centrais...</span>
                            </div>
                          ) : opcoesResponsaveis.length === 0 ? (
                            <div className="p-4 text-center text-xs text-muted-foreground">
                              {validacaoUsuariosStatus === 'falhou'
                                ? 'Validação central falhou. Novas escolhas suspensas.'
                                : 'Nenhum responsável disponível encontrado.'}
                            </div>
                          ) : (
                            opcoesResponsaveis.map((r) => {
                              const isInativoLocal = r.ativo === false
                              return (
                                <SelectItem key={r.id} value={r.id} className="py-2">
                                  <div className="flex flex-col gap-0.5 text-left">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-foreground text-xs">
                                        {r.nome}
                                      </span>
                                      {isInativoLocal && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                                          Inativo
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
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                        <UserCheck className="w-4 h-4 text-primary" />
                        <span>
                          Executor <span className="text-destructive">*</span>
                        </span>
                      </div>

                      {/* Opção sutil: Executor é o Responsável */}
                      <label
                        htmlFor="executor-is-responsavel-checkbox"
                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none font-normal"
                      >
                        <Checkbox
                          id="executor-is-responsavel-checkbox"
                          checked={executorIsResponsavel}
                          onCheckedChange={(checked) => {
                            const isChecked = checked === true
                            setExecutorIsResponsavel(isChecked)
                            if (isChecked) {
                              setExecutorUsuarioId(responsavelUsuarioId)
                              if (responsavelUsuarioId && executorError) {
                                setExecutorError(false)
                              }
                            }
                          }}
                          className="h-3.5 w-3.5 rounded"
                        />
                        <span>Executor é o Responsável</span>
                      </label>
                    </div>

                    <div className="relative">
                      <Select
                        value={executorUsuarioId}
                        disabled={
                          executorIsResponsavel ||
                          ((validacaoUsuariosStatus !== 'válida' || loadingListas) &&
                            !controleToEdit?.executor_usuario_id)
                        }
                        onValueChange={(val) => {
                          if (
                            (validacaoUsuariosStatus !== 'válida' || loadingListas) &&
                            val !== controleToEdit?.executor_usuario_id
                          ) {
                            toast({
                              variant: 'destructive',
                              title: 'Seleção bloqueada',
                              description:
                                validacaoUsuariosStatus === 'carregando' || loadingListas
                                  ? 'Aguarde o carregamento e validação concluir antes de fazer novas escolhas.'
                                  : 'Não é possível selecionar novos usuários durante falha das listas ou validação central.',
                            })
                            return
                          }
                          setExecutorUsuarioId(val)
                          if (executorError) setExecutorError(false)
                        }}
                      >
                        <SelectTrigger
                          disabled={
                            executorIsResponsavel ||
                            ((validacaoUsuariosStatus !== 'válida' || loadingListas) &&
                              !controleToEdit?.executor_usuario_id)
                          }
                          className={cn(
                            'h-12 rounded-xl bg-background text-sm font-medium',
                            executorIsResponsavel && 'opacity-70 cursor-not-allowed bg-muted/50',
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

                          {validacaoUsuariosStatus === 'carregando' ? (
                            <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              <span>Validando executores centrais...</span>
                            </div>
                          ) : opcoesExecutores.length === 0 ? (
                            <div className="p-4 text-center text-xs text-muted-foreground">
                              {validacaoUsuariosStatus === 'falhou'
                                ? 'Validação central falhou. Novas escolhas suspensas.'
                                : 'Nenhum executor disponível encontrado.'}
                            </div>
                          ) : (
                            opcoesExecutores.map((e) => {
                              const isInativoLocal = e.ativo === false
                              return (
                                <SelectItem key={e.id} value={e.id} className="py-2">
                                  <div className="flex flex-col gap-0.5 text-left">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-foreground text-xs">
                                        {e.nome}
                                      </span>
                                      {isInativoLocal && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                                          Inativo
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
                    {providenciasExibicao.map((item) => {
                      const numeroExibicao = item.numeroHumano
                      return (
                        <div
                          key={item.tempId}
                          className="p-4 rounded-xl border border-border bg-card shadow-xs space-y-3 relative group"
                        >
                          {/* Topo do card da providência */}
                          <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                            <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-bold">
                                {numeroExibicao}
                              </span>
                              <span>
                                Providência #{numeroExibicao}
                                {!item.isPersisted && (
                                  <span className="text-primary/80 font-normal ml-1">(nova)</span>
                                )}
                              </span>
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
                                ref={(el) => {
                                  if (el && focusNewProvId === item.tempId) {
                                    setTimeout(() => {
                                      el.focus()
                                    }, 10)
                                    setFocusNewProvId(null)
                                  }
                                }}
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
                                  onValueChange={(val) => {
                                    handleUpdateProvidencia(item.tempId, 'status_id', val)
                                    const st = statusProvLista.find((s) => s.id === val)
                                    const cod = st?.codigo?.toLowerCase() || ''
                                    if (
                                      cod === 'cancelado' ||
                                      cod === 'concluido' ||
                                      cod === 'suspenso'
                                    ) {
                                      if (!item.data_conclusao) {
                                        handleUpdateProvidencia(
                                          item.tempId,
                                          'data_conclusao',
                                          getTodayLocalDate(),
                                        )
                                      }
                                    } else {
                                      handleUpdateProvidencia(item.tempId, 'data_conclusao', null)
                                    }
                                  }}
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

                              {/* Campo 5: Data de Conclusão (exibida quando o status for cancelado, concluido ou suspenso) */}
                              {(() => {
                                const st = statusProvLista.find((s) => s.id === item.status_id)
                                const cod = st?.codigo?.toLowerCase() || ''
                                const exigeData =
                                  cod === 'cancelado' || cod === 'concluido' || cod === 'suspenso'
                                if (!exigeData) return null

                                return (
                                  <div className="space-y-1 animate-fade-in sm:col-span-3">
                                    <Label className="text-xs font-semibold flex items-center gap-1 text-primary">
                                      <CalendarIcon className="w-3.5 h-3.5" />
                                      <span>Data de Conclusão</span>
                                      <span className="text-destructive">*</span>
                                    </Label>
                                    <Input
                                      type="date"
                                      value={item.data_conclusao || ''}
                                      onChange={(e) =>
                                        handleUpdateProvidencia(
                                          item.tempId,
                                          'data_conclusao',
                                          e.target.value,
                                        )
                                      }
                                      className="h-9 rounded-xl bg-background text-xs font-medium border-primary/40 focus-visible:ring-primary sm:max-w-xs"
                                    />
                                  </div>
                                )
                              })()}
                            </div>

                            {/* Seção de Preferências de Alerta por E-mail (sutil e compacta) */}
                            <div className="pt-2 border-t border-border/40">
                              <div className="rounded-lg bg-muted/20 border border-border/50 p-2.5 space-y-2">
                                {/* Checkbox Principal: Receber alertas + Controles discretos Marcar todos / Desmarcar todos */}
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id={`email-alertas-${item.tempId}`}
                                      checked={Boolean(item.email_alertas)}
                                      onCheckedChange={(checked) => {
                                        const isTurningOn = checked === true
                                        if (isTurningOn) {
                                          handleBatchUpdateProvidencia(item.tempId, {
                                            email_alertas: true,
                                            email_alerta_inclusao: true,
                                            email_alerta_atraso: true,
                                            email_alerta_atualizacao: true,
                                          })
                                        } else {
                                          handleUpdateProvidencia(
                                            item.tempId,
                                            'email_alertas',
                                            false,
                                          )
                                        }
                                      }}
                                    />
                                    <Label
                                      htmlFor={`email-alertas-${item.tempId}`}
                                      className="text-xs font-semibold text-foreground cursor-pointer flex items-center gap-1.5 select-none"
                                    >
                                      <Bell className="w-3.5 h-3.5 text-primary" />
                                      <span>Receber alertas</span>
                                    </Label>
                                  </div>

                                  <div className="flex items-center gap-2 text-xs">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleBatchUpdateProvidencia(item.tempId, {
                                          email_alerta_inclusao: true,
                                          email_alerta_atraso: true,
                                          email_alerta_atualizacao: true,
                                        })
                                      }
                                      className="text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer select-none underline-offset-2 hover:underline"
                                    >
                                      Marcar todos
                                    </button>
                                    <span className="text-muted-foreground/40 text-[10px]">•</span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleBatchUpdateProvidencia(item.tempId, {
                                          email_alerta_inclusao: false,
                                          email_alerta_atraso: false,
                                          email_alerta_atualizacao: false,
                                        })
                                      }
                                      className="text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer select-none underline-offset-2 hover:underline"
                                    >
                                      Desmarcar todos
                                    </button>
                                  </div>
                                </div>

                                {/* Subtipos de alerta: Inclusão, Atraso, Atualização */}
                                <div
                                  className={cn(
                                    'pl-6 flex flex-wrap items-center gap-x-5 gap-y-1.5 transition-opacity duration-150',
                                    !item.email_alertas && 'opacity-40 pointer-events-none',
                                  )}
                                >
                                  {/* Subtipo 1: Inclusão / início */}
                                  <div className="flex items-center gap-1.5">
                                    <Checkbox
                                      id={`alerta-inclusao-${item.tempId}`}
                                      disabled={!item.email_alertas}
                                      checked={Boolean(item.email_alerta_inclusao)}
                                      onCheckedChange={(checked) =>
                                        handleUpdateProvidencia(
                                          item.tempId,
                                          'email_alerta_inclusao',
                                          checked === true,
                                        )
                                      }
                                      className="h-3.5 w-3.5 rounded"
                                    />
                                    <Label
                                      htmlFor={`alerta-inclusao-${item.tempId}`}
                                      className={cn(
                                        'text-[11px] text-muted-foreground select-none',
                                        item.email_alertas
                                          ? 'cursor-pointer hover:text-foreground'
                                          : 'cursor-not-allowed',
                                      )}
                                    >
                                      Inclusão / início
                                    </Label>
                                  </div>

                                  {/* Subtipo 2: Providência atrasada */}
                                  <div className="flex items-center gap-1.5">
                                    <Checkbox
                                      id={`alerta-atraso-${item.tempId}`}
                                      disabled={!item.email_alertas}
                                      checked={Boolean(item.email_alerta_atraso)}
                                      onCheckedChange={(checked) =>
                                        handleUpdateProvidencia(
                                          item.tempId,
                                          'email_alerta_atraso',
                                          checked === true,
                                        )
                                      }
                                      className="h-3.5 w-3.5 rounded"
                                    />
                                    <Label
                                      htmlFor={`alerta-atraso-${item.tempId}`}
                                      className={cn(
                                        'text-[11px] text-muted-foreground select-none',
                                        item.email_alertas
                                          ? 'cursor-pointer hover:text-foreground'
                                          : 'cursor-not-allowed',
                                      )}
                                    >
                                      Providência atrasada
                                    </Label>
                                  </div>

                                  {/* Subtipo 3: Atualização da providência */}
                                  <div className="flex items-center gap-1.5">
                                    <Checkbox
                                      id={`alerta-atualizacao-${item.tempId}`}
                                      disabled={!item.email_alertas}
                                      checked={Boolean(item.email_alerta_atualizacao)}
                                      onCheckedChange={(checked) =>
                                        handleUpdateProvidencia(
                                          item.tempId,
                                          'email_alerta_atualizacao',
                                          checked === true,
                                        )
                                      }
                                      className="h-3.5 w-3.5 rounded"
                                    />
                                    <Label
                                      htmlFor={`alerta-atualizacao-${item.tempId}`}
                                      className={cn(
                                        'text-[11px] text-muted-foreground select-none',
                                        item.email_alertas
                                          ? 'cursor-pointer hover:text-foreground'
                                          : 'cursor-not-allowed',
                                      )}
                                    >
                                      Atualização da providência
                                    </Label>
                                  </div>
                                </div>
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
                disabled={
                  saving ||
                  loadingListas ||
                  (!controleToEdit && validacaoUsuariosStatus !== 'válida')
                }
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
