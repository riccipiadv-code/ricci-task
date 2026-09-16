import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ArrowRight,
  Plus,
  Sparkles,
  Calendar,
  RefreshCw,
  FolderOpen,
  Filter,
  X,
  Search,
  User,
  ListTodo,
  Hourglass,
  Layers,
  ChevronRight,
  FileSpreadsheet,
} from 'lucide-react'
import { useControles } from '@/hooks/useControles'
import { TaskControleRecord, TaskProvidenciaRecord } from '@/types/task'
import { ControleModal } from '@/components/ControleModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  formatDateBR,
  getTimeOfDayGreeting,
  getFullDateFormattedBR,
  getStatusBadgeStyle,
  getLocalDateStr,
} from '@/lib/formatters'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

// Tipo auxiliar para cada item de Providência no Dashboard contextualizado ao seu Controle
interface DashboardProvidenciaItem {
  id: string
  providencia: TaskProvidenciaRecord
  controle: TaskControleRecord
  isProxima: boolean
}

type PeriodoPrazoFilter = 'todos' | 'hoje' | 'proximos_7' | 'proximos_30'

/**
 * Remove acentuação e converte para minúsculas para buscas textuais
 */
function normalizeText(text?: string | null): string {
  if (!text) return ''
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Helper para adicionar dias à data YYYY-MM-DD mantendo fuso local
 */
function addDaysToDateStr(baseDateStr: string, days: number): string {
  const parts = baseDateStr.split('-')
  if (parts.length !== 3) return baseDateStr
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10) - 1
  const day = parseInt(parts[2], 10)
  const date = new Date(year, month, day)
  date.setDate(date.getDate() + days)
  return getLocalDateStr(date)
}

