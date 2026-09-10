import { useState } from 'react'
import {
  Sun,
  Moon,
  SlidersHorizontal,
  Bell,
  Trash2,
  Download,
  Info,
  Database,
  CheckCircle2,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useTasks } from '@/hooks/useTasks'
import { useTheme } from '@/hooks/useTheme'
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

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

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

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      {/* Header */}
      <PageHeader title="Configurações" subtitle="Personalize sua experiência no Ricci Task" />

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

        {/* Card 4: Sobre */}
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
            Sistema de gestão de tarefas com armazenamento local. Preparado para integração futura
            com banco de dados (Neon / Supabase) através da camada de serviço desacoplada.
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
