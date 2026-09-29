import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import Layout from '@/components/Layout'
import * as authHookModule from '@/hooks/use-auth'

vi.mock('@/hooks/useSupabaseConnection', () => ({
  useSupabaseConnection: () => ({ isConnected: true, checking: false }),
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))

describe('Layout - Visibilidade de Menus por Perfil Central', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ADMINISTRADOR: exibe links "Tabelas" e "Configurações" na sidebar desktop e na barra mobile', () => {
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      user: { id: 'u-admin', email: 'admin@riccipi.com.br' } as any,
      corePerfil: 'ADMINISTRADOR',
      coreUserId: 'cu-admin',
      hasSystemAccess: true,
      loadingAccess: false,
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout>
          <div>Conteúdo</div>
        </Layout>
      </MemoryRouter>,
    )

    // Tabelas e Configurações / Ajustes devem existir
    const tabelasElements = screen.getAllByText('Tabelas')
    expect(tabelasElements.length).toBeGreaterThan(0)

    const configDesktop = screen.queryByText('Configurações')
    const configMobile = screen.queryByText('Ajustes')
    expect(configDesktop).not.toBeNull()
    expect(configMobile).not.toBeNull()
  })

  it('GESTOR: NÃO exibe "Tabelas" nem "Configurações" / "Ajustes"', () => {
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      user: { id: 'u-gestor', email: 'gestor@riccipi.com.br' } as any,
      corePerfil: 'GESTOR',
      coreUserId: 'cu-gestor',
      hasSystemAccess: true,
      loadingAccess: false,
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout>
          <div>Conteúdo</div>
        </Layout>
      </MemoryRouter>,
    )

    expect(screen.queryByText('Tabelas')).toBeNull()
    expect(screen.queryByText('Configurações')).toBeNull()
    expect(screen.queryByText('Ajustes')).toBeNull()
  })

  it('OPERACIONAL: NÃO exibe "Tabelas" nem "Configurações" / "Ajustes"', () => {
    vi.spyOn(authHookModule, 'useAuth').mockReturnValue({
      user: { id: 'u-op', email: 'op@riccipi.com.br' } as any,
      corePerfil: 'OPERACIONAL',
      coreUserId: 'cu-op',
      hasSystemAccess: true,
      loadingAccess: false,
      signOut: vi.fn(),
    } as any)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Layout>
          <div>Conteúdo</div>
        </Layout>
      </MemoryRouter>,
    )

    expect(screen.queryByText('Tabelas')).toBeNull()
    expect(screen.queryByText('Configurações')).toBeNull()
    expect(screen.queryByText('Ajustes')).toBeNull()
  })
})
