import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { SplashScreen } from './SplashScreen'
import Layout from './Layout'

/**
 * Protege rotas internas do sistema: se não houver usuário/sessão ativa, redireciona para /login.
 * Enquanto a autenticação estiver carregando a sessão inicial, exibe o SplashScreen.
 */
export function ProtectedLayout() {
  const { session, loading, loadingAccess, hasSystemAccess, accessStatus, signOut } = useAuth()
  const location = useLocation()

  // 1. Aguarda inicialização de autenticação e resolução da autorização central
  if (loading || (session && loadingAccess)) {
    return <SplashScreen />
  }

  // 2. Não autenticado -> redireciona para login simples
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // 3. Usuário central inativo ou vínculo inativo -> encerra sessão e redireciona para /login?reason=disabled
  if (accessStatus === 'disabled') {
    // Desconecta o usuário centralmente inativado
    signOut().catch((err) => console.error('[ProtectedLayout] Erro ao encerrar sessão:', err))
    return <Navigate to="/login?reason=disabled" replace />
  }

  // 4. Usuário autenticado sem vínculo válido para RICCI_TASK -> bloquear e redirecionar para /login?reason=no_access
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
