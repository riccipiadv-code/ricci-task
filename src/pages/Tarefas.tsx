import { useState, useMemo } from 'react'
import {
  Plus,
  Search,
  FilterX,
  Calendar,
  Pencil,
  Archive,
  RefreshCw,
  Clock,
  Sparkles,
  Info,
  ChevronDown,
  ChevronRight,
  User,
  AlertTriangle,
  History,
  FileSpreadsheet,
  CalendarClock,
} from 'lucide-react'
import { useControles } from '@/hooks/useControles'
import { TaskControleRecord } from '@/types/task'
import { PageHeader } from '@/components/PageHeader'
import { ControleModal } from '@/components/ControleModal'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import {
  formatDateBR,
  formatDateTimeBR,
  isPrazoOverdue,
  isFollowUpOverdue,
  getStatusBadgeStyle,
} from '@/lib/formatters'
import { cn } from '@/lib/utils'

export default function TarefasPage() {
  const {
    controles,
    statusList,
    tiposPrazoList,
    responsaveisCatalogo,
    usuariosInternos,
    responsaveisOptions,
    loading,
    refreshControles,
    arquivarControle,
  } = useControles()

  const { toast } = useToast()

  // Filtros
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('todos')
  const [responsavelFilter, setResponsavelFilter] = useState<string>('todos')
  const [tipoPrazoFilter, setTipoPrazoFilter] = useState<string>('todos')
  const [prazoFilter, setPrazoFilter] = useState<string>('todos') // todos | vencidos | com_prazo | sem_prazo
  const [followUpFilter, setFollowUpFilter] = useState<string>('todos') // todos | vencidos | com_follow_up | sem_follow_up

  // Linhas expandidas para leitura rápida de providências/andamentos
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  // Modais
  const [modalOpen, setModalOpen] = useState(false)
  const [controleToEdit, setControleToEdit] = useState<TaskControleRecord | null>(null)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [controleToArchive, setControleToArchive] = useState<TaskControleRecord | null>(null)
  const [archiving, setArchiving] = useState(false)

  const toggleRowExpanded = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  // Filtragem
  const filteredControles = useMemo(() => {
    let result = [...controles]

    // 1. Busca textual por Controle Cliente, Controle Ricci e Identificação do Caso
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter((c) => {
        const clienteMatch = c.controle_cliente?.toLowerCase().includes(q)
        const ricciMatch = c.controle_ricci?.toLowerCase().includes(q)
        const casoMatch = c.identificacao_caso.toLowerCase().includes(q)
        return clienteMatch || ricciMatch || casoMatch
      })
    }

    // 2. Filtro por Status
    if (statusFilter !== 'todos') {
      result = result.filter((c) => c.status_id === statusFilter)
    }

    // 3. Filtro por Responsável
    if (responsavelFilter !== 'todos') {
      if (responsavelFilter.startsWith('interno:')) {
        const id = responsavelFilter.replace('interno:', '')
        result = result.filter((c) => c.responsavel_legaldesk_id === id)
      } else if (responsavelFilter.startsWith('catalogo:')) {
        const id = responsavelFilter.replace('catalogo:', '')
        result = result.filter((c) => c.responsavel_id === id)
      }
    }

    // 4. Filtro por Tipo de Prazo
    if (tipoPrazoFilter !== 'todos') {
      result = result.filter((c) => {
        return (c.prazos || []).some((p) => p.ativo && p.tipo_prazo_id === tipoPrazoFilter)
      })
    }

    // 5. Filtro por Prazo (todos | vencidos | com_prazo | sem_prazo)
    if (prazoFilter === 'vencidos') {
      result = result.filter((c) => isPrazoOverdue(c.prazo_destaque?.data_prazo, c.status))
    } else if (prazoFilter === 'com_prazo') {
      result = result.filter((c) => Boolean(c.prazo_destaque))
    } else if (prazoFilter === 'sem_prazo') {
      result = result.filter((c) => !c.prazo_destaque)
    }

    // 6. Filtro por Follow-up (todos | vencidos | com_follow_up | sem_follow_up)
    if (followUpFilter === 'vencidos') {
      result = result.filter((c) => isFollowUpOverdue(c.follow_up, c.status))
    } else if (followUpFilter === 'com_follow_up') {
      result = result.filter((c) => Boolean(c.follow_up))
    } else if (followUpFilter === 'sem_follow_up') {
      result = result.filter((c) => !c.follow_up)
    }

    return result
  }, [
    controles,
    searchQuery,
    statusFilter,
    responsavelFilter,
    tipoPrazoFilter,
    prazoFilter,
    followUpFilter,
  ])

  const handleOpenCreate = () => {
    setControleToEdit(null)
    setModalOpen(true)
  }

  const handleOpenEdit = (controle: TaskControleRecord) => {
    setControleToEdit(controle)
    setModalOpen(true)
  }

  const handleOpenArchiveConfirm = (e: React.MouseEvent, controle: TaskControleRecord) => {
    e.stopPropagation()
    setControleToArchive(controle)
    setArchiveConfirmOpen(true)
  }

  const handleConfirmArchive = async () => {
    if (!controleToArchive) return
    setArchiving(true)
    try {
      await arquivarControle(controleToArchive.id)
      toast({
        title: 'Controle arquivado com sucesso',
        description: `O controle "${controleToArchive.identificacao_caso}" foi arquivado e não aparecerá na tela padrão.`,
      })
      setControleToArchive(null)
      setArchiveConfirmOpen(false)
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao arquivar',
        description: err?.message || 'Falha ao gravar deleted_at no Supabase.',
      })
    } finally {
      setArchiving(false)
    }
  }

  const handleClearFilters = () => {
    setSearchQuery('')
    setStatusFilter('todos')
    setResponsavelFilter('todos')
    setTipoPrazoFilter('todos')
    setPrazoFilter('todos')
    setFollowUpFilter('todos')
  }

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    statusFilter !== 'todos' ||
    responsavelFilter !== 'todos' ||
    tipoPrazoFilter !== 'todos' ||
    prazoFilter !== 'todos' ||
    followUpFilter !== 'todos'

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header da Tela - Renomeado para Controles / Novo Controle */}
      <PageHeader
        title="Controles"
        subtitle="Controles de casos jurídicos com leitura inspirada em planilha"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refreshControles()}
              disabled={loading}
              className="h-10 rounded-xl px-3 border-border hover:bg-muted"
              title="Atualizar dados do Supabase"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>

            <Button
              onClick={handleOpenCreate}
              className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold bg-primary hover:bg-[#4A4AC2] text-primary-foreground shadow-sm transition-transform hover:scale-[1.02]"
            >
              <Plus className="w-4 h-4 mr-2 stroke-[2.5]" />
              Novo Controle
            </Button>
          </div>
        }
      />

      {/* Painel de Filtros e Busca */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-card space-y-4">
        {/* Linha 1: Busca textual */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Buscar por Controle Cliente, Controle Ricci ou Identificação do Caso..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-11 rounded-xl bg-background"
          />
        </div>

        {/* Linha 2: Filtros múltiplos em grade responsiva */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
          {/* Status */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground block">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="todos">Todos os status</SelectItem>
                {statusList.map((st) => (
                  <SelectItem key={st.id} value={st.id}>
                    {st.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Responsável */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground block">
              Responsável
            </label>
            <Select value={responsavelFilter} onValueChange={setResponsavelFilter}>
              <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                <SelectValue placeholder="Responsável" />
              </SelectTrigger>
              <SelectContent className="rounded-xl max-h-72">
                <SelectItem value="todos">Todos os responsáveis</SelectItem>
                {responsaveisOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.nome}{' '}
                    {opt.tipo === 'interno' ? '(Interno)' : `(${opt.tipo || 'Catálogo'})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tipo de Prazo */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground block">
              Tipo de Prazo
            </label>
            <Select value={tipoPrazoFilter} onValueChange={setTipoPrazoFilter}>
              <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                <SelectValue placeholder="Tipo de Prazo" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="todos">Todos os tipos de prazo</SelectItem>
                {tiposPrazoList.map((tp) => (
                  <SelectItem key={tp.id} value={tp.id}>
                    {tp.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Prazo */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground block">
              Prazo Ativo
            </label>
            <Select value={prazoFilter} onValueChange={setPrazoFilter}>
              <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                <SelectValue placeholder="Situação do prazo" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="todos">Todos os prazos</SelectItem>
                <SelectItem value="vencidos">🔴 Prazos Vencidos</SelectItem>
                <SelectItem value="com_prazo">Com prazo ativo</SelectItem>
                <SelectItem value="sem_prazo">Sem prazo cadastrado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Follow-up */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground block">
              Follow-up
            </label>
            <Select value={followUpFilter} onValueChange={setFollowUpFilter}>
              <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                <SelectValue placeholder="Situação follow-up" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="todos">Todos os follow-ups</SelectItem>
                <SelectItem value="vencidos">🟠 Follow-ups Vencidos</SelectItem>
                <SelectItem value="com_follow_up">Com follow-up</SelectItem>
                <SelectItem value="sem_follow_up">Sem follow-up</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Barra de resumo de filtros ativos */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground border-t border-border/60">
            <span>
              Exibindo <strong className="text-foreground">{filteredControles.length}</strong> de{' '}
              {controles.length} controles
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

      {/* Tabela de Controles (Inspirada em planilha, responsiva, com ordem rígida de colunas) */}
      <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                <th className="py-3 px-3 w-8 text-center" aria-label="Expandir"></th>
                {/* 1. Controle Cliente */}
                <th className="py-3 px-3 w-32">Controle Cliente</th>
                {/* 2. Controle Ricci */}
                <th className="py-3 px-3 w-32">Controle Ricci</th>
                {/* 3. Identificação do Caso */}
                <th className="py-3 px-3 min-w-[220px]">Identificação do Caso</th>
                {/* 4. Próxima Providência */}
                <th className="py-3 px-3 min-w-[180px]">Próxima Providência</th>
                {/* 5. Próximo Prazo */}
                <th className="py-3 px-3 w-36">Próximo Prazo</th>
                {/* 6. Status */}
                <th className="py-3 px-3 w-36">Status</th>
                {/* 7. Responsável */}
                <th className="py-3 px-3 w-40">Responsável</th>
                {/* 8. Follow-up */}
                <th className="py-3 px-3 w-28">Follow-up</th>
                {/* 9. Última atualização */}
                <th className="py-3 px-3 w-32">Última Atualização</th>
                {/* Ações */}
                <th className="py-3 px-3 w-20 text-right">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border text-xs">
              {filteredControles.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <FileSpreadsheet className="w-8 h-8 stroke-[1.5] text-muted-foreground/60" />
                      <p className="text-sm font-semibold text-foreground">
                        Nenhum controle encontrado
                      </p>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        {hasActiveFilters
                          ? 'Nenhum registro atende aos filtros atuais. Tente ajustar os parâmetros.'
                          : 'Nenhum controle ativo no Supabase. Clique em "Novo Controle" para começar.'}
                      </p>
                      {hasActiveFilters ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleClearFilters}
                          className="rounded-xl mt-2 text-xs"
                        >
                          Limpar filtros
                        </Button>
                      ) : (
                        <Button
                          onClick={handleOpenCreate}
                          size="sm"
                          className="rounded-xl mt-2 text-xs bg-primary text-primary-foreground"
                        >
                          + Novo Controle
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredControles.map((c) => {
                  const isExpanded = Boolean(expandedRows[c.id])
                  const prazoDestaque = c.prazo_destaque
                  const statusBadge = getStatusBadgeStyle(c.status?.codigo, c.status?.finaliza)

                  // Regras de destaque obrigatórias:
                  // "Destaque prazo vencido em vermelho e follow-up vencido em âmbar."
                  // "Não considere vencido um controle cujo status tenha finaliza = true."
                  const prazoVencido = isPrazoOverdue(prazoDestaque?.data_prazo, c.status)
                  const followUpVencido = isFollowUpOverdue(c.follow_up, c.status)

                  return (
                    <>
                      <tr
                        key={c.id}
                        onClick={() => handleOpenEdit(c)}
                        className={cn(
                          'hover:bg-muted/30 cursor-pointer transition-colors group',
                          isExpanded && 'bg-muted/15',
                        )}
                      >
                        {/* Toggle de expansão da linha */}
                        <td
                          className="py-2.5 px-2 text-center"
                          onClick={(e) => toggleRowExpanded(c.id, e)}
                        >
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-muted text-muted-foreground"
                            aria-label={isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-primary" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        </td>

                        {/* 1. Controle Cliente */}
                        <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                          {c.controle_cliente ? (
                            <span
                              className="truncate block max-w-[120px]"
                              title={c.controle_cliente}
                            >
                              {c.controle_cliente}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* 2. Controle Ricci */}
                        <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                          {c.controle_ricci ? (
                            <span className="truncate block max-w-[120px]" title={c.controle_ricci}>
                              {c.controle_ricci}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* 3. Identificação do Caso (com tooltip se longo) */}
                        <td className="py-2.5 px-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="font-semibold text-foreground group-hover:text-primary transition-colors max-w-[260px] truncate">
                                {c.identificacao_caso}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-md p-3 text-xs leading-relaxed">
                              <p className="font-bold mb-1">Identificação do Caso:</p>
                              <p>{c.identificacao_caso}</p>
                              {c.descricao_status && (
                                <p className="mt-2 text-muted-foreground border-t border-border/40 pt-1">
                                  <strong>Status:</strong> {c.descricao_status}
                                </p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </td>

                        {/* 4. Próxima Providência (texto longo com tooltip para não quebrar a altura) */}
                        <td className="py-2.5 px-3">
                          {c.proximas_providencias ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-muted-foreground truncate block max-w-[200px]">
                                  {c.proximas_providencias}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md p-3 text-xs leading-relaxed">
                                <p className="font-bold mb-1">Próximas Providências:</p>
                                <p className="whitespace-pre-wrap">{c.proximas_providencias}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground/50 italic text-[11px]">
                              Nenhuma
                            </span>
                          )}
                        </td>

                        {/* 5. Próximo Prazo (com destaque vermelho se vencido) */}
                        <td className="py-2.5 px-3">
                          {prazoDestaque ? (
                            <div className="flex flex-col">
                              <span
                                className={cn(
                                  'font-bold flex items-center gap-1',
                                  prazoVencido ? 'text-destructive' : 'text-foreground',
                                )}
                              >
                                {prazoVencido && (
                                  <AlertTriangle className="w-3 h-3 text-destructive" />
                                )}
                                <span>{formatDateBR(prazoDestaque.data_prazo)}</span>
                              </span>
                              <div className="flex items-center gap-1 mt-0.5">
                                {prazoDestaque.principal && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary">
                                    ★ Principal
                                  </span>
                                )}
                                {prazoDestaque.tipo_prazo && (
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                                    {prazoDestaque.tipo_prazo.nome}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* 6. Status (etiquetas discretas) */}
                        <td className="py-2.5 px-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border',
                              statusBadge.bg,
                              statusBadge.text,
                              statusBadge.border,
                            )}
                          >
                            <span className={cn('w-1.5 h-1.5 rounded-full', statusBadge.dot)} />
                            <span className="truncate max-w-[110px]">{c.status?.nome || '—'}</span>
                          </span>
                        </td>

                        {/* 7. Responsável */}
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col">
                            <span
                              className="font-semibold text-foreground truncate max-w-[150px]"
                              title={c.responsavel_nome}
                            >
                              {c.responsavel_nome}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {c.responsavel_tipo_badge}
                            </span>
                          </div>
                        </td>

                        {/* 8. Follow-up (com destaque âmbar se vencido) */}
                        <td className="py-2.5 px-3">
                          {c.follow_up ? (
                            <span
                              className={cn(
                                'font-semibold inline-flex items-center gap-1',
                                followUpVencido
                                  ? 'text-amber-600 dark:text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.2 rounded'
                                  : 'text-muted-foreground',
                              )}
                            >
                              <CalendarClock className="w-3 h-3" />
                              <span>{formatDateBR(c.follow_up)}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* 9. Última atualização */}
                        <td className="py-2.5 px-3 text-muted-foreground text-[11px]">
                          {formatDateTimeBR(c.updated_at)}
                        </td>

                        {/* Ações (Editar & Arquivar) */}
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleOpenEdit(c)
                              }}
                              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                              title="Editar controle"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => handleOpenArchiveConfirm(e, c)}
                              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10"
                              title="Arquivar controle"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* Linha expansível para leitura rápida sem perder os textos longos */}
                      {isExpanded && (
                        <tr className="bg-muted/20 border-b border-border">
                          <td colSpan={11} className="py-4 px-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              {/* Coluna 1: Providências e Detalhe do Status */}
                              <div className="space-y-3 bg-card border border-border/80 rounded-xl p-3.5">
                                <div>
                                  <span className="font-bold text-foreground block mb-1">
                                    Próximas Providências:
                                  </span>
                                  <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                    {c.proximas_providencias || 'Nenhuma providência registrada.'}
                                  </p>
                                </div>

                                {c.descricao_status && (
                                  <div className="border-t border-border/50 pt-2">
                                    <span className="font-bold text-foreground block mb-0.5">
                                      Descrição do Status:
                                    </span>
                                    <p className="text-muted-foreground leading-relaxed">
                                      {c.descricao_status}
                                    </p>
                                  </div>
                                )}
                              </div>

                              {/* Coluna 2: Prazos e Andamentos Recentes */}
                              <div className="space-y-3 bg-card border border-border/80 rounded-xl p-3.5">
                                <div>
                                  <span className="font-bold text-foreground block mb-1">
                                    Prazos Ativos ({c.prazos?.length || 0}):
                                  </span>
                                  {!c.prazos || c.prazos.length === 0 ? (
                                    <p className="text-muted-foreground italic">
                                      Nenhum prazo cadastrado.
                                    </p>
                                  ) : (
                                    <div className="space-y-1">
                                      {c.prazos.map((p) => (
                                        <div
                                          key={p.id}
                                          className="flex items-center justify-between text-[11px] py-1 border-b border-border/30 last:border-0"
                                        >
                                          <div className="flex items-center gap-1.5">
                                            {p.principal && (
                                              <span className="text-primary font-bold">★</span>
                                            )}
                                            <span className="font-semibold text-foreground">
                                              {formatDateBR(p.data_prazo)}
                                            </span>
                                            {p.tipo_prazo && (
                                              <span className="text-muted-foreground">
                                                ({p.tipo_prazo.nome})
                                              </span>
                                            )}
                                          </div>
                                          {p.descricao && (
                                            <span className="text-muted-foreground truncate max-w-[200px]">
                                              {p.descricao}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <div className="pt-2 border-t border-border/50 flex justify-end">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenEdit(c)}
                                    className="h-8 text-xs rounded-lg"
                                  >
                                    Ver histórico completo de andamentos & prazos
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Criação / Edição de Controle */}
      <ControleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        controleToEdit={controleToEdit}
        statusList={statusList}
        tiposPrazoList={tiposPrazoList}
        responsaveisCatalogo={responsaveisCatalogo}
        usuariosInternos={usuariosInternos}
        onSaved={() => {
          refreshControles()
        }}
      />

      {/* Confirmação de Arquivamento (Troca a ação Excluir por Arquivar com deleted_at) */}
      <DeleteConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        onConfirm={handleConfirmArchive}
        title="Arquivar controle de caso?"
        description={`Deseja arquivar o controle "${controleToArchive?.identificacao_caso}"? O registro será preservado no banco de dados com histórico completo, mas não aparecerá na listagem padrão.`}
        confirmButtonText={archiving ? 'Arquivando...' : 'Arquivar Controle'}
      />
    </div>
  )
}
