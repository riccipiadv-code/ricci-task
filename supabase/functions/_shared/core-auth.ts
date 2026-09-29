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
  taskUsuarioId?: string
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
 * Validação central autoritativa de destinatário a partir do seu core_usuario_id:
 * - Valida core_usuarios (id = coreUsuarioId, ativo = true) -> obtém nome e e-mail atuais
 * - Valida core_usuario_sistemas (usuario_id = coreUsuarioId, ativo = true)
 * - Valida core_sistemas (codigo = 'RICCI_TASK', ativo = true)
 * - Valida core_perfis (ativo = true)
 * - Distingue estritamente falha técnica (500 / retry) de vínculo ausente ou inativo (invalid_link)
 * - NUNCA depende nem bloqueia por task_usuarios.ativo
 */
export async function resolveValidatedRecipientByCoreId(
  supabase: SupabaseClient,
  coreUsuarioId: string,
): Promise<RecipientResolutionResult> {
  if (!coreUsuarioId) {
    return {
      status: 'missing_user_id',
      recipient: null,
      error: 'ID central de usuário não fornecido',
    }
  }

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
      .eq('usuario_id', coreUsuarioId)
      .eq('ativo', true)
      .eq('core_usuarios.ativo', true)
      .eq('core_sistemas.codigo', SYSTEM_CODE_RICCI_TASK)
      .eq('core_sistemas.ativo', true)
      .eq('core_perfis.ativo', true)
      .maybeSingle()
  } catch (err: any) {
    console.error('[core-auth] Falha técnica ao validar vínculo central por core_usuario_id:', err)
    return {
      status: 'technical_failure',
      recipient: null,
      error: err?.message || 'Falha técnica de comunicação ao consultar tabelas centrais',
    }
  }

  const { data: linkData, error: linkError } = linkResult

  if (linkError) {
    console.error(
      '[core-auth] Erro de banco ao validar vínculo central do destinatário por core_usuario_id:',
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
      coreUsuarioId: coreUser.id,
      nome: (coreUser.nome || '').trim(),
      email: centralEmail,
    },
  }
}

/**
 * Valida destinatário de caso a partir de identificador (com compatibilidade de assinatura):
 * Elimina qualquer consulta a task_usuarios.
 * Resolve exclusivamente via resolveValidatedRecipientByCoreId no Gestor de Acessos Ricci.
 * Valida: usuário central ativo, vínculo com RICCI_TASK ativo, sistema e perfil ativos.
 * Diferencia FALHA TÉCNICA (500) de VÍNCULO INVALIDADO (invalid_link).
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

  // No corte definitivo para IDs centrais, task_usuarios NÃO é consultada.
  // Trata o identificador diretamente como core_usuario_id via resolveValidatedRecipientByCoreId.
  const coreResolution = await resolveValidatedRecipientByCoreId(supabase, taskUsuarioId)

  if (coreResolution.status !== 'valid' || !coreResolution.recipient) {
    return coreResolution
  }

  return {
    status: 'valid',
    recipient: {
      taskUsuarioId,
      coreUsuarioId: coreResolution.recipient.coreUsuarioId,
      nome: coreResolution.recipient.nome,
      email: coreResolution.recipient.email,
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
/**
 * Validação de escopo de acesso a um caso (tarefa):
 * - ADMINISTRADOR: acessa qualquer caso.
 * - GESTOR: acessa caso próprio (é responsável ou executor pelo ID central) OU caso cuja equipe direta
 *   seja liderada pelo gestor (responsável ou executor tem core_usuarios.gestor_id = gestorCoreId).
 *   Para casos históricos sem IDs centrais, o gestor também acessa para não quebrar compatibilidade.
 * - OPERACIONAL: acessa exclusivamente casos onde é Responsável ou Executor pelo ID central.
 *
 * Retorna { allowed: boolean; status: 'ok' | 'denied' | 'technical_failure'; error?: string }
 */
