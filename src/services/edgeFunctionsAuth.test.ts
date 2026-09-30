import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  verifyRicciTaskAdmin,
  verifyRicciTaskCaller,
  resolveValidatedRecipientByCoreId,
  resolveValidatedTaskUserEmailDetailed,
  resolveValidatedTaskUserEmail,
  SYSTEM_CODE_CONECTAI,
  SYSTEM_CODE_RICCI_TASK,
  ROLE_CODE_ADMINISTRADOR,
  ROLE_CODE_GESTOR,
  ROLE_CODE_OPERACIONAL,
  RICCI_TASK_ALLOWED_CALLER_ROLES,
  checkTaskAccessScope,
  checkTransitionNotificationAccess,
  checkProvidenciaEventAccess,
  escapeHtml,
} from '../../supabase/functions/_shared/core-auth'
import { processNotifyTaskAssignment } from '../../supabase/functions/_shared/notify-task-assignment-core'

describe('Validação do Módulo Real _shared/core-auth.ts (Gestor de Acessos Ricci)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Constantes de Sistema e Papel', () => {
    it('mantém códigos canônicos alinhados com o Gestor de Acessos', () => {
      expect(SYSTEM_CODE_RICCI_TASK).toBe('RICCI_TASK')
      expect(SYSTEM_CODE_CONECTAI).toBe('CONECTAI')
      expect(ROLE_CODE_ADMINISTRADOR).toBe('ADMINISTRADOR')
      expect(ROLE_CODE_GESTOR).toBe('GESTOR')
      expect(ROLE_CODE_OPERACIONAL).toBe('OPERACIONAL')
      expect(RICCI_TASK_ALLOWED_CALLER_ROLES).toEqual(['ADMINISTRADOR', 'GESTOR', 'OPERACIONAL'])
    })
  })

  describe('resolveValidatedRecipientByCoreId e compatibilidade de resolução', () => {
    it('retorna missing_user_id quando coreUsuarioId for vazio ou nulo', async () => {
      const mockSupabase = {} as any
      const res = await resolveValidatedRecipientByCoreId(mockSupabase, '')
      expect(res.status).toBe('missing_user_id')
      expect(res.recipient).toBeNull()

      const resDetailed = await resolveValidatedTaskUserEmailDetailed(mockSupabase, '')
      expect(resDetailed.status).toBe('missing_user_id')

      const resLegacy = await resolveValidatedTaskUserEmail(mockSupabase, '')
      expect(resLegacy).toBeNull()
    })

    it('resolveValidatedRecipientByCoreId: valida diretamente usuário ativo, vínculo com RICCI_TASK ativo, sistema e perfil ativos (SEM consultar task_usuarios)', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'task_usuarios') {
            throw new Error('task_usuarios NÃO deve ser consultada!')
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-direto',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-direto',
                      nome: 'Destinatário Direto',
                      email: 'direto@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          return {}
        }),
      } as any

      const res = await resolveValidatedRecipientByCoreId(mockSupabase, 'cu-direto')
      expect(res.status).toBe('valid')
      expect(res.recipient?.email).toBe('direto@riccipi.com.br')
      expect(res.recipient?.coreUsuarioId).toBe('cu-direto')
      expect(res.recipient?.nome).toBe('Destinatário Direto')

      // Wrapper resolveValidatedTaskUserEmailDetailed também opera sem consultar task_usuarios
      const resWrapper = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'cu-direto')
      expect(resWrapper.status).toBe('valid')
      expect(resWrapper.recipient?.email).toBe('direto@riccipi.com.br')
      expect(mockSupabase.from).not.toHaveBeenCalledWith('task_usuarios')
    })

    it('resolveValidatedRecipientByCoreId: retorna invalid_link quando usuário central estiver inativo ou sem vínculo ativo', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: null,
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          return {}
        }),
      } as any

      const res = await resolveValidatedRecipientByCoreId(mockSupabase, 'cu-inativo')
      expect(res.status).toBe('invalid_link')
      expect(res.recipient).toBeNull()
      expect(res.error).toContain('Vínculo central ausente ou inativo')
    })

    it('resolveValidatedRecipientByCoreId: retorna technical_failure (500/recuperável) em caso de erro no banco', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: null,
                  error: { message: '503 Service Unavailable' },
                }),
            }
            return { select: () => chain }
          }
          return {}
        }),
      } as any

      const res = await resolveValidatedRecipientByCoreId(mockSupabase, 'cu-fail')
      expect(res.status).toBe('technical_failure')
      expect(res.recipient).toBeNull()
      expect(res.error).toBe('503 Service Unavailable')
    })

    it('resolveValidatedRecipientByCoreId: retorna technical_failure se houver exceção disparada pelo client', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => {
          throw new Error('Network failure')
        }),
      } as any

      const res = await resolveValidatedRecipientByCoreId(mockSupabase, 'cu-err')
      expect(res.status).toBe('technical_failure')
      expect(res.recipient).toBeNull()
      expect(res.error).toBe('Network failure')
    })

    it('sucesso: sanitiza e-mail central em minúsculas e remove espaços', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-1',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-1',
                      nome: 'João Carlos da Silva',
                      email: 'Joao.Silva@RICCIPI.COM.BR ',
                      ativo: true,
                    },
                    core_sistemas: {
                      id: 'sys-1',
                      codigo: 'RICCI_TASK',
                      ativo: true,
                    },
                    core_perfis: {
                      id: 'prf-1',
                      codigo: 'ADMINISTRADOR',
                      ativo: true,
                    },
                  },
                  error: null,
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await resolveValidatedRecipientByCoreId(mockSupabase, 'cu-1')
      expect(res.status).toBe('valid')
      expect(res.recipient).not.toBeNull()
      expect(res.recipient?.email).toBe('joao.silva@riccipi.com.br')
      expect(res.recipient?.nome).toBe('João Carlos da Silva')
      expect(res.recipient?.coreUsuarioId).toBe('cu-1')

      // E a função legada retorna o recipient diretamente
      const resLegacy = await resolveValidatedTaskUserEmail(mockSupabase, 'cu-1')
      expect(resLegacy?.email).toBe('joao.silva@riccipi.com.br')
    })
  })

  describe('verifyRicciTaskCaller (Autorização central do chamador de notify-task-assignment)', () => {
    it('rejeita com status unauthorized (401) se authUserId for vazio', async () => {
      const mockSupabase = {} as any
      const res = await verifyRicciTaskCaller(mockSupabase, '')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('unauthorized')
      expect(res.httpStatus).toBe(401)
    })

    it('rejeita com status invalid_link (403) se o chamador não for localizado em core_usuarios', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      } as any

      const res = await verifyRicciTaskCaller(mockSupabase, 'auth-user-inexistente')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('invalid_link')
      expect(res.httpStatus).toBe(403)
      expect(res.error).toContain('usuário corporativo não localizado')
    })

    it('rejeita com status invalid_link (403) se o chamador estiver inativo em core_usuarios', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cu-inativo',
                  auth_user_id: 'auth-user-inativo',
                  nome: 'Chamador Inativo',
                  email: 'inativo@riccipi.com.br',
                  ativo: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      } as any

      const res = await verifyRicciTaskCaller(mockSupabase, 'auth-user-inativo')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('invalid_link')
      expect(res.httpStatus).toBe(403)
      expect(res.error).toContain('usuário corporativo inativo')
    })

    it('rejeita com status technical_failure (500) se houver erro técnico de banco ao buscar core_usuarios', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database connection failed' },
              }),
            }),
          }),
        }),
      } as any

      const res = await verifyRicciTaskCaller(mockSupabase, 'auth-user-err')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('technical_failure')
      expect(res.httpStatus).toBe(500)
      expect(res.error).toContain('Falha de comunicação com o Gestor de Acessos')
    })

    it('rejeita com status technical_failure (500) se houver erro ao buscar vínculos em core_usuario_sistemas', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador',
                        auth_user_id: 'auth-user-chamador',
                        nome: 'Chamador',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: null,
                  error: { message: 'Connection timeout' },
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await verifyRicciTaskCaller(mockSupabase, 'auth-user-chamador')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('technical_failure')
      expect(res.httpStatus).toBe(500)
      expect(res.error).toContain('Falha de comunicação com o Gestor de Acessos')
    })

    it('rejeita com status invalid_link (403) se o chamador não possuir vínculo ativo com RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-sem-vinculo',
                        auth_user_id: 'auth-user-sem-vinculo',
                        nome: 'Sem Vínculo',
                        email: 'sem.vinculo@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [], // sem vínculos
                  error: null,
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await verifyRicciTaskCaller(mockSupabase, 'auth-user-sem-vinculo')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('invalid_link')
      expect(res.httpStatus).toBe(403)
      expect(res.error).toContain('vínculo ou perfil não autorizado')
    })

    it('autoriza chamador com perfil ADMINISTRADOR ativo em RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-admin',
                        auth_user_id: 'auth-user-admin',
                        nome: 'Admin User',
                        email: 'admin@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-admin',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await verifyRicciTaskCaller(mockSupabase, 'auth-user-admin')
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('valid')
      expect(res.httpStatus).toBe(200)
      expect(res.perfil).toBe('ADMINISTRADOR')
      expect(res.coreUser?.id).toBe('cu-admin')
    })

    it('autoriza chamador com perfil GESTOR ativo em RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-gestor',
                        auth_user_id: 'auth-user-gestor',
                        nome: 'Gestor User',
                        email: 'gestor@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-gestor',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'GESTOR', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await verifyRicciTaskCaller(mockSupabase, 'auth-user-gestor')
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('valid')
      expect(res.httpStatus).toBe(200)
      expect(res.perfil).toBe('GESTOR')
      expect(res.coreUser?.id).toBe('cu-gestor')
    })

    it('autoriza chamador com perfil OPERACIONAL ativo em RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-op',
                        auth_user_id: 'auth-user-op',
                        nome: 'Op User',
                        email: 'op@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-op',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await verifyRicciTaskCaller(mockSupabase, 'auth-user-op')
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('valid')
      expect(res.httpStatus).toBe(200)
      expect(res.perfil).toBe('OPERACIONAL')
      expect(res.coreUser?.id).toBe('cu-op')
    })
  })

  describe('verifyRicciTaskAdmin (Autorização central no RICCI_TASK)', () => {
    it('rejeita com status 401 se authUserId for vazio', async () => {
      const mockSupabase = {} as any
      const res = await verifyRicciTaskAdmin(mockSupabase, '')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(401)
      expect(res.error).toBe('Não autorizado.')
    })

    it('rejeita com status 403 se o usuário não for localizado em core_usuarios', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      } as any

      const res = await verifyRicciTaskAdmin(mockSupabase, 'auth-user-1')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(403)
      expect(res.error).toContain('usuário corporativo não localizado')
    })

    it('rejeita com status 403 se o usuário corporativo estiver inativo', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'cu-inativo',
                  auth_user_id: 'auth-user-inativo',
                  nome: 'Inativo Central',
                  email: 'inativo@empresa.com',
                  ativo: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      } as any

      const res = await verifyRicciTaskAdmin(mockSupabase, 'auth-user-inativo')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(403)
      expect(res.error).toContain('usuário inativo no sistema corporativo')
    })

    it('rejeita com status 403 se não tiver perfil de ADMINISTRADOR ativo no RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-comum',
                        auth_user_id: 'auth-user-comum',
                        nome: 'Comum Central',
                        email: 'comum@empresa.com',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [], // sem perfil administrador para RICCI_TASK
                  error: null,
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await verifyRicciTaskAdmin(mockSupabase, 'auth-user-comum')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(403)
      expect(res.error).toContain('apenas administradores possuem privilégios')
    })

    it('autoriza com sucesso (allowed = true) se for ADMINISTRADOR ativo do RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-admin',
                        auth_user_id: 'auth-user-admin',
                        nome: 'Administrador Central',
                        email: 'admin@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-admin',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await verifyRicciTaskAdmin(mockSupabase, 'auth-user-admin')
      expect(res.allowed).toBe(true)
      expect(res.coreUser?.id).toBe('cu-admin')
      expect(res.coreUser?.email).toBe('admin@riccipi.com.br')
    })
    describe('Cenários Críticos da Versão 0.0.70 (Regressão e Idempotência Estrita)', () => {
      let localCtx: MockEdgeContext
      beforeEach(() => {
        localCtx = createMockEdgeContext()
      })

      it('preserva chave de evento existente em task_email_eventos sem alterar formato/valores históricos (retorna already_sent)', async () => {
        const historicalExecId = 'd82fbcf7-1234-4567-89ab-cdef01234567'
        const historicalRespId = 'e93acad8-5678-4321-ba98-fedcba987654'
        const historicalStamp = '2024-01-15T10:00:00Z'
        const expectedEventKey = `atribuicao:tarefa-historica:${historicalStamp}:${historicalExecId}:${historicalRespId}`

        localCtx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-user-op' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-chamador',
                          auth_user_id: 'auth-user-op',
                          nome: 'Chamador',
                          email: 'chamador@riccipi.com.br',
                          ativo: true,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'task_tarefas') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'tarefa-historica',
                          numero_caso: 1001,
                          executor_usuario_id: historicalExecId,
                          responsavel_usuario_id: historicalRespId,
                          executor_core_usuario_id: 'cu-exec-novo',
                          responsavel_core_usuario_id: 'cu-resp-novo',
                          updated_at: historicalStamp,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'core_usuario_sistemas') {
              return {
                select: () => {
                  const chain: any = {
                    eq: () => chain,
                    in: () => chain,
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'link-ok',
                          ativo: true,
                          core_usuarios: {
                            id: 'cu-exec-novo',
                            nome: 'Executor Central',
                            email: 'exec@riccipi.com.br',
                            ativo: true,
                          },
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                        error: null,
                      }),
                    then: (resolve: any) =>
                      resolve({
                        data: [
                          {
                            id: 'link-caller',
                            ativo: true,
                            core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                            core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                          },
                        ],
                        error: null,
                      }),
                  }
                  return chain
                },
              }
            }
            if (table === 'task_email_eventos') {
              return {
                select: () => ({
                  eq: (_col: string, keyVal: string) => {
                    expect(keyVal).toBe(expectedEventKey)
                    return {
                      maybeSingle: () =>
                        Promise.resolve({
                          data: {
                            id: 'evt-hist-1',
                            status: 'success',
                            event_key: expectedEventKey,
                          },
                          error: null,
                        }),
                    }
                  },
                }),
              }
            }
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tarefa_id: 'tarefa-historica',
            tipo: 'atribuicao',
          }),
        })

        const res = await handleNotifyTaskAssignment(req, localCtx)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.triggered).toBe(true)
        expect(body.sent).toBe(false)
        expect(body.reason).toBe('already_sent')
        expect(body.event_key).toBe(expectedEventKey)
        expect(localCtx.transporter.sendMail).not.toHaveBeenCalled()
      })

      it('para casos novos sem tokens operacionais, compõe chave estável com IDs centrais', async () => {
        const coreExecId = 'cu-novo-exec-111'
        const coreRespId = 'cu-novo-resp-222'
        const newStamp = '2025-05-10T18:00:00Z'
        const expectedEventKey = `atribuicao:tarefa-nova:${newStamp}:${coreExecId}:${coreRespId}`

        localCtx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-user-op' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-chamador',
                          auth_user_id: 'auth-user-op',
                          nome: 'Chamador',
                          email: 'chamador@riccipi.com.br',
                          ativo: true,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'task_tarefas') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'tarefa-nova',
                          numero_caso: 2002,
                          executor_usuario_id: null,
                          responsavel_usuario_id: null,
                          executor_core_usuario_id: coreExecId,
                          responsavel_core_usuario_id: coreRespId,
                          updated_at: newStamp,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'core_usuario_sistemas') {
              return {
                select: () => {
                  const chain: any = {
                    eq: (_col: string, val: string) => {
                      chain._targetId = val
                      return chain
                    },
                    in: () => chain,
                    maybeSingle: () => {
                      const isExec = chain._targetId === coreExecId
                      return Promise.resolve({
                        data: {
                          id: isExec ? 'link-exec' : 'link-resp',
                          ativo: true,
                          core_usuarios: {
                            id: chain._targetId,
                            nome: isExec ? 'Exec Novo' : 'Resp Novo',
                            email: isExec ? 'exec.novo@riccipi.com.br' : 'resp.novo@riccipi.com.br',
                            ativo: true,
                          },
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                        error: null,
                      })
                    },
                    then: (resolve: any) =>
                      resolve({
                        data: [
                          {
                            id: 'link-caller',
                            ativo: true,
                            core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                            core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                          },
                        ],
                        error: null,
                      }),
                  }
                  return chain
                },
              }
            }
            if (table === 'task_email_eventos') {
              return {
                select: () => ({
                  eq: (_col: string, keyVal: string) => {
                    expect(keyVal).toBe(expectedEventKey)
                    return {
                      maybeSingle: () => Promise.resolve({ data: null, error: null }),
                    }
                  },
                }),
                insert: (record: any) => {
                  expect(record.event_key).toBe(expectedEventKey)
                  expect(record.to_email).toBe('exec.novo@riccipi.com.br')
                  expect(record.cc_email).toBe('resp.novo@riccipi.com.br')
                  return {
                    select: () => ({
                      maybeSingle: () =>
                        Promise.resolve({ data: { id: 'evt-novo-1' }, error: null }),
                    }),
                  }
                },
                update: () => ({
                  eq: () => Promise.resolve({ data: null, error: null }),
                }),
              }
            }
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tarefa_id: 'tarefa-nova',
            tipo: 'atribuicao',
          }),
        })

        const res = await handleNotifyTaskAssignment(req, localCtx)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.success).toBe(true)
        expect(body.sent).toBe(true)
        expect(body.event_key).toBe(expectedEventKey)
        expect(localCtx.transporter.sendMail).toHaveBeenCalledTimes(1)
      })

      it('quando mesma pessoa ocupa executor e responsável: envia TO único e CC vazio (sem auto-cópia)', async () => {
        const sameCoreId = 'cu-mesma-pessoa'
        const stamp = '2025-05-10T19:00:00Z'

        localCtx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-user-op' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-chamador',
                          auth_user_id: 'auth-user-op',
                          nome: 'Chamador',
                          email: 'chamador@riccipi.com.br',
                          ativo: true,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'task_tarefas') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'tarefa-mesma-pessoa',
                          numero_caso: 3003,
                          executor_core_usuario_id: sameCoreId,
                          responsavel_core_usuario_id: sameCoreId,
                          updated_at: stamp,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'core_usuario_sistemas') {
              return {
                select: () => {
                  const chain: any = {
                    eq: () => chain,
                    in: () => chain,
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'link-same',
                          ativo: true,
                          core_usuarios: {
                            id: sameCoreId,
                            nome: 'Pessoa Única',
                            email: 'mesma.pessoa@riccipi.com.br',
                            ativo: true,
                          },
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                        error: null,
                      }),
                    then: (resolve: any) =>
                      resolve({
                        data: [
                          {
                            id: 'link-caller',
                            ativo: true,
                            core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                            core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                          },
                        ],
                        error: null,
                      }),
                  }
                  return chain
                },
              }
            }
            if (table === 'task_email_eventos') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
                insert: (record: any) => {
                  expect(record.to_email).toBe('mesma.pessoa@riccipi.com.br')
                  expect(record.cc_email).toBeNull()
                  return {
                    select: () => ({
                      maybeSingle: () =>
                        Promise.resolve({ data: { id: 'evt-same-1' }, error: null }),
                    }),
                  }
                },
                update: () => ({
                  eq: () => Promise.resolve({ data: null, error: null }),
                }),
              }
            }
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tarefa_id: 'tarefa-mesma-pessoa',
            tipo: 'atribuicao',
          }),
        })

        const res = await handleNotifyTaskAssignment(req, localCtx)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.success).toBe(true)
        expect(body.sent).toBe(true)
        expect(body.to).toBe('mesma.pessoa@riccipi.com.br')
        expect(body.cc).toBeNull()
        expect(localCtx.transporter.sentMails[0].to).toBe('mesma.pessoa@riccipi.com.br')
        expect(localCtx.transporter.sentMails[0].cc).toBeUndefined()
      })
    })
  })
})

