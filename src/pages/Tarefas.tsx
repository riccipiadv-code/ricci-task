import React, { useState, useEffect, useMemo } from 'react'
import {
  Plus,
  Search,
  FilterX,
  SlidersHorizontal,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Pencil,
  Archive,
  Calendar,
  Clock,
  CalendarClock,
  AlertTriangle,
  FileSpreadsheet,
  X,
  Layers,
  CheckCircle2,
  ListFilter,
  User,
  Info,
} from 'lucide-react'
import { useControles } from '@/hooks/useControles'
import { TaskControleRecord } from '@/types/task'
import { PageHeader } from '@/components/PageHeader'
import { ControleModal } from '@/components/ControleModal'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import {
  formatDateBR,
  formatDateTimeBR,
  isPrazoOverdue,
  isFollowUpOverdue,
  isToday,
  getStatusBadgeStyle,
} from '@/lib/formatters'
import { cn } from '@/lib/utils'

// Remove acentos e normaliza para caixa baixa
function normalizeText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

type PrazoSituacaoFilter =
  | 'todos'
  | 'vencidos'
  | 'hoje'
  | 'proximos_7_dias'
  | 'com_prazo'
  | 'sem_prazo'

type FollowUpSituacaoFilter =
  | 'todos'
  | 'vencidos'
  | 'hoje'
  | 'proximos_7_dias'
  | 'com_follow_up'
  | 'sem_follow_up'