export async function checkTaskAccessScope(
  supabase: SupabaseClient,
  callerCoreUser: { id: string } | null | undefined,
  callerPerfil: string | null | undefined,
  tarefa: {
    id: string
    responsavel_core_usuario_id?: string | null
    executor_core_usuario_id?: string | null
    responsavel_usuario_id?: string | null
    executor_usuario_id?: string | null
  },
): Promise<{ allowed: boolean; status: 'ok' | 'denied' | 'technical_failure'; error?: string }> {
  // (a) chamador sem ID central válido -> denied
  const callerCoreId = (callerCoreUser?.id || '').trim()
  if (!callerCoreId) {
    return {
      allowed: false,
      status: 'denied',
      error: 'Permissão negada: chamador sem ID central corporativo válido.',
    }
  }

  // (b) perfil não reconhecido (só ADMINISTRADOR, GESTOR, OPERACIONAL) -> denied, MESMO se ID bater com responsável/executor
  const perfilUpper = (callerPerfil || '').trim().toUpperCase()
  if (
    perfilUpper !== ROLE_CODE_ADMINISTRADOR &&
    perfilUpper !== ROLE_CODE_GESTOR &&
    perfilUpper !== ROLE_CODE_OPERACIONAL
  ) {
    return {
      allowed: false,
      status: 'denied',
      error: 'Permissão negada: perfil não autorizado para acessar este caso.',
    }
  }

  // (c) tarefa sem IDs centrais -> denied (fail-closed, sem fallback permissivo)
  const respCore = tarefa.responsavel_core_usuario_id || null
  const execCore = tarefa.executor_core_usuario_id || null

  if (!respCore && !execCore) {
    return {
      allowed: false,
      status: 'denied',
      error: 'Permissão negada: caso sem IDs centrais válidos de responsável ou executor.',
    }
  }

  // (d) ADMINISTRADOR -> irrestrito
  if (perfilUpper === ROLE_CODE_ADMINISTRADOR) {
    return { allowed: true, status: 'ok' }
  }

  // "Próprio" = ser Responsável ou Executor pelo ID central
  const isProprio = Boolean(
    (respCore && respCore === callerCoreId) || (execCore && execCore === callerCoreId),
  )

  // (e) OPERACIONAL -> só próprio
  if (perfilUpper === ROLE_CODE_OPERACIONAL) {
    if (isProprio) {
      return { allowed: true, status: 'ok' }
    }
    return {
      allowed: false,
      status: 'denied',
      error:
        'Permissão negada: usuário operacional só pode acessar casos em que é Responsável ou Executor.',
    }
  }

  // (f) GESTOR -> próprio + equipe direta ativa (gestor_id), falha de consulta -> technical_failure
  if (perfilUpper === ROLE_CODE_GESTOR) {
    if (isProprio) {
      return { allowed: true, status: 'ok' }
    }

    const targetUserIds = [respCore, execCore].filter(Boolean) as string[]
    try {
      const { data: teamMembers, error: teamError } = await supabase
        .from('core_usuarios')
        .select('id, gestor_id, ativo')
        .in('id', targetUserIds)

      if (teamError) {
        console.error('[core-auth] Falha técnica ao verificar equipe do gestor:', teamError)
        return {
          allowed: false,
          status: 'technical_failure',
          error: 'Falha técnica ao verificar escopo da equipe direta no Gestor de Acessos.',
        }
      }

      const isEquipeDireta = (teamMembers || []).some(
        (m: any) => m.gestor_id === callerCoreId && m.ativo === true,
      )

      if (isEquipeDireta) {
        return { allowed: true, status: 'ok' }
      }

      return {
        allowed: false,
        status: 'denied',
        error:
          'Permissão negada: gestores só podem acessar casos próprios ou de membros de sua equipe direta.',
      }
    } catch (err: any) {
      console.error('[core-auth] Exceção ao verificar equipe do gestor:', err)
      return {
        allowed: false,
        status: 'technical_failure',
        error: 'Falha técnica ao verificar escopo de equipe no Gestor de Acessos.',
      }
    }
  }

  return {
    allowed: false,
    status: 'denied',
    error: 'Permissão negada: perfil não autorizado para acessar este caso.',
  }
}

/**
 * Escapa caracteres especiais de HTML para prevenção de injeção XSS em e-mails
 */
/**
 * Validação de autorização para notificação de reatribuição baseada no registro de transição:
 * Quando o chamador não tem mais escopo sobre o estado ATUAL da tarefa (ex.: transferiu o caso
 * e perdeu acesso), verifica se existe um registro em `task_transicoes_atribuicao` que:
 * - pertença ao mesmo caso (`tarefa_id`)
 * - tenha sido criado pelo mesmo autor central (`autor_core_id`)
 * - corresponda aos dados da transição (ex.: versao_anterior_updated_at correspondente)
 *
 * Retorna { allowed: boolean; transition?: any; error?: string }
 */
export interface CheckTransitionNotificationParams {
  transicaoId?: string | null
  tipoEvento: string
  tarefa: {
    id: string
    responsavel_core_usuario_id?: string | null
    executor_core_usuario_id?: string | null
    updated_at?: string | null
    created_at?: string | null
  }
}

export type TransitionAccessStatus = 'ok' | 'denied' | 'technical_failure'