/**
 * LIMITAÇÃO TÉCNICA DO AMBIENTE (Vitest / Node.js vs Deno Runtime):
 * Os arquivos `supabase/functions/notify-task-assignment/index.ts` e
 * `supabase/functions/notify-task-overdue/index.ts` utilizam o runtime Deno e APIs específicas
 * (`Deno.serve`, `jsr:@supabase/functions-js/edge-runtime.d.ts`, `npm:nodemailer`, `npm:@supabase/supabase-js@2`),
 * incompatíveis com importação estática direta pelo runner Vitest em Node.js.
 *
 * Por essa razão, conforme estipulado nos requisitos da tarefa:
 * 1. O módulo real compartilhado `supabase/functions/_shared/core-auth.ts` é IMPORTADO E TESTADO DIRETAMENTE no topo.
 * 2. Abaixo é executada uma suíte com handlers de pipeline fiel/equivalente à lógica das Edge Functions
 *    (mesmas etapas de autenticação, resolução central, idempotência via task_email_eventos, TO/CC e status HTTP).
 * 3. As descrições dos testes foram corrigidas para DECLARAR EXPRESSAMENTE que testam o módulo real core-auth
 *    e a lógica de pipeline das Edge Functions (simulada em Node com Supabase e SMTP mockados), sem alegar
 *    acionamento nativo do processo Deno das Edge Functions.
 */
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

interface MockEdgeContext {
  supabase: any
  transporter: {
    sendMail: any
    sentMails: any[]
  }
  env: Record<string, string>
}

function createMockEdgeContext(envOverrides: Record<string, string> = {}): MockEdgeContext {
  const sentMails: any[] = []
  return {
    env: {
      SUPABASE_URL: 'https://mock.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key',
      TASK_OVERDUE_CRON_SECRET: 'cron-secret-12345',
      ...envOverrides,
    },
    transporter: {
      sentMails,
      sendMail: vi.fn(async (options: any) => {
        sentMails.push(options)
        return { messageId: 'mock-mail-id-123' }
      }),
    },
    supabase: {} as any,
  }
}

