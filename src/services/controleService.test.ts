import { describe, it, expect, vi, beforeEach } from 'vitest'
import { controleService } from '@/services/controleService'
import { supabase } from '@/lib/supabase/client'

describe('controleService.getUsuariosAtivos (Fail-Closed na integração central)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sucesso: chama RPC task_listar_usuarios_elegiveis, resolve nome e e-mail centrais e retorna usuários ordenados alfabeticamente', async () => {
    const mockRpcData = [
      {
        id: 'tu-1',
        nome: 'Beto Silva Operacional',
        email: 'beto.velho@antigo.com',
        ativo: true,
      },
      {
        id: 'tu-2',
        nome: 'Ana Lima Operacional',
        email: 'ana.velho@antigo.com',
        ativo: true,
      },
    ]

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockRpcData,
      error: null,
    } as any)

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'tu-1',
                    ativo: true,
                    core_usuario_id: 'cu-1',
                    core_usuarios: {
                      id: 'cu-1',
                      nome: 'Beto Silva Central',
                      email: 'beto.novo@riccipi.com.br',
                      ativo: true,
                    },
                  },
                  {
                    id: 'tu-2',
                    ativo: true,
                    core_usuario_id: 'cu-2',
                    core_usuarios: {
                      id: 'cu-2',
                      nome: 'Ana Lima Central',
                      email: 'ana.novo@riccipi.com.br',
                      ativo: true,
                    },
                  },
                ],
                error: null,
              }),
          }),
        }
      }
      return {}
    }) as any)

    const usuarios = await controleService.getUsuariosAtivos()

    expect(supabase.rpc).toHaveBeenCalledWith('task_listar_usuarios_elegiveis')
    expect(usuarios).toHaveLength(2)
    // Ordenado alfabeticamente por nome central: Ana Lima primeiro, Beto Silva depois
    expect(usuarios[0].id).toBe('tu-2')
    expect(usuarios[0].nome).toBe('Ana Lima Central')
    expect(usuarios[0].email).toBe('ana.novo@riccipi.com.br')
    expect(usuarios[0].core_usuario_id).toBe('cu-2')
    expect(usuarios[1].id).toBe('tu-1')
    expect(usuarios[1].nome).toBe('Beto Silva Central')
    expect(usuarios[1].email).toBe('beto.novo@riccipi.com.br')
    expect(usuarios[1].core_usuario_id).toBe('cu-1')
  })

  it('falha na leitura de core_usuarios: fail-closed estrito — não usa dados locais antigos e rejeita', async () => {
    const mockRpcData = [
      {
        id: 'tu-1',
        nome: 'Beto Silva Operacional',
        email: 'beto.velho@antigo.com',
        ativo: true,
      },
    ]

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockRpcData,
      error: null,
    } as any)

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: null,
                error: { message: 'connection timeout ao consultar core_usuarios' },
              }),
          }),
        }
      }
      return {}
    }) as any)

    await expect(controleService.getUsuariosAtivos()).rejects.toThrow(
      'Falha técnica ao carregar dados centrais',
    )
  })

  it('retorno parcial/vazio de core_usuarios sem erro HTTP (ex: RLS restritivo): fail-closed estrito — rejeita e não oferece lista parcial', async () => {
    const mockRpcData = [
      {
        id: 'tu-1',
        nome: 'Beto Silva Operacional',
        email: 'beto.velho@antigo.com',
        ativo: true,
      },
      {
        id: 'tu-2',
        nome: 'Ana Lima Operacional',
        email: 'ana.velho@antigo.com',
        ativo: true,
      },
    ]

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockRpcData,
      error: null,
    } as any)

    // Simula retorno parcial por RLS: tu-1 retornado, tu-2 omitido silenciosamente sem erro HTTP (error: null)
    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'tu-1',
                    ativo: true,
                    core_usuario_id: 'cu-1',
                    core_usuarios: {
                      id: 'cu-1',
                      nome: 'Beto Silva Central',
                      email: 'beto.novo@riccipi.com.br',
                      ativo: true,
                    },
                  },
                ],
                error: null,
              }),
          }),
        }
      }
      return {}
    }) as any)

    await expect(controleService.getUsuariosAtivos()).rejects.toThrow(
      'Falha na validação central de usuários elegíveis: retorno parcial ou incompleto',
    )
  })

  it('retorno vazio de core_usuarios sem erro HTTP: fail-closed estrito — rejeita se a RPC retornou candidatos', async () => {
    const mockRpcData = [
      {
        id: 'tu-1',
        nome: 'Beto Silva Operacional',
        email: 'beto.velho@antigo.com',
        ativo: true,
      },
    ]

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockRpcData,
      error: null,
    } as any)

    // Retorno vazio silencioso (ex: RLS bloqueou leitura de core_usuarios)
    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [],
                error: null,
              }),
          }),
        }
      }
      return {}
    }) as any)

    await expect(controleService.getUsuariosAtivos()).rejects.toThrow(
      'Falha na validação central de usuários elegíveis: retorno parcial ou incompleto',
    )
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

