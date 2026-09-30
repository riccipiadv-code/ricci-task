import { describe, it, expect, vi, beforeEach } from 'vitest'
import { controleService } from '@/services/controleService'
import { supabase } from '@/lib/supabase/client'
import { SaveControleInput } from '@/types/task'

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

  it('criação de caso: salva via RPC transacional retornando dados reais do banco', async () => {
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

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        success: true,
        mudanca_real: true,
        tarefa_id: 'tarefa-101',
        transicao_id: null,
        updated_at: '2025-01-10T12:00:00Z',
        perda_acesso: false,
        caso: mockCreatedRecord,
        providencias: [],
      },
      error: null,
    } as any)

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

    expect(rpcSpy).toHaveBeenCalledWith(
      'task_salvar_controle_transacional',
      expect.objectContaining({
        p_tarefa_id: null,
        p_dados_caso: expect.objectContaining({
          responsavel_core_usuario_id: 'cu-resp',
          executor_core_usuario_id: 'cu-exec',
        }),
      }),
    )
    expect(result.responsavel_core_usuario_id).toBe('cu-resp')
    expect(result.executor_core_usuario_id).toBe('cu-exec')
  })

  it('mudança REAL: chama RPC transacional única e usa o timestamp retornado pelo banco', async () => {
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

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_tarefas') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: existingDbRecord, error: null }),
            }),
          }),
        }
      }
      return {}
    }) as any)

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        success: true,
        mudanca_real: true,
        tarefa_id: 'tarefa-101',
        transicao_id: 'trans-101',
        updated_at: dbGeneratedUpdatedAt,
        perda_acesso: false,
        caso: {
          ...existingDbRecord,
          identificacao_caso: 'Processo X Modificado',
          responsavel_core_usuario_id: 'cu-resp-novo',
          executor_core_usuario_id: 'cu-exec-novo',
          updated_at: dbGeneratedUpdatedAt,
        },
        providencias: [],
      },
      error: null,
    } as any)

    const result = await controleService.saveControle(
      {
        id: 'tarefa-101',
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Processo X Modificado',
        status_id: 'st-aberto',
        data_autorizacao: '2025-01-10',
        prazo_conclusao: '2025-02-10',
        responsavel_usuario_id: 'tu-resp-novo',
        executor_usuario_id: 'tu-exec-novo',
        responsavel_core_usuario_id: 'cu-resp-novo',
        executor_core_usuario_id: 'cu-exec-novo',
      },
      [],
    )

    expect(rpcSpy).toHaveBeenCalledWith(
      'task_salvar_controle_transacional',
      expect.objectContaining({
        p_tarefa_id: 'tarefa-101',
      }),
    )
    expect(result.updated_at).toBe(dbGeneratedUpdatedAt)
    expect(result.responsavel_core_usuario_id).toBe('cu-resp-novo')
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

  it('permite atribuição direta a usuário central sem ponte em task_usuarios via RPC transacional', async () => {
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

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        success: true,
        mudanca_real: true,
        tarefa_id: 'tarefa-novo-core',
        transicao_id: null,
        updated_at: '2025-05-10T12:00:00Z',
        perda_acesso: false,
        caso: {
          id: 'tarefa-novo-core',
          identificacao_caso: 'Caso Sem Ponte Permitido',
          nome_controle_id: 'nc-1',
          status_id: 'st-aberto',
          responsavel_core_usuario_id: 'cu-sem-ponte',
          executor_core_usuario_id: 'cu-exec',
          updated_at: '2025-05-10T12:00:00Z',
        },
        providencias: [],
      },
      error: null,
    } as any)

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

  it('gravação dupla quando há ponte: repassa coluna operacional legada para a RPC', async () => {
    let capturedParams: any = null

    vi.spyOn(supabase, 'rpc').mockImplementation(((fn: string, params: any) => {
      if (fn === 'task_salvar_controle_transacional') {
        capturedParams = params
        return Promise.resolve({
          data: {
            success: true,
            mudanca_real: true,
            tarefa_id: 'tarefa-dupla',
            transicao_id: null,
            updated_at: '2025-05-10T12:00:00Z',
            perda_acesso: false,
            caso: {
              id: 'tarefa-dupla',
              identificacao_caso: 'Caso Com Ponte',
              responsavel_usuario_id: 'tu-ponte-resp',
              executor_usuario_id: 'tu-ponte-exec',
              responsavel_core_usuario_id: 'cu-core-resp',
              executor_core_usuario_id: 'cu-core-exec',
              updated_at: '2025-05-10T12:00:00Z',
            },
            providencias: [],
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
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

    expect(capturedParams.p_dados_caso.responsavel_usuario_id).toBe('tu-ponte-resp')
    expect(capturedParams.p_dados_caso.executor_usuario_id).toBe('tu-ponte-exec')
    expect(capturedParams.p_dados_caso.responsavel_core_usuario_id).toBe('cu-core-resp')
    expect(capturedParams.p_dados_caso.executor_core_usuario_id).toBe('cu-core-exec')
  })

  it('prova (d): com mock SEM a tabela task_usuarios, listagem e salvamento funcionam sem nenhuma consulta a ela', async () => {
    let taskUsuariosQueried = false

    vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
      if (table === 'task_usuarios') {
        taskUsuariosQueried = true
        throw new Error('Tabela task_usuarios NÃO DEVE ser consultada no fluxo de salvamento!')
      }
      return {}
    }) as any)

    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: {
        success: true,
        mudanca_real: true,
        tarefa_id: 'tarefa-sem-task-usuarios',
        transicao_id: null,
        updated_at: '2025-05-10T12:00:00Z',
        perda_acesso: false,
        caso: {
          id: 'tarefa-sem-task-usuarios',
          identificacao_caso: 'Caso Sem Tabela task_usuarios',
          responsavel_core_usuario_id: 'cu-pessoa-10',
          executor_core_usuario_id: 'cu-pessoa-20',
          updated_at: '2025-05-10T12:00:00Z',
        },
        providencias: [],
      },
      error: null,
    } as any)

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
  })

  it('detecta reatribuição A -> B -> A comparando os IDs centrais e executando a transação', async () => {
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
      if (table === 'task_tarefas') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: currentDbRecord, error: null }),
            }),
          }),
        }
      }
      return {}
    }) as any)

    vi.spyOn(supabase, 'rpc').mockImplementation(((fn: string, params: any) => {
      if (fn === 'task_salvar_controle_transacional') {
        currentDbRecord = {
          ...currentDbRecord,
          responsavel_core_usuario_id: params.p_dados_caso.responsavel_core_usuario_id,
          executor_core_usuario_id: params.p_dados_caso.executor_core_usuario_id,
          updated_at: '2025-05-10T12:00:00Z',
        }
        return Promise.resolve({
          data: {
            success: true,
            mudanca_real: true,
            tarefa_id: 'tarefa-reassign',
            transicao_id: 'trans-reassign',
            updated_at: '2025-05-10T12:00:00Z',
            perda_acesso: false,
            caso: currentDbRecord,
            providencias: [],
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const usuarios = [
      { id: 'cu-pessoa-a', nome: 'A', email: 'a@r.com', core_usuario_id: 'cu-pessoa-a' },
      { id: 'cu-pessoa-b', nome: 'B', email: 'b@r.com', core_usuario_id: 'cu-pessoa-b' },
    ]

    // 1. Troca A -> B
    const res1 = await controleService.saveControleTransacional(
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

    expect(res1.transicao_id).toBe('trans-reassign')
    expect(currentDbRecord.executor_core_usuario_id).toBe('cu-pessoa-b')

    // 2. Troca B -> A
    const res2 = await controleService.saveControleTransacional(
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

    expect(res2.transicao_id).toBe('trans-reassign')
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

    it('saveControleTransacional: preserva prazo_conclusao do caso e data_conclusao das providências quando chamador é GESTOR ou OPERACIONAL', async () => {
      // Mock do registro anterior do caso em task_tarefas e da providência em task_providencias
      const existingControle = {
        id: 'caso-123',
        nome_controle_id: 'nc-1',
        numero_caso: 123,
        identificacao_caso: 'Caso Teste Protegido',
        status_id: 'st-1',
        data_autorizacao: '2024-01-10',
        prazo_conclusao: '2024-02-10',
        responsavel_usuario_id: 'tu-1',
        executor_usuario_id: 'tu-2',
        responsavel_core_usuario_id: 'cu-1',
        executor_core_usuario_id: 'cu-2',
        pasta_cliente: null,
        pasta_ricci: null,
        updated_at: '2024-01-18T12:00:00Z',
        arquivado_at: null,
      }

      const mockProvSelect = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [{ id: 'prov-fixa-1', data_conclusao: '2024-01-20' }],
          error: null,
        }),
      })

      const origFrom = supabase.from
      ;(supabase.from as any) = vi.fn((table: any) => {
        if (table === 'task_tarefas') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: existingControle, error: null }),
              }),
            }),
          }
        }
        if (table === 'task_providencias') {
          return {
            select: mockProvSelect,
          }
        }
        return (origFrom as any)(table)
      })

      let rpcPayloadCaso: any = null
      let rpcPayloadProvs: any = null
      ;(supabase.rpc as any) = vi.fn((fn: string, params: any) => {
        if (fn === 'task_salvar_controle_transacional') {
          rpcPayloadCaso = params.p_dados_caso
          rpcPayloadProvs = params.p_providencias
          return Promise.resolve({
            data: {
              success: true,
              operacao: 'EDICAO',
              mudanca_real: false,
              tarefa_id: 'caso-123',
              caso: {
                id: 'caso-123',
                updated_at: '2024-01-20T12:00:00Z',
                numero_caso: 123,
              },
              providencias: [{ id: 'prov-fixa-1', data_conclusao: '2024-01-20' }],
            },
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      })

      const input: SaveControleInput = {
        id: 'caso-123',
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Caso Teste Protegido',
        status_id: 'st-1',
        responsavel_core_usuario_id: 'cu-1',
        executor_core_usuario_id: 'cu-2',
        prazo_conclusao: '2099-12-31', // Tentativa de adulteração manual de prazo_conclusao do caso por GESTOR
        providencias: [
          {
            id: 'prov-fixa-1',
            providencia: 'Providência protegida',
            prazo_conclusao: '2024-01-25',
            tipo_prazo_id: 'tp-1',
            status_id: 'st-1',
            data_conclusao: '2099-12-31', // Tentativa de adulteração manual de providência por GESTOR
          },
        ],
      }

      await controleService.saveControleTransacional(input, undefined, 'GESTOR')

      // O payload enviado à RPC DEVE preservar '2024-02-10' do caso (prazo_conclusao) e '2024-01-20' da providência (data_conclusao)
      expect(rpcPayloadCaso).toBeDefined()
      expect(rpcPayloadCaso.prazo_conclusao).toBe('2024-02-10')
      expect(rpcPayloadCaso.data_conclusao).toBeUndefined()

      expect(rpcPayloadProvs).toBeDefined()
      expect(rpcPayloadProvs[0].data_conclusao).toBe('2024-01-20')

      // Restaura mocks
      ;(supabase.from as any) = origFrom
    })

    it('saveControleTransacional: na criação por GESTOR/OPERACIONAL, data_conclusao das providências é forçada para null e prazo_conclusao do caso é mantido', async () => {
      let rpcPayloadCaso: any = null
      let rpcPayloadProvs: any = null
      const origRpc = supabase.rpc
      ;(supabase.rpc as any) = vi.fn((fn: string, params: any) => {
        if (fn === 'task_salvar_controle_transacional') {
          rpcPayloadCaso = params.p_dados_caso
          rpcPayloadProvs = params.p_providencias
          return Promise.resolve({
            data: {
              success: true,
              operacao: 'CRIACAO',
              tarefa_id: 'caso-novo-1',
              caso: {
                id: 'caso-novo-1',
                updated_at: '2024-01-20T12:00:00Z',
                numero_caso: 124,
              },
              providencias: [],
            },
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      })

      const input: SaveControleInput = {
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Novo Caso Operacional',
        status_id: 'st-1',
        responsavel_core_usuario_id: 'cu-1',
        executor_core_usuario_id: 'cu-2',
        prazo_conclusao: '2024-03-01',
        providencias: [
          {
            providencia: 'Nova Providência',
            prazo_conclusao: '2024-01-25',
            tipo_prazo_id: 'tp-1',
            status_id: 'st-1',
            data_conclusao: '2024-01-20', // Não permitido na criação manual por OPERACIONAL
          },
        ],
      }

      await controleService.saveControleTransacional(input, undefined, 'OPERACIONAL')

      expect(rpcPayloadCaso).toBeDefined()
      expect(rpcPayloadCaso.prazo_conclusao).toBe('2024-03-01')
      expect(rpcPayloadCaso.data_conclusao).toBeUndefined()

      expect(rpcPayloadProvs).toBeDefined()
      expect(rpcPayloadProvs[0].data_conclusao).toBeNull()

      ;(supabase.rpc as any) = origRpc
    })

    it('saveControleTransacional: ADMINISTRADOR pode definir e alterar prazo_conclusao do caso e data_conclusao das providências livremente', async () => {
      const existingControle = {
        id: 'caso-admin-1',
        nome_controle_id: 'nc-1',
        numero_caso: 125,
        identificacao_caso: 'Caso Editado Por Admin',
        status_id: 'st-1',
        data_autorizacao: '2024-01-10',
        prazo_conclusao: '2024-02-10',
        responsavel_usuario_id: 'tu-1',
        executor_usuario_id: 'tu-2',
        responsavel_core_usuario_id: 'cu-1',
        executor_core_usuario_id: 'cu-2',
        pasta_cliente: null,
        pasta_ricci: null,
        updated_at: '2024-01-15T12:00:00Z',
        arquivado_at: null,
      }

      const origFrom = supabase.from
      ;(supabase.from as any) = vi.fn((table: any) => {
        if (table === 'task_tarefas') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: existingControle, error: null }),
              }),
            }),
          }
        }
        return (origFrom as any)(table)
      })

      let rpcPayloadCaso: any = null
      let rpcPayloadProvs: any = null
      const origRpc = supabase.rpc
      ;(supabase.rpc as any) = vi.fn((fn: string, params: any) => {
        if (fn === 'task_salvar_controle_transacional') {
          rpcPayloadCaso = params.p_dados_caso
          rpcPayloadProvs = params.p_providencias
          return Promise.resolve({
            data: {
              success: true,
              operacao: 'EDICAO',
              tarefa_id: 'caso-admin-1',
              caso: {
                id: 'caso-admin-1',
                updated_at: '2024-01-25T12:00:00Z',
                numero_caso: 125,
              },
              providencias: [{ id: 'prov-admin-1', data_conclusao: '2024-01-22' }],
            },
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      })

      const input: SaveControleInput = {
        id: 'caso-admin-1',
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Caso Editado Por Admin',
        status_id: 'st-1',
        responsavel_core_usuario_id: 'cu-1',
        executor_core_usuario_id: 'cu-2',
        prazo_conclusao: '2024-05-30',
        providencias: [
          {
            id: 'prov-admin-1',
            providencia: 'Providência editada por admin',
            prazo_conclusao: '2024-01-25',
            tipo_prazo_id: 'tp-1',
            status_id: 'st-1',
            data_conclusao: '2024-01-22',
          },
        ],
      }

      await controleService.saveControleTransacional(input, undefined, 'ADMINISTRADOR')

      expect(rpcPayloadCaso).toBeDefined()
      expect(rpcPayloadCaso.prazo_conclusao).toBe('2024-05-30')
      expect(rpcPayloadCaso.data_conclusao).toBeUndefined()

      expect(rpcPayloadProvs).toBeDefined()
      expect(rpcPayloadProvs[0].data_conclusao).toBe('2024-01-22')

      ;(supabase.from as any) = origFrom
      ;(supabase.rpc as any) = origRpc
    })

    it('saveControle: transferência com perda de acesso chama RPC task_salvar_controle_transacional e conclui com dados reais retornados pelo servidor', async () => {
      const existingControle = {
        id: 't-transf-1',
        identificacao_caso: 'Caso Transferência',
        numero_caso: 101,
        nome_controle_id: 'nc-1',
        status_id: 'st-1',
        responsavel_core_usuario_id: 'cu-op-autor',
        executor_core_usuario_id: 'cu-op-autor',
        responsavel_usuario_id: 'op-autor',
        executor_usuario_id: 'op-autor',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        arquivado_at: null,
      }

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'task_tarefas') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: existingControle, error: null }),
              }),
            }),
          }
        }
        return {}
      }) as any)

      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: {
          success: true,
          mudanca_real: true,
          tarefa_id: 't-transf-1',
          transicao_id: 'trans-uuid-1',
          updated_at: '2025-05-10T12:00:00Z',
          perda_acesso: true,
          novo_responsavel_core_id: 'cu-novo-resp',
          novo_executor_core_id: 'cu-novo-exec',
          caso: {
            id: 't-transf-1',
            identificacao_caso: 'Caso Transferência',
            numero_caso: 101,
            nome_controle_id: 'nc-1',
            status_id: 'st-1',
            responsavel_core_usuario_id: 'cu-novo-resp',
            executor_core_usuario_id: 'cu-novo-exec',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-05-10T12:00:00Z',
          },
          providencias: [],
        },
        error: null,
      } as any)

      const result = await controleService.saveControleTransacional({
        id: 't-transf-1',
        identificacao_caso: 'Caso Transferência',
        nome_controle_id: 'nc-1',
        status_id: 'st-1',
        responsavel_core_usuario_id: 'cu-novo-resp',
        executor_core_usuario_id: 'cu-novo-exec',
      })

      // Verifica se a RPC transacional foi chamada
      expect(rpcSpy).toHaveBeenCalledWith(
        'task_salvar_controle_transacional',
        expect.objectContaining({
          p_tarefa_id: 't-transf-1',
        }),
      )

      // Operação CONCLUI INTEGRALMENTE, usando dados REAIS retornados pelo servidor
      expect(result).toBeDefined()
      expect(result.controle.id).toBe('t-transf-1')
      expect(result.controle.responsavel_core_usuario_id).toBe('cu-novo-resp')
      expect(result.controle.executor_core_usuario_id).toBe('cu-novo-exec')
      expect(result.controle.updated_at).toBe('2025-05-10T12:00:00Z')
      expect(result.transicao_id).toBe('trans-uuid-1')
      expect(result.perda_acesso).toBe(true)

      // Na releitura subsequente por este mesmo usuário, o controle não é mais acessível
      vi.spyOn(controleService, 'getControleById').mockResolvedValue(null)
      const leituraPosterior = await controleService.getControleById('t-transf-1')
      expect(leituraPosterior).toBeNull()
    })

    it('saveControle: falha na RPC transacional aborta o salvamento e NÃO gera sucesso presumido', async () => {
      const existingControle = {
        id: 't-transf-err',
        identificacao_caso: 'Caso Erro',
        numero_caso: 102,
        nome_controle_id: 'nc-1',
        status_id: 'st-1',
        responsavel_core_usuario_id: 'cu-op-autor',
        executor_core_usuario_id: 'cu-op-autor',
        updated_at: '2025-01-01T00:00:00Z',
      }

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'task_tarefas') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: existingControle, error: null }),
              }),
            }),
          }
        }
        return {}
      }) as any)

      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: null,
        error: { message: 'Permissão negada no estado anterior' },
      } as any)

      await expect(
        controleService.saveControle({
          id: 't-transf-err',
          identificacao_caso: 'Caso Erro',
          nome_controle_id: 'nc-1',
          status_id: 'st-1',
          responsavel_core_usuario_id: 'cu-novo-resp',
          executor_core_usuario_id: 'cu-novo-exec',
        }),
      ).rejects.toThrow(/Permissão negada no estado anterior/)
    })

    it('saveControle: falha em providência na transação reverte tudo (atomicidade comprovada)', async () => {
      const existingControle = {
        id: 't-atomicidade-err',
        identificacao_caso: 'Caso Atomicidade',
        numero_caso: 104,
        nome_controle_id: 'nc-1',
        status_id: 'st-1',
        responsavel_core_usuario_id: 'cu-op-autor',
        executor_core_usuario_id: 'cu-op-autor',
        updated_at: '2025-01-01T00:00:00Z',
      }

      vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
        if (table === 'task_tarefas') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: existingControle, error: null }),
              }),
            }),
          }
        }
        return {}
      }) as any)

      // Se a providência falhar no servidor, a RPC faz rollback e retorna erro SQL 22023 ou P0002
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: null,
        error: { message: 'Dados obrigatórios da providência incompletos.' },
      } as any)

      await expect(
        controleService.saveControleTransacional({
          id: 't-atomicidade-err',
          identificacao_caso: 'Caso Novo Título',
          nome_controle_id: 'nc-1',
          status_id: 'st-1',
          responsavel_core_usuario_id: 'cu-novo-resp',
          executor_core_usuario_id: 'cu-novo-exec',
          providencias: [
            {
              providencia: '', // Inválido! Provoca rollback completo no BD
              prazo_conclusao: '2025-06-01',
              tipo_prazo_id: 'tp-1',
              status_id: 'st-p1',
            },
          ],
        }),
      ).rejects.toThrow(/Dados obrigatórios da providência incompletos/)
    })
  })
})
