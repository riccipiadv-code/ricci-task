import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun,
  Moon,
  SlidersHorizontal,
  Bell,
  Trash2,
  Download,
  Database,
  CheckCircle2,
  RefreshCw,
  Server,
  AlertCircle,
  Loader2,
  User,
  LogOut,
  ShieldCheck,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useTasks } from '@/hooks/useTasks'
import { useTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/use-auth'
import { useSupabaseConnection } from '@/hooks/useSupabaseConnection'
import { taskService } from '@/services/taskService'
import { DefaultViewFilter } from '@/types/task'
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
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export default function ConfiguracoesPage() {
  const { settings, updateSettings, resetAllData } = useTasks()
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const supabaseConn = useSupabaseConnection()
  const [testingConnection, setTestingConnection] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  const handleTestConnection = async () => {
    setTestingConnection(true)
    await supabaseConn.refresh()
    setTestingConnection(false)
    toast({
      title: 'Verificação concluída',
      description: 'O status da conexão com o Supabase foi atualizado.',
    })
  }

  const handleThemeChange = (newTheme: 'claro' | 'escuro') => {
    setTheme(newTheme)
    toast({
      title: 'Tema alterado',
      description: `O tema foi alterado para o modo ${newTheme}.`,
    })
  }

  const handleDefaultViewChange = (val: DefaultViewFilter) => {
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
        ? 'Avisos de tarefas vencidas habilitados.'
        : 'Avisos de tarefas foram silenciados.',
    })
  }

  const handleExportData = () => {
    try {
      const dataStr = taskService.exportData()
      const blob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ricci-task-backup-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({
        title: 'Dados exportados com sucesso',
        description: 'O arquivo JSON com suas tarefas e configurações foi baixado.',
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao exportar',
        description: 'Não foi possível gerar o backup das suas tarefas.',
      })
    }
  }

  const handleResetData = () => {
    resetAllData()
    toast({
      title: 'Dados limpos com sucesso',
      description: 'O banco local foi resetado com os 5 exemplos iniciais.',
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
      <PageHeader title="Configurações" subtitle="Personalize sua experiência no Ricci Task" />

      {/* Card 0: Conta de Usuário Conectada */}
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
              <h2 className="text-base font-bold text-foreground">Preferências</h2>
              <p className="text-xs text-muted-foreground">
                Ajuste os filtros iniciais e notificações do Ricci Task
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-1">
            {/* Visualização padrão */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/60">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold text-foreground">Visualização padrão</Label>
                <p className="text-xs text-muted-foreground">
                  Filtro pré-selecionado ao abrir a tela de tarefas
                </p>
              </div>
              <Select
                value={settings.defaultView || 'todas'}
                onValueChange={(val: DefaultViewFilter) => handleDefaultViewChange(val)}
              >
                <SelectTrigger className="w-full sm:w-[180px] h-10 rounded-xl bg-background">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="pendentes">Pendentes</SelectItem>
                  <SelectItem value="concluidas">Concluídas</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notificações de vencimento */}
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <Label htmlFor="notif-toggle" className="text-sm font-semibold text-foreground">
                    Notificações de vencimento
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Destacar visualmente e alertar tarefas que atingiram o prazo
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

        {/* Card 3: Dados */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#8B5CF6]/10 text-[#8B5CF6] dark:text-[#A78BFA] flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Gerenciamento de Dados</h2>
              <p className="text-xs text-muted-foreground">
                Backup e limpeza do armazenamento local
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleExportData}
              className="h-11 rounded-xl px-5 border-border flex items-center justify-center gap-2 hover:bg-muted font-semibold text-foreground"
            >
              <Download className="w-4 h-4 text-primary" />
              <span>Exportar dados (JSON)</span>
            </Button>

            <Button
              type="button"
              variant="destructive"
              onClick={() => setResetConfirmOpen(true)}
              className="h-11 rounded-xl px-5 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Limpar todos os dados</span>
            </Button>
          </div>
        </section>

        {/* Card 4: Conexão Backend Supabase */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Conexão Supabase</h2>
                <p className="text-xs text-muted-foreground">
                  Backend em nuvem já vinculado ao projeto
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
              <span className="font-medium text-foreground">Status atual:</span>
              <span className="font-mono text-[11px]">
                {supabaseConn.status === 'connected'
                  ? 'Comunicação ativa com o cliente Supabase'
                  : supabaseConn.status === 'checking'
                    ? 'Checando disponibilidade...'
                    : 'Aguardando sincronização / Falha de rede'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-muted-foreground">
              <span className="font-medium text-foreground">Tabelas Ricci Task:</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                Pendente de revisão lógica (isolamento futuro)
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-muted-foreground">
              <span className="font-medium text-foreground">Persistência ativa:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                Navegador (localStorage — ricci_task_data)
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
            <p className="text-xs text-muted-foreground max-w-md">
              A conexão está estabelecida e validada sem tocar nas tabelas compartilhadas do banco
              de dados. Na próxima etapa as tabelas dedicadas serão criadas.
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

        {/* Card 5: Sobre */}
        <section className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                RT
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Ricci Task v1.0</h3>
                <p className="text-xs text-muted-foreground">
                  Sistema de Gestão de Produtividade Pessoal
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Armazenamento: Local
            </span>
          </div>

          <div className="pt-2 text-xs text-muted-foreground leading-relaxed border-t border-border/60">
            Sistema de gestão de tarefas com armazenamento local mantido intacto. Conexão com o
            Supabase já configurada e inicializada, pronta para a posterior migração com tabelas
            isoladas.
          </div>
        </section>
      </div>

      {/* Confirmação de Reset de Dados */}
      <DeleteConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        onConfirm={handleResetData}
        title="Limpar todos os dados?"
        description="Tem certeza que deseja apagar todas as tarefas? Esta ação não pode ser desfeita."
        confirmButtonText="Limpar Dados"
      />
    </div>
  )
}