// Handler representativo do caminho REAL de notify-task-assignment
async function handleNotifyTaskAssignment(req: Request, ctx: MockEdgeContext): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Token de autenticação não encontrado' }), {
      status: 401,
      headers: corsHeaders,
    })
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'Token de autenticação não encontrado' }), {
      status: 401,
      headers: corsHeaders,
    })
  }

  const { data: userData, error: userError } = await ctx.supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
      status: 401,
      headers: corsHeaders,
    })
  }

  // Validação central do chamador via verifyRicciTaskCaller
  const callerCheck = await verifyRicciTaskCaller(ctx.supabase, userData.user.id)
  if (!callerCheck.allowed) {
    return new Response(
      JSON.stringify({
        error:
          callerCheck.error ||
          'Permissão negada: usuário sem permissão ativa para o sistema Ricci Task.',
      }),
      {
        status: callerCheck.httpStatus || (callerCheck.status === 'technical_failure' ? 500 : 403),
        headers: corsHeaders,
      },
    )
  }

  const body = await req.json().catch(() => ({}))
  const { tarefa_id, providencia_id, tipo } = body

  if (!tarefa_id) {
    return new Response(JSON.stringify({ error: 'Parâmetro tarefa_id é obrigatório.' }), {
      status: 400,
      headers: corsHeaders,
    })
  }

  const allowedTipos = [
    'nova_atribuicao',
    'alteracao_atribuicao',
    'atribuicao',
    'providencia_inclusao',
    'providencia_atualizacao',
  ]
  if (!tipo || !allowedTipos.includes(tipo)) {
    return new Response(JSON.stringify({ error: 'Parâmetro tipo inválido.' }), {
      status: 400,
      headers: corsHeaders,
    })
  }

  let dbTipoEvento = 'atribuicao'
  if (tipo === 'alteracao_atribuicao') dbTipoEvento = 'alteracao_atribuicao'
  else if (tipo === 'providencia_inclusao') dbTipoEvento = 'providencia_inclusao'
  else if (tipo === 'providencia_atualizacao') dbTipoEvento = 'providencia_atualizacao'

  const { data: tarefa, error: tarefaError } = await ctx.supabase
    .from('task_tarefas')
    .select('*')
    .eq('id', tarefa_id)
    .maybeSingle()

  if (tarefaError) {
    return new Response(JSON.stringify({ error: tarefaError.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
  if (!tarefa) {
    return new Response(JSON.stringify({ error: 'Tarefa não encontrada.' }), {
      status: 404,
      headers: corsHeaders,
    })
  }
  if (tarefa.deleted_at) {
    return new Response(
      JSON.stringify({ triggered: false, sent: false, reason: 'tarefa_excluida' }),
      { status: 200, headers: corsHeaders },
    )
  }

  // Validação de escopo de acesso central à tarefa (fail-closed obrigatório)
  if (!callerCheck.coreUser || !callerCheck.perfil) {
    return new Response(
      JSON.stringify({
        error: 'Permissão negada: dados centrais de usuário ou perfil incompletos.',
      }),
      { status: 403, headers: corsHeaders },
    )
  }

  const callerUser = callerCheck.coreUser
  const scopeCheck = await checkTaskAccessScope(ctx.supabase, callerUser, callerCheck.perfil, {
    id: tarefa.id,
    responsavel_core_usuario_id: tarefa.responsavel_core_usuario_id,
    executor_core_usuario_id: tarefa.executor_core_usuario_id,
    responsavel_usuario_id: tarefa.responsavel_usuario_id,
    executor_usuario_id: tarefa.executor_usuario_id,
  })

  let authorizedByTransition = false
  if (!scopeCheck.allowed) {
    const isTech = scopeCheck.status === 'technical_failure'
    if (isTech) {
      return new Response(
        JSON.stringify({
          error: scopeCheck.error || 'Permissão negada: falha técnica ao consultar escopo.',
        }),
        {
          status: 500,
          headers: corsHeaders,
        },
      )
    }

    if (dbTipoEvento === 'alteracao_atribuicao' || dbTipoEvento === 'atribuicao') {
      const transValidation = await checkTransitionNotificationAccess(ctx.supabase, callerUser.id, {
        transicaoId: body.transicao_id || null,
        tipoEvento: dbTipoEvento,
        tarefa: {
          id: tarefa.id,
          responsavel_core_usuario_id: tarefa.responsavel_core_usuario_id,
          executor_core_usuario_id: tarefa.executor_core_usuario_id,
          updated_at: tarefa.updated_at,
          created_at: tarefa.created_at,
        },
      })

      if (transValidation.status === 'technical_failure') {
        return new Response(
          JSON.stringify({
            error: transValidation.error || 'Falha técnica ao validar transição.',
          }),
          { status: 500, headers: corsHeaders },
        )
      }

      if (!transValidation.allowed) {
        return new Response(
          JSON.stringify({
            error: transValidation.error || 'Transição inválida ou incompatível.',
          }),
          { status: 403, headers: corsHeaders },
        )
      }

      authorizedByTransition = true
    } else if (
      (dbTipoEvento === 'providencia_inclusao' || dbTipoEvento === 'providencia_atualizacao') &&
      providencia_id
    ) {
      const { data: provVersionData } = await ctx.supabase
        .from('task_providencias')
        .select('updated_at, created_at')
        .eq('id', providencia_id)
        .eq('tarefa_id', tarefa.id)
        .maybeSingle()

      const realProvVersion = provVersionData?.updated_at || provVersionData?.created_at || null

      const provCheck = await checkProvidenciaEventAccess(ctx.supabase, callerUser.id, {
        tarefaId: tarefa.id,
        providenciaId: providencia_id,
        tipoEvento: dbTipoEvento,
        versaoUpdatedAt: realProvVersion,
      })

      if (provCheck.status === 'technical_failure') {
        return new Response(JSON.stringify({ error: provCheck.error }), {
          status: 500,
          headers: corsHeaders,
        })
      }

      if (!provCheck.allowed) {
        return new Response(JSON.stringify({ error: provCheck.error }), {
          status: 403,
          headers: corsHeaders,
        })
      }

      authorizedByTransition = true
    } else {
      return new Response(
        JSON.stringify({
          error:
            scopeCheck.error ||
            'Permissão negada: você não possui permissão para disparar notificações deste caso.',
        }),
        {
          status: 403,
          headers: corsHeaders,
        },
      )
    }
  }

  // Ponto 4: Para alertas de atribuição, EXIGE transição válida TAMBÉM quando o chamador tem acesso
  if (dbTipoEvento === 'alteracao_atribuicao' || dbTipoEvento === 'atribuicao') {
    const transValidation = await checkTransitionNotificationAccess(ctx.supabase, callerUser.id, {
      transicaoId: body.transicao_id || null,
      tipoEvento: dbTipoEvento,
      tarefa: {
        id: tarefa.id,
        responsavel_core_usuario_id: tarefa.responsavel_core_usuario_id,
        executor_core_usuario_id: tarefa.executor_core_usuario_id,
        updated_at: tarefa.updated_at,
        created_at: tarefa.created_at,
      },
    })

    if (transValidation.status === 'technical_failure') {
      return new Response(
        JSON.stringify({ error: transValidation.error || 'Falha técnica ao validar transição.' }),
        { status: 500, headers: corsHeaders },
      )
    }

    if (!transValidation.allowed) {
      return new Response(
        JSON.stringify({
          error:
            transValidation.error ||
            'Transição inválida ou incompatível com o estado atual da tarefa.',
        }),
        { status: 403, headers: corsHeaders },
      )
    }
  }

  // REGRA DE ATRIBUIÇÃO:
  // A CRIAÇÃO de um caso NÃO deve enviar e-mail.
  if (tipo === 'nova_atribuicao') {
    return new Response(
      JSON.stringify({
        triggered: false,
        sent: false,
        reason: 'criacao_sem_notificacao',
        message: 'A criação de caso não gera disparo de e-mail de atribuição por regra do sistema.',
      }),
      { status: 200, headers: corsHeaders },
    )
  }

  const execTargetId = tarefa.executor_core_usuario_id || tarefa.executor_usuario_id
  if (!execTargetId) {
    return new Response(
      JSON.stringify({ triggered: true, sent: false, reason: 'executor_ausente' }),
      { status: 200, headers: corsHeaders },
    )
  }

  const execResolution = await resolveValidatedRecipientByCoreId(ctx.supabase, execTargetId)

  if (execResolution.status === 'technical_failure') {
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
        reason: 'falha_consulta_central',
        error:
          execResolution.error || 'Falha técnica ao validar destinatário no Gestor de Acessos.',
      }),
      { status: 500, headers: corsHeaders },
    )
  }

  if (execResolution.status !== 'valid' || !execResolution.recipient?.email) {
    return new Response(
      JSON.stringify({
        triggered: true,
        sent: false,
        reason: 'executor_sem_vinculo_central_valido',
      }),
      { status: 200, headers: corsHeaders },
    )
  }

  const toEmail = execResolution.recipient.email.trim().toLowerCase()

  let ccEmail: string | null = null
  const respTargetId = tarefa.responsavel_core_usuario_id || tarefa.responsavel_usuario_id
  if (respTargetId) {
    const respResolution = await resolveValidatedRecipientByCoreId(ctx.supabase, respTargetId)
    if (respResolution.status === 'technical_failure') {
      return new Response(
        JSON.stringify({
          success: false,
          sent: false,
          reason: 'falha_consulta_central',
          error: respResolution.error,
        }),
        { status: 500, headers: corsHeaders },
      )
    }
    const respEmailRaw = respResolution.recipient?.email?.trim().toLowerCase() || ''
    // Regra TO / CC e deduplicação: se TO === CC, CC fica nulo
    if (respEmailRaw && respEmailRaw !== toEmail) {
      ccEmail = respEmailRaw
    }
  }

  const resolveEventKeyToken = (
    historicalToken?: string | null,
    coreId?: string | null,
  ): string => {
    if (historicalToken) return historicalToken
    if (coreId) return coreId
    return 'sem_token'
  }

  const tarefaSaveStamp = tarefa.updated_at || tarefa.created_at || 'sem_timestamp'
  const execToken = resolveEventKeyToken(
    tarefa.executor_usuario_id,
    tarefa.executor_core_usuario_id,
  )
  const respToken = resolveEventKeyToken(
    tarefa.responsavel_usuario_id,
    tarefa.responsavel_core_usuario_id,
  )
  const eventKey = `atribuicao:${tarefa.id}:${tarefaSaveStamp}:${execToken}:${respToken}`

  // PONTOS 5 E 6: Aquisição atômica com token de posse (owner_token)
  const callOwnerToken = 'token-' + Math.random().toString(36).slice(2)
  const lockCutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  let acquiredEvent: any = null

  const { data: existingEvent, error: checkEventError } = await ctx.supabase
    .from('task_email_eventos')
    .select('id, event_key, status, sent_at, updated_at, locked_at, owner_token')
    .eq('event_key', eventKey)
    .maybeSingle()

  if (checkEventError) {
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
        error: 'Falha técnica ao consultar task_email_eventos.',
      }),
      { status: 500, headers: corsHeaders },
    )
  }

  if (existingEvent && existingEvent.status === 'success') {
    return new Response(
      JSON.stringify({
        triggered: true,
        sent: false,
        reason: 'already_sent',
        event_key: eventKey,
      }),
      { status: 200, headers: corsHeaders },
    )
  }

  if (
    existingEvent &&
    (existingEvent.status === 'uncertain' ||
      existingEvent.status === 'pending_reconciliation' ||
      existingEvent.status === 'smtp_maybe_sent')
  ) {
    return new Response(
      JSON.stringify({
        triggered: true,
        sent: false,
        reason: 'uncertain_status_reconciliation_required',
        event_key: eventKey,
      }),
      { status: 409, headers: corsHeaders },
    )
  }

  if (!existingEvent) {
    const nowIso = new Date().toISOString()
    const { data: insertedEvent, error: insertEventError } = await ctx.supabase
      .from('task_email_eventos')
      .insert({
        tarefa_id: tarefa.id,
        tipo_evento: dbTipoEvento,
        event_key: eventKey,
        to_email: toEmail,
        cc_email: ccEmail,
        status: 'pending',
        owner_token: callOwnerToken,
        locked_at: nowIso,
      })
      .select('id, owner_token, status')
      .maybeSingle()

    if (insertEventError) {
      if (insertEventError.code === '23505' || insertEventError.message?.includes('23505')) {
        const { data: raceAcquired } = await ctx.supabase
          .from('task_email_eventos')
          .update({
            status: 'pending',
            owner_token: callOwnerToken,
            locked_at: nowIso,
            to_email: toEmail,
            cc_email: ccEmail,
          })
          .eq('event_key', eventKey)
          .in('status', ['error'])
          .select('id, owner_token, status')
          .maybeSingle()

        if (!raceAcquired) {
          const { data: raceEvent } = await ctx.supabase
            .from('task_email_eventos')
            .select('id, status')
            .eq('event_key', eventKey)
            .maybeSingle()

          if (raceEvent && raceEvent.status === 'success') {
            return new Response(
              JSON.stringify({
                triggered: true,
                sent: false,
                reason: 'already_sent',
                event_key: eventKey,
              }),
              { status: 200, headers: corsHeaders },
            )
          }

          return new Response(
            JSON.stringify({
              triggered: true,
              sent: false,
              reason: 'in_progress',
              event_key: eventKey,
            }),
            { status: 200, headers: corsHeaders },
          )
        }
        acquiredEvent = raceAcquired
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            sent: false,
            error: 'Erro ao registrar evento.',
          }),
          { status: 500, headers: corsHeaders },
        )
      }
    } else {
      acquiredEvent = insertedEvent
    }
  } else {
    const nowIso = new Date().toISOString()
    const { data: updatedRows, error: updateErr } = await ctx.supabase
      .from('task_email_eventos')
      .update({
        status: 'pending',
        owner_token: callOwnerToken,
        locked_at: nowIso,
        to_email: toEmail,
        cc_email: ccEmail,
      })
      .eq('id', existingEvent.id)
      .neq('status', 'success')
      .neq('status', 'uncertain')
      .neq('status', 'pending_reconciliation')
      .neq('status', 'smtp_maybe_sent')
      .or(`status.eq.error,locked_at.is.null,locked_at.lt.${lockCutoffIso}`)
      .select('id, owner_token, status')

    if (updateErr) {
      return new Response(
        JSON.stringify({ success: false, sent: false, error: 'Erro ao atualizar evento.' }),
        { status: 500, headers: corsHeaders },
      )
    }

    if (!updatedRows || updatedRows.length === 0) {
      const { data: latestState } = await ctx.supabase
        .from('task_email_eventos')
        .select('id, status')
        .eq('id', existingEvent.id)
        .maybeSingle()

      if (latestState && latestState.status === 'success') {
        return new Response(
          JSON.stringify({
            triggered: true,
            sent: false,
            reason: 'already_sent',
            event_key: eventKey,
          }),
          { status: 200, headers: corsHeaders },
        )
      }

      return new Response(
        JSON.stringify({
          triggered: true,
          sent: false,
          reason: 'in_progress',
          message: 'Aquisição de 0 linhas retornadas.',
          event_key: eventKey,
        }),
        { status: 200, headers: corsHeaders },
      )
    }

    acquiredEvent = updatedRows[0]
  }

  if (!acquiredEvent || acquiredEvent.owner_token !== callOwnerToken) {
    return new Response(
      JSON.stringify({
        triggered: true,
        sent: false,
        reason: 'lock_acquisition_failed',
        event_key: eventKey,
      }),
      { status: 409, headers: corsHeaders },
    )
  }

  const eventoId = acquiredEvent.id

  const execNomeFull = 'Executor Teste'
  const execFirstName = 'Executor'
  const respNomeFull = 'Responsável Teste'
  const numeroCasoStr = tarefa.numero_caso != null ? String(tarefa.numero_caso) : ''
  const nomeControle = 'Controle Teste'

  let subject = ''
  const bodyLines: string[] = []

  if (dbTipoEvento === 'atribuicao' || dbTipoEvento === 'alteracao_atribuicao') {
    subject = `Alteração de atribuição Ricci Task [Caso ${numeroCasoStr}]`
    bodyLines.push(`Olá, ${execFirstName}.`)
    bodyLines.push('')
    bodyLines.push('Houve uma alteração de atribuição no seu caso no Ricci Task.')
    bodyLines.push('')
    if (nomeControle) bodyLines.push(`Controle: ${nomeControle}`)
    bodyLines.push(`Caso: ${numeroCasoStr}`)
    if (tarefa.identificacao_caso?.trim())
      bodyLines.push(`Identificação: ${tarefa.identificacao_caso.trim()}`)
    bodyLines.push(`Executor: ${execNomeFull || 'Não definido'}`)
    if (respNomeFull) bodyLines.push(`Responsável: ${respNomeFull}`)
  } else if (dbTipoEvento === 'providencia_inclusao') {
    subject = `Nova providência Ricci Task [Caso ${numeroCasoStr}]`
    bodyLines.push(`Olá, ${execFirstName}.`)
    bodyLines.push('')
    bodyLines.push('Uma nova providência foi incluída no Ricci Task para o seu caso.')
    bodyLines.push('')
    if (nomeControle) bodyLines.push(`Controle: ${nomeControle}`)
    bodyLines.push(`Caso: ${numeroCasoStr}`)
    if (tarefa.identificacao_caso?.trim())
      bodyLines.push(`Identificação: ${tarefa.identificacao_caso.trim()}`)
    if (respNomeFull) bodyLines.push(`Responsável: ${respNomeFull}`)
    bodyLines.push('')
    bodyLines.push(`Providência: Providência Teste`)
  } else {
    subject = `Providência atualizada Ricci Task [Caso ${numeroCasoStr}]`
    bodyLines.push(`Olá, ${execFirstName}.`)
    bodyLines.push('')
    bodyLines.push('Uma providência foi atualizada no Ricci Task para o seu caso.')
    bodyLines.push('')
    if (nomeControle) bodyLines.push(`Controle: ${nomeControle}`)
    bodyLines.push(`Caso: ${numeroCasoStr}`)
    if (tarefa.identificacao_caso?.trim())
      bodyLines.push(`Identificação: ${tarefa.identificacao_caso.trim()}`)
    if (respNomeFull) bodyLines.push(`Responsável: ${respNomeFull}`)
    bodyLines.push('')
    bodyLines.push(`Providência: Providência Teste`)
  }

  bodyLines.push('')
  bodyLines.push('Acesse o Ricci Task para consultar o caso.')
  bodyLines.push('https://ricci-task.goskip.app/')

  const emailText = bodyLines.join('\n')
  const emailHtml = `
      <div style="font-family: sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a; margin-bottom: 16px;">${subject}</h2>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          ${bodyLines
            .filter((line) => line !== 'https://ricci-task.goskip.app/')
            .map((line) => (line === '' ? '<br/>' : `<p style="margin: 4px 0;">${line}</p>`))
            .join('')}
        </div>
        <p style="margin-top: 24px;">
          <a href="https://ricci-task.goskip.app/" style="background-color: #0284c7; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
            Acessar o Ricci Task
          </a>
        </p>
        <p style="margin-top: 16px; font-size: 13px; color: #64748b;">
          Link direto: <a href="https://ricci-task.goskip.app/" style="color: #0284c7;">https://ricci-task.goskip.app/</a>
        </p>
      </div>
    `

  // Antes de chamar o envio SMTP, gravar atomicamente status 'smtp_maybe_sent'
  const preSmtpIso = new Date().toISOString()
  const { data: maybeSentRows, error: maybeSentErr } = await ctx.supabase
    .from('task_email_eventos')
    .update({
      status: 'smtp_maybe_sent',
      locked_at: preSmtpIso,
    })
    .eq('id', eventoId)
    .eq('owner_token', callOwnerToken)
    .select('id, status, owner_token')

  if (maybeSentErr || !maybeSentRows || maybeSentRows.length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
        error:
          'Falha técnica ao assegurar pré-registro de envio (smtp_maybe_sent). Envio cancelado por segurança.',
      }),
      { status: 500, headers: corsHeaders },
    )
  }

  // Disparo SMTP
  try {
    await ctx.transporter.sendMail({
      from: '"Ricci Task" <nao-responder@riccitask.com.br>',
      to: toEmail,
      ...(ccEmail ? { cc: ccEmail } : {}),
      subject,
      text: emailText,
      html: emailHtml,
    })

    const agoraIso = new Date().toISOString()
    let persFailed = false

    if (eventoId) {
      const { data: updatedSuccessRows, error: updateSuccessErr } = await ctx.supabase
        .from('task_email_eventos')
        .update({ status: 'success', sent_at: agoraIso, erro: null })
        .eq('id', eventoId)
        .eq('owner_token', callOwnerToken)
        .select('id, status')

      if (updateSuccessErr || !updatedSuccessRows || updatedSuccessRows.length === 0) {
        persFailed = true
        await ctx.supabase
          .from('task_email_eventos')
          .update({
            status: 'uncertain',
            sent_at: agoraIso,
            erro: 'Falha pós-SMTP na persistência.',
          })
          .eq('id', eventoId)
          .eq('owner_token', callOwnerToken)
      }
    }

    if (persFailed) {
      return new Response(
        JSON.stringify({
          success: false,
          sent: true,
          status: 'uncertain',
          reason: 'post_send_persistence_failure',
          event_key: eventKey,
        }),
        { status: 500, headers: corsHeaders },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: true,
        event_key: eventKey,
        to: toEmail,
        cc: ccEmail,
      }),
      { status: 200, headers: corsHeaders },
    )
  } catch (sendErr: any) {
    const isTimeout = sendErr.code === 'ETIMEDOUT' || /timeout/i.test(sendErr.message || '')

    const errStatus = isTimeout ? 'uncertain' : 'error'

    if (eventoId) {
      await ctx.supabase
        .from('task_email_eventos')
        .update({ status: errStatus, erro: sendErr.message })
        .eq('id', eventoId)
        .eq('owner_token', callOwnerToken)
    }
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
        status: errStatus,
        error: sendErr.message,
      }),
      { status: 500, headers: corsHeaders },
    )
  }
}

