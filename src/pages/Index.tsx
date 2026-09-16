import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  PlayCircle,
  Clock,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ArrowRight,
  Plus,
  Sparkles,
  Calendar,
  FileSpreadsheet,
  RefreshCw,
  FolderOpen,
} from 'lucide-react'
import { useControles } from '@/hooks/useControles'
import { TaskControleRecord } from '@/types/task'
import { ControleModal } from '@/components/ControleModal'
import { Button } from '@/components/ui/button'
import {
  formatDateBR,
  getTimeOfDayGreeting,
  getFullDateFormattedBR,
  getStatusBadgeStyle,
  isPrazoOverdue,
} from '@/lib/formatters'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

export default function Index() {
  const { controles, metrics, statusList, tiposPrazoList, loading, refreshControles } =
    useControles()

  const { user } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [controleToEdit, setControleToEdit] = useState<TaskControleRecord | null>(null)

  const greeting = getTimeOfDayGreeting()
  const fullDate = getFullDateFormattedBR()

  // Nome amigável derivado do e-mail do usuário
  const userDisplayName = useMemo(() => {
    if (!user?.email) return 'Ricci'
    const namePart = user.email.split('@')[0]
    return namePart
      .split('.')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ')
  }, [user?.email])

  // 5 Controles mais recentes (por updated_at decrescente)
  const recentControles = useMemo(() => {
    return [...controles]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 5)
  }, [controles])

  // Controles com atenção prioritária (prazo geral ou da próxima providência aberta vencido)
  const controlesComAtencao = useMemo(() => {
    return controles
      .filter((c) => {
        const prazoGeralVencido = isPrazoOverdue(c.prazo_conclusao, c.status)
        const prazoProvVencido = isPrazoOverdue(
          c.proxima_providencia?.prazo_conclusao,
          c.proxima_providencia?.status,
        )
        return prazoGeralVencido || prazoProvVencido
      })
      .slice(0, 5)
  }, [controles])

  const handleOpenCreate = () => {
    setControleToEdit(null)
    setModalOpen(true)
  }

  const handleOpenEdit = (c: TaskControleRecord) => {
    setControleToEdit(c)
    setModalOpen(true)
  }

  // Taxa de conclusão
  const taxaConclusao =
    metrics.total > 0 ? Math.round((metrics.concluidos / metrics.total) * 100) : 0

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary font-semibold text-xs sm:text-sm mb-1 uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>Painel de Controles Jurídicos</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            {greeting}, {userDisplayName} 👋
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1 font-normal">
            {fullDate} • Operação integrada ao Supabase
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refreshControles()}
            disabled={loading}
            className="h-11 rounded-xl px-3 border-border hover:bg-muted"
            title="Atualizar dados"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>

          <Button
            onClick={handleOpenCreate}
            className="h-11 px-5 rounded-xl font-semibold bg-primary hover:bg-[#4A4AC2] text-primary-foreground shadow-sm transition-transform hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4 mr-2 stroke-[2.5]" />
            Novo Controle
          </Button>
        </div>
      </div>

      {/* 4 Indicadores Estratégicos do Dashboard:
          1. Controles em andamento
          2. Aguardando autorização
          3. Prazos vencidos (geral ou providência)
          4. Controles concluídos
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Em Andamento */}
        <div className="group relative bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Em Andamento</span>
            <div className="h-9 w-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <PlayCircle className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {metrics.emAndamento}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">casos ativos</span>
          </div>
        </div>

        {/* Card 2: Aguardando Autorização */}
        <div className="group relative bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              Aguardando Autorização
            </span>
            <div className="h-9 w-9 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <Clock className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {metrics.aguardandoAutorizacao}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">pendentes</span>
          </div>
        </div>

        {/* Card 3: Prazos Vencidos */}
        <div
          className={cn(
            'group relative bg-card border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1',
            metrics.prazosVencidos > 0 ? 'border-red-500/40 bg-red-500/[0.02]' : 'border-border',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-destructive">Prazos Vencidos</span>
            <div className="h-9 w-9 rounded-xl bg-red-500/10 text-destructive flex items-center justify-center transition-transform group-hover:scale-110">
              <AlertTriangle className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-destructive tracking-tight">
              {metrics.prazosVencidos}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">atenção imediata</span>
          </div>
        </div>

        {/* Card 4: Controles Concluídos */}
        <div className="group relative bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Concluídos</span>
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition-transform group-hover:scale-110">
              <CheckCircle2 className="w-5 h-5 stroke-[2.2]" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {metrics.concluidos}
            </span>
            <span className="text-[11px] text-muted-foreground font-medium">finalizados</span>
          </div>
        </div>
      </div>

      {/* Grid com Resumo Operacional e Prazos Críticos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Card de Visão Geral do Acervo */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-card flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Visão Geral dos Controles</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Proporção de finalização e volume do acervo ativo
            </p>
          </div>

          <div className="py-6 flex flex-col items-center justify-center">
            <div className="relative flex items-center justify-center w-36 h-36">
              <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r={42}
                  className="stroke-muted/40 fill-transparent"
                  strokeWidth="8"
                />
                <circle
                  cx="50"
                  cy="50"
                  r={42}
                  className="stroke-primary fill-transparent transition-all duration-500"
                  strokeWidth="8"
                  strokeDasharray={2 * Math.PI * 42}
                  strokeDashoffset={2 * Math.PI * 42 - (taxaConclusao / 100) * 2 * Math.PI * 42}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-extrabold text-foreground">{taxaConclusao}%</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  concluídos
                </span>
              </div>
            </div>

            <p className="mt-4 text-xs font-medium text-foreground text-center">
              <span className="font-bold text-primary">{metrics.concluidos}</span> de{' '}
              <span className="font-bold text-foreground">{metrics.total}</span> controles
              finalizados
            </p>
          </div>

          <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Controles Ativos</span>
            <span className="font-bold text-foreground">
              {metrics.total - metrics.concluidos} casos em aberto
            </span>
          </div>
        </div>

        {/* Card de Demandas com Atenção Prioritária (Prazos vencidos) */}
        <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-6 shadow-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Demandas de Atenção Prioritária</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controles não finalizados com prazo geral ou de providência vencido
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground">
              {controlesComAtencao.length} demanda(s)
            </span>
          </div>

          <div className="my-4 divide-y divide-border">
            {controlesComAtencao.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground space-y-1">
                <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto" />
                <p className="font-semibold text-foreground text-sm">Tudo em dia!</p>
                <p>Nenhum controle ativo possui prazos vencidos no momento.</p>
              </div>
            ) : (
              controlesComAtencao.map((c) => {
                const prazoGeralVencido = isPrazoOverdue(c.prazo_conclusao, c.status)
                const prazoProvVencido = isPrazoOverdue(
                  c.proxima_providencia?.prazo_conclusao,
                  c.proxima_providencia?.status,
                )

                return (
                  <div
                    key={c.id}
                    onClick={() => handleOpenEdit(c)}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-muted/30 px-2 -mx-2 rounded-xl cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {c.pasta_ricci && (
                          <span className="font-mono text-[11px] font-bold text-primary">
                            [{c.pasta_ricci}]
                          </span>
                        )}
                        <span className="text-xs font-bold text-foreground truncate">
                          {c.nome_controle || c.identificacao_caso}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {c.nome_controle ? `Caso: ${c.identificacao_caso} • ` : ''}Resp:{' '}
                        {c.responsavel_nome} • {c.status?.nome}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {prazoGeralVencido && c.prazo_conclusao && (
                        <span className="text-[11px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Prazo Caso: {formatDateBR(c.prazo_conclusao)}
                        </span>
                      )}
                      {prazoProvVencido && c.proxima_providencia?.prazo_conclusao && (
                        <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Prazo Prov.: {formatDateBR(c.proxima_providencia.prazo_conclusao)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Operação Ricci Task</span>
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

      {/* Controles Recentes */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-primary" />
              <span>Controles Recentes</span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Últimos 5 controles atualizados no Supabase
            </p>
          </div>

          <Button
            variant="ghost"
            asChild
            className="text-primary hover:text-primary/90 font-semibold text-sm"
          >
            <Link to="/tarefas" className="flex items-center gap-1.5">
              Ver todos os controles
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>

        {recentControles.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground space-y-3">
            <p className="text-sm">Nenhum controle registrado ainda no Supabase.</p>
            <Button onClick={handleOpenCreate} variant="outline" className="rounded-xl">
              Criar primeiro controle
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentControles.map((c) => {
              const statusBadge = getStatusBadgeStyle(c.status?.codigo, c.status?.finaliza)
              const proxProv = c.proxima_providencia

              return (
                <div
                  key={c.id}
                  onClick={() => handleOpenEdit(c)}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 px-3 -mx-3 rounded-xl cursor-pointer transition-colors group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.pasta_cliente && (
                        <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                          {c.pasta_cliente}
                        </span>
                      )}
                      {c.pasta_ricci && (
                        <span className="font-mono text-[11px] font-bold text-primary">
                          [{c.pasta_ricci}]
                        </span>
                      )}
                      <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                        {c.nome_controle || c.identificacao_caso}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground truncate max-w-xl mt-0.5">
                      {c.nome_controle && (
                        <span className="font-medium text-foreground/80 truncate">
                          Caso: {c.identificacao_caso}
                        </span>
                      )}
                      {c.nome_controle && proxProv?.providencia && <span>•</span>}
                      {proxProv?.providencia && (
                        <span className="truncate">Próx. Prov.: {proxProv.providencia}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0">
                    {/* Status badge discreto */}
                    <span
                      className={cn(
                        'text-[11px] font-semibold px-2.5 py-0.5 rounded-md border',
                        statusBadge.bg,
                        statusBadge.text,
                        statusBadge.border,
                      )}
                    >
                      {c.status?.nome || '—'}
                    </span>

                    {/* Responsável */}
                    <span className="text-xs text-muted-foreground truncate max-w-[130px]">
                      {c.responsavel_nome}
                    </span>

                    {/* Prazo */}
                    {(proxProv?.prazo_conclusao || c.prazo_conclusao) && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {formatDateBR(proxProv?.prazo_conclusao || c.prazo_conclusao)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal de Criação / Edição de Controle */}
      <ControleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        controleToEdit={controleToEdit}
        statusList={statusList}
        tiposPrazoList={tiposPrazoList}
        onSaved={() => {
          refreshControles()
        }}
      />
    </div>
  )
}
