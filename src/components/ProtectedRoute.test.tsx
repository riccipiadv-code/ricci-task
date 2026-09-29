import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProtectedLayout, PublicRoute } from '@/components/ProtectedRoute'
import * as authHookModule from '@/hooks/use-auth'

vi.mock('@/components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout-wrapper">{children}</div>
  ),
}))

vi.mock('@/components/SplashScreen', () => ({
  SplashScreen: () => <div data-testid="splash-screen">SplashScreen Carregando...</div>,
}))

describe('ProtectedRoute e PublicRoute (comportamento de rotas e retenção em login)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ProtectedLayout: aguarda resolução exibindo SplashScreen', () => {
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u1' } } as any,
      loading: false,
      loadingAccess: true,
      hasSystemAccess: false,
      accessStatus: null,
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<div data-testid="home-content">Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('splash-screen')).toBeDefined()
    expect(screen.queryByTestId('home-content')).toBeNull()
  })

  it('ProtectedLayout: usuário desativado dispara signOut uma vez e redireciona para login?reason=disabled', async () => {
    const signOutMock = vi.fn().mockResolvedValue({ error: null })
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u-disabled' } } as any,
      loading: false,
      loadingAccess: false,
      hasSystemAccess: false,
      accessStatus: 'disabled',
      signOut: signOutMock,
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<div data-testid="home-content">Home</div>} />
          </Route>
          <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('login-page')).toBeDefined()
    })
  })

  it('ProtectedLayout: erro técnico bloqueia rotas internas e exibe AccessErrorScreen com botão Tentar novamente', () => {
    const refreshAccessMock = vi.fn().mockResolvedValue(null)
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u-err' } } as any,
      loading: false,
      loadingAccess: false,
      hasSystemAccess: false,
      accessStatus: 'error',
      coreErrorMessage: 'Falha de conexão com a tabela core_usuario_perfis',
      refreshAccess: refreshAccessMock,
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<div data-testid="home-content">Home Bloqueada</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    // NÃO deve liberar a rota interna nem o layout
    expect(screen.queryByTestId('home-content')).toBeNull()
    expect(screen.queryByTestId('layout-wrapper')).toBeNull()

    // Deve exibir a tela de erro de comunicação
    expect(screen.getByTestId('access-error-screen')).toBeDefined()
    expect(screen.getByText('Falha de comunicação com o Gestor de Acessos')).toBeDefined()
    expect(screen.getByText(/Falha de conexão com a tabela core_usuario_perfis/)).toBeDefined()

    // Botão Tentar novamente deve estar visível
    const retryButton = screen.getByRole('button', { name: /Tentar novamente/i })
    expect(retryButton).toBeDefined()
  })

  it('ProtectedLayout: clicar em Tentar novamente chama refreshAccess', () => {
    const refreshAccessMock = vi.fn().mockResolvedValue(null)
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u-err' } } as any,
      loading: false,
      loadingAccess: false,
      hasSystemAccess: false,
      accessStatus: 'error',
      coreErrorMessage: null,
      refreshAccess: refreshAccessMock,
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<div data-testid="home-content">Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const retryButton = screen.getByRole('button', { name: /Tentar novamente/i })
    retryButton.click()
    expect(refreshAccessMock).toHaveBeenCalledTimes(1)
  })

  it('ProtectedLayout: durante a revalidação (loadingAccess = true), mantém bloqueado e exibe SplashScreen', () => {
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u-err' } } as any,
      loading: false,
      loadingAccess: true,
      hasSystemAccess: false,
      accessStatus: 'error',
      refreshAccess: vi.fn(),
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<div data-testid="home-content">Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('splash-screen')).toBeDefined()
    expect(screen.queryByTestId('home-content')).toBeNull()
    expect(screen.queryByTestId('access-error-screen')).toBeNull()
  })

  it('PublicRoute: sessão ativa com accessStatus === error NÃO redireciona para "/" e exibe AccessErrorScreen', () => {
    const refreshAccessMock = vi.fn().mockResolvedValue(null)
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u-err' } } as any,
      loading: false,
      loadingAccess: false,
      hasSystemAccess: false,
      accessStatus: 'error',
      refreshAccess: refreshAccessMock,
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <div data-testid="login-form">Formulário de Login</div>
              </PublicRoute>
            }
          />
          <Route
            path="/"
            element={<div data-testid="dashboard-content">Dashboard Principal</div>}
          />
        </Routes>
      </MemoryRouter>,
    )

    // NÃO deve redirecionar para "/"
    expect(screen.queryByTestId('dashboard-content')).toBeNull()
    // NÃO deve exibir o form de login comum
    expect(screen.queryByTestId('login-form')).toBeNull()
    // Deve exibir tela de erro com Tentar novamente
    expect(screen.getByTestId('access-error-screen')).toBeDefined()
    expect(screen.getByText('Falha de comunicação com o Gestor de Acessos')).toBeDefined()
  })

  it('PublicRoute: usuário com acesso autorizado em /login é redirecionado para / mesmo se houver ?reason na URL', () => {
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u-ok' } } as any,
      loading: false,
      loadingAccess: false,
      hasSystemAccess: true,
      accessStatus: 'ok',
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/login?reason=no_access']}>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <div data-testid="login-form">Formulário de Login</div>
              </PublicRoute>
            }
          />
          <Route
            path="/"
            element={<div data-testid="dashboard-content">Dashboard Principal</div>}
          />
        </Routes>
      </MemoryRouter>,
    )

    // NÃO deve ficar preso no formulário de login; deve navegar para /
    expect(screen.queryByTestId('login-form')).toBeNull()
    expect(screen.getByTestId('dashboard-content')).toBeDefined()
  })

  it('PublicRoute: usuário com no_access vê a tela de login', () => {
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u-blocked' } } as any,
      loading: false,
      loadingAccess: false,
      hasSystemAccess: false,
      accessStatus: 'no_access',
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/login?reason=no_access']}>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <div data-testid="login-form">Formulário de Login</div>
              </PublicRoute>
            }
          />
          <Route
            path="/"
            element={<div data-testid="dashboard-content">Dashboard Principal</div>}
          />
        </Routes>
      </MemoryRouter>,
    )

    // Deve exibir o formulário de login com a mensagem de bloqueio
    expect(screen.getByTestId('login-form')).toBeDefined()
    expect(screen.queryByTestId('dashboard-content')).toBeNull()
  })
})
