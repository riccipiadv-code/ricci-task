import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Check,
  Mail,
  Lock,
  ArrowRight,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'

export default function LoginPage() {
  // Garante inicialização do tema
  useTheme()
  const { signIn, resetPassword, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Modal de Recuperação de Senha
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  // Redireciona para onde o usuário tentou ir ou para o dashboard "/"
  const fromLocation = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/'

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setErrorMessage('Por favor, informe seu e-mail institucional.')
      return
    }

    if (!password) {
      setErrorMessage('Por favor, digite sua senha de acesso.')
      return
    }

    setSubmitting(true)
    try {
      const { error } = await signIn(trimmedEmail, password)
      if (error) {
        // Mensagens em pt-BR claras e amigáveis
        const msg = error.message.toLowerCase()
        if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
          setErrorMessage(
            'E-mail ou senha inválidos. Verifique suas credenciais e tente novamente.',
          )
        } else if (msg.includes('email not confirmed')) {
          setErrorMessage('Este e-mail ainda não foi confirmado. Verifique sua caixa de entrada.')
        } else if (msg.includes('too many requests') || msg.includes('rate limit')) {
          setErrorMessage(
            'Muitas tentativas em sequência. Aguarde alguns instantes antes de tentar novamente.',
          )
        } else {
          setErrorMessage(
            error.message || 'Falha ao autenticar. Verifique sua conexão e tente novamente.',
          )
        }
        return
      }

      toast({
        title: 'Bem-vindo ao Ricci Task!',
        description: 'Login realizado com sucesso.',
      })
      navigate(fromLocation, { replace: true })
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : 'Erro inesperado de comunicação'
      setErrorMessage(`Não foi possível conectar ao servidor: ${errorText}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenResetModal = () => {
    setResetEmail(email.trim())
    setResetSent(false)
    setResetModalOpen(true)
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = resetEmail.trim()
    if (!trimmed) {
      toast({
        variant: 'destructive',
        title: 'Informe seu e-mail',
        description: 'Digite o e-mail da sua conta para receber o link.',
      })
      return
    }

    setResetting(true)
    try {
      const { error } = await resetPassword(trimmed)
      if (error) {
        toast({
          variant: 'destructive',
          title: 'Não foi possível enviar',
          description: error.message || 'Erro ao solicitar recuperação de senha.',
        })
      } else {
        setResetSent(true)
        toast({
          title: 'Link enviado com sucesso',
          description: 'Se o e-mail existir, enviaremos as instruções de redefinição de senha.',
        })
      }
    } catch {
      toast({
        variant: 'destructive',
        title: 'Erro de conexão',
        description: 'Verifique sua internet e tente novamente.',
      })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 antialiased selection:bg-primary/20 selection:text-primary transition-colors duration-300">
      {/* Background decorativo sutil com o tom primary #5B5BD6 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-primary/10 blur-3xl opacity-70" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-primary/10 blur-3xl opacity-70" />
      </div>

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* Brand / Logo Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/25 mb-4 transition-transform duration-200 hover:scale-105">
            <Check className="w-8 h-8 stroke-[3]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Ricci Task
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Acesso ao sistema de gestão integrada
          </p>
        </div>

        {/* Card do Formulário */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-card backdrop-blur-sm">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-foreground">Entrar na sua conta</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Utilize o e-mail e a senha vinculados à sua conta da firma.
            </p>
          </div>

          {errorMessage && (
            <div className="mb-5 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed font-medium">{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Campo E-mail */}
            <div className="space-y-1.5">
              <Label htmlFor="login-email" className="text-xs font-semibold text-foreground">
                E-mail institucional
              </Label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting || authLoading}
                  className="pl-10 h-11 rounded-xl bg-background border-border text-sm focus-visible:ring-primary"
                />
              </div>
            </div>

            {/* Campo Senha */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password" className="text-xs font-semibold text-foreground">
                  Senha de acesso
                </Label>
                <button
                  type="button"
                  onClick={handleOpenResetModal}
                  className="text-xs font-medium text-primary hover:underline transition-colors focus:outline-hidden"
                >
                  Esqueci minha senha?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting || authLoading}
                  className="pl-10 pr-10 h-11 rounded-xl bg-background border-border text-sm focus-visible:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Botão de Envio */}
            <Button
              type="submit"
              disabled={submitting || authLoading}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 transition-all duration-200 mt-2 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Validando credenciais...</span>
                </>
              ) : (
                <>
                  <span>Entrar no Ricci Task</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Segurança / Rodapé do Card */}
          <div className="mt-6 pt-5 border-t border-border/60 flex items-center justify-center gap-2 text-[11px] text-muted-foreground text-center">
            <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>Autenticação segura via Supabase Auth</span>
          </div>
        </div>

        {/* Informação sobre contas / Acesso da firma */}
        <p className="text-center text-xs text-muted-foreground mt-6 px-4">
          Acesso restrito aos colaboradores autorizados. Se você não possui cadastro, solicite ao
          administrador da firma.
        </p>
      </div>

      {/* Modal de Recuperação de Senha */}
      <Dialog open={resetModalOpen} onOpenChange={setResetModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-2">
              <KeyRound className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold">Recuperar senha</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Informe o e-mail da sua conta para receber um link de redefinição de senha.
            </DialogDescription>
          </DialogHeader>

          {resetSent ? (
            <div className="py-4 space-y-3">
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                <div>
                  <p className="font-semibold">Solicitação enviada!</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Se o e-mail <strong className="text-foreground">{resetEmail}</strong> estiver
                    cadastrado, enviamos as instruções de recuperação.
                  </p>
                </div>
              </div>
              <DialogFooter className="pt-2 sm:justify-end">
                <Button
                  type="button"
                  onClick={() => setResetModalOpen(false)}
                  className="rounded-xl h-10 px-5"
                >
                  Voltar ao Login
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email" className="text-xs font-semibold">
                  E-mail institucional
                </Label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reset-email"
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    disabled={resetting}
                    className="pl-10 h-10 rounded-xl text-sm"
                  />
                </div>
              </div>

              <DialogFooter className="pt-2 sm:justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setResetModalOpen(false)}
                  disabled={resetting}
                  className="rounded-xl h-10 px-4"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={resetting}
                  className="rounded-xl h-10 px-5 bg-primary text-primary-foreground font-semibold flex items-center gap-2"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <span>Enviar link</span>
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
