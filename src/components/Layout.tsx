import { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, CheckSquare, Settings as SettingsIcon, Check } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

interface LayoutProps {
  children?: ReactNode
}

const navItems = [
  {
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    path: '/tarefas',
    label: 'Tarefas',
    icon: CheckSquare,
  },
  {
    path: '/configuracoes',
    label: 'Configurações',
    icon: SettingsIcon,
  },
]

export default function Layout({ children }: LayoutProps) {
  // Inicializa o tema para assegurar que a classe .dark é aplicada ao html
  useTheme()
  const location = useLocation()

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row antialiased selection:bg-primary/20 selection:text-primary transition-colors duration-300">
      {/* Desktop / Tablet Sidebar */}
      <aside className="hidden md:flex flex-col border-r border-border bg-sidebar shrink-0 md:w-20 lg:w-60 min-h-screen sticky top-0 transition-all duration-300 z-30">
        {/* Brand / Logo */}
        <div className="h-20 flex items-center px-4 lg:px-6 border-b border-border gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-md shadow-primary/25 shrink-0">
            <Check className="w-6 h-6 stroke-[3]" />
          </div>
          <div className="hidden lg:flex flex-col">
            <span className="font-bold text-lg tracking-tight text-foreground leading-tight">
              Ricci Task
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              Gestão de Produtividade
            </span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 py-6 px-3 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={cn(
                  'group relative flex items-center gap-3.5 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-200',
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                title={item.label}
              >
                {/* Left accent bar on active */}
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-primary rounded-r-full" />
                )}
                <Icon
                  className={cn(
                    'w-5 h-5 shrink-0 transition-transform duration-200 group-hover:scale-105',
                    isActive ? 'text-primary stroke-[2.2]' : 'text-muted-foreground stroke-[1.8]',
                  )}
                />
                <span className="hidden lg:inline-block truncate">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 lg:p-4 border-t border-border mt-auto">
          <div className="flex items-center gap-3 p-2 lg:p-2.5 rounded-xl bg-muted/40 border border-border/50">
            <div className="h-9 w-9 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-sm shrink-0 border border-primary/30">
              R
            </div>
            <div className="hidden lg:flex flex-col min-w-0 flex-1">
              <span className="text-sm font-semibold text-foreground truncate leading-tight">
                Ricci
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  v1.0 — Local
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 pb-24 md:pb-10">
        <div className="w-full max-w-[1100px] mx-auto p-4 sm:p-6 lg:p-8 flex-1">{children}</div>
      </main>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border flex items-center justify-around px-2 py-2 safe-area-pb">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.path

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex flex-col items-center justify-center py-1.5 px-3 rounded-lg text-xs font-medium transition-colors relative',
                isActive
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {isActive && <span className="absolute -top-2 w-8 h-1 bg-primary rounded-full" />}
              <Icon className={cn('w-5 h-5 mb-1', isActive ? 'stroke-[2.2]' : 'stroke-[1.8]')} />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
