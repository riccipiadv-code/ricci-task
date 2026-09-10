import { useState, useEffect, useMemo } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Plus,
  Trash2,
  Edit2,
  Calendar,
  Clock,
  User,
  Info,
  CheckCircle2,
  AlertTriangle,
  History,
  FileText,
  CalendarClock,
  Sparkles,
  Loader2,
} from 'lucide-react'
import {
  TaskControleRecord,
  TaskStatusRecord,
  TaskTipoPrazoRecord,
  TaskResponsavelRecord,
  LegaldeskUsuarioRecord,
  TaskPrazoRecord,
  TaskAndamentoRecord,
  SaveControleInput,
} from '@/types/task'
import { formatDateBR, formatDateTimeBR, getStatusBadgeStyle } from '@/lib/formatters'
import { controleService } from '@/services/controleService'
import { useToast } from '@/hooks/use-toast'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { cn } from '@/lib/utils'

interface ControleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  controleToEdit?: TaskControleRecord | null
  statusList: TaskStatusRecord[]
  tiposPrazoList: TaskTipoPrazoRecord[]
  responsaveisCatalogo: TaskResponsavelRecord[]
  usuariosInternos: LegaldeskUsuarioRecord[]
  onSaved: (controle: TaskControleRecord) => void
}

interface DraftPrazo {
  id?: string // se já existe no banco
  data_prazo: string
  tipo_prazo_id: string | null
  descricao: string
  principal: boolean
  ativo: boolean
}

