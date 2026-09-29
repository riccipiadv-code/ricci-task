import { describe, it, expect, vi } from 'vitest'
import {
  verifyRicciTaskAdmin,
  resolveValidatedTaskUserEmail,
  SYSTEM_CODE_RICCI_TASK,
  ROLE_CODE_ADMINISTRADOR,
} from './edgeFunctionsAuth'

describe('Edge Functions: Lógica de Autenticação e Resolução de Destinatários para Ricci Task', () => {
  describe('verifyRicciTaskAdmin (Execução manual de rotina de atrasos)', () => {
    it('sucesso: autoriza usuário com perfil ADMINISTRADOR ativo em RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-adm-1',
                        auth_user_id: 'auth-user-1',
                        email: 'adm@ricci.com.br',
                        nome: 'Admin User',
                        ativo: true,
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
                      eq: () =>
                        Promise.resolve({
                          data: [
                            {
                              id: 'link-1',
                              ativo: true,
                              core_sistemas: {
                                id: 'sys-rt',
                                codigo: SYSTEM_CODE_RICCI_TASK,
                                ativo: true,
                              },
                              core_perfis: {
                                id: 'p-adm',
                                codigo: ROLE_CODE_ADMINISTRADOR,
                                ativo: true,
                              },
                            },
                          ],
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      } as any

      const result = await verifyRicciTaskAdmin(mockSupabase, 'auth-user-1')
      expect(result.allowed).toBe(true)
      expect(result.coreUser?.email).toBe('adm@ricci.com.br')
      expect(result.systemCodes).toContain(SYSTEM_CODE_RICCI_TASK)
    })

    it('bloqueia: usuário inativo no Gestor de Acessos Ricci', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-adm-1',
                        auth_user_id: 'auth-user-1',
                        email: 'adm@ricci.com.br',
                        nome: 'Admin Inativo',
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
      } as any

      const result = await verifyRicciTaskAdmin(mockSupabase, 'auth-user-1')
      expect(result.allowed).toBe(false)
      expect(result.status).toBe(403)
      expect(result.error).toMatch(/inativo/i)
    })

    it('bloqueia: perfil não é ADMINISTRADOR (ex: OPERADOR)', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-op-1',
                        auth_user_id: 'auth-user-2',
                        email: 'operador@ricci.com.br',
                        nome: 'Operador User',
                        ativo: true,
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
                      eq: () =>
                        Promise.resolve({
                          data: [
                            {
                              id: 'link-2',
                              ativo: true,
                              core_sistemas: {
                                id: 'sys-rt',
                                codigo: SYSTEM_CODE_RICCI_TASK,
                                ativo: true,
                              },
                              core_perfis: {
                                id: 'p-op',
                                codigo: 'OPERADOR',
                                ativo: true,
                              },
                            },
                          ],
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      } as any

      const result = await verifyRicciTaskAdmin(mockSupabase, 'auth-user-2')
      expect(result.allowed).toBe(false)
      expect(result.status).toBe(403)
      expect(result.error).toMatch(/ADMINISTRADOR/i)
    })

    it('bloqueia: usuário sem vínculo ativo com RICCI_TASK', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cu-sem-vinculo',
                        auth_user_id: 'auth-user-3',
                        email: 'semvinculo@ricci.com.br',
                        nome: 'Sem Vinculo',
                        ativo: true,
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
                      eq: () =>
                        Promise.resolve({
                          data: [],
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      } as any

      const result = await verifyRicciTaskAdmin(mockSupabase, 'auth-user-3')
      expect(result.allowed).toBe(false)
      expect(result.status).toBe(403)
      expect(result.error).toMatch(/vínculo ativo com o sistema RICCI_TASK/i)
    })
  })

  describe('resolveValidatedTaskUserEmail (Resolução de e-mail central para TO e CC)', () => {
    it('e-mail central alterado: obtém e-mail novo em core_usuarios em vez do e-mail desatualizado local', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tu-100',
                        core_usuario_id: 'cu-200',
                        nome: 'Mariana Silva',
                        email: 'mariana.antigo@provedor-velho.com', // e-mail local defasado
                        ativo: true,
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
                      eq: () => ({
                        eq: () => ({
                          maybeSingle: () =>
                            Promise.resolve({
                              data: {
                                id: 'link-100',
                                ativo: true,
                                core_usuarios: {
                                  id: 'cu-200',
                                  nome: 'Mariana Silva Atualizada',
                                  email: 'mariana.silva@riccipi.com.br', // e-mail corporativo atualizado
                                  ativo: true,
                                },
                                core_sistemas: {
                                  id: 'sys-rt',
                                  codigo: 'RICCI_TASK',
                                  ativo: true,
                                },
                                core_perfis: {
                                  id: 'p-1',
                                  codigo: 'OPERADOR',
                                  ativo: true,
                                },
                              },
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
          return {}
        }),
      } as any

      const result = await resolveValidatedTaskUserEmail(mockSupabase, 'tu-100')
      expect(result).not.toBeNull()
      expect(result?.email).toBe('mariana.silva@riccipi.com.br')
      expect(result?.nome).toBe('Mariana Silva Atualizada')
      expect(result?.taskUsuarioId).toBe('tu-100')
      expect(result?.coreUsuarioId).toBe('cu-200')
    })

    it('destinatário inativo: não envia e não cai no e-mail local antigo (fail-closed)', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tu-inativo',
                        core_usuario_id: 'cu-inativo',
                        nome: 'Usuário Inativo',
                        email: 'inativo@riccipi.com.br',
                        ativo: true,
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
                      eq: () => ({
                        eq: () => ({
                          // Usuário central está inativo no Gestor de Acessos (inner join core_usuarios.ativo = true falha)
                          maybeSingle: () => Promise.resolve({ data: null, error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      } as any

      const result = await resolveValidatedTaskUserEmail(mockSupabase, 'tu-inativo')
      expect(result).toBeNull()
    })

    it('destinatário sem vínculo com RICCI_TASK: não envia e não recorre ao e-mail local antigo', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tu-sem-sistema',
                        core_usuario_id: 'cu-sem-sistema',
                        nome: 'Sem Sistema',
                        email: 'sem.sistema@riccipi.com.br',
                        ativo: true,
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
                      eq: () => ({
                        eq: () => ({
                          // Não possui vínculo com RICCI_TASK
                          maybeSingle: () => Promise.resolve({ data: null, error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      } as any

      const result = await resolveValidatedTaskUserEmail(mockSupabase, 'tu-sem-sistema')
      expect(result).toBeNull()
    })

    it('falha de conexão central: fail-closed estrito — retorna null sem enviar para e-mail antigo', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tu-erro',
                        core_usuario_id: 'cu-erro',
                        nome: 'Erro Central',
                        email: 'erro@riccipi.com.br',
                        ativo: true,
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
                      eq: () => ({
                        eq: () => ({
                          maybeSingle: () =>
                            Promise.resolve({
                              data: null,
                              error: new Error('Database network timeout'),
                            }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      } as any

      const result = await resolveValidatedTaskUserEmail(mockSupabase, 'tu-erro')
      expect(result).toBeNull()
    })
  })
})
