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

  it('ProtectedLayout: erro técnico aplica fail-open temporário baseado em sessão', () => {
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      session: { user: { id: 'u-err' } } as any,
      loading: false,
      loadingAccess: false,
      hasSystemAccess: false,
      accessStatus: 'error',
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<ProtectedLayout />}>
            <Route
              path="/"
              element={<div data-testid="home-content">Home Autorizada por Erro</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('home-content')).toBeDefined()
    expect(screen.getByTestId('layout-wrapper')).toBeDefined()
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
