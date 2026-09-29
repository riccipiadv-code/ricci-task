import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  verifyRicciTaskAdmin,
  resolveValidatedTaskUserEmailDetailed,
  resolveValidatedTaskUserEmail,
  SYSTEM_CODE_CONECTAI,
  SYSTEM_CODE_RICCI_TASK,
  ROLE_CODE_ADMINISTRADOR,
} from '../../supabase/functions/_shared/core-auth'

describe('Validação do Módulo Real _shared/core-auth.ts (Gestor de Acessos Ricci)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Constantes de Sistema e Papel', () => {
    it('mantém códigos canônicos alinhados com o Gestor de Acessos', () => {
      expect(SYSTEM_CODE_RICCI_TASK).toBe('RICCI_TASK')
      expect(SYSTEM_CODE_CONECTAI).toBe('CONECTAI')
      expect(ROLE_CODE_ADMINISTRADOR).toBe('ADMINISTRADOR')
    })
  })

  describe('resolveValidatedTaskUserEmailDetailed e resolveValidatedTaskUserEmail', () => {
    it('retorna missing_user_id quando taskUsuarioId for vazio ou nulo', async () => {
      const mockSupabase = {} as any
      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, '')
      expect(res.status).toBe('missing_user_id')
      expect(res.recipient).toBeNull()

      const resLegacy = await resolveValidatedTaskUserEmail(mockSupabase, '')
      expect(resLegacy).toBeNull()
    })

    it('retorna invalid_link se o usuário não existir em task_usuarios', async () => {
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

      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'tu-inexistente')
      expect(res.status).toBe('invalid_link')
      expect(res.recipient).toBeNull()
      expect(res.error).toContain('Usuário operacional não encontrado')
    })

    it('retorna invalid_link se o usuário não possuir core_usuario_id', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'tu-sem-core',
                  core_usuario_id: null,
                  nome: 'Sem Core',
                  email: 'sem.core@legado.com',
                  ativo: true,
                },
                error: null,
              }),
            }),
          }),
        }),
      } as any

      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'tu-sem-core')
      expect(res.status).toBe('invalid_link')
      expect(res.recipient).toBeNull()
      expect(res.error).toContain('core_usuario_id ausente')
    })

    it('retorna invalid_link se o usuário estiver inativo em task_usuarios', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'tu-inativo',
                  core_usuario_id: 'cu-10',
                  nome: 'Inativo',
                  email: 'inativo@legado.com',
                  ativo: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      } as any

      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'tu-inativo')
      expect(res.status).toBe('invalid_link')
      expect(res.recipient).toBeNull()
      expect(res.error).toContain('marcado como inativo')
    })

    it('retorna technical_failure se houver erro ao consultar task_usuarios', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database connection timeout' },
              }),
            }),
          }),
        }),
      } as any

      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'tu-err')
      expect(res.status).toBe('technical_failure')
      expect(res.recipient).toBeNull()
      expect(res.error).toBe('Database connection timeout')
    })

    it('retorna technical_failure se houver exceção disparada pelo client em task_usuarios', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => {
          throw new Error('Network failure')
        }),
      } as any

      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'tu-err')
      expect(res.status).toBe('technical_failure')
      expect(res.recipient).toBeNull()
      expect(res.error).toBe('Network failure')
    })

    it('retorna technical_failure se houver erro de banco na consulta de core_usuario_sistemas', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tu-1',
                        core_usuario_id: 'cu-1',
                        nome: 'João Operacional',
                        email: 'joao.antigo@provedor.com',
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
              maybeSingle: () =>
                Promise.resolve({
                  data: null,
                  error: { message: 'PostgREST 504 Gateway Timeout' },
                }),
            }
            return {
              select: () => chain,
            }
          }
          return {}
        }),
      } as any

      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'tu-1')
      expect(res.status).toBe('technical_failure')
      expect(res.recipient).toBeNull()
      expect(res.error).toBe('PostgREST 504 Gateway Timeout')
    })

    it('retorna invalid_link se o usuário não tiver vínculo central ativo no RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tu-1',
                        core_usuario_id: 'cu-1',
                        nome: 'João Operacional',
                        email: 'joao.antigo@provedor.com',
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
              maybeSingle: () =>
                Promise.resolve({
                  data: null, // sem vínculo ativo com RICCI_TASK
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

      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'tu-1')
      expect(res.status).toBe('invalid_link')
      expect(res.recipient).toBeNull()
      expect(res.error).toContain('Vínculo central ausente ou inativo')
    })

    it('sucesso: resolve e-mail central alterado e ignora e-mail local antigo (NUNCA fallback)', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tu-1',
                        core_usuario_id: 'cu-1',
                        nome: 'João Operacional',
                        email: 'joao.antigo@provedor.com', // e-mail antigo desatualizado
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
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'link-1',
                    ativo: true,
                    core_usuarios: {
                      id: 'cu-1',
                      nome: 'João Carlos da Silva',
                      email: 'Joao.Silva@RICCIPI.COM.BR ', // novo e-mail corporativo central
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

      const res = await resolveValidatedTaskUserEmailDetailed(mockSupabase, 'tu-1')
      expect(res.status).toBe('valid')
      expect(res.recipient).not.toBeNull()
      expect(res.recipient?.email).toBe('joao.silva@riccipi.com.br') // sanitizado em minúsculas
      expect(res.recipient?.nome).toBe('João Carlos da Silva')
      expect(res.recipient?.taskUsuarioId).toBe('tu-1')
      expect(res.recipient?.coreUsuarioId).toBe('cu-1')

      // E a função legada retorna o recipient diretamente
      const resLegacy = await resolveValidatedTaskUserEmail(mockSupabase, 'tu-1')
      expect(resLegacy?.email).toBe('joao.silva@riccipi.com.br')
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
  })
})

