import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Users,
  Search,
  RotateCw,
  Power,
  CheckCircle2,
  XCircle,
  X,
  Loader2,
  Mail,
  RefreshCw,
  Info,
} from 'lucide-react'
import { controleService } from '@/services/controleService'
import { TaskUsuarioRecord } from '@/types/task'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export default function UsuariosPage() {
  const { toast } = useToast()

  const [usuarios, setUsuarios] = useState<TaskUsuarioRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const carregarUsuarios = useCallback(async () => {
    setLoading(true)
    try {
      const data = await controleService.getTodosUsuarios()
      setUsuarios(data)
    } catch (err: any) {
      console.error('Erro ao carregar usuários de task_usuarios:', err)
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar usuários',
        description: 'Não foi possível carregar a lista de usuários. Verifique sua conexão.',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    carregarUsuarios()
  }, [carregarUsuarios])

  const handleSincronizar = async () => {
    if (sincronizando) return
    setSincronizando(true)
    try {
      const total = await controleService.sincronizarUsuariosOrigem()
      await carregarUsuarios()
      toast({
        title: 'Usuários atualizados',
        description: `Sincronização concluída com sucesso. Total de ${total} usuário(s) na base do Ricci Task.`,
      })
    } catch (err: any) {
      console.error('Erro ao sincronizar usuários com origem:', err)
      toast({
        variant: 'destructive',
        title: 'Erro na sincronização',
        description:
          'Não foi possível atualizar a lista de usuários com a origem. Tente novamente em instantes.',
      })
    } finally {
      setSincronizando(false)
    }
  }

  const handleToggleAtivo = async (usuario: TaskUsuarioRecord) => {
    const novoStatus = !usuario.ativo
    setAtualizandoId(usuario.perfil_id)
    try {
      await controleService.toggleUsuarioAtivo(usuario.perfil_id, novoStatus)
      setUsuarios((prev) =>
        prev.map((u) => (u.perfil_id === usuario.perfil_id ? { ...u, ativo: novoStatus } : u)),
      )
      toast({
        title: novoStatus ? 'Usuário ativado' : 'Usuário desativado',
        description: `A situação de "${usuario.nome}" no Ricci Task foi alterada para ${
          novoStatus ? 'Ativo' : 'Inativo'
        }.`,
      })
    } catch (err: any) {
      console.error('Erro ao alterar situação do usuário em task_usuarios:', err)
      toast({
        variant: 'destructive',
        title: 'Erro ao alterar situação',
        description:
          'Não foi possível atualizar a situação do usuário. Verifique suas permissões de acesso.',
      })
    } finally {
      setAtualizandoId(null)
    }
  }

  // Filtragem e ordenação
  const listaFiltrada = useMemo(() => {
    let list = [...usuarios]
    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      list = list.filter(
        (u) =>
          (u.nome && u.nome.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q)),
      )
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [usuarios, busca])

  const totalDisponiveis = useMemo(() => {
    return usuarios.filter((u) => u.ativo && u.ativo_no_conectai).length
  }, [usuarios])

  return (
    <div className="space-y-6 animate-fade-in w-full min-w-0">
      {/* Cabeçalho */}
      <PageHeader
        title="Usuários"
        subtitle="Gerenciamento de responsáveis e executores do Ricci Task"
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={carregarUsuarios}
              disabled={loading || sincronizando}
              className="h-10 rounded-xl px-3 border-border hover:bg-muted"
              title="Recarregar listagem"
            >
              <RotateCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>
            <Button
              onClick={handleSincronizar}
              disabled={sincronizando || loading}
              className="h-10 px-4 rounded-xl font-semibold bg-primary hover:bg-[#4A4AC2] text-primary-foreground shadow-sm flex items-center gap-2"
              title="Sincronizar tabela própria de usuários com a base de origem"
            >
              <RefreshCw className={cn('w-4 h-4', sincronizando && 'animate-spin')} />
              <span>{sincronizando ? 'Atualizando...' : 'Atualizar usuários'}</span>
            </Button>
          </div>
        }
      />

      {/* Nota explicativa de integridade */}
      <div className="rounded-2xl p-4 bg-muted/40 border border-border/70 flex items-start gap-3 text-xs text-muted-foreground">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-foreground">
            Regra de seleção para Responsável e Executor
          </p>
          <p>
            Apenas usuários com situação <strong>Ativo no Ricci Task</strong> e{' '}
            <strong>Ativo no Conectaí</strong> ficam disponíveis para seleção nos controles de
            casos. Usuários inativos no Conectaí são identificados com indicador visual e não podem
            ser selecionados.
          </p>
        </div>
      </div>

      {/* Barra de Busca e Métricas rápidas */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-card flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
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

        <div className="flex items-center gap-3 text-xs text-muted-foreground self-end sm:self-center flex-wrap">
          <span>
            Total: <strong className="text-foreground">{usuarios.length}</strong>
          </span>
          <span>•</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
            Disponíveis nos controles: {totalDisponiveis}
          </span>
          <span>•</span>
          <span className="text-muted-foreground">
            Inativos Ricci Task: {usuarios.filter((u) => !u.ativo).length}
          </span>
          <span>•</span>
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            Inativos Conectaí: {usuarios.filter((u) => !u.ativo_no_conectai).length}
          </span>
        </div>
      </div>

      {/* Tabela de Usuários */}
      <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span>Carregando usuários do Ricci Task...</span>
          </div>
        ) : listaFiltrada.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Users className="w-10 h-10 text-muted-foreground/60 mx-auto" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground text-sm">
                {busca ? 'Nenhum usuário encontrado' : 'Nenhum usuário cadastrado'}
              </p>
              <p className="text-xs text-muted-foreground">
                {busca
                  ? 'Tente buscar por outro termo ou nome.'
                  : 'Clique em "Atualizar usuários" para sincronizar a base.'}
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
          <div className="divide-y divide-border/70">
            {listaFiltrada.map((item) => {
              const estaAtualizando = atualizandoId === item.perfil_id
              const disponivelParaSelecao = item.ativo && item.ativo_no_conectai

              return (
                <div
                  key={item.perfil_id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                >
                  {/* Dados do usuário */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-sm text-foreground leading-snug break-words">
                        {item.nome}
                      </span>

                      {disponivelParaSelecao ? (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Disponível nos Controles</span>
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-muted text-muted-foreground border border-border text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" />
                          <span>Indisponível nos Controles</span>
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3 text-muted-foreground/70" />
                        <span>{item.email}</span>
                      </span>
                    </div>
                  </div>

                  {/* Situações e Ação de Ativar/Desativar */}
                  <div className="flex items-center gap-3 shrink-0 flex-wrap justify-between md:justify-end pt-2 md:pt-0 border-t md:border-t-0 border-border/50">
                    {/* Situação Conectaí */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-[11px] text-muted-foreground">Conectaí:</span>
                      {item.ativo_no_conectai ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          <XCircle className="w-3 h-3" />
                          Inativo na Origem
                        </span>
                      )}
                    </div>

                    {/* Situação Ricci Task */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-[11px] text-muted-foreground">Ricci Task:</span>
                      {item.ativo ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-muted text-muted-foreground border border-border">
                          <XCircle className="w-3 h-3" />
                          Inativo
                        </span>
                      )}
                    </div>

                    {/* Botão de Toggle Ativar/Desativar no Ricci Task */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={estaAtualizando}
                      onClick={() => handleToggleAtivo(item)}
                      className={cn(
                        'h-8 px-2.5 text-xs rounded-xl transition-colors',
                        item.ativo
                          ? 'text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10'
                          : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10',
                      )}
                      title={
                        item.ativo
                          ? 'Desativar este usuário no Ricci Task'
                          : 'Ativar este usuário no Ricci Task'
                      }
                    >
                      {estaAtualizando ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      ) : (
                        <Power className="w-3.5 h-3.5 mr-1" />
                      )}
                      <span>{item.ativo ? 'Desativar no RT' : 'Ativar no RT'}</span>
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
