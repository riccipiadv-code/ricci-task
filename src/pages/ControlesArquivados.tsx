import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Archive,
  ArchiveRestore,
  Search,
  RotateCw,
  X,
  Loader2,
  AlertTriangle,
  FolderKanban,
  Calendar,
  User,
  Clock,
} from 'lucide-react'
import { controleService } from '@/services/controleService'
import { TaskControleRecord, TaskUsuarioAtivoRecord } from '@/types/task'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  formatDateBR,
  formatDateTimeBR,
  isPrazoOverdue,
  getStatusBadgeStyle,
} from '@/lib/formatters'
import { cn } from '@/lib/utils'

export default function ControlesArquivadosPage() {
  const { toast } = useToast()

  const [controlesArquivados, setControlesArquivados] = useState<TaskControleRecord[]>([])
  const [usuariosAtivos, setUsuariosAtivos] = useState<TaskUsuarioAtivoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  // Estado da confirmação de Desarquivar
  const [desarquivarDialogOpen, setDesarquivarDialogOpen] = useState(false)
  const [controleParaDesarquivar, setControleParaDesarquivar] = useState<TaskControleRecord | null>(
    null,
  )
  const [desarquivando, setDesarquivando] = useState(false)

  // Carregamento de dados com resolução de nomes via task_usuarios
  const carregarDados = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      let users: TaskUsuarioAtivoRecord[] = []
      try {
        users = await controleService.getUsuariosAtivos()
      } catch (userErr) {
        console.error('Aviso ao carregar usuários para controles arquivados:', userErr)
        users = []
      }
      setUsuariosAtivos(users)

      const arquivados = await controleService.getControlesArquivados(users)
      setControlesArquivados(arquivados)
    } catch (err: any) {
      console.error('Erro ao carregar controles arquivados:', err)
      const msg = err?.message || 'Falha ao buscar controles arquivados no Supabase.'
      setLoadError(msg)
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar arquivados',
        description: msg,
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  // Desarquivar controle
  const handleOpenDesarquivar = (controle: TaskControleRecord) => {
    setControleParaDesarquivar(controle)
    setDesarquivarDialogOpen(true)
  }

  const handleConfirmarDesarquivar = async () => {
    if (!controleParaDesarquivar || desarquivando) return

    setDesarquivando(true)
    try {
      await controleService.unarchiveControle(controleParaDesarquivar.id)
      // Remove o item da lista de arquivados (volta automaticamente à lista principal de Controles)
      setControlesArquivados((prev) => prev.filter((c) => c.id !== controleParaDesarquivar.id))
      setDesarquivarDialogOpen(false)
      toast({
        title: 'Controle desarquivado com sucesso',
        description: `O controle "${controleParaDesarquivar.identificacao_caso}" foi restaurado e voltou à lista principal.`,
      })
      setControleParaDesarquivar(null)
    } catch (err: any) {
      console.error('Erro ao desarquivar controle:', err)
      toast({
        variant: 'destructive',
        title: 'Erro ao desarquivar',
        description: err?.message || 'Não foi possível desarquivar o controle.',
      })
    } finally {
      setDesarquivando(false)
    }
  }

  // Filtragem e ordenação:
  // - Busca por: nome do controle, identificação do caso, responsável e executor
  // - Ordenação inicial por Data de Arquivamento, mais recente primeiro (arquivado_at desc)
  const listaFiltrada = useMemo(() => {
    let list = [...controlesArquivados]

    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      list = list.filter((c) => {
        const nomeControle = (c.nome_controle || '').toLowerCase()
        const identificacao = (c.identificacao_caso || '').toLowerCase()
        const responsavel = (c.responsavel_nome || '').toLowerCase()
        const executor = (c.executor_nome || '').toLowerCase()
        return (
          nomeControle.includes(q) ||
          identificacao.includes(q) ||
          responsavel.includes(q) ||
          executor.includes(q)
        )
      })
    }

    // Ordenar inicialmente por Data de Arquivamento, mais recente primeiro
    list.sort((a, b) => {
      const dataA = a.arquivado_at ? new Date(a.arquivado_at).getTime() : 0
      const dataB = b.arquivado_at ? new Date(b.arquivado_at).getTime() : 0
      if (dataA !== dataB) {
        return dataB - dataA
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })

    return list
  }, [controlesArquivados, busca])

  return (
    <div className="space-y-6 animate-fade-in w-full min-w-0">
      {/* Cabeçalho */}
      <PageHeader
        title="Controles Arquivados"
        subtitle="Histórico e recuperação de controles arquivados no Ricci Task"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={carregarDados}
              disabled={loading || desarquivando}
              className="h-10 rounded-xl px-3 border-border hover:bg-muted"
              title="Recarregar arquivados"
            >
              <RotateCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>
          </div>
        }
      />

      {/* Barra de Busca e Indicador */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-card flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Buscar por controle, identificação do caso, responsável ou executor..."
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

        <div className="flex items-center gap-3 text-xs text-muted-foreground self-end sm:self-center">
          <span>
            Arquivados: <strong className="text-foreground">{controlesArquivados.length}</strong>
          </span>
          {busca && (
            <>
              <span>•</span>
              <span className="text-primary font-medium">Encontrados: {listaFiltrada.length}</span>
            </>
          )}
        </div>
      </div>

      {/* Conteúdo da Tabela */}
      <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span>Carregando controles arquivados...</span>
          </div>
        ) : loadError ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <p className="font-semibold text-foreground text-sm">
                Não foi possível carregar os controles arquivados
              </p>
              <p className="text-xs text-muted-foreground">{loadError}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={carregarDados}
              className="rounded-xl text-xs"
            >
              <RotateCw className="w-3.5 h-3.5 mr-1.5" />
              Tentar novamente
            </Button>
          </div>
        ) : listaFiltrada.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-muted/50 text-muted-foreground flex items-center justify-center mx-auto">
              <Archive className="w-6 h-6 stroke-[1.7]" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground text-sm">
                {busca ? 'Nenhum resultado para a busca' : 'Nenhum controle arquivado'}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {busca
                  ? 'Verifique os termos digitados ou limpe a busca.'
                  : 'Os controles arquivados na listagem principal de Controles aparecerão aqui.'}
              </p>
            </div>
            {busca && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBusca('')}
                className="rounded-xl text-xs"
              >
                Limpar busca
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Tabela Desktop / Tablet com rolagem horizontal */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[960px]">
                <thead>
                  <tr className="border-b border-border/80 bg-muted/40 text-xs font-semibold text-muted-foreground">
                    <th className="py-3 px-4 w-[160px]">Nome do Controle</th>
                    <th className="py-3 px-4 min-w-[240px]">Identificação do Caso</th>
                    <th className="py-3 px-4 w-[140px]">Responsável</th>
                    <th className="py-3 px-4 w-[140px]">Executor</th>
                    <th className="py-3 px-4 min-w-[220px]">Próxima Providência</th>
                    <th className="py-3 px-4 w-[130px]">Prazo Providência</th>
                    <th className="py-3 px-4 w-[150px]">Data Arquivamento</th>
                    <th className="py-3 px-4 text-right w-[110px]">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 text-sm">
                  {listaFiltrada.map((item) => {
                    const proxProv = item.proxima_providencia
                    const proxVencida = isPrazoOverdue(proxProv?.prazo_conclusao, proxProv?.status)
                    const proxBadge = getStatusBadgeStyle(
                      proxProv?.status?.codigo,
                      proxProv?.status?.finaliza,
                    )

                    return (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        {/* Nome do Controle */}
                        <td className="py-3.5 px-4 font-semibold text-foreground">
                          <span className="inline-flex items-center gap-1.5 text-xs text-primary font-bold">
                            <FolderKanban className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{item.nome_controle || 'Sem nome'}</span>
                          </span>
                        </td>

                        {/* Identificação do Caso */}
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-foreground text-xs sm:text-sm leading-snug">
                            {item.identificacao_caso}
                          </div>
                          {(item.pasta_cliente || item.pasta_ricci) && (
                            <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-muted-foreground">
                              {item.pasta_cliente && <span>Cli: {item.pasta_cliente}</span>}
                              {item.pasta_ricci && (
                                <span className="text-primary font-semibold">
                                  Ricci: [{item.pasta_ricci}]
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Responsável */}
                        <td className="py-3.5 px-4 text-xs">
                          {item.responsavel_nome ? (
                            <span className="inline-flex items-center gap-1 text-foreground font-medium">
                              <User className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="truncate">{item.responsavel_nome}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* Executor */}
                        <td className="py-3.5 px-4 text-xs">
                          {item.executor_nome ? (
                            <span className="inline-flex items-center gap-1 text-foreground font-medium">
                              <User className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="truncate">{item.executor_nome}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* Próxima Providência */}
                        <td className="py-3.5 px-4 text-xs">
                          {proxProv?.providencia ? (
                            <div className="space-y-1">
                              <p className="line-clamp-2 text-foreground font-normal leading-relaxed">
                                {proxProv.providencia}
                              </p>
                              {proxProv.status && (
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border',
                                    proxBadge.bg,
                                    proxBadge.text,
                                    proxBadge.border,
                                  )}
                                >
                                  <span className={cn('w-1 h-1 rounded-full', proxBadge.dot)} />
                                  <span>{proxProv.status.nome}</span>
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60 italic">
                              Nenhuma providência pendente
                            </span>
                          )}
                        </td>

                        {/* Prazo da Providência */}
                        <td className="py-3.5 px-4 text-xs">
                          {proxProv?.prazo_conclusao ? (
                            <span
                              className={cn(
                                'font-semibold inline-flex items-center gap-1',
                                proxVencida ? 'text-destructive font-bold' : 'text-foreground',
                              )}
                            >
                              <Calendar className="w-3 h-3 shrink-0" />
                              <span>{formatDateBR(proxProv.prazo_conclusao)}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* Data de Arquivamento */}
                        <td className="py-3.5 px-4 text-xs font-medium text-muted-foreground">
                          {item.arquivado_at ? (
                            <span
                              className="inline-flex items-center gap-1 text-foreground"
                              title={formatDateTimeBR(item.arquivado_at)}
                            >
                              <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span>{formatDateTimeBR(item.arquivado_at)}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>

                        {/* Ação Desarquivar */}
                        <td className="py-3.5 px-4 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenDesarquivar(item)}
                            className="h-8 px-2.5 text-xs rounded-xl border-border text-foreground hover:text-primary hover:border-primary/50 transition-colors inline-flex items-center gap-1.5 shadow-none"
                            title="Desarquivar este controle"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5 text-primary" />
                            <span>Desarquivar</span>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Visualização Cartão em telas mobile */}
            <div className="md:hidden divide-y divide-border/60">
              {listaFiltrada.map((item) => {
                const proxProv = item.proxima_providencia
                const proxVencida = isPrazoOverdue(proxProv?.prazo_conclusao, proxProv?.status)

                return (
                  <div
                    key={item.id}
                    className="p-4 space-y-2.5 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs text-primary font-bold">
                        <FolderKanban className="w-3.5 h-3.5" />
                        <span>{item.nome_controle || 'Sem nome'}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {item.arquivado_at ? formatDateBR(item.arquivado_at) : ''}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-foreground leading-snug">
                      {item.identificacao_caso}
                    </h4>

                    {proxProv?.providencia && (
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                        <strong>Próx. Prov.:</strong> {proxProv.providencia}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/40 text-muted-foreground">
                      <div>
                        <span className="text-[10px] block font-medium">Prazo Providência:</span>
                        <span
                          className={cn(
                            'font-semibold',
                            proxVencida ? 'text-destructive font-bold' : 'text-foreground',
                          )}
                        >
                          {proxProv?.prazo_conclusao ? formatDateBR(proxProv.prazo_conclusao) : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] block font-medium">Responsável:</span>
                        <span className="font-semibold text-foreground truncate block">
                          {item.responsavel_nome || '—'}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenDesarquivar(item)}
                        className="h-8 text-xs rounded-xl border-border inline-flex items-center gap-1.5"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5 text-primary" />
                        <span>Desarquivar</span>
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Confirmação de Desarquivamento */}
      <Dialog open={desarquivarDialogOpen} onOpenChange={setDesarquivarDialogOpen}>
        <DialogContent className="sm:max-w-[440px] rounded-2xl p-6">
          <DialogHeader className="flex flex-col items-start gap-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ArchiveRestore className="h-5 w-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-foreground">
              Deseja desarquivar este controle?
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              O controle{' '}
              <strong className="text-foreground">
                "{controleParaDesarquivar?.identificacao_caso}"
              </strong>{' '}
              voltará a ser exibido na lista principal de Controles.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 gap-2 sm:gap-0 flex-col-reverse sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={desarquivando}
              onClick={() => {
                setDesarquivarDialogOpen(false)
                setControleParaDesarquivar(null)
              }}
              className="h-10 rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={desarquivando}
              onClick={handleConfirmarDesarquivar}
              className="h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              {desarquivando && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              <span>{desarquivando ? 'Desarquivando...' : 'Desarquivar'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