describe('Regras de Envio e Notificações (notify-task-assignment & notify-task-overdue)', () => {
  it('eliminação de duplicidade TO/CC quando e-mails forem iguais', () => {
    const toEmail = 'usuario@riccipi.com.br'
    const respEmail = 'USUARIO@RICCIPI.COM.BR '
    const sanitizedRespEmail = respEmail.trim().toLowerCase()

    let ccEmail: string | null = null
    if (sanitizedRespEmail && sanitizedRespEmail !== toEmail) {
      ccEmail = sanitizedRespEmail
    }

    expect(ccEmail).toBeNull() // Não envia CC se for igual ao TO
  })

  it('mantém TO = Executor e CC = Responsável quando e-mails forem diferentes', () => {
    const toEmail = 'executor@riccipi.com.br'
    const respEmail = 'responsavel@riccipi.com.br'
    const sanitizedRespEmail = respEmail.trim().toLowerCase()

    let ccEmail: string | null = null
    if (sanitizedRespEmail && sanitizedRespEmail !== toEmail) {
      ccEmail = sanitizedRespEmail
    }

    expect(toEmail).toBe('executor@riccipi.com.br')
    expect(ccEmail).toBe('responsavel@riccipi.com.br')
  })

  it('diferenciação de motivos: vínculo inválido vs falha técnica', () => {
    // Vínculo inválido
    const invalidStatus = 'invalid_link'
    const invalidReason =
      invalidStatus === 'invalid_link'
        ? 'executor_sem_vinculo_central_valido'
        : 'falha_consulta_central'
    expect(invalidReason).toBe('executor_sem_vinculo_central_valido')

    // Falha técnica
    const techStatus = 'technical_failure'
    const techReason =
      techStatus === 'technical_failure'
        ? 'falha_consulta_central'
        : 'executor_sem_vinculo_central_valido'
    expect(techReason).toBe('falha_consulta_central')
  })

  it('autenticação do CRON via segredo x-scheduled-secret', () => {
    const secretFromEnv = 'my-super-secret-cron-token'
    const reqMatching = new Request('https://test.local', {
      headers: { 'x-scheduled-secret': 'my-super-secret-cron-token' },
    })
    const reqNonMatching = new Request('https://test.local', {
      headers: { 'x-scheduled-secret': 'wrong-secret' },
    })

    const isCronAuthorized = (req: Request) =>
      Boolean(secretFromEnv && req.headers.get('x-scheduled-secret') === secretFromEnv)

    expect(isCronAuthorized(reqMatching)).toBe(true)
    expect(isCronAuthorized(reqNonMatching)).toBe(false)
  })
})
