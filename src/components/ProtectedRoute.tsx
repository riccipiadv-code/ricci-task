import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { SplashScreen } from './SplashScreen'
import { AccessErrorScreen } from './AccessErrorScreen'
import Layout from './Layout'

/**
 * Protege rotas internas do sistema: se não houver usuário/sessão ativa, redireciona para /login.
 * Enquanto a autenticação estiver carregando a sessão inicial ou a autorização central, exibe o SplashScreen.
 * Quando ocorrer erro técnico de comunicação com o Gestor de Acessos (accessStatus === 'error'),
 * as rotas internas permanecem BLOQUEADAS e exibe-se a AccessErrorScreen com "Tentar novamente".
 */
export function ProtectedLayout() {
  const {
    session,
    loading,
    loadingAccess,
    hasSystemAccess,
    accessStatus,
    coreErrorMessage,
    refreshAccess,
    signOut,
  } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isSigningOutRef = useRef(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  // Reset da ref de signOut quando mudar de sessão ou de accessStatus (ex: novo login)
  const sessionUserId = session?.user?.id ?? null
  const lastDisabledUserIdRef = useRef<string | null>(null)

  // 4. Desconexão para accessStatus === 'disabled' executada em useEffect, uma única vez por sessão bloqueada
  useEffect(() => {
    if (
      accessStatus === 'disabled' &&
      sessionUserId &&
      (!isSigningOutRef.current || lastDisabledUserIdRef.current !== sessionUserId)
    ) {
      isSigningOutRef.current = true
      lastDisabledUserIdRef.current = sessionUserId
      setIsSigningOut(true)

      const performSignOut = async () => {
        try {
          const res = await signOut()
          if (res?.error) {
            console.error(
              '[ProtectedLayout] Erro retornado ao encerrar sessão de usuário desativado:',
              res.error,
            )
          }
        } catch (err) {
          console.error('[ProtectedLayout] Exceção ao encerrar sessão de usuário desativado:', err)
        } finally {
          setIsSigningOut(false)
          navigate('/login?reason=disabled', { replace: true })
        }
      }

      void performSignOut()
    }
  }, [accessStatus, sessionUserId, signOut, navigate])

  // 1. Aguarda inicialização de autenticação e resolução da autorização central
  // Enquanto estiver carregando ou desconectando o usuário desativado, exibe SplashScreen
  if (loading || (session && loadingAccess) || isSigningOut) {
    return <SplashScreen />
  }

  // Se o accessStatus é disabled, mantém bloqueado mesmo se logout falhou
  if (accessStatus === 'disabled') {
    return <Navigate to="/login?reason=disabled" replace />
  }

  // 2. Não autenticado -> redireciona para login simples
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // 3. Usuário autenticado sem vínculo válido para RICCI_TASK -> bloquear e redirecionar para /login?reason=no_access
  if (accessStatus === 'no_access') {
    return <Navigate to="/login?reason=no_access" replace />
  }

  // 5. Erro técnico comprovado na leitura das tabelas core_*
  // Etapa 1: Bloquear rotas internas (sem fail-open legado). Exibir tela de erro com "Tentar novamente" e "Sair".
  if (accessStatus === 'error') {
    return (
      <AccessErrorScreen
        onRetry={refreshAccess}
        onSignOut={async () => {
          await signOut()
          navigate('/login', { replace: true })
        }}
        isRetrying={loadingAccess}
        errorMessage={coreErrorMessage}
      />
    )
  }

  // 6. Acesso normal validado
  if (hasSystemAccess) {
    return (
      <Layout>
        <Outlet />
      </Layout>
    )
  }

  // Fallback seguro caso não tenha acesso e não tenha caído nos casos anteriores
  return <Navigate to="/login?reason=no_access" replace />
}

/**
 * Rota pública de login: se já houver sessão ativa e autorizada, redireciona para "/"
 * Alinhada com ProtectedRoute: aguarda autenticação e resolução de acesso da sessão atual.
 * Se houver sessão mas accessStatus === 'error', NÃO redireciona para "/" nem abre rota interna:
 * exibe a AccessErrorScreen com "Tentar novamente" e opção de sair.
 */
export function PublicRoute({ children }: { children: React.ReactNode }) {
  const {
    session,
    loading,
    loadingAccess,
    hasSystemAccess,
    accessStatus,
    coreErrorMessage,
    refreshAccess,
    signOut,
  } = useAuth()
  const navigate = useNavigate()

  // 1. Aguarda resolução de auth e autorização da sessão atual
  if (loading || (session && loadingAccess)) {
    return <SplashScreen />
  }

  // 2. Se tem sessão ativa com erro técnico na consulta central, NÃO redireciona para interna
  if (session && accessStatus === 'error') {
    return (
      <AccessErrorScreen
        onRetry={refreshAccess}
        onSignOut={async () => {
          await signOut()
          navigate('/login', { replace: true })
        }}
        isRetrying={loadingAccess}
        errorMessage={coreErrorMessage}
      />
    )
  }

  // 3. Se tem sessão ativa e acesso autorizado, redireciona para o sistema
  if (session && hasSystemAccess) {
    return <Navigate to="/" replace />
  }

  // 4. Se não tem sessão, ou sessão com no_access/disabled (que deve ver a tela de login), renderiza login
  return <>{children}</>
}

/**
 * Guarda de rota administrativa estrita:
 * Permite renderização apenas para perfil ADMINISTRADOR.
 * Usuários com perfis GESTOR ou OPERACIONAL são redirecionados para a tela principal ("/").
 */
export function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { corePerfil, loadingAccess } = useAuth()

  if (loadingAccess) {
    return <SplashScreen />
  }

  if (corePerfil !== 'ADMINISTRADOR') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