export function ControleModal({
  open,
  onOpenChange,
  controleToEdit,
  statusList,
  tiposPrazoList,
  responsaveisCatalogo,
  usuariosInternos,
  onSaved,
}: ControleModalProps) {
  const { toast } = useToast()

  // Aba ativa: dados | prazos | providencias | andamentos
  const [activeTab, setActiveTab] = useState('dados')

  // Estado do formulário de dados do caso
  const [nomeControle, setNomeControle] = useState('')
  const [controleCliente, setControleCliente] = useState('')
  const [controleRicci, setControleRicci] = useState('')
  const [identificacaoCaso, setIdentificacaoCaso] = useState('')
  const [dataReferencia, setDataReferencia] = useState('')
  const [statusId, setStatusId] = useState('')
  const [descricaoStatus, setDescricaoStatus] = useState('')

  // Responsável: encoded value "interno:UUID" ou "catalogo:UUID"
  const [responsavelSelection, setResponsavelSelection] = useState('')

  // Providências e follow-up
  const [proximasProvidencias, setProximasProvidencias] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [updatedAtDisplay, setUpdatedAtDisplay] = useState<string | null>(null)

  // Prazos vinculados
  const [prazos, setPrazos] = useState<DraftPrazo[]>([])
  const [novoPrazoModalOpen, setNovoPrazoModalOpen] = useState(false)
  const [prazoEmEdicaoIndex, setPrazoEmEdicaoIndex] = useState<number | null>(null)
  const [draftPrazoData, setDraftPrazoData] = useState('')
  const [draftPrazoTipoId, setDraftPrazoTipoId] = useState('')
  const [draftPrazoDescricao, setDraftPrazoDescricao] = useState('')
  const [draftPrazoPrincipal, setDraftPrazoPrincipal] = useState(false)

  // Andamentos vinculados (somente quando editando controle já existente no banco)
  const [andamentos, setAndamentos] = useState<TaskAndamentoRecord[]>([])
  const [loadingAndamentos, setLoadingAndamentos] = useState(false)
  const [andamentoFormOpen, setAndamentoFormOpen] = useState(false)
  const [andamentoEmEdicao, setAndamentoEmEdicao] = useState<TaskAndamentoRecord | null>(null)
  const [andamentoData, setAndamentoData] = useState('')
  const [andamentoDescricao, setAndamentoDescricao] = useState('')
  const [andamentoToDelete, setAndamentoToDelete] = useState<TaskAndamentoRecord | null>(null)
  const [andamentoDeleteConfirmOpen, setAndamentoDeleteConfirmOpen] = useState(false)

  // Erros de validação
  const [nomeControleError, setNomeControleError] = useState(false)
  const [identificacaoError, setIdentificacaoError] = useState(false)
  const [statusError, setStatusError] = useState(false)
  const [responsavelError, setResponsavelError] = useState(false)
  const [saving, setSaving] = useState(false)

  // Carrega status padrão caso novo
  const statusPadraoId = useMemo(() => {
    const emAndamento = statusList.find((s) => s.codigo === 'em_andamento')
    return emAndamento?.id || (statusList[0]?.id ?? '')
  }, [statusList])

  // Identifica se o status selecionado é "Aguardando autorização"
  const statusSelecionado = useMemo(() => {
    return statusList.find((s) => s.id === statusId)
  }, [statusList, statusId])

  const isAguardandoAutorizacao = useMemo(() => {
    return statusSelecionado?.codigo === 'aguardando_autorizacao'
  }, [statusSelecionado])

  // Popula o formulário ao abrir
  useEffect(() => {
    if (!open) return

    setActiveTab('dados')
    setNomeControleError(false)
    setIdentificacaoError(false)
    setStatusError(false)
    setResponsavelError(false)

    if (controleToEdit) {
      setNomeControle(controleToEdit.nome_controle || '')
      setControleCliente(controleToEdit.controle_cliente || '')
      setControleRicci(controleToEdit.controle_ricci || '')
      setIdentificacaoCaso(controleToEdit.identificacao_caso || '')
      setDataReferencia(
        controleToEdit.data_referencia
          ? controleToEdit.data_referencia.split('T')[0]
          : new Date().toISOString().split('T')[0],
      )
      setStatusId(controleToEdit.status_id || statusPadraoId)
      setDescricaoStatus(controleToEdit.descricao_status || '')
      setProximasProvidencias(controleToEdit.proximas_providencias || '')
      setFollowUp(controleToEdit.follow_up ? controleToEdit.follow_up.split('T')[0] : '')
      setUpdatedAtDisplay(controleToEdit.updated_at || null)

      // Responsável
      if (controleToEdit.responsavel_legaldesk_id) {
        setResponsavelSelection(`interno:${controleToEdit.responsavel_legaldesk_id}`)
      } else if (controleToEdit.responsavel_id) {
        setResponsavelSelection(`catalogo:${controleToEdit.responsavel_id}`)
      } else {
        setResponsavelSelection('')
      }

      // Prazos existentes
      const draftList: DraftPrazo[] = (controleToEdit.prazos || []).map((p) => ({
        id: p.id,
        data_prazo: p.data_prazo ? p.data_prazo.split('T')[0] : '',
        tipo_prazo_id: p.tipo_prazo_id,
        descricao: p.descricao || '',
        principal: p.principal,
        ativo: p.ativo,
      }))
      setPrazos(draftList)

      // Carregar andamentos atualizados do banco
      if (controleToEdit.id) {
        loadAndamentos(controleToEdit.id)
      } else {
        setAndamentos([])
      }
    } else {
      // Novo controle
      setNomeControle('')
      setControleCliente('')
      setControleRicci('')
      setIdentificacaoCaso('')
      setDataReferencia(new Date().toISOString().split('T')[0])
      setStatusId(statusPadraoId)
      setDescricaoStatus('')
      setResponsavelSelection('')
      setProximasProvidencias('')
      setFollowUp('')
      setUpdatedAtDisplay(null)
      setPrazos([])
      setAndamentos([])
    }
  }, [open, controleToEdit, statusPadraoId])

  const loadAndamentos = async (tarefaId: string) => {
    setLoadingAndamentos(true)
    try {
      const list = await controleService.getAndamentos(tarefaId)
      setAndamentos(list)
    } catch (err) {
      console.error('Erro ao carregar andamentos:', err)
    } finally {
      setLoadingAndamentos(false)
    }
  }

  // --------------------------------------------------------------------------
  // Gestão de Prazos no Modal
  // --------------------------------------------------------------------------
  const handleOpenAdicionarPrazo = () => {
    setPrazoEmEdicaoIndex(null)
    setDraftPrazoData(new Date().toISOString().split('T')[0])
    setDraftPrazoTipoId(tiposPrazoList[0]?.id || '')
    setDraftPrazoDescricao('')
    // Se não há nenhum prazo marcado como principal, sugere principal
    const hasPrincipal = prazos.some((p) => p.principal && p.ativo)
    setDraftPrazoPrincipal(!hasPrincipal)
    setNovoPrazoModalOpen(true)
  }

  const handleOpenEditarPrazo = (index: number) => {
    const item = prazos[index]
    setPrazoEmEdicaoIndex(index)
    setDraftPrazoData(item.data_prazo)
    setDraftPrazoTipoId(item.tipo_prazo_id || '')
    setDraftPrazoDescricao(item.descricao)
    setDraftPrazoPrincipal(item.principal)
    setNovoPrazoModalOpen(true)
  }

  const handleSalvarDraftPrazo = () => {
    if (!draftPrazoData) {
      toast({
        variant: 'destructive',
        title: 'Data obrigatória',
        description: 'Informe a data do prazo.',
      })
      return
    }

    let updated = [...prazos]

    // Se este prazo foi marcado como principal, desmarca os demais
    if (draftPrazoPrincipal) {
      updated = updated.map((p, idx) => {
        if (prazoEmEdicaoIndex !== null && idx === prazoEmEdicaoIndex) return p
        return { ...p, principal: false }
      })
    }

    const prazoObj: DraftPrazo = {
      id: prazoEmEdicaoIndex !== null ? updated[prazoEmEdicaoIndex].id : undefined,
      data_prazo: draftPrazoData,
      tipo_prazo_id: draftPrazoTipoId || null,
      descricao: draftPrazoDescricao.trim(),
      principal: draftPrazoPrincipal,
      ativo: prazoEmEdicaoIndex !== null ? updated[prazoEmEdicaoIndex].ativo : true,
    }

    if (prazoEmEdicaoIndex !== null) {
      updated[prazoEmEdicaoIndex] = prazoObj
    } else {
      updated.push(prazoObj)
    }

    setPrazos(updated)
    setNovoPrazoModalOpen(false)
  }

  const handleRemoverPrazo = async (index: number) => {
    const item = prazos[index]
    if (item.id) {
      try {
        await controleService.deletePrazo(item.id)
        if (controleToEdit?.id) {
          const freshUpdated = await controleService.getControleUpdatedAt(controleToEdit.id)
          if (freshUpdated) setUpdatedAtDisplay(freshUpdated)
        }
      } catch (err: any) {
        toast({
          variant: 'destructive',
          title: 'Erro ao excluir prazo',
          description: err.message,
        })
        return
      }
    }
    const next = [...prazos]
    next.splice(index, 1)
    setPrazos(next)
    toast({ title: 'Prazo removido' })
  }

  const handleTogglePrazoPrincipal = (index: number) => {
    const next = prazos.map((p, i) => ({
      ...p,
      principal: i === index ? !p.principal : false,
    }))
    setPrazos(next)
  }

  // --------------------------------------------------------------------------
  // Gestão de Andamentos no Modal
  // --------------------------------------------------------------------------
  const handleOpenAdicionarAndamento = () => {
    setAndamentoEmEdicao(null)
    setAndamentoData(new Date().toISOString().split('T')[0])
    setAndamentoDescricao('')
    setAndamentoFormOpen(true)
  }

  const handleOpenEditarAndamento = (item: TaskAndamentoRecord) => {
    setAndamentoEmEdicao(item)
    setAndamentoData(item.data_andamento.split('T')[0])
    setAndamentoDescricao(item.descricao)
    setAndamentoFormOpen(true)
  }

  const handleSalvarAndamento = async () => {
    if (!controleToEdit?.id) return
    if (!andamentoData) {
      toast({ variant: 'destructive', title: 'Data do andamento obrigatória' })
      return
    }
    if (!andamentoDescricao.trim()) {
      toast({ variant: 'destructive', title: 'Descrição do andamento obrigatória' })
      return
    }

    try {
      await controleService.saveAndamento({
        id: andamentoEmEdicao?.id,
        tarefa_id: controleToEdit.id,
        data_andamento: andamentoData,
        descricao: andamentoDescricao.trim(),
      })

      // Recarrega lista e timestamp do controle
      await loadAndamentos(controleToEdit.id)
      const freshUpdated = await controleService.getControleUpdatedAt(controleToEdit.id)
      if (freshUpdated) setUpdatedAtDisplay(freshUpdated)

      setAndamentoFormOpen(false)
      toast({
        title: andamentoEmEdicao ? 'Andamento atualizado' : 'Andamento registrado com sucesso',
      })
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar andamento',
        description: err.message,
      })
    }
  }

  const handleConfirmarExclusaoAndamento = async () => {
    if (!andamentoToDelete || !controleToEdit?.id) return
    try {
      await controleService.deleteAndamento(andamentoToDelete.id)
      await loadAndamentos(controleToEdit.id)
      const freshUpdated = await controleService.getControleUpdatedAt(controleToEdit.id)
      if (freshUpdated) setUpdatedAtDisplay(freshUpdated)
      toast({ title: 'Andamento excluído com sucesso' })
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir andamento',
        description: err.message,
      })
    } finally {
      setAndamentoToDelete(null)
      setAndamentoDeleteConfirmOpen(false)
    }
  }

  // --------------------------------------------------------------------------
  // Submit Principal do Controle
  // --------------------------------------------------------------------------
  const handleSubmitControle = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()

    let hasError = false
    if (!nomeControle.trim()) {
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
    if (!responsavelSelection) {
      setResponsavelError(true)
      hasError = true
    }

    if (hasError) {
      setActiveTab('dados')
      toast({
        variant: 'destructive',
        title: 'Campos obrigatórios',
        description: 'Verifique os campos obrigatórios em Dados do Caso e Responsável.',
      })
      return
    }

    // Separa interno vs catalogo
    let responsavelLegaldeskId: string | null = null
    let responsavelId: string | null = null

    if (responsavelSelection.startsWith('interno:')) {
      responsavelLegaldeskId = responsavelSelection.replace('interno:', '')
    } else if (responsavelSelection.startsWith('catalogo:')) {
      responsavelId = responsavelSelection.replace('catalogo:', '')
    }

    const payload: SaveControleInput = {
      id: controleToEdit?.id,
      nome_controle: nomeControle.trim(),
      controle_cliente: controleCliente.trim() || null,
      controle_ricci: controleRicci.trim() || null,
      identificacao_caso: identificacaoCaso.trim(),
      status_id: statusId,
      descricao_status: descricaoStatus.trim() || null,
      proximas_providencias: proximasProvidencias.trim() || null,
      responsavel_legaldesk_id: responsavelLegaldeskId,
      responsavel_id: responsavelId,
      follow_up: followUp || null,
      data_referencia: dataReferencia || new Date().toISOString().split('T')[0],
    }

    setSaving(true)
    try {
      const saved = await controleService.saveControle(payload)

      // Salva os prazos que foram adicionados/editados no rascunho
      if (prazos.length > 0) {
        for (const p of prazos) {
          await controleService.savePrazo({
            id: p.id,
            tarefa_id: saved.id,
            data_prazo: p.data_prazo,
            tipo_prazo_id: p.tipo_prazo_id,
            descricao: p.descricao,
            principal: p.principal,
            ativo: p.ativo,
          })
        }
      }

      // Recarrega o controle completo
      const fullyLoaded = await controleService.getControleById(saved.id)
      onSaved(fullyLoaded || saved)
      toast({
        title: controleToEdit ? 'Controle atualizado' : 'Controle criado com sucesso',
        description: `Caso: ${saved.identificacao_caso}`,
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
                  Gerenciamento integrado com prazos múltiplos, providências e andamentos.
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

            {/* Abas */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mt-3">
              <TabsList className="grid w-full grid-cols-4 rounded-xl bg-muted/60 p-1">
                <TabsTrigger value="dados" className="rounded-lg text-xs font-semibold">
                  Dados do Caso
                </TabsTrigger>
                <TabsTrigger value="prazos" className="rounded-lg text-xs font-semibold">
                  Prazos ({prazos.length})
                </TabsTrigger>
                <TabsTrigger value="providencias" className="rounded-lg text-xs font-semibold">
                  Providências & Follow-up
                </TabsTrigger>
                <TabsTrigger
                  value="andamentos"
                  className="rounded-lg text-xs font-semibold"
                  disabled={!controleToEdit}
                  title={!controleToEdit ? 'Disponível após criar o controle' : undefined}
                >
                  Andamentos ({andamentos.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </DialogHeader>

          {/* Conteúdo com scroll */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* ============================================================= */}
            {/* ABA 1: DADOS DO CASO & RESPONSÁVEL                            */}
            {/* ============================================================= */}
            {activeTab === 'dados' && (
              <div className="space-y-5">
                {/* Orientação quando Aguardando autorização */}
                {isAguardandoAutorizacao && (
                  <div className="flex items-start gap-3 p-3.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-900 dark:text-violet-200">
                    <Info className="w-4 h-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">Status: Aguardando autorização</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Os campos <strong>Controle Cliente</strong> e{' '}
                        <strong>Controle Ricci</strong> são opcionais neste momento. Os códigos
                        poderão ser preenchidos posteriormente assim que a autorização for
                        concedida.
                      </p>
                    </div>
                  </div>
                )}

                {/* Bloco 1: Nome do Controle, Códigos e Identificação */}
                <div className="space-y-4">
                  {/* Nome do Controle (Campo Obrigatório - Título do acompanhamento) */}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="nome-controle"
                      className="text-xs font-semibold text-foreground flex items-center justify-between"
                    >
                      <span>
                        Nome do Controle <span className="text-destructive">*</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Título do acompanhamento
                      </span>
                    </Label>
                    <Input
                      id="nome-controle"
                      placeholder="Ex: Ricci Advogados PI e Natura (Contencioso) - Controle Ações Estratégicas e Status de Medidas Definidas"
                      value={nomeControle}
                      onChange={(e) => {
                        setNomeControle(e.target.value)
                        if (nomeControleError && e.target.value.trim()) setNomeControleError(false)
                      }}
                      className={cn(
                        'h-10 rounded-xl bg-background font-medium',
                        nomeControleError && 'border-destructive focus-visible:ring-destructive',
                      )}
                    />
                    {nomeControleError && (
                      <p className="text-xs text-destructive font-medium">
                        O Nome do Controle é obrigatório.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="ctrl-cliente"
                        className="text-xs font-semibold text-foreground"
                      >
                        Controle Cliente{' '}
                        {!isAguardandoAutorizacao && (
                          <span className="text-muted-foreground">(opcional)</span>
                        )}
                      </Label>
                      <Input
                        id="ctrl-cliente"
                        placeholder="Ex: CC-2025-081"
                        value={controleCliente}
                        onChange={(e) => setControleCliente(e.target.value)}
                        className="h-10 rounded-xl bg-background"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="ctrl-ricci" className="text-xs font-semibold text-foreground">
                        Controle Ricci{' '}
                        {!isAguardandoAutorizacao && (
                          <span className="text-muted-foreground">(opcional)</span>
                        )}
                      </Label>
                      <Input
                        id="ctrl-ricci"
                        placeholder="Ex: RICCI-9941"
                        value={controleRicci}
                        onChange={(e) => setControleRicci(e.target.value)}
                        className="h-10 rounded-xl bg-background"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
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
                        placeholder="Ex: Ação Anulatória de Marca X - 1ª Vara Empresarial"
                        value={identificacaoCaso}
                        onChange={(e) => {
                          setIdentificacaoCaso(e.target.value)
                          if (identificacaoError && e.target.value.trim())
                            setIdentificacaoError(false)
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
                </div>

                {/* Bloco 2: Status e Data de Referência */}
                <div className="p-4 rounded-xl bg-muted/30 border border-border/60 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                    <span>Status do Controle</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          {statusList.map((st) => {
                            const badge = getStatusBadgeStyle(st.codigo, st.finaliza)
                            return (
                              <SelectItem key={st.id} value={st.id}>
                                <div className="flex items-center gap-2">
                                  <span className={cn('w-2 h-2 rounded-full', badge.dot)} />
                                  <span>{st.nome}</span>
                                  {st.finaliza && (
                                    <span className="text-[10px] text-muted-foreground">
                                      (Conclui)
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                      {statusError && (
                        <p className="text-xs text-destructive font-medium">Selecione um status.</p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="data-referencia" className="text-xs font-semibold">
                        Data de Referência <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="data-referencia"
                        type="date"
                        value={dataReferencia}
                        onChange={(e) => setDataReferencia(e.target.value)}
                        className="h-10 rounded-xl bg-background"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1.5">
                      <Label htmlFor="desc-status" className="text-xs font-semibold">
                        Descrição do Status{' '}
                        <span className="text-muted-foreground">(opcional)</span>
                      </Label>
                      <Textarea
                        id="desc-status"
                        rows={2}
                        placeholder="Detalhes complementares sobre o status atual do caso..."
                        value={descricaoStatus}
                        onChange={(e) => setDescricaoStatus(e.target.value)}
                        className="resize-none rounded-xl bg-background"
                      />
                    </div>
                  </div>
                </div>

                {/* Bloco 3: Responsável (Única seleção agrupada visualmente) */}
                <div className="p-4 rounded-xl bg-muted/30 border border-border/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                      <User className="w-4 h-4 text-primary" />
                      <span>
                        Responsável pelo Controle <span className="text-destructive">*</span>
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      Pessoas internas ou terceiros
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Select
                      value={responsavelSelection}
                      onValueChange={(val) => {
                        setResponsavelSelection(val)
                        if (responsavelError) setResponsavelError(false)
                      }}
                    >
                      <SelectTrigger
                        className={cn(
                          'h-11 rounded-xl bg-background text-sm',
                          responsavelError && 'border-destructive focus-visible:ring-destructive',
                        )}
                      >
                        <SelectValue placeholder="Selecione o responsável..." />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl max-h-80">
                        {/* Grupo 1: Pessoas internas (legaldesk_usuarios ativos) */}
                        <SelectGroup>
                          <SelectLabel className="text-xs font-bold text-primary uppercase tracking-wider px-2 py-1.5 bg-muted/50 rounded-md my-1">
                            👥 Pessoas Internas ({usuariosInternos.length})
                          </SelectLabel>
                          {usuariosInternos.map((u) => (
                            <SelectItem key={u.id} value={`interno:${u.id}`} className="py-2">
                              <div className="flex flex-col">
                                <span className="font-semibold text-foreground text-xs leading-tight">
                                  {u.nome}
                                </span>
                                {u.email && (
                                  <span className="text-[11px] text-muted-foreground truncate">
                                    {u.email}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>

                        {/* Grupo 2: Equipes e Terceiros (task_responsaveis ativos) */}
                        <SelectGroup>
                          <SelectLabel className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider px-2 py-1.5 bg-muted/50 rounded-md my-1 mt-2">
                            🏢 Equipes e Terceiros ({responsaveisCatalogo.length})
                          </SelectLabel>
                          {responsaveisCatalogo.map((r) => (
                            <SelectItem key={r.id} value={`catalogo:${r.id}`} className="py-2">
                              <div className="flex items-center justify-between w-full gap-2">
                                <span className="font-semibold text-foreground text-xs">
                                  {r.nome}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-muted text-muted-foreground">
                                  {r.tipo === 'equipe' ? 'Equipe' : 'Terceiro'}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>

                    {responsavelError && (
                      <p className="text-xs text-destructive font-medium">
                        O responsável é obrigatório. Selecione uma pessoa interna ou
                        equipe/terceiro.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* ABA 2: PRAZOS MÚLTIPLOS                                       */}
            {/* ============================================================= */}
            {activeTab === 'prazos' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Prazos do Controle</h3>
                    <p className="text-xs text-muted-foreground">
                      Múltiplos prazos vinculados. Marque um prazo como <strong>Principal</strong>{' '}
                      para priorizá-lo na listagem.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleOpenAdicionarPrazo}
                    className="h-9 rounded-xl px-3.5 bg-primary text-primary-foreground font-semibold text-xs flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                    <span>Adicionar Prazo</span>
                  </Button>
                </div>

                {prazos.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-2xl bg-muted/20 space-y-2">
                    <Calendar className="w-8 h-8 text-muted-foreground mx-auto" />
                    <p className="text-xs text-muted-foreground">
                      Nenhum prazo cadastrado para este controle.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleOpenAdicionarPrazo}
                      className="rounded-xl text-xs"
                    >
                      + Cadastrar primeiro prazo
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {prazos.map((prazo, index) => {
                      const tipo = tiposPrazoList.find((t) => t.id === prazo.tipo_prazo_id)
                      const isVencido = prazo.data_prazo < new Date().toISOString().split('T')[0]

                      return (
                        <div
                          key={index}
                          className={cn(
                            'p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors',
                            prazo.principal
                              ? 'bg-primary/5 border-primary/40'
                              : 'bg-card border-border',
                          )}
                        >
                          <div className="flex items-start sm:items-center gap-3 min-w-0">
                            {/* Indicador de Principal */}
                            <button
                              type="button"
                              onClick={() => handleTogglePrazoPrincipal(index)}
                              className={cn(
                                'h-8 px-2 rounded-lg text-[11px] font-bold flex items-center gap-1 shrink-0 transition-colors',
                                prazo.principal
                                  ? 'bg-primary text-primary-foreground shadow-xs'
                                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
                              )}
                              title="Clique para alternar prazo principal"
                            >
                              <Sparkles className="w-3 h-3" />
                              <span>{prazo.principal ? 'Principal' : 'Tornar principal'}</span>
                            </button>

                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={cn(
                                    'text-xs font-bold flex items-center gap-1',
                                    isVencido ? 'text-destructive' : 'text-foreground',
                                  )}
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                  {formatDateBR(prazo.data_prazo)}
                                </span>

                                {tipo && (
                                  <span className="text-[10px] font-semibold px-2 py-0.2 rounded-md bg-muted text-muted-foreground border border-border">
                                    {tipo.nome}
                                  </span>
                                )}

                                {isVencido && (
                                  <span className="text-[10px] font-bold uppercase text-destructive bg-destructive/10 px-1.5 py-0.2 rounded">
                                    Vencido
                                  </span>
                                )}
                              </div>

                              {prazo.descricao && (
                                <p className="text-xs text-muted-foreground truncate max-w-md">
                                  {prazo.descricao}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEditarPrazo(index)}
                              className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                              title="Editar prazo"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoverPrazo(index)}
                              className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Remover prazo"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ============================================================= */}
            {/* ABA 3: PROVIDÊNCIAS & FOLLOW-UP                               */}
            {/* ============================================================= */}
            {activeTab === 'providencias' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="prox-prov"
                    className="text-xs font-semibold text-foreground flex items-center justify-between"
                  >
                    <span>Próximas Providências</span>
                    <span className="text-[11px] text-muted-foreground">Texto longo detalhado</span>
                  </Label>
                  <Textarea
                    id="prox-prov"
                    rows={6}
                    placeholder="Descreva as providências a serem tomadas no caso, peticionamentos, contatos com o cliente ou correspondente..."
                    value={proximasProvidencias}
                    onChange={(e) => setProximasProvidencias(e.target.value)}
                    className="resize-y min-h-[120px] rounded-xl bg-background font-normal text-xs sm:text-sm leading-relaxed"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="follow-up-date"
                      className="text-xs font-semibold text-foreground flex items-center gap-1.5"
                    >
                      <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
                      <span>Data de Follow-up</span>
                    </Label>
                    <Input
                      id="follow-up-date"
                      type="date"
                      value={followUp}
                      onChange={(e) => setFollowUp(e.target.value)}
                      className="h-10 rounded-xl bg-background"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Follow-ups vencidos ganham destaque âmbar na listagem e no dashboard.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">
                      Última Atualização no Banco
                    </Label>
                    <div className="h-10 rounded-xl bg-muted/40 border border-border px-3 flex items-center text-xs text-muted-foreground">
                      {updatedAtDisplay
                        ? formatDateTimeBR(updatedAtDisplay)
                        : 'Será gravada ao salvar'}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Campo técnico somente leitura, atualizado por triggers do banco de dados.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* ABA 4: ANDAMENTOS E DECISÕES (LINHA DO TEMPO)                 */}
            {/* ============================================================= */}
            {activeTab === 'andamentos' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Andamentos e Decisões</h3>
                    <p className="text-xs text-muted-foreground">
                      Histórico cronológico em ordem decrescente.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleOpenAdicionarAndamento}
                    className="h-9 rounded-xl px-3.5 bg-primary text-primary-foreground font-semibold text-xs flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                    <span>Adicionar Andamento</span>
                  </Button>
                </div>

                {loadingAndamentos ? (
                  <div className="p-8 text-center text-muted-foreground text-xs flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>Carregando andamentos...</span>
                  </div>
                ) : andamentos.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-2xl bg-muted/20 space-y-2">
                    <History className="w-8 h-8 text-muted-foreground mx-auto" />
                    <p className="text-xs text-muted-foreground">
                      Nenhum andamento ou decisão registrado ainda.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleOpenAdicionarAndamento}
                      className="rounded-xl text-xs"
                    >
                      + Adicionar primeiro andamento
                    </Button>
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    {andamentos.map((item) => (
                      <div
                        key={item.id}
                        className="relative group bg-card border border-border rounded-xl p-3.5 space-y-1.5 shadow-xs hover:border-primary/40 transition-colors"
                      >
                        {/* Dot da timeline */}
                        <span className="absolute -left-[27px] top-4 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-background" />

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-foreground">
                              {formatDateBR(item.data_andamento)}
                            </span>
                            {item.created_at && (
                              <span className="text-[11px] text-muted-foreground">
                                • Incluído em {formatDateTimeBR(item.created_at)}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEditarAndamento(item)}
                              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                              title="Editar andamento"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setAndamentoToDelete(item)
                                setAndamentoDeleteConfirmOpen(true)
                              }}
                              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Excluir andamento"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>

                        <p className="text-xs sm:text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                          {item.descricao}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Principal */}
          <DialogFooter className="px-6 py-4 border-t border-border/70 shrink-0 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground text-left w-full sm:w-auto">
              {isAguardandoAutorizacao && (
                <span className="text-violet-600 dark:text-violet-400 font-medium">
                  Aguardando autorização ativa
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="h-10 rounded-xl px-4"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={handleSubmitControle}
                className="h-10 rounded-xl px-5 bg-primary text-primary-foreground hover:bg-[#4A4AC2] font-semibold shadow-sm flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{controleToEdit ? 'Salvar Alterações' : 'Criar Controle'}</span>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submodal para Adicionar / Editar Prazo */}
      <Dialog open={novoPrazoModalOpen} onOpenChange={setNovoPrazoModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {prazoEmEdicaoIndex !== null ? 'Editar Prazo' : 'Adicionar Prazo'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Vincule um novo prazo ao controle de caso.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prazo-data" className="text-xs font-semibold">
                Data do Prazo <span className="text-destructive">*</span>
              </Label>
              <Input
                id="prazo-data"
                type="date"
                value={draftPrazoData}
                onChange={(e) => setDraftPrazoData(e.target.value)}
                className="h-10 rounded-xl bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Tipo de Prazo</Label>
              <Select value={draftPrazoTipoId} onValueChange={setDraftPrazoTipoId}>
                <SelectTrigger className="h-10 rounded-xl bg-background">
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

            <div className="space-y-1.5">
              <Label htmlFor="prazo-desc" className="text-xs font-semibold">
                Descrição do Prazo <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id="prazo-desc"
                rows={2}
                placeholder="Ex: Apresentar contestação / manifestação..."
                value={draftPrazoDescricao}
                onChange={(e) => setDraftPrazoDescricao(e.target.value)}
                className="resize-none rounded-xl bg-background"
              />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="prazo-principal"
                checked={draftPrazoPrincipal}
                onCheckedChange={(checked) => setDraftPrazoPrincipal(Boolean(checked))}
              />
              <Label htmlFor="prazo-principal" className="text-xs font-semibold cursor-pointer">
                Marcar como Prazo Principal deste controle
              </Label>
            </div>
            <p className="text-[11px] text-muted-foreground pl-6">
              Apenas um prazo ativo pode ser principal. Ele será exibido na listagem com maior
              prioridade.
            </p>
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNovoPrazoModalOpen(false)}
              className="rounded-xl h-10"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSalvarDraftPrazo}
              className="rounded-xl h-10 px-4 bg-primary text-primary-foreground font-semibold"
            >
              Salvar Prazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submodal para Adicionar / Editar Andamento */}
      <Dialog open={andamentoFormOpen} onOpenChange={setAndamentoFormOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {andamentoEmEdicao ? 'Editar Andamento' : 'Novo Andamento / Decisão'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Registre despachos, decisões, reuniões ou notas relevantes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="andamento-data" className="text-xs font-semibold">
                Data do Andamento <span className="text-destructive">*</span>
              </Label>
              <Input
                id="andamento-data"
                type="date"
                value={andamentoData}
                onChange={(e) => setAndamentoData(e.target.value)}
                className="h-10 rounded-xl bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="andamento-desc" className="text-xs font-semibold">
                Descrição <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="andamento-desc"
                rows={4}
                placeholder="Descreva o andamento, decisão judicial, despacho ou nota..."
                value={andamentoDescricao}
                onChange={(e) => setAndamentoDescricao(e.target.value)}
                className="resize-none rounded-xl bg-background"
              />
            </div>
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAndamentoFormOpen(false)}
              className="rounded-xl h-10"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSalvarAndamento}
              className="rounded-xl h-10 px-4 bg-primary text-primary-foreground font-semibold"
            >
              Gravar Andamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de Exclusão de Andamento */}
      <DeleteConfirmDialog
        open={andamentoDeleteConfirmOpen}
        onOpenChange={setAndamentoDeleteConfirmOpen}
        onConfirm={handleConfirmarExclusaoAndamento}
        title="Excluir andamento?"
        description="Tem certeza que deseja excluir apenas este andamento? Os demais itens do histórico deste controle serão preservados."
        confirmButtonText="Excluir Andamento"
      />
    </>
  )
}
