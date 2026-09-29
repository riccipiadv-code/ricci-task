import { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const SYSTEM_CODE_CONECTAI = 'CONECTAI'
export const SYSTEM_CODE_RICCI_TASK = 'RICCI_TASK'
export const ROLE_CODE_ADMINISTRADOR = 'ADMINISTRADOR'
export const ROLE_CODE_GESTOR = 'GESTOR'
export const ROLE_CODE_OPERACIONAL = 'OPERACIONAL'

export const RICCI_TASK_ALLOWED_CALLER_ROLES = [
  ROLE_CODE_ADMINISTRADOR,
  ROLE_CODE_GESTOR,
  ROLE_CODE_OPERACIONAL,
] as const

export type CallerResolutionStatus = 'valid' | 'unauthorized' | 'invalid_link' | 'technical_failure'

export interface CallerResolutionResult {
  status: CallerResolutionStatus
  allowed: boolean
  httpStatus: number
  error?: string
  coreUser?: {
    id: string
    auth_user_id: string | null
    nome: string
    email: string
  }
  perfil?: string
}

export interface CoreAdminAuthResult {
  allowed: boolean
  error?: string
  status?: number
  coreUser?: {
    id: string
    auth_user_id: string | null
    nome: string
    email: string
  }
}

/**
 * Validação central estrita para autorização de Administrador no Conectaí:
 * auth.users.id → core_usuarios.auth_user_id → core_usuario_sistemas → sistema CONECTAI → core_perfis.codigo = 'ADMINISTRADOR'
 *
 * Valida:
 * - core_usuarios.ativo = true
 * - core_usuario_sistemas.ativo = true
 * - core_sistemas.ativo = true
 * - core_perfis.ativo = true
 *
 * NÃO usa profiles.perfil como fallback de autorização.
 */
export async function verifyConectaiAdmin(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<CoreAdminAuthResult> {
  return verifyCoreAdmin(supabase, authUserId, [SYSTEM_CODE_CONECTAI])
}

/**
 * Validação central estrita para autorização de Administrador no Ricci Task:
 * auth.users.id → core_usuarios.auth_user_id → core_usuario_sistemas → sistema RICCI_TASK → core_perfis.codigo = 'ADMINISTRADOR'
 *
 * Valida:
 * - core_usuarios.ativo = true
 * - core_usuario_sistemas.ativo = true
 * - core_sistemas.codigo = 'RICCI_TASK' AND core_sistemas.ativo = true
 * - core_perfis.codigo = 'ADMINISTRADOR' AND core_perfis.ativo = true
 *
 * NÃO usa profiles.perfil nem role legada local.
 */
export async function verifyRicciTaskAdmin(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<CoreAdminAuthResult> {
  return verifyCoreAdmin(supabase, authUserId, [SYSTEM_CODE_RICCI_TASK])
}

/**
 * Validação central estrita para autorização de chamador no Ricci Task:
 * auth.users.id → core_usuarios.auth_user_id → core_usuario_sistemas → sistema RICCI_TASK → core_perfis
 *
 * Exige:
 * - core_usuarios.ativo = true
 * - vínculo ativo em core_usuario_sistemas
 * - core_sistemas.codigo = 'RICCI_TASK' AND core_sistemas.ativo = true
 * - core_perfis.ativo = true AND core_perfis.codigo IN ('ADMINISTRADOR', 'GESTOR', 'OPERACIONAL')
 *
 * Distingue com precisão:
 * - 'valid': usuário ativo, vínculo ativo com RICCI_TASK ativo e perfil permitido ativo
 * - 'unauthorized': authUserId ausente (401)
 * - 'invalid_link': usuário não localizado, inativo, sem vínculo com RICCI_TASK, sistema inativo, vínculo inativo ou perfil não permitido/inativo (403)
 * - 'technical_failure': falha técnica de rede/consulta no Gestor de Acessos Ricci (500)
 */
export async function verifyRicciTaskCaller(
  supabase: SupabaseClient,
  authUserId: string,
  allowedRoles: readonly string[] = RICCI_TASK_ALLOWED_CALLER_ROLES,
): Promise<CallerResolutionResult> {
  if (!authUserId) {
    return {
      status: 'unauthorized',
      allowed: false,
      httpStatus: 401,
      error: 'Token de autenticação não encontrado ou inválido.',
    }
  }

  // 1. Localizar o usuário em core_usuarios
  let userResult: any
  try {
    userResult = await supabase
      .from('core_usuarios')
      .select('id, auth_user_id, nome, email, ativo')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
  } catch (err: any) {
    console.error('[core-auth] Falha técnica ao consultar core_usuarios para chamador:', err)
    return {
      status: 'technical_failure',
      allowed: false,
      httpStatus: 500,
      error:
        'Falha de comunicação com o Gestor de Acessos ao validar usuário. Tente novamente em instantes.',
    }
  }

  const { data: coreUser, error: userError } = userResult

  if (userError) {
    console.error('[core-auth] Erro de banco ao consultar core_usuarios para chamador:', userError)
    return {
      status: 'technical_failure',
      allowed: false,
      httpStatus: 500,
      error:
        'Falha de comunicação com o Gestor de Acessos ao consultar usuário. Tente novamente em instantes.',
    }
  }

  if (!coreUser) {
    return {
      status: 'invalid_link',
      allowed: false,
      httpStatus: 403,
      error:
        'Usuário sem permissão ativa para o sistema Ricci Task (usuário corporativo não localizado).',
    }
  }

  if (!coreUser.ativo) {
    return {
      status: 'invalid_link',
      allowed: false,
      httpStatus: 403,
      error: 'Usuário sem permissão ativa para o sistema Ricci Task (usuário corporativo inativo).',
    }
  }

  // 2. Localizar vínculo com o sistema RICCI_TASK ativo e perfil permitido ativo
  let linkResult: any
  try {
    linkResult = await supabase
      .from('core_usuario_sistemas')
      .select(`
        id,
        ativo,
        core_sistemas!inner(codigo, ativo),
        core_perfis!inner(codigo, ativo)
      `)
      .eq('usuario_id', coreUser.id)
      .eq('ativo', true)
      .eq('core_sistemas.codigo', SYSTEM_CODE_RICCI_TASK)
      .eq('core_sistemas.ativo', true)
      .in('core_perfis.codigo', [...allowedRoles])
      .eq('core_perfis.ativo', true)
  } catch (err: any) {
    console.error(
      '[core-auth] Falha técnica ao consultar core_usuario_sistemas para chamador:',
      err,
    )
    return {
      status: 'technical_failure',
      allowed: false,
      httpStatus: 500,
      error:
        'Falha de comunicação com o Gestor de Acessos ao validar permissões do sistema. Tente novamente em instantes.',
    }
  }

  const { data: userLinks, error: linkError } = linkResult

  if (linkError) {
    console.error(
      '[core-auth] Erro de banco ao consultar core_usuario_sistemas para chamador:',
      linkError,
    )
    return {
      status: 'technical_failure',
      allowed: false,
      httpStatus: 500,
      error:
        'Falha de comunicação com o Gestor de Acessos ao consultar vínculo de acesso. Tente novamente em instantes.',
    }
  }

  if (!userLinks || userLinks.length === 0) {
    return {
      status: 'invalid_link',
      allowed: false,
      httpStatus: 403,
      error:
        'Usuário sem permissão ativa para o sistema Ricci Task (vínculo ou perfil não autorizado).',
    }
  }

  const matchedPerfil = (userLinks[0] as any)?.core_perfis?.codigo || undefined

  return {
    status: 'valid',
    allowed: true,
    httpStatus: 200,
    coreUser: {
      id: coreUser.id,
      auth_user_id: coreUser.auth_user_id,
      nome: coreUser.nome,
      email: coreUser.email,
    },
    perfil: matchedPerfil,
  }
}

export interface ValidatedRecipient {
  taskUsuarioId: string
  coreUsuarioId: string
  nome: string
  email: string
}

export type RecipientResolutionStatus =
  | 'valid'
  | 'missing_user_id'
  | 'invalid_link'
  | 'technical_failure'

export interface RecipientResolutionResult {
  status: RecipientResolutionStatus
  recipient: ValidatedRecipient | null
  error?: string
}

/**
 * Valida destinatário de caso a partir do seu ID em task_usuarios:
 * 1. Consulta task_usuarios pelo ID gravado no caso (para obter core_usuario_id e nome histórico)
 * 2. Se não possuir core_usuario_id, task_usuarios não encontrado ou inativo: vínculo inválido
 * 3. Valida no Gestor de Acessos Ricci:
 *    - core_usuarios (id = core_usuario_id, ativo = true) -> obtém e-mail atual
 *    - core_usuario_sistemas (usuario_id = core_usuario_id, ativo = true)
 *    - core_sistemas (codigo = 'RICCI_TASK', ativo = true)
 *    - core_perfis (ativo = true)
 * 4. Diferencia FALHA TÉCNICA (erro de rede/leitura) de VÍNCULO INVALIDADO (inativo, sem vínculo).
 *    NUNCA faz fallback para o e-mail local antigo de task_usuarios.
 */
export async function resolveValidatedTaskUserEmailDetailed(
  supabase: SupabaseClient,
  taskUsuarioId: string,
): Promise<RecipientResolutionResult> {
  if (!taskUsuarioId) {
    return {
      status: 'missing_user_id',
      recipient: null,
      error: 'ID de usuário não fornecido',
    }
  }

  // 1. Obter registro de task_usuarios
  let taskUserResult: any
  try {
    taskUserResult = await supabase
      .from('task_usuarios')
      .select('id, core_usuario_id, nome, email, ativo')
      .eq('id', taskUsuarioId)
      .maybeSingle()
  } catch (err: any) {
    console.error('[core-auth] Falha técnica ao consultar task_usuarios:', err)
    return {
      status: 'technical_failure',
      recipient: null,
      error: err?.message || 'Falha técnica de comunicação ao consultar task_usuarios',
    }
  }

  const { data: taskUser, error: taskUserError } = taskUserResult

  if (taskUserError) {
    console.error('[core-auth] Erro ao consultar task_usuarios:', taskUserError)
    return {
      status: 'technical_failure',
      recipient: null,
      error: taskUserError.message || 'Falha de leitura em task_usuarios',
    }
  }

  if (!taskUser || !taskUser.core_usuario_id) {
    return {
      status: 'invalid_link',
      recipient: null,
      error: !taskUser
        ? 'Usuário operacional não encontrado'
        : 'Usuário sem vínculo central (core_usuario_id ausente)',
    }
  }

  if (taskUser.ativo === false) {
    return {
      status: 'invalid_link',
      recipient: null,
      error: 'Usuário operacional marcado como inativo',
    }
  }

  // 2. Buscar e-mail atual em core_usuarios validando vínculo ativo com RICCI_TASK
  let linkResult: any
  try {
    linkResult = await supabase
      .from('core_usuario_sistemas')
      .select(`
        id,
        ativo,
        core_usuarios!inner(id, nome, email, ativo),
        core_sistemas!inner(id, codigo, ativo),
        core_perfis!inner(id, codigo, ativo)
      `)
      .eq('usuario_id', taskUser.core_usuario_id)
      .eq('ativo', true)
      .eq('core_usuarios.ativo', true)
      .eq('core_sistemas.codigo', SYSTEM_CODE_RICCI_TASK)
      .eq('core_sistemas.ativo', true)
      .eq('core_perfis.ativo', true)
      .maybeSingle()
  } catch (err: any) {
    console.error('[core-auth] Falha técnica ao validar vínculo central:', err)
    return {
      status: 'technical_failure',
      recipient: null,
      error: err?.message || 'Falha técnica de comunicação ao consultar tabelas centrais',
    }
  }

  const { data: linkData, error: linkError } = linkResult

  if (linkError) {
    console.error(
      '[core-auth] Erro de banco ao validar vínculo central do destinatário:',
      linkError,
    )
    return {
      status: 'technical_failure',
      recipient: null,
      error: linkError.message || 'Erro ao consultar Gestor de Acessos Ricci',
    }
  }

  if (!linkData) {
    return {
      status: 'invalid_link',
      recipient: null,
      error: 'Vínculo central ausente ou inativo no Gestor de Acessos para RICCI_TASK',
    }
  }

  const coreUser = (linkData as any).core_usuarios
  if (!coreUser || !coreUser.email) {
    return {
      status: 'invalid_link',
      recipient: null,
      error: 'Usuário central sem e-mail cadastrado',
    }
  }

  const centralEmail = String(coreUser.email).trim().toLowerCase()
  if (!centralEmail) {
    return {
      status: 'invalid_link',
      recipient: null,
      error: 'E-mail corporativo em branco',
    }
  }

  return {
    status: 'valid',
    recipient: {
      taskUsuarioId: taskUser.id,
      coreUsuarioId: coreUser.id,
      nome: coreUser.nome || taskUser.nome,
      email: centralEmail,
    },
  }
}

/**
 * Wrapper de compatibilidade com a assinatura anterior: retorna ValidatedRecipient | null
 */
export async function resolveValidatedTaskUserEmail(
  supabase: SupabaseClient,
  taskUsuarioId: string,
): Promise<ValidatedRecipient | null> {
  const result = await resolveValidatedTaskUserEmailDetailed(supabase, taskUsuarioId)
  return result.recipient
}

/**
 * Validação central estrita para autorização de Administrador em sistemas permitidos:
 * auth.users.id → core_usuarios.auth_user_id → core_usuario_sistemas → sistema permitido → core_perfis.codigo = 'ADMINISTRADOR'
 * Valida ativo em core_usuarios, core_usuario_sistemas, core_sistemas e core_perfis.
 */
export async function verifyCoreAdmin(
  supabase: SupabaseClient,
  authUserId: string,
  allowedSystems: string[] = [SYSTEM_CODE_CONECTAI, 'GESTOR_ACESSO'],
): Promise<CoreAdminAuthResult> {
  if (!authUserId) {
    return {
      allowed: false,
      error: 'Não autorizado.',
      status: 401,
    }
  }

  // 1. Localizar o usuário correspondente em core_usuarios
  const { data: coreUser, error: userError } = await supabase
    .from('core_usuarios')
    .select('id, auth_user_id, nome, email, ativo')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (userError || !coreUser) {
    return {
      allowed: false,
      error: 'Permissão negada: usuário corporativo não localizado.',
      status: 403,
    }
  }

  if (!coreUser.ativo) {
    return {
      allowed: false,
      error: 'Permissão negada: usuário inativo no sistema corporativo.',
      status: 403,
    }
  }

  // 2. Localizar vínculo com qualquer um dos sistemas permitidos e perfil ADMINISTRADOR
  const { data: adminLinks, error: linkError } = await supabase
    .from('core_usuario_sistemas')
    .select(`
      id,
      ativo,
      core_sistemas!inner(codigo, ativo),
      core_perfis!inner(codigo, ativo)
    `)
    .eq('usuario_id', coreUser.id)
    .eq('ativo', true)
    .in('core_sistemas.codigo', allowedSystems)
    .eq('core_sistemas.ativo', true)
    .eq('core_perfis.codigo', ROLE_CODE_ADMINISTRADOR)
    .eq('core_perfis.ativo', true)

  if (linkError || !adminLinks || adminLinks.length === 0) {
    return {
      allowed: false,
      error: 'Permissão negada: apenas administradores possuem privilégios para esta operação.',
      status: 403,
    }
  }

  return {
    allowed: true,
    coreUser: {
      id: coreUser.id,
      auth_user_id: coreUser.auth_user_id,
      nome: coreUser.nome,
      email: coreUser.email,
    },
  }
}

/**
 * Localização de gestor para notificação de transferência/atribuição:
 * Recebe diretamente o ID central do responsável (`core_usuarios.id`).
 *
 * Hierarquia direta no Gestor de Acessos Ricci:
 * 1. core_usuarios (id = targetCoreUsuarioId) → localiza gestor_id
 * 2. se possuir gestor_id: busca gestor em core_usuarios (email, nome, ativo)
 * 3. valida ativo = true e e-mail diferente do destinatário
 *
 * NÃO utiliza profiles.legaldesk_usuario_id nem profiles.gestor_id.
 */
export async function resolveGestorFromCore(
  supabase: SupabaseClient,
  targetCoreUsuarioId: string,
  destEmail: string,
): Promise<{ gestorEmail: string | null; gestorNome: string | null }> {
  try {
    if (!targetCoreUsuarioId) {
      return { gestorEmail: null, gestorNome: null }
    }

    // 1. Localizar o responsável diretamente em core_usuarios para obter seu gestor_id
    const { data: coreUser, error: coreUserError } = await supabase
      .from('core_usuarios')
      .select('id, gestor_id')
      .eq('id', targetCoreUsuarioId)
      .maybeSingle()

    if (coreUserError || !coreUser?.gestor_id) {
      return { gestorEmail: null, gestorNome: null }
    }

    // 2. Buscar dados do gestor em core_usuarios usando core_usuarios.gestor_id
    // O gestor encontrado em core_usuarios deve estar com ativo = true.
    // Se estiver inativo, não enviar CC (comportar como se não houvesse gestor).
    const { data: gestorCore, error: gestorError } = await supabase
      .from('core_usuarios')
      .select('id, nome, email, ativo')
      .eq('id', coreUser.gestor_id)
      .maybeSingle()

    if (gestorError || !gestorCore || gestorCore.ativo !== true) {
      return { gestorEmail: null, gestorNome: null }
    }

    const candidateEmail = (gestorCore.email || '').trim()
    if (candidateEmail && candidateEmail.toLowerCase() !== destEmail.toLowerCase()) {
      return {
        gestorEmail: candidateEmail,
        gestorNome: (gestorCore.nome || '').trim() || null,
      }
    }

    return { gestorEmail: null, gestorNome: null }
  } catch (err) {
    console.warn('Falha segura na resolução de gestor via core_*:', err)
    return { gestorEmail: null, gestorNome: null }
  }
}
