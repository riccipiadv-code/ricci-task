import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  processSolicitacaoAdiamento,
  listarAdministradoresElegiveis,
  getValidatedEligibleAdmin,
  isValidDateStr,
  isValidUUID,
  isValidEmail,
  normalizarEmail,
  formatDateBR,
  SolicitacaoAdiamentoDependencies,
} from '../../supabase/functions/_shared/solicitacao-adiamento-core'

interface MockContext {
  supabase: any
  transporter: any
  env: Record<string, string>
}

function createMockContext(envOverrides: Record<string, string> = {}): MockContext {
  const sentMails: any[] = []
  return {
    env: {
      SUPABASE_URL: 'https://mock.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-key',
      ...envOverrides,
    },
    transporter: {
      sentMails,
      sendMail: vi.fn(async (options: any) => {
        sentMails.push(options)
        return { messageId: 'mock-msg-123', accepted: [options.to], rejected: [] }
      }),
    },
    supabase: {} as any,
  }
}

async function handleSolicitacao(req: Request, ctx: MockContext): Promise<Response> {
  return processSolicitacaoAdiamento(req, {
    supabase: ctx.supabase,
    transporter: ctx.transporter,
    getEnv: (k: string) => ctx.env[k],
  })
}

describe('Backend de Solicitação de Adiamento (Edge Function & Módulo Core)', () => {
  let ctx: MockContext

  beforeEach(() => {
    vi.clearAllMocks()
    ctx = createMockContext()
  })

  describe('Utilitários e Formatação', () => {
    describe('normalizarEmail', () => {
      it('normaliza texto simples com maiúsculas e espaços', () => {
        expect(normalizarEmail('  Daniel@RicciPI.com.br  ')).toBe('daniel@riccipi.com.br')
        expect(normalizarEmail('DANIEL.ADENSOHN@RICCIPI.COM.BR')).toBe(
          'daniel.adensohn@riccipi.com.br',
        )
      })

      it('normaliza formato com "Nome" <email>', () => {
        expect(normalizarEmail('"Daniel Adensohn" <daniel.adensohn@riccipi.com.br>')).toBe(
          'daniel.adensohn@riccipi.com.br',
        )
        expect(normalizarEmail('"Daniel" <DANIEL.ADENSOHN@RICCIPI.COM.BR>')).toBe(
          'daniel.adensohn@riccipi.com.br',
        )
        expect(normalizarEmail('Helcio Ricci <helcio.ricci@riccipi.com.br>')).toBe(
          'helcio.ricci@riccipi.com.br',
        )
      })

      it('normaliza objeto { address: email } do nodemailer', () => {
        expect(normalizarEmail({ address: 'Daniel@RicciPI.com.br' })).toBe('daniel@riccipi.com.br')
        expect(normalizarEmail({ address: ' "Admin" <admin@riccipi.com.br> ' })).toBe(
          'admin@riccipi.com.br',
        )
      })

      it('retorna texto vazio para valores nulos, vazios ou inválidos', () => {
        expect(normalizarEmail(null)).toBe('')
        expect(normalizarEmail(undefined)).toBe('')
        expect(normalizarEmail('')).toBe('')
        expect(normalizarEmail('   ')).toBe('')
        expect(normalizarEmail({})).toBe('')
        expect(normalizarEmail(12345 as any)).toBe('')
      })
    })

    it('isValidDateStr: valida formato YYYY-MM-DD e rejeita datas inválidas', () => {
      expect(isValidDateStr('2026-05-15')).toBe(true)
      expect(isValidDateStr('2026-02-28')).toBe(true)
      expect(isValidDateStr('2026-13-01')).toBe(false)
      expect(isValidDateStr('2026-00-10')).toBe(false)
      expect(isValidDateStr('15/05/2026')).toBe(false)
      expect(isValidDateStr('')).toBe(false)
      expect(isValidDateStr(null)).toBe(false)
      expect(isValidDateStr('abc')).toBe(false)
    })

    it('isValidUUID: valida UUIDs canônicos', () => {
      expect(isValidUUID('38cb3c4d-7198-40a3-8815-a8881a9f506b')).toBe(true)
      expect(isValidUUID('invalid-uuid')).toBe(false)
      expect(isValidUUID('')).toBe(false)
      expect(isValidUUID(null)).toBe(false)
    })

    it('formatDateBR: formata datas para DD/MM/YYYY', () => {
      expect(formatDateBR('2026-05-15')).toBe('15/05/2026')
      expect(formatDateBR('2026-05-15T00:00:00Z')).toBe('15/05/2026')
      expect(formatDateBR('')).toBe('')
      expect(formatDateBR(null)).toBe('')
    })
  })

  describe('Operação: listar_administradores (Elegibilidade)', () => {
    it('retorna apenas administradores com vínculo RICCI_TASK ativo, perfil ADMINISTRADOR ativo, usuário ativo e adiamento = true', async () => {
      ctx.supabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'cus-1',
                      ativo: true,
                      core_usuarios: {
                        id: 'cu-admin-1',
                        nome: 'Helcio Ricci',
                        email: 'helcio.ricci@riccipi.com.br',
                        ativo: true,
                        adiamento: true,
                      },
                      core_sistemas: { id: 's-1', codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { id: 'p-1', codigo: 'ADMINISTRADOR', ativo: true },
                    },
                    {
                      id: 'cus-2',
                      ativo: true,
                      core_usuarios: {
                        id: 'cu-admin-2',
                        nome: 'Daniel Adensohn',
                        email: 'daniel.adensohn@riccipi.com.br',
                        ativo: true,
                        adiamento: true,
                      },
                      core_sistemas: { id: 's-1', codigo: 'RICCI_TASK', ativo: true },
                      core_perfis: { id: 'p-1', codigo: 'ADMINISTRADOR', ativo: true },
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

      const res = await listarAdministradoresElegiveis(ctx.supabase)
      expect(res.success).toBe(true)
      expect(res.administradores).toHaveLength(2)
      // Ordenado alfabeticamente
      expect(res.administradores[0].nome).toBe('Daniel Adensohn')
      expect(res.administradores[1].nome).toBe('Helcio Ricci')
    })

    it('retorna lista vazia e sucesso true quando nenhum administrador tiver adiamento = true', async () => {
      ctx.supabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuario_sistemas') {
            const chain: any = {
              eq: () => chain,
              then: (resolve: any) => resolve({ data: [], error: null }),
            }
            return { select: () => chain }
          }
          return {}
        }),
      }

      const res = await listarAdministradoresElegiveis(ctx.supabase)
      expect(res.success).toBe(true)
      expect(res.administradores).toEqual([])
    })
  })

  describe('Autenticação e Escopo de Acesso do Chamador', () => {
    it('rejeita com 401 se cabeçalho Authorization estiver ausente', async () => {
      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operacao: 'solicitar_adiamento' }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toContain('Token de autenticação não encontrado')
    })

    it('rejeita com 401 se token for inválido no auth.getUser', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: 'JWT expired' },
          }),
        },
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-expirado',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operacao: 'solicitar_adiamento' }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Não autorizado.')
    })

    it('rejeita com 403 se usuário autenticado não possui vínculo ativo no RICCI_TASK', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-sem-vinculo' } },
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
                        id: 'cu-sem-vinculo',
                        auth_user_id: 'auth-user-sem-vinculo',
                        nome: 'Sem Vinculo',
                        email: 'semvinculo@riccipi.com.br',
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
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-valido',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operacao: 'solicitar_adiamento' }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('vínculo ou perfil não autorizado')
    })

    it('rejeita com 403 quando chamador GESTOR tenta solicitar adiamento para caso fora do seu escopo (exclusivo de subordinado ou terceiro)', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-gestor-fora' } },
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
                        id: 'cu-gestor-fora',
                        auth_user_id: 'auth-gestor-fora',
                        nome: 'Gestor Fora',
                        email: 'gestorfora@riccipi.com.br',
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
                      id: 'cus-gestor',
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
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 501,
                        identificacao_caso: 'Caso Subordinado',
                        prazo_conclusao: '2026-05-10',
                        responsavel_core_usuario_id: 'cu-subordinado-1',
                        executor_core_usuario_id: 'cu-subordinado-2',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: false },
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

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-gestor',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Preciso de mais tempo para concluir.',
          prazo_solicitado: '2026-05-20',
          providencia_texto: 'Aguardar resposta do cliente',
          chave_idempotencia: '11111111-1111-4111-8111-111111111111',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain(
        'gestores só podem acessar casos em que são Responsável ou Executor',
      )
    })
  })

  describe('Validação do Destinatário (Administrador Elegível no Servidor)', () => {
    it('rejeita administrador informado pelo cliente que não possui adiamento = true', async () => {
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
            return {
              select: () => {
                const chain: any = {
                  eq: vi.fn().mockImplementation((col: string, val: any) => {
                    if (col === 'core_usuarios.adiamento' && val === true) {
                      // Simula que para o administrador solicitado não há adiamento=true
                      return {
                        ...chain,
                        maybeSingle: () => Promise.resolve({ data: null, error: null }),
                        then: (resolve: any) => resolve({ data: [], error: null }),
                      }
                    }
                    return chain
                  }),
                  in: () => chain,
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 502,
                        prazo_conclusao: '2026-05-10',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: false },
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

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Aguardando laudo técnico',
          prazo_solicitado: '2026-05-25',
          providencia_texto: 'Aguardar resposta pericial',
          chave_idempotencia: '11111111-1111-4111-8111-111111111112',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(data.error).toContain('Administrador selecionado não é elegível')
    })
  })

  describe('Validações de Motivo, Prazos e Providência', () => {
    const setupOpUser = () => {
      return (table: string) => {
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
                    id: 'cus-op',
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
        if (table === 'task_tarefas') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                      numero_caso: 503,
                      prazo_conclusao: '2026-05-15',
                      executor_core_usuario_id: 'cu-op-1',
                      responsavel_core_usuario_id: 'cu-resp-1',
                      deleted_at: null,
                      arquivado_at: null,
                      status: { finaliza: false },
                    },
                    error: null,
                  }),
              }),
            }),
          }
        }
        return {}
      }
    }

    it('rejeita motivo vazio após trim', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-op-1' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation(setupOpUser()),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: '   ',
          prazo_solicitado: '2026-05-25',
          providencia_texto: 'Aguardar resposta pericial',
          chave_idempotencia: '11111111-1111-4111-8111-111111111113',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('O motivo da solicitação é obrigatório.')
    })

    it('rejeita motivo com mais de 200 caracteres', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-op-1' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation(setupOpUser()),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'a'.repeat(201),
          prazo_solicitado: '2026-05-25',
          providencia_texto: 'Aguardar resposta pericial',
          chave_idempotencia: '11111111-1111-4111-8111-111111111114',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('máximo 200 caracteres')
    })

    it('rejeita data solicitada que seja anterior ou igual ao prazo de conclusão atual do caso', async () => {
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-op-1' } },
            error: null,
          }),
        },
        from: vi.fn().mockImplementation(setupOpUser()),
      }

      // Caso tem prazo_conclusao '2026-05-15', solicitação para '2026-05-15' ou antes deve ser rejeitada
      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Preciso de tempo',
          prazo_solicitado: '2026-05-15', // igual ao atual
          providencia_texto: 'Aguardar resposta pericial',
          chave_idempotencia: '11111111-1111-4111-8111-111111111115',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(data.error).toContain('deve ser posterior ao prazo de conclusão atual do caso')
    })

    it('rejeita providencia_id de outro caso ou com deleted_at preenchido', async () => {
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
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 504,
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: false },
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '99999999-9999-4999-8999-999999999999',
                        tarefa_id: 'outra-tarefa-diferente',
                        providencia: 'Providência intrusa',
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

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_id: '99999999-9999-4999-8999-999999999999',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Preciso de mais tempo',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111116',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(data.error).toContain('não pertence a este caso')
    })

    it('aceita providencia_id nulo quando o texto pretendido da nova providência for informado', async () => {
      // Simula fluxo completo com sucesso para nova providência
      const mockState = {
        solicitacaoInsert: null as any,
        emailEventInsert: null as any,
      }

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
            return {
              select: () => {
                const chain: any = {
                  eq: vi.fn().mockImplementation((col: string) => {
                    return chain
                  }),
                  in: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cus-admin-elegivel',
                        ativo: true,
                        core_usuarios: {
                          id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                          nome: 'Daniel Adensohn',
                          email: 'daniel.adensohn@riccipi.com.br',
                          ativo: true,
                          adiamento: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                      },
                      error: null,
                    }),
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 505,
                        identificacao_caso: 'Caso Teste',
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: false },
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
              insert: (row: any) => {
                mockState.solicitacaoInsert = row
                return {
                  select: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'sol-nova-prov-1',
                          chave_idempotencia: row.chave_idempotencia,
                          email_status: 'pendente',
                        },
                        error: null,
                      }),
                  }),
                }
              },
              update: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
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
              insert: (row: any) => {
                mockState.emailEventInsert = row
                return {
                  select: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'evt-nova-prov-1',
                          owner_token: row.owner_token,
                          status: 'pending',
                        },
                        error: null,
                      }),
                  }),
                }
              },
              update: (upd: any) => ({
                eq: () => ({
                  eq: () => ({
                    select: () =>
                      Promise.resolve({
                        data: [{ id: 'evt-nova-prov-1', status: upd.status }],
                        error: null,
                      }),
                  }),
                }),
              }),
            }
          }
          if (table === 'email_send_logs') {
            return {
              insert: () => Promise.resolve({ data: [], error: null }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_id: null,
          providencia_texto: 'Providência nova que ainda será cadastrada',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Necessidade de nova diligência',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111117',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.notificacao_aceita_smtp).toBe(true)
      expect(mockState.solicitacaoInsert.providencia_id).toBeNull()
      expect(mockState.solicitacaoInsert.providencia_texto).toBe(
        'Providência nova que ainda será cadastrada',
      )
      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)
    })
  })

  describe('Idempotência e Concorrência', () => {
    it('chave repetida com conteúdo IDÊNTICO é tratada de forma idempotente (sem segundo envio SMTP)', async () => {
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
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 506,
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: false },
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'sol-existente-1',
                        tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        providencia_id: null,
                        solicitante_core_usuario_id: 'cu-op-1',
                        administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                        providencia_texto: 'Aguardar resposta pericial',
                        motivo: 'Motivo idêntico',
                        prazo_caso_atual: '2026-05-15',
                        prazo_solicitado: '2026-05-25',
                        chave_idempotencia: '11111111-1111-4111-8111-111111111118',
                        email_status: 'enviado',
                        email_enviado_at: '2026-05-16T10:00:00Z',
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

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar resposta pericial',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo idêntico',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111118',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.email_status).toBe('enviado')
      expect(data.message).toContain('já registrada e notificação enviada')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    it('chave repetida com conteúdo DIFERENTE é rejeitada com 409', async () => {
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
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 507,
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: false },
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'sol-existente-diff',
                        tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        providencia_id: null,
                        solicitante_core_usuario_id: 'cu-op-1',
                        administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                        providencia_texto: 'Aguardar resposta pericial',
                        motivo: 'Motivo ORIGINAL gravado',
                        prazo_caso_atual: '2026-05-15',
                        prazo_solicitado: '2026-05-25',
                        chave_idempotencia: '11111111-1111-4111-8111-111111111119',
                        email_status: 'pendente',
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

      // Envia com motivo adulterado
      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar resposta pericial',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo NOVO MODIFICADO',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111119',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.error).toContain('parâmetros diferentes')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    it('concorrência: requisição simultânea com lock já adquirido em task_email_eventos não realiza segundo envio', async () => {
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
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 508,
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: false },
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'sol-concorrencia-1',
                        tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        providencia_id: null,
                        solicitante_core_usuario_id: 'cu-op-1',
                        administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                        providencia_texto: 'Aguardar resposta pericial',
                        motivo: 'Motivo concorrente',
                        prazo_caso_atual: '2026-05-15',
                        prazo_solicitado: '2026-05-25',
                        chave_idempotencia: '11111111-1111-4111-8111-111111111120',
                        email_status: 'pendente',
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
                  maybeSingle: () =>
                    Promise.resolve({
                      id: 'evt-bloqueado-1',
                      status: 'pending',
                      owner_token: 'outro-token-dono',
                      locked_at: new Date().toISOString(), // Lock recente!
                    }),
                }),
              }),
              update: () => {
                // Simula 0 linhas afetadas pois o lock está ativo
                const chain: any = {
                  eq: () => chain,
                  neq: () => chain,
                  or: () => chain,
                  select: () => Promise.resolve({ data: [], error: null }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar resposta pericial',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo concorrente',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111120',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.email_status).toBe('enviando')
      expect(data.notificacao_aceita_smtp).toBe(false)
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })
  })

  describe('Tratamento de Falhas SMTP (Definitiva vs Incerta)', () => {
    const setupBaseHappyPath = (onSendMail: () => Promise<any>) => {
      ctx.transporter.sendMail = vi.fn().mockImplementation(onSendMail)

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
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'cus-admin-elegivel',
                    ativo: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Daniel Adensohn',
                      email: 'daniel.adensohn@riccipi.com.br',
                      ativo: true,
                      adiamento: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                  },
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 509,
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: false },
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: {
                        id: 'sol-smtp-test-1',
                        chave_idempotencia: '11111111-1111-4111-8111-111111111121',
                        email_status: 'pendente',
                      },
                      error: null,
                    }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
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
              insert: (row: any) => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-smtp-test-1',
                        owner_token: row.owner_token,
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () =>
                      Promise.resolve({ data: [{ id: 'evt-smtp-test-1' }], error: null }),
                  }),
                }),
              }),
            }
          }
          if (table === 'email_send_logs') {
            return {
              insert: () => Promise.resolve({ data: [], error: null }),
            }
          }
          return {}
        }),
      }
    }

    it('falha definitiva do SMTP grava email_status = falhou e permite retry controlado', async () => {
      setupBaseHappyPath(async () => {
        const err: any = new Error('550 Mailbox not found')
        err.code = 'EMISCONFIG'
        throw err
      })

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar resposta pericial',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Diligência demorada',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111121',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.email_status).toBe('falhou')
      expect(data.notificacao_aceita_smtp).toBe(false)
      expect(data.error).toContain('Uma nova tentativa controlada é permitida')
    })

    it('falha incerta do SMTP (timeout/rede) grava email_status = incerto e NÃO permite reenvio automático', async () => {
      setupBaseHappyPath(async () => {
        const err: any = new Error('ETIMEDOUT: Connection timed out')
        err.code = 'ETIMEDOUT'
        throw err
      })

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar resposta pericial',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Diligência demorada',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111122',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.email_status).toBe('incerto')
      expect(data.notificacao_aceita_smtp).toBe(false)
      expect(data.error).toContain('sem reenvio automático')
    })
  })

  describe('Bloqueios de Casos Encerrados, Arquivados ou Excluídos', () => {
    it('bloqueia caso arquivado (arquivado_at) antes de registrar solicitação', async () => {
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
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 510,
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: '2026-05-01T12:00:00Z', // Arquivado!
                        status: { finaliza: false },
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

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar resposta pericial',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Diligência',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111123',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(data.reason).toBe('caso_arquivado')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    it('bloqueia caso encerrado (status finaliza=true)', async () => {
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
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 511,
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        status: { finaliza: true }, // Encerrado!
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

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar resposta pericial',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Diligência',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111124',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(data.reason).toBe('caso_encerrado')
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })
  })

  describe('Envio Completo com Sucesso e Escape HTML', () => {
    it('executa envio com sucesso escapando HTML e diferenciando solicitação registrada de notificação aceita', async () => {
      let sentMailPayload: any = null
      ctx.transporter.sendMail = vi.fn().mockImplementation(async (mail) => {
        sentMailPayload = mail
        return { messageId: 'msg-success-789' }
      })

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
                        nome: 'João <Operador> & Silva',
                        email: 'joao.silva@riccipi.com.br',
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
                    id: 'cus-admin-elegivel',
                    ativo: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Daniel Adensohn',
                      email: 'daniel.adensohn@riccipi.com.br',
                      ativo: true,
                      adiamento: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                  },
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 512,
                        identificacao_caso: 'Ação <Declaratória> nº 100',
                        pasta_ricci: 'R-999',
                        pasta_cliente: 'C-888',
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: null,
                        nome_controle: { nome: 'Controle Cível' },
                        status: { finaliza: false },
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: '88888888-8888-4888-8888-888888888888',
                        tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        providencia: 'Apresentar réplica <urgente>',
                        prazo_conclusao: '2026-05-15',
                        deleted_at: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: {
                        id: 'sol-happy-1',
                        chave_idempotencia: '11111111-1111-4111-8111-111111111125',
                        email_status: 'pendente',
                      },
                      error: null,
                    }),
                }),
              }),
              update: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
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
              insert: (row: any) => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-happy-1',
                        owner_token: row.owner_token,
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => Promise.resolve({ data: [{ id: 'evt-happy-1' }], error: null }),
                  }),
                }),
              }),
            }
          }
          if (table === 'email_send_logs') {
            return {
              insert: () => Promise.resolve({ data: [], error: null }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-op',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_id: '88888888-8888-4888-8888-888888888888',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Aguardando certidão cartorária <urgente>',
          prazo_solicitado: '2026-05-28',
          chave_idempotencia: '11111111-1111-4111-8111-111111111125',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.email_status).toBe('enviado')
      expect(data.notificacao_aceita_smtp).toBe(true)
      expect(data.destinatario.email).toBe('daniel.adensohn@riccipi.com.br')

      expect(ctx.transporter.sendMail).toHaveBeenCalledTimes(1)
      expect(sentMailPayload.to).toBe('daniel.adensohn@riccipi.com.br')
      // Checa escape de HTML
      expect(sentMailPayload.html).toContain('&lt;Operador&gt;')
      expect(sentMailPayload.html).toContain('&lt;urgente&gt;')
      expect(sentMailPayload.html).not.toContain('<Operador>')
      expect(sentMailPayload.html).toContain('Pasta Ricci: R-999')
      expect(sentMailPayload.html).toContain('15/05/2026')
      expect(sentMailPayload.html).toContain('28/05/2026')
    })
  })

  describe('Correções Mínimas de Segurança e Robustez (Versão 0.0.114)', () => {
    const makeAuthMock = (
      coreUserId = 'c0000000-0000-4000-8000-000000000001',
      perfil = 'OPERACIONAL',
      email = 'solicitante@riccipi.com.br',
    ) => {
      const auth = {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'u-caller-auth',
              email,
            },
          },
          error: null,
        }),
      }

      const coreUser = {
        id: coreUserId,
        auth_user_id: 'u-caller-auth',
        nome: 'Solicitante Teste',
        email,
        ativo: true,
      }

      const corePerfil = {
        codigo: perfil,
        ativo: true,
      }

      const coreSistema = {
        codigo: 'RICCI_TASK',
        ativo: true,
      }

      return { auth, coreUser, corePerfil, coreSistema }
    }

    it('1. Deve bloquear envio se preSmtpTarefa retornar status ausente (sem fallback)', async () => {
      const { auth, coreUser, corePerfil, coreSistema } = makeAuthMock()
      const transporter = {
        sendMail: vi.fn().mockResolvedValue({ accepted: ['admin@riccipi.com.br'], rejected: [] }),
      }

      let emailEventoStatus = ''
      const supabase: any = {
        auth,
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: coreUser, error: null }),
            }
            return { select: () => chain }
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
                      core_sistemas: coreSistema,
                      core_perfis: corePerfil,
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            let callCount = 0
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => {
                callCount++
                if (callCount === 1) {
                  return Promise.resolve({
                    data: {
                      id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                      numero_caso: 601,
                      prazo_conclusao: '2026-05-15',
                      executor_core_usuario_id: coreUser.id,
                      status: { finaliza: false },
                    },
                    error: null,
                  })
                }
                // Na reconsulta pré-SMTP, retorna caso sem status
                return Promise.resolve({
                  data: {
                    id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                    numero_caso: 601,
                    prazo_conclusao: '2026-05-15',
                    executor_core_usuario_id: coreUser.id,
                    status: null,
                  },
                  error: null,
                })
              },
            }
            return { select: () => chain }
          }
          if (table === 'task_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'tu-admin',
                    core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                    ativo: true,
                    adiamento: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Admin Teste',
                      email: 'admin@riccipi.com.br',
                      ativo: true,
                    },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: { id: 'sol-601', email_status: 'pendente' },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => ({
                eq: () => Promise.resolve({ data: [{ id: 'sol-601', ...vals }], error: null }),
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-601',
                        owner_token: 'mock-token',
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => {
                emailEventoStatus = vals.status
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  select: () =>
                    Promise.resolve({ data: [{ id: 'evt-601', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'evt-601', ...vals }], error: null }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência teste',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111101',
        }),
      })

      const res = await handleSolicitacao(req, {
        supabase,
        transporter,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(data.email_status).toBe('falhou')
      expect(transporter.sendMail).not.toHaveBeenCalled()
    })

    it('2. Deve revalidar antes do SMTP e usar o e-mail atualizado do administrador', async () => {
      const { auth, coreUser, corePerfil, coreSistema } = makeAuthMock()
      const transporter = {
        sendMail: vi
          .fn()
          .mockResolvedValue({ accepted: ['admin-novo@riccipi.com.br'], rejected: [] }),
      }

      let adminQueryCount = 0
      const supabase: any = {
        auth,
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: coreUser, error: null }),
            }
            return { select: () => chain }
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
                      core_sistemas: coreSistema,
                      core_perfis: corePerfil,
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                    numero_caso: 602,
                    prazo_conclusao: '2026-05-15',
                    executor_core_usuario_id: coreUser.id,
                    status: { finaliza: false },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_usuarios') {
            adminQueryCount++
            const emailAdmin =
              adminQueryCount === 1 ? 'admin-antigo@riccipi.com.br' : 'admin-novo@riccipi.com.br'
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'tu-admin',
                    core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                    ativo: true,
                    adiamento: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Admin Teste',
                      email: emailAdmin,
                      ativo: true,
                    },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: { id: 'sol-602', email_status: 'pendente' },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => ({
                eq: () => ({
                  select: () =>
                    Promise.resolve({ data: [{ id: 'sol-602', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'sol-602', ...vals }], error: null }),
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-602',
                        owner_token: 'mock-token',
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  select: () =>
                    Promise.resolve({ data: [{ id: 'evt-602', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'evt-602', ...vals }], error: null }),
                }
                return chain
              },
            }
          }
          if (table === 'email_send_logs') {
            return {
              insert: () => Promise.resolve({ data: [], error: null }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência teste',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111102',
        }),
      })

      const res = await handleSolicitacao(req, {
        supabase,
        transporter,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(res.status).toBe(200)
      expect(transporter.sendMail).toHaveBeenCalledTimes(1)
      const callArg = transporter.sendMail.mock.calls[0][0]
      expect(callArg.to).toBe('admin-novo@riccipi.com.br')
    })

    it('3. Deve preservar ID da solicitação e informar que já foi registrada se faltar config SMTP', async () => {
      const { auth, coreUser, corePerfil, coreSistema } = makeAuthMock()

      const supabase: any = {
        auth,
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: coreUser, error: null }),
            }
            return { select: () => chain }
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
                      core_sistemas: coreSistema,
                      core_perfis: corePerfil,
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                    numero_caso: 603,
                    prazo_conclusao: '2026-05-15',
                    executor_core_usuario_id: coreUser.id,
                    status: { finaliza: false },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'tu-admin',
                    core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                    ativo: true,
                    adiamento: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Admin Teste',
                      email: 'admin@riccipi.com.br',
                      ativo: true,
                    },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: { id: 'sol-603-saved', email_status: 'pendente' },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => ({
                eq: () =>
                  Promise.resolve({ data: [{ id: 'sol-603-saved', ...vals }], error: null }),
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-603',
                        owner_token: 'mock-token',
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  select: () =>
                    Promise.resolve({ data: [{ id: 'evt-603', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'evt-603', ...vals }], error: null }),
                }
                return chain
              },
            }
          }
          if (table === 'email_settings') {
            return {
              select: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência teste',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111103',
        }),
      })

      // Sem injetar transporter deps, forçando consulta de email_settings
      const res = await handleSolicitacao(req, {
        supabase,
        transporter: null,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.solicitacao_id).toBe('sol-603-saved')
      expect(data.email_status).toBe('falhou')
      expect(data.error).toContain('Solicitação registrada com sucesso')
    })

    it('4. Deve bloquear reenvio e classificar como incerto se retorno de sendMail tiver accepted vazio', async () => {
      const { auth, coreUser, corePerfil, coreSistema } = makeAuthMock()
      const transporter = {
        sendMail: vi.fn().mockResolvedValue({ accepted: [], rejected: [] }),
      }

      const supabase: any = {
        auth,
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: coreUser, error: null }),
            }
            return { select: () => chain }
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
                      core_sistemas: coreSistema,
                      core_perfis: corePerfil,
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                    numero_caso: 604,
                    prazo_conclusao: '2026-05-15',
                    executor_core_usuario_id: coreUser.id,
                    status: { finaliza: false },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'tu-admin',
                    core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                    ativo: true,
                    adiamento: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Admin Teste',
                      email: 'admin@riccipi.com.br',
                      ativo: true,
                    },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: { id: 'sol-604', email_status: 'pendente' },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => ({
                eq: () => ({
                  select: () =>
                    Promise.resolve({ data: [{ id: 'sol-604', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'sol-604', ...vals }], error: null }),
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-604',
                        owner_token: 'mock-token',
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  select: () =>
                    Promise.resolve({ data: [{ id: 'evt-604', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'evt-604', ...vals }], error: null }),
                }
                return chain
              },
            }
          }
          if (table === 'email_send_logs') {
            return {
              insert: () => Promise.resolve({ data: [], error: null }),
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência teste',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111104',
        }),
      })

      const res = await handleSolicitacao(req, {
        supabase,
        transporter,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.email_status).toBe('incerto')
      expect(data.notificacao_aceita_smtp).toBe(false)
      expect(data.error).toContain('incerto')
    })

    it('5. Em conflito 23505, releia e compare o registro vencedor preservando idempotência', async () => {
      const { auth, coreUser, corePerfil, coreSistema } = makeAuthMock()
      const transporter = {
        sendMail: vi.fn().mockResolvedValue({ accepted: ['admin@riccipi.com.br'] }),
      }

      const winnerRecord = {
        id: 'sol-winner-605',
        tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
        providencia_id: null,
        solicitante_core_usuario_id: coreUser.id,
        administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
        providencia_texto: 'Providência original',
        motivo: 'Motivo original',
        prazo_caso_atual: '2026-05-15',
        prazo_solicitado: '2026-05-20',
        chave_idempotencia: '11111111-1111-4111-8111-111111111105',
        email_status: 'enviado',
      }

      let readCount = 0
      const supabase: any = {
        auth,
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: coreUser, error: null }),
            }
            return { select: () => chain }
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
                      core_sistemas: coreSistema,
                      core_perfis: corePerfil,
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                    numero_caso: 605,
                    prazo_conclusao: '2026-05-15',
                    executor_core_usuario_id: coreUser.id,
                    status: { finaliza: false },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'tu-admin',
                    core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                    ativo: true,
                    adiamento: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Admin Teste',
                      email: 'admin@riccipi.com.br',
                      ativo: true,
                    },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_solicitacoes_adiamento') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => {
                    readCount++
                    // Primeira leitura não acha (simula corrida); releitura de 23505 retorna winner
                    if (readCount === 1) return Promise.resolve({ data: null, error: null })
                    return Promise.resolve({ data: winnerRecord, error: null })
                  },
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
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência original',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo original',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111105',
        }),
      })

      const res = await handleSolicitacao(req, {
        supabase,
        transporter,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.solicitacao_id).toBe('sol-winner-605')
      expect(data.email_status).toBe('enviado')
      expect(transporter.sendMail).not.toHaveBeenCalled()
    })

    it('6. Deve preservar eventos no cancelamento sem apagá-los e proteger transição por owner_token', async () => {
      const { auth, coreUser, corePerfil, coreSistema } = makeAuthMock()
      const transporter = {
        sendMail: vi.fn(),
      }

      let deleteCalled = false
      let eventoUpdatedStatus = ''

      const supabase: any = {
        auth,
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: coreUser, error: null }),
            }
            return { select: () => chain }
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
                      core_sistemas: coreSistema,
                      core_perfis: corePerfil,
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            let count = 0
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => {
                count++
                if (count === 1) {
                  return Promise.resolve({
                    data: {
                      id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                      numero_caso: 606,
                      prazo_conclusao: '2026-05-15',
                      executor_core_usuario_id: coreUser.id,
                      status: { finaliza: false },
                    },
                    error: null,
                  })
                }
                // Na revalidação pré-SMTP, o caso foi arquivado
                return Promise.resolve({
                  data: {
                    id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                    numero_caso: 606,
                    arquivado_at: '2026-05-10T12:00:00Z',
                    prazo_conclusao: '2026-05-15',
                    executor_core_usuario_id: coreUser.id,
                    status: { finaliza: false },
                  },
                  error: null,
                })
              },
            }
            return { select: () => chain }
          }
          if (table === 'task_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'tu-admin',
                    core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                    ativo: true,
                    adiamento: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Admin Teste',
                      email: 'admin@riccipi.com.br',
                      ativo: true,
                    },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: { id: 'sol-606', email_status: 'pendente' },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => ({
                eq: () => Promise.resolve({ data: [{ id: 'sol-606', ...vals }], error: null }),
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-606',
                        owner_token: 'mock-token',
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              delete: () => {
                deleteCalled = true
                const chain: any = {
                  eq: () => chain,
                  then: (resolve: any) => resolve({ data: [], error: null }),
                }
                return chain
              },
              update: (vals: any) => {
                eventoUpdatedStatus = vals.status
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  select: () =>
                    Promise.resolve({ data: [{ id: 'evt-606', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'evt-606', ...vals }], error: null }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência teste',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111106',
        }),
      })

      const res = await handleSolicitacao(req, {
        supabase,
        transporter,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.email_status).toBe('cancelado')
      expect(deleteCalled).toBe(false) // Evento NÃO deve ser deletado
      expect(eventoUpdatedStatus).toBe('error') // Evento preservado com status de erro
    })

    it('7. Deve validar tipos do payload antes de trim e rejeitar e-mails inválidos/múltiplos', async () => {
      const { auth, coreUser, corePerfil, coreSistema } = makeAuthMock()
      const supabase: any = {
        auth,
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: coreUser, error: null }),
            }
            return { select: () => chain }
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
                      core_sistemas: coreSistema,
                      core_perfis: corePerfil,
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

      // Payload com motivo não-string (ex: número)
      const reqInvalidType = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 12345, // tipo inválido
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111107',
        }),
      })

      const resType = await handleSolicitacao(reqInvalidType, {
        supabase,
        transporter: null,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(resType.status).toBe(400)
      const dataType = await resType.json()
      expect(dataType.error).toContain('texto')

      // Teste da função auxiliar isValidEmail
      expect(isValidEmail('admin@riccipi.com.br')).toBe(true)
      expect(isValidEmail('admin1@riccipi.com.br, admin2@riccipi.com.br')).toBe(false)
      expect(isValidEmail('admin1@riccipi.com.br; admin2@riccipi.com.br')).toBe(false)
      expect(isValidEmail('invalid-email')).toBe(false)
      expect(isValidEmail(null as any)).toBe(false)
      expect(isValidEmail(undefined as any)).toBe(false)
    })

    it('7. Conferência de accepted e rejected deve exigir igualdade exata e não aceitar por substring/contains', async () => {
      const { auth, coreUser, corePerfil, coreSistema } = makeAuthMock()

      const buildSupabase = (adminEmail: string = 'daniel@ricci.com.br') => ({
        auth,
        from: vi.fn((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: coreUser, error: null }),
            }
            return { select: () => chain }
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
                      core_sistemas: coreSistema,
                      core_perfis: corePerfil,
                    },
                  ],
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'task_tarefas') {
            const chain: any = {
              eq: () => chain,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                    numero_caso: 607,
                    prazo_conclusao: '2026-05-15',
                    executor_core_usuario_id: coreUser.id,
                    status: { finaliza: false },
                  },
                  error: null,
                }),
            }
            return { select: () => chain }
          }
          if (table === 'core_usuario_sistemas' || table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: { id: 'sol-607', email_status: 'pendente' },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => ({
                eq: () => ({
                  select: () =>
                    Promise.resolve({ data: [{ id: 'sol-607', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'sol-607', ...vals }], error: null }),
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
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-607',
                        owner_token: 'mock-token',
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (vals: any) => {
                const chain: any = {
                  eq: () => chain,
                  in: () => chain,
                  select: () =>
                    Promise.resolve({ data: [{ id: 'evt-607', ...vals }], error: null }),
                  then: (resolve: any) =>
                    resolve({ data: [{ id: 'evt-607', ...vals }], error: null }),
                }
                return chain
              },
            }
          }
          if (table === 'email_send_logs') {
            return {
              insert: () => Promise.resolve({ data: [], error: null }),
            }
          }
          return {}
        }),
      })

      // Admin elegível: daniel@ricci.com.br
      // Caso A: accepted contém apenas endereço com substring 'outro.daniel@ricci.com.br'
      // O envio NÃO deve ser confirmado — deve ficar incerto (409)
      const transporterSubstring = {
        sendMail: vi.fn().mockResolvedValue({
          accepted: ['outro.daniel@ricci.com.br'],
          rejected: [],
        }),
      }

      // Mock getValidatedEligibleAdmin interno via consulta do banco core_usuario_sistemas
      const mockSupabaseA: any = buildSupabase('daniel@ricci.com.br')
      // Customiza retorno de core_usuario_sistemas para o admin
      const originalFromA = mockSupabaseA.from
      mockSupabaseA.from = vi.fn((table: string) => {
        if (table === 'core_usuario_sistemas') {
          return {
            select: () => ({
              eq: (col: string, val: any) => {
                const chain2: any = {
                  eq: () => chain2,
                  in: () => chain2,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'cus-admin',
                        ativo: true,
                        core_usuarios: {
                          id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                          nome: 'Daniel',
                          email: 'daniel@ricci.com.br',
                          ativo: true,
                          adiamento: true,
                        },
                        core_sistemas: { id: 's-1', codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { id: 'p-1', codigo: 'ADMINISTRADOR', ativo: true },
                      },
                      error: null,
                    }),
                  then: (resolve: any) =>
                    resolve({
                      data: [
                        {
                          id: 'cus-1',
                          ativo: true,
                          core_sistemas: coreSistema,
                          core_perfis: corePerfil,
                        },
                      ],
                      error: null,
                    }),
                }
                return chain2
              },
            }),
          }
        }
        return originalFromA(table)
      })

      const reqA = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência teste',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111107',
        }),
      })

      const resA = await handleSolicitacao(reqA, {
        supabase: mockSupabaseA,
        transporter: transporterSubstring,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(resA.status).toBe(409)
      const dataA = await resA.json()
      expect(dataA.email_status).toBe('incerto')
      expect(dataA.notificacao_aceita_smtp).toBe(false)
      expect(dataA.error).toContain('incerto')

      // Caso B: rejected contém endereço que apenas possui a substring (ex: outro.daniel@ricci.com.br),
      // mas accepted traz exatamente o admin no formato '"Daniel" <DANIEL@RICCI.COM.BR>'.
      // NÃO deve ser tratado como rejeitado, e SIM confirmado com sucesso!
      const transporterExactFormatted = {
        sendMail: vi.fn().mockResolvedValue({
          accepted: ['"Daniel" <DANIEL@RICCI.COM.BR>'],
          rejected: ['outro.daniel@ricci.com.br'],
        }),
      }

      const reqB = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência teste',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111108',
        }),
      })

      const resB = await handleSolicitacao(reqB, {
        supabase: mockSupabaseA,
        transporter: transporterExactFormatted,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(resB.status).toBe(200)
      const dataB = await resB.json()
      expect(dataB.email_status).toBe('enviado')
      expect(dataB.notificacao_aceita_smtp).toBe(true)

      // Caso C: accepted traz objeto { address: 'daniel@ricci.com.br' }
      const transporterObject = {
        sendMail: vi.fn().mockResolvedValue({
          accepted: [{ address: 'daniel@ricci.com.br' }],
          rejected: [],
        }),
      }

      const reqC = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Providência teste',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste',
          prazo_solicitado: '2026-05-20',
          chave_idempotencia: '11111111-1111-4111-8111-111111111109',
        }),
      })

      const resC = await handleSolicitacao(reqC, {
        supabase: mockSupabaseA,
        transporter: transporterObject,
        env: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' },
      })
      expect(resC.status).toBe(200)
      const dataC = await resC.json()
      expect(dataC.email_status).toBe('enviado')
      expect(dataC.notificacao_aceita_smtp).toBe(true)
    })
  })

  describe('Pontos de Desistência com Auxiliar encerrarEventoSemEnvio', () => {
    it('cenário dono do evento: caso arquivado antes do envio atualiza evento para error, solicitação para cancelado e responde 200 (reason: caso_arquivado)', async () => {
      let eventoUpdatedWith: any = null
      let solicitacaoUpdatedWith: any = null

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
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'cus-admin-elegivel',
                    ativo: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Daniel Adensohn',
                      email: 'daniel.adensohn@riccipi.com.br',
                      ativo: true,
                      adiamento: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                  },
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            let callCount = 0
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => {
                    callCount++
                    // Primeira consulta: tarefa aberta
                    // Reconsulta pré-SMTP: tarefa arquivada!
                    return Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 520,
                        identificacao_caso: 'Caso Arquivado Antes do SMTP',
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: callCount > 1 ? '2026-05-10T12:00:00Z' : null,
                        status: {
                          id: 'st-1',
                          codigo: 'ANDAMENTO',
                          nome: 'Andamento',
                          finaliza: false,
                        },
                      },
                      error: null,
                    })
                  },
                }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: {
                        id: 'sol-desistencia-dono-1',
                        chave_idempotencia: '11111111-1111-4111-8111-111111111130',
                        email_status: 'pendente',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (upd: any) => {
                solicitacaoUpdatedWith = upd
                return {
                  eq: () => ({
                    select: () =>
                      Promise.resolve({
                        data: [{ id: 'sol-desistencia-dono-1' }],
                        error: null,
                      }),
                    then: (resolve: any) =>
                      resolve({
                        data: [{ id: 'sol-desistencia-dono-1' }],
                        error: null,
                      }),
                  }),
                }
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
              insert: (row: any) => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-desistencia-dono-1',
                        owner_token: row.owner_token,
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (upd: any) => {
                eventoUpdatedWith = upd
                const chain: any = {
                  eq: () => chain,
                  select: () =>
                    Promise.resolve({
                      data: [{ id: 'evt-desistencia-dono-1' }],
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

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer token-op', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar perícia',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste desistência',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111130',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.reason).toBe('caso_arquivado')
      expect(data.email_status).toBe('cancelado')
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.notificacao_aceita_smtp).toBe(false)

      // Evento foi marcado como error
      expect(eventoUpdatedWith).toEqual(
        expect.objectContaining({
          status: 'error',
          erro: expect.stringContaining('o caso não está mais aberto'),
        }),
      )
      // Solicitação foi marcada como cancelado
      expect(solicitacaoUpdatedWith).toEqual(
        expect.objectContaining({
          email_status: 'cancelado',
        }),
      )
      // Nenhum e-mail enviado
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })

    it('cenário owner_token diferente / concorrente: outra requisição assumiu o evento, auxiliar devolve false, resposta é 409 sem alterar evento nem solicitação', async () => {
      let solicitacaoUpdateTentado = false
      let eventoUpdateChamado = false

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
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'cus-admin-elegivel',
                    ativo: true,
                    core_usuarios: {
                      id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
                      nome: 'Daniel Adensohn',
                      email: 'daniel.adensohn@riccipi.com.br',
                      ativo: true,
                      adiamento: true,
                    },
                    core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                    core_perfis: { codigo: 'ADMINISTRADOR', ativo: true },
                  },
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({
                  data: [
                    {
                      id: 'cus-op',
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
          if (table === 'task_tarefas') {
            let callCount = 0
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => {
                    callCount++
                    return Promise.resolve({
                      data: {
                        id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
                        numero_caso: 521,
                        identificacao_caso: 'Caso Arquivado Concorrente',
                        prazo_conclusao: '2026-05-15',
                        executor_core_usuario_id: 'cu-op-1',
                        responsavel_core_usuario_id: 'cu-resp-1',
                        deleted_at: null,
                        arquivado_at: callCount > 1 ? '2026-05-10T12:00:00Z' : null,
                        status: {
                          id: 'st-1',
                          codigo: 'ANDAMENTO',
                          nome: 'Andamento',
                          finaliza: false,
                        },
                      },
                      error: null,
                    })
                  },
                }),
              }),
            }
          }
          if (table === 'task_solicitacoes_adiamento') {
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
                      data: {
                        id: 'sol-desistencia-concorrente-1',
                        chave_idempotencia: '11111111-1111-4111-8111-111111111131',
                        email_status: 'pendente',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (upd: any) => {
                if (upd.email_status === 'cancelado' || upd.email_status === 'falhou') {
                  solicitacaoUpdateTentado = true
                }
                return {
                  eq: () => ({
                    select: () =>
                      Promise.resolve({
                        data: [{ id: 'sol-desistencia-concorrente-1' }],
                        error: null,
                      }),
                    then: (resolve: any) => resolve({ data: [], error: null }),
                  }),
                }
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
              insert: (row: any) => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'evt-desistencia-concorrente-1',
                        owner_token: row.owner_token,
                        status: 'pending',
                      },
                      error: null,
                    }),
                }),
              }),
              update: (upd: any) => {
                eventoUpdateChamado = true
                // Simula que owner_token já pertence a outra requisição ou status já mudou:
                // Retorna 0 linhas afetadas para update filtrando por owner_token e status pending!
                const chain: any = {
                  eq: () => chain,
                  select: () => Promise.resolve({ data: [], error: null }),
                }
                return chain
              },
            }
          }
          return {}
        }),
      }

      const req = new Request('https://edge.local/solicitacao-adiamento', {
        method: 'POST',
        headers: { Authorization: 'Bearer token-op', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: 'solicitar_adiamento',
          tarefa_id: '38cb3c4d-7198-40a3-8815-a8881a9f506b',
          providencia_texto: 'Aguardar perícia',
          administrador_core_usuario_id: '402b0f6f-3aff-4548-b4f7-3d96d35a134f',
          motivo: 'Motivo teste desistência concorrente',
          prazo_solicitado: '2026-05-25',
          chave_idempotencia: '11111111-1111-4111-8111-111111111131',
        }),
      })

      const res = await handleSolicitacao(req, ctx)
      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.success).toBe(false)
      expect(data.solicitacao_registrada).toBe(true)
      expect(data.email_status).toBe('enviando')
      expect(data.notificacao_aceita_smtp).toBe(false)
      expect(data.solicitacao_id).toBe('sol-desistencia-concorrente-1')
      expect(data.chave_idempotencia).toBe('11111111-1111-4111-8111-111111111131')
      expect(data.message).toBe(
        'Solicitação registrada, porém não foi possível confirmar o estado do envio (outra requisição assumiu o envio ou houve falha de persistência). Nenhum e-mail foi enviado por esta requisição.',
      )

      // Verificação: update em evento foi tentado (mas retornou 0 linhas), e solicitação NÃO foi alterada para cancelado/falhou
      expect(eventoUpdateChamado).toBe(true)
      expect(solicitacaoUpdateTentado).toBe(false)
      expect(ctx.transporter.sendMail).not.toHaveBeenCalled()
    })
  })
})