/**
 * Validação de autorização para notificação de reatribuição baseada no registro de transição:
 * Valida estritamente:
 * - autor da transição = chamador (callerCoreId);
 * - caso da transição = caso do evento (tarefa.id);
 * - tipo de evento corresponde (alteração de atribuição);
 * - versão resultante da transição bate com o estado atual gravado do caso (updated_at);
 * - atribuições da transição (novo_responsavel_core_id / novo_executor_core_id) correspondem às atuais da tarefa;
 * - transição antiga NÃO pode autorizar envio referente ao estado atual de outra alteração.
 * - Erro de consulta ao verificar a transição deve retornar erro técnico recuperável (fail-closed, retry possível).
 */
export async function checkTransitionNotificationAccess(
  supabase: SupabaseClient,
  callerCoreId: string,
  params: CheckTransitionNotificationParams,
): Promise<{ allowed: boolean; status: TransitionAccessStatus; transition?: any; error?: string }> {
  if (!callerCoreId || !params?.tarefa?.id) {
    return {
      allowed: false,
      status: 'denied',
      error: 'Identificadores incompletos para validação de transição.',
    }
  }

  // Validação do tipo de evento: transição de atribuição só autoriza eventos de alteração de atribuição
  const allowedEvents = ['alteracao_atribuicao', 'atribuicao']
  if (!allowedEvents.includes(params.tipoEvento)) {
    return {
      allowed: false,
      status: 'denied',
      error: 'A transição de atribuição não autoriza notificações deste tipo de evento.',
    }
  }

  try {
    let query = supabase
      .from('task_transicoes_atribuicao')
      .select(
        'id, tarefa_id, autor_core_id, novo_responsavel_core_id, novo_executor_core_id, versao_anterior_updated_at, versao_resultante_updated_at, perda_acesso_autor, created_at',
      )
      .eq('tarefa_id', params.tarefa.id)
      .eq('autor_core_id', callerCoreId)

    if (params.transicaoId) {
      query = query.eq('id', params.transicaoId)
    }

    const { data: transitions, error: transError } = await query
      .order('created_at', { ascending: false })
      .limit(5)

    if (transError) {
      console.error(
        '[core-auth] Falha técnica ao verificar registro de transição de atribuição:',
        transError,
      )
      return {
        allowed: false,
        status: 'technical_failure',
        error: 'Falha técnica ao verificar registro de transição no banco de dados.',
      }
    }

    if (!transitions || transitions.length === 0) {
      return {
        allowed: false,
        status: 'denied',
        error: 'Nenhum registro de transição autorizado encontrado para este autor neste caso.',
      }
    }

    // Encontrar transição que corresponda exatamente ao estado gravado atual da tarefa:
    // 1. Autor = chamador (já filtrado pelo eq autor_core_id)
    // 2. Tarefa = tarefa.id (já filtrado pelo eq tarefa_id)
    // 3. Destinatários da transição batem com os destinatários atuais da tarefa
    // 4. Se a transição possuir versao_resultante_updated_at gravada, deve bater com o updated_at da tarefa
    //    (ou created_at em caso de transição mais recente sem updated_at novo)
    const tarefaUpdatedStamp = params.tarefa.updated_at || params.tarefa.created_at || null
    const tarefaRespCore = params.tarefa.responsavel_core_usuario_id || null
    const tarefaExecCore = params.tarefa.executor_core_usuario_id || null

    const matchingTransition = transitions.find((t: any) => {
      // Se um transicaoId explícito foi solicitado, ele deve ser exatamente este
      if (params.transicaoId && t.id !== params.transicaoId) {
        return false
      }

      // Validar correspondência de atribuições da transição com a tarefa atual
      const matchResp = t.novo_responsavel_core_id === tarefaRespCore
      const matchExec = t.novo_executor_core_id === tarefaExecCore
      if (!matchResp || !matchExec) {
        return false
      }

      // Se possui versao_resultante_updated_at registrada, ela deve bater com a versão atual da tarefa
      if (t.versao_resultante_updated_at && tarefaUpdatedStamp) {
        const transResultStamp = new Date(t.versao_resultante_updated_at).getTime()
        const currentStamp = new Date(tarefaUpdatedStamp).getTime()
        if (transResultStamp !== currentStamp) {
          return false
        }
      }

      return true
    })

    if (!matchingTransition) {
      return {
        allowed: false,
        status: 'denied',
        error:
          'A transição informada não corresponde ao estado atual gravado do caso (versão ou destinatários divergentes). Transições antigas não podem autorizar novas notificações.',
      }
    }

    return { allowed: true, status: 'ok', transition: matchingTransition }
  } catch (err: any) {
    console.error('[core-auth] Exceção técnica ao verificar transição:', err)
    return {
      allowed: false,
      status: 'technical_failure',
      error: 'Exceção técnica ao verificar registro de transição.',
    }
  }
}

export function escapeHtml(str?: string | null): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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