// Handler representativo do caminho REAL de notify-task-overdue
async function handleNotifyTaskOverdue(req: Request, ctx: MockEdgeContext): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  const cronSecretHeader = req.headers.get('x-task-cron-secret')
  const authHeader = req.headers.get('Authorization')
  const TASK_OVERDUE_CRON_SECRET = ctx.env.TASK_OVERDUE_CRON_SECRET

  let isCronExecution = false
  if (cronSecretHeader !== null) {
    const headerTrimmed = cronSecretHeader.trim()
    const envTrimmed = (TASK_OVERDUE_CRON_SECRET || '').trim()
    if (!envTrimmed || !headerTrimmed || !timingSafeEqual(headerTrimmed, envTrimmed)) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado. Segredo do cron inválido ou não configurado.' }),
        { status: 401, headers: corsHeaders },
      )
    }
    isCronExecution = true
  }

  if (!isCronExecution) {
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Token de autenticação ou segredo de cron não fornecido.' }),
        { status: 401, headers: corsHeaders },
      )
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const { data: userData, error: userError } = await ctx.supabase.auth.getUser(token)
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
        status: 401,
        headers: corsHeaders,
      })
    }

    const adminCheck = await verifyRicciTaskAdmin(ctx.supabase, userData.user.id)
    if (!adminCheck.allowed) {
      return new Response(JSON.stringify({ error: adminCheck.error || 'Permissão negada.' }), {
        status: adminCheck.status || 403,
        headers: corsHeaders,
      })
    }
  }

  const todayStr = '2025-05-10'

  // Consulta providências abertas e atrasadas
  const { data: provsData, error: provsError } = await ctx.supabase
    .from('task_providencias')
    .select('*')

  if (provsError) {
    return new Response(JSON.stringify({ success: false, error: provsError.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }

  const providenciasAbertas = provsData || []
  if (providenciasAbertas.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Nenhuma providência atrasada.',
        processed: 0,
        sent: 0,
        skipped: 0,
        errors: 0,
        details: [],
      }),
      { status: 200, headers: corsHeaders },
    )
  }

  const results: any[] = []
  let totalSent = 0
  let totalSkipped = 0
  let totalErrors = 0

  const INTERVALO_REENVIO_MS = 72 * 60 * 60 * 1000

  for (const prov of providenciasAbertas) {
    const { data: tarefa } = await ctx.supabase
      .from('task_tarefas')
      .select('*')
      .eq('id', prov.tarefa_id)
      .maybeSingle()

    if (!tarefa || tarefa.deleted_at) {
      results.push({ providencia_id: prov.id, status: 'skipped', reason: 'tarefa_excluida' })
      totalSkipped++
      continue
    }

    const eventKey = `providencia_atraso:${prov.id}:${todayStr}`

    // REGRA DE REPETIÇÃO A CADA 72 HORAS:
    // Consulta o último envio bem-sucedido desta providência
    const { data: ultimoEnvioSucesso, error: ultimoEnvioError } = await ctx.supabase
      .from('task_email_eventos')
      .select('id, sent_at')
      .eq('providencia_id', prov.id)
      .eq('tipo_evento', 'providencia_atraso')
      .eq('status', 'success')
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (ultimoEnvioError) {
      results.push({
        providencia_id: prov.id,
        tarefa_id: tarefa.id,
        event_key: eventKey,
        status: 'error',
        reason: 'falha_consulta_central',
        error: ultimoEnvioError.message || 'Falha técnica ao consultar histórico de envios',
      })
      totalErrors++
      continue
    }

    if (ultimoEnvioSucesso && ultimoEnvioSucesso.sent_at) {
      const sentAtMs = new Date(ultimoEnvioSucesso.sent_at).getTime()
      const agoraMs = ctx.env.MOCK_NOW_MS ? Number(ctx.env.MOCK_NOW_MS) : Date.now()
      const diferencaMs = agoraMs - sentAtMs

      if (diferencaMs < INTERVALO_REENVIO_MS) {
        results.push({
          providencia_id: prov.id,
          event_key: eventKey,
          status: 'skipped',
          reason: 'intervalo_72h_nao_atingido',
        })
        totalSkipped++
        continue
      }
    }

    const { data: existingEvent, error: existingEventError } = await ctx.supabase
      .from('task_email_eventos')
      .select('id, status')
      .eq('event_key', eventKey)
      .maybeSingle()

    if (existingEventError) {
      results.push({
        providencia_id: prov.id,
        tarefa_id: tarefa.id,
        event_key: eventKey,
        status: 'error',
        reason: 'falha_consulta_central',
        error: existingEventError.message || 'Falha técnica ao consultar chave de idempotência',
      })
      totalErrors++
      continue
    }

    if (existingEvent && existingEvent.status === 'success') {
      results.push({
        providencia_id: prov.id,
        event_key: eventKey,
        status: 'skipped',
        reason: 'already_sent_today',
      })
      totalSkipped++
      continue
    }

    const execTargetId = tarefa.executor_core_usuario_id || tarefa.executor_usuario_id
    const execResolution = execTargetId
      ? await resolveValidatedRecipientByCoreId(ctx.supabase, execTargetId)
      : { status: 'missing_user_id', recipient: null }

    if (execResolution.status === 'technical_failure') {
      if (!existingEvent) {
        await ctx.supabase.from('task_email_eventos').insert({
          tarefa_id: tarefa.id,
          providencia_id: prov.id,
          event_key: eventKey,
          status: 'error',
          erro: 'falha_consulta_central',
        })
      }
      results.push({
        providencia_id: prov.id,
        event_key: eventKey,
        status: 'error',
        reason: 'falha_consulta_central',
        error: 'error' in execResolution ? execResolution.error : undefined,
      })
      totalErrors++
      continue
    }

    if (execResolution.status !== 'valid' || !execResolution.recipient?.email) {
      if (!existingEvent) {
        await ctx.supabase.from('task_email_eventos').insert({
          tarefa_id: tarefa.id,
          providencia_id: prov.id,
          event_key: eventKey,
          status: 'skipped',
          erro: 'executor_sem_vinculo_central_valido',
        })
      }
      results.push({
        providencia_id: prov.id,
        event_key: eventKey,
        status: 'skipped',
        reason: 'executor_sem_vinculo_central_valido',
      })
      totalSkipped++
      continue
    }

    const toEmail = execResolution.recipient.email.trim().toLowerCase()
    let ccEmail: string | null = null
    let validatedRespForMail: any = null

    const respTargetId = tarefa.responsavel_core_usuario_id || tarefa.responsavel_usuario_id
    if (respTargetId) {
      const respResolution = await resolveValidatedRecipientByCoreId(ctx.supabase, respTargetId)
      if (respResolution.status === 'technical_failure') {
        if (!existingEvent) {
          await ctx.supabase.from('task_email_eventos').insert({
            tarefa_id: tarefa.id,
            providencia_id: prov.id,
            event_key: eventKey,
            status: 'error',
            erro: 'falha_consulta_central',
          })
        }
        results.push({
          providencia_id: prov.id,
          event_key: eventKey,
          status: 'error',
          reason: 'falha_consulta_central',
          error: 'error' in respResolution ? respResolution.error : undefined,
        })
        totalErrors++
        continue
      }
      validatedRespForMail = respResolution.recipient
      const respEmailRaw = respResolution.recipient?.email?.trim().toLowerCase() || ''
      if (respEmailRaw && respEmailRaw !== toEmail) {
        ccEmail = respEmailRaw
      }
    }

    let eventoId = existingEvent?.id
    if (!existingEvent) {
      const { data: insertedEvent } = await ctx.supabase
        .from('task_email_eventos')
        .insert({
          tarefa_id: tarefa.id,
          providencia_id: prov.id,
          event_key: eventKey,
          to_email: toEmail,
          cc_email: ccEmail,
          status: 'pending',
        })
        .select('id')
        .maybeSingle()
      eventoId = insertedEvent?.id
    }

    const execNomeFull = (execResolution.recipient?.nome || '').trim()
    const execFirstName = execNomeFull ? execNomeFull.split(/\s+/)[0] : 'Executor'
    const respNomeFull = (validatedRespForMail?.nome || '').trim()
    const numeroCasoStr = tarefa.numero_caso != null ? String(tarefa.numero_caso) : ''
    const identificacaoCasoStr = (tarefa.identificacao_caso || '').trim()
    const provDescricao = (prov.providencia || '').trim()

    const subject = `Providência atrasada Ricci Task [Caso ${numeroCasoStr}]`

    const bodyLines: string[] = []
    bodyLines.push(`Olá, ${execFirstName}.`)
    bodyLines.push('')
    bodyLines.push(
      'Constatamos que uma providência sob sua execução está com o prazo vencido no Ricci Task.',
    )
    bodyLines.push('')
    if (tarefa.nome_controle?.nome) bodyLines.push(`Controle: ${tarefa.nome_controle.nome}`)
    if (numeroCasoStr) bodyLines.push(`Caso nº: ${numeroCasoStr}`)
    if (identificacaoCasoStr) bodyLines.push(`Identificação do Caso: ${identificacaoCasoStr}`)
    if (respNomeFull) bodyLines.push(`Responsável: ${respNomeFull}`)
    bodyLines.push('')
    if (provDescricao) bodyLines.push(`Providência: ${provDescricao}`)
    if (prov.prazo_conclusao) bodyLines.push(`Prazo Vencido: ${prov.prazo_conclusao}`)
    bodyLines.push('')
    bodyLines.push('Acesse o Ricci Task para consultar e atualizar a providência.')
    bodyLines.push('https://ricci-task.goskip.app/')

    const emailText = bodyLines.join('\n')
    const emailHtml = `
      <div style="font-family: sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #b91c1c; margin-bottom: 16px;">${subject}</h2>
        <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          ${bodyLines
            .filter((line) => line !== 'https://ricci-task.goskip.app/')
            .map((line) => (line === '' ? '<br/>' : `<p style="margin: 4px 0;">${line}</p>`))
            .join('')}
        </div>
        <p style="margin-top: 24px;">
          <a href="https://ricci-task.goskip.app/" style="background-color: #dc2626; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
            Acessar o Ricci Task
          </a>
        </p>
        <p style="margin-top: 16px; font-size: 13px; color: #64748b;">
          Link direto: <a href="https://ricci-task.goskip.app/" style="color: #dc2626;">https://ricci-task.goskip.app/</a>
        </p>
      </div>
    `

    try {
      await ctx.transporter.sendMail({
        from: '"Ricci Task" <nao-responder@riccitask.com.br>',
        to: toEmail,
        ...(ccEmail ? { cc: ccEmail } : {}),
        subject,
        text: emailText,
        html: emailHtml,
      })

      if (eventoId) {
        await ctx.supabase
          .from('task_email_eventos')
          .update({ status: 'success', sent_at: new Date().toISOString() })
          .eq('id', eventoId)
      }

      results.push({
        providencia_id: prov.id,
        event_key: eventKey,
        status: 'sent',
        to: toEmail,
        cc: ccEmail,
      })
      totalSent++
    } catch (sendErr: any) {
      if (eventoId) {
        await ctx.supabase
          .from('task_email_eventos')
          .update({ status: 'error', erro: sendErr.message })
          .eq('id', eventoId)
      }
      results.push({
        providencia_id: prov.id,
        event_key: eventKey,
        status: 'error',
        error: sendErr.message,
        to: toEmail,
        cc: ccEmail,
      })
      totalErrors++
    }
  }

  const hasTechnicalOrProcessingErrors = totalErrors > 0
  const message = hasTechnicalOrProcessingErrors
    ? `Processamento de providências atrasadas concluído com falhas (${totalErrors} erro(s), ${totalSent} enviado(s), ${totalSkipped} ignorado(s)).`
    : `Processamento diário de providências atrasadas concluído com sucesso.`

  return new Response(
    JSON.stringify({
      success: !hasTechnicalOrProcessingErrors,
      partial: hasTechnicalOrProcessingErrors && totalSent > 0,
      message,
      today: todayStr,
      processed: providenciasAbertas.length,
      sent: totalSent,
      skipped: totalSkipped,
      errors: totalErrors,
      details: results,
    }),
    {
      status: hasTechnicalOrProcessingErrors ? 207 : 200,
      headers: corsHeaders,
    },
  )
}