type OrdenacaoOption =
  | 'urgentes'
  | 'prazo_proximo'
  | 'follow_up_proximo'
  | 'atualizados_recentemente'
  | 'controle_cliente'
  | 'controle_ricci'

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

  // Estado dos filtros
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedControles, setSelectedControles] = useState<string[]>([]) // filtro por Nome do Controle (quando > 1)
  const [statusFilter, setStatusFilter] = useState<string>('todos')
  const [responsavelFilter, setResponsavelFilter] = useState<string>('todos')
  const [tipoPrazoFilter, setTipoPrazoFilter] = useState<string>('todos')
  const [prazoSituacao, setPrazoSituacao] = useState<PrazoSituacaoFilter>('todos')
  const [followUpSituacao, setFollowUpSituacao] = useState<FollowUpSituacaoFilter>('todos')
  const [ordenacao, setOrdenacao] = useState<OrdenacaoOption>('urgentes')

  // Controle de abertura do popover de mais filtros (desktop) e sheet (mobile)
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [mobileFilterSheetOpen, setMobileFilterSheetOpen] = useState(false)

  // Grupos recolhidos (por nome_controle). false ou undefined = aberto; true = recolhido
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // Linhas expandidas (detalhes rápidos do caso)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  // Modais de edição/criação e arquivamento
  const [modalOpen, setModalOpen] = useState(false)
  const [controleToEdit, setControleToEdit] = useState<TaskControleRecord | null>(null)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [controleToArchive, setControleToArchive] = useState<TaskControleRecord | null>(null)
  const [archiving, setArchiving] = useState(false)

  // Debounce na busca textual (250ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput)
    }, 250)
    return () => clearTimeout(handler)
  }, [searchInput])

  // Lista única e ordenada de todos os "Nome do Controle" existentes no acervo
  const allNomesControle = useMemo(() => {
    const set = new Set<string>()
    for (const c of controles) {
      if (c.nome_controle && c.nome_controle.trim()) {
        set.add(c.nome_controle.trim())
      } else {
        set.add('Sem Controle Definido')
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [controles])

  // Alterna grupo individual
  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }))
  }

  // Alterna todos os grupos (expandir todos ou recolher todos)
  const toggleAllGroups = (collapse: boolean) => {
    const next: Record<string, boolean> = {}
    allNomesControle.forEach((name) => {
      next[name] = collapse
    })
    setCollapsedGroups(next)
  }

  // Alterna linha expandida (detalhe rápido sem disparar formulário)
  const toggleRowExpanded = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  // Limpeza de todos os filtros
  const handleClearFilters = () => {
    setSearchInput('')
    setDebouncedSearch('')
    setSelectedControles([])
    setStatusFilter('todos')
    setResponsavelFilter('todos')
    setTipoPrazoFilter('todos')
    setPrazoSituacao('todos')
    setFollowUpSituacao('todos')
    setOrdenacao('urgentes')
  }

  // Helper de cálculo de datas para filtros
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const next7DaysStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().split('T')[0]
  }, [])

  // Filtragem e Ordenação
  const filteredControles = useMemo(() => {
    let list = [...controles]

    // 1. Busca textual ampla e sem distinção de acento/caixa
    // Considera: Nome do Controle, Controle Cliente, Controle Ricci, Identificação do Caso,
    // Próximas Providências, Status e Responsável
    if (debouncedSearch.trim()) {
      const q = normalizeText(debouncedSearch)
      list = list.filter((c) => {
        const nomeNorm = normalizeText(c.nome_controle)
        const clienteNorm = normalizeText(c.controle_cliente)
        const ricciNorm = normalizeText(c.controle_ricci)
        const casoNorm = normalizeText(c.identificacao_caso)
        const provNorm = normalizeText(c.proximas_providencias)
        const statusNorm = normalizeText(c.status?.nome)
        const respNorm = normalizeText(c.responsavel_nome)
        return (
          nomeNorm.includes(q) ||
          clienteNorm.includes(q) ||
          ricciNorm.includes(q) ||
          casoNorm.includes(q) ||
          provNorm.includes(q) ||
          statusNorm.includes(q) ||
          respNorm.includes(q)
        )
      })
    }

    // 2. Filtro por Controle (seleção múltipla quando > 1)
    if (selectedControles.length > 0) {
      list = list.filter((c) => {
        const groupName = c.nome_controle?.trim() || 'Sem Controle Definido'
        return selectedControles.includes(groupName)
      })
    }

    // 3. Filtro por Status
    if (statusFilter !== 'todos') {
      list = list.filter((c) => c.status_id === statusFilter)
    }

    // 4. Filtro por Responsável
    if (responsavelFilter !== 'todos') {
      if (responsavelFilter.startsWith('interno:')) {
        const id = responsavelFilter.replace('interno:', '')
        list = list.filter((c) => c.responsavel_legaldesk_id === id)
      } else if (responsavelFilter.startsWith('catalogo:')) {
        const id = responsavelFilter.replace('catalogo:', '')
        list = list.filter((c) => c.responsavel_id === id)
      }
    }

    // 5. Filtro por Tipo de Prazo
    if (tipoPrazoFilter !== 'todos') {
      list = list.filter((c) => {
        return (c.prazos || []).some((p) => p.ativo && p.tipo_prazo_id === tipoPrazoFilter)
      })
    }

    // 6. Situação do Prazo:
    // Todos | Vencidos | Vencem hoje | Próximos 7 dias | Com prazo ativo | Sem prazo
    if (prazoSituacao === 'vencidos') {
      list = list.filter((c) => isPrazoOverdue(c.prazo_destaque?.data_prazo, c.status))
    } else if (prazoSituacao === 'hoje') {
      list = list.filter((c) => isToday(c.prazo_destaque?.data_prazo))
    } else if (prazoSituacao === 'proximos_7_dias') {
      list = list.filter((c) => {
        const dt = c.prazo_destaque?.data_prazo?.split('T')[0]
        if (!dt) return false
        return dt >= todayStr && dt <= next7DaysStr
      })
    } else if (prazoSituacao === 'com_prazo') {
      list = list.filter((c) => Boolean(c.prazo_destaque))
    } else if (prazoSituacao === 'sem_prazo') {
      list = list.filter((c) => !c.prazo_destaque)
    }

    // 7. Situação do Follow-up:
    // Todos | Vencidos | Hoje | Próximos 7 dias | Com follow-up | Sem follow-up
    if (followUpSituacao === 'vencidos') {
      list = list.filter((c) => isFollowUpOverdue(c.follow_up, c.status))
    } else if (followUpSituacao === 'hoje') {
      list = list.filter((c) => isToday(c.follow_up))
    } else if (followUpSituacao === 'proximos_7_dias') {
      list = list.filter((c) => {
        const dt = c.follow_up?.split('T')[0]
        if (!dt) return false
        return dt >= todayStr && dt <= next7DaysStr
      })
    } else if (followUpSituacao === 'com_follow_up') {
      list = list.filter((c) => Boolean(c.follow_up))
    } else if (followUpSituacao === 'sem_follow_up') {
      list = list.filter((c) => !c.follow_up)
    }

    // 8. Ordenação dentro dos dados
    list.sort((a, b) => {
      if (ordenacao === 'urgentes') {
        // Prazos vencidos primeiro, depois follow-up vencido, depois prazos mais próximos
        const aPrazoVenc = isPrazoOverdue(a.prazo_destaque?.data_prazo, a.status)
        const bPrazoVenc = isPrazoOverdue(b.prazo_destaque?.data_prazo, b.status)
        if (aPrazoVenc !== bPrazoVenc) return aPrazoVenc ? -1 : 1

        const aFollowVenc = isFollowUpOverdue(a.follow_up, a.status)
        const bFollowVenc = isFollowUpOverdue(b.follow_up, b.status)
        if (aFollowVenc !== bFollowVenc) return aFollowVenc ? -1 : 1

        const aDate = a.prazo_destaque?.data_prazo || '9999-12-31'
        const bDate = b.prazo_destaque?.data_prazo || '9999-12-31'
        if (aDate !== bDate) return aDate.localeCompare(bDate)

        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }

      if (ordenacao === 'prazo_proximo') {
        const aDate = a.prazo_destaque?.data_prazo || '9999-12-31'
        const bDate = b.prazo_destaque?.data_prazo || '9999-12-31'
        return aDate.localeCompare(bDate)
      }

      if (ordenacao === 'follow_up_proximo') {
        const aDate = a.follow_up || '9999-12-31'
        const bDate = b.follow_up || '9999-12-31'
        return aDate.localeCompare(bDate)
      }

      if (ordenacao === 'atualizados_recentemente') {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }

      if (ordenacao === 'controle_cliente') {
        const aCode = a.controle_cliente || 'ZZZZZZ'
        const bCode = b.controle_cliente || 'ZZZZZZ'
        return aCode.localeCompare(bCode, 'pt-BR', { numeric: true })
      }

      if (ordenacao === 'controle_ricci') {
        const aCode = a.controle_ricci || 'ZZZZZZ'
        const bCode = b.controle_ricci || 'ZZZZZZ'
        return aCode.localeCompare(bCode, 'pt-BR', { numeric: true })
      }

      return 0
    })

    return list
  }, [
    controles,
    debouncedSearch,
    selectedControles,
    statusFilter,
    responsavelFilter,
    tipoPrazoFilter,
    prazoSituacao,
    followUpSituacao,
    ordenacao,
    todayStr,
    next7DaysStr,
  ])

  // Agrupamento dos controles filtrados por `nome_controle`
  const groupedControles = useMemo(() => {
    const map = new Map<string, TaskControleRecord[]>()

    // Ordem previsível: grupos ordenados alfabeticamente
    for (const item of filteredControles) {
      const groupName = item.nome_controle?.trim() || 'Sem Controle Definido'
      const existing = map.get(groupName) || []
      existing.push(item)
      map.set(groupName, existing)
    }

    const groups: { nome: string; items: TaskControleRecord[] }[] = []
    // Ordena os nomes dos grupos
    const sortedGroupNames = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    for (const name of sortedGroupNames) {
      groups.push({
        nome: name,
        items: map.get(name) || [],
      })
    }
    return groups
  }, [filteredControles])

  // Flag e contagem de filtros ativos
  const hasActiveFilters = useMemo(() => {
    return (
      searchInput.trim() !== '' ||
      selectedControles.length > 0 ||
      statusFilter !== 'todos' ||
      responsavelFilter !== 'todos' ||
      tipoPrazoFilter !== 'todos' ||
      prazoSituacao !== 'todos' ||
      followUpSituacao !== 'todos' ||
      ordenacao !== 'urgentes'
    )
  }, [
    searchInput,
    selectedControles,
    statusFilter,
    responsavelFilter,
    tipoPrazoFilter,
    prazoSituacao,
    followUpSituacao,
    ordenacao,
  ])

  // Quantidade de filtros avançados ativos (para a badge no botão "Mais filtros")
  const advancedFiltersCount = useMemo(() => {
    let count = 0
    if (tipoPrazoFilter !== 'todos') count++
    if (prazoSituacao !== 'todos') count++
    if (followUpSituacao !== 'todos') count++
    if (ordenacao !== 'urgentes') count++
    return count
  }, [tipoPrazoFilter, prazoSituacao, followUpSituacao, ordenacao])

  // Resolução de nomes dos filtros ativos para os chips
  const activeFilterChips = useMemo(() => {
    const chips: { id: string; label: string; onRemove: () => void }[] = []

    if (searchInput.trim()) {
      chips.push({
        id: 'search',
        label: `Busca: "${searchInput.trim()}"`,
        onRemove: () => {
          setSearchInput('')
          setDebouncedSearch('')
        },
      })
    }

    if (selectedControles.length > 0) {
      selectedControles.forEach((sc) => {
        chips.push({
          id: `controle:${sc}`,
          label: `Controle: ${sc}`,
          onRemove: () => {
            setSelectedControles((prev) => prev.filter((item) => item !== sc))
          },
        })
      })
    }

    if (statusFilter !== 'todos') {
      const st = statusList.find((s) => s.id === statusFilter)
      chips.push({
        id: 'status',
        label: `Status: ${st?.nome || statusFilter}`,
        onRemove: () => setStatusFilter('todos'),
      })
    }

    if (responsavelFilter !== 'todos') {
      const resp = responsaveisOptions.find((r) => r.value === responsavelFilter)
      chips.push({
        id: 'responsavel',
        label: `Resp.: ${resp?.nome || responsavelFilter}`,
        onRemove: () => setResponsavelFilter('todos'),
      })
    }

    if (tipoPrazoFilter !== 'todos') {
      const tp = tiposPrazoList.find((t) => t.id === tipoPrazoFilter)
      chips.push({
        id: 'tipoPrazo',
        label: `Tipo: ${tp?.nome || tipoPrazoFilter}`,
        onRemove: () => setTipoPrazoFilter('todos'),
      })
    }

    if (prazoSituacao !== 'todos') {
      const labels: Record<PrazoSituacaoFilter, string> = {
        todos: '',
        vencidos: 'Prazo: Vencidos',
        hoje: 'Prazo: Vencem hoje',
        proximos_7_dias: 'Prazo: Próximos 7 dias',
        com_prazo: 'Prazo: Com prazo ativo',
        sem_prazo: 'Prazo: Sem prazo',
      }
      chips.push({
        id: 'prazoSituacao',
        label: labels[prazoSituacao],
        onRemove: () => setPrazoSituacao('todos'),
      })
    }

    if (followUpSituacao !== 'todos') {
      const labels: Record<FollowUpSituacaoFilter, string> = {
        todos: '',
        vencidos: 'Follow-up: Vencidos',
        hoje: 'Follow-up: Hoje',
        proximos_7_dias: 'Follow-up: Próximos 7 dias',
        com_follow_up: 'Follow-up: Com follow-up',
        sem_follow_up: 'Follow-up: Sem follow-up',
      }
      chips.push({
        id: 'followUpSituacao',
        label: labels[followUpSituacao],
        onRemove: () => setFollowUpSituacao('todos'),
      })
    }

    if (ordenacao !== 'urgentes') {
      const labels: Record<OrdenacaoOption, string> = {
        urgentes: '',
        prazo_proximo: 'Ordem: Prazo mais próximo',
        follow_up_proximo: 'Ordem: Follow-up mais próximo',
        atualizados_recentemente: 'Ordem: Atualizados recentemente',
        controle_cliente: 'Ordem: Controle Cliente',
        controle_ricci: 'Ordem: Controle Ricci',
      }
      chips.push({
        id: 'ordenacao',
        label: labels[ordenacao],
        onRemove: () => setOrdenacao('urgentes'),
      })
    }

    return chips
  }, [
    searchInput,
    selectedControles,
    statusFilter,
    responsavelFilter,
    tipoPrazoFilter,
    prazoSituacao,
    followUpSituacao,
    ordenacao,
    statusList,
    responsaveisOptions,
    tiposPrazoList,
  ])

  // Modais de Criação e Edição
  const handleOpenCreate = () => {
    setControleToEdit(null)
    setModalOpen(true)
  }

  const handleOpenEdit = (controle: TaskControleRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setControleToEdit(controle)
    setModalOpen(true)
  }

  // Confirmação de Arquivamento
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
        description: `O caso "${controleToArchive.identificacao_caso}" foi arquivado e não aparecerá na listagem padrão.`,
      })
      setControleToArchive(null)
      setArchiveConfirmOpen(false)
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao arquivar',
        description: err?.message || 'Falha ao registrar deleted_at no Supabase.',
      })
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in w-full min-w-0">
      {/* Header da Tela */}
      <PageHeader
        title="Controles"
        subtitle="Gerenciamento de casos jurídicos agrupados por controle com visão ampla"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refreshControles()}
              disabled={loading}
              className="h-10 rounded-xl px-3 border-border hover:bg-muted"
              title="Sincronizar com o Supabase"
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

      {/* ========================================================================= */}
      {/* PAINEL DE BUSCA E FILTROS COMPACTO                                       */}
      {/* ========================================================================= */}
      <div className="bg-card border border-border rounded-2xl p-3.5 sm:p-4 shadow-card space-y-3 w-full">
        {/* Linha Principal de Filtros */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5">
          {/* Campo de Busca ocupando a maior parte da largura */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Buscar por caso, códigos Cliente/Ricci, providências, responsável ou status..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-8 h-10 rounded-xl bg-background text-xs sm:text-sm"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('')
                  setDebouncedSearch('')
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded"
                title="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filtros da Linha Principal (Desktop / Tablets) */}
          <div className="hidden sm:flex items-center gap-2 flex-wrap lg:flex-nowrap shrink-0">
            {/* Filtro: Controle (quando houver mais de um nome de controle no acervo) */}
            {allNomesControle.length > 1 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-10 rounded-xl text-xs font-medium px-3 bg-background border-border flex items-center gap-1.5 max-w-[200px]',
                      selectedControles.length > 0 &&
                        'border-primary/60 bg-primary/5 text-primary font-semibold',
                    )}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {selectedControles.length === 0
                        ? 'Controle'
                        : selectedControles.length === 1
                          ? selectedControles[0]
                          : `${selectedControles.length} controles`}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 shrink-0 ml-auto opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2 rounded-xl" align="start">
                  <div className="text-xs font-semibold px-2 py-1.5 text-muted-foreground border-b border-border mb-1 flex items-center justify-between">
                    <span>Filtrar por Controle</span>
                    {selectedControles.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedControles([])}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1 py-1">
                    {allNomesControle.map((nome) => {
                      const isSelected = selectedControles.includes(nome)
                      return (
                        <button
                          key={nome}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedControles((prev) => prev.filter((i) => i !== nome))
                            } else {
                              setSelectedControles((prev) => [...prev, nome])
                            }
                          }}
                          className={cn(
                            'w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors',
                            isSelected
                              ? 'bg-primary/10 text-primary font-semibold'
                              : 'hover:bg-muted text-foreground',
                          )}
                        >
                          <span className="truncate">{nome}</span>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Filtro: Status */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className={cn(
                  'h-10 rounded-xl bg-background text-xs w-[150px] shrink-0',
                  statusFilter !== 'todos' &&
                    'border-primary/60 bg-primary/5 text-primary font-semibold',
                )}
              >
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

            {/* Filtro: Responsável */}
            <Select value={responsavelFilter} onValueChange={setResponsavelFilter}>
              <SelectTrigger
                className={cn(
                  'h-10 rounded-xl bg-background text-xs w-[170px] shrink-0',
                  responsavelFilter !== 'todos' &&
                    'border-primary/60 bg-primary/5 text-primary font-semibold',
                )}
              >
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

            {/* Botão: Mais Filtros (Popover com Tipo de Prazo, Situação Prazo, Situação Follow-up, Ordenação) */}
            <Popover open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-10 rounded-xl text-xs px-3 bg-background border-border flex items-center gap-1.5',
                    advancedFiltersCount > 0 &&
                      'border-primary/60 bg-primary/5 text-primary font-semibold',
                  )}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Mais filtros</span>
                  {advancedFiltersCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="h-5 px-1.5 text-[10px] rounded-full bg-primary text-primary-foreground font-bold"
                    >
                      {advancedFiltersCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-4 rounded-2xl shadow-xl space-y-3.5" align="end">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                    <span>Filtros Adicionais</span>
                  </span>
                  {advancedFiltersCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTipoPrazoFilter('todos')
                        setPrazoSituacao('todos')
                        setFollowUpSituacao('todos')
                        setOrdenacao('urgentes')
                      }}
                      className="text-[11px] text-primary hover:underline font-medium"
                    >
                      Resetar
                    </button>
                  )}
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

                {/* Situação do Prazo */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground block">
                    Situação do Prazo
                  </label>
                  <Select
                    value={prazoSituacao}
                    onValueChange={(val: PrazoSituacaoFilter) => setPrazoSituacao(val)}
                  >
                    <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                      <SelectValue placeholder="Situação do prazo" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="todos">Todos os prazos</SelectItem>
                      <SelectItem value="vencidos">Prazos vencidos</SelectItem>
                      <SelectItem value="hoje">Vencem hoje</SelectItem>
                      <SelectItem value="proximos_7_dias">Próximos 7 dias</SelectItem>
                      <SelectItem value="com_prazo">Com prazo ativo</SelectItem>
                      <SelectItem value="sem_prazo">Sem prazo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Situação do Follow-up */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground block">
                    Situação do Follow-up
                  </label>
                  <Select
                    value={followUpSituacao}
                    onValueChange={(val: FollowUpSituacaoFilter) => setFollowUpSituacao(val)}
                  >
                    <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                      <SelectValue placeholder="Situação do follow-up" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="todos">Todos os follow-ups</SelectItem>
                      <SelectItem value="vencidos">Follow-up vencido</SelectItem>
                      <SelectItem value="hoje">Hoje</SelectItem>
                      <SelectItem value="proximos_7_dias">Próximos 7 dias</SelectItem>
                      <SelectItem value="com_follow_up">Com follow-up</SelectItem>
                      <SelectItem value="sem_follow_up">Sem follow-up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Ordenação */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground block">
                    Ordenação dos Casos
                  </label>
                  <Select
                    value={ordenacao}
                    onValueChange={(val: OrdenacaoOption) => setOrdenacao(val)}
                  >
                    <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                      <SelectValue placeholder="Ordenação" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="urgentes">Mais urgentes (padrão)</SelectItem>
                      <SelectItem value="prazo_proximo">Prazo mais próximo</SelectItem>
                      <SelectItem value="follow_up_proximo">Follow-up mais próximo</SelectItem>
                      <SelectItem value="atualizados_recentemente">
                        Atualizados recentemente
                      </SelectItem>
                      <SelectItem value="controle_cliente">Controle Cliente</SelectItem>
                      <SelectItem value="controle_ricci">Controle Ricci</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </PopoverContent>
            </Popover>

            {/* Botão Limpar (visível apenas quando houver filtro ativo) */}
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-10 text-xs text-muted-foreground hover:text-foreground font-medium px-2.5 rounded-xl"
                title="Limpar todos os filtros"
              >
                <FilterX className="w-3.5 h-3.5 mr-1" />
                Limpar
              </Button>
            )}
          </div>

          {/* Botão para abrir Filtros no Mobile */}
          <div className="sm:hidden flex items-center justify-between gap-2 pt-1">
            <Sheet open={mobileFilterSheetOpen} onOpenChange={setMobileFilterSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-9 rounded-xl text-xs flex items-center justify-center gap-1.5"
                >
                  <ListFilter className="w-3.5 h-3.5" />
                  <span>Filtros e Ordenação</span>
                  {hasActiveFilters && (
                    <Badge variant="secondary" className="h-4 px-1 text-[9px] rounded-full">
                      {activeFilterChips.length}
                    </Badge>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="rounded-t-2xl max-h-[85vh] overflow-y-auto p-5"
              >
                <SheetHeader className="text-left pb-3 border-b border-border">
                  <SheetTitle className="text-base font-bold flex items-center gap-2">
                    <ListFilter className="w-4 h-4 text-primary" />
                    <span>Filtros de Controles</span>
                  </SheetTitle>
                </SheetHeader>

                <div className="space-y-4 py-4 text-xs">
                  {/* Controle */}
                  {allNomesControle.length > 1 && (
                    <div className="space-y-1.5">
                      <label className="font-semibold text-foreground">Nome do Controle</label>
                      <div className="max-h-36 overflow-y-auto space-y-1 border border-border rounded-xl p-2 bg-background">
                        {allNomesControle.map((nome) => {
                          const isSel = selectedControles.includes(nome)
                          return (
                            <button
                              key={nome}
                              type="button"
                              onClick={() => {
                                if (isSel) {
                                  setSelectedControles((prev) => prev.filter((i) => i !== nome))
                                } else {
                                  setSelectedControles((prev) => [...prev, nome])
                                }
                              }}
                              className={cn(
                                'w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between',
                                isSel
                                  ? 'bg-primary/10 text-primary font-semibold'
                                  : 'hover:bg-muted text-foreground',
                              )}
                            >
                              <span className="truncate">{nome}</span>
                              {isSel && <CheckCircle2 className="w-3.5 h-3.5" />}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Status */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Status</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
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
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Responsável</label>
                    <Select value={responsavelFilter} onValueChange={setResponsavelFilter}>
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
                        <SelectValue placeholder="Responsável" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl max-h-60">
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
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Tipo de Prazo</label>
                    <Select value={tipoPrazoFilter} onValueChange={setTipoPrazoFilter}>
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
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

                  {/* Situação do Prazo */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Situação do Prazo</label>
                    <Select
                      value={prazoSituacao}
                      onValueChange={(val: PrazoSituacaoFilter) => setPrazoSituacao(val)}
                    >
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
                        <SelectValue placeholder="Situação do prazo" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="todos">Todos os prazos</SelectItem>
                        <SelectItem value="vencidos">Prazos vencidos</SelectItem>
                        <SelectItem value="hoje">Vencem hoje</SelectItem>
                        <SelectItem value="proximos_7_dias">Próximos 7 dias</SelectItem>
                        <SelectItem value="com_prazo">Com prazo ativo</SelectItem>
                        <SelectItem value="sem_prazo">Sem prazo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Situação do Follow-up */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Situação do Follow-up</label>
                    <Select
                      value={followUpSituacao}
                      onValueChange={(val: FollowUpSituacaoFilter) => setFollowUpSituacao(val)}
                    >
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
                        <SelectValue placeholder="Situação do follow-up" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="todos">Todos os follow-ups</SelectItem>
                        <SelectItem value="vencidos">Follow-up vencido</SelectItem>
                        <SelectItem value="hoje">Hoje</SelectItem>
                        <SelectItem value="proximos_7_dias">Próximos 7 dias</SelectItem>
                        <SelectItem value="com_follow_up">Com follow-up</SelectItem>
                        <SelectItem value="sem_follow_up">Sem follow-up</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Ordenação */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Ordenação</label>
                    <Select
                      value={ordenacao}
                      onValueChange={(val: OrdenacaoOption) => setOrdenacao(val)}
                    >
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
                        <SelectValue placeholder="Ordenação" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="urgentes">Mais urgentes (padrão)</SelectItem>
                        <SelectItem value="prazo_proximo">Prazo mais próximo</SelectItem>
                        <SelectItem value="follow_up_proximo">Follow-up mais próximo</SelectItem>
                        <SelectItem value="atualizados_recentemente">
                          Atualizados recentemente
                        </SelectItem>
                        <SelectItem value="controle_cliente">Controle Cliente</SelectItem>
                        <SelectItem value="controle_ricci">Controle Ricci</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClearFilters}
                    className="flex-1 h-10 rounded-xl text-xs"
                  >
                    Limpar
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setMobileFilterSheetOpen(false)}
                    className="flex-1 h-10 rounded-xl text-xs bg-primary text-primary-foreground font-semibold"
                  >
                    Aplicar
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-9 text-xs text-primary font-medium px-2 rounded-xl"
              >
                Limpar
              </Button>
            )}
          </div>
        </div>

        {/* Chips de Filtros Ativos e Contagem "X de Y controles" */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50 text-xs">
          {/* Contagem sempre visível: "X de Y controles" */}
          <div className="flex items-center gap-2 text-muted-foreground font-medium">
            <span>
              Exibindo <strong className="text-foreground">{filteredControles.length}</strong> de{' '}
              <strong className="text-foreground">{controles.length}</strong> controles
            </span>
            {groupedControles.length > 1 && (
              <span className="hidden sm:inline-block text-muted-foreground/60">•</span>
            )}
            {groupedControles.length > 1 && (
              <span className="hidden sm:inline-block">
                em <strong className="text-foreground">{groupedControles.length}</strong> grupos
              </span>
            )}
          </div>

          {/* Ações globais de expandir/recolher grupos */}
          {groupedControles.length > 1 && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => toggleAllGroups(false)}
                className="hover:text-primary transition-colors hover:underline"
              >
                Expandir grupos
              </button>
              <span>/</span>
              <button
                type="button"
                onClick={() => toggleAllGroups(true)}
                className="hover:text-primary transition-colors hover:underline"
              >
                Recolher grupos
              </button>
            </div>
          )}
        </div>

        {/* Lista de chips removíveis se houver filtros ativos */}
        {activeFilterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {activeFilterChips.map((chip) => (
              <span
                key={chip.id}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 animate-fade-in"
              >
                <span className="truncate max-w-[220px]">{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  className="p-0.5 rounded-full hover:bg-primary/20 text-primary transition-colors"
                  title="Remover filtro"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* CORPO: CASO VAZIO OU LISTAGEM AGRUPADA (DESKTOP TABELA + MOBILE CARDS)   */}
      {/* ========================================================================= */}
      {filteredControles.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-10 sm:p-14 text-center shadow-card space-y-3 w-full">
          <div className="h-12 w-12 rounded-2xl bg-muted/60 text-muted-foreground mx-auto flex items-center justify-center">
            <FileSpreadsheet className="w-6 h-6 stroke-[1.5]" />
          </div>
          <p className="text-base font-bold text-foreground">Nenhum controle encontrado</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {hasActiveFilters
              ? 'Nenhum registro atende aos filtros atuais. Tente ajustar os parâmetros ou limpe os filtros para visualizar o acervo completo.'
              : 'Nenhum controle ativo registrado no Supabase. Clique em "Novo Controle" para iniciar o acompanhamento.'}
          </p>
          {hasActiveFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="rounded-xl mt-2 text-xs"
            >
              <FilterX className="w-3.5 h-3.5 mr-1.5" />
              Limpar filtros
            </Button>
          ) : (
            <Button
              onClick={handleOpenCreate}
              size="sm"
              className="rounded-xl mt-2 text-xs bg-primary text-primary-foreground font-semibold"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Novo Controle
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5 w-full">
          {groupedControles.map((group) => {
            const isGroupCollapsed = Boolean(collapsedGroups[group.nome])

            return (
              <div
                key={group.nome}
                className="bg-card border border-border rounded-2xl shadow-card overflow-hidden transition-all duration-200"
              >
                {/* Cabeçalho do Grupo por Nome do Controle */}
                <div
                  onClick={() => toggleGroupCollapse(group.nome)}
                  className="px-4 py-3 sm:px-5 sm:py-3.5 bg-muted/40 hover:bg-muted/60 cursor-pointer border-b border-border/80 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      className="p-1 rounded-md text-muted-foreground hover:text-foreground shrink-0"
                      aria-label={isGroupCollapsed ? 'Expandir grupo' : 'Recolher grupo'}
                    >
                      {isGroupCollapsed ? (
                        <ChevronRight className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-primary" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <h2
                        className="text-sm font-bold text-foreground truncate leading-tight"
                        title={group.nome}
                      >
                        {group.nome}
                      </h2>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <Badge
                      variant="secondary"
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-background border border-border/70 text-foreground"
                    >
                      {group.items.length} {group.items.length === 1 ? 'caso' : 'casos'}
                    </Badge>
                  </div>
                </div>

                {/* Conteúdo do Grupo quando não recolhido */}
                {!isGroupCollapsed && (
                  <>
                    {/* VISUALIZAÇÃO DESKTOP / TABLET (Tabela com 11 colunas na ordem estrita) */}
                    <div className="hidden md:block overflow-x-auto w-full">
                      <table className="w-full text-left border-collapse table-fixed min-w-[1240px]">
                        <thead>
                          <tr className="border-b border-border/80 bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase tracking-wider sticky top-0 z-10 backdrop-blur-md">
                            {/* 1. Expandir */}
                            <th
                              className="py-2.5 px-2.5 w-10 text-center"
                              aria-label="Expandir"
                            ></th>
                            {/* 2. Controle Cliente */}
                            <th className="py-2.5 px-3 w-32">Controle Cliente</th>
                            {/* 3. Controle Ricci */}
                            <th className="py-2.5 px-3 w-32">Controle Ricci</th>
                            {/* 4. Identificação do Caso (maior largura) */}
                            <th className="py-2.5 px-3 w-[260px] lg:w-[320px]">
                              Identificação do Caso
                            </th>
                            {/* 5. Próxima Providência (maior largura) */}
                            <th className="py-2.5 px-3 w-[240px] lg:w-[300px]">
                              Próxima Providência
                            </th>
                            {/* 6. Próximo Prazo */}
                            <th className="py-2.5 px-3 w-36">Próximo Prazo</th>
                            {/* 7. Status */}
                            <th className="py-2.5 px-3 w-36">Status</th>
                            {/* 8. Responsável */}
                            <th className="py-2.5 px-3 w-40">Responsável</th>
                            {/* 9. Follow-up */}
                            <th className="py-2.5 px-3 w-32">Follow-up</th>
                            {/* 10. Última Atualização */}
                            <th className="py-2.5 px-3 w-36">Última Atualização</th>
                            {/* 11. Ações (fixa à direita em rolagem se overflow) */}
                            <th className="py-2.5 px-3 w-24 text-right sticky right-0 bg-muted/30 backdrop-blur-md z-20">
                              Ações
                            </th>
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-border/60 text-xs">
                          {group.items.map((c) => {
                            const isExpanded = Boolean(expandedRows[c.id])
                            const prazoDestaque = c.prazo_destaque
                            const statusBadge = getStatusBadgeStyle(
                              c.status?.codigo,
                              c.status?.finaliza,
                            )

                            // Regras de destaque obrigatórias:
                            // Prazo vencido em vermelho se não finalizado
                            // Follow-up vencido em âmbar se não finalizado
                            const prazoVencido = isPrazoOverdue(prazoDestaque?.data_prazo, c.status)
                            const followUpVencido = isFollowUpOverdue(c.follow_up, c.status)

                            return (
                              <React.Fragment key={c.id}>
                                <tr
                                  onClick={() => toggleRowExpanded(c.id)}
                                  className={cn(
                                    'hover:bg-muted/30 cursor-pointer transition-colors group',
                                    isExpanded && 'bg-muted/20',
                                  )}
                                >
                                  {/* 1. Expandir */}
                                  <td
                                    className="py-2.5 px-2.5 text-center"
                                    onClick={(e) => toggleRowExpanded(c.id, e)}
                                  >
                                    <button
                                      type="button"
                                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                                      aria-label={
                                        isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'
                                      }
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="w-4 h-4 text-primary" />
                                      ) : (
                                        <ChevronRight className="w-4 h-4" />
                                      )}
                                    </button>
                                  </td>

                                  {/* 2. Controle Cliente (sem corte quando há espaço) */}
                                  <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                                    {c.controle_cliente ? (
                                      <span
                                        className="whitespace-nowrap inline-block"
                                        title={c.controle_cliente}
                                      >
                                        {c.controle_cliente}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* 3. Controle Ricci (sem corte quando há espaço) */}
                                  <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                                    {c.controle_ricci ? (
                                      <span
                                        className="whitespace-nowrap inline-block text-primary font-bold"
                                        title={c.controle_ricci}
                                      >
                                        {c.controle_ricci}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* 4. Identificação do Caso (maior largura, line-clamp-2, tooltip) */}
                                  <td className="py-2.5 px-3">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 leading-relaxed">
                                          {c.identificacao_caso}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="top"
                                        className="max-w-md p-3 text-xs leading-relaxed"
                                      >
                                        <p className="font-bold mb-1">Identificação do Caso:</p>
                                        <p className="whitespace-pre-wrap">
                                          {c.identificacao_caso}
                                        </p>
                                        {c.descricao_status && (
                                          <p className="mt-2 text-muted-foreground border-t border-border/40 pt-1">
                                            <strong>Status detalhado:</strong> {c.descricao_status}
                                          </p>
                                        )}
                                      </TooltipContent>
                                    </Tooltip>
                                  </td>

                                  {/* 5. Próxima Providência (maior largura, line-clamp-2, tooltip) */}
                                  <td className="py-2.5 px-3">
                                    {c.proximas_providencias ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="text-muted-foreground line-clamp-2 leading-relaxed">
                                            {c.proximas_providencias}
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="top"
                                          className="max-w-md p-3 text-xs leading-relaxed"
                                        >
                                          <p className="font-bold mb-1">Próxima Providência:</p>
                                          <p className="whitespace-pre-wrap">
                                            {c.proximas_providencias}
                                          </p>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span className="text-muted-foreground/50 italic text-[11px]">
                                        Nenhuma providência
                                      </span>
                                    )}
                                  </td>

                                  {/* 6. Próximo Prazo (destaque vermelho se vencido) */}
                                  <td className="py-2.5 px-3">
                                    {prazoDestaque ? (
                                      <div className="flex flex-col">
                                        <span
                                          className={cn(
                                            'font-bold inline-flex items-center gap-1',
                                            prazoVencido ? 'text-destructive' : 'text-foreground',
                                          )}
                                        >
                                          {prazoVencido && (
                                            <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
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
                                            <span className="text-[10px] text-muted-foreground truncate max-w-[110px]">
                                              {prazoDestaque.tipo_prazo.nome}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* 7. Status (discreto, com dot colorido) */}
                                  <td className="py-2.5 px-3">
                                    <span
                                      className={cn(
                                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border',
                                        statusBadge.bg,
                                        statusBadge.text,
                                        statusBadge.border,
                                      )}
                                    >
                                      <span
                                        className={cn('w-1.5 h-1.5 rounded-full', statusBadge.dot)}
                                      />
                                      <span className="truncate max-w-[110px]">
                                        {c.status?.nome || '—'}
                                      </span>
                                    </span>
                                  </td>

                                  {/* 8. Responsável */}
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

                                  {/* 9. Follow-up (destaque âmbar se vencido) */}
                                  <td className="py-2.5 px-3">
                                    {c.follow_up ? (
                                      <span
                                        className={cn(
                                          'font-semibold inline-flex items-center gap-1',
                                          followUpVencido
                                            ? 'text-amber-600 dark:text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded'
                                            : 'text-muted-foreground',
                                        )}
                                      >
                                        <CalendarClock className="w-3 h-3 shrink-0" />
                                        <span>{formatDateBR(c.follow_up)}</span>
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* 10. Última Atualização */}
                                  <td className="py-2.5 px-3 text-muted-foreground text-[11px]">
                                    {formatDateTimeBR(c.updated_at)}
                                  </td>

                                  {/* 11. Ações (fixa à direita em scroll horizontal se aplicável) */}
                                  <td className="py-2.5 px-3 text-right sticky right-0 bg-card/90 backdrop-blur-md z-10 group-hover:bg-muted/40 transition-colors">
                                    <div className="flex items-center justify-end gap-1">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => handleOpenEdit(c, e)}
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

                                {/* DETALHE RÁPIDO EXPANDIDO (sem abrir edição imediata) */}
                                {isExpanded && (
                                  <tr className="bg-muted/15 border-b border-border/80">
                                    <td colSpan={11} className="py-4 px-5">
                                      <div className="bg-card border border-border/80 rounded-xl p-4 shadow-xs space-y-4 text-xs">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
                                          <div>
                                            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                                              Detalhes Rápidos do Caso
                                            </span>
                                            <h3 className="text-sm font-bold text-foreground mt-0.5">
                                              {c.identificacao_caso}
                                            </h3>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Button
                                              type="button"
                                              size="sm"
                                              onClick={(e) => handleOpenEdit(c, e)}
                                              className="h-8 rounded-lg text-xs bg-primary text-primary-foreground font-semibold"
                                            >
                                              <Pencil className="w-3 h-3 mr-1.5" />
                                              Editar este caso
                                            </Button>
                                          </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                          {/* Bloco 1: Identificação e Status Detalhado */}
                                          <div className="space-y-2.5">
                                            <div>
                                              <span className="font-bold text-foreground block text-[11px] text-muted-foreground">
                                                Nome do Controle
                                              </span>
                                              <p className="text-foreground font-semibold">
                                                {c.nome_controle || 'Sem Controle Definido'}
                                              </p>
                                            </div>

                                            {c.descricao_status ? (
                                              <div>
                                                <span className="font-bold text-foreground block text-[11px] text-muted-foreground">
                                                  Descrição do Status
                                                </span>
                                                <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                                                  {c.descricao_status}
                                                </p>
                                              </div>
                                            ) : (
                                              <div>
                                                <span className="font-bold text-foreground block text-[11px] text-muted-foreground">
                                                  Status
                                                </span>
                                                <p className="text-foreground">
                                                  {c.status?.nome || '—'}
                                                </p>
                                              </div>
                                            )}

                                            <div>
                                              <span className="font-bold text-foreground block text-[11px] text-muted-foreground">
                                                Data de Referência
                                              </span>
                                              <p className="text-foreground">
                                                {formatDateBR(c.data_referencia)}
                                              </p>
                                            </div>
                                          </div>

                                          {/* Bloco 2: Próximas Providências completas */}
                                          <div className="space-y-2.5">
                                            <span className="font-bold text-foreground block text-[11px] text-muted-foreground">
                                              Próximas Providências Completas
                                            </span>
                                            <div className="p-3 rounded-lg bg-muted/40 border border-border/50 text-foreground leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                                              {c.proximas_providencias ||
                                                'Nenhuma providência registrada para este controle.'}
                                            </div>
                                          </div>

                                          {/* Bloco 3: Todos os Prazos Ativos e Andamentos Recentes */}
                                          <div className="space-y-2.5">
                                            <span className="font-bold text-foreground block text-[11px] text-muted-foreground">
                                              Todos os Prazos Ativos ({c.prazos?.length || 0})
                                            </span>
                                            {!c.prazos || c.prazos.length === 0 ? (
                                              <p className="text-muted-foreground italic text-[11px]">
                                                Nenhum prazo cadastrado.
                                              </p>
                                            ) : (
                                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                                {c.prazos.map((p) => {
                                                  const pVenc = isPrazoOverdue(
                                                    p.data_prazo,
                                                    c.status,
                                                  )
                                                  return (
                                                    <div
                                                      key={p.id}
                                                      className="flex items-center justify-between text-[11px] p-1.5 rounded-md bg-muted/30 border border-border/40"
                                                    >
                                                      <div className="flex items-center gap-1.5">
                                                        {p.principal && (
                                                          <span
                                                            className="text-primary font-bold"
                                                            title="Prazo Principal"
                                                          >
                                                            ★
                                                          </span>
                                                        )}
                                                        <span
                                                          className={cn(
                                                            'font-semibold',
                                                            pVenc
                                                              ? 'text-destructive font-bold'
                                                              : 'text-foreground',
                                                          )}
                                                        >
                                                          {formatDateBR(p.data_prazo)}
                                                        </span>
                                                        {p.tipo_prazo && (
                                                          <span className="text-muted-foreground truncate max-w-[120px]">
                                                            ({p.tipo_prazo.nome})
                                                          </span>
                                                        )}
                                                      </div>
                                                      {p.descricao && (
                                                        <span
                                                          className="text-muted-foreground truncate max-w-[140px]"
                                                          title={p.descricao}
                                                        >
                                                          {p.descricao}
                                                        </span>
                                                      )}
                                                    </div>
                                                  )
                                                })}
                                              </div>
                                            )}

                                            <div className="pt-2 border-t border-border/50 flex justify-end">
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={(e) => handleOpenEdit(c, e)}
                                                className="h-7 text-xs rounded-lg text-muted-foreground hover:text-foreground"
                                              >
                                                Ver linha do tempo de andamentos
                                              </Button>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* VISUALIZAÇÃO MOBILE (Cartões compactos estruturados) */}
                    <div className="md:hidden divide-y divide-border/60">
                      {group.items.map((c) => {
                        const isExpanded = Boolean(expandedRows[c.id])
                        const prazoDestaque = c.prazo_destaque
                        const statusBadge = getStatusBadgeStyle(
                          c.status?.codigo,
                          c.status?.finaliza,
                        )
                        const prazoVencido = isPrazoOverdue(prazoDestaque?.data_prazo, c.status)
                        const followUpVencido = isFollowUpOverdue(c.follow_up, c.status)

                        return (
                          <div
                            key={c.id}
                            className="p-4 space-y-3 hover:bg-muted/20 transition-colors"
                          >
                            {/* Linha 1: Códigos Cliente / Ricci e Status */}
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 font-mono text-xs">
                                {c.controle_cliente && (
                                  <span
                                    className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-semibold"
                                    title="Controle Cliente"
                                  >
                                    {c.controle_cliente}
                                  </span>
                                )}
                                {c.controle_ricci && (
                                  <span
                                    className="px-2 py-0.5 rounded bg-primary/10 text-primary font-bold"
                                    title="Controle Ricci"
                                  >
                                    [{c.controle_ricci}]
                                  </span>
                                )}
                              </div>

                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border',
                                  statusBadge.bg,
                                  statusBadge.text,
                                  statusBadge.border,
                                )}
                              >
                                <span className={cn('w-1.5 h-1.5 rounded-full', statusBadge.dot)} />
                                <span>{c.status?.nome || '—'}</span>
                              </span>
                            </div>

                            {/* Linha 2: Identificação do Caso */}
                            <div
                              onClick={() => toggleRowExpanded(c.id)}
                              className="cursor-pointer group"
                            >
                              <h4 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors leading-snug">
                                {c.identificacao_caso}
                              </h4>
                              {c.proximas_providencias && (
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                                  {c.proximas_providencias}
                                </p>
                              )}
                            </div>

                            {/* Linha 3: Próximo Prazo, Follow-up e Responsável */}
                            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/40">
                              <div>
                                <span className="text-[10px] text-muted-foreground block font-medium">
                                  Próximo Prazo:
                                </span>
                                {prazoDestaque ? (
                                  <span
                                    className={cn(
                                      'font-bold inline-flex items-center gap-1',
                                      prazoVencido ? 'text-destructive' : 'text-foreground',
                                    )}
                                  >
                                    {prazoVencido && (
                                      <AlertTriangle className="w-3 h-3 text-destructive" />
                                    )}
                                    <span>{formatDateBR(prazoDestaque.data_prazo)}</span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/60">—</span>
                                )}
                              </div>

                              <div>
                                <span className="text-[10px] text-muted-foreground block font-medium">
                                  Follow-up:
                                </span>
                                {c.follow_up ? (
                                  <span
                                    className={cn(
                                      'font-semibold inline-flex items-center gap-1',
                                      followUpVencido
                                        ? 'text-amber-600 dark:text-amber-400 font-bold bg-amber-500/10 px-1 py-0.2 rounded'
                                        : 'text-muted-foreground',
                                    )}
                                  >
                                    <CalendarClock className="w-3 h-3" />
                                    <span>{formatDateBR(c.follow_up)}</span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/60">—</span>
                                )}
                              </div>

                              <div className="col-span-2 flex items-center justify-between pt-1 text-muted-foreground text-[11px]">
                                <span className="truncate max-w-[200px]">
                                  Resp:{' '}
                                  <strong className="text-foreground">{c.responsavel_nome}</strong>
                                </span>
                                <span>{formatDateTimeBR(c.updated_at)}</span>
                              </div>
                            </div>

                            {/* Botões de Ação no Mobile */}
                            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleRowExpanded(c.id)}
                                className="h-8 px-2 text-xs text-primary font-medium flex items-center gap-1"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronDown className="w-3.5 h-3.5" />
                                    <span>Ocultar detalhes</span>
                                  </>
                                ) : (
                                  <>
                                    <ChevronRight className="w-3.5 h-3.5" />
                                    <span>Ver detalhes</span>
                                  </>
                                )}
                              </Button>

                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => handleOpenEdit(c, e)}
                                  className="h-8 px-2.5 text-xs rounded-xl"
                                >
                                  <Pencil className="w-3 h-3 mr-1" />
                                  Editar
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => handleOpenArchiveConfirm(e, c)}
                                  className="h-8 w-8 p-0 text-muted-foreground hover:text-amber-600 rounded-xl"
                                  title="Arquivar"
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>

                            {/* Detalhes expandidos no mobile */}
                            {isExpanded && (
                              <div className="p-3 bg-muted/30 border border-border/60 rounded-xl space-y-3 text-xs mt-2 animate-fade-in">
                                <div>
                                  <span className="font-bold text-[10px] text-muted-foreground uppercase block">
                                    Nome do Controle
                                  </span>
                                  <p className="font-medium text-foreground">
                                    {c.nome_controle || 'Sem Controle Definido'}
                                  </p>
                                </div>

                                {c.descricao_status && (
                                  <div>
                                    <span className="font-bold text-[10px] text-muted-foreground uppercase block">
                                      Descrição do Status
                                    </span>
                                    <p className="text-foreground leading-relaxed">
                                      {c.descricao_status}
                                    </p>
                                  </div>
                                )}

                                <div>
                                  <span className="font-bold text-[10px] text-muted-foreground uppercase block">
                                    Próximas Providências Completas
                                  </span>
                                  <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                                    {c.proximas_providencias || 'Nenhuma providência registrada.'}
                                  </p>
                                </div>

                                <div>
                                  <span className="font-bold text-[10px] text-muted-foreground uppercase block mb-1">
                                    Todos os Prazos ({c.prazos?.length || 0})
                                  </span>
                                  {c.prazos && c.prazos.length > 0 ? (
                                    <div className="space-y-1">
                                      {c.prazos.map((p) => (
                                        <div
                                          key={p.id}
                                          className="text-[11px] p-1.5 rounded bg-card border border-border/40 flex items-center justify-between"
                                        >
                                          <span>
                                            {p.principal && '★ '}
                                            {formatDateBR(p.data_prazo)}
                                          </span>
                                          <span className="text-muted-foreground truncate max-w-[120px]">
                                            {p.tipo_prazo?.nome || p.descricao}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-muted-foreground italic text-[11px]">
                                      Sem prazos ativos.
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

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

      {/* Confirmação de Arquivamento */}
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
