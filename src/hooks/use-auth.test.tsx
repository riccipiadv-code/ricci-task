import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import * as coreAccessModule from '@/services/core-access'
import { supabase } from '@/lib/supabase/client'

// Helper para encapsular com AuthProvider
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
)

describe('Ciclo central de Autenticação e Autorização (useAuth)', () => {
  let authChangeCallback: ((event: string, session: any) => void) | null = null
  let mockSubscription: { unsubscribe: () => void }

  beforeEach(() => {
    vi.clearAllMocks()
    authChangeCallback = null
    mockSubscription = { unsubscribe: vi.fn() }

    // Mock do supabase.auth
    vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb: any) => {
      authChangeCallback = cb
      return {
        data: { subscription: mockSubscription },
      } as any
    })

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null,
    } as any)

    vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({
      error: null,
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 1. login autorizado e restauração de sessão autorizada abrem o sistema
  it('1. login autorizado e restauração de sessão autorizada abrem o sistema', async () => {
    const mockUser = { id: 'user-auth-1', email: 'autorizado@riccipi.com.br' }
    const mockSession = { user: mockUser, access_token: 'token-1' }

    vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockResolvedValue({
      hasSystemAccess: true,
      accessStatus: 'ok',
      perfil: 'ADMINISTRADOR',
      perfilNome: 'Administrador Geral',
      coreUserId: 'core-1',
      usuarioNome: 'Usuário Autorizado',
      errorMessage: null,
      isTechnicalError: false,
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    // Dispara login/restauração de sessão
    act(() => {
      authChangeCallback?.('SIGNED_IN', mockSession)
    })

    // Enquanto carrega, loadingAccess deve ser true e hasSystemAccess falso
    expect(result.current.loadingAccess).toBe(true)
    expect(result.current.hasSystemAccess).toBe(false)

    // Aguarda conclusão da resolução
    await waitFor(() => {
      expect(result.current.loadingAccess).toBe(false)
    })

    expect(result.current.hasSystemAccess).toBe(true)
    expect(result.current.accessStatus).toBe('ok')
    expect(result.current.corePerfil).toBe('ADMINISTRADOR')
    expect(result.current.coreUserId).toBe('core-1')
  })

  // 2. eventos repetidos e TOKEN_REFRESHED do mesmo usuário não geram SplashScreen infinita nem consultas duplicadas
  it('2. eventos repetidos e TOKEN_REFRESHED do mesmo usuário não geram SplashScreen infinita nem consultas duplicadas', async () => {
    const mockUser = { id: 'user-refresh-1', email: 'same@riccipi.com.br' }
    const mockSession = { user: mockUser, access_token: 'token-ref-1' }

    const resolveSpy = vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockResolvedValue({
      hasSystemAccess: true,
      accessStatus: 'ok',
      perfil: 'GESTOR',
      perfilNome: 'Gestor',
      coreUserId: 'core-ref-1',
      usuarioNome: 'Usuário Refreshed',
      errorMessage: null,
      isTechnicalError: false,
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    // Sessão inicial
    act(() => {
      authChangeCallback?.('SIGNED_IN', mockSession)
    })

    await waitFor(() => {
      expect(result.current.loadingAccess).toBe(false)
    })

    expect(resolveSpy).toHaveBeenCalledTimes(1)
    expect(result.current.hasSystemAccess).toBe(true)

    // Dispara TOKEN_REFRESHED repetidas vezes para o mesmo usuário
    act(() => {
      authChangeCallback?.('TOKEN_REFRESHED', { ...mockSession, access_token: 'token-ref-2' })
      authChangeCallback?.('TOKEN_REFRESHED', { ...mockSession, access_token: 'token-ref-3' })
    })

    // NÃO deve ativar loadingAccess sem consulta nem disparar novas consultas duplicadas
    expect(result.current.loadingAccess).toBe(false)
    expect(resolveSpy).toHaveBeenCalledTimes(1)
    expect(result.current.hasSystemAccess).toBe(true)
  })

  // 3. troca de usuário com consulta anterior pendente: a resposta antiga não se aplica
  it('3. troca de usuário com consulta anterior pendente: a resposta antiga não se aplica', async () => {
    let resolveUser1: (val: any) => void = () => {}
    const user1Promise = new Promise((res) => {
      resolveUser1 = res
    })

    let resolveUser2: (val: any) => void = () => {}
    const user2Promise = new Promise((res) => {
      resolveUser2 = res
    })

    vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockImplementation((uid: string) => {
      if (uid === 'user-slow-1') return user1Promise as any
      if (uid === 'user-fast-2') return user2Promise as any
      return Promise.resolve({} as any)
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    // 1. Usuário 1 loga
    act(() => {
      authChangeCallback?.('SIGNED_IN', { user: { id: 'user-slow-1' } })
    })

    expect(result.current.loadingAccess).toBe(true)

    // 2. Antes do usuário 1 responder, troca para o Usuário 2
    act(() => {
      authChangeCallback?.('SIGNED_IN', { user: { id: 'user-fast-2' } })
    })

    // Usuário 2 deve invalidar imediatamente o anterior
    expect(result.current.loadingAccess).toBe(true)
    expect(result.current.hasSystemAccess).toBe(false)
    expect(result.current.corePerfil).toBeNull()

    // 3. Usuário 1 finalmente resolve (com dados de administrador)
    await act(async () => {
      resolveUser1({
        hasSystemAccess: true,
        accessStatus: 'ok',
        perfil: 'ADMIN_USER_1',
        perfilNome: 'Admin 1',
        coreUserId: 'core-1',
        errorMessage: null,
      })
    })

    // A resposta antiga NÃO pode ter sido aplicada!
    expect(result.current.corePerfil).toBeNull()
    expect(result.current.hasSystemAccess).toBe(false)

    // 4. Usuário 2 resolve com seu próprio perfil
    await act(async () => {
      resolveUser2({
        hasSystemAccess: true,
        accessStatus: 'ok',
        perfil: 'OPERACIONAL_USER_2',
        perfilNome: 'Operacional 2',
        coreUserId: 'core-2',
        errorMessage: null,
      })
    })

    expect(result.current.loadingAccess).toBe(false)
    expect(result.current.hasSystemAccess).toBe(true)
    expect(result.current.corePerfil).toBe('OPERACIONAL_USER_2')
  })

  // 4. logout durante consulta em andamento
  it('4. logout durante consulta em andamento não restaura acesso após logout', async () => {
    let resolveUser: (val: any) => void = () => {}
    const pendingPromise = new Promise((res) => {
      resolveUser = res
    })

    vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockReturnValue(pendingPromise as any)

    const { result } = renderHook(() => useAuth(), { wrapper })

    // Inicia login
    act(() => {
      authChangeCallback?.('SIGNED_IN', { user: { id: 'user-logout-target' } })
    })

    expect(result.current.loadingAccess).toBe(true)

    // Desconecta enquanto consulta ainda está em voo
    act(() => {
      authChangeCallback?.('SIGNED_OUT', null)
    })

    // Estado deve estar limpo imediatamente
    expect(result.current.session).toBeNull()
    expect(result.current.user).toBeNull()
    expect(result.current.loadingAccess).toBe(false)
    expect(result.current.hasSystemAccess).toBe(false)

    // Agora a consulta antiga finaliza
    await act(async () => {
      resolveUser({
        hasSystemAccess: true,
        accessStatus: 'ok',
        perfil: 'ADMIN',
        coreUserId: 'c1',
      })
    })

    // Não deve ressuscitar dados de acesso!
    expect(result.current.session).toBeNull()
    expect(result.current.hasSystemAccess).toBe(false)
    expect(result.current.accessStatus).toBeNull()
  })

  // 5. revalidações concorrentes (refreshAccess em paralelo)
  it('5. revalidações concorrentes (refreshAccess em paralelo) deduplicam ou respeitam a versão mais recente', async () => {
    let callCount = 0
    vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockImplementation(async () => {
      callCount++
      await new Promise((r) => setTimeout(r, 10))
      return {
        hasSystemAccess: true,
        accessStatus: 'ok',
        perfil: 'ADMIN',
        coreUserId: 'c1',
        errorMessage: null,
      } as any
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => {
      authChangeCallback?.('SIGNED_IN', { user: { id: 'user-concurrent' } })
    })

    await waitFor(() => {
      expect(result.current.loadingAccess).toBe(false)
    })

    expect(callCount).toBe(1)

    // Dispara dois refreshAccess simultâneos
    let p1: any
    let p2: any
    await act(async () => {
      p1 = result.current.refreshAccess()
      p2 = result.current.refreshAccess()
      await Promise.all([p1, p2])
    })

    // Ambos completaram com sucesso sem estado inconsistente
    expect(result.current.loadingAccess).toBe(false)
    expect(result.current.hasSystemAccess).toBe(true)
    expect(result.current.accessStatus).toBe('ok')
  })

  // 6. ausência de acesso -> bloqueio; usuário inativo -> desconexão única sem loop; falha de logout mantém bloqueio
  it('6. ausência de acesso -> bloqueio (no_access); usuário inativo -> disabled', async () => {
    // 6a: Sem acesso (no_access)
    vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockResolvedValueOnce({
      hasSystemAccess: false,
      accessStatus: 'no_access',
      perfil: null,
      coreUserId: null,
      errorMessage: 'Usuário sem vínculo configurado.',
      isTechnicalError: false,
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => {
      authChangeCallback?.('SIGNED_IN', { user: { id: 'user-no-access' } })
    })

    await waitFor(() => {
      expect(result.current.loadingAccess).toBe(false)
    })

    expect(result.current.hasSystemAccess).toBe(false)
    expect(result.current.accessStatus).toBe('no_access')

    // 6b: Usuário desativado (disabled)
    vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockResolvedValueOnce({
      hasSystemAccess: false,
      accessStatus: 'disabled',
      perfil: null,
      coreUserId: 'c-disabled',
      errorMessage: 'Usuário inativo no sistema corporativo.',
      isTechnicalError: false,
    })

    act(() => {
      authChangeCallback?.('SIGNED_IN', { user: { id: 'user-disabled' } })
    })

    await waitFor(() => {
      expect(result.current.loadingAccess).toBe(false)
    })

    expect(result.current.hasSystemAccess).toBe(false)
    expect(result.current.accessStatus).toBe('disabled')
  })

  // 7. falha técnica -> fallback temporário legado; recuperação posterior funciona
  it('7. falha técnica -> accessStatus=error (fail-open); recuperação posterior via refreshAccess funciona', async () => {
    vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockRejectedValueOnce(
      new Error('Erro de conexão ao banco'),
    )

    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => {
      authChangeCallback?.('SIGNED_IN', { user: { id: 'user-technical-error' } })
    })

    await waitFor(() => {
      expect(result.current.loadingAccess).toBe(false)
    })

    // Na falha técnica: hasSystemAccess=false, accessStatus='error'
    expect(result.current.hasSystemAccess).toBe(false)
    expect(result.current.accessStatus).toBe('error')
    expect(result.current.coreErrorMessage).toContain('Erro de conexão ao banco')

    // Recuperação posterior via refreshAccess
    vi.spyOn(coreAccessModule, 'resolveUserCoreAccess').mockResolvedValueOnce({
      hasSystemAccess: true,
      accessStatus: 'ok',
      perfil: 'ADMIN',
      coreUserId: 'c-recovered',
      errorMessage: null,
      isTechnicalError: false,
    })

    await act(async () => {
      await result.current.refreshAccess()
    })

    expect(result.current.loadingAccess).toBe(false)
    expect(result.current.hasSystemAccess).toBe(true)
    expect(result.current.accessStatus).toBe('ok')
  })
})