describe('controleService.saveControle (Etapa de transição para IDs centrais)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'auth-user-123' } },
      error: null,
    } as any)
  })

  it('criação de caso: grava ID central e operacional simultaneamente para responsável e executor', async () => {
    const mockCreatedRecord = {
      id: 'tarefa-101',
      numero_caso: 12,
      nome_controle_id: 'nc-1',
      identificacao_caso: 'Processo X',
      status_id: 'st-aberto',
      responsavel_usuario_id: 'tu-resp',
      executor_usuario_id: 'tu-exec',
      responsavel_core_usuario_id: 'cu-resp',
      executor_core_usuario_id: 'cu-exec',
      data_autorizacao: '2025-01-10',
      prazo_conclusao: '2025-02-10',
      created_at: '2025-01-10T12:00:00Z',
      updated_at: '2025-01-10T12:00:00Z',
    }

    let insertPayloadCaptured: any = null

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_status') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { finaliza: false }, error: null }),
            }),
          }),
        }
      }
      if (table === 'task_tarefas') {
        return {
          insert: (payload: any) => {
            insertPayloadCaptured = payload
            return {
              select: () => ({
                single: () => Promise.resolve({ data: mockCreatedRecord, error: null }),
              }),
            }
          },
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: mockCreatedRecord, error: null }),
            }),
          }),
        }
      }
      if (table === 'task_providencias') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }
      }
      return {}
    }) as any)

    const usuariosLista = [
      {
        id: 'tu-resp',
        nome: 'Responsável Central',
        email: 'resp@riccipi.com.br',
        core_usuario_id: 'cu-resp',
      },
      {
        id: 'tu-exec',
        nome: 'Executor Central',
        email: 'exec@riccipi.com.br',
        core_usuario_id: 'cu-exec',
      },
    ]

    const result = await controleService.saveControle(
      {
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Processo X',
        status_id: 'st-aberto',
        data_autorizacao: '2025-01-10',
        prazo_conclusao: '2025-02-10',
        responsavel_usuario_id: 'tu-resp',
        executor_usuario_id: 'tu-exec',
      },
      usuariosLista,
    )

    expect(insertPayloadCaptured).not.toBeNull()
    // Grava simultaneamente os IDs operacionais e centrais
    expect(insertPayloadCaptured.responsavel_usuario_id).toBe('tu-resp')
    expect(insertPayloadCaptured.executor_usuario_id).toBe('tu-exec')
    expect(insertPayloadCaptured.responsavel_core_usuario_id).toBe('cu-resp')
    expect(insertPayloadCaptured.executor_core_usuario_id).toBe('cu-exec')
    expect(result.responsavel_core_usuario_id).toBe('cu-resp')
    expect(result.executor_core_usuario_id).toBe('cu-exec')
  })

  it('alteração de responsável/executor: grava ambos os IDs (operacional e central) e atualiza updated_at', async () => {
    const existingDbRecord = {
      id: 'tarefa-101',
      nome_controle_id: 'nc-1',
      identificacao_caso: 'Processo X',
      status_id: 'st-aberto',
      data_autorizacao: '2025-01-10',
      prazo_conclusao: '2025-02-10',
      responsavel_usuario_id: 'tu-resp-antigo',
      executor_usuario_id: 'tu-exec-antigo',
      responsavel_core_usuario_id: 'cu-resp-antigo',
      executor_core_usuario_id: 'cu-exec-antigo',
      pasta_cliente: null,
      pasta_ricci: null,
      updated_at: '2025-01-10T12:00:00Z',
      arquivado_at: null,
    }

    let updatePayloadCaptured: any = null

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_status') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { finaliza: false }, error: null }),
            }),
          }),
        }
      }
      if (table === 'task_tarefas') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: existingDbRecord, error: null }),
            }),
          }),
          update: (payload: any) => {
            updatePayloadCaptured = payload
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { ...existingDbRecord, ...payload },
                      error: null,
                    }),
                }),
              }),
            }
          },
        }
      }
      if (table === 'task_providencias') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }
      }
      return {}
    }) as any)

    const usuariosLista = [
      {
        id: 'tu-resp-novo',
        nome: 'Responsável Novo',
        email: 'resp.novo@riccipi.com.br',
        core_usuario_id: 'cu-resp-novo',
      },
      {
        id: 'tu-exec-novo',
        nome: 'Executor Novo',
        email: 'exec.novo@riccipi.com.br',
        core_usuario_id: 'cu-exec-novo',
      },
    ]

    await controleService.saveControle(
      {
        id: 'tarefa-101',
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Processo X',
        status_id: 'st-aberto',
        data_autorizacao: '2025-01-10',
        prazo_conclusao: '2025-02-10',
        responsavel_usuario_id: 'tu-resp-novo',
        executor_usuario_id: 'tu-exec-novo',
      },
      usuariosLista,
    )

    expect(updatePayloadCaptured).not.toBeNull()
    expect(updatePayloadCaptured.responsavel_usuario_id).toBe('tu-resp-novo')
    expect(updatePayloadCaptured.executor_usuario_id).toBe('tu-exec-novo')
    expect(updatePayloadCaptured.responsavel_core_usuario_id).toBe('cu-resp-novo')
    expect(updatePayloadCaptured.executor_core_usuario_id).toBe('cu-exec-novo')
    // Como houve alteração real de responsável e executor, updated_at deve ser gerado
    expect(updatePayloadCaptured.updated_at).toBeDefined()
  })

  it('edição sem alteração de atribuição nem de conteúdo: preserva atribuição e NÃO altera updated_at', async () => {
    const originalUpdatedAt = '2025-01-10T12:00:00.000Z'
    const existingDbRecord = {
      id: 'tarefa-101',
      nome_controle_id: 'nc-1',
      identificacao_caso: 'Processo X',
      status_id: 'st-aberto',
      data_autorizacao: '2025-01-10',
      prazo_conclusao: '2025-02-10',
      responsavel_usuario_id: 'tu-inativo-resp',
      executor_usuario_id: 'tu-inativo-exec',
      responsavel_core_usuario_id: 'cu-inativo-resp',
      executor_core_usuario_id: 'cu-inativo-exec',
      pasta_cliente: null,
      pasta_ricci: null,
      updated_at: originalUpdatedAt,
      arquivado_at: null,
    }

    let updatePayloadCaptured: any = null

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_status') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { finaliza: false }, error: null }),
            }),
          }),
        }
      }
      if (table === 'task_tarefas') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: existingDbRecord, error: null }),
            }),
          }),
          update: (payload: any) => {
            updatePayloadCaptured = payload
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { ...existingDbRecord, ...payload },
                      error: null,
                    }),
                }),
              }),
            }
          },
        }
      }
      if (table === 'task_providencias') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  order: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }
      }
      return {}
    }) as any)

    // Simulando que os usuários inativos não estão na lista de ativos elegíveis atuais
    // mas os IDs centrais preservados são repassados (ou resolvidos)
    await controleService.saveControle(
      {
        id: 'tarefa-101',
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Processo X',
        status_id: 'st-aberto',
        data_autorizacao: '2025-01-10',
        prazo_conclusao: '2025-02-10',
        responsavel_usuario_id: 'tu-inativo-resp',
        executor_usuario_id: 'tu-inativo-exec',
        responsavel_core_usuario_id: 'cu-inativo-resp',
        executor_core_usuario_id: 'cu-inativo-exec',
      },
      [], // lista vazia de ativos elegíveis
    )

    expect(updatePayloadCaptured).not.toBeNull()
    // Preserva rigorosamente os IDs operacionais e centrais
    expect(updatePayloadCaptured.responsavel_usuario_id).toBe('tu-inativo-resp')
    expect(updatePayloadCaptured.executor_usuario_id).toBe('tu-inativo-exec')
    expect(updatePayloadCaptured.responsavel_core_usuario_id).toBe('cu-inativo-resp')
    expect(updatePayloadCaptured.executor_core_usuario_id).toBe('cu-inativo-exec')
    // Não altera updated_at para não invalidar idempotência de e-mails
    expect(updatePayloadCaptured.updated_at).toBeUndefined()
  })

  it('bloqueia gravação se responsável ou executor não possuir vínculo central válido', async () => {
    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_status') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { finaliza: false }, error: null }),
            }),
          }),
        }
      }
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [{ id: 'tu-sem-core', core_usuario_id: null }],
                error: null,
              }),
          }),
        }
      }
      return {}
    }) as any)

    await expect(
      controleService.saveControle(
        {
          nome_controle_id: 'nc-1',
          identificacao_caso: 'Caso Sem Vínculo',
          status_id: 'st-aberto',
          responsavel_usuario_id: 'tu-sem-core',
          executor_usuario_id: 'tu-sem-core',
        },
        [],
      ),
    ).rejects.toThrow('Gravação bloqueada: o Responsável selecionado não possui vínculo central')
  })
})
