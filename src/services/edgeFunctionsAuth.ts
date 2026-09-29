import type { SupabaseClient } from '@supabase/supabase-js'

export const SYSTEM_CODE_CONECTAI = 'CONECTAI'
export const SYSTEM_CODE_RICCI_TASK = 'RICCI_TASK'
export const ROLE_CODE_ADMINISTRADOR = 'ADMINISTRADOR'

export interface CoreUserRecord {
  id: string
  auth_user_id: string | null
  email: string
  nome: string | null
  ativo: boolean
}

export interface CoreAdminAuthResult {
  allowed: boolean
  status?: number
  error?: string
  coreUser?: CoreUserRecord
  systemCodes?: string[]
}

export interface ValidatedRecipient {
  taskUsuarioId: string
  coreUsuarioId: string
  nome: string
  email: string
}

/**
 * Validação central estrita para autorização de Administrador no Ricci Task:
 * auth.users.id → core_usuarios.auth_user_id → core_usuario_sistemas → sistema RICCI_TASK → core_perfis.codigo = 'ADMINISTRADOR'
 */
export async function verifyRicciTaskAdmin(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<CoreAdminAuthResult> {
  if (!authUserId) {
    return {
      allowed: false,
      status: 401,
      error: 'ID de usuário autenticado não informado.',
    }
  }

  const { data: coreUser, error: coreUserError } = await supabase
    .from('core_usuarios')
    .select('id, auth_user_id, email, nome, ativo')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (coreUserError || !coreUser) {
    return {
      allowed: false,
      status: 403,
      error: 'Usuário autenticado não possui registro no Gestor de Acessos Ricci (core_usuarios).',
    }
  }

  if (!coreUser.ativo) {
    return {
      allowed: false,
      status: 403,
      error: 'Usuário está inativo no Gestor de Acessos Ricci.',
    }
  }

  const { data: linkRows, error: linkError } = await supabase
    .from('core_usuario_sistemas')
    .select(`
      id,
      ativo,
      core_sistemas!inner(id, codigo, ativo),
      core_perfis!inner(id, codigo, ativo)
    `)
    .eq('usuario_id', coreUser.id)
    .eq('ativo', true)
    .eq('core_sistemas.codigo', SYSTEM_CODE_RICCI_TASK)
    .eq('core_sistemas.ativo', true)

  if (linkError || !linkRows || linkRows.length === 0) {
    return {
      allowed: false,
      status: 403,
      error: 'Usuário não possui vínculo ativo com o sistema RICCI_TASK no Gestor de Acessos.',
    }
  }

  const hasAdminRole = linkRows.some((row: any) => {
    const sistema = row.core_sistemas
    const perfil = row.core_perfis
    return (
      row.ativo &&
      sistema &&
      sistema.ativo &&
      sistema.codigo === SYSTEM_CODE_RICCI_TASK &&
      perfil &&
      perfil.ativo &&
      perfil.codigo === ROLE_CODE_ADMINISTRADOR
    )
  })

  if (!hasAdminRole) {
    return {
      allowed: false,
      status: 403,
      error: 'Acesso restrito: usuário não possui perfil ADMINISTRADOR ativo no RICCI_TASK.',
    }
  }

  return {
    allowed: true,
    coreUser: {
      id: coreUser.id,
      auth_user_id: coreUser.auth_user_id,
      email: coreUser.email,
      nome: coreUser.nome,
      ativo: coreUser.ativo,
    },
    systemCodes: [SYSTEM_CODE_RICCI_TASK],
  }
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
