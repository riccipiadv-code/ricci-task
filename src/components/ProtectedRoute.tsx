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

  // 4. Desconexão para accessStatus === 'disabled' executada em useEffect, com ref/flag para não repetir a chamada
  useEffect(() => {
    if (accessStatus === 'disabled' && !isSigningOutRef.current) {
      isSigningOutRef.current = true
      setIsSigningOut(true)
      signOut()
        .catch((err) => {
          console.error('[ProtectedLayout] Erro ao encerrar sessão do usuário desativado:', err)
        })
        .finally(() => {
          navigate('/login?reason=disabled', { replace: true })
        })
    }
  }, [accessStatus, signOut, navigate])

  // 1. Aguarda inicialização de autenticação e resolução da autorização central
  // Mantém a SplashScreen enquanto estiver carregando ou desconectando o usuário desativado
  if (loading || (session && loadingAccess) || isSigningOut) {
    return <SplashScreen />
  }

  // Se o accessStatus é disabled mas o effect ainda não completou a desconexão, mantém SplashScreen
  if (accessStatus === 'disabled') {
    return <SplashScreen />
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
 * Rota pública de login: se já houver sessão ativa, redireciona direto para o Dashboard "/"
 */
export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, loadingAccess, hasSystemAccess, accessStatus } = useAuth()
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const reason = searchParams.get('reason')

  // Se o usuário foi redirecionado com uma razão específica de bloqueio, exibe a tela de login
  // mesmo que a sessão do Supabase ainda esteja em transição de encerramento
  if (reason === 'no_access' || reason === 'disabled') {
    return <>{children}</>
  }

  if (loading || (session && loadingAccess)) {
    return <SplashScreen />
  }

  // Se tem sessão e tem acesso confirmado (ou erro técnico fail-open), redireciona para o sistema
  if (session && (hasSystemAccess || accessStatus === 'error')) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
