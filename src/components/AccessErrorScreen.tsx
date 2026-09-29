import { useState } from 'react'
import { AlertTriangle, RefreshCw, LogOut, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AccessErrorScreenProps {
  onRetry: () => Promise<unknown> | void
  onSignOut?: () => Promise<unknown> | void
  isRetrying?: boolean
  errorMessage?: string | null
}

export function AccessErrorScreen({
  onRetry,
  onSignOut,
  isRetrying = false,
  errorMessage,
}: AccessErrorScreenProps) {
  const [internalRetrying, setInternalRetrying] = useState(false)
  const [internalSigningOut, setInternalSigningOut] = useState(false)

  const retrying = isRetrying || internalRetrying

  const handleRetry = async () => {
    if (retrying || internalSigningOut) return
    setInternalRetrying(true)
    try {
      await onRetry()
    } finally {
      setInternalRetrying(false)
    }
  }

  const handleSignOut = async () => {
    if (!onSignOut || internalSigningOut) return
    setInternalSigningOut(true)
    try {
      await onSignOut()
    } finally {
      setInternalSigningOut(false)
    }
  }

  return (
    <div
      data-testid="access-error-screen"
      className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 antialiased selection:bg-primary/20 selection:text-primary transition-colors duration-300"
    >
      {/* Background decorativo sutil */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl opacity-70" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-primary/10 blur-3xl opacity-70" />
      </div>

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* Card de Erro */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-card backdrop-blur-sm text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-5 shadow-sm">
            <AlertTriangle className="w-7 h-7 stroke-[2.25]" />
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Falha de comunicação com o Gestor de Acessos
          </h1>

          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Não foi possível validar suas permissões no sistema no momento. Essa instabilidade é
            temporária e o acesso às rotas internas permanece protegido até a confirmação da sua
            autorização.
          </p>

          {errorMessage && (
            <div className="mt-4 p-3 rounded-xl bg-muted/60 border border-border text-xs text-muted-foreground text-left font-mono break-words leading-relaxed">
              <span className="font-semibold text-foreground block font-sans mb-0.5">
                Detalhe técnico:
              </span>
              {errorMessage}
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
            <Button
              type="button"
              onClick={handleRetry}
              disabled={retrying || internalSigningOut}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 transition-all duration-200 flex items-center justify-center gap-2"
            >
              {retrying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Revalidando acesso...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>Tentar novamente</span>
                </>
              )}
            </Button>

            {onSignOut && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSignOut}
                disabled={retrying || internalSigningOut}
                className="w-full sm:w-auto h-11 rounded-xl border-border hover:bg-muted font-medium text-sm transition-all duration-200 flex items-center justify-center gap-2"
              >
                {internalSigningOut ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saindo...</span>
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4" />
                    <span>Sair</span>
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="mt-6 pt-5 border-t border-border/60 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Validação de segurança central Ricci Task</span>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4 px-4">
          Se a falha persistir por mais de alguns minutos, contate o administrador da firma.
        </p>
      </div>
    </div>
  )
}
