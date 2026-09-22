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
  AlertTriangle,
  FileSpreadsheet,
  X,
  Layers,
  CheckCircle2,
  ListFilter,
  User,
  UserCheck,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
  Briefcase,
  Loader2,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { controleService } from '@/services/controleService'
import {
  formatDateBR,
  formatDateTimeBR,
  isPrazoOverdue,
  getStatusBadgeStyle,
  getLocalDateStr,
} from '@/lib/formatters'
import { Calendar as CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

function normalizeText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export type SortField =
  | 'nome_controle'
  | 'numero_caso'
  | 'identificacao_caso'
  | 'status_controle'
  | 'data_autorizacao'
  | 'prazo_conclusao'
  | 'providencia'
  | 'prazo_providencia'
  | 'tipo_prazo'
  | 'status_providencia'
  | 'responsavel'
  | 'executor'
  | 'pasta_cliente'
  | 'pasta_ricci'
  | 'updated_at'

export type SortDirection = 'asc' | 'desc'

export default function TarefasPage() {
  const {
    controles,
    statusList,
    statusProvidenciaList,
    tiposPrazoList,
    usuariosAtivos,
    loading,
    refreshControles,
    archiveControle,
    updateProvidenciaStatus,
  } = useControles()

  // Estado de salvamento por id de providência
  const [updatingProvidenciaIds, setUpdatingProvidenciaIds] = useState<Record<string, boolean>>({})

  // Status de providência que definem data de conclusão automática: cancelado, concluido, concluida, suspenso
  const isStatusExigeConclusao = (statusObj?: { codigo?: string } | null) => {
    const cod = statusObj?.codigo?.trim().toLowerCase() || ''
    return cod === 'cancelado' || cod === 'concluido' || cod === 'concluida' || cod === 'suspenso'
  }

  const handleSelectProvidenciaStatus = async (
    providenciaId: string,
    novoStatusId: string,
    controleId: string,
  ) => {
    if (!providenciaId || !novoStatusId) return
    if (updatingProvidenciaIds[providenciaId]) return

    const selectedStatus = statusProvidenciaList.find((s) => s.id === novoStatusId)
    const exigeConclusao = isStatusExigeConclusao(selectedStatus)
    const dataConclusao = exigeConclusao ? getLocalDateStr() : null
    const isStatusFinalizador = Boolean(selectedStatus?.finaliza)

    setUpdatingProvidenciaIds((prev) => ({ ...prev, [providenciaId]: true }))
    try {
      // 1. Salvar imediatamente o status da Providência e Data de Conclusão automática
      await updateProvidenciaStatus(providenciaId, novoStatusId, dataConclusao)
      toast({
        title: 'Status atualizado com sucesso',
        description: 'A providência foi atualizada e os dados recarregados.',
      })

      // Regra B: Executar fluxo sequencial SOMENTE quando o status selecionado tiver finaliza = true.
      // Status Suspenso pode registrar Data de Conclusão, mas NÃO inicia este fluxo enquanto finaliza = false.
      if (isStatusFinalizador && controleId) {
        // Consultar NOVAMENTE as providências do mesmo Controle no banco (nunca usar dados em cache)
        const provsDoControle = await controleService.getProvidenciasByControleId(controleId)
        const temAberta = provsDoControle.some((p) => !p.deleted_at && !p.status?.finaliza)

        if (!temAberta) {
          // Se NÃO existir nenhuma providência aberta, abrir Modal 1:
          // "Sem mais providências nesse controle / Deseja inserir uma nova providência?"
          const ctrlAtualizado = await controleService.getControleById(controleId, usuariosAtivos)
          if (ctrlAtualizado) {
            setControlePendenteAcao(ctrlAtualizado)
            setDialogNovaProvidenciaOpen(true)
          }
        }
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao atualizar status',
        description: err?.message || 'Falha ao salvar novo status da providência.',
      })
    } finally {
      setUpdatingProvidenciaIds((prev) => {
        const next = { ...prev }
        delete next[providenciaId]
        return next
      })
    }
  }

  // Resposta SIM no Modal 1: Deseja inserir uma nova providência?
  const handleConfirmNovaProvidencia = () => {
    setDialogNovaProvidenciaOpen(false)
    if (!controlePendenteAcao) return

    // Abrir a tela de edição do mesmo Controle diretamente na aba Providência com formulário vazio
    setControleToEdit(controlePendenteAcao)
    setModalInitialTab('providencias')
    setModalAutoAddNewProvidencia(true)
    setModalOpen(true)
    setControlePendenteAcao(null)
  }

  // Resposta NÃO no Modal 1: Mostrar Modal 2 (Encerrar controle)
  const handleRejectNovaProvidencia = () => {
    setDialogNovaProvidenciaOpen(false)
    setDialogEncerrarControleOpen(true)
  }

  // Resposta SIM no Modal 2: Encerrar controle
  const handleConfirmEncerrarControle = async () => {
    if (!controlePendenteAcao) return
    setEncerrandoControle(true)
    try {
      // Localiza status Concluído pelo código ('concluido' ou 'concluida')
      // e atualiza em UMA ÚNICA OPERAÇÃO: status_id = Concluído, arquivado_at = data/hora atual, updated_at e updated_by
      await controleService.encerrarControle(controlePendenteAcao.id)

      toast({
        title: 'Controle encerrado com sucesso',
        description: `O controle "${controlePendenteAcao.identificacao_caso}" foi concluído e arquivado.`,
      })

      setDialogEncerrarControleOpen(false)
      setControlePendenteAcao(null)

      // Recarrega lista
      await refreshControles()
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao encerrar controle',
        description: err?.message || 'Falha ao concluir e arquivar controle.',
      })
    } finally {
      setEncerrandoControle(false)
    }
  }

  // Resposta NÃO no Modal 2: Manter controle ativo sem alterar nada
  const handleRejectEncerrarControle = () => {
    setDialogEncerrarControleOpen(false)
    setControlePendenteAcao(null)
  }

  const { toast } = useToast()

  // Filtros
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedControles, setSelectedControles] = useState<string[]>([]) // IDs de task_nomes_controle
  const [statusControleFilter, setStatusControleFilter] = useState<string>('todos')
  const [responsavelFilter, setResponsavelFilter] = useState<string>('todos')
  const [executorFilter, setExecutorFilter] = useState<string>('todos')
  const [tipoPrazoFilter, setTipoPrazoFilter] = useState<string>('todos')
  const [statusProvidenciaFilter, setStatusProvidenciaFilter] = useState<string>('todos')

  // Ordenação manual clicável das colunas (padrão: data da próxima providência aberta crescente)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Controle de popover/sheet de filtros
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [mobileFilterSheetOpen, setMobileFilterSheetOpen] = useState(false)

  // Grupos recolhidos (por nome_controle_id)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // Linhas expandidas
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  // Modais de edição/criação e arquivamento
  const [modalOpen, setModalOpen] = useState(false)
  const [controleToEdit, setControleToEdit] = useState<TaskControleRecord | null>(null)
  const [modalInitialTab, setModalInitialTab] = useState<'dados' | 'providencias'>('dados')
  const [modalAutoAddNewProvidencia, setModalAutoAddNewProvidencia] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [controleToArchive, setControleToArchive] = useState<TaskControleRecord | null>(null)
  const [archiving, setArchiving] = useState(false)

  // Modais sequenciais de pós-encerramento de Providência
  // Modal 1: "Sem mais providências nesse controle / Deseja inserir uma nova providência?"
  const [dialogNovaProvidenciaOpen, setDialogNovaProvidenciaOpen] = useState(false)
  const [controlePendenteAcao, setControlePendenteAcao] = useState<TaskControleRecord | null>(null)
  // Modal 2: "Encerrar controle / Deseja encerrar esse controle?"
  const [dialogEncerrarControleOpen, setDialogEncerrarControleOpen] = useState(false)
  const [encerrandoControle, setEncerrandoControle] = useState(false)

  // Debounce na busca
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput)
    }, 250)
    return () => clearTimeout(handler)
  }, [searchInput])

  // Lista única e ordenada de Nomes dos Controles no acervo (por ID)
  const allNomesControle = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of controles) {
      const idKey = c.nome_controle_id || 'sem_controle'
      const label = c.nome_controle?.trim() || 'Sem Controle Definido'
      if (!map.has(idKey)) {
        map.set(idKey, label)
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [controles])

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }))
  }

  const toggleAllGroups = (collapse: boolean) => {
    const next: Record<string, boolean> = {}
    allNomesControle.forEach((item) => {
      next[item.id] = collapse
    })
    setCollapsedGroups(next)
  }

  const toggleRowExpanded = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const handleSortColumn = (field: SortField, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleClearFilters = () => {
    setSearchInput('')
    setDebouncedSearch('')
    setSelectedControles([])
    setStatusControleFilter('todos')
    setResponsavelFilter('todos')
    setExecutorFilter('todos')
    setTipoPrazoFilter('todos')
    setStatusProvidenciaFilter('todos')
    setSortField(null)
    setSortDirection('asc')
  }

  // Filtragem e Ordenação
  const filteredControles = useMemo(() => {
    let list = [...controles]

    // 1. Busca textual: Nome do Controle, Identificação do Caso, Pasta Cliente, Pasta Ricci,
    // Providências, Responsável, Executor e Número do Caso (ex: "12", "#12", "caso 12", "caso #12")
    if (debouncedSearch.trim()) {
      const q = normalizeText(debouncedSearch)
      // Extrair número caso a busca seja por número puro ou termos como "caso 12" ou "#12"
      const matchNum = debouncedSearch.trim().match(/^(?:caso\s*#?|#)?(\d+)$/i)
      const numBuscado = matchNum ? parseInt(matchNum[1], 10) : null

      list = list.filter((c) => {
        if (numBuscado !== null && c.numero_caso === numBuscado) {
          return true
        }

        const nomeNorm = normalizeText(c.nome_controle)
        const casoNorm = normalizeText(c.identificacao_caso)
        const clienteNorm = normalizeText(c.pasta_cliente)
        const ricciNorm = normalizeText(c.pasta_ricci)
        const respNorm = normalizeText(c.responsavel_nome)
        const execNorm = normalizeText(c.executor_nome)
        const provsNorm = normalizeText((c.providencias || []).map((p) => p.providencia).join(' '))
        const numStr = String(c.numero_caso ?? '')

        return (
          nomeNorm.includes(q) ||
          casoNorm.includes(q) ||
          clienteNorm.includes(q) ||
          ricciNorm.includes(q) ||
          respNorm.includes(q) ||
          execNorm.includes(q) ||
          provsNorm.includes(q) ||
          numStr === q
        )
      })
    }

    // 2. Filtro por Controle (por ID `nome_controle_id`)
    if (selectedControles.length > 0) {
      list = list.filter((c) => {
        const idKey = c.nome_controle_id || 'sem_controle'
        return selectedControles.includes(idKey)
      })
    }

    // 3. Filtro por Status do Controle (ID)
    if (statusControleFilter !== 'todos') {
      list = list.filter((c) => c.status_id === statusControleFilter)
    }

    // 4. Filtro por Responsável (ID)
    if (responsavelFilter !== 'todos') {
      list = list.filter((c) => c.responsavel_usuario_id === responsavelFilter)
    }

    // 5. Filtro por Executor (ID)
    if (executorFilter !== 'todos') {
      list = list.filter((c) => c.executor_usuario_id === executorFilter)
    }

    // 6. Filtro por Tipo de Prazo (ID em providências)
    if (tipoPrazoFilter !== 'todos') {
      list = list.filter((c) =>
        (c.providencias || []).some((p) => p.tipo_prazo_id === tipoPrazoFilter),
      )
    }

    // 7. Filtro por Status da Providência (ID em providências)
    if (statusProvidenciaFilter !== 'todos') {
      list = list.filter((c) =>
        (c.providencias || []).some((p) => p.status_id === statusProvidenciaFilter),
      )
    }

    // 8. Ordenação:
    // Helper para comparar strings com vazios por último
    const compareStringWithEmptiesLast = (
      valA: string | null | undefined,
      valB: string | null | undefined,
      dir: SortDirection,
    ): number => {
      const cleanA = valA?.trim() || ''
      const cleanB = valB?.trim() || ''
      if (!cleanA && !cleanB) return 0
      if (!cleanA) return 1
      if (!cleanB) return -1
      const cmp = cleanA.localeCompare(cleanB, 'pt-BR', { numeric: true, sensitivity: 'base' })
      return dir === 'asc' ? cmp : -cmp
    }

    const compareDateWithEmptiesLast = (
      dateA: string | null | undefined,
      dateB: string | null | undefined,
      dir: SortDirection,
    ): number => {
      const cleanA = dateA ? dateA.split('T')[0] : ''
      const cleanB = dateB ? dateB.split('T')[0] : ''
      if (!cleanA && !cleanB) return 0
      if (!cleanA) return 1
      if (!cleanB) return -1
      const cmp = cleanA.localeCompare(cleanB)
      return dir === 'asc' ? cmp : -cmp
    }

    // Se o usuário não escolheu uma ordenação manual explícita (sortField === null),
    // a ordenação padrão dos casos dentro de cada Controle é crescente por numero_caso (numérico).
    if (!sortField) {
      list.sort((a, b) => {
        // Ordena por Controle primeiro para manter grupos coesos, depois por numero_caso crescente
        const ctrlCmp = (a.nome_controle || '').localeCompare(b.nome_controle || '', 'pt-BR')
        if (ctrlCmp !== 0) return ctrlCmp
        return (a.numero_caso ?? 0) - (b.numero_caso ?? 0)
      })
      return list
    }

    list.sort((a, b) => {
      let comparison = 0

      switch (sortField) {
        case 'nome_controle':
          comparison = compareStringWithEmptiesLast(a.nome_controle, b.nome_controle, sortDirection)
          break

        case 'numero_caso':
          comparison = (a.numero_caso ?? 0) - (b.numero_caso ?? 0)
          if (sortDirection === 'desc') comparison = -comparison
          break

        case 'identificacao_caso':
          comparison = compareStringWithEmptiesLast(
            a.identificacao_caso,
            b.identificacao_caso,
            sortDirection,
          )
          break

        case 'status_controle':
          comparison = compareStringWithEmptiesLast(a.status?.nome, b.status?.nome, sortDirection)
          break

        case 'data_autorizacao':
          comparison = compareDateWithEmptiesLast(
            a.data_autorizacao,
            b.data_autorizacao,
            sortDirection,
          )
          break

        case 'prazo_conclusao':
          comparison = compareDateWithEmptiesLast(
            a.prazo_conclusao,
            b.prazo_conclusao,
            sortDirection,
          )
          break

        case 'providencia':
          comparison = compareStringWithEmptiesLast(
            a.proxima_providencia?.providencia,
            b.proxima_providencia?.providencia,
            sortDirection,
          )
          break

        case 'prazo_providencia': {
          // Padrão: data da próxima providência aberta crescente
          const aData = a.proxima_providencia?.prazo_conclusao
          const bData = b.proxima_providencia?.prazo_conclusao
          comparison = compareDateWithEmptiesLast(aData, bData, sortDirection)
          break
        }

        case 'tipo_prazo':
          comparison = compareStringWithEmptiesLast(
            a.proxima_providencia?.tipo_prazo?.nome,
            b.proxima_providencia?.tipo_prazo?.nome,
            sortDirection,
          )
          break

        case 'status_providencia':
          comparison = compareStringWithEmptiesLast(
            a.proxima_providencia?.status?.nome,
            b.proxima_providencia?.status?.nome,
            sortDirection,
          )
          break

        case 'responsavel':
          comparison = compareStringWithEmptiesLast(
            a.responsavel_nome,
            b.responsavel_nome,
            sortDirection,
          )
          break

        case 'executor':
          comparison = compareStringWithEmptiesLast(a.executor_nome, b.executor_nome, sortDirection)
          break

        case 'pasta_cliente':
          comparison = compareStringWithEmptiesLast(a.pasta_cliente, b.pasta_cliente, sortDirection)
          break

        case 'pasta_ricci':
          comparison = compareStringWithEmptiesLast(a.pasta_ricci, b.pasta_ricci, sortDirection)
          break

        case 'updated_at': {
          const dtA = a.updated_at
          const dtB = b.updated_at
          if (!dtA && !dtB) comparison = 0
          else if (!dtA) comparison = 1
          else if (!dtB) comparison = -1
          else {
            const cmp = new Date(dtA).getTime() - new Date(dtB).getTime()
            comparison = sortDirection === 'asc' ? cmp : -cmp
          }
          break
        }

        default:
          comparison = 0
      }

      // Desempate: numero_caso crescente se do mesmo controle, senão updated_at decrescente
      if (comparison === 0) {
        if (a.nome_controle_id === b.nome_controle_id) {
          return (a.numero_caso ?? 0) - (b.numero_caso ?? 0)
        }
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }
      return comparison
    })

    return list
  }, [
    controles,
    debouncedSearch,
    selectedControles,
    statusControleFilter,
    responsavelFilter,
    executorFilter,
    tipoPrazoFilter,
    statusProvidenciaFilter,
    sortField,
    sortDirection,
  ])

  // Agrupamento por nome_controle_id preservando a ordem dos itens filtrados
  const groupedControles = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; items: TaskControleRecord[] }>()
    const groupOrder: string[] = []

    for (const item of filteredControles) {
      const groupId = item.nome_controle_id || 'sem_controle'
      const groupName = item.nome_controle?.trim() || 'Sem Controle Definido'
      const existing = map.get(groupId)
      if (!existing) {
        map.set(groupId, { id: groupId, nome: groupName, items: [item] })
        groupOrder.push(groupId)
      } else {
        existing.items.push(item)
      }
    }

    const groups: { id: string; nome: string; items: TaskControleRecord[] }[] = []
    for (const id of groupOrder) {
      const g = map.get(id)
      if (g) {
        // Se a ordenação ativa for a padrão (sem ordenação manual explícita),
        // garante que os itens deste grupo estejam em ordem crescente numérica de numero_caso
        if (!sortField) {
          g.items.sort((a, b) => (a.numero_caso ?? 0) - (b.numero_caso ?? 0))
        }
        groups.push(g)
      }
    }
    return groups
  }, [filteredControles, sortField])

  const currentSortKey = sortField ? `${sortField}:${sortDirection}` : 'padrao'

  const handleSelectSort = (val: string) => {
    if (val === 'padrao') {
      setSortField(null)
      setSortDirection('asc')
      return
    }
    const [field, dir] = val.split(':') as [SortField, SortDirection]
    if (field && dir) {
      setSortField(field)
      setSortDirection(dir)
    }
  }

  const isDefaultSorting = sortField === null

  const hasActiveFilters = useMemo(() => {
    return (
      searchInput.trim() !== '' ||
      selectedControles.length > 0 ||
      statusControleFilter !== 'todos' ||
      responsavelFilter !== 'todos' ||
      executorFilter !== 'todos' ||
      tipoPrazoFilter !== 'todos' ||
      statusProvidenciaFilter !== 'todos' ||
      !isDefaultSorting
    )
  }, [
    searchInput,
    selectedControles,
    statusControleFilter,
    responsavelFilter,
    executorFilter,
    tipoPrazoFilter,
    statusProvidenciaFilter,
    isDefaultSorting,
  ])

  const advancedFiltersCount = useMemo(() => {
    let count = 0
    if (executorFilter !== 'todos') count++
    if (tipoPrazoFilter !== 'todos') count++
    if (statusProvidenciaFilter !== 'todos') count++
    if (!isDefaultSorting) count++
    return count
  }, [executorFilter, tipoPrazoFilter, statusProvidenciaFilter, isDefaultSorting])

  // Chips dos filtros ativos
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
      selectedControles.forEach((scId) => {
        const itemInfo = allNomesControle.find((n) => n.id === scId)
        chips.push({
          id: `controle:${scId}`,
          label: `Controle: ${itemInfo?.label || scId}`,
          onRemove: () => {
            setSelectedControles((prev) => prev.filter((item) => item !== scId))
          },
        })
      })
    }

    if (statusControleFilter !== 'todos') {
      const st = statusList.find((s) => s.id === statusControleFilter)
      chips.push({
        id: 'status',
        label: `Status: ${st?.nome || statusControleFilter}`,
        onRemove: () => setStatusControleFilter('todos'),
      })
    }

    if (responsavelFilter !== 'todos') {
      const resp = usuariosAtivos.find((u) => u.id === responsavelFilter)
      chips.push({
        id: 'responsavel',
        label: `Resp.: ${resp?.nome || responsavelFilter}`,
        onRemove: () => setResponsavelFilter('todos'),
      })
    }

    if (executorFilter !== 'todos') {
      const exec = usuariosAtivos.find((u) => u.id === executorFilter)
      chips.push({
        id: 'executor',
        label: `Exec.: ${exec?.nome || executorFilter}`,
        onRemove: () => setExecutorFilter('todos'),
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

    if (statusProvidenciaFilter !== 'todos') {
      const sp = statusProvidenciaList.find((s) => s.id === statusProvidenciaFilter)
      chips.push({
        id: 'statusProvidencia',
        label: `Status Prov.: ${sp?.nome || statusProvidenciaFilter}`,
        onRemove: () => setStatusProvidenciaFilter('todos'),
      })
    }

    return chips
  }, [
    searchInput,
    selectedControles,
    statusControleFilter,
    responsavelFilter,
    executorFilter,
    tipoPrazoFilter,
    statusProvidenciaFilter,
    allNomesControle,
    statusList,
    usuariosAtivos,
    tiposPrazoList,
    statusProvidenciaList,
  ])

  // Modais de Criação e Edição
  const handleOpenCreate = () => {
    setControleToEdit(null)
    setModalInitialTab('dados')
    setModalAutoAddNewProvidencia(false)
    setModalOpen(true)
  }

  const handleOpenEdit = (controle: TaskControleRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setControleToEdit(controle)
    setModalInitialTab('dados')
    setModalAutoAddNewProvidencia(false)
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
      await archiveControle(controleToArchive.id)
      toast({
        title: 'Controle arquivado com sucesso',
        description: `O controle "${controleToArchive.identificacao_caso}" foi arquivado com sucesso.`,
      })
      setControleToArchive(null)
      setArchiveConfirmOpen(false)
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao arquivar',
        description: err?.message || 'Falha ao arquivar controle no Supabase.',
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
        subtitle="Gerenciamento de casos jurídicos agrupados por controle com providências operacionais"
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
          {/* Busca textual ampla */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Buscar por caso, pastas Cliente/Ricci, providências, responsável ou executor..."
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
            {/* Filtro: Controle */}
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
                    {allNomesControle.map((item) => {
                      const isSelected = selectedControles.includes(item.id)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedControles((prev) => prev.filter((i) => i !== item.id))
                            } else {
                              setSelectedControles((prev) => [...prev, item.id])
                            }
                          }}
                          className={cn(
                            'w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors',
                            isSelected
                              ? 'bg-primary/10 text-primary font-semibold'
                              : 'hover:bg-muted text-foreground',
                          )}
                        >
                          <span className="truncate">{item.label}</span>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Filtro: Status do Controle */}
            <Select value={statusControleFilter} onValueChange={setStatusControleFilter}>
              <SelectTrigger
                className={cn(
                  'h-10 rounded-xl bg-background text-xs w-[150px] shrink-0',
                  statusControleFilter !== 'todos' &&
                    'border-primary/60 bg-primary/5 text-primary font-semibold',
                )}
              >
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="todos">Todos os status</SelectItem>
                {[...statusList]
                  .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
                  .map((st) => (
                    <SelectItem key={st.id} value={st.id}>
                      {st.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {/* Filtro: Responsável pelo Controle */}
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
                {usuariosAtivos.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Filtro: Executor do Controle */}
            <Select value={executorFilter} onValueChange={setExecutorFilter}>
              <SelectTrigger
                className={cn(
                  'h-10 rounded-xl bg-background text-xs w-[160px] shrink-0',
                  executorFilter !== 'todos' &&
                    'border-primary/60 bg-primary/5 text-primary font-semibold',
                )}
              >
                <SelectValue placeholder="Executor" />
              </SelectTrigger>
              <SelectContent className="rounded-xl max-h-72">
                <SelectItem value="todos">Todos os executores</SelectItem>
                {usuariosAtivos.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Popover: Mais Filtros (Tipo de Prazo, Status da Providência, Ordenação) */}
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
                        setExecutorFilter('todos')
                        setTipoPrazoFilter('todos')
                        setStatusProvidenciaFilter('todos')
                        setSortField('prazo_providencia')
                        setSortDirection('asc')
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
                    Tipo de Prazo da Providência
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

                {/* Status da Providência */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground block">
                    Status da Providência
                  </label>
                  <Select
                    value={statusProvidenciaFilter}
                    onValueChange={setStatusProvidenciaFilter}
                  >
                    <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                      <SelectValue placeholder="Status da Providência" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="todos">Todos os status de providência</SelectItem>
                      {[...statusProvidenciaList]
                        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
                        .map((sp) => (
                          <SelectItem key={sp.id} value={sp.id}>
                            {sp.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Ordenação */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground block">
                    Ordenação dos Casos
                  </label>
                  <Select value={currentSortKey} onValueChange={handleSelectSort}>
                    <SelectTrigger className="h-9 rounded-xl bg-background text-xs">
                      <SelectValue placeholder="Ordenação" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl max-h-64">
                      <SelectItem value="padrao">Padrão (Número do Caso crescente)</SelectItem>
                      <SelectItem value="numero_caso:asc">Número do Caso — crescente</SelectItem>
                      <SelectItem value="numero_caso:desc">Número do Caso — decrescente</SelectItem>
                      <SelectItem value="prazo_providencia:asc">
                        Prazo da Providência — crescente
                      </SelectItem>
                      <SelectItem value="prazo_providencia:desc">
                        Prazo da Providência — decrescente
                      </SelectItem>
                      <SelectItem value="prazo_conclusao:asc">
                        Prazo do Controle — crescente
                      </SelectItem>
                      <SelectItem value="prazo_conclusao:desc">
                        Prazo do Controle — decrescente
                      </SelectItem>
                      <SelectItem value="data_autorizacao:asc">
                        Data de Autorização — crescente
                      </SelectItem>
                      <SelectItem value="data_autorizacao:desc">
                        Data de Autorização — decrescente
                      </SelectItem>
                      <SelectItem value="updated_at:desc">
                        Última Atualização — decrescente
                      </SelectItem>
                      <SelectItem value="updated_at:asc">Última Atualização — crescente</SelectItem>
                      <SelectItem value="identificacao_caso:asc">
                        Identificação do Caso — crescente
                      </SelectItem>
                      <SelectItem value="identificacao_caso:desc">
                        Identificação do Caso — decrescente
                      </SelectItem>
                      <SelectItem value="responsavel:asc">Responsável — crescente</SelectItem>
                      <SelectItem value="responsavel:desc">Responsável — decrescente</SelectItem>
                      <SelectItem value="executor:asc">Executor — crescente</SelectItem>
                      <SelectItem value="executor:desc">Executor — decrescente</SelectItem>
                      <SelectItem value="pasta_cliente:asc">Pasta Cliente — crescente</SelectItem>
                      <SelectItem value="pasta_cliente:desc">
                        Pasta Cliente — decrescente
                      </SelectItem>
                      <SelectItem value="pasta_ricci:asc">Pasta Ricci — crescente</SelectItem>
                      <SelectItem value="pasta_ricci:desc">Pasta Ricci — decrescente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </PopoverContent>
            </Popover>

            {/* Botão Limpar Filtros */}
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

          {/* Botão para Mobile Filters */}
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
                  {/* Status do Controle */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Status do Controle</label>
                    <Select value={statusControleFilter} onValueChange={setStatusControleFilter}>
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="todos">Todos os status</SelectItem>
                        {[...statusList]
                          .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
                          .map((st) => (
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
                        {usuariosAtivos.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Executor */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Executor</label>
                    <Select value={executorFilter} onValueChange={setExecutorFilter}>
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
                        <SelectValue placeholder="Executor" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl max-h-60">
                        <SelectItem value="todos">Todos os executores</SelectItem>
                        {usuariosAtivos.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>{' '}
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

                  {/* Status da Providência */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Status da Providência</label>
                    <Select
                      value={statusProvidenciaFilter}
                      onValueChange={setStatusProvidenciaFilter}
                    >
                      <SelectTrigger className="h-10 rounded-xl bg-background text-xs">
                        <SelectValue placeholder="Status da Providência" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="todos">Todos os status de providência</SelectItem>
                        {[...statusProvidenciaList]
                          .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
                          .map((sp) => (
                            <SelectItem key={sp.id} value={sp.id}>
                              {sp.nome}
                            </SelectItem>
                          ))}
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

        {/* Chips e Contagem */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-muted-foreground">
              Mostrando <strong className="text-foreground">{filteredControles.length}</strong> de{' '}
              <strong className="text-foreground">{controles.length}</strong> controles
            </span>
          </div>

          {/* Ações de Grupos */}
          {allNomesControle.length > 1 && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => toggleAllGroups(false)}
                className="text-muted-foreground hover:text-foreground font-medium underline-offset-2 hover:underline"
              >
                Expandir grupos
              </button>
              <span className="text-muted-foreground/40">•</span>
              <button
                type="button"
                onClick={() => toggleAllGroups(true)}
                className="text-muted-foreground hover:text-foreground font-medium underline-offset-2 hover:underline"
              >
                Recolher grupos
              </button>
            </div>
          )}
        </div>

        {/* Chips de filtros aplicados */}
        {activeFilterChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {activeFilterChips.map((chip) => (
              <Badge
                key={chip.id}
                variant="secondary"
                className="h-6 px-2 text-[11px] rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center gap-1 font-medium"
              >
                <span>{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  className="hover:bg-primary/20 rounded-full p-0.5 ml-0.5"
                  title="Remover filtro"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* LISTAGEM DOS CONTROLES AGRUPADOS POR NOME DO CONTROLE                     */}
      {/* ========================================================================= */}
      {loading ? (
        <div className="p-16 text-center bg-card border border-border rounded-2xl shadow-card space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-sm font-semibold text-foreground">
            Carregando controles do Ricci Task...
          </p>
          <p className="text-xs text-muted-foreground">Sincronizando com o banco Supabase</p>
        </div>
      ) : filteredControles.length === 0 ? (
        <div className="p-12 text-center bg-card border border-border rounded-2xl shadow-card space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto text-muted-foreground">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Nenhum controle encontrado</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
              {hasActiveFilters
                ? 'Nenhum controle corresponde aos filtros aplicados. Tente ajustar os parâmetros de busca ou limpar os filtros.'
                : 'Você ainda não possui controles de casos cadastrados. Comece criando um novo controle.'}
            </p>
          </div>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="rounded-xl text-xs"
            >
              Limpar filtros
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleOpenCreate}
              className="rounded-xl text-xs bg-primary text-primary-foreground font-semibold"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Criar Primeiro Controle
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedControles.map((group) => {
            const isGroupCollapsed = Boolean(collapsedGroups[group.id])

            return (
              <div
                key={group.id}
                className="bg-card border border-border rounded-2xl shadow-card overflow-hidden transition-all duration-200"
              >
                {/* Cabeçalho do Grupo por Nome do Controle */}
                <div
                  onClick={() => toggleGroupCollapse(group.id)}
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
                    {/* VISUALIZAÇÃO DESKTOP / TABLET (Tabela com 10 colunas: Inicia por Identificação do Caso) */}
                    <div className="hidden md:block overflow-x-auto w-full">
                      <table className="w-full text-left border-collapse table-fixed min-w-[1020px]">
                        <thead>
                          <tr className="border-b border-border/80 bg-muted/20 text-[11px] font-bold text-muted-foreground uppercase tracking-wider sticky top-0 z-10 backdrop-blur-md select-none">
                            {/* Expandir */}
                            <th className="py-2.5 px-2 w-9 text-center" aria-label="Expandir"></th>

                            {/* Coluna CASO */}
                            <th className="py-2.5 px-2 w-14 text-center">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('numero_caso', e)}
                                className={cn(
                                  'group/sort inline-flex items-center justify-center gap-1 font-bold uppercase tracking-wider transition-colors hover:text-foreground',
                                  sortField === 'numero_caso' && 'text-primary font-extrabold',
                                )}
                                title="Ordenar por número do caso"
                              >
                                <span>CASO</span>
                                {sortField === 'numero_caso' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3 h-3 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 1. Identificação do Caso */}
                            <th className="py-2.5 px-3 w-[310px]">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('identificacao_caso', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'identificacao_caso' &&
                                    'text-primary font-extrabold',
                                )}
                              >
                                <span>Identificação do Caso</span>
                                {sortField === 'identificacao_caso' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 2. Próxima Providência */}
                            <th className="py-2.5 px-3 w-[340px]">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('providencia', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'providencia' && 'text-primary font-extrabold',
                                )}
                              >
                                <span>Próxima Providência</span>
                                {sortField === 'providencia' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 4. Prazo da Providência */}
                            <th className="py-2.5 px-3 w-32">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('prazo_providencia', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'prazo_providencia' &&
                                    'text-primary font-extrabold',
                                )}
                              >
                                <span>Prazo Providência</span>
                                {sortField === 'prazo_providencia' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 5. Tipo de Prazo */}
                            <th className="py-2.5 px-3 w-28">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('tipo_prazo', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'tipo_prazo' && 'text-primary font-extrabold',
                                )}
                              >
                                <span>Tipo Prazo</span>
                                {sortField === 'tipo_prazo' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 6. Status da Providência */}
                            <th className="py-2.5 px-3 w-36">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('status_providencia', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'status_providencia' &&
                                    'text-primary font-extrabold',
                                )}
                              >
                                <span>Status Providência</span>
                                {sortField === 'status_providencia' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 7. Responsável */}
                            <th className="py-2.5 px-3 w-36">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('responsavel', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'responsavel' && 'text-primary font-extrabold',
                                )}
                              >
                                <span>Responsável</span>
                                {sortField === 'responsavel' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 8. Executor */}
                            <th className="py-2.5 px-3 w-36">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('executor', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'executor' && 'text-primary font-extrabold',
                                )}
                              >
                                <span>Executor</span>
                                {sortField === 'executor' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 9. Pasta Cliente */}
                            <th className="py-2.5 px-3 w-32">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('pasta_cliente', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'pasta_cliente' && 'text-primary font-extrabold',
                                )}
                              >
                                <span>Pasta Cliente</span>
                                {sortField === 'pasta_cliente' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 10. Pasta Ricci */}
                            <th className="py-2.5 px-3 w-32">
                              <button
                                type="button"
                                onClick={(e) => handleSortColumn('pasta_ricci', e)}
                                className={cn(
                                  'group/sort inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-left transition-colors hover:text-foreground',
                                  sortField === 'pasta_ricci' && 'text-primary font-extrabold',
                                )}
                              >
                                <span>Pasta Ricci</span>
                                {sortField === 'pasta_ricci' ? (
                                  sortDirection === 'asc' ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3.5 h-3.5 opacity-40 group-hover/sort:opacity-80 shrink-0" />
                                )}
                              </button>
                            </th>

                            {/* 11. Ações (fixa à direita) */}
                            <th className="py-2.5 px-3 w-20 text-right sticky right-0 bg-muted/30 backdrop-blur-md z-20">
                              Ações
                            </th>
                          </tr>
                        </thead>

                        <tbody className="divide-y divide-border/60 text-xs">
                          {group.items.map((c) => {
                            const isExpanded = Boolean(expandedRows[c.id])
                            const proxProv = c.proxima_providencia
                            const proxVencida = isPrazoOverdue(
                              proxProv?.prazo_conclusao,
                              proxProv?.status,
                            )
                            const provStatusBadge = getStatusBadgeStyle(
                              proxProv?.status?.codigo,
                              proxProv?.status?.finaliza,
                            )

                            return (
                              <React.Fragment key={c.id}>
                                <tr
                                  onClick={() => toggleRowExpanded(c.id)}
                                  className={cn(
                                    'hover:bg-muted/30 cursor-pointer transition-colors group',
                                    isExpanded && 'bg-muted/20',
                                  )}
                                >
                                  {/* Expandir */}
                                  <td
                                    className="py-2.5 px-2 text-center"
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

                                  {/* Coluna CASO: Apenas o número */}
                                  <td className="py-2.5 px-2 text-center">
                                    <span className="font-semibold text-foreground/80 font-mono text-xs">
                                      {c.numero_caso ?? '—'}
                                    </span>
                                  </td>

                                  {/* 1. Identificação do Caso */}
                                  <td className="py-2.5 px-3">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 leading-relaxed">
                                          {c.identificacao_caso || '—'}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="top"
                                        className="max-w-md p-3 text-xs leading-relaxed"
                                      >
                                        <p className="font-bold mb-1">Identificação do Caso:</p>
                                        <p className="whitespace-pre-wrap">
                                          {c.identificacao_caso || '—'}
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </td>

                                  {/* 3. Próxima Providência */}
                                  <td className="py-2.5 px-3">
                                    {proxProv?.providencia ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="text-muted-foreground line-clamp-2 leading-relaxed">
                                            {proxProv.providencia}
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="top"
                                          className="max-w-md p-3 text-xs leading-relaxed"
                                        >
                                          <p className="font-bold mb-1">Próxima Providência:</p>
                                          <p className="whitespace-pre-wrap">
                                            {proxProv.providencia}
                                          </p>
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span className="text-muted-foreground/60 italic text-xs">
                                        Sem providência pendente
                                      </span>
                                    )}
                                  </td>

                                  {/* 4. Prazo da Providência (vermelho se vencido) */}
                                  <td className="py-2.5 px-3">
                                    {proxProv?.prazo_conclusao ? (
                                      <span
                                        className={cn(
                                          'font-bold inline-flex items-center gap-1',
                                          proxVencida ? 'text-destructive' : 'text-foreground',
                                        )}
                                      >
                                        {proxVencida && (
                                          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                                        )}
                                        <span>{formatDateBR(proxProv.prazo_conclusao)}</span>
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* 5. Tipo de Prazo */}
                                  <td className="py-2.5 px-3 text-muted-foreground truncate">
                                    {proxProv?.tipo_prazo?.nome || '—'}
                                  </td>

                                  {/* 6. Status da Providência */}
                                  <td className="py-2.5 px-3">
                                    {proxProv?.status ? (
                                      <span
                                        className={cn(
                                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border',
                                          provStatusBadge.bg,
                                          provStatusBadge.text,
                                          provStatusBadge.border,
                                        )}
                                      >
                                        <span
                                          className={cn(
                                            'w-1.5 h-1.5 rounded-full',
                                            provStatusBadge.dot,
                                          )}
                                        />
                                        <span className="truncate max-w-[100px]">
                                          {proxProv.status.nome}
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* 7. Responsável */}
                                  <td className="py-2.5 px-3 font-semibold text-foreground truncate">
                                    <span title={c.responsavel_nome || ''}>
                                      {c.responsavel_nome || '—'}
                                    </span>
                                  </td>

                                  {/* 8. Executor */}
                                  <td className="py-2.5 px-3 font-medium text-foreground truncate">
                                    <span title={c.executor_nome || ''}>
                                      {c.executor_nome || '—'}
                                    </span>
                                  </td>

                                  {/* 9. Pasta Cliente */}
                                  <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                                    {c.pasta_cliente ? (
                                      <span
                                        className="whitespace-nowrap inline-block font-semibold"
                                        title={c.pasta_cliente}
                                      >
                                        {c.pasta_cliente}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* 10. Pasta Ricci */}
                                  <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                                    {c.pasta_ricci ? (
                                      <span
                                        className="whitespace-nowrap inline-block text-primary font-bold"
                                        title={c.pasta_ricci}
                                      >
                                        {c.pasta_ricci}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/60">—</span>
                                    )}
                                  </td>

                                  {/* 11. Ações (fixa à direita) */}
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

                                {/* DETALHE RÁPIDO EXPANDIDO */}
                                {isExpanded && (
                                  <tr className="bg-muted/15 border-b border-border/80">
                                    <td colSpan={11} className="py-4 px-5">
                                      <div className="bg-card border border-border/80 rounded-xl p-4 shadow-xs space-y-4 text-xs">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
                                          <div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                                                Detalhes do Caso
                                              </span>
                                              <Badge
                                                variant="outline"
                                                className="text-[11px] font-semibold px-2 py-0.5 rounded-md border-border bg-muted/40 text-foreground"
                                              >
                                                Caso nº {c.numero_caso ?? '—'}
                                              </Badge>
                                            </div>
                                            <h3 className="text-sm font-bold text-foreground mt-1">
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

                                        {/* Metadados do Caso (sem Nome do Controle repetido) */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 rounded-xl bg-muted/20 border border-border/50">
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
                                              Status do Controle
                                            </span>
                                            <span className="font-semibold text-foreground">
                                              {c.status?.nome || '—'}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
                                              Data de Autorização
                                            </span>
                                            <span className="font-medium text-foreground">
                                              {c.data_autorizacao
                                                ? formatDateBR(c.data_autorizacao)
                                                : '—'}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
                                              Prazo de Conclusão
                                            </span>
                                            <span className="font-medium text-foreground">
                                              {c.prazo_conclusao
                                                ? formatDateBR(c.prazo_conclusao)
                                                : '—'}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
                                              Responsável
                                            </span>
                                            <span className="font-medium text-foreground">
                                              {c.responsavel_nome || '—'}
                                            </span>
                                          </div>
                                          <div>
                                            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
                                              Executor
                                            </span>
                                            <span className="font-medium text-foreground">
                                              {c.executor_nome || '—'}
                                            </span>
                                          </div>
                                          <div className="sm:col-span-2 flex items-center gap-4 text-xs font-mono">
                                            <span>
                                              Pasta Cliente:{' '}
                                              <strong className="text-foreground">
                                                {c.pasta_cliente || '—'}
                                              </strong>
                                            </span>
                                            <span>
                                              Pasta Ricci:{' '}
                                              <strong className="text-primary">
                                                {c.pasta_ricci || '—'}
                                              </strong>
                                            </span>
                                          </div>
                                        </div>

                                        {/* Lista Completa de Providências */}
                                        <div className="space-y-2.5">
                                          <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                                              <Briefcase className="w-3.5 h-3.5 text-primary" />
                                              <span>
                                                Providências Vinculadas (
                                                {c.providencias?.length || 0})
                                              </span>
                                            </h4>
                                            <div className="flex items-center gap-2">
                                              {c.providencias &&
                                                c.providencias.length > 0 &&
                                                !c.providencias.some(
                                                  (p) => !p.deleted_at && !p.status?.finaliza,
                                                ) && (
                                                  <Badge
                                                    variant="secondary"
                                                    className="bg-muted text-muted-foreground border-border text-[11px] font-semibold"
                                                  >
                                                    Sem providências abertas
                                                  </Badge>
                                                )}
                                              <span className="text-[11px] text-muted-foreground">
                                                Ordenadas por prazo decrescente
                                              </span>
                                            </div>
                                          </div>

                                          {!c.providencias || c.providencias.length === 0 ? (
                                            <p className="text-muted-foreground italic text-xs p-3 rounded-lg bg-muted/20 border border-border/40">
                                              Sem providências cadastradas
                                            </p>
                                          ) : (
                                            <div className="space-y-2">
                                              {[...c.providencias]
                                                .sort((a, b) => {
                                                  // Prazo de conclusão decrescente (maior prazo primeiro)
                                                  // Sem prazo no final
                                                  // Empate de prazo: maior ordem primeiro
                                                  const pA = a.prazo_conclusao
                                                    ? a.prazo_conclusao.split('T')[0]
                                                    : ''
                                                  const pB = b.prazo_conclusao
                                                    ? b.prazo_conclusao.split('T')[0]
                                                    : ''
                                                  if (!pA && !pB)
                                                    return (b.ordem ?? 0) - (a.ordem ?? 0)
                                                  if (!pA) return 1
                                                  if (!pB) return -1
                                                  if (pA !== pB) return pB.localeCompare(pA)
                                                  return (b.ordem ?? 0) - (a.ordem ?? 0)
                                                })
                                                .map((p, idx) => {
                                                  const pFinalizada = Boolean(p.status?.finaliza)
                                                  const pVencida = isPrazoOverdue(
                                                    p.prazo_conclusao,
                                                    p.status,
                                                  )
                                                  const pStatusBadge = getStatusBadgeStyle(
                                                    p.status?.codigo,
                                                    p.status?.finaliza,
                                                  )

                                                  return (
                                                    <div
                                                      key={p.id || idx}
                                                      className={cn(
                                                        'p-3 rounded-xl border space-y-2 transition-all',
                                                        pFinalizada
                                                          ? 'bg-muted/25 border-border/40 opacity-75'
                                                          : 'bg-card border-border/70 shadow-xs',
                                                      )}
                                                    >
                                                      <div className="flex items-center justify-between gap-2 flex-wrap">
                                                        <div className="flex items-center gap-2">
                                                          <span
                                                            className={cn(
                                                              'text-[11px] font-bold',
                                                              pFinalizada
                                                                ? 'text-muted-foreground'
                                                                : 'text-primary',
                                                            )}
                                                          >
                                                            #{idx + 1}
                                                          </span>
                                                          <span
                                                            className={cn(
                                                              'font-bold inline-flex items-center gap-1',
                                                              pFinalizada
                                                                ? 'text-muted-foreground line-through decoration-muted-foreground/60'
                                                                : pVencida
                                                                  ? 'text-destructive'
                                                                  : 'text-foreground',
                                                            )}
                                                          >
                                                            {pVencida && !pFinalizada && (
                                                              <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                                                            )}
                                                            <span>
                                                              Prazo:{' '}
                                                              {formatDateBR(p.prazo_conclusao)}
                                                            </span>
                                                          </span>
                                                          {p.tipo_prazo && (
                                                            <Badge
                                                              variant="outline"
                                                              className={cn(
                                                                'text-[10px] font-normal',
                                                                pFinalizada &&
                                                                  'text-muted-foreground border-border/50 bg-transparent',
                                                              )}
                                                            >
                                                              {p.tipo_prazo.nome}
                                                            </Badge>
                                                          )}
                                                        </div>

                                                        {/* Seletor rápido de Status da Providência e Data de Conclusão */}
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                          {updatingProvidenciaIds[p.id] && (
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                                                          )}
                                                          <Select
                                                            value={p.status_id}
                                                            disabled={Boolean(
                                                              updatingProvidenciaIds[p.id],
                                                            )}
                                                            onValueChange={(novoStatusId) => {
                                                              if (novoStatusId) {
                                                                handleSelectProvidenciaStatus(
                                                                  p.id,
                                                                  novoStatusId,
                                                                  c.id,
                                                                )
                                                              }
                                                            }}
                                                          >
                                                            <SelectTrigger
                                                              className={cn(
                                                                'h-7 px-2 py-0 rounded-md text-[10px] font-semibold border inline-flex items-center gap-1 shadow-none transition-colors w-auto min-w-[120px]',
                                                                pStatusBadge.bg,
                                                                pStatusBadge.text,
                                                                pStatusBadge.border,
                                                                pFinalizada && 'opacity-80',
                                                                updatingProvidenciaIds[p.id] &&
                                                                  'opacity-60 cursor-not-allowed',
                                                              )}
                                                            >
                                                              <span
                                                                className={cn(
                                                                  'w-1.5 h-1.5 rounded-full shrink-0',
                                                                  pStatusBadge.dot,
                                                                )}
                                                              />
                                                              <SelectValue placeholder="Status">
                                                                {statusProvidenciaList.find(
                                                                  (s) => s.id === p.status_id,
                                                                )?.nome ||
                                                                  p.status?.nome ||
                                                                  'Selecionar'}
                                                              </SelectValue>
                                                            </SelectTrigger>
                                                            <SelectContent className="rounded-xl">
                                                              {[...statusProvidenciaList]
                                                                .sort(
                                                                  (a, b) =>
                                                                    (a.ordem ?? 0) - (b.ordem ?? 0),
                                                                )
                                                                .map((sp) => (
                                                                  <SelectItem
                                                                    key={sp.id}
                                                                    value={sp.id}
                                                                    className="text-xs"
                                                                  >
                                                                    {sp.nome}
                                                                  </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                          </Select>

                                                          {/* Exibição em somente leitura da Data de Conclusão quando a providência possuir data */}
                                                          {p.data_conclusao && (
                                                            <span
                                                              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border bg-muted/40 text-foreground border-border/60"
                                                              title="Data de Conclusão da Providência"
                                                            >
                                                              <CalendarIcon className="w-3 h-3 text-muted-foreground" />
                                                              <span>
                                                                Conclusão:{' '}
                                                                <strong>
                                                                  {formatDateBR(p.data_conclusao)}
                                                                </strong>
                                                              </span>
                                                            </span>
                                                          )}
                                                        </div>
                                                      </div>

                                                      {/* Texto Integral da Providência sem corte */}
                                                      <div
                                                        className={cn(
                                                          'p-2.5 rounded-lg text-xs leading-relaxed whitespace-pre-wrap',
                                                          pFinalizada
                                                            ? 'bg-muted/15 border border-border/30 line-through text-muted-foreground/80 decoration-muted-foreground/60'
                                                            : 'bg-muted/30 border border-border/50 text-foreground',
                                                        )}
                                                      >
                                                        {p.providencia}
                                                      </div>
                                                    </div>
                                                  )
                                                })}
                                            </div>
                                          )}
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
                        const proxProv = c.proxima_providencia
                        const proxVencida = isPrazoOverdue(
                          proxProv?.prazo_conclusao,
                          proxProv?.status,
                        )
                        const statusBadge = getStatusBadgeStyle(
                          c.status?.codigo,
                          c.status?.finaliza,
                        )

                        return (
                          <div
                            key={c.id}
                            className="p-4 space-y-3 hover:bg-muted/20 transition-colors"
                          >
                            {/* Linha 1: Pastas Cliente / Ricci e Status */}
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 font-mono text-xs">
                                {c.pasta_cliente && (
                                  <span
                                    className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-semibold"
                                    title="Pasta Cliente"
                                  >
                                    {c.pasta_cliente}
                                  </span>
                                )}
                                {c.pasta_ricci && (
                                  <span
                                    className="px-2 py-0.5 rounded bg-primary/10 text-primary font-bold"
                                    title="Pasta Ricci"
                                  >
                                    [{c.pasta_ricci}]
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

                            {/* Linha 2: Identificação do Caso com Badge de Caso */}
                            <div
                              onClick={() => toggleRowExpanded(c.id)}
                              className="cursor-pointer group space-y-1"
                            >
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] font-bold px-1.5 py-0 rounded bg-primary/10 text-primary border-transparent"
                                >
                                  Caso {c.numero_caso ?? '—'}
                                </Badge>
                              </div>
                              <h4 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors leading-snug">
                                {c.identificacao_caso}
                              </h4>
                              {proxProv?.providencia ? (
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                                  <strong>Próxima Providência:</strong> {proxProv.providencia}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground/60 italic mt-1 leading-relaxed">
                                  Sem providência pendente
                                </p>
                              )}
                            </div>

                            {/* Linha 3: Prazo Providência, Responsável e Executor */}
                            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/40">
                              <div>
                                <span className="text-[10px] text-muted-foreground block font-medium">
                                  Prazo Providência:
                                </span>
                                {proxProv?.prazo_conclusao ? (
                                  <span
                                    className={cn(
                                      'font-bold inline-flex items-center gap-1',
                                      proxVencida ? 'text-destructive' : 'text-foreground',
                                    )}
                                  >
                                    {proxVencida && (
                                      <AlertTriangle className="w-3 h-3 text-destructive" />
                                    )}
                                    <span>{formatDateBR(proxProv.prazo_conclusao)}</span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/60">—</span>
                                )}
                              </div>

                              <div>
                                <span className="text-[10px] text-muted-foreground block font-medium">
                                  Prazo Controle:
                                </span>
                                {c.prazo_conclusao ? (
                                  <span className="font-semibold text-foreground">
                                    {formatDateBR(c.prazo_conclusao)}
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
                                    <span>Ver detalhes ({c.providencias?.length || 0})</span>
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
                              <div className="p-3.5 bg-muted/30 border border-border/60 rounded-xl space-y-3 text-xs mt-2 animate-fade-in">
                                <div className="flex items-center justify-between pb-2 border-b border-border/40">
                                  <span className="text-[11px] font-bold uppercase text-primary">
                                    Caso nº {c.numero_caso ?? '—'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <span className="text-[10px] font-bold text-muted-foreground block">
                                      Data de Autorização
                                    </span>
                                    <span>
                                      {c.data_autorizacao ? formatDateBR(c.data_autorizacao) : '—'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold text-muted-foreground block">
                                      Prazo do Controle
                                    </span>
                                    <span>
                                      {c.prazo_conclusao ? formatDateBR(c.prazo_conclusao) : '—'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold text-muted-foreground block">
                                      Responsável
                                    </span>
                                    <span>{c.responsavel_nome || '—'}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold text-muted-foreground block">
                                      Executor
                                    </span>
                                    <span>{c.executor_nome || '—'}</span>
                                  </div>
                                </div>

                                <div className="space-y-2 pt-2 border-t border-border/50">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase text-muted-foreground block">
                                      Providências ({c.providencias?.length || 0})
                                    </span>
                                    {(!c.providencias ||
                                      c.providencias.length === 0 ||
                                      !c.providencias.some(
                                        (p) => !p.deleted_at && !p.status?.finaliza,
                                      )) && (
                                      <Badge
                                        variant="secondary"
                                        className="bg-muted text-muted-foreground border-border text-[10px] font-medium"
                                      >
                                        Sem providências abertas
                                      </Badge>
                                    )}
                                  </div>
                                  {[...(c.providencias || [])]
                                    .sort((a, b) => {
                                      const pA = a.prazo_conclusao
                                        ? a.prazo_conclusao.split('T')[0]
                                        : ''
                                      const pB = b.prazo_conclusao
                                        ? b.prazo_conclusao.split('T')[0]
                                        : ''
                                      if (!pA && !pB) return (b.ordem ?? 0) - (a.ordem ?? 0)
                                      if (!pA) return 1
                                      if (!pB) return -1
                                      if (pA !== pB) return pB.localeCompare(pA)
                                      return (b.ordem ?? 0) - (a.ordem ?? 0)
                                    })
                                    .map((p, idx) => {
                                      const pFinalizadaMobile = Boolean(p.status?.finaliza)
                                      const pStatusBadgeMobile = getStatusBadgeStyle(
                                        p.status?.codigo,
                                        p.status?.finaliza,
                                      )
                                      return (
                                        <div
                                          key={p.id || idx}
                                          className={cn(
                                            'p-2.5 rounded-lg border space-y-1.5 transition-opacity',
                                            pFinalizadaMobile
                                              ? 'bg-muted/30 border-border/30 opacity-75'
                                              : 'bg-background border-border/40',
                                          )}
                                        >
                                          <div className="flex items-center justify-between text-[11px] gap-2 flex-wrap">
                                            <span
                                              className={cn(
                                                'font-semibold',
                                                pFinalizadaMobile
                                                  ? 'text-muted-foreground line-through decoration-muted-foreground/60'
                                                  : 'text-primary',
                                              )}
                                            >
                                              Prazo: {formatDateBR(p.prazo_conclusao)}
                                            </span>

                                            {/* Seletor rápido de Status da Providência no mobile */}
                                            <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
                                              {updatingProvidenciaIds[p.id] && (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                                              )}
                                              <Select
                                                value={p.status_id}
                                                disabled={Boolean(updatingProvidenciaIds[p.id])}
                                                onValueChange={(novoStatusId) => {
                                                  if (novoStatusId) {
                                                    handleSelectProvidenciaStatus(
                                                      p.id,
                                                      novoStatusId,
                                                      c.id,
                                                    )
                                                  }
                                                }}
                                              >
                                                <SelectTrigger
                                                  className={cn(
                                                    'h-6 px-1.5 py-0 rounded text-[10px] font-medium border inline-flex items-center gap-1 shadow-none transition-colors w-auto min-w-[110px]',
                                                    pStatusBadgeMobile.bg,
                                                    pStatusBadgeMobile.text,
                                                    pStatusBadgeMobile.border,
                                                    updatingProvidenciaIds[p.id] &&
                                                      'opacity-60 cursor-not-allowed',
                                                  )}
                                                >
                                                  <span
                                                    className={cn(
                                                      'w-1.5 h-1.5 rounded-full shrink-0',
                                                      pStatusBadgeMobile.dot,
                                                    )}
                                                  />
                                                  <SelectValue placeholder="Status">
                                                    {statusProvidenciaList.find(
                                                      (s) => s.id === p.status_id,
                                                    )?.nome ||
                                                      p.status?.nome ||
                                                      'Selecionar'}
                                                  </SelectValue>
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl">
                                                  {[...statusProvidenciaList]
                                                    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
                                                    .map((sp) => (
                                                      <SelectItem
                                                        key={sp.id}
                                                        value={sp.id}
                                                        className="text-xs"
                                                      >
                                                        {sp.nome}
                                                      </SelectItem>
                                                    ))}
                                                </SelectContent>
                                              </Select>
                                            </div>
                                          </div>

                                          {/* Visualização de Data de Conclusão no mobile quando a providência tiver data */}
                                          {p.data_conclusao && (
                                            <div className="pt-0.5">
                                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border bg-muted/40 text-foreground border-border/60">
                                                <CalendarIcon className="w-3 h-3 text-muted-foreground" />
                                                <span>
                                                  Conclusão:{' '}
                                                  <strong>{formatDateBR(p.data_conclusao)}</strong>
                                                </span>
                                              </span>
                                            </div>
                                          )}
                                          <p
                                            className={cn(
                                              'whitespace-pre-wrap text-xs',
                                              pFinalizadaMobile
                                                ? 'line-through text-muted-foreground/75 decoration-muted-foreground/60'
                                                : 'text-foreground',
                                            )}
                                          >
                                            {p.providencia}
                                          </p>
                                        </div>
                                      )
                                    })}
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
        onOpenChange={(isOpen) => {
          setModalOpen(isOpen)
          if (!isOpen) {
            setModalInitialTab('dados')
            setModalAutoAddNewProvidencia(false)
          }
        }}
        controleToEdit={controleToEdit}
        statusList={statusList}
        statusProvidenciaList={statusProvidenciaList}
        tiposPrazoList={tiposPrazoList}
        usuariosAtivos={usuariosAtivos}
        initialTab={modalInitialTab}
        autoAddNewProvidencia={modalAutoAddNewProvidencia}
        onSaved={() => {
          refreshControles()
        }}
      />

      {/* Modal 1 de pós-encerramento de providência: Sem mais providências nesse controle */}
      <AlertDialog
        open={dialogNovaProvidenciaOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDialogNovaProvidenciaOpen(false)
            setControlePendenteAcao(null)
          }
        }}
      >
        <AlertDialogContent className="rounded-2xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-foreground">
              Sem mais providências nesse controle
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Deseja inserir uma nova providência?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex sm:justify-end gap-2 pt-2">
            <AlertDialogCancel
              onClick={handleRejectNovaProvidencia}
              className="rounded-xl px-4 h-10 border-border"
            >
              Não
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmNovaProvidencia}
              className="rounded-xl px-5 h-10 bg-primary hover:bg-[#4A4AC2] text-primary-foreground font-semibold"
            >
              Sim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal 2 de pós-encerramento de providência: Encerrar controle */}
      <AlertDialog
        open={dialogEncerrarControleOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen && !encerrandoControle) {
            setDialogEncerrarControleOpen(false)
            setControlePendenteAcao(null)
          }
        }}
      >
        <AlertDialogContent className="rounded-2xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-foreground">
              Encerrar controle
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Deseja encerrar esse controle?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex sm:justify-end gap-2 pt-2">
            <AlertDialogCancel
              disabled={encerrandoControle}
              onClick={handleRejectEncerrarControle}
              className="rounded-xl px-4 h-10 border-border"
            >
              Não
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={encerrandoControle}
              onClick={handleConfirmEncerrarControle}
              className="rounded-xl px-5 h-10 bg-primary hover:bg-[#4A4AC2] text-primary-foreground font-semibold"
            >
              {encerrandoControle ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Encerrando...
                </span>
              ) : (
                'Sim'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação de Arquivamento */}
      <DeleteConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        onConfirm={handleConfirmArchive}
        title="Deseja arquivar este controle?"
        description={`O controle "${controleToArchive?.identificacao_caso}" será movido para Controles Arquivados e poderá ser desarquivado a qualquer momento.`}
        confirmButtonText={archiving ? 'Arquivando...' : 'Arquivar'}
      />
    </div>
  )
}
