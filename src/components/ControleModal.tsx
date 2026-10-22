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
import { formatDateBR, formatDateTimeBR } from '@/lib/formatters'
import { supabase } from '@/lib/supabase/client'
import { controleService } from '@/services/controleService'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/use-auth'
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
  // Contador de geração para verificação assíncrona de escopo de acesso ao caso (race condition / fail-closed)
  const accessRequestIdRef = useRef<number>(0)
  const [verificandoAcesso, setVerificandoAcesso] = useState(false)
  // Autorização explícita estrita vinculada ao contexto exato (casoId, coreUserId, corePerfil)
  const [authorizedContext, setAuthorizedContext] = useState<string | null>(null)

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

  // Estados para o fluxo de Solicitação de Adiamento
  const [confirmarAdiamentoDialogOpen, setConfirmarAdiamentoDialogOpen] = useState(false)
  const [modalAdiamentoOpen, setModalAdiamentoOpen] = useState(false)
  const [providenciaParaAdiamento, setProvidenciaParaAdiamento] = useState<{
    providenciaItem: DraftProvidenciaItem
    prazoPretendido: string
  } | null>(null)
  const [administradoresElegiveis, setAdministradoresElegiveis] = useState<
    Array<{ id: string; nome: string; email: string }>
  >([])
  const [loadingAdminsElegiveis, setLoadingAdminsElegiveis] = useState(false)
  const [adminSelecionadoId, setAdminSelecionadoId] = useState('')
  const [motivoAdiamento, setMotivoAdiamento] = useState('')
  const [chaveIdempotenciaAdiamento, setChaveIdempotenciaAdiamento] = useState<string>('')
  const [resultadoIncertoAdiamento, setResultadoIncertoAdiamento] = useState(false)
  const [enviandoSolicitacaoAdiamento, setEnviandoSolicitacaoAdiamento] = useState(false)
  const [erroAdiamento, setErroAdiamento] = useState<string | null>(null)

  // Rastreamento do pedido atual e dos valores enviados na última tentativa
  const [pedidoIdentificadorAtivo, setPedidoIdentificadorAtivo] = useState<string | null>(null)
  const [ultimoAdminTentado, setUltimoAdminTentado] = useState<string | null>(null)
  const [ultimoMotivoTentado, setUltimoMotivoTentado] = useState<string | null>(null)

  // Gerador utilitário para chave de idempotência na própria tela: sempre UUID v4 válido
  const gerarChaveIdempotencia = useCallback((): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      bytes[6] = (bytes[6] & 0x0f) | 0x40 // versão 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante RFC 4122
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }, [])

  // Carrega administradores elegíveis para o modal de solicitação
  // Requisito 5: mantém o administrador selecionado se continuar elegível.
  // Caso contrário, seleciona o primeiro da lista, ou nenhum se vazia.
  const carregarAdministradoresAdiamento = useCallback(async () => {
    setLoadingAdminsElegiveis(true)
    try {
      const res = await controleService.listarAdministradoresAdiamento()
      if (res.success && res.administradores) {
        const admins = res.administradores
        setAdministradoresElegiveis(admins)
        setAdminSelecionadoId((prevId) => {
          if (prevId && admins.some((a) => a.id === prevId)) {
            return prevId
          }
          return admins.length > 0 ? admins[0].id : ''
        })
      } else {
        setAdministradoresElegiveis([])
        setAdminSelecionadoId('')
        setErroAdiamento(res.error || 'Não foi possível carregar os administradores elegíveis.')
      }
    } catch (err: any) {
      console.error('Erro ao listar administradores para adiamento:', err)
      setAdministradoresElegiveis([])
      setAdminSelecionadoId('')
      setErroAdiamento(err?.message || 'Falha ao carregar administradores elegíveis.')
    } finally {
      setLoadingAdminsElegiveis(false)
    }
  }, [])

  // Ações do diálogo Sim/Não de Confirmação de Adiamento
  const handleEscolhaNaoAdiamento = useCallback(() => {
    // "Não": retorna ao formulário preservando TODO o preenchimento, sem gravar nada.
    setConfirmarAdiamentoDialogOpen(false)
  }, [])

  const handleEscolhaSimAdiamento = useCallback(() => {
    // "Sim": abre a janela de solicitação, sem gravar o caso ou a providência.
    setConfirmarAdiamentoDialogOpen(false)

    // Requisito 3: Identifica o pedido por caso + providência + data pretendida
    const casoId = controleToEdit?.id || 'sem-caso'
    const provId =
      providenciaParaAdiamento?.providenciaItem.id ||
      providenciaParaAdiamento?.providenciaItem.tempId ||
      providenciaParaAdiamento?.providenciaItem.providencia ||
      'sem-prov'
    const prazo = providenciaParaAdiamento?.prazoPretendido || 'sem-prazo'
    const novoIdentificador = `${casoId}::${provId}::${prazo}`

    const isMesmoPedido = pedidoIdentificadorAtivo === novoIdentificador

    if (isMesmoPedido) {
      // Ao clicar em "Sim" de novo para o MESMO pedido, NÃO apague o motivo,
      // o administrador escolhido, a chave de idempotência nem a marcação de "envio incerto".
      // Se o pedido estava incerto, mostre de novo o alerta "Envio Incerto (SMTP)" e mantenha o bloqueio.
      if (resultadoIncertoAdiamento) {
        setErroAdiamento((prev) => prev || 'Envio incerto (SMTP). Reenvio automático bloqueado.')
      }
    } else {
      // Para um pedido DIFERENTE, comece do zero: motivo vazio, nova chave e sem bloqueio.
      setPedidoIdentificadorAtivo(novoIdentificador)
      setMotivoAdiamento('')
      setErroAdiamento(null)
      setResultadoIncertoAdiamento(false)
      setChaveIdempotenciaAdiamento(gerarChaveIdempotencia())
      setUltimoAdminTentado(null)
      setUltimoMotivoTentado(null)
    }

    setModalAdiamentoOpen(true)
    carregarAdministradoresAdiamento()
  }, [
    controleToEdit,
    providenciaParaAdiamento,
    pedidoIdentificadorAtivo,
    resultadoIncertoAdiamento,
    gerarChaveIdempotencia,
    carregarAdministradoresAdiamento,
  ])

  // Envio da solicitação de adiamento
  const handleEnviarSolicitacaoAdiamento = useCallback(async () => {
    // Requisito 6: ignore novo clique se já estiver em andamento (duplo clique) ou bloqueado
    if (enviandoSolicitacaoAdiamento) {
      return
    }

    if (resultadoIncertoAdiamento) {
      toast({
        variant: 'destructive',
        title: 'Reenvio bloqueado',
        description:
          'O resultado anterior do envio foi incerto (SMTP). O reenvio automático está bloqueado para evitar duplicidade. Aguarde a confirmação do administrador.',
      })
      return
    }

    if (!controleToEdit?.id) {
      toast({
        variant: 'destructive',
        title: 'Caso não salvo',
        description: 'É necessário que o caso esteja salvo para solicitar adiamento.',
      })
      return
    }

    if (!adminSelecionadoId) {
      setErroAdiamento('Selecione um administrador para enviar a solicitação.')
      return
    }

    const motivoTrimmed = motivoAdiamento.trim()
    if (!motivoTrimmed) {
      setErroAdiamento('O motivo da solicitação é obrigatório.')
      return
    }

    if (motivoTrimmed.length > 200) {
      setErroAdiamento('O motivo deve conter no máximo 200 caracteres.')
      return
    }

    // Requisito 4: Chave de idempotência
    // - Retentativas do mesmo pedido com o mesmo administrador e o mesmo motivo usam a MESMA chave.
    // - Se o usuário mudar o administrador ou o motivo depois de uma tentativa que NÃO foi incerta, gere NOVA chave.
    let chaveAtual = chaveIdempotenciaAdiamento
    const houveTentativaAnterior = ultimoAdminTentado !== null || ultimoMotivoTentado !== null
    const dadosMudaram =
      houveTentativaAnterior &&
      (ultimoAdminTentado !== adminSelecionadoId || ultimoMotivoTentado !== motivoTrimmed)

    if (!chaveAtual || dadosMudaram) {
      chaveAtual = gerarChaveIdempotencia()
      setChaveIdempotenciaAdiamento(chaveAtual)
    }

    // Atualiza rastreamento dos últimos dados tentados
    setUltimoAdminTentado(adminSelecionadoId)
    setUltimoMotivoTentado(motivoTrimmed)

    setEnviandoSolicitacaoAdiamento(true)
    setErroAdiamento(null)

    try {
      const res = await controleService.solicitarAdiamento({
        tarefaId: controleToEdit.id,
        administradorCoreUsuarioId: adminSelecionadoId,
        motivo: motivoTrimmed,
        prazoSolicitado: providenciaParaAdiamento?.prazoPretendido || '',
        providenciaTexto: providenciaParaAdiamento?.providenciaItem.providencia || undefined,
        chaveIdempotencia: chaveAtual,
      })

      if (res.chave_idempotencia) {
        setChaveIdempotenciaAdiamento(res.chave_idempotencia)
      }

      // Requisito 1: Anúncio de envio:
      // SÓ mostre a mensagem "Solicitação de adiamento enviada" (toast/feedback) e feche a janela
      // quando o retorno tiver success === true E email_status === 'enviado' E notificacao_aceita_smtp === true.
      // Em qualquer outro retorno, a janela continua aberta com a mensagem de erro, e NADA é anunciado como enviado.
      if (
        res.success === true &&
        res.email_status === 'enviado' &&
        res.notificacao_aceita_smtp === true
      ) {
        toast({
          title: 'Solicitação de adiamento enviada',
          description:
            res.message ||
            'Sua solicitação de adiamento foi registrada e encaminhada ao administrador.',
        })
        // Limpa a chave, o motivo e a identificação do pedido após envio confirmado (sucesso real)
        setChaveIdempotenciaAdiamento('')
        setMotivoAdiamento('')
        setPedidoIdentificadorAtivo(null)
        setUltimoAdminTentado(null)
        setUltimoMotivoTentado(null)
        setResultadoIncertoAdiamento(false)
        setErroAdiamento(null)

        // Fecha a janela de solicitação preservando o rascunho do formulário principal
        setModalAdiamentoOpen(false)
        return
      }

      // Requisito 2: Mensagens por situação (a janela continua aberta em todas, sem anúncio de envio):
      if (res.email_status === 'incerto') {
        // incerto: marque o pedido como "envio incerto", mostre o alerta "Envio Incerto (SMTP)"
        // e BLOQUEIE o botão Enviar e os campos de administrador e motivo.
        setResultadoIncertoAdiamento(true)
        const msgIncerto =
          res.error ||
          res.message ||
          'Solicitação registrada, mas o status de envio do e-mail é incerto. Reenvio automático bloqueado para evitar duplicação.'
        setErroAdiamento(msgIncerto)
        return
      }

      if (res.email_status === 'enviando') {
        // enviando: mostrar a mensagem "O envio desta solicitação já está em processamento. Aguarde alguns instantes antes de tentar novamente."
        setErroAdiamento(
          'O envio desta solicitação já está em processamento. Aguarde alguns instantes antes de tentar novamente.',
        )
        return
      }

      if (res.email_status === 'falhou' && res.solicitacao_registrada) {
        // falhou com a solicitação registrada: mostrar a mensagem do servidor,
        // seguida de "A solicitação foi registrada, mas o administrador não foi notificado. Você pode tentar novamente."
        const msgServidor = res.error || res.message || 'Falha ao notificar o administrador.'
        setErroAdiamento(
          `${msgServidor} A solicitação foi registrada, mas o administrador não foi notificado. Você pode tentar novamente.`,
        )
        return
      }

      if (res.email_status === 'cancelado') {
        // cancelado: mostrar a mensagem do servidor.
        const msgCancelado =
          res.error || res.message || 'A solicitação de adiamento foi cancelada pelo servidor.'
        setErroAdiamento(msgCancelado)
        return
      }

      // Outros casos de falha (inclusive success: true sem notificacao_aceita_smtp: true)
      const errorMsg =
        res.error ||
        res.message ||
        'Não foi possível confirmar o envio da notificação ao administrador.'
      setErroAdiamento(errorMsg)
    } catch (err: any) {
      console.error('Erro ao enviar solicitação de adiamento:', err)
      const exMsg = err?.message || 'Falha inesperada ao enviar solicitação de adiamento.'
      setErroAdiamento(exMsg)
    } finally {
      setEnviandoSolicitacaoAdiamento(false)
    }
  }, [
    enviandoSolicitacaoAdiamento,
    resultadoIncertoAdiamento,
    controleToEdit,
    adminSelecionadoId,
    motivoAdiamento,
    chaveIdempotenciaAdiamento,
    ultimoAdminTentado,
    ultimoMotivoTentado,
    gerarChaveIdempotencia,
    providenciaParaAdiamento,
    toast,
  ])

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

    // Aproveitamento imediato da prop usuariosAtivos ao carregar (se houver)
    if (usuariosProp && usuariosProp.length > 0) {
      let listaInicial = [...usuariosProp]
      const respCoreInit =
        controleToEdit?.responsavel_core_usuario_id || controleToEdit?.responsavel_usuario_id
      const execCoreInit =
        controleToEdit?.executor_core_usuario_id || controleToEdit?.executor_usuario_id

      if (
        respCoreInit &&
        !listaInicial.some((u) => u.id === respCoreInit || u.core_usuario_id === respCoreInit)
      ) {
        listaInicial.push({
          id: respCoreInit,
          nome: controleToEdit?.responsavel_usuario?.nome || 'Usuário do caso',
          email: controleToEdit?.responsavel_usuario?.email || '',
          ativo: true,
          core_usuario_id: respCoreInit,
        })
      }
      if (
        execCoreInit &&
        !listaInicial.some((u) => u.id === execCoreInit || u.core_usuario_id === execCoreInit)
      ) {
        listaInicial.push({
          id: execCoreInit,
          nome: controleToEdit?.executor_usuario?.nome || 'Usuário do caso',
          email: controleToEdit?.executor_usuario?.email || '',
          ativo: true,
          core_usuario_id: execCoreInit,
        })
      }
      setUsuariosLista(listaInicial)
    }

    try {
      let fetchUsersError: Error | null = null
      let fetchAuxError: Error | null = null
      let usersValidados: TaskUsuarioAtivoRecord[] = []
      let nomes: TaskNomeControleRecord[] = []
      let stProv: TaskStatusProvidenciaRecord[] = []

      // PARTE B: Buscar ao mesmo tempo, num único Promise.all:
      // getNomesControle, getStatusProvidencia (ou lista recebida por prop) e getUsuariosAtivos
      const [nomesRes, stProvRes, usersRes] = await Promise.all([
        controleService.getNomesControle({ incluirInativos: true }).catch((err: any) => {
          console.error('Falha ao carregar nomes de controle no ControleModal:', err)
          fetchAuxError = err
          return [] as TaskNomeControleRecord[]
        }),
        (statusProvidenciaList.length > 0
          ? Promise.resolve(statusProvidenciaList)
          : controleService.getStatusProvidencia()
        ).catch((err: any) => {
          console.error('Falha ao carregar status de providência no ControleModal:', err)
          if (!fetchAuxError) fetchAuxError = err
          return [] as TaskStatusProvidenciaRecord[]
        }),
        controleService.getUsuariosAtivos().catch((err: any) => {
          console.error('Falha ao carregar usuários elegíveis com dados centrais:', err)
          fetchUsersError = err
          return [] as TaskUsuarioAtivoRecord[]
        }),
      ])

      nomes = nomesRes
      stProv = stProvRes
      usersValidados = usersRes

      // Ignora respostas obsoletas de carregamentos simultâneos anteriores
      if (requestId !== activeRequestIdRef.current) {
        return
      }

      if (fetchAuxError) {
        const msgAux =
          (fetchAuxError as any)?.message ||
          'Falha técnica ao carregar listas auxiliares do controle.'
        setErroListasAuxiliares(msgAux)
        toastRef.current({
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
        toastRef.current({
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
      // PARTE A (item 5): Quando a busca terminar, troca pela lista atualizada do banco
      if (!fetchUsersError && usersValidados.length > 0) {
        setUsuariosLista(listaCombinada)
      } else if (listaCombinada.length > 0) {
        setUsuariosLista(listaCombinada)
      }
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
  }, [statusProvidenciaList, controleToEdit, usuariosProp])

  const { corePerfil, coreUserId } = useAuth()
  const isAdmin = corePerfil === 'ADMINISTRADOR'

  // Limpa estados do formulário
  const resetFormState = useCallback(() => {
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
    setNomeControleError(false)
    setIdentificacaoError(false)
    setStatusError(false)
    setResponsavelError(false)
    setExecutorError(false)
    setBuscaNomeSelect('')
    setBuscaRespSelect('')
    setBuscaExecSelect('')
  }, [statusPadraoId])

  // Guardar funções em useRef para evitar que funções recriadas reiniciem o formulário ao abrir
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  const carregarListasAuxiliaresRef = useRef(carregarListasAuxiliares)
  carregarListasAuxiliaresRef.current = carregarListasAuxiliares

  const resetFormStateRef = useRef(resetFormState)
  resetFormStateRef.current = resetFormState

  const toastRef = useRef(toast)
  toastRef.current = toast

  const statusPadraoIdRef = useRef(statusPadraoId)
  statusPadraoIdRef.current = statusPadraoId

  const tipoPrazoPadraoIdRef = useRef(tipoPrazoPadraoId)
  tipoPrazoPadraoIdRef.current = tipoPrazoPadraoId

  const statusProvPadraoIdRef = useRef(statusProvPadraoId)
  statusProvPadraoIdRef.current = statusProvPadraoId

  // Popula o formulário ao abrir
  useEffect(() => {
    const generation = ++accessRequestIdRef.current

    // Ao fechar, abrir ou trocar de caso/identidade: invalida qualquer autorização anterior
    setAuthorizedContext(null)

    if (!open) {
      setVerificandoAcesso(false)
      return () => {
        accessRequestIdRef.current++
      }
    }

    // Caso NÃO haja controleToEdit (criação de novo caso): fluxo imediato sem bloqueio
    if (!controleToEdit) {
      setVerificandoAcesso(false)
      carregarListasAuxiliaresRef.current()
      setActiveTab(initialTab || 'dados')
      resetFormStateRef.current()
      return () => {
        accessRequestIdRef.current++
      }
    }

    // Fail-closed para caso existente:
    // Limpa dados imediatamente enquanto a verificação assíncrona estiver pendente
    setVerificandoAcesso(true)
    resetFormStateRef.current()

    const currentContextKey = `${controleToEdit.id || 'sem-id'}::${coreUserId || 'sem-user'}::${corePerfil || 'sem-perfil'}`

    const verificarAcessoAsync = async () => {
      try {
        const permitido = await controleService.checkControleAccessScope(
          controleToEdit,
          corePerfil,
          coreUserId,
        )

        // Race condition: só aplica o resultado se a geração ainda for a atual
        if (generation !== accessRequestIdRef.current) {
          return
        }

        if (!permitido) {
          setAuthorizedContext(null)
          setVerificandoAcesso(false)
          toastRef.current({
            variant: 'destructive',
            title: 'Acesso negado',
            description: 'Você não possui permissão para visualizar ou editar este caso.',
          })
          onOpenChangeRef.current(false)
          return
        }

        // Acesso explicitamente autorizado e geração válida: registrar autorização explícita e popular dados
        setAuthorizedContext(currentContextKey)
        setVerificandoAcesso(false)
        carregarListasAuxiliaresRef.current()
        setActiveTab(initialTab || 'dados')
        setNomeControleError(false)
        setIdentificacaoError(false)
        setStatusError(false)
        setResponsavelError(false)
        setExecutorError(false)
        setBuscaNomeSelect('')
        setBuscaRespSelect('')
        setBuscaExecSelect('')

        setNomeControleId(controleToEdit.nome_controle_id || '')
        setIdentificacaoCaso(controleToEdit.identificacao_caso || '')
        setStatusId(controleToEdit.status_id || statusPadraoIdRef.current)
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
            tipo_prazo_id: p.tipo_prazo_id || tipoPrazoPadraoIdRef.current,
            status_id: p.status_id || statusProvPadraoIdRef.current,
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
            tipo_prazo_id: tipoPrazoPadraoIdRef.current,
            status_id: statusProvPadraoIdRef.current,
            ordem: maiorOrdem + 1,
            data_conclusao: null,
            email_alertas: true,
            email_alerta_inclusao: true,
            email_alerta_atraso: true,
            email_alerta_atualizacao: true,
            isPersisted: false,
          })
          setFocusNewProvId(autoTempId)
        }

        setProvidencias(draftList)
      } catch (err) {
        if (generation !== accessRequestIdRef.current) {
          return
        }
        setAuthorizedContext(null)
        setVerificandoAcesso(false)
        toastRef.current({
          variant: 'destructive',
          title: 'Acesso negado',
          description: 'Você não possui permissão para visualizar ou editar este caso.',
        })
        onOpenChangeRef.current(false)
      }
    }

    verificarAcessoAsync()

    return () => {
      // Invalida requisições pendentes no cleanup do efeito
      accessRequestIdRef.current++
    }
  }, [open, controleToEdit?.id, coreUserId, corePerfil, initialTab, autoAddNewProvidencia])

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
  // Se houver lista de usuários (previamente carregada ou validada), exibe os candidatos e permite seleção imediata.
  // Caso a validação central tenha explicitamente falhado, novas escolhas ficam suspensas.
  const opcoesResponsaveis = useMemo(() => {
    const editRespId =
      controleToEdit?.responsavel_core_usuario_id || controleToEdit?.responsavel_usuario_id
    let list = usuariosLista.filter((u) => {
      // Sempre permitir o usuário histórico que já está gravado no caso (para preservá-lo na visualização)
      if (editRespId && (u.id === editRespId || u.core_usuario_id === editRespId)) return true
      // Se a validação central falhou explicitamente, suspende candidatos novos
      if (validacaoUsuariosStatus === 'falhou') return false
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
  // Se houver lista de usuários (previamente carregada ou validada), exibe os candidatos e permite seleção imediata.
  // Caso a validação central tenha explicitamente falhado, novas escolhas ficam suspensas.
  const opcoesExecutores = useMemo(() => {
    const editExecId =
      controleToEdit?.executor_core_usuario_id || controleToEdit?.executor_usuario_id
    let list = usuariosLista.filter((u) => {
      // Sempre permitir o usuário histórico que já está gravado no caso (para preservá-lo na visualização)
      if (editExecId && (u.id === editExecId || u.core_usuario_id === editExecId)) return true
      // Se a validação central falhou explicitamente, suspende candidatos novos
      if (validacaoUsuariosStatus === 'falhou') return false
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
      email_alertas: true,
      email_alerta_inclusao: true,
      email_alerta_atraso: true,
      email_alerta_atualizacao: true,
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

  // Determina se o caso tem autorização explícita válida no contexto atual
  // Para novos casos (sem controleToEdit): permitido direto (isNovoCaso = true)
  // Para casos existentes: DEVE coincidir exatamente com a autorização emitida pelo checkControleAccessScope
  const isNovoCaso = !controleToEdit
  const expectedContextKey = controleToEdit
    ? `${controleToEdit.id || 'sem-id'}::${coreUserId || 'sem-user'}::${corePerfil || 'sem-perfil'}`
    : null
  const isAcessoAutorizado =
    isNovoCaso || (authorizedContext !== null && authorizedContext === expectedContextKey)

  // Submit principal do controle (impede duplo envio com flag saving)
  const handleSubmitControle = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (saving) return

    // Proteção fail-closed no início de handleSubmitControle:
    // Sem autorização explícita válida para o caso atual, o salvamento não deve prosseguir
    if (!isAcessoAutorizado) {
      toast({
        variant: 'destructive',
        title: 'Acesso negado',
        description: 'Você não possui autorização válida para salvar alterações neste caso.',
      })
      return
    }

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

    // Resolve se estamos em modo de edição
    const isEditMode = Boolean(controleToEdit?.id)

    // Regra de Validação de Prazos de Providências vs Conclusão do Caso:
    // "Ao tentar salvar uma providência com prazo superior à conclusão do caso, interrompa o salvamento e mostre:
    // 'A data da providência não pode ser maior que a data de conclusão do caso. Deseja solicitar adiamento para um administrador?'"
    // - Igualdade é permitida (prazo_prov <= prazo_caso).
    // - Conclusão do caso vazia mantém o comportamento atual (não bloqueia).
    // - Não bloqueie histórico inconsistente quando seus prazos não forem alterados.
    // - Em caso ainda não salvo (novo caso / !controleToEdit?.id), solicite ajuste das datas sem criar registro parcial.
    const effectiveCaseDeadline = (
      (!isAdmin && isEditMode && controleToEdit
        ? controleToEdit.prazo_conclusao
          ? controleToEdit.prazo_conclusao.split('T')[0]
          : ''
        : prazoConclusao
          ? prazoConclusao.split('T')[0]
          : '') || ''
    ).trim()

    if (effectiveCaseDeadline) {
      // Localiza a primeira providência que ultrapasse a conclusão do caso e que não seja histórico inalterado
      const provComPrazoMaior = providencias.find((p) => {
        const prazoProv = (p.prazo_conclusao ? p.prazo_conclusao.split('T')[0] : '').trim()
        if (!prazoProv) return false
        if (prazoProv <= effectiveCaseDeadline) return false

        // Se a providência for persistida no caso existente e tanto o prazo da providência
        // quanto o prazo de conclusão do caso permanecerem inalterados, não bloquear
        if (p.isPersisted && p.id && controleToEdit?.providencias) {
          const original = controleToEdit.providencias.find((op) => op.id === p.id)
          const originalPrazo = (
            original?.prazo_conclusao ? original.prazo_conclusao.split('T')[0] : ''
          ).trim()
          const originalCasoPrazo = (
            controleToEdit.prazo_conclusao ? controleToEdit.prazo_conclusao.split('T')[0] : ''
          ).trim()

          if (
            originalPrazo &&
            originalPrazo === prazoProv &&
            originalCasoPrazo &&
            originalCasoPrazo === effectiveCaseDeadline
          ) {
            // Histórico inconsistente inalterado: permitido
            return false
          }
        }

        return true
      })

      if (provComPrazoMaior) {
        const prazoExcedente = (
          provComPrazoMaior.prazo_conclusao ? provComPrazoMaior.prazo_conclusao.split('T')[0] : ''
        ).trim()

        if (!isEditMode || !controleToEdit?.id) {
          // Caso ainda não salvo: solicitar ajuste das datas sem criar registro parcial
          setActiveTab('providencias')
          toast({
            variant: 'destructive',
            title: 'Prazo da providência superior ao caso',
            description:
              'A data da providência não pode ser maior que a data de conclusão do caso. Ajuste as datas para salvar o novo caso.',
          })
          return
        }

        // Caso salvo existente: interrompe e abre diálogo de confirmação
        setProvidenciaParaAdiamento({
          providenciaItem: provComPrazoMaior,
          prazoPretendido: prazoExcedente,
        })
        setConfirmarAdiamentoDialogOpen(true)
        return
      }
    }

    // Resolve os vínculos centrais a partir da lista validada ou preservada:
    const prevRespCore =
      controleToEdit?.responsavel_core_usuario_id || controleToEdit?.responsavel_usuario_id
    const prevExecCore =
      controleToEdit?.executor_core_usuario_id || controleToEdit?.executor_usuario_id

    const respNaoMudou = isEditMode && responsavelUsuarioId === prevRespCore
    const execNaoMudou = isEditMode && executorUsuarioId === prevExecCore

    const selectedResp = usuariosLista.find(
      (u) =>
        (u.core_usuario_id && u.core_usuario_id === responsavelUsuarioId) ||
        u.id === responsavelUsuarioId,
    )
    const selectedExec = usuariosLista.find(
      (u) =>
        (u.core_usuario_id && u.core_usuario_id === executorUsuarioId) ||
        u.id === executorUsuarioId,
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
      respNaoMudou &&
      controleToEdit?.responsavel_usuario_id &&
      controleToEdit.responsavel_usuario_id !== respCoreId
        ? controleToEdit.responsavel_usuario_id
        : undefined

    const opExecPreservado =
      execNaoMudou &&
      controleToEdit?.executor_usuario_id &&
      controleToEdit.executor_usuario_id !== execCoreId
        ? controleToEdit.executor_usuario_id
        : undefined

    // Preparação de providências com sanitização de campos para envio na transação única
    const provsToSave: any[] = []
    const prevProvidenciasMap = new Map<
      string,
      {
        providencia: string
        prazo_conclusao: string | null
        tipo_prazo_id: string | null
        status_id: string | null
        ordem: number
        data_conclusao: string | null
        email_alertas: boolean
        email_alerta_inclusao: boolean
        email_alerta_atraso: boolean
        email_alerta_atualizacao: boolean
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
            ordem: p.ordem ?? 0,
            data_conclusao: p.data_conclusao ? p.data_conclusao.split('T')[0] : null,
            email_alertas: p.email_alertas ?? false,
            email_alerta_inclusao: p.email_alerta_inclusao ?? false,
            email_alerta_atraso: p.email_alerta_atraso ?? false,
            email_alerta_atualizacao: p.email_alerta_atualizacao ?? false,
          })
        }
      }
    }

    for (const p of providencias) {
      const st = statusProvLista.find((s) => s.id === p.status_id)
      const cod = st?.codigo?.toLowerCase() || ''
      const exigeData = cod === 'cancelado' || cod === 'concluido' || cod === 'suspenso'
      let dtConclusao = exigeData ? (p.data_conclusao ? p.data_conclusao.trim() : null) : null

      // Garantia de integridade no fluxo de salvamento:
      // Se não for Administrador, não aceita alteração manual de data_conclusao.
      // Preserva o valor já existente no banco de dados para a providência correspondente.
      // Passo 3: se o perfil não for Administrador:
      // em edição preserve o valor de data_conclusao já existente no registro (descarte o valor do formulário)
      // e em criação envie null/vazio. Não mexa na lógica automática que define a data no encerramento do caso.
      if (!isAdmin) {
        if (p.id) {
          const prevItem = prevProvidenciasMap.get(p.id)
          dtConclusao = prevItem ? prevItem.data_conclusao : null
        } else {
          dtConclusao = null
        }
      }

      const isNovaProvidencia = !p.id || !p.isPersisted
      const pProvTrimmed = p.providencia.trim()
      const effectiveTempId = p.tempId || `temp_${Math.random().toString(36).substring(2, 9)}`

      provsToSave.push({
        id: p.id || undefined,
        temp_id: isNovaProvidencia ? effectiveTempId : undefined,
        tempId: isNovaProvidencia ? effectiveTempId : undefined,
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
    }

    // Proteção de prazo_conclusao do caso no formulário:
    // Administrador: pode editar normalmente.
    // Gestor e Operacional: não podem alterar manualmente (campo desabilitado/somente leitura).
    // Em edição por Gestor/Operacional, preserva o valor atual do banco.
    let finalPrazoConclusaoCaso: string | null = prazoConclusao || null
    if (!isAdmin && isEditMode && controleToEdit) {
      finalPrazoConclusaoCaso = controleToEdit.prazo_conclusao
        ? controleToEdit.prazo_conclusao.split('T')[0]
        : null
    }

    const payload: SaveControleInput = {
      id: controleToEdit?.id,
      nome_controle_id: nomeControleId,
      identificacao_caso: identificacaoCaso.trim(),
      status_id: statusId,
      data_autorizacao: dataAutorizacao || null,
      prazo_conclusao: finalPrazoConclusaoCaso,
      responsavel_usuario_id: opRespPreservado,
      executor_usuario_id: opExecPreservado,
      responsavel_core_usuario_id: respCoreId || null,
      executor_core_usuario_id: execCoreId || null,
      pasta_cliente: pastaCliente.trim() || null,
      pasta_ricci: pastaRicci.trim() || null,
      providencias: provsToSave,
    }

    // Detecção de alteração de atribuição (para disparar notificação): compara IDs CENTRAIS.
    // REGRA: A CRIAÇÃO de um caso NÃO envia e-mail de atribuição.
    // Em caso existente, enviar UM ÚNICO e-mail quando Responsável ou Executor mudar, inclusive se ambos mudarem.
    // Salvar sem mudar a atribuição NÃO envia e-mail.
    let tipoNotificacao: 'alteracao_atribuicao' | null = null
    if (isEditMode) {
      const mudouExecutor = prevExecCore !== execCoreId
      const mudouResponsavel = prevRespCore !== respCoreId
      if (mudouExecutor || mudouResponsavel) {
        tipoNotificacao = 'alteracao_atribuicao'
      }
    }

    setSaving(true)
    try {
      // PONTO 1: SALVAMENTO ATÔMICO EM UMA ÚNICA TRANSAÇÃO NO SERVIDOR
      // Grava caso + atribuição + providências all-or-nothing
      const saveResult = await controleService.saveControleTransacional(
        payload,
        usuariosLista,
        corePerfil,
      )
      const savedControle = saveResult.controle
      const transicaoId = saveResult.transicao_id || null

      onSaved(savedControle)

      // 5. Disparo de notificações por e-mail DEPOIS que controle e todas as providências foram salvos com sucesso
      let emailFalhou = false

      // 5.1. Atribuição principal — PONTO 3: transporta o transicao_id retornado pelo servidor
      if (tipoNotificacao) {
        try {
          const notifResult = await controleService.notifyAssignment(
            savedControle.id,
            tipoNotificacao,
            transicaoId,
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

      // 5.2. Alertas de Providência — Iteração sobre eventos_providencias (RPC como autoridade única)
      const provsGravadas = saveResult.providencias || []
      const eventosProvidencias = saveResult.eventos_providencias || []

      for (const ev of eventosProvidencias) {
        const provCorrespondente = provsGravadas.find((pg: any) => pg.id === ev.providencia_id)
        if (!provCorrespondente) {
          continue
        }

        if (ev.tipo_evento === 'providencia_inclusao') {
          if (provCorrespondente.email_alertas && provCorrespondente.email_alerta_inclusao) {
            try {
              const resInclusao = await controleService.notifyProvidenciaInclusao(
                savedControle.id,
                ev.providencia_id,
              )
              if (!resInclusao.success) {
                emailFalhou = true
                console.error(
                  'Erro ao disparar notificação de inclusão de providência:',
                  resInclusao.error || resInclusao.reason || resInclusao.message,
                  resInclusao,
                )
              } else if (resInclusao.sent === false && resInclusao.reason) {
                console.log(
                  'Notificação de inclusão de providência não enviada (motivo controlado):',
                  resInclusao.reason,
                  resInclusao.message,
                )
              }
            } catch (errInclusao) {
              emailFalhou = true
              console.error(
                'Falha segura ao disparar alerta de inclusão de providência:',
                errInclusao,
              )
            }
          }
        } else if (ev.tipo_evento === 'providencia_atualizacao') {
          if (provCorrespondente.email_alertas && provCorrespondente.email_alerta_atualizacao) {
            try {
              const resAtualizacao = await controleService.notifyProvidenciaAtualizacao(
                savedControle.id,
                ev.providencia_id,
              )
              if (!resAtualizacao.success) {
                emailFalhou = true
                console.error(
                  'Erro ao disparar notificação de atualização de providência:',
                  resAtualizacao.error || resAtualizacao.reason || resAtualizacao.message,
                  resAtualizacao,
                )
              } else if (resAtualizacao.sent === false && resAtualizacao.reason) {
                console.log(
                  'Notificação de atualização de providência não enviada (motivo controlado):',
                  resAtualizacao.reason,
                  resAtualizacao.message,
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

      // Tratamento de rejeição do banco por violação de regra de datas / mudança concorrente de prazo:
      // Capturar o erro da gravação (ex.: mensagem/código da trigger/RPC indicando violação da regra de datas).
      // Preservar todo o preenchimento do formulário e atualizar o prazo conhecido do caso no formulário
      // com o valor atual vindo do banco/erro quando disponível, informando o usuário.
      const errMsg = err?.message || ''
      const isRegraDataRejection =
        err?.code === '23514' ||
        errMsg.includes('A data da providência') ||
        errMsg.includes('não pode ser maior que a data de conclusão do caso') ||
        errMsg.includes('não pode ser reduzida para uma data anterior ao prazo da providência') ||
        errMsg.includes('A conclusão do caso')

      if (isRegraDataRejection && controleToEdit?.id) {
        // Tenta consultar o estado persistido mais recente do caso para atualizar o prazo conhecido no formulário
        try {
          const { data: casoAtual } = await supabase
            .from('task_tarefas')
            .select('prazo_conclusao')
            .eq('id', controleToEdit.id)
            .maybeSingle()

          if (casoAtual && casoAtual.prazo_conclusao) {
            const novoPrazoCasoIso = (casoAtual.prazo_conclusao as string).split('T')[0]
            setPrazoConclusao(novoPrazoCasoIso)
            if (controleToEdit) {
              controleToEdit.prazo_conclusao = casoAtual.prazo_conclusao
            }
          }
        } catch (fetchAtualErr) {
          console.warn('Aviso ao consultar prazo atualizado do caso no Supabase:', fetchAtualErr)
        }

        toast({
          variant: 'destructive',
          title: 'Conflito de datas com o banco de dados',
          description:
            errMsg ||
            'A data da providência não pode ser maior que a data de conclusão do caso. O prazo atual do caso foi atualizado no formulário; revise as datas para prosseguir.',
        })
      } else {
        toast({
          variant: 'destructive',
          title: 'Falha ao salvar controle',
          description: errMsg || 'Ocorreu um erro no banco de dados Supabase.',
        })
      }
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

              {isAcessoAutorizado && updatedAtDisplay && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-muted/60 border border-border text-[11px] text-muted-foreground">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  <span>Última atualização:</span>
                  <strong className="text-foreground">{formatDateTimeBR(updatedAtDisplay)}</strong>
                </div>
              )}
            </div>

            {/* Abas: Apenas Dados do Caso | Providência (N) - Metadados e contagem ocultos enquanto bloqueado */}
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
                  Providência{isAcessoAutorizado ? ` (${providencias.length})` : ''}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </DialogHeader>

          {/* Conteúdo com scroll */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {!isAcessoAutorizado ? (
              <div className="py-16 flex flex-col items-center justify-center text-center gap-3">
                {verificandoAcesso ? (
                  <>
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground font-medium">
                      Verificando permissões de acesso ao caso...
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground font-medium">
                    Você não possui permissão para visualizar ou editar este caso.
                  </p>
                )}
              </div>
            ) : (
              <>
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
                            identificacaoError &&
                              'border-destructive focus-visible:ring-destructive',
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
                            <p className="text-xs text-destructive font-medium">
                              Selecione um status.
                            </p>
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
                          <Label
                            htmlFor="prazo-conclusao"
                            className={cn(
                              'text-xs font-semibold flex items-center gap-1',
                              !isAdmin && 'text-muted-foreground',
                            )}
                          >
                            <span>Prazo de Conclusão</span>
                          </Label>
                          <Input
                            id="prazo-conclusao"
                            type="date"
                            value={prazoConclusao}
                            disabled={!isAdmin}
                            onChange={(e) => setPrazoConclusao(e.target.value)}
                            className={cn(
                              'h-10 rounded-xl bg-background text-xs font-medium',
                              !isAdmin &&
                                'opacity-70 cursor-not-allowed bg-muted/50 border-border select-none text-muted-foreground',
                            )}
                            title={
                              !isAdmin
                                ? 'Somente Administradores podem editar o Prazo de Conclusão.'
                                : undefined
                            }
                          />
                          {!isAdmin && (
                            <p className="text-[11px] text-muted-foreground italic">
                              Somente o Administrador pode inserir ou alterar o Prazo de Conclusão
                              do caso.
                            </p>
                          )}
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
                              opcoesResponsaveis.length === 0 ||
                              (validacaoUsuariosStatus === 'falhou' &&
                                !controleToEdit?.responsavel_usuario_id)
                            }
                            onValueChange={(val) => {
                              if (
                                validacaoUsuariosStatus === 'falhou' &&
                                val !== controleToEdit?.responsavel_usuario_id
                              ) {
                                toast({
                                  variant: 'destructive',
                                  title: 'Seleção bloqueada',
                                  description:
                                    'Não é possível selecionar novos usuários durante falha das listas ou validação central.',
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
                              disabled={
                                opcoesResponsaveis.length === 0 ||
                                (validacaoUsuariosStatus === 'falhou' &&
                                  !controleToEdit?.responsavel_usuario_id)
                              }
                              className={cn(
                                'h-12 rounded-xl bg-background text-sm font-medium',
                                responsavelError &&
                                  'border-destructive focus-visible:ring-destructive',
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

                              {validacaoUsuariosStatus === 'carregando' &&
                              opcoesResponsaveis.length === 0 ? (
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
                              opcoesExecutores.length === 0 ||
                              (validacaoUsuariosStatus === 'falhou' &&
                                !controleToEdit?.executor_usuario_id)
                            }
                            onValueChange={(val) => {
                              if (
                                validacaoUsuariosStatus === 'falhou' &&
                                val !== controleToEdit?.executor_usuario_id
                              ) {
                                toast({
                                  variant: 'destructive',
                                  title: 'Seleção bloqueada',
                                  description:
                                    'Não é possível selecionar novos usuários durante falha das listas ou validação central.',
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
                                opcoesExecutores.length === 0 ||
                                (validacaoUsuariosStatus === 'falhou' &&
                                  !controleToEdit?.executor_usuario_id)
                              }
                              className={cn(
                                'h-12 rounded-xl bg-background text-sm font-medium',
                                executorIsResponsavel &&
                                  'opacity-70 cursor-not-allowed bg-muted/50',
                                executorError &&
                                  'border-destructive focus-visible:ring-destructive',
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

                              {validacaoUsuariosStatus === 'carregando' &&
                              opcoesExecutores.length === 0 ? (
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
                        <Label
                          htmlFor="pasta-ricci"
                          className="text-xs font-semibold text-foreground"
                        >
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
                        <h3 className="text-sm font-bold text-foreground">
                          Providências do Controle
                        </h3>
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
                                      <span className="text-primary/80 font-normal ml-1">
                                        (nova)
                                      </span>
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
                                          handleUpdateProvidencia(
                                            item.tempId,
                                            'data_conclusao',
                                            null,
                                          )
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
                                      cod === 'cancelado' ||
                                      cod === 'concluido' ||
                                      cod === 'suspenso'
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
                                          disabled={!isAdmin}
                                          value={item.data_conclusao || ''}
                                          onChange={(e) =>
                                            handleUpdateProvidencia(
                                              item.tempId,
                                              'data_conclusao',
                                              e.target.value,
                                            )
                                          }
                                          className={cn(
                                            'h-9 rounded-xl bg-background text-xs font-medium border-primary/40 focus-visible:ring-primary sm:max-w-xs',
                                            !isAdmin &&
                                              'opacity-70 cursor-not-allowed bg-muted/50 border-border select-none text-muted-foreground',
                                          )}
                                          title={
                                            !isAdmin
                                              ? 'Somente Administradores podem editar a Data de Conclusão.'
                                              : undefined
                                          }
                                        />
                                        {!isAdmin && (
                                          <p className="text-[11px] text-muted-foreground italic mt-0.5">
                                            Somente o Administrador pode inserir ou alterar
                                            manualmente a Data de Conclusão.
                                          </p>
                                        )}
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
                                        <span className="text-muted-foreground/40 text-[10px]">
                                          •
                                        </span>
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
                                      {/* Subtipo 1: Inclusão da providência */}
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
                                          Inclusão da providência
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
              </>
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
                disabled={!isAcessoAutorizado || verificandoAcesso || saving}
                onClick={() => onOpenChange(false)}
                className="h-10 px-4 rounded-xl text-xs"
              >
                Cancelar
              </Button>

              <Button
                type="button"
                size="sm"
                disabled={
                  !isAcessoAutorizado ||
                  verificandoAcesso ||
                  saving ||
                  loadingListas ||
                  (!controleToEdit && validacaoUsuariosStatus !== 'válida')
                }
                onClick={() => handleSubmitControle()}
                className="h-10 px-5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-[#4A4AC2]"
              >
                {(verificandoAcesso || saving) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
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

      {/* Diálogo Sim/Não de Confirmação de Adiamento:
          Texto exato exigido:
          "A data da providência não pode ser maior que a data de conclusão do caso. Deseja solicitar adiamento para um administrador?"
          Botões "Sim" e "Não".
          "Não": retorna ao formulário preservando TODO o preenchimento, sem gravar nada.
          "Sim": abre a janela de solicitação.
          Nenhuma escolha grava o caso ou a providência. */}
      <Dialog
        open={confirmarAdiamentoDialogOpen}
        onOpenChange={(openVal) => {
          if (!openVal) handleEscolhaNaoAdiamento()
        }}
      >
        <DialogContent className="max-w-md rounded-2xl p-6 bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <span>Solicitação de Adiamento</span>
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground/90 pt-2 leading-relaxed">
              A data da providência não pode ser maior que a data de conclusão do caso. Deseja
              solicitar adiamento para um administrador?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-4 flex flex-row items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={handleEscolhaNaoAdiamento}
              className="h-9 px-4 rounded-xl text-xs font-medium"
            >
              Não
            </Button>
            <Button
              type="button"
              onClick={handleEscolhaSimAdiamento}
              className="h-9 px-4 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-[#4A4AC2]"
            >
              Sim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Janela Modal de Solicitação de Adiamento:
          - Administrador OBRIGATÓRIO (lista retornada por listarAdministradoresAdiamento(); se vazia, explicar
            que não há administrador elegível — usuário ativo, ADMINISTRADOR ativo no Ricci Task e flag adiamento=true — e bloquear envio)
          - Motivo OBRIGATÓRIO com trim, máximo 200 caracteres e CONTADOR visível (x/200)
          - Data pretendida exibida AUTOMATICAMENTE (a data que violou a regra)
          - Botão "Enviar". Enviar chama solicitarAdiamento() e registra/notifica SOMENTE o pedido.
            Não salva providência, não altera prazo do caso e não continua o salvamento automaticamente.
            Preserva o rascunho do formulário ao fechar a janela.
          - Chave de idempotência preservada nas tentativas do mesmo pedido.
          - Resultado incerto não permite reenvio automático — informa o estado ao usuário. */}
      <Dialog
        open={modalAdiamentoOpen}
        onOpenChange={(openVal) => {
          if (!openVal && !enviandoSolicitacaoAdiamento) {
            setModalAdiamentoOpen(false)
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-x-hidden flex flex-col rounded-2xl p-6 bg-card border-border">
          <DialogHeader className="shrink-0 min-w-0">
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2 min-w-0">
              <Clock className="w-5 h-5 text-primary shrink-0" />
              <span className="break-words">Solicitar Adiamento do Caso</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground break-words">
              Envie um pedido de adiamento ao administrador responsável para apreciação.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 space-y-4 py-2 px-1 pb-1 -mx-1 pr-1">
            {/* Data pretendida (exibida automaticamente) */}
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border/70 text-xs min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-1 text-muted-foreground min-w-0">
                <span className="font-medium break-words">Data Pretendida para o Caso:</span>
                <span className="font-bold text-foreground break-words">
                  {providenciaParaAdiamento?.prazoPretendido
                    ? formatDateBR(providenciaParaAdiamento.prazoPretendido)
                    : 'Não informada'}
                </span>
              </div>
              {providenciaParaAdiamento?.providenciaItem?.providencia && (
                <div
                  className="text-[11px] text-muted-foreground pt-1 border-t border-border/40 min-w-0 line-clamp-3 break-words"
                  title={providenciaParaAdiamento.providenciaItem.providencia}
                >
                  <span className="font-semibold text-foreground/80">Providência vinculada: </span>
                  {providenciaParaAdiamento.providenciaItem.providencia}
                </div>
              )}
            </div>

            {/* Administrador elegível (obrigatório) */}
            <div className="space-y-1.5 min-w-0">
              <Label
                htmlFor="select-admin-adiamento"
                className="text-xs font-semibold text-foreground flex flex-wrap items-center justify-between gap-1 min-w-0"
              >
                <span className="break-words">
                  Administrador Destinatário <span className="text-destructive">*</span>
                </span>
                <span className="text-[11px] text-muted-foreground">Obrigatório</span>
              </Label>

              {loadingAdminsElegiveis ? (
                <div className="h-10 px-3 rounded-xl border border-border flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 min-w-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                  <span className="break-words">Carregando administradores elegíveis...</span>
                </div>
              ) : administradoresElegiveis.length === 0 ? (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive space-y-1 min-w-0">
                  <div className="font-semibold flex items-center gap-1.5 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="break-words">Nenhum administrador elegível encontrado</span>
                  </div>
                  <p className="text-[11px] text-destructive/90 leading-snug break-words">
                    Não há administrador elegível para receber solicitações de adiamento
                    (requisitos: usuário ativo, com perfil ADMINISTRADOR ativo no sistema Ricci Task
                    e permissão de adiamento habilitada). O envio está bloqueado.
                  </p>
                </div>
              ) : (
                <Select
                  value={adminSelecionadoId}
                  onValueChange={(val) => {
                    setAdminSelecionadoId(val)
                    if (erroAdiamento && !resultadoIncertoAdiamento) setErroAdiamento(null)
                  }}
                  disabled={enviandoSolicitacaoAdiamento || resultadoIncertoAdiamento}
                >
                  <SelectTrigger
                    id="select-admin-adiamento"
                    className="h-10 w-full rounded-xl bg-background text-xs sm:text-sm min-w-0"
                  >
                    <SelectValue placeholder="Selecione um administrador..." />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {administradoresElegiveis.map((admin) => (
                      <SelectItem key={admin.id} value={admin.id} className="py-2">
                        <div className="flex flex-col text-left min-w-0">
                          <span className="font-semibold text-xs text-foreground truncate">
                            {admin.nome}
                          </span>
                          <span className="text-[10px] text-muted-foreground truncate">
                            {admin.email}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Motivo (obrigatório, máximo 200 caracteres, contador x/200 visível) */}
            <div className="space-y-1.5 min-w-0">
              <Label
                htmlFor="motivo-adiamento-input"
                className="text-xs font-semibold text-foreground flex flex-wrap items-center justify-between gap-1 min-w-0"
              >
                <span className="break-words">
                  Motivo da Solicitação <span className="text-destructive">*</span>
                </span>
                <span className="text-[11px] text-muted-foreground">Máx. 200 caracteres</span>
              </Label>
              <Textarea
                id="motivo-adiamento-input"
                value={motivoAdiamento}
                onChange={(e) => {
                  setMotivoAdiamento(e.target.value)
                  if (erroAdiamento && !resultadoIncertoAdiamento) setErroAdiamento(null)
                }}
                maxLength={200}
                rows={3}
                disabled={enviandoSolicitacaoAdiamento || resultadoIncertoAdiamento}
                placeholder="Descreva a justificativa para prorrogar a conclusão do caso..."
                className={cn(
                  'w-full resize-none rounded-xl bg-background text-xs sm:text-sm min-w-0',
                  motivoAdiamento.trim().length > 200 &&
                    'border-destructive focus-visible:ring-destructive',
                )}
              />
              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] min-w-0">
                <span
                  className={cn(
                    'break-words',
                    motivoAdiamento.trim().length === 0
                      ? 'text-muted-foreground'
                      : 'text-foreground',
                  )}
                >
                  {motivoAdiamento.trim().length === 0
                    ? 'Obrigatório (não pode ser vazio ou espaços)'
                    : ''}
                </span>
                <span
                  className={cn(
                    'font-mono font-medium shrink-0',
                    motivoAdiamento.trim().length > 200
                      ? 'text-destructive font-bold'
                      : 'text-muted-foreground',
                  )}
                >
                  {motivoAdiamento.trim().length}/200
                </span>
              </div>
            </div>

            {/* Mensagem de Erro ou Estado Incerto */}
            {erroAdiamento && (
              <div
                className={cn(
                  'p-3 rounded-xl border text-xs flex items-start gap-2 min-w-0',
                  resultadoIncertoAdiamento
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                    : 'bg-destructive/10 border-destructive/20 text-destructive',
                )}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1 leading-snug min-w-0">
                  <span className="font-semibold block break-words">
                    {resultadoIncertoAdiamento ? 'Envio Incerto (SMTP)' : 'Atenção'}
                  </span>
                  <span className="break-words">{erroAdiamento}</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2 shrink-0 flex flex-row items-center justify-end gap-2.5 min-w-0">
            <Button
              type="button"
              variant="outline"
              disabled={enviandoSolicitacaoAdiamento}
              onClick={() => setModalAdiamentoOpen(false)}
              className="h-9 px-4 rounded-xl text-xs font-medium"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                enviandoSolicitacaoAdiamento ||
                loadingAdminsElegiveis ||
                administradoresElegiveis.length === 0 ||
                !adminSelecionadoId ||
                motivoAdiamento.trim().length === 0 ||
                motivoAdiamento.trim().length > 200 ||
                resultadoIncertoAdiamento
              }
              onClick={handleEnviarSolicitacaoAdiamento}
              className="h-9 px-5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-[#4A4AC2]"
            >
              {enviandoSolicitacaoAdiamento && (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              )}
              <span>Enviar</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
