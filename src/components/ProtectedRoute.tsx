import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { SplashScreen } from './SplashScreen'
import Layout from './Layout'

/**
 * Protege rotas internas do sistema: se não houver usuário/sessão ativa, redireciona para /login.
 * Enquanto a autenticação estiver carregando a sessão inicial ou a autorização central, exibe o SplashScreen.
 */
export function ProtectedLayout() {
  const { session, loading, loadingAccess, hasSystemAccess, accessStatus, signOut } = useAuth()
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
  // Manter TEMPORARIAMENTE o comportamento legado baseado em sessão autenticada (fail-open)
  if (accessStatus === 'error') {
    console.warn(
      '[ProtectedLayout] Falha técnica ao consultar Gestor de Acessos. Aplicando fail-open temporário baseado em sessão.',
    )
    return (
      <Layout>
        <Outlet />
      </Layout>
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
 */
export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, loadingAccess, hasSystemAccess, accessStatus } = useAuth()

  // 1. Aguarda resolução de auth e autorização da sessão atual
  if (loading || (session && loadingAccess)) {
    return <SplashScreen />
  }

  // 2. Se tem sessão ativa e acesso autorizado (ou erro técnico fail-open), redireciona para o sistema
  if (session && (hasSystemAccess || accessStatus === 'error')) {
    return <Navigate to="/" replace />
  }

  // 3. Se não tem sessão, ou sessão com no_access/disabled (que deve ver a tela de login), renderiza login
  return <>{children}</>
}
