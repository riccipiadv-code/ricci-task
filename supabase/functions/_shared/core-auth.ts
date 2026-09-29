import { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const SYSTEM_CODE_CONECTAI = 'CONECTAI'
export const SYSTEM_CODE_RICCI_TASK = 'RICCI_TASK'
export const ROLE_CODE_ADMINISTRADOR = 'ADMINISTRADOR'

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

export interface ValidatedRecipient {
  taskUsuarioId: string
  coreUsuarioId: string
  nome: string
  email: string
}

/**
 * Valida destinatário de caso a partir do seu ID em task_usuarios:
 * 1. Consulta task_usuarios pelo ID gravado no caso (para obter core_usuario_id e nome histórico)
 * 2. Se não possuir core_usuario_id ou task_usuarios estiver inativo, não valida
 * 3. Valida no Gestor de Acessos Ricci:
 *    - core_usuarios (id = core_usuario_id, ativo = true) -> obtém e-mail atual
 *    - core_usuario_sistemas (usuario_id = core_usuario_id, ativo = true)
 *    - core_sistemas (codigo = 'RICCI_TASK', ativo = true)
 *    - core_perfis (ativo = true)
 * 4. Em caso de falha de leitura central ou ausência de vínculo válido ativo, retorna null.
 *    NUNCA faz fallback para o e-mail local antigo de task_usuarios.
 */
export async function resolveValidatedTaskUserEmail(
  supabase: SupabaseClient,
  taskUsuarioId: string,
): Promise<ValidatedRecipient | null> {
  if (!taskUsuarioId) return null

  // 1. Obter registro de task_usuarios
  const { data: taskUser, error: taskUserError } = await supabase
    .from('task_usuarios')
    .select('id, core_usuario_id, nome, email, ativo')
    .eq('id', taskUsuarioId)
    .maybeSingle()

  if (taskUserError || !taskUser || !taskUser.core_usuario_id) {
    if (taskUserError) {
      console.error('[core-auth] Erro ao consultar task_usuarios:', taskUserError)
    }
    return null
  }

  // 2. Buscar e-mail atual em core_usuarios validando vínculo ativo com RICCI_TASK
  const { data: linkData, error: linkError } = await supabase
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

  if (linkError || !linkData) {
    if (linkError) {
      console.error('[core-auth] Erro ao validar vínculo central do destinatário:', linkError)
    }
    return null
  }

  const coreUser = (linkData as any).core_usuarios
  if (!coreUser || !coreUser.email) {
    return null
  }

  const centralEmail = String(coreUser.email).trim().toLowerCase()
  if (!centralEmail) {
    return null
  }

  return {
    taskUsuarioId: taskUser.id,
    coreUsuarioId: coreUser.id,
    nome: coreUser.nome || taskUser.nome,
    email: centralEmail,
  }
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
