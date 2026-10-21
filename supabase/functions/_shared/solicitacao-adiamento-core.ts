/**
 * supabase/functions/_shared/solicitacao-adiamento-core.ts
 *
 * Módulo puro e reutilizável para a Edge Function de Solicitação de Adiamento do Ricci Task:
 * 1. Operação 'listar_administradores': Lista administradores elegíveis (ativos, adiamento=true, RICCI_TASK ativo, ADMINISTRADOR ativo).
 * 2. Operação 'solicitar_adiamento': Registra a solicitação em `task_solicitacoes_adiamento` com validações rigorosas,
 *    adquire envio atômico em `task_email_eventos` (owner_token), dispara SMTP com rechecagens de segurança
 *    e trata idempotência e incerteza de rede/timeout.
 */

// @ts-ignore
import { SupabaseClient } from 'npm:@supabase/supabase-js@2'
// @ts-ignore
import nodemailer from 'npm:nodemailer'
import {
  checkTaskAccessScope,
  escapeHtml,
  SYSTEM_CODE_RICCI_TASK,
  ROLE_CODE_ADMINISTRADOR,
  verifyRicciTaskCaller,
} from './core-auth.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type',
}

export interface SolicitacaoAdiamentoDependencies {
  supabase: SupabaseClient
  transporter?: any
  getEnv?: (key: string) => string | undefined
}

