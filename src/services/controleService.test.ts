import { describe, it, expect, vi, beforeEach } from 'vitest'
import { controleService } from '@/services/controleService'
import { supabase } from '@/lib/supabase/client'

describe('controleService.getUsuariosAtivos (Fail-Closed na integração central)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sucesso: retorna apenas task_usuarios com vínculo ativo confirmado no Gestor de Acessos', async () => {
    const mockTaskUsers = [
      {
        id: 'tu-1',
        nome: 'Beto Silva',
        email: 'beto@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-1',
      },
      {
        id: 'tu-2',
        nome: 'Ana Lima',
        email: 'ana@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-2',
      },
      {
        id: 'tu-3',
        nome: 'Carlos Souza',
        email: 'carlos@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-3',
      },
    ]

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            eq: () => ({
              not: () => Promise.resolve({ data: mockTaskUsers, error: null }),
            }),
          }),
        } as any
      }

      if (table === 'core_sistemas') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: 'sys-ricci-task', codigo: 'RICCI_TASK', ativo: true },
                  error: null,
                }),
            }),
          }),
        } as any
      }

      if (table === 'core_usuario_sistemas') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () =>
                      // Apenas cu-1 e cu-2 têm vínculo confirmado
                      Promise.resolve({
                        data: [{ usuario_id: 'cu-1' }, { usuario_id: 'cu-2' }],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }),
        } as any
      }

      return {} as any
    })

    const usuarios = await controleService.getUsuariosAtivos()

    expect(usuarios).toHaveLength(2)
    // Ordenado por nome (Ana primeiro, Beto depois)
    expect(usuarios[0].id).toBe('tu-2')
    expect(usuarios[0].nome).toBe('Ana Lima')
    expect(usuarios[1].id).toBe('tu-1')
    expect(usuarios[1].nome).toBe('Beto Silva')
    // tu-3 não foi confirmado no Gestor de Acessos e não deve aparecer
    expect(usuarios.some((u) => u.id === 'tu-3')).toBe(false)
  })

  it('falha técnica na consulta de core_sistemas: NÃO disponibiliza candidatos (fail-closed) e lança erro recuperável', async () => {
    const mockTaskUsers = [
      {
        id: 'tu-1',
        nome: 'Beto Silva',
        email: 'beto@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-1',
      },
      {
        id: 'tu-2',
        nome: 'Ana Lima',
        email: 'ana@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-2',
      },
    ]

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            eq: () => ({
              not: () => Promise.resolve({ data: mockTaskUsers, error: null }),
            }),
          }),
        } as any
      }

      if (table === 'core_sistemas') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: null,
                  error: new Error('Erro de conexão com a tabela core_sistemas'),
                }),
            }),
          }),
        } as any
      }

      return {} as any
    })

    await expect(controleService.getUsuariosAtivos()).rejects.toThrow(
      'Falha técnica ao validar permissões no Gestor de Acessos. Novos vínculos estão temporariamente suspensos.',
    )
  })

  it('falha técnica na consulta de core_usuario_sistemas: NÃO disponibiliza candidatos (fail-closed) e lança erro recuperável', async () => {
    const mockTaskUsers = [
      {
        id: 'tu-1',
        nome: 'Beto Silva',
        email: 'beto@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-1',
      },
    ]

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            eq: () => ({
              not: () => Promise.resolve({ data: mockTaskUsers, error: null }),
            }),
          }),
        } as any
      }

      if (table === 'core_sistemas') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: 'sys-ricci-task', codigo: 'RICCI_TASK', ativo: true },
                  error: null,
                }),
            }),
          }),
        } as any
      }

      if (table === 'core_usuario_sistemas') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () =>
                      Promise.resolve({
                        data: null,
                        error: new Error('Timeout ao ler core_usuario_sistemas'),
                      }),
                  }),
                }),
              }),
            }),
          }),
        } as any
      }

      return {} as any
    })

    await expect(controleService.getUsuariosAtivos()).rejects.toThrow(
      'Falha técnica ao consultar vínculos no Gestor de Acessos. Novos vínculos estão temporariamente suspensos.',
    )
  })
})
