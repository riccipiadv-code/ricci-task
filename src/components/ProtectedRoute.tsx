import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { SplashScreen } from './SplashScreen'
import Layout from './Layout'

/**
 * Protege rotas internas do sistema: se não houver usuário/sessão ativa, redireciona para /login.
 * Enquanto a autenticação estiver carregando a sessão inicial, exibe o SplashScreen.
 */
export function ProtectedLayout() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <SplashScreen />
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

/**
 * Rota pública de login: se já houver sessão ativa, redireciona direto para o Dashboard "/"
 */
export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) {
    return <SplashScreen />
  }

  if (session) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