export default function Index() {
  const {
    controles,
    statusList,
    statusProvidenciaList,
    tiposPrazoList,
    usuariosAtivos,
    loading,
    refreshControles,
  } = useControles()

  const { user } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [controleToEdit, setControleToEdit] = useState<TaskControleRecord | null>(null)

  // Filtros operacionais do Dashboard
  const [periodoFilter, setPeriodoFilter] = useState<PeriodoPrazoFilter>('todos')
  const [responsavelFilter, setResponsavelFilter] = useState<string>('todos')
  const [executorFilter, setExecutorFilter] = useState<string>('todos')
  const [nomeControleFilter, setNomeControleFilter] = useState<string>('')

  const greeting = getTimeOfDayGreeting()
  const fullDate = getFullDateFormattedBR()

  // Data local de referência calculada com getLocalDateStr
  const todayStr = useMemo(() => getLocalDateStr(), [])
  const in7DaysStr = useMemo(() => addDaysToDateStr(todayStr, 7), [todayStr])
  const in30DaysStr = useMemo(() => addDaysToDateStr(todayStr, 30), [todayStr])

  // Nome amigável derivado do e-mail do usuário
  const userDisplayName = useMemo(() => {
    if (!user?.email) return 'Ricci'
    const namePart = user.email.split('@')[0]
    return namePart
      .split('.')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ')
  }, [user?.email])

  // 1. Controles não finalizados (status.finaliza !== true)
  const controlesNaoFinalizados = useMemo(() => {
    return controles.filter((c) => !c.status?.finaliza)
  }, [controles])

  // Resumo discreto de Controles (Controles ativos, concluídos e cancelados)
  const resumoControles = useMemo(() => {
    let ativos = 0
    let concluidos = 0
    let cancelados = 0

    for (const c of controles) {
      if (!c.status?.finaliza) {
        ativos++
      } else {
        const codigo = c.status?.codigo?.toLowerCase() || ''
        const nome = c.status?.nome?.toLowerCase() || ''
        if (codigo === 'cancelado' || nome.includes('cancel')) {
          cancelados++
        } else {
          concluidos++
        }
      }
    }

    return { ativos, concluidos, cancelados, total: controles.length }
  }, [controles])

  // 2. Extração de todas as providências abertas de Controles não finalizados
  const providenciasAbertasBase = useMemo<DashboardProvidenciaItem[]>(() => {
    const list: DashboardProvidenciaItem[] = []

    for (const c of controlesNaoFinalizados) {
      const provs = c.providencias || []
      // Providências cujo status não finaliza
      const provsAbertas = provs.filter((p) => !p.status?.finaliza)

      // Identifica a próxima providência aberta deste controle (primeira ordenada por prazo crescente)
      // Como c.proxima_providencia já é calculada no controleService ou podemos conferir pelo ID:
      const proximaId = c.proxima_providencia?.id

      for (const p of provsAbertas) {
        list.push({
          id: p.id,
          providencia: p,
          controle: c,
          isProxima: p.id === proximaId,
        })
      }
    }

    return list
  }, [controlesNaoFinalizados])

  // 3. Aplicação dos Filtros Operacionais do Dashboard
  // - Período de prazo: Hoje; Próximos 7 dias; Próximos 30 dias; Todos
  // - Responsável
  // - Executor
  // - Nome do Controle (busca textual/normalizada em nome_controle e identificação do caso)
  const providenciasFiltradas = useMemo<DashboardProvidenciaItem[]>(() => {
    const qNome = normalizeText(nomeControleFilter)

    return providenciasAbertasBase.filter((item) => {
      const { providencia, controle } = item
      const prazo = providencia.prazo_conclusao ? providencia.prazo_conclusao.split('T')[0] : ''

      // Filtro de Responsável
      if (responsavelFilter !== 'todos' && controle.responsavel_usuario_id !== responsavelFilter) {
        return false
      }

      // Filtro de Executor
      if (executorFilter !== 'todos' && controle.executor_usuario_id !== executorFilter) {
        return false
      }

      // Filtro por Nome do Controle / Identificação do Caso
      if (qNome) {
        const nomeCtrl = normalizeText(controle.nome_controle)
        const caso = normalizeText(controle.identificacao_caso)
        const cliente = normalizeText(controle.pasta_cliente)
        const ricci = normalizeText(controle.pasta_ricci)
        const textoProv = normalizeText(providencia.providencia)
        if (
          !nomeCtrl.includes(qNome) &&
          !caso.includes(qNome) &&
          !cliente.includes(qNome) &&
          !ricci.includes(qNome) &&
          !textoProv.includes(qNome)
        ) {
          return false
        }
      }

      // Filtro de Período de Prazo
      if (periodoFilter === 'hoje') {
        if (prazo !== todayStr) return false
      } else if (periodoFilter === 'proximos_7') {
        // Entre amanhã e próximos 7 dias
        if (!prazo || prazo <= todayStr || prazo > in7DaysStr) return false
      } else if (periodoFilter === 'proximos_30') {
        // Entre amanhã e próximos 30 dias
        if (!prazo || prazo <= todayStr || prazo > in30DaysStr) return false
      }

      return true
    })
  }, [
    providenciasAbertasBase,
    responsavelFilter,
    executorFilter,
    nomeControleFilter,
    periodoFilter,
    todayStr,
    in7DaysStr,
    in30DaysStr,
  ])

  // 4. Indicadores Operacionais (Calculados a partir dos dados filtrados)
  // - Providências vencidas: prazo < todayStr
  // - Vencem hoje: prazo === todayStr
  // - Próximos 7 dias: prazo > todayStr && prazo <= in7DaysStr
  // - Providências abertas: total de providências abertas consideradas no escopo
  const indicadores = useMemo(() => {
    let vencidas = 0
    let vencemHoje = 0
    let proximos7Dias = 0

    for (const item of providenciasFiltradas) {
      const prazo = item.providencia.prazo_conclusao
        ? item.providencia.prazo_conclusao.split('T')[0]
        : null

      if (!prazo) continue

      if (prazo < todayStr) {
        vencidas++
      } else if (prazo === todayStr) {
        vencemHoje++
      } else if (prazo <= in7DaysStr) {
        proximos7Dias++
      }
    }

    return {
      vencidas,
      vencemHoje,
      proximos7Dias,
      totalAbertas: providenciasFiltradas.length,
    }
  }, [providenciasFiltradas, todayStr, in7DaysStr])

  // 5. Seção "Próximas Providências"
  // - Listar Providências abertas de Controles não finalizados
  // - Ordenar sempre nesta sequência:
  //   1) vencidas (ordem crescente de prazo);
  //   2) vencem hoje;
  //   3) próximas, por prazo crescente;
  // - Providências sem prazo vêm ao final.
  // - Mostrar inicialmente até 10 itens
  const proximasProvidenciasLista = useMemo(() => {
    const list = [...providenciasFiltradas]

    list.sort((a, b) => {
      const pA = a.providencia.prazo_conclusao ? a.providencia.prazo_conclusao.split('T')[0] : ''
      const pB = b.providencia.prazo_conclusao ? b.providencia.prazo_conclusao.split('T')[0] : ''

      const getTier = (p: string) => {
        if (!p) return 4
        if (p < todayStr) return 1
        if (p === todayStr) return 2
        return 3
      }

      const tierA = getTier(pA)
      const tierB = getTier(pB)

      if (tierA !== tierB) {
        return tierA - tierB
      }

      // Mesmo tier: ordem cronológica crescente de prazo
      if (pA && pB && pA !== pB) {
        return pA.localeCompare(pB)
      }

      // Desempate: ordem da providência e updated_at do controle
      if (a.providencia.ordem !== b.providencia.ordem) {
        return a.providencia.ordem - b.providencia.ordem
      }
      return new Date(b.controle.updated_at).getTime() - new Date(a.controle.updated_at).getTime()
    })

    return list
  }, [providenciasFiltradas, todayStr])

  // 6. Seção "Demandas de Atenção Prioritária"
  // - Apenas Providências abertas vencidas (prazo < todayStr)
  // - Ordenar da mais atrasada para a menos atrasada (prazo crescente, ou seja, data mais antiga primeiro)
  // - Exibir quantidade total real de providências vencidas
  // - Mostrar no máximo 5 itens na visualização e link quando houver mais itens
  const demandasAtencaoPrioritaria = useMemo(() => {
    const vencidas = providenciasFiltradas.filter((item) => {
      const prazo = item.providencia.prazo_conclusao
        ? item.providencia.prazo_conclusao.split('T')[0]
        : null
      return prazo ? prazo < todayStr : false
    })

    // Mais atrasada primeiro (ex.: 2026-03-01 vem antes de 2026-03-10)
    vencidas.sort((a, b) => {
      const pA = a.providencia.prazo_conclusao ? a.providencia.prazo_conclusao.split('T')[0] : ''
      const pB = b.providencia.prazo_conclusao ? b.providencia.prazo_conclusao.split('T')[0] : ''
      return pA.localeCompare(pB)
    })

    return vencidas
  }, [providenciasFiltradas, todayStr])

  // 7. Seção "Situação das Providências"
  // - Distribuição das Providências abertas por Status da Providência
  // - Considerar somente Providências de Controles não finalizados
  // - Exibir apenas status não finalizadores
  // - Ordenar conforme a ordem cadastrada em task_status_providencia
  // - Lista visual ou barras horizontais simples
  // - Destaque visual moderado aos status que representem espera ou urgência
  const distribuicaoStatusProvidencia = useMemo(() => {
    // Apenas status de providência ativos e não finalizadores
    const statusValidos = statusProvidenciaList
      .filter((st) => !st.finaliza && st.ativo)
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))

    // Contagem de providências filtradas por status_id
    const contagemPorStatus: Record<string, number> = {}
    for (const item of providenciasFiltradas) {
      const stId = item.providencia.status_id
      contagemPorStatus[stId] = (contagemPorStatus[stId] || 0) + 1
    }

    const totalAbertas = providenciasFiltradas.length

    return statusValidos.map((st) => {
      const count = contagemPorStatus[st.id] || 0
      const percent = totalAbertas > 0 ? Math.round((count / totalAbertas) * 100) : 0

      // Destaque visual moderado para espera ou urgência
      const cod = st.codigo?.toLowerCase() || ''
      const nomeLower = st.nome.toLowerCase()
      const isUrgente = cod === 'urgente' || nomeLower.includes('urgente')
      const isAguardando = cod.includes('aguardando') || nomeLower.includes('aguardando')
      const isSuspenso = cod === 'suspenso' || nomeLower.includes('suspenso')

      return {
        id: st.id,
        nome: st.nome,
        codigo: st.codigo,
        count,
        percent,
        isUrgente,
        isAguardando,
        isSuspenso,
      }
    })
  }, [statusProvidenciaList, providenciasFiltradas])

  const handleOpenCreate = () => {
    setControleToEdit(null)
    setModalOpen(true)
  }

  const handleOpenEdit = (c: TaskControleRecord) => {
    setControleToEdit(c)
    setModalOpen(true)
  }

  const hasActiveFilters =
    periodoFilter !== 'todos' ||
    responsavelFilter !== 'todos' ||
    executorFilter !== 'todos' ||
    nomeControleFilter.trim() !== ''

  const handleClearFilters = () => {
    setPeriodoFilter('todos')
    setResponsavelFilter('todos')
    setExecutorFilter('todos')
    setNomeControleFilter('')
  }

  return (
    <div className="space-y-7 animate-fade-in pb-10">
      {/* Cabeçalho de Boas-vindas e Ações Principais */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary font-semibold text-xs sm:text-sm mb-1 uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>Painel Operacional • Ricci Task</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            {greeting}, {userDisplayName} 👋
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1 font-normal">
            {fullDate} • Foco na execução e acompanhamento de Providências
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refreshControles()}
            disabled={loading}
            className="h-11 rounded-xl px-3.5 border-border hover:bg-muted"
            title="Atualizar dados do Supabase"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>

          <Button
            onClick={handleOpenCreate}
            className="h-11 px-5 rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-transform hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4 mr-2 stroke-[2.5]" />
            Novo Controle
          </Button>
        </div>
      </div>

      {/* Barra de Filtros Operacionais do Dashboard */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-primary" />
            <span>Filtros Operacionais</span>
            {hasActiveFilters && (
              <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                Ativos
              </span>
            )}
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
            >
              <X className="w-3 h-3 mr-1" />
              Limpar filtros
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Período de Prazo */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground">
              Período de Prazo
            </label>
            <Select
              value={periodoFilter}
              onValueChange={(val) => setPeriodoFilter(val as PeriodoPrazoFilter)}
            >
              <SelectTrigger className="h-9 text-xs rounded-xl bg-background border-border">
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os prazos</SelectItem>
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="proximos_7">Próximos 7 dias</SelectItem>
                <SelectItem value="proximos_30">Próximos 30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 2. Responsável */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground">Responsável</label>
            <Select value={responsavelFilter} onValueChange={(val) => setResponsavelFilter(val)}>
              <SelectTrigger className="h-9 text-xs rounded-xl bg-background border-border">
                <SelectValue placeholder="Todos os responsáveis" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os responsáveis</SelectItem>
                {usuariosAtivos.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 3. Executor */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground">Executor</label>
            <Select value={executorFilter} onValueChange={(val) => setExecutorFilter(val)}>
              <SelectTrigger className="h-9 text-xs rounded-xl bg-background border-border">
                <SelectValue placeholder="Todos os executores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os executores</SelectItem>
                {usuariosAtivos.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 4. Busca por Nome do Controle / Caso */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground">
              Controle / Caso / Providência
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={nomeControleFilter}
                onChange={(e) => setNomeControleFilter(e.target.value)}
                placeholder="Filtrar por nome ou caso..."
                className="h-9 pl-8 text-xs rounded-xl bg-background border-border"
              />
              {nomeControleFilter && (
                <button
                  type="button"
                  onClick={() => setNomeControleFilter('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4 Indicadores Operacionais Centrados em Providências:
          1. Providências vencidas (prazo < hoje)
          2. Vencem hoje (prazo == hoje)
          3. Próximos 7 dias (hoje < prazo <= hoje + 7 dias)
          4. Providências abertas (total cujo status não finaliza)
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Providências Vencidas */}
        <div
          className={cn(
            'group relative bg-card border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-0.5',
            indicadores.vencidas > 0 ? 'border-red-500/40 bg-red-500/[0.02]' : 'border-border',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-destructive">Providências vencidas</span>
            <div className="h-9 w-9 rounded-xl bg-red-500/10 text-destructive flex items-center justify-center transition-transform group-hover:scale-110">
              <AlertTriangle className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-destructive tracking-tight">
              {indicadores.vencidas}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">atenção imediata</span>
          </div>
        </div>

        {/* Card 2: Vencem hoje */}
        <div
          className={cn(
            'group relative bg-card border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-0.5',
            indicadores.vencemHoje > 0
              ? 'border-amber-500/40 bg-amber-500/[0.02]'
              : 'border-border',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Vencem hoje
            </span>
            <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <Clock className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 dark:text-amber-400 tracking-tight">
              {indicadores.vencemHoje}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">concluir no dia</span>
          </div>
        </div>

        {/* Card 3: Próximos 7 dias */}
        <div className="group relative bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Próximos 7 dias</span>
            <div className="h-9 w-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <CalendarClock className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {indicadores.proximos7Dias}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">nesta semana</span>
          </div>
        </div>

        {/* Card 4: Providências abertas */}
        <div className="group relative bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              Providências abertas
            </span>
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <ListTodo className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {indicadores.totalAbertas}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">em andamento</span>
          </div>
        </div>
      </div>

      {/* Grid Central: Demandas de Atenção Prioritária & Situação das Providências */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Painel: Situação das Providências (1 coluna) */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Hourglass className="w-4 h-4 text-primary" />
                  <span>Situação das Providências</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Distribuição das providências abertas por status
                </p>
              </div>
            </div>

            {/* Lista visual com barras de progresso horizontais */}
            <div className="mt-5 space-y-3.5">
              {distribuicaoStatusProvidencia.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  Nenhum status configurado.
                </p>
              ) : (
                distribuicaoStatusProvidencia.map((st) => {
                  let barColor = 'bg-primary'
                  let badgeClass = 'text-muted-foreground bg-muted'

                  if (st.isUrgente) {
                    barColor = 'bg-red-500'
                    badgeClass = 'text-red-700 dark:text-red-300 bg-red-500/10 font-bold'
                  } else if (st.isAguardando) {
                    barColor = 'bg-amber-500'
                    badgeClass = 'text-amber-700 dark:text-amber-300 bg-amber-500/10 font-bold'
                  } else if (st.isSuspenso) {
                    barColor = 'bg-slate-400'
                    badgeClass = 'text-slate-600 dark:text-slate-300 bg-slate-500/10'
                  }

                  return (
                    <div key={st.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground truncate">{st.nome}</span>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span
                            className={cn(
                              'text-[11px] px-2 py-0.5 rounded-md font-semibold',
                              badgeClass,
                            )}
                          >
                            {st.count}
                          </span>
                          <span className="text-[10px] text-muted-foreground w-8 text-right font-medium">
                            {st.percent}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-muted/60 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            barColor,
                          )}
                          style={{ width: `${st.percent}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Resumo Discreto de Controles (Secundário, abaixo do painel) */}
          <div className="pt-5 mt-6 border-t border-border space-y-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block">
              Resumo do Acervo de Controles
            </span>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-muted/40 rounded-xl p-2 border border-border/50">
                <span className="text-[10px] text-muted-foreground font-medium block">Ativos</span>
                <span className="text-sm font-bold text-foreground">{resumoControles.ativos}</span>
              </div>
              <div className="bg-muted/40 rounded-xl p-2 border border-border/50">
                <span className="text-[10px] text-muted-foreground font-medium block">
                  Concluídos
                </span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {resumoControles.concluidos}
                </span>
              </div>
              <div className="bg-muted/40 rounded-xl p-2 border border-border/50">
                <span className="text-[10px] text-muted-foreground font-medium block">
                  Cancelados
                </span>
                <span className="text-sm font-bold text-slate-600 dark:text-slate-400">
                  {resumoControles.cancelados}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Painel: Demandas de Atenção Prioritária (2 colunas) */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 shadow-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <span>Demandas de Atenção Prioritária</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Providências abertas com prazo de conclusão vencido
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-500/10 text-destructive border border-red-500/20">
                {demandasAtencaoPrioritaria.length} providência(s) vencida(s)
              </span>
            </div>

            <div className="my-4 divide-y divide-border">
              {demandasAtencaoPrioritaria.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground space-y-1.5">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                  <p className="font-semibold text-foreground text-sm">Tudo em dia!</p>
                  <p>Nenhuma providência aberta possui prazo vencido no momento.</p>
                </div>
              ) : (
                demandasAtencaoPrioritaria.slice(0, 5).map((item) => {
                  const p = item.providencia
                  const c = item.controle
                  const statusProvBadge = getStatusBadgeStyle(p.status?.codigo, p.status?.finaliza)

                  return (
                    <div
                      key={p.id}
                      onClick={() => handleOpenEdit(c)}
                      className="py-3 px-2 -mx-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-muted/40 rounded-xl cursor-pointer transition-colors group"
                      title="Clique para editar o Controle"
                    >
                      <div className="min-w-0 flex-1">
                        {/* Identificação da Providência e Caso */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                            {p.providencia}
                          </span>
                          {c.pasta_ricci && (
                            <span className="font-mono text-[10px] font-bold text-primary">
                              [{c.pasta_ricci}]
                            </span>
                          )}
                        </div>

                        {/* Detalhes operacionais: Caso, Controle, Responsável e Executor */}
                        <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium text-foreground/80">
                            Caso: {c.identificacao_caso}
                          </span>
                          {c.nome_controle && <span>• Controle: {c.nome_controle}</span>}
                          <span>• Resp: {c.responsavel_nome || '—'}</span>
                          <span>• Exec: {c.executor_nome || '—'}</span>
                        </div>
                      </div>

                      {/* Badges: Prazo Vencido, Tipo e Status */}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {p.tipo_prazo?.nome && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                            {p.tipo_prazo.nome}
                          </span>
                        )}

                        <span
                          className={cn(
                            'text-[10px] font-semibold px-2 py-0.5 rounded-md border',
                            statusProvBadge.bg,
                            statusProvBadge.text,
                            statusProvBadge.border,
                          )}
                        >
                          {p.status?.nome || '—'}
                        </span>

                        <span className="text-[11px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-md flex items-center gap-1 border border-destructive/20">
                          <AlertTriangle className="w-3 h-3" />
                          Vencido: {formatDateBR(p.prazo_conclusao)}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {demandasAtencaoPrioritaria.length > 5
                ? `Exibindo 5 de ${demandasAtencaoPrioritaria.length} providências vencidas`
                : 'Atenção imediata para cumprimento'}
            </span>
            <Link
              to="/tarefas"
              className="font-semibold text-primary hover:underline flex items-center gap-1"
            >
              Abrir tabela completa de Controles
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Seção Principal: Próximas Providências */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-primary" />
              <span>Próximas Providências</span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Fila operacional ordenada por prioridade (vencidas, hoje e próximas por prazo
              crescente)
            </p>
          </div>

          <Button
            variant="ghost"
            asChild
            className="text-primary hover:text-primary/90 font-semibold text-sm -mr-2"
          >
            <Link to="/tarefas" className="flex items-center gap-1.5">
              Abrir tabela completa de Controles
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>

        {proximasProvidenciasLista.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground space-y-3">
            <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto" />
            <p className="text-sm font-semibold text-foreground">
              {hasActiveFilters
                ? 'Nenhuma providência aberta encontrada para os filtros selecionados.'
                : 'Sem providência pendente.'}
            </p>
            <p className="text-xs max-w-sm mx-auto">
              {hasActiveFilters
                ? 'Tente ajustar os filtros operacionais no painel superior.'
                : 'Todos os controles em andamento estão com providências em dia ou finalizadas.'}
            </p>
            {hasActiveFilters ? (
              <Button
                onClick={handleClearFilters}
                variant="outline"
                size="sm"
                className="rounded-xl mt-1"
              >
                Limpar filtros
              </Button>
            ) : (
              <Button onClick={handleOpenCreate} variant="outline" className="rounded-xl mt-1">
                Criar novo controle
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {proximasProvidenciasLista.slice(0, 10).map((item) => {
              const p = item.providencia
              const c = item.controle
              const prazo = p.prazo_conclusao ? p.prazo_conclusao.split('T')[0] : ''
              const isVencida = Boolean(prazo && prazo < todayStr)
              const isHoje = Boolean(prazo && prazo === todayStr)

              const statusProvBadge = getStatusBadgeStyle(p.status?.codigo, p.status?.finaliza)

              return (
                <div
                  key={p.id}
                  onClick={() => handleOpenEdit(c)}
                  className="py-3.5 px-3 -mx-3 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/40 rounded-xl cursor-pointer transition-colors group"
                  title="Clique para editar o Controle"
                >
                  <div className="min-w-0 flex-1">
                    {/* Linha 1: Texto da Providência, Pastas e destaque */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {isVencida && (
                        <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded uppercase">
                          Vencida
                        </span>
                      )}
                      {isHoje && (
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded uppercase">
                          Hoje
                        </span>
                      )}
                      {c.pasta_ricci && (
                        <span className="font-mono text-[11px] font-bold text-primary">
                          [{c.pasta_ricci}]
                        </span>
                      )}
                      {c.pasta_cliente && (
                        <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                          {c.pasta_cliente}
                        </span>
                      )}
                      <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                        {p.providencia}
                      </span>
                    </div>

                    {/* Linha 2: Identificação do Caso, Nome do Controle, Responsável e Executor */}
                    <div className="flex items-center gap-x-3 gap-y-1 text-xs text-muted-foreground flex-wrap mt-1">
                      <span className="font-medium text-foreground/80">
                        Caso: {c.identificacao_caso}
                      </span>
                      {c.nome_controle && <span>• Controle: {c.nome_controle}</span>}
                      <span>• Resp: {c.responsavel_nome || '—'}</span>
                      <span>• Exec: {c.executor_nome || '—'}</span>
                    </div>
                  </div>

                  {/* Linha/Bloco Lateral: Tipo de Prazo, Status da Providência e Prazo */}
                  <div className="flex items-center gap-2.5 shrink-0 flex-wrap md:flex-nowrap">
                    {p.tipo_prazo?.nome && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                        {p.tipo_prazo.nome}
                      </span>
                    )}

                    <span
                      className={cn(
                        'text-[11px] font-semibold px-2.5 py-0.5 rounded-md border',
                        statusProvBadge.bg,
                        statusProvBadge.text,
                        statusProvBadge.border,
                      )}
                    >
                      {p.status?.nome || '—'}
                    </span>

                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md border',
                        isVencida
                          ? 'text-destructive bg-destructive/10 border-destructive/20'
                          : isHoje
                            ? 'text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/20'
                            : 'text-foreground bg-muted/40 border-border',
                      )}
                    >
                      <Calendar className="w-3 h-3" />
                      {formatDateBR(p.prazo_conclusao)}
                    </span>

                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5 hidden sm:block" />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {proximasProvidenciasLista.length > 10 && (
          <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Exibindo 10 de {proximasProvidenciasLista.length} providências na fila operacional
            </span>
            <Link
              to="/tarefas"
              className="font-semibold text-primary hover:underline flex items-center gap-1"
            >
              Ver todas em Controles
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* Modal de Criação / Edição de Controle */}
      <ControleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        controleToEdit={controleToEdit}
        statusList={statusList}
        statusProvidenciaList={statusProvidenciaList}
        tiposPrazoList={tiposPrazoList}
        usuariosAtivos={usuariosAtivos}
        onSaved={() => {
          refreshControles()
        }}
      />
    </div>
  )
}