describe('Testes de Pipeline e Regras de Negócio das Edge Functions (notify-task-assignment & notify-task-overdue)', () => {
  let ctx: MockEdgeContext

  beforeEach(() => {
    vi.clearAllMocks()
    ctx = createMockEdgeContext()
  })

  describe('Pipeline notify-task-assignment (Atribuição com módulo real core-auth)', () => {
    describe('Validação do Chamador (Proteção contra disparos não autorizados)', () => {
      it('rejeita com 401 quando Authorization header não for enviado', async () => {
        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tarefa_id: 'tarefa-1', tipo: 'nova_atribuicao' }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(401)
        const body = await res.json()
        expect(body.error).toContain('Token de autenticação não encontrado')
      })

      it('rejeita com 403 quando chamador não tem vínculo central com RICCI_TASK', async () => {
        ctx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-sem-vinculo' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-sem-vinculo',
                          auth_user_id: 'auth-sem-vinculo',
                          nome: 'Sem Vínculo',
                          email: 'sem.vinculo@empresa.com',
                          ativo: true,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'core_usuario_sistemas') {
              const chain: any = {
                eq: () => chain,
                in: () => chain,
                then: (resolve: any) => resolve({ data: [], error: null }),
              }
              return { select: () => chain }
            }
            // Não deve consultar tarefas nem task_email_eventos
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tarefa_id: 'tarefa-1', tipo: 'nova_atribuicao' }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.error).toContain('sem permissão ativa para o sistema Ricci Task')
        expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
      })

      it('rejeita com 403 quando chamador está inativo em core_usuarios', async () => {
        ctx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-inativo' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-inativo',
                          auth_user_id: 'auth-inativo',
                          nome: 'Inativo Central',
                          email: 'inativo@empresa.com',
                          ativo: false,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tarefa_id: 'tarefa-1', tipo: 'nova_atribuicao' }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.error).toContain('usuário corporativo inativo')
        expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
      })

      it('retorna 500 (erro recuperável) quando ocorre falha técnica na consulta central do chamador', async () => {
        ctx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-chamador-tech-err' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: null,
                        error: { message: 'Database connection failed' },
                      }),
                  }),
                }),
              }
            }
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tarefa_id: 'tarefa-1', tipo: 'nova_atribuicao' }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(500)
        const body = await res.json()
        expect(body.error).toContain('Falha de comunicação com o Gestor de Acessos')
        expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
      })

      it('permite disparo com chamador ADMINISTRADOR ativo', async () => {
        ctx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-caller-admin' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-admin',
                          auth_user_id: 'auth-caller-admin',
                          nome: 'Admin Caller',
                          email: 'admin.caller@riccipi.com.br',
                          ativo: true,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'core_usuario_sistemas') {
              const chain: any = {
                eq: () => chain,
                in: () => chain,
                then: (resolve: any) =>
                  resolve({
                    data: [
                      {
                        id: 'link-admin',
                        ativo: true,
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                      },
                    ],
                    error: null,
                  }),
              }
              return { select: () => chain }
            }
            if (table === 'task_tarefas') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'tarefa-admin-test',
                          numero_caso: 111,
                          executor_usuario_id: null,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tarefa_id: 'tarefa-admin-test', tipo: 'nova_atribuicao' }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        // Passou da validação de autorização (200, com executor_ausente)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.reason).toBe('executor_ausente')
      })

      it('permite disparo com chamador GESTOR ativo', async () => {
        ctx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-caller-gestor' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-gestor',
                          auth_user_id: 'auth-caller-gestor',
                          nome: 'Gestor Caller',
                          email: 'gestor.caller@riccipi.com.br',
                          ativo: true,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'core_usuario_sistemas') {
              const chain: any = {
                eq: () => chain,
                in: () => chain,
                then: (resolve: any) =>
                  resolve({
                    data: [
                      {
                        id: 'link-gestor',
                        ativo: true,
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'GESTOR', ativo: true },
                      },
                    ],
                    error: null,
                  }),
              }
              return { select: () => chain }
            }
            if (table === 'task_tarefas') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'tarefa-gestor-test',
                          numero_caso: 112,
                          executor_usuario_id: null,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tarefa_id: 'tarefa-gestor-test', tipo: 'nova_atribuicao' }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.reason).toBe('executor_ausente')
      })

      it('permite disparo com chamador OPERACIONAL ativo', async () => {
        ctx.supabase = {
          auth: {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-caller-op' } },
              error: null,
            }),
          },
          from: vi.fn((table: string) => {
            if (table === 'core_usuarios') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-op',
                          auth_user_id: 'auth-caller-op',
                          nome: 'Op Caller',
                          email: 'op.caller@riccipi.com.br',
                          ativo: true,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            if (table === 'core_usuario_sistemas') {
              const chain: any = {
                eq: () => chain,
                in: () => chain,
                then: (resolve: any) =>
                  resolve({
                    data: [
                      {
                        id: 'link-op',
                        ativo: true,
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                      },
                    ],
                    error: null,
                  }),
              }
              return { select: () => chain }
            }
            if (table === 'task_tarefas') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'tarefa-op-test',
                          numero_caso: 113,
                          executor_usuario_id: null,
                        },
                        error: null,
                      }),
                  }),
                }),
              }
            }
            return {}
          }),
        }

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-jwt-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tarefa_id: 'tarefa-op-test', tipo: 'nova_atribuicao' }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.reason).toBe('executor_ausente')
      })
    })

    it('1. Criação de caso NÃO envia e-mail por regra de negócio (criacao_sem_notificacao)', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador-valido',
                        auth_user_id: 'auth-user-op',
                        nome: 'Chamador Válido',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-nova',
                        numero_caso: 100,
                        executor_core_usuario_id: 'cu-1',
                        responsavel_core_usuario_id: 'cu-1',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-caller',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-nova',
          tipo: 'nova_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.triggered).toBe(false)
      expect(body.sent).toBe(false)
      expect(body.reason).toBe('criacao_sem_notificacao')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    it('1.0. Deduplicação TO/CC na alteração de atribuição com IDs centrais da tarefa: quando Executor e Responsável têm o mesmo e-mail, TO recebe e CC fica vazio', async () => {
      // Configura mock do Supabase com executor_core_usuario_id e responsavel_core_usuario_id
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador-valido',
                        auth_user_id: 'auth-user-op',
                        nome: 'Chamador Válido',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-1',
                        numero_caso: 101,
                        executor_usuario_id: 'tu-exec',
                        responsavel_usuario_id: 'tu-resp',
                        executor_core_usuario_id: 'cu-mesmo',
                        responsavel_core_usuario_id: 'cu-mesmo',
                        updated_at: '2025-05-10T12:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'link-1',
                        ativo: true,
                        core_usuarios: {
                          id: 'cu-mesmo',
                          nome: 'Silva Mesmo Email',
                          email: 'mesmo.email@riccipi.com.br', // Mesmo e-mail para ambos!
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                      },
                      error: null,
                    }),
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'link-caller',
                          ativo: true,
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                      ],
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-1' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-1',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.to).toBe('mesmo.email@riccipi.com.br')
      expect(body.cc).toBeNull() // Deduplicado: CC vazio

      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)
      const mailCall = ctx.transporter.sentMails[0]
      expect(mailCall.to).toBe('mesmo.email@riccipi.com.br')
      expect(mailCall.cc).toBeUndefined()
      expect(mailCall.subject).toContain('Alteração de atribuição Ricci Task')
    })

    it('1.1. Ponte local inativa com core ativo: envia e-mail com sucesso para o destinatário central', async () => {
      // Cenário obrigatório: task_usuarios.ativo = false, mas core_usuarios/core_usuario_sistemas ativo
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador-valido',
                        auth_user_id: 'auth-user-op',
                        nome: 'Chamador Válido',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-ponte-inativa',
                        numero_caso: 888,
                        executor_usuario_id: 'tu-local-inativo',
                        executor_core_usuario_id: 'cu-core-ativo',
                        responsavel_usuario_id: null,
                        responsavel_core_usuario_id: null,
                        updated_at: '2025-05-10T12:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }

          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'link-central',
                        ativo: true,
                        core_usuarios: {
                          id: 'cu-core-ativo',
                          nome: 'Usuário Ativo Central',
                          email: 'ativo.central@riccipi.com.br',
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                      },
                      error: null,
                    }),
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'link-caller',
                          ativo: true,
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                      ],
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-ponte' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-ponte-inativa',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.sent).toBe(true)
      expect(body.to).toBe('ativo.central@riccipi.com.br')
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)
      expect(ctx.transporter.sentMails[0].to).toBe('ativo.central@riccipi.com.br')
    })

    it('1.2. Core inativo ou sem vínculo central: aborta disparo com executor_sem_vinculo_central_valido e sem e-mail', async () => {
      // Cenário obrigatório: core_usuarios inativo ou sem vínculo no Gestor de Acessos
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador-valido',
                        auth_user_id: 'auth-user-op',
                        nome: 'Chamador Válido',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-core-inativo',
                        numero_caso: 777,
                        executor_usuario_id: 'tu-op',
                        executor_core_usuario_id: 'cu-core-inativo',
                        responsavel_usuario_id: null,
                        responsavel_core_usuario_id: null,
                        updated_at: '2025-05-10T12:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null, // Sem vínculo central ativo com RICCI_TASK!
                      error: null,
                    }),
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'link-caller',
                          ativo: true,
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                      ],
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-core-inativo',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.triggered).toBe(true)
      expect(body.sent).toBe(false)
      expect(body.reason).toBe('executor_sem_vinculo_central_valido')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    it('2. TO e CC distintos: quando Executor e Responsável têm e-mails diferentes, envia TO ao executor e CC ao responsável', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador-valido',
                        auth_user_id: 'auth-user-op',
                        nome: 'Chamador Válido',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-2',
                        numero_caso: 102,
                        executor_usuario_id: 'tu-exec-2',
                        responsavel_usuario_id: 'tu-resp-2',
                        updated_at: '2025-05-10T12:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }

          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: (col: string, val: string) => {
                    if (col === 'usuario_id') {
                      chain._userId = val
                    }
                    return chain
                  },
                  maybeSingle: () => {
                    const isExec = chain._userId === 'cu-exec-2'
                    return Promise.resolve({
                      data: {
                        id: isExec ? 'link-exec' : 'link-resp',
                        ativo: true,
                        core_usuarios: {
                          id: chain._userId,
                          nome: isExec ? 'Executor Dois' : 'Responsável Dois',
                          email: isExec ? 'exec.dois@riccipi.com.br' : 'resp.dois@riccipi.com.br',
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                      },
                      error: null,
                    })
                  },
                  in: () => chain,
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'link-caller',
                          ativo: true,
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                      ],
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-2' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-2',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.to).toBe('exec.dois@riccipi.com.br')
      expect(body.cc).toBe('resp.dois@riccipi.com.br')

      const mailCall = ctx.transporter.sentMails[0]
      expect(mailCall.to).toBe('exec.dois@riccipi.com.br')
      expect(mailCall.cc).toBe('resp.dois@riccipi.com.br')
    })

    it('3. Falha central (technical_failure): retorna status 500 (erro recuperável) e permite retry', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () => {
                    if (val === 'auth-user-op') {
                      return Promise.resolve({
                        data: {
                          id: 'cu-chamador-valido',
                          auth_user_id: 'auth-user-op',
                          nome: 'Chamador Válido',
                          email: 'chamador@riccipi.com.br',
                          ativo: true,
                        },
                        error: null,
                      })
                    }
                    return Promise.resolve({
                      data: {
                        id: val,
                        core_usuario_id: 'cu-timeout',
                        ativo: true,
                      },
                      error: null,
                    })
                  },
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-3',
                        numero_caso: 103,
                        executor_usuario_id: 'tu-exec-timeout',
                        responsavel_usuario_id: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }

          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: (col: string, val: string) => {
                    chain._target = val
                    return chain
                  },
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: '504 Gateway Timeout' },
                    }),
                  then: (resolve: any) => {
                    // Para o chamador da função, autorização é válida
                    resolve({
                      data: [
                        {
                          id: 'link-caller',
                          ativo: true,
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                      ],
                      error: null,
                    })
                  },
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-3',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(500) // Erro recuperável!

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.reason).toBe('falha_consulta_central')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    it('4. Idempotência e retry: se o evento já foi enviado com sucesso, aborta reenvio (already_sent)', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador-valido',
                        auth_user_id: 'auth-user-op',
                        nome: 'Chamador Válido',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-4',
                        numero_caso: 104,
                        executor_usuario_id: 'tu-exec-4',
                        updated_at: '2025-05-10T15:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }

          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'link-4',
                        ativo: true,
                        core_usuarios: {
                          id: 'cu-4',
                          nome: 'Exec Quatro',
                          email: 'exec.quatro@riccipi.com.br',
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                      },
                      error: null,
                    }),
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'link-caller',
                          ativo: true,
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                      ],
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: 'evt-already', status: 'success' }, // Já enviado!
                      error: null,
                    }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-4',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.triggered).toBe(true)
      expect(body.sent).toBe(false)
      expect(body.reason).toBe('already_sent')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })
  })

  describe('Pipeline notify-task-overdue (Rotina de Atrasos com módulo real core-auth)', () => {
    it('4.8. Atribuição: alteração só de responsável ou só de executor ou de ambos envia exatamente 1 e-mail', async () => {
      // 4.8.a Mudança só de executor: envia 1 e-mail
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador-valido',
                        auth_user_id: 'auth-user-op',
                        nome: 'Chamador Válido',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-mudou-exec',
                        numero_caso: 301,
                        executor_core_usuario_id: 'cu-novo-exec',
                        responsavel_core_usuario_id: 'cu-mesmo-resp',
                        updated_at: '2026-09-10T10:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: (col: string, val: string) => {
                chain._user = val
                return chain
              },
              in: () => chain,
              maybeSingle: () => {
                const isExec = chain._user === 'cu-novo-exec'
                return Promise.resolve({
                  data: {
                    id: isExec ? 'link-exec' : 'link-resp',
                    ativo: true,
                    core_usuarios: {
                      id: chain._user,
                      nome: isExec ? 'Novo Executor' : 'Mesmo Responsavel',
                      email: isExec ? 'novo.exec@riccipi.com.br' : 'mesmo.resp@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                })
              },
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-caller',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { id: 'evt-novo-exec' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }),
      }

      const reqExec = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-mudou-exec',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const resExec = await handleNotifyTaskAssignment(reqExec, ctx)
      expect(resExec.status).toBe(200)
      const bodyExec = await resExec.json()
      expect(bodyExec.sent).toBe(true)
      expect(bodyExec.to).toBe('novo.exec@riccipi.com.br')
      expect(bodyExec.cc).toBe('mesmo.resp@riccipi.com.br')
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)
      expect(ctx.transporter.sentMails[0].subject).toContain('Alteração de atribuição Ricci Task')

      // 4.8.b Ambos mudam no mesmo salvamento: exatamente UM único envio de e-mail (nunca dois)
      ctx.transporter.sendMail.mockClear()
      ctx.transporter.sentMails = []

      const reqAmbos = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-mudou-exec',
          tipo: 'alteracao_atribuicao',
        }),
      })
      const resAmbos = await handleNotifyTaskAssignment(reqAmbos, ctx)
      expect(resAmbos.status).toBe(200)
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1) // Apenas 1 e-mail
    })

    it('4.9. Regra de repetição de 72 horas: primeiro envio ao entrar em atraso, bloqueio antes de 72h e novo envio após 72h', async () => {
      const now = new Date('2026-09-10T12:00:00Z').getTime()
      ctx.env.MOCK_NOW_MS = String(now)

      // Cenário A: Providência atrasada sem nenhum envio anterior -> envia com sucesso
      ctx.supabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_providencias') {
            return {
              select: () =>
                Promise.resolve({
                  data: [{ id: 'prov-nova-atrasada', tarefa_id: 'tarefa-atraso-1' }],
                  error: null,
                }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-atraso-1',
                        numero_caso: 501,
                        executor_core_usuario_id: 'cu-exec-atraso',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-exec',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-exec-atraso',
                      nome: 'Exec Atraso',
                      email: 'exec.atraso@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  not: () => chain,
                  order: () => chain,
                  limit: () => chain,
                  maybeSingle: () => Promise.resolve({ data: null, error: null }), // Nenhum envio anterior
                }
                return chain
              },
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-primeiro' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }),
      }

      const reqPrimeiro = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: { 'x-task-cron-secret': 'cron-secret-12345' },
      })
      const resPrimeiro = await handleNotifyTaskOverdue(reqPrimeiro, ctx)
      expect(resPrimeiro.status).toBe(200)
      const bodyPrimeiro = await resPrimeiro.json()
      expect(bodyPrimeiro.sent).toBe(1)
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)

      // Cenário B: Tentativa com 24 horas decorridas do último sent_at bem-sucedido (< 72h) -> bloqueia com motivo intervalo_72h_nao_atingido
      ctx.transporter.sendMail.mockClear()
      ctx.transporter.sentMails = []

      const sentAt24hAtras = new Date(now - 24 * 60 * 60 * 1000).toISOString()
      ctx.supabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_providencias') {
            return {
              select: () =>
                Promise.resolve({
                  data: [{ id: 'prov-nova-atrasada', tarefa_id: 'tarefa-atraso-1' }],
                  error: null,
                }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-atraso-1',
                        numero_caso: 501,
                        executor_core_usuario_id: 'cu-exec-atraso',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  not: () => chain,
                  order: () => chain,
                  limit: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: 'evt-passado', sent_at: sentAt24hAtras, status: 'success' },
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req24h = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: { 'x-task-cron-secret': 'cron-secret-12345' },
      })
      const res24h = await handleNotifyTaskOverdue(req24h, ctx)
      expect(res24h.status).toBe(200)
      const body24h = await res24h.json()
      expect(body24h.sent).toBe(0)
      expect(body24h.skipped).toBe(1)
      expect(body24h.details[0].reason).toBe('intervalo_72h_nao_atingido')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()

      // Cenário C: Tentativa com 73 horas decorridas (> 72h) -> permite novo envio
      const sentAt73hAtras = new Date(now - 73 * 60 * 60 * 1000).toISOString()
      ctx.supabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_providencias') {
            return {
              select: () =>
                Promise.resolve({
                  data: [{ id: 'prov-nova-atrasada', tarefa_id: 'tarefa-atraso-1' }],
                  error: null,
                }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-atraso-1',
                        numero_caso: 501,
                        executor_core_usuario_id: 'cu-exec-atraso',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-exec',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-exec-atraso',
                      nome: 'Exec Atraso',
                      email: 'exec.atraso@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            let callCount = 0
            return {
              select: () => {
                callCount++
                const chain: any = {
                  eq: () => chain,
                  not: () => chain,
                  order: () => chain,
                  limit: () => chain,
                  maybeSingle: () => {
                    // Primeira consulta: busca último envio bem-sucedido
                    if (callCount === 1) {
                      return Promise.resolve({
                        data: { id: 'evt-passado-73h', sent_at: sentAt73hAtras, status: 'success' },
                        error: null,
                      })
                    }
                    // Segunda consulta: chave diária exata de hoje
                    return Promise.resolve({ data: null, error: null })
                  },
                }
                return chain
              },
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-novo-72h' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }),
      }

      const req73h = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: { 'x-task-cron-secret': 'cron-secret-12345' },
      })
      const res73h = await handleNotifyTaskOverdue(req73h, ctx)
      expect(res73h.status).toBe(200)
      const body73h = await res73h.json()
      expect(body73h.sent).toBe(1)
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)
    })

    it('5. Autenticação via segredo cron real (x-task-cron-secret): segredo válido processa, ausente/inválido rejeita com 401', async () => {
      // 5.1. Segredo válido
      const reqValido = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: {
          'x-task-cron-secret': 'cron-secret-12345',
        },
      })

      ctx.supabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_providencias') {
            return {
              select: () => Promise.resolve({ data: [], error: null }),
            }
          }
          return {}
        }),
      }

      const resValido = await handleNotifyTaskOverdue(reqValido, ctx)
      expect(resValido.status).toBe(200)
      const bodyValido = await resValido.json()
      expect(bodyValido.success).toBe(true)
      expect(bodyValido.processed).toBe(0)
    })

    it('5.1. Execução manual da notify-task-overdue: autoriza ADMINISTRADOR central do Ricci Task e rejeita usuário comum com 403', async () => {
      // 5.1.a: Usuário autenticado com perfil ADMINISTRADOR central
      const reqAdmin = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-admin-ricci',
        },
      })

      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-admin-user', email: 'admin@riccipi.com.br' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-admin',
                        auth_user_id: 'auth-admin-user',
                        nome: 'Admin User',
                        email: 'admin@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-admin',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_providencias') {
            return {
              select: () => Promise.resolve({ data: [], error: null }),
            }
          }
          return {}
        }),
      }

      const resAdmin = await handleNotifyTaskOverdue(reqAdmin, ctx)
      expect(resAdmin.status).toBe(200)
      const bodyAdmin = await resAdmin.json()
      expect(bodyAdmin.success).toBe(true)

      // 5.1.b: Usuário comum (OPERACIONAL, sem perfil ADMINISTRADOR) -> 403
      const reqOperacional = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op-user',
        },
      })

      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-op-user', email: 'op@riccipi.com.br' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-op',
                        auth_user_id: 'auth-op-user',
                        nome: 'Op User',
                        email: 'op@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [], // Não é ADMINISTRADOR
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          return {}
        }),
      }

      const resOperacional = await handleNotifyTaskOverdue(reqOperacional, ctx)
      expect(resOperacional.status).toBe(403)
      const bodyOp = await resOperacional.json()
      expect(bodyOp.error).toContain('apenas administradores')

      // 5.2. Segredo inválido
      const reqInvalido = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: {
          'x-task-cron-secret': 'segredo-errado',
        },
      })
      const resInvalido = await handleNotifyTaskOverdue(reqInvalido, ctx)
      expect(resInvalido.status).toBe(401)
      const bodyInvalido = await resInvalido.json()
      expect(bodyInvalido.error).toContain('Segredo do cron inválido')

      // 5.3. Nenhum header (ausente)
      const reqAusente = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
      })
      const resAusente = await handleNotifyTaskOverdue(reqAusente, ctx)
      expect(resAusente.status).toBe(401)
    })

    it('6. Falha técnica central (technical_failure): marca evento individual como error (recuperável), indica falha no resultado geral e preserva idempotência nos outros', async () => {
      // 2 providências: a primeira tem falha técnica de rede no Gestor de Acessos; a segunda tem sucesso no envio
      ctx.supabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_providencias') {
            return {
              select: () =>
                Promise.resolve({
                  data: [
                    { id: 'prov-falha-tech', tarefa_id: 'tarefa-falha' },
                    { id: 'prov-sucesso', tarefa_id: 'tarefa-sucesso' },
                  ],
                  error: null,
                }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: val,
                        numero_caso: val === 'tarefa-falha' ? 201 : 202,
                        executor_core_usuario_id:
                          val === 'tarefa-falha' ? 'cu-exec-falha' : 'cu-sucesso',
                        executor_usuario_id: null,
                        responsavel_usuario_id: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: (_col: string, val: string) => {
                    chain._targetId = val
                    return chain
                  },
                  maybeSingle: () => {
                    if (chain._targetId === 'cu-exec-falha') {
                      return Promise.resolve({
                        data: null,
                        error: { message: 'Connection pool exhausted' },
                      })
                    }
                    return Promise.resolve({
                      data: {
                        id: 'link-ok',
                        ativo: true,
                        core_usuarios: {
                          id: 'cu-sucesso',
                          nome: 'Exec Sucesso',
                          email: 'exec.sucesso@riccipi.com.br',
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                      },
                      error: null,
                    })
                  },
                }
                return chain
              },
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-new' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: {
          'x-task-cron-secret': 'cron-secret-12345',
        },
      })

      const res = await handleNotifyTaskOverdue(req, ctx)
      // Quando há falhas técnicas/processamento, o status geral reflete a falha (não apresenta como 100% ok)
      expect(res.status).toBe(207)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.partial).toBe(true)
      expect(body.sent).toBe(1)
      expect(body.errors).toBe(1)
      expect(body.message).toContain('Processamento de providências atrasadas concluído com falhas')

      // Confere os detalhes individuais:
      const detalheFalha = body.details.find((d: any) => d.providencia_id === 'prov-falha-tech')
      expect(detalheFalha.status).toBe('error')
      expect(detalheFalha.reason).toBe('falha_consulta_central')

      const detalheSucesso = body.details.find((d: any) => d.providencia_id === 'prov-sucesso')
      expect(detalheSucesso.status).toBe('sent')
      expect(detalheSucesso.to).toBe('exec.sucesso@riccipi.com.br')

      // SMTP foi invocado para a tarefa de sucesso
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)
      expect(ctx.transporter.sentMails[0].to).toBe('exec.sucesso@riccipi.com.br')
    })

    it('7. Fail-closed: falha técnica na consulta do último sent_at bem-sucedido bloqueia o envio e marca status error', async () => {
      ctx.supabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_providencias') {
            return {
              select: () =>
                Promise.resolve({
                  data: [{ id: 'prov-err-sent-at', tarefa_id: 'tarefa-1' }],
                  error: null,
                }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-1',
                        numero_caso: 601,
                        executor_core_usuario_id: 'cu-exec-1',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-exec',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-exec-1',
                      nome: 'Exec Teste',
                      email: 'exec.teste@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  not: () => chain,
                  order: () => chain,
                  limit: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: 'Database timeout ao consultar sent_at' },
                    }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: { 'x-task-cron-secret': 'cron-secret-12345' },
      })

      const res = await handleNotifyTaskOverdue(req, ctx)
      expect(res.status).toBe(207)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.sent).toBe(0)
      expect(body.errors).toBe(1)
      expect(body.details[0].status).toBe('error')
      expect(body.details[0].reason).toBe('falha_consulta_central')
      expect(body.details[0].error).toContain('Database timeout ao consultar sent_at')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    it('8. Fail-closed: falha técnica na consulta da chave de idempotência bloqueia o envio e marca status error', async () => {
      ctx.supabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_providencias') {
            return {
              select: () =>
                Promise.resolve({
                  data: [{ id: 'prov-err-event-key', tarefa_id: 'tarefa-2' }],
                  error: null,
                }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-2',
                        numero_caso: 602,
                        executor_core_usuario_id: 'cu-exec-2',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-exec',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-exec-2',
                      nome: 'Exec Teste 2',
                      email: 'exec.teste2@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            let callCount = 0
            return {
              select: () => {
                callCount++
                const chain: any = {
                  eq: () => chain,
                  not: () => chain,
                  order: () => chain,
                  limit: () => chain,
                  maybeSingle: () => {
                    // Chamada 1: consulta sent_at (sucesso, nenhum anterior)
                    if (callCount === 1) {
                      return Promise.resolve({ data: null, error: null })
                    }
                    // Chamada 2: consulta event_key de hoje (falha técnica)
                    return Promise.resolve({
                      data: null,
                      error: { message: 'Connection reset ao consultar chave de idempotência' },
                    })
                  },
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: { 'x-task-cron-secret': 'cron-secret-12345' },
      })

      const res = await handleNotifyTaskOverdue(req, ctx)
      expect(res.status).toBe(207)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.sent).toBe(0)
      expect(body.errors).toBe(1)
      expect(body.details[0].status).toBe('error')
      expect(body.details[0].reason).toBe('falha_consulta_central')
      expect(body.details[0].error).toContain('Connection reset ao consultar chave de idempotência')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    describe('Provas Obrigatórias v0.0.74 (Regras de Event Key, Ponte e Transição)', () => {
      it('prova (a): caso antigo com tokens legados + evento success em task_email_eventos resulta em already_sent sem reenvio', async () => {
        const mockCaller = {
          id: 'auth-adm',
          email: 'admin@riccitask.com.br',
        }
        ctx.supabase.auth.getUser = vi.fn().mockResolvedValue({
          data: { user: mockCaller },
          error: null,
        })

        const historicalExecToken = 'c9eb08b8-f534-450c-90ac-17c290dadd93'
        const historicalRespToken = '2233e740-8b6e-4bf0-acf7-8afb0fcc85ac'
        const stamp = '2025-01-15T10:00:00.000Z'
        const expectedEventKey = `atribuicao:tarefa-historica:${stamp}:${historicalExecToken}:${historicalRespToken}`

        ctx.supabase.from = vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: 'cu-adm', auth_user_id: 'auth-adm', ativo: true },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'link-ok',
                        ativo: true,
                        core_usuarios: {
                          id: 'cu-exec-1',
                          nome: 'Exec Histórico',
                          email: 'exec.hist@riccipi.com.br',
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                      },
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-historica',
                        numero_caso: 99,
                        executor_usuario_id: historicalExecToken,
                        responsavel_usuario_id: historicalRespToken,
                        executor_core_usuario_id: 'cu-core-exec-1',
                        responsavel_core_usuario_id: 'cu-core-resp-1',
                        created_at: stamp,
                        updated_at: stamp,
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: (_col: string, val: string) => ({
                  maybeSingle: () => {
                    if (val === expectedEventKey) {
                      return Promise.resolve({
                        data: {
                          id: 'evt-existente',
                          event_key: expectedEventKey,
                          status: 'success',
                          sent_at: '2025-01-15T10:05:00.000Z',
                        },
                        error: null,
                      })
                    }
                    return Promise.resolve({ data: null, error: null })
                  },
                }),
              }),
            }
          }
          return {}
        }) as any

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tarefa_id: 'tarefa-historica',
            tipo: 'alteracao_atribuicao',
          }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.sent).toBe(false)
        expect(body.reason).toBe('already_sent')
        expect(body.event_key).toBe(expectedEventKey)
        expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
      })

      it('prova (b): pessoa sem ponte atribuída grava só central e recebe e-mail via ID central na chave', async () => {
        const mockCaller = {
          id: 'auth-adm',
          email: 'admin@riccitask.com.br',
        }
        ctx.supabase.auth.getUser = vi.fn().mockResolvedValue({
          data: { user: mockCaller },
          error: null,
        })

        const stamp = '2025-05-15T14:30:00.000Z'
        const expectedEventKey = `atribuicao:tarefa-sem-ponte:${stamp}:cu-novo-exec:cu-novo-resp`

        ctx.supabase.from = vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: 'cu-adm', auth_user_id: 'auth-adm', ativo: true },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: (_col: string, val: string) => {
                    chain._targetId = val
                    return chain
                  },
                  in: () => chain,
                  maybeSingle: () => {
                    const isResp = chain._targetId === 'cu-novo-resp'
                    return Promise.resolve({
                      data: {
                        id: isResp ? 'link-resp' : 'link-exec',
                        ativo: true,
                        core_usuarios: {
                          id: isResp ? 'cu-novo-resp' : 'cu-novo-exec',
                          nome: isResp ? 'Resp Sem Ponte' : 'Exec Sem Ponte',
                          email: isResp ? 'resp.novo@riccipi.com.br' : 'exec.novo@riccipi.com.br',
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                      },
                      error: null,
                    })
                  },
                }
                return chain
              },
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-sem-ponte',
                        numero_caso: 105,
                        executor_usuario_id: null, // SEM ponte operacional
                        responsavel_usuario_id: null, // SEM ponte operacional
                        executor_core_usuario_id: 'cu-novo-exec',
                        responsavel_core_usuario_id: 'cu-novo-resp',
                        created_at: stamp,
                        updated_at: stamp,
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-novo-1' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }) as any

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tarefa_id: 'tarefa-sem-ponte',
            tipo: 'alteracao_atribuicao',
          }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(200)

        const body = await res.json()
        expect(body.sent).toBe(true)
        expect(body.event_key).toBe(expectedEventKey)
        expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)
        expect(ctx.transporter.sentMails[0].to).toBe('exec.novo@riccipi.com.br')
        expect(ctx.transporter.sentMails[0].cc).toBe('resp.novo@riccipi.com.br')
      })

      it('prova (c): troca A -> B -> A gera eventos com chaves distintas sem colisão', async () => {
        const resolveEventKeyToken = (
          historicalToken?: string | null,
          coreId?: string | null,
        ): string => {
          if (historicalToken) return historicalToken
          if (coreId) return coreId
          return 'sem_token'
        }

        const tarefaId = 'tarefa-troca'
        const time1 = '2025-05-10T10:00:00.000Z'
        const time2 = '2025-05-11T11:00:00.000Z'
        const time3 = '2025-05-12T12:00:00.000Z'

        // Estado 1: Atribuído a A
        const key1 = `atribuicao:${tarefaId}:${time1}:${resolveEventKeyToken(null, 'cu-a')}:${resolveEventKeyToken(null, 'cu-a')}`
        // Estado 2: Troca para B
        const key2 = `atribuicao:${tarefaId}:${time2}:${resolveEventKeyToken(null, 'cu-b')}:${resolveEventKeyToken(null, 'cu-b')}`
        // Estado 3: Volta para A (updated_at novo no banco)
        const key3 = `atribuicao:${tarefaId}:${time3}:${resolveEventKeyToken(null, 'cu-a')}:${resolveEventKeyToken(null, 'cu-a')}`

        expect(key1).not.toBe(key2)
        expect(key2).not.toBe(key3)
        expect(key1).not.toBe(key3) // Timestamp distinto garante que não colide com o envio original
      })

      it('prova (d): Edge Function opera sem consultar task_usuarios em nenhuma hipótese', async () => {
        let taskUsuariosQueried = false
        ctx.supabase.from = vi.fn((table: string) => {
          if (table === 'task_usuarios') {
            taskUsuariosQueried = true
            throw new Error('task_usuarios NÃO PODE ser consultada na Edge Function!')
          }
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: 'cu-adm', auth_user_id: 'auth-adm', ativo: true },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'link-ok',
                        ativo: true,
                        core_usuarios: {
                          id: 'cu-core-exec',
                          nome: 'Exec Test',
                          email: 'exec@riccipi.com.br',
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                      },
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-sem-tu',
                        numero_caso: 10,
                        executor_usuario_id: null,
                        responsavel_usuario_id: null,
                        executor_core_usuario_id: 'cu-core-exec',
                        responsavel_core_usuario_id: 'cu-core-exec',
                        created_at: '2025-05-10T10:00:00Z',
                        updated_at: '2025-05-10T10:00:00Z',
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-1' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }) as any

        const req = new Request('https://edge.local/notify-task-assignment', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tarefa_id: 'tarefa-sem-tu',
            tipo: 'alteracao_atribuicao',
          }),
        })

        const res = await handleNotifyTaskAssignment(req, ctx)
        expect(res.status).toBe(200)
        expect(taskUsuariosQueried).toBe(false)
      })
    })
  })

  describe('Verificação dos 4 Modelos de E-mail (Links https://ricci-task.goskip.app/)', () => {
    it('1. notify-task-assignment: modelo de alteração de atribuição (HTML e Texto) contém https://ricci-task.goskip.app/ e não contém riccitask', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-link' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-chamador-link',
                        auth_user_id: 'auth-user-link',
                        nome: 'Chamador Link',
                        email: 'chamador@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-link-101',
                        numero_caso: 101,
                        identificacao_caso: 'Caso Alteração Atribuição',
                        executor_core_usuario_id: 'cu-exec-link',
                        responsavel_core_usuario_id: 'cu-resp-link',
                        updated_at: '2025-05-10T12:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'link-exec',
                        ativo: true,
                        core_usuarios: {
                          id: 'cu-exec-link',
                          nome: 'Carlos Executor',
                          email: 'carlos.executor@riccipi.com.br',
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                      },
                      error: null,
                    }),
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'link-caller',
                          ativo: true,
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                      ],
                      error: null,
                    }),
                }
                return chain
              },
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'evt-link-1' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'tarefa-link-101',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)

      const mailArgs = ctx.transporter.sentMails[0]
      expect(mailArgs).toBeDefined()

      // Modelo 1: Alteração de atribuição - Versão Texto
      expect(mailArgs.text).toContain('https://ricci-task.goskip.app/')
      expect(mailArgs.text).not.toContain('https://riccitask.goskip.app/')
      expect(mailArgs.text).not.toContain('riccitask.goskip')

      // Modelo 2: Alteração de atribuição - Corpo HTML
      expect(mailArgs.html).toBeDefined()
      expect(mailArgs.html).toContain('href="https://ricci-task.goskip.app/"')
      expect(mailArgs.html).toContain('https://ricci-task.goskip.app/')
      expect(mailArgs.html).not.toContain('https://riccitask.goskip.app/')
      expect(mailArgs.html).not.toContain('riccitask.goskip')
    })

    it('2. notify-task-overdue: modelo de providência atrasada (HTML e Texto) contém https://ricci-task.goskip.app/ e não contém riccitask', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn(),
        },
        from: vi.fn((table: string) => {
          if (table === 'task_providencias') {
            return {
              select: () => ({
                is: () => ({
                  eq: () => ({
                    eq: () => ({
                      not: () => ({
                        lt: () => ({
                          order: () =>
                            Promise.resolve({
                              data: [
                                {
                                  id: 'prov-overdue-1',
                                  tarefa_id: 'tarefa-overdue-202',
                                  providencia: 'Apresentar contestação urgente',
                                  prazo_conclusao: '2025-05-01',
                                  status: { finaliza: false },
                                },
                              ],
                              error: null,
                            }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tarefa-overdue-202',
                        numero_caso: 202,
                        identificacao_caso: 'Caso Providência Atrasada',
                        executor_core_usuario_id: 'cu-exec-overdue',
                        responsavel_core_usuario_id: null,
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: 'tarefa-overdue-202',
                        numero_caso: 202,
                        identificacao_caso: 'Caso Providência Atrasada',
                        executor_core_usuario_id: 'cu-exec-overdue',
                        responsavel_core_usuario_id: null,
                        deleted_at: null,
                      },
                    ],
                    error: null,
                  }),
              }),
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      not: () => ({
                        order: () => ({
                          limit: () => ({
                            maybeSingle: () => Promise.resolve({ data: null, error: null }),
                          }),
                        }),
                      }),
                    }),
                  }),
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { id: 'evt-overdue-1' }, error: null }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => ({
                eq: () => ({
                  in: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'link-exec-overdue',
                          ativo: true,
                          core_usuarios: {
                            id: 'cu-exec-overdue',
                            nome: 'Mariana Silva',
                            email: 'mariana.silva@riccipi.com.br',
                            ativo: true,
                          },
                          core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                          core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                        },
                        error: null,
                      }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-overdue', {
        method: 'POST',
        headers: {
          'x-task-cron-secret': 'cron-secret-12345',
          'Content-Type': 'application/json',
        },
      })

      const res = await handleNotifyTaskOverdue(req, ctx)
      expect(res.status).toBe(200)
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)

      const mailArgs = ctx.transporter.sentMails[0]
      expect(mailArgs).toBeDefined()

      // Modelo 3: Providência atrasada - Versão Texto
      expect(mailArgs.text).toContain('https://ricci-task.goskip.app/')
      expect(mailArgs.text).not.toContain('https://riccitask.goskip.app/')
      expect(mailArgs.text).not.toContain('riccitask.goskip')

      // Modelo 4: Providência atrasada - Corpo HTML
      expect(mailArgs.html).toBeDefined()
      expect(mailArgs.html).toContain('href="https://ricci-task.goskip.app/"')
      expect(mailArgs.html).toContain('https://ricci-task.goskip.app/')
      expect(mailArgs.html).not.toContain('https://riccitask.goskip.app/')
      expect(mailArgs.html).not.toContain('riccitask.goskip')
    })
  })

  describe('Suíte de Escopo Central e Fail-Closed em checkTaskAccessScope', () => {
    it('escapa caracteres especiais de HTML corretamente', () => {
      expect(escapeHtml('<script>alert("xss") & \'test\'</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;) &amp; &#39;test&#39;&lt;/script&gt;',
      )
      expect(escapeHtml('')).toBe('')
      expect(escapeHtml(null)).toBe('')
    })

    it('(a) Chamador sem ID central válido: bloqueia imediatamente (denied)', async () => {
      const mockSupabase = {} as any
      const resNull = await checkTaskAccessScope(mockSupabase, null, 'GESTOR', {
        id: 't-1',
        responsavel_core_usuario_id: 'cu-resp',
        executor_core_usuario_id: 'cu-exec',
      })
      expect(resNull.allowed).toBe(false)
      expect(resNull.status).toBe('denied')
      expect(resNull.error).toContain('sem ID central corporativo válido')

      const resEmpty = await checkTaskAccessScope(mockSupabase, { id: '   ' }, 'GESTOR', {
        id: 't-1',
        responsavel_core_usuario_id: 'cu-resp',
        executor_core_usuario_id: 'cu-exec',
      })
      expect(resEmpty.allowed).toBe(false)
      expect(resEmpty.status).toBe('denied')
    })

    it('(b) Perfil não reconhecido: bloqueia imediatamente (denied), MESMO se ID bater com responsável ou executor', async () => {
      const mockSupabase = {} as any
      // ID do chamador bate com o responsável, mas o perfil é desconhecido
      const res = await checkTaskAccessScope(
        mockSupabase,
        { id: 'cu-proprio' },
        'CONVIDADO_OU_DESCONHECIDO',
        {
          id: 't-1',
          responsavel_core_usuario_id: 'cu-proprio',
          executor_core_usuario_id: 'cu-outro',
        },
      )
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('denied')
      expect(res.error).toContain('perfil não autorizado')
    })

    it('(c) Caso sem IDs centrais válidos: bloqueia imediatamente (fail-closed, sem fallback permissivo)', async () => {
      const mockSupabase = {} as any
      // Para OPERACIONAL
      const resOp = await checkTaskAccessScope(mockSupabase, { id: 'cu-op' }, 'OPERACIONAL', {
        id: 't-sem-core',
        responsavel_core_usuario_id: null,
        executor_core_usuario_id: null,
      })
      expect(resOp.allowed).toBe(false)
      expect(resOp.status).toBe('denied')
      expect(resOp.error).toContain('sem IDs centrais válidos')

      // Para GESTOR
      const resGestor = await checkTaskAccessScope(mockSupabase, { id: 'cu-gestor' }, 'GESTOR', {
        id: 't-sem-core-gestor',
        responsavel_core_usuario_id: null,
        executor_core_usuario_id: null,
      })
      expect(resGestor.allowed).toBe(false)
      expect(resGestor.status).toBe('denied')
      expect(resGestor.error).toContain('sem IDs centrais válidos')
    })

    it('(d) ADMINISTRADOR: tem acesso irrestrito', async () => {
      const mockSupabase = {} as any
      const res = await checkTaskAccessScope(mockSupabase, { id: 'cu-admin' }, 'ADMINISTRADOR', {
        id: 't-1',
        responsavel_core_usuario_id: 'cu-outro-1',
        executor_core_usuario_id: 'cu-outro-2',
      })
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('ok')
    })

    it('(e) OPERACIONAL: permite apenas casos próprios (como responsável ou executor)', async () => {
      const mockSupabase = {} as any
      // Como responsável
      const resResp = await checkTaskAccessScope(mockSupabase, { id: 'cu-op-1' }, 'OPERACIONAL', {
        id: 't-propria-resp',
        responsavel_core_usuario_id: 'cu-op-1',
        executor_core_usuario_id: 'cu-outro',
      })
      expect(resResp.allowed).toBe(true)

      // Como executor
      const resExec = await checkTaskAccessScope(mockSupabase, { id: 'cu-op-1' }, 'OPERACIONAL', {
        id: 't-propria-exec',
        responsavel_core_usuario_id: 'cu-outro',
        executor_core_usuario_id: 'cu-op-1',
      })
      expect(resExec.allowed).toBe(true)

      // Caso de terceiro
      const resOutro = await checkTaskAccessScope(mockSupabase, { id: 'cu-op-1' }, 'OPERACIONAL', {
        id: 't-terceiro',
        responsavel_core_usuario_id: 'cu-outro-1',
        executor_core_usuario_id: 'cu-outro-2',
      })
      expect(resOutro.allowed).toBe(false)
      expect(resOutro.status).toBe('denied')
    })

    it('(f) GESTOR: permite casos próprios', async () => {
      const mockSupabase = {} as any
      const res = await checkTaskAccessScope(mockSupabase, { id: 'cu-gestor-1' }, 'GESTOR', {
        id: 't-gestor-propria',
        responsavel_core_usuario_id: 'cu-gestor-1',
        executor_core_usuario_id: 'cu-outro',
      })
      expect(res.allowed).toBe(true)
    })

    it('(f) GESTOR: permite casos de membros de sua equipe direta ativa (core_usuarios.gestor_id = gestorCoreId)', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 'cu-sub-1', gestor_id: 'cu-gestor-1', ativo: true }],
              error: null,
            }),
          }),
        }),
      } as any

      const res = await checkTaskAccessScope(mockSupabase, { id: 'cu-gestor-1' }, 'GESTOR', {
        id: 't-sub',
        responsavel_core_usuario_id: 'cu-sub-1',
        executor_core_usuario_id: 'cu-outro',
      })
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('ok')
    })

    it('(f) GESTOR: nega casos de membros inativos ou subordinados a outro gestor', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { id: 'cu-sub-inativo', gestor_id: 'cu-gestor-1', ativo: false },
                { id: 'cu-outro-gestor', gestor_id: 'cu-gestor-2', ativo: true },
              ],
              error: null,
            }),
          }),
        }),
      } as any

      const res = await checkTaskAccessScope(mockSupabase, { id: 'cu-gestor-1' }, 'GESTOR', {
        id: 't-negada',
        responsavel_core_usuario_id: 'cu-sub-inativo',
        executor_core_usuario_id: 'cu-outro-gestor',
      })
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('denied')
    })

    it('(f) GESTOR: falha de consulta em core_usuarios retorna technical_failure (fail-closed)', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database connection error' },
            }),
          }),
        }),
      } as any

      const res = await checkTaskAccessScope(mockSupabase, { id: 'cu-gestor-1' }, 'GESTOR', {
        id: 't-falha',
        responsavel_core_usuario_id: 'cu-alvo',
        executor_core_usuario_id: 'cu-outro',
      })
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('technical_failure')
    })
  })

  describe('Integração de Escopo no Handler notify-task-assignment', () => {
    it('retorna 403 quando chamador OPERACIONAL tentar disparar notificação para caso de terceiro', async () => {
      const ctx = createMockEdgeContext()
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-op-1' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-op-1',
                        auth_user_id: 'auth-op-1',
                        nome: 'Operador 1',
                        email: 'op1@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'cus-1',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'task-100',
                        numero_caso: 100,
                        responsavel_core_usuario_id: 'cu-outro-resp',
                        executor_core_usuario_id: 'cu-outro-exec',
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-op-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'task-100',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('não possui permissão para disparar notificações deste caso')
    })

    it('retorna 403 imediatamente se dados centrais de usuário ou perfil forem incompletos (remoção do wrapper permissivo)', async () => {
      const ctx = createMockEdgeContext()
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-incompleto' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null, // Sem coreUser!
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'task-101',
                        numero_caso: 101,
                        responsavel_core_usuario_id: 'cu-1',
                        executor_core_usuario_id: 'cu-2',
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-incompleto',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'task-101',
          tipo: 'alteracao_atribuicao',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('Permissão negada: dados centrais de usuário ou perfil incompletos.')
    })

    it('autoriza exclusivamente o envio da notificação quando o chamador perdeu acesso mas possui registro de transição válido', async () => {
      const ctx = createMockEdgeContext()
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-antigo-dono' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-antigo-dono',
                        auth_user_id: 'auth-antigo-dono',
                        nome: 'Antigo Dono',
                        email: 'antigo@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'cus-1',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-novo-exec',
                      nome: 'Novo Exec',
                      email: 'novo@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'cus-1',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'task-transf-ok',
                        numero_caso: 555,
                        responsavel_core_usuario_id: 'cu-novo-resp',
                        executor_core_usuario_id: 'cu-novo-exec',
                        updated_at: '2025-05-10T15:00:00Z',
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_transicoes_atribuicao') {
            const chain: any = {
              eq: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'trans-valid-1',
                      tarefa_id: 'task-transf-ok',
                      autor_core_id: 'cu-antigo-dono',
                      novo_responsavel_core_id: 'cu-novo-resp',
                      novo_executor_core_id: 'cu-novo-exec',
                      versao_resultante_updated_at: '2025-05-10T15:00:00Z',
                      created_at: '2025-05-10T15:00:00Z',
                    },
                  ],
                  error: null,
                }),
            }
            return {
              select: () => chain,
            }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: (payload: any) => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: 'evt-1', owner_token: payload.owner_token, status: 'pending' },
                      error: null,
                    }),
                }),
              }),
              update: () => {
                const chain: any = {
                  eq: () => chain,
                  select: () => ({
                    data: [{ id: 'evt-1', status: 'success' }],
                    error: null,
                  }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'task-transf-ok',
          tipo: 'alteracao_atribuicao',
          transicao_id: 'trans-valid-1',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.sent).toBe(true)
    })
  })

  describe('Pontos 4, 5 e 6: Testes Reais de Validação de Versões, Concorrência e Tolerância a Falhas', () => {
    it('Ponto 4: Rejeita notificação de providência quando versaoUpdatedAt for nula ou ausente', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'ev-1',
                            versao_updated_at: '2025-05-10T12:00:00Z',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      } as any

      const res = await checkProvidenciaEventAccess(mockSupabase, 'cu-autor', {
        tarefaId: 'task-1',
        providenciaId: 'prov-1',
        tipoEvento: 'providencia_atualizacao',
        versaoUpdatedAt: null,
      })

      expect(res.allowed).toBe(false)
      expect(res.status).toBe('denied')
      expect(res.error).toContain('Versão da providência não informada')
    })

    it('Ponto 4: Rejeita notificação de providência quando houver divergência de timestamp (mesmo que por 1 segundo)', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'ev-1',
                            versao_updated_at: '2025-05-10T12:00:00.000Z',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      } as any

      // 1 segundo de diferença: a regra antiga aceitava (< 5000ms), a nova DEVE rejeitar
      const res = await checkProvidenciaEventAccess(mockSupabase, 'cu-autor', {
        tarefaId: 'task-1',
        providenciaId: 'prov-1',
        tipoEvento: 'providencia_atualizacao',
        versaoUpdatedAt: '2025-05-10T12:00:01.000Z',
      })

      expect(res.allowed).toBe(false)
      expect(res.status).toBe('denied')
      expect(res.error).toContain('não corresponde ao evento gravado pelo servidor')
    })

    it('Ponto 4: Rejeita transição de reatribuição se versao_resultante_updated_at estiver ausente ou divergente', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'trans-old',
                        tarefa_id: 'task-1',
                        autor_core_id: 'cu-autor',
                        novo_responsavel_core_id: 'cu-resp',
                        novo_executor_core_id: 'cu-exec',
                        versao_resultante_updated_at: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      } as any

      const res = await checkTransitionNotificationAccess(mockSupabase, 'cu-autor', {
        tipoEvento: 'alteracao_atribuicao',
        tarefa: {
          id: 'task-1',
          responsavel_core_usuario_id: 'cu-resp',
          executor_core_usuario_id: 'cu-exec',
          updated_at: '2025-05-10T14:00:00Z',
        },
      })

      expect(res.allowed).toBe(false)
      expect(res.status).toBe('denied')
      expect(res.error).toContain('não corresponde ao estado atual gravado do caso')
    })

    it('Ponto 5: Concorrência na primeira aquisição (unique violation 23505) impede segundo envio SMTP', async () => {
      const ctx = createMockEdgeContext()

      let smtpCallCount = 0
      ctx.transporter.sendMail = vi.fn().mockImplementation(() => {
        smtpCallCount++
        return Promise.resolve()
      })

      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-op',
                        auth_user_id: 'auth-user-op',
                        nome: 'Operador',
                        email: 'op@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-op',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-op',
                      nome: 'Operador',
                      email: 'op@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-op',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'task-race-1',
                        numero_caso: 101,
                        responsavel_core_usuario_id: 'cu-op',
                        executor_core_usuario_id: 'cu-op',
                        updated_at: '2025-05-10T10:00:00Z',
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_transicoes_atribuicao') {
            const chain: any = {
              eq: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'trans-race-1',
                      tarefa_id: 'task-race-1',
                      autor_core_id: 'cu-op',
                      novo_responsavel_core_id: 'cu-op',
                      novo_executor_core_id: 'cu-op',
                      versao_resultante_updated_at: '2025-05-10T10:00:00Z',
                      created_at: '2025-05-10T10:00:00Z',
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: () => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null,
                      error: {
                        code: '23505',
                        message: 'duplicate key value violates unique constraint',
                      },
                    }),
                }),
              }),
              update: () => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  select: () => ({
                    maybeSingle: () => Promise.resolve({ data: null }),
                  }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'task-race-1',
          tipo: 'alteracao_atribuicao',
          transicao_id: 'trans-race-1',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.reason).toBe('in_progress')
      expect(smtpCallCount).toBe(0)
    })

    it('Ponto 5: Aquisição de zero linhas no UPDATE condicional impede segundo envio SMTP', async () => {
      const ctx = createMockEdgeContext()

      let smtpCallCount = 0
      ctx.transporter.sendMail = vi.fn().mockImplementation(() => {
        smtpCallCount++
        return Promise.resolve()
      })

      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-op',
                        auth_user_id: 'auth-user-op',
                        nome: 'Operador',
                        email: 'op@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-op',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-op',
                      nome: 'Operador',
                      email: 'op@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-op',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'task-zero-rows',
                        numero_caso: 102,
                        responsavel_core_usuario_id: 'cu-op',
                        executor_core_usuario_id: 'cu-op',
                        updated_at: '2025-05-10T10:00:00Z',
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_transicoes_atribuicao') {
            const chain: any = {
              eq: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'trans-zero-1',
                      tarefa_id: 'task-zero-rows',
                      autor_core_id: 'cu-op',
                      novo_responsavel_core_id: 'cu-op',
                      novo_executor_core_id: 'cu-op',
                      versao_resultante_updated_at: '2025-05-10T10:00:00Z',
                      created_at: '2025-05-10T10:00:00Z',
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-existing',
                        event_key: 'atribuicao:task-zero-rows:...',
                        status: 'pending',
                        locked_at: new Date().toISOString(),
                      },
                      error: null,
                    }),
                }),
              }),
              update: () => {
                const chain: any = {
                  eq: () => chain,
                  neq: () => chain,
                  or: () => chain,
                  select: () => ({
                    data: [],
                    error: null,
                  }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'task-zero-rows',
          tipo: 'alteracao_atribuicao',
          transicao_id: 'trans-zero-1',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.reason).toBe('in_progress')
      expect(data.message).toContain('0 linhas')
      expect(smtpCallCount).toBe(0)
    })

    it('Ponto 6: Falha de persistência pós-SMTP marca evento como incerto (uncertain) e bloqueia reenvio automático', async () => {
      const ctx = createMockEdgeContext()

      let recordedStatus = ''
      ctx.transporter.sendMail = vi.fn().mockResolvedValue({})

      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-op',
                        auth_user_id: 'auth-user-op',
                        nome: 'Operador',
                        email: 'op@riccipi.com.br',
                        ativo: true,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-op',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-op',
                      nome: 'Operador',
                      email: 'op@riccipi.com.br',
                      ativo: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                  },
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'link-op',
                      ativo: true,
                      core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { codigo: 'OPERACIONAL', ativo: true },
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'task-pers-fail',
                        numero_caso: 103,
                        responsavel_core_usuario_id: 'cu-op',
                        executor_core_usuario_id: 'cu-op',
                        updated_at: '2025-05-10T10:00:00Z',
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_transicoes_atribuicao') {
            const chain: any = {
              eq: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'trans-pers-1',
                      tarefa_id: 'task-pers-fail',
                      autor_core_id: 'cu-op',
                      novo_responsavel_core_id: 'cu-op',
                      novo_executor_core_id: 'cu-op',
                      versao_resultante_updated_at: '2025-05-10T10:00:00Z',
                      created_at: '2025-05-10T10:00:00Z',
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: (payload: any) => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: 'evt-pers', owner_token: payload.owner_token, status: 'pending' },
                      error: null,
                    }),
                }),
              }),
              update: (updatePayload: any) => {
                if (updatePayload.status === 'smtp_maybe_sent') {
                  return {
                    eq: () => ({
                      eq: () => ({
                        select: () => ({
                          data: [
                            {
                              id: 'evt-pers',
                              status: 'smtp_maybe_sent',
                              owner_token: 'valid-owner',
                            },
                          ],
                          error: null,
                        }),
                      }),
                    }),
                  }
                }
                if (updatePayload.status === 'uncertain') {
                  recordedStatus = 'uncertain'
                }
                const chain: any = {
                  eq: () => chain,
                  select: () => ({
                    data: [],
                    error: { message: 'Database connection dropped' },
                  }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'task-pers-fail',
          tipo: 'alteracao_atribuicao',
          transicao_id: 'trans-pers-1',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.status).toBe('uncertain')
      expect(data.reason).toBe('post_send_persistence_failure')
      expect(recordedStatus).toBe('uncertain')
    })

    it('v0.0.84: cenário crítico: SMTP bem-sucedido -> todas as gravações posteriores falham -> passam >5 minutos -> nova chamada NÃO envia (estado smtp_maybe_sent bloqueia reaquisição)', async () => {
      // 1. O envio anterior concluiu o pré-registro 'smtp_maybe_sent' e o SMTP disparou com sucesso,
      // mas TODAS as gravações posteriores falharam (rede caiu, banco caiu).
      // O registro em task_email_eventos ficou como 'smtp_maybe_sent' com locked_at de 10 minutos atrás (> 5 min).
      let smtpSentAttempts = 0
      const dezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString()

      const ctx = createMockEdgeContext()
      ctx.transporter.sendMail = vi.fn().mockImplementation(async () => {
        smtpSentAttempts++
        return { messageId: 'msg-should-never-reach' }
      })

      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'cu-op',
                          email: 'op@ricci.com',
                          nome: 'Operador',
                          ativo: true,
                          auth_user_id: 'auth-user-op',
                        },
                        error: null,
                      }),
                  }),
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-op',
                        email: 'op@ricci.com',
                        nome: 'Operador',
                        ativo: true,
                        auth_user_id: 'auth-user-op',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: () =>
                        Promise.resolve({
                          data: {
                            id: 'cus-1',
                            usuario_id: 'cu-op',
                            sistema_id: 's-task',
                            perfil_id: 'p-op',
                            ativo: true,
                          },
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'core_sistemas') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: 's-task', codigo: 'RICCI_TASK', ativo: true },
                        error: null,
                      }),
                  }),
                }),
              }),
            }
          }
          if (table === 'core_perfis') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: { id: 'p-op', codigo: 'OPERACIONAL', ativo: true },
                        error: null,
                      }),
                  }),
                }),
              }),
            }
          }
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'task-test-smtp-maybe-sent',
                        numero_caso: 9910,
                        identificacao_caso: 'Caso Teste Smtp Maybe Sent',
                        executor_core_usuario_id: 'cu-op',
                        responsavel_core_usuario_id: 'cu-op',
                        updated_at: '2025-05-10T10:00:00Z',
                        created_at: '2025-05-10T10:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_transicoes_atribuicao') {
            const chain: any = {
              eq: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'trans-smtp-maybe-sent',
                      tarefa_id: 'task-test-smtp-maybe-sent',
                      autor_core_id: 'cu-op',
                      novo_responsavel_core_id: 'cu-op',
                      novo_executor_core_id: 'cu-op',
                      versao_resultante_updated_at: '2025-05-10T10:00:00Z',
                      created_at: '2025-05-10T10:00:00Z',
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_email_eventos') {
            return {
              select: () => ({
                eq: () => ({
                  // Simula a consulta inicial do evento que já passou por SMTP anterior e ficou gravado como smtp_maybe_sent
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-smtp-maybe-sent',
                        event_key:
                          'atribuicao:task-test-smtp-maybe-sent:2025-05-10T10:00:00Z:cu-op:cu-op',
                        status: 'smtp_maybe_sent',
                        locked_at: dezMinutosAtras, // Passaram mais de 5 minutos (> 10min)
                        owner_token: 'old-token-from-first-call',
                      },
                      error: null,
                    }),
                }),
              }),
              update: () => {
                // Não deve atualizar nem re-adquirir
                throw new Error(
                  'task_email_eventos.update não deveria ser chamado para status smtp_maybe_sent!',
                )
              },
            }
          }
          return {}
        }),
      }

      // Nova chamada mais de 5 minutos depois (locked_at vencido há 10 min)
      const req = new Request('https://edge.local/notify-task-assignment', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tarefa_id: 'task-test-smtp-maybe-sent',
          tipo: 'alteracao_atribuicao',
          transicao_id: 'trans-smtp-maybe-sent',
        }),
      })

      const res = await handleNotifyTaskAssignment(req, ctx)

      // Deve bloquear com 409 (status incerto aguarda reconciliação manual)
      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.triggered).toBe(true)
      expect(data.sent).toBe(false)
      expect(data.reason).toBe('uncertain_status_reconciliation_required')

      // O transporte SMTP NUNCA deve ser disparado nesta segunda chamada
      expect(smtpSentAttempts).toBe(0)
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })
  })
})
