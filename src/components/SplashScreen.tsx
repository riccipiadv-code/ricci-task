import { Check, Loader2 } from 'lucide-react'

export function SplashScreen() {
  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-6 antialiased select-none">
      <div className="flex flex-col items-center text-center animate-fade-in space-y-4">
        <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/30 animate-pulse">
          <Check className="w-9 h-9 stroke-[3]" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Ricci Task</h1>
          <p className="text-xs text-muted-foreground font-medium">Verificando sessão segura...</p>
        </div>
        <div className="pt-2">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
      </div>
    </div>
  )
}
