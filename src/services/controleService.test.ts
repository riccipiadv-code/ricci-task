import { describe, it, expect, vi, beforeEach } from 'vitest'
import { controleService } from '@/services/controleService'
import { supabase } from '@/lib/supabase/client'

describe('controleService.getUsuariosAtivos (Nova fonte central: task_listar_usuarios_core_elegiveis)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sucesso: chama RPC task_listar_usuarios_core_elegiveis como ÚNICA fonte de elegibilidade e resolve ponte task_usuarios', async () => {
    const mockCoreRpcData = [
      {
        id: 'cu-1',
        nome: 'Beto Silva Central',
        email: 'beto.novo@riccipi.com.br',
        ativo: true,
      },
      {
        id: 'cu-2',
        nome: 'Ana Lima Central',
        email: 'ana.novo@riccipi.com.br',
        ativo: true,
      },
    ]

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockCoreRpcData,
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
                  },
                  {
                    id: 'tu-2',
                    ativo: true,
                    core_usuario_id: 'cu-2',
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

    // Regra 1: usa task_listar_usuarios_core_elegiveis como ÚNICA fonte
    expect(supabase.rpc).toHaveBeenCalledWith('task_listar_usuarios_core_elegiveis')
    expect(supabase.rpc).not.toHaveBeenCalledWith('task_listar_usuarios_elegiveis')
    expect(usuarios).toHaveLength(2)

    // Ordenação alfabética pelo nome central: Ana Lima primeiro, Beto Silva depois
    expect(usuarios[0].id).toBe('tu-2')
    expect(usuarios[0].nome).toBe('Ana Lima Central')
    expect(usuarios[0].email).toBe('ana.novo@riccipi.com.br')
    expect(usuarios[0].core_usuario_id).toBe('cu-2')
    expect(usuarios[0].task_usuario_id).toBe('tu-2')

    expect(usuarios[1].id).toBe('tu-1')
    expect(usuarios[1].nome).toBe('Beto Silva Central')
    expect(usuarios[1].email).toBe('beto.novo@riccipi.com.br')
    expect(usuarios[1].core_usuario_id).toBe('cu-1')
    expect(usuarios[1].task_usuario_id).toBe('tu-1')
  })

  it('pessoa elegível no core SEM ponte task_usuarios: preserva usuário na lista com task_usuario_id null', async () => {
    const mockCoreRpcData = [
      {
        id: 'cu-sem-ponte',
        nome: 'Carlos Sem Ponte',
        email: 'carlos@riccipi.com.br',
        ativo: true,
      },
    ]

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockCoreRpcData,
      error: null,
    } as any)

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [], // sem ponte em task_usuarios
                error: null,
              }),
          }),
        }
      }
      return {}
    }) as any)

    const usuarios = await controleService.getUsuariosAtivos()
    expect(usuarios).toHaveLength(1)
    expect(usuarios[0].id).toBe('cu-sem-ponte')
    expect(usuarios[0].nome).toBe('Carlos Sem Ponte')
    expect(usuarios[0].core_usuario_id).toBe('cu-sem-ponte')
    expect(usuarios[0].task_usuario_id).toBeNull()
  })

  it('falha técnica na consulta da ponte: fail-closed estrito — rejeita e não recorre a fallback', async () => {
    const mockCoreRpcData = [
      {
        id: 'cu-1',
        nome: 'Beto Silva Central',
        email: 'beto@riccipi.com.br',
        ativo: true,
      },
    ]

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockCoreRpcData,
      error: null,
    } as any)

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: null,
                error: { message: 'connection timeout' },
              }),
          }),
        }
      }
      return {}
    }) as any)

    await expect(controleService.getUsuariosAtivos()).rejects.toThrow(
      'Falha técnica ao verificar a ponte operacional',
    )
  })

  it('falha na RPC nova: fail-closed estrito — lança erro e bloqueia candidatos', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'permission denied for function task_listar_usuarios_core_elegiveis' },
    } as any)

    await expect(controleService.getUsuariosAtivos()).rejects.toThrow(
      'permission denied for function task_listar_usuarios_core_elegiveis',
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
      if (table === 'task_usuarios') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  { id: 'tu-resp', core_usuario_id: 'cu-resp' },
                  { id: 'tu-exec', core_usuario_id: 'cu-exec' },
                ],
                error: null,
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
        responsavel_core_usuario_id: 'cu-resp',
        executor_core_usuario_id: 'cu-exec',
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

  it('mudança REAL: chama update em task_tarefas, NÃO envia updated_at no payload e usa o valor retornado pelo banco', async () => {
    const dbGeneratedUpdatedAt = '2025-05-20T18:45:00.000Z'
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
    let updateCalled = false

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
                data: [
                  { id: 'tu-resp-novo', core_usuario_id: 'cu-resp-novo' },
                  { id: 'tu-exec-novo', core_usuario_id: 'cu-exec-novo' },
                ],
                error: null,
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
            updateCalled = true
            updatePayloadCaptured = payload
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        ...existingDbRecord,
                        ...payload,
                        updated_at: dbGeneratedUpdatedAt,
                      },
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

    const result = await controleService.saveControle(
      {
        id: 'tarefa-101',
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Processo X',
        status_id: 'st-aberto',
        data_autorizacao: '2025-01-10',
        prazo_conclusao: '2025-02-10',
        responsavel_usuario_id: 'tu-resp-novo',
        executor_usuario_id: 'tu-exec-novo',
        responsavel_core_usuario_id: 'cu-resp-novo',
        executor_core_usuario_id: 'cu-exec-novo',
      },
      usuariosLista,
    )

    expect(updateCalled).toBe(true)
    expect(updatePayloadCaptured).not.toBeNull()
    expect(updatePayloadCaptured.responsavel_usuario_id).toBe('tu-resp-novo')
    expect(updatePayloadCaptured.executor_usuario_id).toBe('tu-exec-novo')
    expect(updatePayloadCaptured.responsavel_core_usuario_id).toBe('cu-resp-novo')
    expect(updatePayloadCaptured.executor_core_usuario_id).toBe('cu-exec-novo')
    // Regra 3: NÃO deve enviar updated_at no payload do update (o gatilho do banco é quem atualiza)
    expect(updatePayloadCaptured.updated_at).toBeUndefined()
    // E o valor retornado pela operação deve ser o timestamp definido pelo banco
    expect(result.updated_at).toBe(dbGeneratedUpdatedAt)
  })

  it('salvar SEM mudança de nenhum campo NÃO chama update em task_tarefas e retorna o registro existente', async () => {
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
      pasta_cliente: 'Cliente Pasta',
      pasta_ricci: 'Ricci Pasta',
      updated_at: originalUpdatedAt,
      arquivado_at: null,
    }

    let updateCalled = false

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
          update: () => {
            updateCalled = true
            return {
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: existingDbRecord, error: null }),
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

    // Salva exatamente com os mesmos dados atuais
    const result = await controleService.saveControle(
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
        pasta_cliente: 'Cliente Pasta',
        pasta_ricci: 'Ricci Pasta',
      },
      [],
    )

    // Regra 1: NÃO deve chamar update
    expect(updateCalled).toBe(false)
    // Retorna o registro existente hidratado
    expect(result.id).toBe('tarefa-101')
    expect(result.updated_at).toBe(originalUpdatedAt)
    expect(result.responsavel_core_usuario_id).toBe('cu-inativo-resp')
    expect(result.executor_core_usuario_id).toBe('cu-inativo-exec')
  })

  it('falha na leitura do registro anterior BLOQUEIA o salvamento com erro (fail-closed)', async () => {
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
              single: () =>
                Promise.resolve({
                  data: null,
                  error: { message: 'Erro de rede ao ler registro anterior' },
                }),
            }),
          }),
        }
      }
      return {}
    }) as any)

    await expect(
      controleService.saveControle(
        {
          id: 'tarefa-101',
          nome_controle_id: 'nc-1',
          identificacao_caso: 'Processo X',
          status_id: 'st-aberto',
          responsavel_usuario_id: 'tu-resp',
          executor_usuario_id: 'tu-exec',
          responsavel_core_usuario_id: 'cu-resp',
          executor_core_usuario_id: 'cu-exec',
        },
        [],
      ),
    ).rejects.toThrow(
      'Gravação bloqueada: não foi possível carregar os dados anteriores do controle para validação.',
    )
  })

  it('validação de pares obrigatórios: exige IDs centrais válidos para Responsável e Executor', async () => {
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
      return {}
    }) as any)

    // 1. Sem ID central do Responsável
    await expect(
      controleService.saveControle(
        {
          nome_controle_id: 'nc-1',
          identificacao_caso: 'Caso Sem Resp',
          status_id: 'st-aberto',
          responsavel_core_usuario_id: '',
          executor_core_usuario_id: 'cu-pessoa-b',
        },
        [],
      ),
    ).rejects.toThrow(
      'Gravação bloqueada: o Responsável selecionado não possui ID central válido no Gestor de Acessos.',
    )

    // 2. Sem ID central do Executor
    await expect(
      controleService.saveControle(
        {
          nome_controle_id: 'nc-1',
          identificacao_caso: 'Caso Sem Exec',
          status_id: 'st-aberto',
          responsavel_core_usuario_id: 'cu-pessoa-a',
          executor_core_usuario_id: '',
        },
        [],
      ),
    ).rejects.toThrow(
      'Gravação bloqueada: o Executor selecionado não possui ID central válido no Gestor de Acessos.',
    )
  })

  it('preservação de atribuição histórica de pessoa inativa: mantém o par já gravado sem re-resolver nem alterar updated_at', async () => {
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

    let updateCalled = false

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
          update: () => {
            updateCalled = true
            return {
              eq: () => ({
                select: () => ({
                  single: () => Promise.resolve({ data: existingDbRecord, error: null }),
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
    // mas os IDs centrais preservados são repassados
    const result = await controleService.saveControle(
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

    expect(updateCalled).toBe(false)
    expect(result.responsavel_usuario_id).toBe('tu-inativo-resp')
    expect(result.executor_usuario_id).toBe('tu-inativo-exec')
    expect(result.responsavel_core_usuario_id).toBe('cu-inativo-resp')
    expect(result.executor_core_usuario_id).toBe('cu-inativo-exec')
    expect(result.updated_at).toBe(originalUpdatedAt)
  })

  it('permite atribuição direta a usuário central sem ponte em task_usuarios', async () => {
    const usuariosListaComPessoaSemPonte = [
      {
        id: 'cu-sem-ponte',
        nome: 'Maria Sem Ponte',
        email: 'maria@riccipi.com.br',
        core_usuario_id: 'cu-sem-ponte',
        task_usuario_id: null,
      },
      {
        id: 'cu-exec',
        nome: 'Executor Central',
        email: 'exec@riccipi.com.br',
        core_usuario_id: 'cu-exec',
        task_usuario_id: null,
      },
    ]

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
          insert: (payload: any) => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: 'tarefa-novo-core',
                    ...payload,
                    updated_at: '2025-05-10T12:00:00Z',
                  },
                  error: null,
                }),
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

    const result = await controleService.saveControle(
      {
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Caso Sem Ponte Permitido',
        status_id: 'st-aberto',
        responsavel_usuario_id: 'cu-sem-ponte',
        executor_usuario_id: 'cu-exec',
        responsavel_core_usuario_id: 'cu-sem-ponte',
        executor_core_usuario_id: 'cu-exec',
      },
      usuariosListaComPessoaSemPonte,
    )

    expect(result.responsavel_core_usuario_id).toBe('cu-sem-ponte')
    expect(result.executor_core_usuario_id).toBe('cu-exec')
  })

  it('gravação dupla quando há ponte: preserva coluna operacional legada quando informada', async () => {
    let insertedPayload: any = null

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
            insertedPayload = payload
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: 'tarefa-dupla',
                      ...payload,
                      updated_at: '2025-05-10T12:00:00Z',
                    },
                    error: null,
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

    await controleService.saveControle(
      {
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Caso Com Ponte',
        status_id: 'st-aberto',
        responsavel_usuario_id: 'tu-ponte-resp', // ID operacional legado de ponte
        executor_usuario_id: 'tu-ponte-exec', // ID operacional legado de ponte
        responsavel_core_usuario_id: 'cu-core-resp',
        executor_core_usuario_id: 'cu-core-exec',
      },
      [],
    )

    expect(insertedPayload.responsavel_usuario_id).toBe('tu-ponte-resp')
    expect(insertedPayload.executor_usuario_id).toBe('tu-ponte-exec')
    expect(insertedPayload.responsavel_core_usuario_id).toBe('cu-core-resp')
    expect(insertedPayload.executor_core_usuario_id).toBe('cu-core-exec')
  })

  it('prova (d): com mock SEM a tabela task_usuarios, listagem e salvamento funcionam sem nenhuma consulta a ela', async () => {
    let taskUsuariosQueried = false

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_usuarios') {
        taskUsuariosQueried = true
        throw new Error('Tabela task_usuarios NÃO DEVE ser consultada no fluxo de salvamento!')
      }
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
          insert: (payload: any) => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: 'tarefa-sem-task-usuarios',
                    ...payload,
                    updated_at: '2025-05-10T12:00:00Z',
                  },
                  error: null,
                }),
            }),
          }),
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
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

    // Salvamento com usuário sem ponte (apenas IDs centrais)
    const result = await controleService.saveControle({
      nome_controle_id: 'nc-1',
      identificacao_caso: 'Caso Sem Tabela task_usuarios',
      status_id: 'st-aberto',
      responsavel_core_usuario_id: 'cu-pessoa-10',
      executor_core_usuario_id: 'cu-pessoa-20',
    })

    expect(taskUsuariosQueried).toBe(false)
    expect(result.responsavel_core_usuario_id).toBe('cu-pessoa-10')
    expect(result.executor_core_usuario_id).toBe('cu-pessoa-20')
    expect(result.responsavel_usuario_id).toBe('cu-pessoa-10') // fallback hidratado
    expect(result.executor_usuario_id).toBe('cu-pessoa-20') // fallback hidratado
  })

  it('detecta reatribuição A -> B -> A comparando os IDs centrais e disparando notificações adequadamente', async () => {
    let notifyCallCount = 0
    const notifiedTipos: string[] = []

    vi.spyOn(controleService, 'notifyAssignment').mockImplementation((_tarefaId, tipo) => {
      notifyCallCount++
      notifiedTipos.push(tipo)
      return Promise.resolve({ success: true, triggered: true, sent: true } as any)
    })

    let currentDbRecord: any = {
      id: 'tarefa-reassign',
      nome_controle_id: 'nc-1',
      identificacao_caso: 'Processo Reatribuicao',
      status_id: 'st-aberto',
      data_autorizacao: '2025-01-10',
      prazo_conclusao: '2025-02-10',
      responsavel_core_usuario_id: 'cu-pessoa-a',
      executor_core_usuario_id: 'cu-pessoa-a',
      updated_at: '2025-01-10T10:00:00Z',
    }

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
              single: () => Promise.resolve({ data: currentDbRecord, error: null }),
            }),
          }),
          update: (payload: any) => ({
            eq: () => ({
              select: () => ({
                single: () => {
                  currentDbRecord = {
                    ...currentDbRecord,
                    ...payload,
                    updated_at: new Date().toISOString(),
                  }
                  return Promise.resolve({
                    data: currentDbRecord,
                    error: null,
                  })
                },
              }),
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

    const usuarios = [
      { id: 'cu-pessoa-a', nome: 'A', email: 'a@r.com', core_usuario_id: 'cu-pessoa-a' },
      { id: 'cu-pessoa-b', nome: 'B', email: 'b@r.com', core_usuario_id: 'cu-pessoa-b' },
    ]

    // 1. Troca A -> B
    await controleService.saveControle(
      {
        id: 'tarefa-reassign',
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Processo Reatribuicao',
        status_id: 'st-aberto',
        data_autorizacao: '2025-01-10',
        prazo_conclusao: '2025-02-10',
        responsavel_usuario_id: 'cu-pessoa-b',
        executor_usuario_id: 'cu-pessoa-b',
        responsavel_core_usuario_id: 'cu-pessoa-b',
        executor_core_usuario_id: 'cu-pessoa-b',
      },
      usuarios,
    )

    expect(notifyCallCount).toBe(1)
    expect(notifiedTipos[0]).toBe('alteracao_atribuicao')
    expect(currentDbRecord.executor_core_usuario_id).toBe('cu-pessoa-b')

    // 2. Troca B -> A
    await controleService.saveControle(
      {
        id: 'tarefa-reassign',
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Processo Reatribuicao',
        status_id: 'st-aberto',
        data_autorizacao: '2025-01-10',
        prazo_conclusao: '2025-02-10',
        responsavel_usuario_id: 'cu-pessoa-a',
        executor_usuario_id: 'cu-pessoa-a',
        responsavel_core_usuario_id: 'cu-pessoa-a',
        executor_core_usuario_id: 'cu-pessoa-a',
      },
      usuarios,
    )

    expect(notifyCallCount).toBe(2)
    expect(notifiedTipos[1]).toBe('alteracao_atribuicao')
    expect(currentDbRecord.executor_core_usuario_id).toBe('cu-pessoa-a')
  })

  describe('Escopo Central em Listagens de Controles (ADMINISTRADOR / GESTOR / OPERACIONAL)', () => {
    const listaExemplo: any[] = [
      {
        id: 't-1',
        identificacao_caso: 'Caso Admin Only',
        responsavel_core_usuario_id: 'cu-outro-1',
        executor_core_usuario_id: 'cu-outro-2',
      },
      {
        id: 't-2',
        identificacao_caso: 'Caso do Operacional 1',
        responsavel_core_usuario_id: 'cu-op-1',
        executor_core_usuario_id: 'cu-outro-3',
      },
      {
        id: 't-3',
        identificacao_caso: 'Caso do Subordinado 1',
        responsavel_core_usuario_id: 'cu-sub-1',
        executor_core_usuario_id: 'cu-outro-4',
      },
    ]

    it('ADMINISTRADOR: sem filtro, recebe todos os casos', async () => {
      const filtrados = await controleService.applyAccessScopeToControles(
        listaExemplo,
        'ADMINISTRADOR',
        'cu-admin-id',
      )
      expect(filtrados).toHaveLength(3)
    })

    it('OPERACIONAL: recebe apenas casos próprios (responsável ou executor)', async () => {
      const filtrados = await controleService.applyAccessScopeToControles(
        listaExemplo,
        'OPERACIONAL',
        'cu-op-1',
      )
      expect(filtrados).toHaveLength(1)
      expect(filtrados[0].id).toBe('t-2')
    })

    it('GESTOR: recebe casos próprios e da equipe direta (core_usuarios.gestor_id = meuId)', async () => {
      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'core_usuarios') {
          return {
            select: () => ({
              eq: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [{ id: 'cu-sub-1' }],
                    error: null,
                  }),
              }),
            }),
          }
        }
        return {}
      }) as any)

      const filtrados = await controleService.applyAccessScopeToControles(
        listaExemplo,
        'GESTOR',
        'cu-gestor-1',
      )
      // cu-gestor-1 não tem caso próprio aqui, mas cu-sub-1 está em sua equipe direta
      expect(filtrados).toHaveLength(1)
      expect(filtrados[0].id).toBe('t-3')
    })

    it('Reatribuição com perda de acesso: caso salvo conclui normalmente e na leitura seguinte sai da lista do editor operacional', async () => {
      // Cenário: Operacional é dono de t-2
      const antes = await controleService.applyAccessScopeToControles(
        listaExemplo,
        'OPERACIONAL',
        'cu-op-1',
      )
      expect(antes.map((c) => c.id)).toContain('t-2')

      // Editor operacional reatribui t-2 para outro usuário (cu-outro-5)
      const listaPosReatribuicao = listaExemplo.map((item) =>
        item.id === 't-2'
          ? {
              ...item,
              responsavel_core_usuario_id: 'cu-outro-5',
              executor_core_usuario_id: 'cu-outro-5',
            }
          : item,
      )

      const depois = await controleService.applyAccessScopeToControles(
        listaPosReatribuicao,
        'OPERACIONAL',
        'cu-op-1',
      )
      expect(depois.map((c) => c.id)).not.toContain('t-2')
      expect(depois).toHaveLength(0)
    })
  })
})