export function isValidEmail(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false
  const trimmed = email.trim()
  // Deve conter exatamente um '@', não pode ter vírgula nem ponto-e-vírgula nem espaços
  if (/[,;\s]/.test(trimmed)) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

/**
 * Normaliza endereço de e-mail para comparação estrita e canônica.
 * - Aceita texto simples ("Daniel@RicciPI.com.br"), formato com nome ("\"Nome\" <email>") e objeto ({ address: 'email' })
 * - Remove espaços, extrai o conteúdo entre < e > quando houver e converte para minúsculas
 * - Para valores vazios, inválidos ou sem formato reconhecido, devolve texto vazio ('')
 */
export function normalizarEmail(val?: any): string {
  if (val == null) return ''
  let raw: string = ''
  if (typeof val === 'string') {
    raw = val
  } else if (typeof val === 'object' && val !== null) {
    if (typeof (val as any).address === 'string') {
      raw = (val as any).address
    } else {
      return ''
    }
  } else {
    return ''
  }

  const trimmed = raw.trim()
  if (!trimmed) return ''

  // Se contiver delimitadores de ângulo <...>, extrai o que estiver dentro
  const angleMatch = /<([^>]+)>/.exec(trimmed)
  const candidate = angleMatch ? angleMatch[1] : trimmed

  // Remove aspas restantes e espaços em branco ao redor
  const cleaned = candidate.replace(/["']/g, '').trim().toLowerCase()
  return cleaned
}

export interface AdministradorElegivel {
  id: string
  nome: string
  email: string
}

/**
 * Valida formato estrito de data YYYY-MM-DD
 */
export function isValidDateStr(val?: string | null): boolean {
  if (!val || typeof val !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim())
  if (!match) return false
  const y = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const d = parseInt(match[3], 10)
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * Valida se é um UUID v4 ou formato canônico válido
 */
export function isValidUUID(uuidStr?: string | null): boolean {
  if (!uuidStr || typeof uuidStr !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuidStr.trim())
}

/**
 * Formata data ISO/YYYY-MM-DD para DD/MM/YYYY
 */
export function formatDateBR(dateString?: string | null): string {
  if (!dateString) return ''
  try {
    const clean = dateString.split('T')[0]
    const parts = clean.split('-')
    if (parts.length === 3) {
      const [year, month, day] = parts
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`
    }
    const d = new Date(dateString)
    return d.toLocaleDateString('pt-BR')
  } catch {
    return dateString
  }
}

/**
 * Consulta administradores elegíveis a receber solicitações de adiamento no Ricci Task.
 * Regra de Elegibilidade:
 * - core_usuarios.ativo = true
 * - core_usuarios.adiamento = true
 * - core_usuarios.email válido
 * - core_usuario_sistemas.ativo = true
 * - core_sistemas.codigo = 'RICCI_TASK' AND core_sistemas.ativo = true
 * - core_perfis.codigo = 'ADMINISTRADOR' AND core_perfis.ativo = true
 */
export async function listarAdministradoresElegiveis(
  supabase: SupabaseClient,
): Promise<{ success: boolean; administradores: AdministradorElegivel[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('core_usuario_sistemas')
      .select(`
        id,
        ativo,
        core_usuarios!inner(id, nome, email, ativo, adiamento),
        core_sistemas!inner(id, codigo, ativo),
        core_perfis!inner(id, codigo, ativo)
      `)
      .eq('ativo', true)
      .eq('core_usuarios.ativo', true)
      .eq('core_usuarios.adiamento', true)
      .eq('core_sistemas.codigo', SYSTEM_CODE_RICCI_TASK)
      .eq('core_sistemas.ativo', true)
      .eq('core_perfis.codigo', ROLE_CODE_ADMINISTRADOR)
      .eq('core_perfis.ativo', true)

    if (error) {
      console.error('[solicitacao-adiamento] Erro ao listar administradores elegíveis:', error)
      return {
        success: false,
        administradores: [],
        error: `Falha técnica ao listar administradores elegíveis: ${error.message}`,
      }
    }

    const administradores: AdministradorElegivel[] = []
    const vistos = new Set<string>()

    if (Array.isArray(data)) {
      for (const row of data) {
        const u = (row as any).core_usuarios
        if (!u || !u.id || !u.email) continue
        const emailTrimmed = String(u.email).trim().toLowerCase()
        if (!emailTrimmed) continue
        if (!vistos.has(u.id)) {
          vistos.add(u.id)
          administradores.push({
            id: u.id,
            nome: (u.nome || '').trim(),
            email: emailTrimmed,
          })
        }
      }
    }

    // Ordena por nome
    administradores.sort((a, b) => a.nome.localeCompare(b.nome))

    return {
      success: true,
      administradores,
    }
  } catch (err: any) {
    console.error('[solicitacao-adiamento] Exceção ao listar administradores elegíveis:', err)
    return {
      success: false,
      administradores: [],
      error: err?.message || 'Falha técnica ao listar administradores elegíveis.',
    }
  }
}

/**
 * Validação central e autoritativa de um administrador elegível específico por core_usuario_id.
 * Garante que o destinatário seja resolvido no servidor e não pelo cliente.
 */
export async function getValidatedEligibleAdmin(
  supabase: SupabaseClient,
  administradorCoreId: string,
): Promise<{
  valid: boolean
  admin: AdministradorElegivel | null
  error?: string
  status?: number
}> {
  if (!administradorCoreId || !isValidUUID(administradorCoreId)) {
    return {
      valid: false,
      admin: null,
      error: 'ID de administrador inválido ou não informado.',
      status: 400,
    }
  }

  try {
    const { data, error } = await supabase
      .from('core_usuario_sistemas')
      .select(`
        id,
        ativo,
        core_usuarios!inner(id, nome, email, ativo, adiamento),
        core_sistemas!inner(id, codigo, ativo),
        core_perfis!inner(id, codigo, ativo)
      `)
      .eq('usuario_id', administradorCoreId)
      .eq('ativo', true)
      .eq('core_usuarios.ativo', true)
      .eq('core_usuarios.adiamento', true)
      .eq('core_sistemas.codigo', SYSTEM_CODE_RICCI_TASK)
      .eq('core_sistemas.ativo', true)
      .eq('core_perfis.codigo', ROLE_CODE_ADMINISTRADOR)
      .eq('core_perfis.ativo', true)
      .maybeSingle()

    if (error) {
      console.error('[solicitacao-adiamento] Erro de banco ao validar administrador:', error)
      return {
        valid: false,
        admin: null,
        error: 'Falha técnica ao validar administrador elegível.',
        status: 500,
      }
    }

    if (!data) {
      return {
        valid: false,
        admin: null,
        error:
          'Administrador selecionado não é elegível para receber solicitações de adiamento (inativo, sem permissão de adiamento ou perfil incompatível).',
        status: 422,
      }
    }

    const u = (data as any).core_usuarios
    const emailTrimmed = String(u.email || '')
      .trim()
      .toLowerCase()
    if (!emailTrimmed) {
      return {
        valid: false,
        admin: null,
        error: 'Administrador não possui e-mail cadastrado.',
        status: 422,
      }
    }

    return {
      valid: true,
      admin: {
        id: u.id,
        nome: (u.nome || '').trim(),
        email: emailTrimmed,
      },
      status: 200,
    }
  } catch (err: any) {
    console.error('[solicitacao-adiamento] Exceção ao validar administrador:', err)
    return {
      valid: false,
      admin: null,
      error: 'Falha técnica ao validar administrador elegível.',
      status: 500,
    }
  }
}

/**
 * Processador principal da Edge Function solicitacao-adiamento
 */
export async function processSolicitacaoAdiamento(
  req: Request,
  deps: SolicitacaoAdiamentoDependencies,
): Promise<Response> {
  const { supabase } = deps

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Token de autenticação não encontrado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'Token de autenticação não encontrado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // 1. Validação de autenticação
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Validação central do chamador no Gestor de Acessos Ricci
    const callerCheck = await verifyRicciTaskCaller(supabase, user.id)
    if (!callerCheck.allowed || !callerCheck.coreUser || !callerCheck.perfil) {
      return new Response(
        JSON.stringify({
          error:
            callerCheck.error ||
            'Permissão negada: usuário sem permissão ativa para o sistema Ricci Task.',
        }),
        {
          status:
            callerCheck.httpStatus || (callerCheck.status === 'technical_failure' ? 500 : 403),
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const solicitanteCoreUser = callerCheck.coreUser
    const callerPerfil = callerCheck.perfil

    // 3. Determinar operação solicitada
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const operacao = (
      body.operacao || (req.method === 'GET' ? 'listar_administradores' : 'solicitar_adiamento')
    ).trim()

    // -------------------------------------------------------------------------
    // OPERAÇÃO 1: Listar administradores elegíveis
    // -------------------------------------------------------------------------
    if (operacao === 'listar_administradores') {
      const listResult = await listarAdministradoresElegiveis(supabase)
      if (!listResult.success) {
        return new Response(JSON.stringify({ error: listResult.error }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ administradores: listResult.administradores }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // -------------------------------------------------------------------------
    // OPERAÇÃO 2: Registrar e enviar solicitação de adiamento
    // -------------------------------------------------------------------------
    if (operacao !== 'solicitar_adiamento') {
      return new Response(
        JSON.stringify({
          error: `Operação inválida. Valores aceitos: 'listar_administradores', 'solicitar_adiamento'`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const {
      tarefa_id,
      providencia_id,
      administrador_core_usuario_id,
      motivo,
      prazo_solicitado,
      providencia_texto,
      chave_idempotencia,
    } = body

    // 4. Validação rigorosa de tipos e parâmetros antes de manipulações de string
    if (tarefa_id == null || typeof tarefa_id !== 'string' || !isValidUUID(tarefa_id)) {
      return new Response(
        JSON.stringify({ error: 'Parâmetro tarefa_id é obrigatório e deve ser um UUID válido.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (
      administrador_core_usuario_id == null ||
      typeof administrador_core_usuario_id !== 'string' ||
      !isValidUUID(administrador_core_usuario_id)
    ) {
      return new Response(
        JSON.stringify({
          error: 'Parâmetro administrador_core_usuario_id é obrigatório e deve ser um UUID válido.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (
      chave_idempotencia == null ||
      typeof chave_idempotencia !== 'string' ||
      !isValidUUID(chave_idempotencia)
    ) {
      return new Response(
        JSON.stringify({
          error: 'Parâmetro chave_idempotencia é obrigatório e deve ser um UUID válido.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Validação de tipo e conteúdo de motivo
    if (motivo == null || typeof motivo !== 'string') {
      return new Response(
        JSON.stringify({ error: 'O motivo da solicitação é obrigatório e deve ser um texto.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }
    const motivoTrimmed = motivo.trim()
    if (!motivoTrimmed) {
      return new Response(JSON.stringify({ error: 'O motivo da solicitação é obrigatório.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (motivoTrimmed.length > 200) {
      return new Response(
        JSON.stringify({ error: 'O motivo da solicitação deve ter no máximo 200 caracteres.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Validação da data solicitada
    if (prazo_solicitado == null || typeof prazo_solicitado !== 'string') {
      return new Response(
        JSON.stringify({
          error: 'Parâmetro prazo_solicitado inválido. Deve ser uma string no formato YYYY-MM-DD.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }
    const prazoSolicitadoTrimmed = prazo_solicitado.trim()
    if (!isValidDateStr(prazoSolicitadoTrimmed)) {
      return new Response(
        JSON.stringify({
          error: 'Parâmetro prazo_solicitado inválido. Deve estar no formato YYYY-MM-DD.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 5. Consulta do caso (tarefa) no banco com relacionamento de status e nome do controle
    const { data: tarefa, error: tarefaError } = await supabase
      .from('task_tarefas')
      .select(`
        id,
        numero_caso,
        identificacao_caso,
        pasta_cliente,
        pasta_ricci,
        prazo_conclusao,
        nome_controle_id,
        status_id,
        arquivado_at,
        deleted_at,
        executor_core_usuario_id,
        responsavel_core_usuario_id,
        executor_usuario_id,
        responsavel_usuario_id,
        created_at,
        updated_at,
        nome_controle:task_nomes_controle(nome),
        status:task_status(id, codigo, nome, finaliza)
      `)
      .eq('id', tarefa_id)
      .maybeSingle()

    if (tarefaError) {
      console.error('[solicitacao-adiamento] Erro ao consultar task_tarefas:', tarefaError)
      return new Response(
        JSON.stringify({ error: `Falha técnica ao consultar caso: ${tarefaError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!tarefa) {
      return new Response(JSON.stringify({ error: 'Caso não encontrado.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Bloqueios de caso excluído, arquivado ou encerrado
    if (tarefa.deleted_at) {
      return new Response(
        JSON.stringify({
          error: 'Solicitação não permitida: o caso está excluído.',
          reason: 'caso_excluido',
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (tarefa.arquivado_at) {
      return new Response(
        JSON.stringify({
          error: 'Solicitação não permitida: o caso está arquivado.',
          reason: 'caso_arquivado',
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const isStatusFinaliza = Boolean((tarefa as any).status?.finaliza)
    if (isStatusFinaliza) {
      return new Response(
        JSON.stringify({
          error: 'Solicitação não permitida: o caso está com status encerrado/finalizado.',
          reason: 'caso_encerrado',
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 6. Validação estrita de escopo de acesso do solicitante ao caso
    const scopeCheck = await checkTaskAccessScope(
      supabase,
      solicitanteCoreUser,
      callerPerfil,
      tarefa,
    )

    if (!scopeCheck.allowed) {
      return new Response(
        JSON.stringify({
          error:
            scopeCheck.error ||
            'Permissão negada: você não possui acesso a este caso para solicitar adiamento.',
        }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 7. Validação da data solicitada em relação ao prazo_conclusao do caso
    // Prazo do caso deve existir para adiamento
    if (!tarefa.prazo_conclusao) {
      return new Response(
        JSON.stringify({
          error:
            'O caso não possui prazo de conclusão definido. Não é possível solicitar adiamento.',
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const prazoCasoAtualStr = String(tarefa.prazo_conclusao).split('T')[0]
    // Comparação de datas de calendário YYYY-MM-DD (prazo_solicitado > prazo_caso_atual)
    if (prazoSolicitadoTrimmed <= prazoCasoAtualStr) {
      return new Response(
        JSON.stringify({
          error: `A nova data solicitada (${formatDateBR(prazoSolicitadoTrimmed)}) deve ser posterior ao prazo de conclusão atual do caso (${formatDateBR(prazoCasoAtualStr)}).`,
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 8. Validação de providência
    let providenciaAlvo: any = null
    let textoProvidenciaFinal = ''

    if (providencia_id != null) {
      if (typeof providencia_id !== 'string' || !isValidUUID(providencia_id)) {
        return new Response(JSON.stringify({ error: 'Parâmetro providencia_id inválido.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: provData, error: provError } = await supabase
        .from('task_providencias')
        .select('id, tarefa_id, providencia, prazo_conclusao, deleted_at')
        .eq('id', providencia_id)
        .maybeSingle()

      if (provError) {
        console.error('[solicitacao-adiamento] Erro ao consultar providência:', provError)
        return new Response(
          JSON.stringify({ error: `Falha técnica ao consultar providência: ${provError.message}` }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (!provData) {
        return new Response(
          JSON.stringify({ error: 'Providência informada não foi encontrada.' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (provData.tarefa_id !== tarefa.id) {
        return new Response(
          JSON.stringify({ error: 'A providência informada não pertence a este caso.' }),
          {
            status: 422,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (provData.deleted_at) {
        return new Response(JSON.stringify({ error: 'A providência informada está excluída.' }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      providenciaAlvo = provData
      textoProvidenciaFinal = (provData.providencia || '').trim()
    } else {
      // Providência nova em caso existente: providencia_id nulo, texto pretendido obrigatório
      const textoInformado = typeof providencia_texto === 'string' ? providencia_texto.trim() : ''
      if (!textoInformado) {
        return new Response(
          JSON.stringify({
            error: 'Para nova providência sem ID cadastrado, o texto da providência é obrigatório.',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
      textoProvidenciaFinal = textoInformado
    }

    if (!textoProvidenciaFinal) {
      return new Response(
        JSON.stringify({ error: 'O texto descritivo da providência não pode ser vazio.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 9. Validação do administrador destinatário (resolvido estritamente no servidor)
    const adminCheck = await getValidatedEligibleAdmin(supabase, administrador_core_usuario_id)
    if (!adminCheck.valid || !adminCheck.admin) {
      return new Response(
        JSON.stringify({
          error: adminCheck.error || 'Administrador selecionado não é elegível.',
        }),
        {
          status: adminCheck.status || 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const destinatarioAdmin = adminCheck.admin

    // 10. Tratamento de Idempotência em task_solicitacoes_adiamento
    // Verifica se já existe um registro com a mesma chave_idempotencia
    const { data: existingSolicitacao, error: checkSolError } = await supabase
      .from('task_solicitacoes_adiamento')
      .select(`
        id,
        tarefa_id,
        providencia_id,
        solicitante_core_usuario_id,
        administrador_core_usuario_id,
        providencia_texto,
        motivo,
        prazo_caso_atual,
        prazo_solicitado,
        chave_idempotencia,
        email_status,
        email_enviado_at,
        created_at
      `)
      .eq('chave_idempotencia', chave_idempotencia)
      .maybeSingle()

    if (checkSolError) {
      console.error(
        '[solicitacao-adiamento] Erro ao consultar chave de idempotência:',
        checkSolError,
      )
      return new Response(
        JSON.stringify({ error: 'Falha técnica ao verificar registro de solicitação.' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    let solicitacaoId: string
    let activeSolicitacaoRecord: any = existingSolicitacao
    let isExistingOrWinner = Boolean(existingSolicitacao)

    const validatePayloadMatchesRecord = (record: any): boolean => {
      const matchTarefa = record.tarefa_id === tarefa.id
      const matchProv = (record.providencia_id || null) === (providenciaAlvo?.id || null)
      const matchAdmin = record.administrador_core_usuario_id === destinatarioAdmin.id
      const matchSolicitante = record.solicitante_core_usuario_id === solicitanteCoreUser.id
      const matchMotivo = record.motivo === motivoTrimmed
      const matchPrazoSolicitado =
        String(record.prazo_solicitado).split('T')[0] === prazoSolicitadoTrimmed
      const matchProvTexto = record.providencia_texto.trim() === textoProvidenciaFinal
      return (
        matchTarefa &&
        matchProv &&
        matchAdmin &&
        matchSolicitante &&
        matchMotivo &&
        matchPrazoSolicitado &&
        matchProvTexto
      )
    }

    if (!activeSolicitacaoRecord) {
      // Inserir registro em task_solicitacoes_adiamento ANTES do envio SMTP
      const { data: insertedSolicitacao, error: insertError } = await supabase
        .from('task_solicitacoes_adiamento')
        .insert({
          tarefa_id: tarefa.id,
          providencia_id: providenciaAlvo ? providenciaAlvo.id : null,
          solicitante_core_usuario_id: solicitanteCoreUser.id,
          administrador_core_usuario_id: destinatarioAdmin.id,
          providencia_texto: textoProvidenciaFinal,
          motivo: motivoTrimmed,
          prazo_caso_atual: prazoCasoAtualStr,
          prazo_solicitado: prazoSolicitadoTrimmed,
          chave_idempotencia,
          email_status: 'pendente',
          email_enviado_at: null,
        })
        .select(`
          id,
          tarefa_id,
          providencia_id,
          solicitante_core_usuario_id,
          administrador_core_usuario_id,
          providencia_texto,
          motivo,
          prazo_caso_atual,
          prazo_solicitado,
          chave_idempotencia,
          email_status,
          email_enviado_at,
          created_at
        `)
        .maybeSingle()

      if (insertError) {
        if (insertError.code === '23505' || insertError.message?.includes('23505')) {
          // Conflito 23505: releia e compare o registro vencedor
          const { data: winnerRecord, error: rereadErr } = await supabase
            .from('task_solicitacoes_adiamento')
            .select(`
              id,
              tarefa_id,
              providencia_id,
              solicitante_core_usuario_id,
              administrador_core_usuario_id,
              providencia_texto,
              motivo,
              prazo_caso_atual,
              prazo_solicitado,
              chave_idempotencia,
              email_status,
              email_enviado_at,
              created_at
            `)
            .eq('chave_idempotencia', chave_idempotencia)
            .maybeSingle()

          if (rereadErr || !winnerRecord) {
            return new Response(
              JSON.stringify({
                error: 'Concorrência detectada: chave de idempotência já registrada.',
              }),
              {
                status: 409,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              },
            )
          }

          activeSolicitacaoRecord = winnerRecord
          isExistingOrWinner = true
        } else {
          console.error('[solicitacao-adiamento] Erro ao inserir solicitação:', insertError)
          return new Response(
            JSON.stringify({
              error: `Falha técnica ao registrar solicitação de adiamento: ${insertError.message}`,
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
      } else {
        if (!insertedSolicitacao) {
          return new Response(
            JSON.stringify({ error: 'Falha técnica ao confirmar gravação da solicitação.' }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        activeSolicitacaoRecord = insertedSolicitacao
        solicitacaoId = insertedSolicitacao.id
      }
    }

    if (!solicitacaoId!) {
      solicitacaoId = activeSolicitacaoRecord.id
    }

    // Se já existia ou foi recuperado de concorrência 23505: valida conteúdo original
    if (isExistingOrWinner && activeSolicitacaoRecord) {
      if (!validatePayloadMatchesRecord(activeSolicitacaoRecord)) {
        return new Response(
          JSON.stringify({
            error:
              'A chave de idempotência informada já foi utilizada para uma solicitação com parâmetros diferentes. Operação rejeitada.',
          }),
          {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (activeSolicitacaoRecord.email_status === 'enviado') {
        return new Response(
          JSON.stringify({
            success: true,
            solicitacao_registrada: true,
            email_status: 'enviado',
            notificacao_aceita_smtp: true,
            message: 'Solicitação de adiamento já registrada e notificação enviada anteriormente.',
            solicitacao_id: solicitacaoId,
            chave_idempotencia,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (activeSolicitacaoRecord.email_status === 'incerto') {
        return new Response(
          JSON.stringify({
            success: true,
            solicitacao_registrada: true,
            email_status: 'incerto',
            notificacao_aceita_smtp: false,
            message:
              'Solicitação de adiamento já registrada, porém o envio anterior do e-mail teve resultado incerto (timeout/rede). Reenvio automático bloqueado para evitar duplicidade.',
            solicitacao_id: solicitacaoId,
            chave_idempotencia,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    }

    // 11. Controle Atômico de Envio em task_email_eventos (owner_token + aquisição de lock)
    const callOwnerToken = crypto.randomUUID()
    const eventKey = `adiamento:${solicitacaoId}`
    const nowIso = new Date().toISOString()
    const lockCutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    let acquiredEvent: any = null

    // Consulta evento existente
    const { data: existingEvent, error: checkEventError } = await supabase
      .from('task_email_eventos')
      .select('id, event_key, status, sent_at, locked_at, owner_token')
      .eq('event_key', eventKey)
      .maybeSingle()

    if (checkEventError) {
      console.error(
        '[solicitacao-adiamento] Erro ao consultar task_email_eventos:',
        checkEventError,
      )
      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          error: 'Falha técnica ao verificar idempotência de envio no servidor.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (existingEvent && existingEvent.status === 'success') {
      // Atualiza status na solicitação se ainda não estiver como enviado
      await supabase
        .from('task_solicitacoes_adiamento')
        .update({
          email_status: 'enviado',
          email_enviado_at: existingEvent.sent_at || nowIso,
        })
        .eq('id', solicitacaoId)

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'enviado',
          notificacao_aceita_smtp: true,
          message: 'Notificação já enviada anteriormente para esta solicitação.',
          solicitacao_id: solicitacaoId,
          chave_idempotencia,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Bloqueio de status incertos prévios
    if (
      existingEvent &&
      (existingEvent.status === 'uncertain' ||
        existingEvent.status === 'pending_reconciliation' ||
        existingEvent.status === 'smtp_maybe_sent')
    ) {
      await supabase
        .from('task_solicitacoes_adiamento')
        .update({ email_status: 'incerto' })
        .eq('id', solicitacaoId)

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'incerto',
          notificacao_aceita_smtp: false,
          message:
            'O status de envio deste e-mail está incerto e aguarda reconciliação. Reenvio automático bloqueado.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!existingEvent) {
      const { data: insertedEvent, error: insertEventError } = await supabase
        .from('task_email_eventos')
        .insert({
          tarefa_id: tarefa.id,
          providencia_id: providenciaAlvo ? providenciaAlvo.id : null,
          tipo_evento: 'alteracao_atribuicao', // Utiliza check constraint existente
          event_key: eventKey,
          to_email: destinatarioAdmin.email,
          cc_email: solicitanteCoreUser.email,
          status: 'pending',
          owner_token: callOwnerToken,
          locked_at: nowIso,
          data_referencia: nowIso.split('T')[0],
        })
        .select('id, owner_token, status')
        .maybeSingle()

      if (insertEventError) {
        if (insertEventError.code === '23505' || insertEventError.message?.includes('23505')) {
          // Concorrência no insert: tenta adquirir lock atômico se estiver em 'error'
          const { data: raceAcquired } = await supabase
            .from('task_email_eventos')
            .update({
              status: 'pending',
              owner_token: callOwnerToken,
              locked_at: nowIso,
            })
            .eq('event_key', eventKey)
            .in('status', ['error'])
            .select('id, owner_token, status')
            .maybeSingle()

          if (!raceAcquired) {
            return new Response(
              JSON.stringify({
                success: true,
                solicitacao_registrada: true,
                email_status: 'enviando',
                notificacao_aceita_smtp: false,
                message: 'Envio simultâneo em andamento por outro processo.',
                solicitacao_id: solicitacaoId,
              }),
              {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              },
            )
          }
          acquiredEvent = raceAcquired
        } else {
          console.error(
            '[solicitacao-adiamento] Erro ao registrar task_email_eventos:',
            insertEventError,
          )
          return new Response(
            JSON.stringify({
              success: true,
              solicitacao_registrada: true,
              email_status: 'falhou',
              notificacao_aceita_smtp: false,
              error: 'Falha técnica ao iniciar controle de envio atômico.',
              solicitacao_id: solicitacaoId,
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
      } else {
        acquiredEvent = insertedEvent
      }
    } else {
      // Tentativa de lock atômico em evento existente
      const { data: updatedRows, error: updateLockErr } = await supabase
        .from('task_email_eventos')
        .update({
          status: 'pending',
          owner_token: callOwnerToken,
          locked_at: nowIso,
        })
        .eq('id', existingEvent.id)
        .neq('status', 'success')
        .neq('status', 'uncertain')
        .neq('status', 'pending_reconciliation')
        .neq('status', 'smtp_maybe_sent')
        .or(`status.eq.error,locked_at.is.null,locked_at.lt.${lockCutoffIso}`)
        .select('id, owner_token, status')

      if (updateLockErr || !updatedRows || updatedRows.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            solicitacao_registrada: true,
            email_status: 'enviando',
            notificacao_aceita_smtp: false,
            message:
              'O envio já foi adquirido por outra requisição simultânea ou está em processamento.',
            solicitacao_id: solicitacaoId,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      acquiredEvent = updatedRows[0]
    }

    if (!acquiredEvent || acquiredEvent.owner_token !== callOwnerToken) {
      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'enviando',
          notificacao_aceita_smtp: false,
          message: 'Falha ao adquirir exclusividade para envio do e-mail.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const eventoId = acquiredEvent.id

    // Auxiliar atômico para desistência sem envio
    const encerrarEventoSemEnvio = async (
      erro: string,
      statusSolicitacao: 'falhou' | 'cancelado',
    ): Promise<boolean> => {
      try {
        const { data: updatedEvtRows, error: evtErr } = await supabase
          .from('task_email_eventos')
          .update({
            status: 'error',
            erro,
          })
          .eq('id', eventoId)
          .eq('owner_token', callOwnerToken)
          .eq('status', 'pending')
          .select('id')

        if (evtErr || !updatedEvtRows || updatedEvtRows.length === 0) {
          return false
        }

        const { data: updatedSolRows, error: solErr } = await supabase
          .from('task_solicitacoes_adiamento')
          .update({ email_status: statusSolicitacao })
          .eq('id', solicitacaoId)
          .select('id')

        if (solErr || !updatedSolRows || updatedSolRows.length === 0) {
          return false
        }

        return true
      } catch (err: any) {
        console.error('[solicitacao-adiamento] Exceção em encerrarEventoSemEnvio:', err)
        return false
      }
    }

    const respostaConflitoDesistencia = (): Response => {
      return new Response(
        JSON.stringify({
          success: false,
          solicitacao_registrada: true,
          email_status: 'enviando',
          notificacao_aceita_smtp: false,
          solicitacao_id: solicitacaoId,
          chave_idempotencia,
          message:
            'Solicitação registrada, porém não foi possível confirmar o estado do envio (outra requisição assumiu o envio ou houve falha de persistência). Nenhum e-mail foi enviado por esta requisição.',
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Atualiza estado da solicitação para 'enviando'
    const { data: enviandoSolRows, error: enviandoSolErr } = await supabase
      .from('task_solicitacoes_adiamento')
      .update({ email_status: 'enviando' })
      .eq('id', solicitacaoId)
      .select('id')

    if (enviandoSolErr || !enviandoSolRows || enviandoSolRows.length === 0) {
      console.error(
        '[solicitacao-adiamento] Falha ao marcar solicitação como enviando:',
        enviandoSolErr,
      )
      await supabase
        .from('task_email_eventos')
        .update({
          status: 'error',
          erro: 'Falha ao preparar envio: não foi possível registrar estado enviando na solicitação.',
        })
        .eq('id', eventoId)
        .eq('owner_token', callOwnerToken)
        .eq('status', 'pending')

      return new Response(
        JSON.stringify({
          success: false,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          solicitacao_id: solicitacaoId,
          chave_idempotencia,
          message:
            'Solicitação registrada, porém houve falha técnica ao preparar o envio. Nenhum e-mail foi enviado; tente novamente.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 12 e 13. Obtenção assíncrona paralela (Promise.all):
    // - Configuração SMTP e secrets (somente se deps.transporter não for fornecido)
    // - Revalidação do solicitante (verifyRicciTaskCaller)
    // - Revalidação do administrador destinatário (getValidatedEligibleAdmin)
    // - Reconsulta do caso (task_tarefas)
    // - Reconsulta da providência (task_providencias, somente se existir providenciaAlvo)

    type SmtpResolution =
      | { kind: 'provided'; transporter: any; senderEmail: string; replyTo?: string }
      | { kind: 'error_setting'; error: string }
      | { kind: 'error_secret'; error: string }
      | { kind: 'ready'; transporter: any; senderEmail: string; replyTo?: string }

    const smtpTask = async (): Promise<SmtpResolution> => {
      if (deps.transporter) {
        return {
          kind: 'provided',
          transporter: deps.transporter,
          senderEmail: 'nao-responder@riccitask.com.br',
          replyTo: undefined,
        }
      }

      const { data: setting, error: settingError } = await supabase
        .from('email_settings')
        .select('*')
        .eq('active', true)
        .limit(1)
        .maybeSingle()

      if (settingError || !setting) {
        return {
          kind: 'error_setting',
          error: 'Nenhuma configuração de e-mail ativa encontrada.',
        }
      }

      const senderEmail = setting.sender_email
      const replyTo = setting.reply_to || undefined

      const { data: secretData, error: secretErr } = await supabase
        .from('email_secrets')
        .select('secret_value')
        .eq('setting_id', setting.id)
        .limit(1)
        .maybeSingle()

      const secret = secretData?.secret_value
      if (secretErr || !secret) {
        return {
          kind: 'error_secret',
          error: 'A senha do transporte SMTP não foi configurada.',
        }
      }

      const transporterOptions: any = {
        host: setting.smtp_host,
        port: setting.smtp_port,
        secure: setting.smtp_secure,
        auth: {
          user: setting.smtp_user,
          pass: secret,
        },
      }

      if (setting.smtp_host === 'smtp.office365.com') {
        transporterOptions.port = 587
        transporterOptions.secure = false
        transporterOptions.requireTLS = true
        transporterOptions.tls = { ciphers: 'SSLv3' }
      }

      const transporter = nodemailer.createTransport(transporterOptions)
      return {
        kind: 'ready',
        transporter,
        senderEmail,
        replyTo,
      }
    }

    const callerTask = verifyRicciTaskCaller(supabase, user.id)
    const adminTask = getValidatedEligibleAdmin(supabase, destinatarioAdmin.id)
    const tarefaTask = supabase
      .from('task_tarefas')
      .select(`
        id,
        numero_caso,
        identificacao_caso,
        pasta_cliente,
        pasta_ricci,
        prazo_conclusao,
        nome_controle_id,
        status_id,
        arquivado_at,
        deleted_at,
        executor_core_usuario_id,
        responsavel_core_usuario_id,
        executor_usuario_id,
        responsavel_usuario_id,
        nome_controle:task_nomes_controle(nome),
        status:task_status(id, codigo, nome, finaliza)
      `)
      .eq('id', tarefa.id)
      .maybeSingle()

    const providenciaTask = providenciaAlvo
      ? supabase
          .from('task_providencias')
          .select('id, tarefa_id, deleted_at, providencia')
          .eq('id', providenciaAlvo.id)
          .maybeSingle()
      : Promise.resolve(null)

    const [smtpResult, recheckCaller, recheckAdmin, tarefaQueryResult, providenciaQueryResult] =
      await Promise.all([smtpTask(), callerTask, adminTask, tarefaTask, providenciaTask])

    // Avaliação dos resultados na MESMA ordem estrita de hoje:
    // 1. Configuração SMTP
    // 2. Senha SMTP
    // 3. Solicitante
    // 4. Administrador
    // 5. E-mail válido
    // 6. Caso
    // 7. Status do caso
    // 8. Caso aberto (não excluído, não arquivado, não finalizado)
    // 9. Escopo (checkTaskAccessScope - executado aqui após termos solicitante e caso)
    // 10. Prazo
    // 11. Providência

    // 1. Configuração SMTP
    if (smtpResult.kind === 'error_setting') {
      const ok = await encerrarEventoSemEnvio(smtpResult.error, 'falhou')
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          error:
            'Solicitação registrada com sucesso, porém o envio de notificação falhou: nenhuma configuração de e-mail ativa encontrada.',
          solicitacao_id: solicitacaoId,
          chave_idempotencia,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 2. Senha SMTP
    if (smtpResult.kind === 'error_secret') {
      const ok = await encerrarEventoSemEnvio(smtpResult.error, 'falhou')
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          error:
            'Solicitação registrada com sucesso, porém o envio de notificação falhou: a senha do transporte SMTP não foi configurada.',
          solicitacao_id: solicitacaoId,
          chave_idempotencia,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const transporter = smtpResult.transporter
    const senderEmail = smtpResult.senderEmail
    const replyTo = smtpResult.replyTo

    // 3. Solicitante ativo e autorizado
    if (!recheckCaller.allowed || !recheckCaller.coreUser) {
      const ok = await encerrarEventoSemEnvio(
        'Solicitante perdeu autorização antes do despacho SMTP.',
        'cancelado',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'cancelado',
          notificacao_aceita_smtp: false,
          reason: 'solicitante_desautorizado',
          message:
            'Solicitação registrada, porém o envio do e-mail foi cancelado: o solicitante não possui mais autorização ativa.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }
    const solicitanteAtualizado = recheckCaller.coreUser

    // 4. Administrador elegível
    if (!recheckAdmin.valid || !recheckAdmin.admin) {
      const ok = await encerrarEventoSemEnvio(
        'Administrador perdeu a elegibilidade antes do disparo SMTP.',
        'cancelado',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'cancelado',
          notificacao_aceita_smtp: false,
          reason: 'administrador_inelegivel',
          message:
            'Solicitação registrada, porém o envio do e-mail foi cancelado: o administrador perdeu a elegibilidade antes do despacho.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }
    const adminAtualizado = recheckAdmin.admin

    // 5. E-mail válido
    if (!isValidEmail(adminAtualizado.email)) {
      const ok = await encerrarEventoSemEnvio(
        `Endereço de e-mail do destinatário inválido: ${adminAtualizado.email}`,
        'falhou',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          error: 'Endereço de e-mail do administrador destinatário é inválido.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 6. Caso (reconsulta pré-SMTP)
    const { data: preSmtpTarefa, error: preSmtpErr } = tarefaQueryResult
    if (preSmtpErr) {
      const ok = await encerrarEventoSemEnvio(
        `Falha técnica na reconsulta pré-SMTP: ${preSmtpErr.message}`,
        'falhou',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          error: 'Falha técnica ao verificar estado do caso antes do envio.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!preSmtpTarefa) {
      const ok = await encerrarEventoSemEnvio(
        'Caso não encontrado na verificação pré-SMTP.',
        'falhou',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          error: 'Caso não encontrado na verificação pré-SMTP.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 7. Status do caso
    const preSmtpStatusObj = Array.isArray(preSmtpTarefa.status)
      ? preSmtpTarefa.status[0]
      : preSmtpTarefa.status

    if (!preSmtpStatusObj) {
      const ok = await encerrarEventoSemEnvio(
        'Status ausente do caso na verificação pré-SMTP.',
        'falhou',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          error: 'Status ausente ou corrompido no caso antes do envio.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 8. Caso aberto (não excluído, não arquivado, não finalizado)
    const isPreFinaliza = Boolean(preSmtpStatusObj.finaliza)
    if (preSmtpTarefa.deleted_at || preSmtpTarefa.arquivado_at || isPreFinaliza) {
      const ok = await encerrarEventoSemEnvio(
        'Envio cancelado: o caso não está mais aberto (excluído, arquivado ou finalizado).',
        'cancelado',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'cancelado',
          notificacao_aceita_smtp: false,
          reason: preSmtpTarefa.deleted_at
            ? 'caso_excluido'
            : preSmtpTarefa.arquivado_at
              ? 'caso_arquivado'
              : 'caso_encerrado',
          message:
            'Solicitação registrada, mas notificação cancelada pois o caso não está mais aberto.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 9. Escopo de acesso do solicitante ao caso (executado depois do Promise.all com solicitanteAtualizado e preSmtpTarefa)
    const preScopeCheck = await checkTaskAccessScope(
      supabase,
      solicitanteAtualizado,
      recheckCaller.perfil,
      preSmtpTarefa,
    )
    if (!preScopeCheck.allowed) {
      const ok = await encerrarEventoSemEnvio(
        'Solicitante perdeu escopo de acesso ao caso antes do disparo SMTP.',
        'cancelado',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'cancelado',
          notificacao_aceita_smtp: false,
          reason: 'escopo_negado',
          message: 'Solicitação registrada, mas notificação cancelada: acesso revogado.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 10. Prazo
    if (!preSmtpTarefa.prazo_conclusao) {
      const ok = await encerrarEventoSemEnvio(
        'Caso sem prazo de conclusão definido na revalidação pré-SMTP.',
        'cancelado',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'cancelado',
          notificacao_aceita_smtp: false,
          reason: 'sem_prazo',
          message:
            'Solicitação registrada, mas notificação cancelada: caso sem prazo de conclusão.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const recheckPrazoAtualStr = String(preSmtpTarefa.prazo_conclusao).split('T')[0]
    if (prazoSolicitadoTrimmed <= recheckPrazoAtualStr) {
      const ok = await encerrarEventoSemEnvio(
        'Prazo solicitado não é mais posterior ao prazo do caso na revalidação pré-SMTP.',
        'cancelado',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'cancelado',
          notificacao_aceita_smtp: false,
          reason: 'prazo_invalido',
          message:
            'Solicitação registrada, mas notificação cancelada pois o prazo do caso foi modificado.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 11. Providência (se aplicável)
    if (providenciaAlvo) {
      const { data: recheckProv, error: recheckProvErr } = providenciaQueryResult as any

      if (
        recheckProvErr ||
        !recheckProv ||
        recheckProv.tarefa_id !== preSmtpTarefa.id ||
        recheckProv.deleted_at
      ) {
        const ok = await encerrarEventoSemEnvio(
          'Providência foi alterada, excluída ou desvinculada antes do despacho SMTP.',
          'cancelado',
        )
        if (!ok) {
          return respostaConflitoDesistencia()
        }

        return new Response(
          JSON.stringify({
            success: true,
            solicitacao_registrada: true,
            email_status: 'cancelado',
            notificacao_aceita_smtp: false,
            reason: 'providencia_invalida',
            message:
              'Solicitação registrada, mas notificação cancelada pois a providência foi excluída ou desvinculada.',
            solicitacao_id: solicitacaoId,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    }

    // 14. Montagem do E-mail e Sanitização HTML (escapeHtml)
    const nomeControleStr = (preSmtpTarefa as any).nome_controle?.nome || ''
    const numeroCasoStr = preSmtpTarefa.numero_caso != null ? String(preSmtpTarefa.numero_caso) : ''
    const pastaRicciStr = (preSmtpTarefa.pasta_ricci || '').trim()
    const pastaClienteStr = (preSmtpTarefa.pasta_cliente || '').trim()
    const adminNome = adminAtualizado.nome || 'Administrador'
    const solicitanteNome = solicitanteAtualizado.nome || 'Usuário'

    const subject = `Solicitação de Adiamento [Caso ${numeroCasoStr}] - Ricci Task`

    const bodyLines: string[] = []
    bodyLines.push(`Olá, ${adminNome}.`)
    bodyLines.push('')
    bodyLines.push(
      `Uma solicitação de adiamento de prazo foi registrada no Ricci Task por ${solicitanteNome}.`,
    )
    bodyLines.push('')
    if (nomeControleStr) bodyLines.push(`Controle: ${nomeControleStr}`)
    bodyLines.push(`Caso: ${numeroCasoStr}`)
    if (preSmtpTarefa.identificacao_caso?.trim()) {
      bodyLines.push(`Identificação: ${preSmtpTarefa.identificacao_caso.trim()}`)
    }
    if (pastaRicciStr) {
      bodyLines.push(`Pasta Ricci: ${pastaRicciStr}`)
    }
    if (pastaClienteStr) {
      bodyLines.push(`Pasta Cliente: ${pastaClienteStr}`)
    }
    bodyLines.push(`Solicitante: ${solicitanteNome} (${solicitanteAtualizado.email})`)
    bodyLines.push('')
    bodyLines.push(`Providência: ${textoProvidenciaFinal}`)
    bodyLines.push(`Conclusão Atual do Caso: ${formatDateBR(prazoCasoAtualStr)}`)
    bodyLines.push(`Data Solicitada: ${formatDateBR(prazoSolicitadoTrimmed)}`)
    bodyLines.push('')
    bodyLines.push(`Motivo: ${motivoTrimmed}`)
    bodyLines.push('')
    bodyLines.push('Acesse o Ricci Task para avaliar o caso e as providências.')
    bodyLines.push('https://ricci-task.goskip.app/')

    const escapedSubject = escapeHtml(subject)
    const emailHtml = `
      <div style="font-family: sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a; margin-bottom: 16px;">${escapedSubject}</h2>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          ${bodyLines
            .filter((line) => line !== 'https://ricci-task.goskip.app/')
            .map((line) => {
              if (line === '') return '<br/>'
              const escaped = escapeHtml(line)
              const isBoldLine = line.startsWith('Data Solicitada:') || line.startsWith('Motivo:')
              return `<p style="margin: 4px 0;">${isBoldLine ? `<strong>${escaped}</strong>` : escaped}</p>`
            })
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

    const emailText = bodyLines.join('\n')

    // Atualiza to_email no evento se o e-mail do admin tiver mudado
    if (normalizarEmail(adminAtualizado.email) !== normalizarEmail(destinatarioAdmin.email)) {
      const { data: updatedToEmailRows, error: toEmailErr } = await supabase
        .from('task_email_eventos')
        .update({ to_email: adminAtualizado.email })
        .eq('id', eventoId)
        .eq('owner_token', callOwnerToken)
        .eq('status', 'pending')
        .select('id')

      if (toEmailErr || !updatedToEmailRows || updatedToEmailRows.length === 0) {
        console.error('[solicitacao-adiamento] Falha ao atualizar to_email no evento:', toEmailErr)
        const ok = await encerrarEventoSemEnvio(
          'Falha ao persistir destinatário atualizado antes do SMTP.',
          'falhou',
        )
        if (!ok) {
          return respostaConflitoDesistencia()
        }

        return new Response(
          JSON.stringify({
            success: false,
            solicitacao_registrada: true,
            email_status: 'falhou',
            notificacao_aceita_smtp: false,
            solicitacao_id: solicitacaoId,
            chave_idempotencia,
            message:
              'Solicitação registrada, porém houve falha ao atualizar o destinatário. Nenhum e-mail foi enviado; tente novamente.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    }

    const mailOptions = {
      from: `"Ricci Task" <${senderEmail}>`,
      to: adminAtualizado.email,
      replyTo: replyTo || solicitanteAtualizado.email,
      subject,
      text: emailText,
      html: emailHtml,
    }

    // 15. Bloqueio Persistente Pré-Envio (smtp_maybe_sent)
    const preSmtpIso = new Date().toISOString()
    const { data: maybeSentRows, error: maybeSentErr } = await supabase
      .from('task_email_eventos')
      .update({
        status: 'smtp_maybe_sent',
        locked_at: preSmtpIso,
      })
      .eq('id', eventoId)
      .eq('owner_token', callOwnerToken)
      .eq('status', 'pending')
      .select('id, status')

    if (maybeSentErr || !maybeSentRows || maybeSentRows.length === 0) {
      console.error('[solicitacao-adiamento] Falha ao gravar status smtp_maybe_sent:', maybeSentErr)
      const ok = await encerrarEventoSemEnvio(
        'Falha ao gravar bloqueio persistente pré-SMTP.',
        'falhou',
      )
      if (!ok) {
        return respostaConflitoDesistencia()
      }

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: 'falhou',
          notificacao_aceita_smtp: false,
          error: 'Falha técnica ao assegurar bloqueio persistente pré-SMTP.',
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 16. Disparo SMTP e Classificação de Falha (Definitiva vs Incerta)
    let sendErrorMessage: string | null = null
    let sendResult: any = null

    try {
      sendResult = await transporter.sendMail(mailOptions)
    } catch (sendError: any) {
      console.error('[solicitacao-adiamento] Erro no transporte SMTP:', sendError)
      sendErrorMessage = sendError.message || String(sendError)

      const isTimeoutOrNetwork =
        sendError.code === 'ETIMEDOUT' ||
        sendError.code === 'ESOCKET' ||
        sendError.code === 'ECONNRESET' ||
        /timeout/i.test(sendErrorMessage || '')

      const errorStatus = isTimeoutOrNetwork ? 'uncertain' : 'error'
      const solStatus = isTimeoutOrNetwork ? 'incerto' : 'falhou'

      // Proteção por owner_token e status esperado 'smtp_maybe_sent'
      const { data: updatedErrRows } = await supabase
        .from('task_email_eventos')
        .update({
          status: errorStatus,
          erro: sendErrorMessage,
        })
        .eq('id', eventoId)
        .eq('owner_token', callOwnerToken)
        .eq('status', 'smtp_maybe_sent')
        .select('id')

      if (updatedErrRows && updatedErrRows.length > 0) {
        await supabase
          .from('task_solicitacoes_adiamento')
          .update({ email_status: solStatus })
          .eq('id', solicitacaoId)
      }

      await supabase.from('email_send_logs').insert({
        type: 'ricci_task_solicitacao_adiamento',
        to_email: adminAtualizado.email,
        subject: mailOptions.subject,
        status: errorStatus,
        error_message: sendErrorMessage,
        created_by: user.id,
        created_at: new Date().toISOString(),
      })

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: solStatus,
          notificacao_aceita_smtp: false,
          error: isTimeoutOrNetwork
            ? 'Resultado incerto no transporte SMTP (timeout/rede). Solicitação registrada; evento aguarda reconciliação sem reenvio automático.'
            : `Falha no envio da notificação por e-mail: ${sendErrorMessage}. Uma nova tentativa controlada é permitida.`,
          solicitacao_id: solicitacaoId,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Regra 4: Confira a aceitação do destinatário no retorno de sendMail.
    // Não confirmar SMTP sem aceitação explícita do destinatário.
    // Resultado potencialmente incerto não permite reenvio automático.
    const isRecipientAccepted = (): { accepted: boolean; uncertain: boolean; reason: string } => {
      if (!sendResult) {
        return {
          accepted: false,
          uncertain: true,
          reason: 'Nenhum resultado de envio retornado pelo transporte SMTP.',
        }
      }

      const adminNormalized = normalizarEmail(adminAtualizado.email)

      // Se nodemailer retornou rejected contendo exatamente o destinatário normalizado
      if (Array.isArray(sendResult.rejected) && sendResult.rejected.length > 0) {
        const rejectedFound = sendResult.rejected.some(
          (r: any) => normalizarEmail(r) === adminNormalized,
        )
        if (rejectedFound) {
          return {
            accepted: false,
            uncertain: false,
            reason: `Destinatário rejeitado pelo servidor SMTP: ${adminAtualizado.email}`,
          }
        }
      }

      // Exigência de aceitação explícita do destinatário: não aceitar retorno sem accepted
      if (!Array.isArray(sendResult.accepted) || sendResult.accepted.length === 0) {
        return {
          accepted: false,
          uncertain: true,
          reason: 'Nenhum destinatário foi confirmado na lista de aceitação do servidor SMTP.',
        }
      }

      const acceptedFound = sendResult.accepted.some(
        (a: any) => normalizarEmail(a) === adminNormalized,
      )
      if (!acceptedFound) {
        return {
          accepted: false,
          uncertain: true,
          reason: `Destinatário ${adminAtualizado.email} não consta na lista de aceitos do servidor SMTP.`,
        }
      }

      return { accepted: true, uncertain: false, reason: '' }
    }

    const recipientCheck = isRecipientAccepted()
    if (!recipientCheck.accepted) {
      console.warn(
        '[solicitacao-adiamento] Destinatário não aceito no retorno do sendMail:',
        recipientCheck,
      )
      const errorStatus = recipientCheck.uncertain ? 'uncertain' : 'error'
      const solStatus = recipientCheck.uncertain ? 'incerto' : 'falhou'

      // Proteção de transição por owner_token e status esperado
      const { data: updatedRejRows } = await supabase
        .from('task_email_eventos')
        .update({
          status: errorStatus,
          erro: recipientCheck.reason,
        })
        .eq('id', eventoId)
        .eq('owner_token', callOwnerToken)
        .eq('status', 'smtp_maybe_sent')
        .select('id')

      if (updatedRejRows && updatedRejRows.length > 0) {
        await supabase
          .from('task_solicitacoes_adiamento')
          .update({ email_status: solStatus })
          .eq('id', solicitacaoId)
      }

      await supabase.from('email_send_logs').insert({
        type: 'ricci_task_solicitacao_adiamento',
        to_email: adminAtualizado.email,
        subject: mailOptions.subject,
        status: errorStatus,
        error_message: recipientCheck.reason,
        created_by: user.id,
        created_at: new Date().toISOString(),
      })

      return new Response(
        JSON.stringify({
          success: true,
          solicitacao_registrada: true,
          email_status: solStatus,
          notificacao_aceita_smtp: false,
          error: recipientCheck.uncertain
            ? `Resultado potencialmente incerto retornado pelo servidor SMTP: ${recipientCheck.reason}. Reenvio automático bloqueado para evitar duplicidade.`
            : `Destinatário rejeitado pelo servidor SMTP: ${recipientCheck.reason}`,
          solicitacao_id: solicitacaoId,
        }),
        {
          status: recipientCheck.uncertain ? 409 : 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 17. Pós-SMTP: Confirmação de Sucesso com verificação rigorosa de owner_token e linhas afetadas
    const agoraIso = new Date().toISOString()
    let postSmtpSuccess = false
    let propriedadePerdida = false

    try {
      const { data: updatedSuccessRows, error: updateSuccessErr } = await supabase
        .from('task_email_eventos')
        .update({
          status: 'success',
          sent_at: agoraIso,
          erro: null,
        })
        .eq('id', eventoId)
        .eq('owner_token', callOwnerToken)
        .eq('status', 'smtp_maybe_sent')
        .select('id, status')

      if (updateSuccessErr) {
        // Caso 1: ERRO DE BANCO na marcação de success
        console.error(
          '[solicitacao-adiamento] Falha crítica de persistência pós-SMTP em task_email_eventos (erro de banco):',
          updateSuccessErr,
        )
        // Tenta marcar o evento como uncertain com os MESMOS três filtros e .select('id')
        const { data: updatedUncertainRows, error: updateUncertainErr } = await supabase
          .from('task_email_eventos')
          .update({
            status: 'uncertain',
            sent_at: agoraIso,
            erro: `Enviado via SMTP mas falha na persistência final: ${updateSuccessErr.message || 'erro de banco'}`,
          })
          .eq('id', eventoId)
          .eq('owner_token', callOwnerToken)
          .eq('status', 'smtp_maybe_sent')
          .select('id')

        if (updateUncertainErr || !updatedUncertainRows || updatedUncertainRows.length === 0) {
          // Segunda tentativa falhou OU não afetou nenhuma linha: propriedade perdida
          propriedadePerdida = true
        } else {
          // Propriedade retida e evento marcado como uncertain
          propriedadePerdida = false
        }
      } else if (!updatedSuccessRows || updatedSuccessRows.length === 0) {
        // Caso 2: NENHUMA LINHA AFETADA sem erro (zero linhas na marcação de success)
        // Considera a propriedade do evento PERDIDA diretamente (não tenta uncertain)
        propriedadePerdida = true
      } else {
        // Sucesso na marcação do evento
        postSmtpSuccess = true
      }
    } catch (persErr: any) {
      // Caso 3: Exceção lançada nesse trecho também conta como propriedade PERDIDA
      propriedadePerdida = true
      console.error('[solicitacao-adiamento] Exceção na persistência pós-SMTP:', persErr)
    }

    if (postSmtpSuccess) {
      // Quando o evento for marcado como success normalmente:
      // grave email_status: 'enviado' e email_enviado_at na solicitação com .select('id').
      // Se essa gravação falhar, APENAS registre o erro em log e mantenha a resposta de sucesso.
      const { data: updatedSolRows, error: updateSolErr } = await supabase
        .from('task_solicitacoes_adiamento')
        .update({
          email_status: 'enviado',
          email_enviado_at: agoraIso,
        })
        .eq('id', solicitacaoId)
        .select('id')

      if (updateSolErr || !updatedSolRows || updatedSolRows.length === 0) {
        console.warn(
          '[solicitacao-adiamento] Falha ao atualizar task_solicitacoes_adiamento para enviado (resposta de sucesso mantida pois evento já é success):',
          updateSolErr,
        )
      }

      await supabase.from('email_send_logs').insert({
        type: 'ricci_task_solicitacao_adiamento',
        to_email: adminAtualizado.email,
        subject: mailOptions.subject,
        status: 'success',
        created_by: user.id,
        created_at: agoraIso,
        error_message: null,
      })
    } else {
      // Falha pós-SMTP:
      // Grave email_status: 'incerto' na solicitação SOMENTE quando houve falha na marcação de success
      // E a propriedade do evento NÃO foi perdida (ou seja: erro de banco, a marcação uncertain funcionou e afetou linha).
      if (!propriedadePerdida) {
        await supabase
          .from('task_solicitacoes_adiamento')
          .update({
            email_status: 'incerto',
            email_enviado_at: null,
          })
          .eq('id', solicitacaoId)
          .select('id')
      }
      // Se a propriedade foi PERDIDA: NÃO altere o evento e NÃO altere a solicitação.

      await supabase.from('email_send_logs').insert({
        type: 'ricci_task_solicitacao_adiamento',
        to_email: adminAtualizado.email,
        subject: mailOptions.subject,
        status: 'uncertain',
        created_by: user.id,
        created_at: agoraIso,
        error_message: propriedadePerdida
          ? 'Enviado via SMTP mas propriedade do evento perdida na confirmação final.'
          : 'Enviado via SMTP mas falha ao atualizar registro de evento (evento marcado como uncertain).',
      })

      // Em QUALQUER falha deste trecho (success falhou com propriedade retida, propriedade perdida, exceção),
      // a resposta continua HTTP 500 com success: false, solicitacao_registrada: true, email_status: 'incerto', notificacao_aceita_smtp: false.
      return new Response(
        JSON.stringify({
          success: false,
          solicitacao_registrada: true,
          email_status: 'incerto',
          notificacao_aceita_smtp: false,
          message:
            'Solicitação registrada e e-mail despachado pelo SMTP, porém houve falha de persistência da confirmação. Evento mantido ou marcado como incerto para evitar reenvio duplicado.',
          solicitacao_id: solicitacaoId,
          chave_idempotencia,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Resposta final clara: Solicitação REGISTRADA e Notificação ACEITA pelo servidor SMTP
    return new Response(
      JSON.stringify({
        success: true,
        solicitacao_registrada: true,
        email_status: 'enviado',
        notificacao_aceita_smtp: true,
        message:
          'Solicitação de adiamento registrada com sucesso e notificação aceita pelo servidor de e-mail.',
        solicitacao_id: solicitacaoId,
        chave_idempotencia,
        destinatario: {
          id: adminAtualizado.id,
          nome: adminAtualizado.nome,
          email: adminAtualizado.email,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    console.error('[solicitacao-adiamento] Erro não tratado na Edge Function:', error)
    return new Response(
      JSON.stringify({
        error: error.message || 'Erro interno ao processar solicitação de adiamento.',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
}
