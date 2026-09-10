import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun,
  Moon,
  SlidersHorizontal,
  Bell,
  Database,
  CheckCircle2,
  RefreshCw,
  Server,
  AlertCircle,
  Loader2,
  User,
  LogOut,
  ShieldCheck,
  Table,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useControles } from '@/hooks/useControles'
import { useTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/use-auth'
import { useSupabaseConnection } from '@/hooks/useSupabaseConnection'
import { DefaultControleViewFilter } from '@/types/task'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export default function ConfiguracoesPage() {
  const { settings, updateSettings, controles, refreshControles } = useControles()
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const supabaseConn = useSupabaseConnection()
  const [testingConnection, setTestingConnection] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleTestConnection = async () => {
    setTestingConnection(true)
    await Promise.all([supabaseConn.refresh(), refreshControles()])
    setTestingConnection(false)
    toast({
      title: 'Verificação concluída',
      description: 'Conexão e contagens de tabelas do Supabase sincronizadas.',
    })
  }

  const handleThemeChange = (newTheme: 'claro' | 'escuro') => {
    setTheme(newTheme)
    toast({
      title: 'Tema alterado',
      description: `O tema foi alterado para o modo ${newTheme}.`,
    })
  }

  const handleDefaultViewChange = (val: DefaultControleViewFilter) => {
    updateSettings({ defaultView: val })
    toast({
      title: 'Preferência salva',
      description: `A visualização padrão foi atualizada para "${val}".`,
    })
  }

  const handleNotificationsToggle = (checked: boolean) => {
    updateSettings({ notificationsEnabled: checked })
    toast({
      title: checked ? 'Notificações ativadas' : 'Notificações desativadas',
      description: checked
        ? 'Destaque visual para prazos e follow-ups vencidos habilitado.'
        : 'Avisos visuais de vencimento silenciados.',
    })
  }

  const handleSignOut = async () => {
    setLoggingOut(true)
    try {
      await signOut()
      toast({
        title: 'Sessão encerrada',
        description: 'Você saiu da sua conta com sucesso.',
      })
      navigate('/login', { replace: true })
    } catch {
      toast({
        variant: 'destructive',
        title: 'Erro ao sair',
        description: 'Não foi possível desconectar com segurança.',
      })
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      {/* Header */}
      <PageHeader
        title="Configurações"
        subtitle="Preferências do Ricci Task e status do Supabase"
      />

      {/* Card 0: Conta de Usuário Autenticada */}
      <section className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Conta Autenticada</h2>
              <p className="text-xs text-muted-foreground">Sessão ativa via Supabase Auth</p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            Sessão Ativa
          </span>
        </div>

        <div className="rounded-xl p-3.5 bg-muted/40 border border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <span className="text-muted-foreground block text-[11px]">E-mail do usuário</span>
            <span className="font-semibold text-foreground text-sm">
              {user?.email || 'Usuário autenticado'}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loggingOut}
            onClick={handleSignOut}
            className="h-9 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive font-semibold flex items-center gap-2 self-start sm:self-auto"
          >
            {loggingOut ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5" />
            )}
            <span>Desconectar da conta</span>
          </Button>
        </div>
      </section>

      <div className="space-y-6">
        {/* Card 1: Aparência */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              {theme === 'escuro' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Aparência</h2>
              <p className="text-xs text-muted-foreground">Escolha o tema visual do aplicativo</p>
            </div>
          </div>

          <div className="pt-2">
            <Label className="text-sm font-semibold text-foreground mb-2 block">
              Tema da interface
            </Label>
            <div className="grid grid-cols-2 max-w-xs gap-2 p-1.5 bg-muted/60 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => handleThemeChange('claro')}
                className={cn(
                  'flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200',
                  theme === 'claro'
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Sun className="w-4 h-4 text-amber-500" />
                <span>Claro</span>
              </button>

              <button
                type="button"
                onClick={() => handleThemeChange('escuro')}
                className={cn(
                  'flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200',
                  theme === 'escuro'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Moon className="w-4 h-4" />
                <span>Escuro</span>
              </button>
            </div>
          </div>
        </section>

        {/* Card 2: Preferências */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Preferências de Exibição</h2>
              <p className="text-xs text-muted-foreground">
                Configurações da tela de Controles de Casos
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-1">
            {/* Visualização padrão */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/60">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold text-foreground">
                  Filtro inicial de Controles
                </Label>
                <p className="text-xs text-muted-foreground">
                  Situação pré-selecionada ao abrir a tabela de controles
                </p>
              </div>
              <Select
                value={settings.defaultView || 'todos'}
                onValueChange={(val: DefaultControleViewFilter) => handleDefaultViewChange(val)}
              >
                <SelectTrigger className="w-full sm:w-[200px] h-10 rounded-xl bg-background">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="todos">Todos os controles</SelectItem>
                  <SelectItem value="em_andamento">Em Andamento</SelectItem>
                  <SelectItem value="aguardando_autorizacao">Aguardando Autorização</SelectItem>
                  <SelectItem value="vencidos">Prazos Vencidos</SelectItem>
                  <SelectItem value="concluidos">Concluídos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notificações e Destaques Visuais */}
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <Label htmlFor="notif-toggle" className="text-sm font-semibold text-foreground">
                    Destaques de Vencimento
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Destacar em vermelho prazos vencidos e em âmbar follow-ups vencidos
                </p>
              </div>
              <Switch
                id="notif-toggle"
                checked={settings.notificationsEnabled}
                onCheckedChange={handleNotificationsToggle}
              />
            </div>
          </div>
        </section>

        {/* Card 3: Backend Supabase Vinculado */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Backend Supabase Vinculado</h2>
                <p className="text-xs text-muted-foreground">
                  Operação 100% em nuvem sobre as tabelas existentes
                </p>
              </div>
            </div>

            {supabaseConn.status === 'connected' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Conectado ({supabaseConn.latencyMs}ms)
              </span>
            )}
            {supabaseConn.status === 'checking' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Testando conexão...
              </span>
            )}
            {supabaseConn.status === 'disconnected' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <AlertCircle className="w-3.5 h-3.5" />
                Não conectado
              </span>
            )}
          </div>

          <div className="rounded-xl p-3.5 bg-muted/40 border border-border/60 space-y-2 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-muted-foreground">
              <span className="font-medium text-foreground">Armazenamento:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                Supabase PostgreSQL (task_tarefas, task_prazos, task_andamentos)
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-muted-foreground">
              <span className="font-medium text-foreground">Pessoas Internas:</span>
              <span className="text-foreground">legaldesk_usuarios (somente leitura ativa)</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-muted-foreground">
              <span className="font-medium text-foreground">Controles Ativos Carregados:</span>
              <span className="font-bold text-foreground">
                {controles.length} registros ativos (deleted_at is null)
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
            <p className="text-xs text-muted-foreground max-w-md">
              A aplicação não armazena dados em localStorage e respeita as regras de integridade e
              RLS do Supabase.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testingConnection || supabaseConn.status === 'checking'}
              onClick={handleTestConnection}
              className="h-9 rounded-xl border-border flex items-center gap-2 hover:bg-muted font-medium text-xs text-foreground shrink-0"
            >
              <RefreshCw
                className={cn(
                  'w-3.5 h-3.5',
                  (testingConnection || supabaseConn.status === 'checking') && 'animate-spin',
                )}
              />
              <span>Testar Conexão</span>
            </Button>
          </div>
        </section>

        {/* Card 4: Sobre o Sistema */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                RT
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Ricci Task — Fase Controles de Casos
                </h3>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
              <Table className="w-3.5 h-3.5" />
              Modo Planilha Ativo
            </span>
          </div>

          <div className="pt-2 text-xs text-muted-foreground leading-relaxed border-t border-border/60">
            Controle de casos jurídicos com prazos múltiplos, providências detalhadas, follow-ups e
            andamentos em linha do tempo. Todos os dados são sincronizados em tempo real com o banco
            PostgreSQL Supabase.
          </div>
        </section>
      </div>
    </div>
  )
}
