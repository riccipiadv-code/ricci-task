import { describe, it, expect, vi, beforeEach } from 'vitest'
import { controleService } from '@/services/controleService'
import { supabase } from '@/lib/supabase/client'

describe('controleService.getUsuariosAtivos (Fail-Closed na integração central)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sucesso: chama RPC task_listar_usuarios_elegiveis e retorna usuários ordenados alfabeticamente com e-mail central', async () => {
    const mockRpcData = [
      {
        id: 'tu-1',
        nome: 'Beto Silva',
        email: 'beto.novo@riccipi.com.br',
        ativo: true,
      },
      {
        id: 'tu-2',
        nome: 'Ana Lima',
        email: 'ana.novo@riccipi.com.br',
        ativo: true,
      },
    ]

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockRpcData,
      error: null,
    } as any)

    const usuarios = await controleService.getUsuariosAtivos()

    expect(supabase.rpc).toHaveBeenCalledWith('task_listar_usuarios_elegiveis')
    expect(usuarios).toHaveLength(2)
    // Ordenado alfabeticamente por nome: Ana Lima primeiro, Beto Silva depois
    expect(usuarios[0].id).toBe('tu-2')
    expect(usuarios[0].nome).toBe('Ana Lima')
    expect(usuarios[0].email).toBe('ana.novo@riccipi.com.br')
    expect(usuarios[1].id).toBe('tu-1')
    expect(usuarios[1].nome).toBe('Beto Silva')
    expect(usuarios[1].email).toBe('beto.novo@riccipi.com.br')
  })

  it('falha na RPC: fail-closed estrito — não oferece candidatos não validados e lança erro amigável', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'relation core_usuarios does not exist' },
    } as any)

    await expect(controleService.getUsuariosAtivos()).rejects.toThrow(
      'relation core_usuarios does not exist',
    )
  })

  it('RPC retorna lista vazia: retorna array vazio com segurança', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: [],
      error: null,
    } as any)

    const usuarios = await controleService.getUsuariosAtivos()
    expect(usuarios).toEqual([])
  })
})
