import { supabase } from '@/lib/supabase/client'

export const SYSTEM_CODE_RICCI_TASK = 'RICCI_TASK'

export type CorePerfilCodigo = 'ADMINISTRADOR' | 'GESTOR' | 'OPERACIONAL' | string

export type AccessStatus = 'ok' | 'no_access' | 'disabled' | 'error'

export interface CoreAccessResolution {
  hasSystemAccess: boolean
  accessStatus: AccessStatus
  perfil: CorePerfilCodigo | null
  perfilNome?: string | null
  coreUserId: string | null
  usuarioNome?: string | null
  usuarioEmail?: string | null
  errorMessage?: string | null
  isTechnicalError?: boolean
}

/**
 * Resolve o acesso efetivo do usuário autenticado no Gestor de Acessos Central:
 * 1. core_usuarios.auth_user_id = auth.uid
 * 2. core_usuarios.ativo = true
 * 3. vínculo ativo em core_usuario_sistemas
 * 4. sistema ativo com código exato 'RICCI_TASK' (core_sistemas)
 * 5. perfil ativo em core_perfis
 *
 * Situações de retorno:
 * - 'ok': usuário ativo, vínculo ativo e perfil ativo no RICCI_TASK
 * - 'disabled': core_usuario inativo ou vínculo inativo no RICCI_TASK
 * - 'no_access': usuário corporativo não localizado ou sem vínculo com RICCI_TASK
 * - 'error': falha técnica de rede/consulta ao Supabase (fail-open temporário permitido)
 */
export async function resolveUserCoreAccess(authUserId: string): Promise<CoreAccessResolution> {
  if (!authUserId) {
    return {
      hasSystemAccess: false,
      accessStatus: 'no_access',
      perfil: null,
      coreUserId: null,
      errorMessage: 'Nenhum usuário autenticado informado.',
      isTechnicalError: false,
    }
  }

  try {
    // 1. Localiza o usuário correspondente em core_usuarios
    const { data: coreUser, error: userError } = await supabase
      .from('core_usuarios')
      .select('id, auth_user_id, nome, email, ativo')
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (userError) {
      console.error('[core-access] Erro técnico ao buscar core_usuarios:', userError)
      return {
        hasSystemAccess: false,
        accessStatus: 'error',
        perfil: null,
        coreUserId: null,
        errorMessage: userError.message,
        isTechnicalError: true,
      }
    }

    if (!coreUser) {
      // Usuário autenticado não tem cadastro corporativo em core_usuarios
      return {
        hasSystemAccess: false,
        accessStatus: 'no_access',
        perfil: null,
        coreUserId: null,
        errorMessage: 'Usuário corporativo não localizado no Gestor de Acessos.',
        isTechnicalError: false,
      }
    }

    // Se o usuário central estiver inativo
    if (!coreUser.ativo) {
      return {
        hasSystemAccess: false,
        accessStatus: 'disabled',
        perfil: null,
        coreUserId: coreUser.id,
        usuarioNome: coreUser.nome,
        usuarioEmail: coreUser.email,
        errorMessage: 'Usuário inativo no sistema corporativo.',
        isTechnicalError: false,
      }
    }

    // 2. Consulta vínculo do usuário com o sistema RICCI_TASK
    // Consulta separada e resiliente para respeitar RLS e FKs de forma explícita
    const { data: sistemaData, error: sistemaError } = await supabase
      .from('core_sistemas')
      .select('id, codigo, ativo')
      .eq('codigo', SYSTEM_CODE_RICCI_TASK)
      .maybeSingle()

    if (sistemaError) {
      console.error('[core-access] Erro técnico ao consultar core_sistemas:', sistemaError)
      return {
        hasSystemAccess: false,
        accessStatus: 'error',
        perfil: null,
        coreUserId: coreUser.id,
        usuarioNome: coreUser.nome,
        usuarioEmail: coreUser.email,
        errorMessage: sistemaError.message,
        isTechnicalError: true,
      }
    }

    if (!sistemaData || !sistemaData.ativo) {
      return {
        hasSystemAccess: false,
        accessStatus: 'disabled',
        perfil: null,
        coreUserId: coreUser.id,
        usuarioNome: coreUser.nome,
        usuarioEmail: coreUser.email,
        errorMessage: 'Sistema Ricci Task inativo no Gestor de Acessos.',
        isTechnicalError: false,
      }
    }

    // 3. Busca o vínculo em core_usuario_sistemas
    const { data: links, error: linkError } = await supabase
      .from('core_usuario_sistemas')
      .select(`
        id,
        usuario_id,
        sistema_id,
        perfil_id,
        ativo,
        perfil:core_perfis (
          id,
          codigo,
          nome,
          ativo
        )
      `)
      .eq('usuario_id', coreUser.id)
      .eq('sistema_id', sistemaData.id)

    if (linkError) {
      console.error('[core-access] Erro técnico ao consultar core_usuario_sistemas:', linkError)
      return {
        hasSystemAccess: false,
        accessStatus: 'error',
        perfil: null,
        coreUserId: coreUser.id,
        usuarioNome: coreUser.nome,
        usuarioEmail: coreUser.email,
        errorMessage: linkError.message,
        isTechnicalError: true,
      }
    }

    if (!links || links.length === 0) {
      // Sem vínculo registrado para este sistema
      return {
        hasSystemAccess: false,
        accessStatus: 'no_access',
        perfil: null,
        coreUserId: coreUser.id,
        usuarioNome: coreUser.nome,
        usuarioEmail: coreUser.email,
        errorMessage: 'Usuário sem vínculo configurado para o Ricci Task.',
        isTechnicalError: false,
      }
    }

    // Identifica o vínculo do Ricci Task
    const link = links[0]

    // Se o vínculo estiver inativo
    if (!link.ativo) {
      return {
        hasSystemAccess: false,
        accessStatus: 'disabled',
        perfil: null,
        coreUserId: coreUser.id,
        usuarioNome: coreUser.nome,
        usuarioEmail: coreUser.email,
        errorMessage: 'Acesso ao Ricci Task está desativado para este usuário.',
        isTechnicalError: false,
      }
    }

    const perfil = (link as any).perfil
    if (!perfil || !perfil.ativo) {
      return {
        hasSystemAccess: false,
        accessStatus: 'disabled',
        perfil: null,
        coreUserId: coreUser.id,
        usuarioNome: coreUser.nome,
        usuarioEmail: coreUser.email,
        errorMessage: 'Perfil de acesso inativo ou não localizado.',
        isTechnicalError: false,
      }
    }

    const perfilCodigo = String(perfil.codigo || '').toUpperCase()

    return {
      hasSystemAccess: true,
      accessStatus: 'ok',
      perfil: perfilCodigo,
      perfilNome: perfil.nome,
      coreUserId: coreUser.id,
      usuarioNome: coreUser.nome,
      usuarioEmail: coreUser.email,
      errorMessage: null,
      isTechnicalError: false,
    }
  } catch (err: any) {
    console.error('[core-access] Exceção técnica na resolução de acesso:', err)
    return {
      hasSystemAccess: false,
      accessStatus: 'error',
      perfil: null,
      coreUserId: null,
      errorMessage: err?.message || 'Falha de comunicação ao resolver autorização corporativa.',
      isTechnicalError: true,
    }
  }
}
