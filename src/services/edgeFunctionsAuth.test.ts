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
  const { data: userData, error: userError } = await ctx.supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
      status: 401,
      headers: corsHeaders,
    })
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

  if (!tarefa.executor_usuario_id) {
    return new Response(
      JSON.stringify({ triggered: true, sent: false, reason: 'executor_ausente' }),
      { status: 200, headers: corsHeaders },
    )
  }

  const execResolution = await resolveValidatedTaskUserEmailDetailed(
    ctx.supabase,
    tarefa.executor_usuario_id,
  )

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
  if (tarefa.responsavel_usuario_id) {
    const respResolution = await resolveValidatedTaskUserEmailDetailed(
      ctx.supabase,
      tarefa.responsavel_usuario_id,
    )
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

  const tarefaSaveStamp = tarefa.updated_at || tarefa.created_at || 'sem_stamp'
  const currentExecId = tarefa.executor_usuario_id || 'sem_exec'
  const currentRespId = tarefa.responsavel_usuario_id || 'sem_resp'
  const eventKey = `atribuicao:${tarefa.id}:${tarefaSaveStamp}:${currentExecId}:${currentRespId}`

  // Verificar idempotência
  const { data: existingEvent } = await ctx.supabase
    .from('task_email_eventos')
    .select('id, status')
    .eq('event_key', eventKey)
    .maybeSingle()

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

  let eventoId = existingEvent?.id
  if (!existingEvent) {
    const { data: insertedEvent } = await ctx.supabase
      .from('task_email_eventos')
      .insert({
        tarefa_id: tarefa.id,
        tipo_evento: dbTipoEvento,
        event_key: eventKey,
        to_email: toEmail,
        cc_email: ccEmail,
        status: 'pending',
      })
      .select('id')
      .maybeSingle()
    eventoId = insertedEvent?.id
  }

  // Disparo SMTP
  try {
    await ctx.transporter.sendMail({
      from: '"Ricci Task" <nao-responder@riccitask.com.br>',
      to: toEmail,
      ...(ccEmail ? { cc: ccEmail } : {}),
      subject: `Nova atribuição Ricci Task [Caso ${tarefa.numero_caso}]`,
      text: 'Corpo da mensagem...',
    })

    if (eventoId) {
      await ctx.supabase
        .from('task_email_eventos')
        .update({ status: 'success', sent_at: new Date().toISOString() })
        .eq('id', eventoId)
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
    if (eventoId) {
      await ctx.supabase
        .from('task_email_eventos')
        .update({ status: 'error', erro: sendErr.message })
        .eq('id', eventoId)
    }
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
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
    const { data: existingEvent } = await ctx.supabase
      .from('task_email_eventos')
      .select('id, status')
      .eq('event_key', eventKey)
      .maybeSingle()

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

    const execResolution = await resolveValidatedTaskUserEmailDetailed(
      ctx.supabase,
      tarefa.executor_usuario_id,
    )

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
        error: execResolution.error,
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

    if (tarefa.responsavel_usuario_id) {
      const respResolution = await resolveValidatedTaskUserEmailDetailed(
        ctx.supabase,
        tarefa.responsavel_usuario_id,
      )
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
          error: respResolution.error,
        })
        totalErrors++
        continue
      }
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

    try {
      await ctx.transporter.sendMail({
        from: '"Ricci Task" <nao-responder@riccitask.com.br>',
        to: toEmail,
        ...(ccEmail ? { cc: ccEmail } : {}),
        subject: `Providência atrasada Ricci Task [Caso ${tarefa.numero_caso}]`,
        text: 'Corpo da mensagem...',
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
    it('1. Deduplicação TO/CC: quando Executor e Responsável têm o mesmo e-mail, TO recebe e CC fica vazio', async () => {
      // Configura mock do Supabase
      ctx.supabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-op' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
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
                        updated_at: '2025-05-10T12:00:00Z',
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: val,
                        core_usuario_id: val === 'tu-exec' ? 'cu-exec' : 'cu-resp',
                        nome: val === 'tu-exec' ? 'Executor Silva' : 'Responsavel Silva',
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
                  eq: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'link-1',
                        ativo: true,
                        core_usuarios: {
                          id: 'cu-same',
                          nome: 'Silva Mesmo Email',
                          email: 'mesmo.email@riccipi.com.br', // Mesmo e-mail para ambos!
                          ativo: true,
                        },
                        core_sistemas: { codigo: 'RICCI_TASK', ativo: true },
                        core_perfis: { codigo: 'COLABORADOR', ativo: true },
                      },
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
          tipo: 'nova_atribuicao',
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
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: val,
                        core_usuario_id: val === 'tu-exec-2' ? 'cu-exec-2' : 'cu-resp-2',
                        nome: val === 'tu-exec-2' ? 'Executor Dois' : 'Responsável Dois',
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
                        core_perfis: { codigo: 'COLABORADOR', ativo: true },
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
          tipo: 'nova_atribuicao',
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
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'tu-exec-timeout',
                        core_usuario_id: 'cu-timeout',
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
                  eq: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: '504 Gateway Timeout' },
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
          tarefa_id: 'tarefa-3',
          tipo: 'nova_atribuicao',
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
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: 'tu-exec-4', core_usuario_id: 'cu-4', ativo: true },
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
                        core_perfis: { codigo: 'COLABORADOR', ativo: true },
                      },
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
          tipo: 'nova_atribuicao',
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
                        executor_usuario_id:
                          val === 'tarefa-falha' ? 'tu-exec-falha' : 'tu-exec-sucesso',
                        responsavel_usuario_id: null,
                      },
                      error: null,
                    }),
                }),
              }),
            }
          }
          if (table === 'task_usuarios') {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: () => {
                    if (val === 'tu-exec-falha') {
                      // Dispara falha técnica
                      return Promise.resolve({
                        data: null,
                        error: { message: 'Connection pool exhausted' },
                      })
                    }
                    return Promise.resolve({
                      data: {
                        id: 'tu-exec-sucesso',
                        core_usuario_id: 'cu-sucesso',
                        nome: 'Sucesso',
                        ativo: true,
                      },
                      error: null,
                    })
                  },
                }),
              }),
            }
          }
          if (table === 'core_usuario_sistemas') {
            return {
              select: () => {
                const chain: any = {
                  eq: () => chain,
                  maybeSingle: () =>
                    Promise.resolve({
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
                        core_perfis: { codigo: 'COLABORADOR', ativo: true },
                      },
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
  })
})
