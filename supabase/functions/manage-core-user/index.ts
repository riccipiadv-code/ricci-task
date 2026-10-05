import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SYSTEM_CODE_CONECTAI = 'CONECTAI'
const ROLE_CODE_ADMINISTRADOR = 'ADMINISTRADOR'

interface CoreAdminAuthResult {
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

async function verifyCoreAdmin(
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SistemaInput {
  sistema_id: string
  perfil_id: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Token de autorização não fornecido.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Configuração do servidor ausente.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  try {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(token)

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida ou expirada.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminCheck = await verifyCoreAdmin(adminClient, user.id, [
      SYSTEM_CODE_CONECTAI,
      'GESTOR_ACESSO',
    ])

    if (!adminCheck.allowed || !adminCheck.coreUser) {
      return new Response(
        JSON.stringify({
          error:
            adminCheck.error ||
            'Acesso negado: privilégios de administrador ativo são obrigatórios.',
        }),
        {
          status: adminCheck.status || 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const body = await req.json()
    const { action } = body

    if (!action) {
      return new Response(JSON.stringify({ error: 'Parâmetro action ausente.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    async function validateSistemasPairs(
      sistemasInput: unknown,
    ): Promise<{ valid: boolean; error?: string; rows?: SistemaInput[] }> {
      if (!Array.isArray(sistemasInput)) {
        return { valid: true, rows: [] }
      }

      const { data: allSistemas, error: sErr } = await adminClient
        .from('core_sistemas')
        .select('id, codigo, nome, ativo')

      if (sErr || !allSistemas) {
        return { valid: false, error: 'Falha ao consultar catálogo de sistemas corporativos.' }
      }

      const { data: allPerfis, error: pErr } = await adminClient
        .from('core_perfis')
        .select('id, sistema_id, codigo, nome, ativo')

      if (pErr || !allPerfis) {
        return { valid: false, error: 'Falha ao consultar catálogo de perfis corporativos.' }
      }

      const sistemasMap = new Map(allSistemas.map((s) => [s.id, s]))
      const perfisMap = new Map(allPerfis.map((p) => [p.id, p]))

      const validatedList: SistemaInput[] = []
      const seenSistemas = new Set<string>()

      for (let i = 0; i < sistemasInput.length; i++) {
        const item = sistemasInput[i]
        if (!item || typeof item !== 'object') {
          return {
            valid: false,
            error: `Item de acesso no índice ${i} está com formato inválido.`,
          }
        }

        const sistema_id = item.sistema_id
        const perfil_id = item.perfil_id

        if (!sistema_id || !perfil_id) {
          return {
            valid: false,
            error: `Item de acesso no índice ${i} requer ambos sistema_id e perfil_id.`,
          }
        }

        if (seenSistemas.has(sistema_id)) {
          return {
            valid: false,
            error: `Sistema duplicado na lista de acessos (id: ${sistema_id}). Cada sistema só pode ter um perfil atribuído.`,
          }
        }
        seenSistemas.add(sistema_id)

        const sistema = sistemasMap.get(sistema_id)
        if (!sistema) {
          return {
            valid: false,
            error: `Sistema ${sistema_id} não existe no catálogo de sistemas corporativos.`,
          }
        }

        const perfil = perfisMap.get(perfil_id)
        if (!perfil) {
          return {
            valid: false,
            error: `Perfil ${perfil_id} não existe no catálogo de perfis corporativos.`,
          }
        }

        if (perfil.sistema_id !== sistema_id) {
          return {
            valid: false,
            error: `Incoerência de acesso: o perfil "${perfil.nome}" não pertence ao sistema "${sistema.nome}".`,
          }
        }

        validatedList.push({ sistema_id, perfil_id })
      }

      return { valid: true, rows: validatedList }
    }

    async function willKeepAtLeastOneGestorAcessoAdmin(
      targetUserId: string,
      prospectiveUserActive: boolean,
      prospectiveSistemas?: SistemaInput[],
    ): Promise<{ safe: boolean; error?: string }> {
      const { data: currentAdmins, error: adminQueryErr } = await adminClient
        .from('core_usuario_sistemas')
        .select(`
          id,
          usuario_id,
          ativo,
          core_usuarios!inner(id, ativo, email),
          core_sistemas!inner(codigo, ativo),
          core_perfis!inner(codigo, ativo)
        `)
        .eq('ativo', true)
        .eq('core_usuarios.ativo', true)
        .eq('core_sistemas.codigo', 'GESTOR_ACESSO')
        .eq('core_sistemas.ativo', true)
        .eq('core_perfis.codigo', 'ADMINISTRADOR')
        .eq('core_perfis.ativo', true)

      if (adminQueryErr) {
        return {
          safe: false,
          error: `Falha ao validar integridade de administradores: ${adminQueryErr.message}`,
        }
      }

      const isTargetCurrentlyGaAdmin = (currentAdmins || []).some(
        (a) => a.usuario_id === targetUserId,
      )
      if (!isTargetCurrentlyGaAdmin) {
        return { safe: true }
      }

      const otherActiveAdmins = (currentAdmins || []).filter((a) => a.usuario_id !== targetUserId)
      if (otherActiveAdmins.length > 0) {
        return { safe: true }
      }

      if (!prospectiveUserActive) {
        return {
          safe: false,
          error:
            'Operação bloqueada: não é permitido desativar o único Administrador ativo com perfil ADMINISTRADOR no sistema GESTOR_ACESSO.',
        }
      }

      if (prospectiveSistemas !== undefined) {
        const { data: gaSistema } = await adminClient
          .from('core_sistemas')
          .select('id')
          .eq('codigo', 'GESTOR_ACESSO')
          .maybeSingle()

        const { data: admPerfil } = await adminClient
          .from('core_perfis')
          .select('id')
          .eq('codigo', 'ADMINISTRADOR')
          .eq('sistema_id', gaSistema?.id || '')
          .maybeSingle()

        const stillHasAdminRole = prospectiveSistemas.some(
          (s) => s.sistema_id === gaSistema?.id && s.perfil_id === admPerfil?.id,
        )

        if (!stillHasAdminRole) {
          return {
            safe: false,
            error:
              'Operação bloqueada: não é permitido remover o perfil ADMINISTRADOR do sistema GESTOR_ACESSO do único administrador ativo existente.',
          }
        }
      }

      return { safe: true }
    }

    if (action === 'list_users') {
      const [usersResult, ldResult, profilesResult] = await Promise.all([
        adminClient
          .from('core_usuarios')
          .select(`
            id,
            auth_user_id,
            nome,
            email,
            ativo,
            gestor_id,
            core_usuario_sistemas(
              id,
              ativo,
              sistema_id,
              perfil_id,
              core_sistemas(id, codigo, nome, ativo),
              core_perfis(id, codigo, nome, ativo)
            )
          `)
          .order('nome', { ascending: true }),
        adminClient.from('legaldesk_usuarios').select('id, email, sigla, exibir_gestao_usuarios'),
        adminClient.from('profiles').select('id, legaldesk_usuario_id'),
      ])

      if (usersResult.error) throw usersResult.error
      const coreUsers = usersResult.data || []

      // Mapear legaldesk_usuarios por email lower
      const ldByEmail = new Map<string, { id: string; sigla: string | null; exibir: boolean }>()
      for (const ld of ldResult.data || []) {
        if (ld.email) {
          ldByEmail.set(ld.email.trim().toLowerCase(), {
            id: ld.id,
            sigla: ld.sigla || null,
            exibir: ld.exibir_gestao_usuarios !== false,
          })
        }
      }

      // Mapear ponte profiles por id (auth_user_id)
      const profByAuthId = new Map<string, string>()
      for (const p of profilesResult.data || []) {
        if (p.id && p.legaldesk_usuario_id) {
          profByAuthId.set(p.id, p.legaldesk_usuario_id)
        }
      }

      const gestorMap = new Map<string, string>()
      for (const u of coreUsers) {
        gestorMap.set(u.id, u.nome)
      }

      const usersList = coreUsers
        .filter((u) => {
          const ldMatch = ldByEmail.get(u.email.trim().toLowerCase())
          // Se tiver flag exibir_gestao_usuarios = false no legaldesk_usuarios, respeitar
          if (ldMatch && ldMatch.exibir === false) {
            return false
          }
          return true
        })
        .map((u) => {
          const conectaiLink = (u.core_usuario_sistemas || []).find(
            (cus: any) =>
              cus.core_sistemas?.codigo === SYSTEM_CODE_CONECTAI ||
              cus.sistema_id === '1b085fa4-a4fa-4490-889a-9fea074f41d7',
          )

          const temAcesso = Boolean(conectaiLink && conectaiLink.ativo === true && u.ativo === true)
          const perfilCodigo = conectaiLink?.core_perfis?.codigo || null
          const perfilNome = conectaiLink?.core_perfis?.nome || null
          const perfilId = conectaiLink?.perfil_id || null

          let status: 'sem_acesso' | 'ativo' | 'bloqueado' | 'inconsistente'
          if (!conectaiLink) {
            status = 'sem_acesso'
          } else if (!u.ativo || !conectaiLink.ativo) {
            status = 'bloqueado'
          } else if (u.ativo && conectaiLink.ativo) {
            status = 'ativo'
          } else {
            status = 'inconsistente'
          }

          const ldMatch = ldByEmail.get(u.email.trim().toLowerCase())
          const bridgeLdId = u.auth_user_id ? profByAuthId.get(u.auth_user_id) || null : null
          const resolvedLegaldeskId = ldMatch?.id || bridgeLdId || null

          return {
            id: u.id,
            core_usuario_id: u.id,
            auth_user_id: u.auth_user_id,
            legaldesk_id: resolvedLegaldeskId,
            sigla: ldMatch?.sigla || '',
            nome: u.nome,
            email: u.email,
            ativo: u.ativo,
            ativo_sys: temAcesso,
            gestor_id: u.gestor_id,
            gestor_nome: u.gestor_id ? gestorMap.get(u.gestor_id) || null : null,
            sistemas: (u.core_usuario_sistemas || []).map((s: any) => ({
              id: s.id,
              sistema_id: s.sistema_id,
              sistema_codigo: s.core_sistemas?.codigo,
              sistema_nome: s.core_sistemas?.nome,
              perfil_id: s.perfil_id,
              perfil_codigo: s.core_perfis?.codigo,
              perfil_nome: s.core_perfis?.nome,
              ativo: s.ativo,
            })),
            conectai: {
              tem_acesso: temAcesso,
              ativo: conectaiLink?.ativo ?? false,
              perfil_id: perfilId,
              perfil_codigo: perfilCodigo,
              perfil_nome: perfilNome,
            },
            status,
            tem_acesso: temAcesso,
            perfil: perfilCodigo ? perfilCodigo.toLowerCase() : null,
            perfil_codigo: perfilCodigo,
            perfil_nome: perfilNome,
          }
        })

      return new Response(JSON.stringify({ users: usersList }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list_perfis') {
      const sistemaCodigo = body.sistema_codigo || SYSTEM_CODE_CONECTAI

      const { data: sistemaData } = await adminClient
        .from('core_sistemas')
        .select('id')
        .eq('codigo', sistemaCodigo)
        .maybeSingle()

      let perfisQuery = adminClient
        .from('core_perfis')
        .select('id, sistema_id, codigo, nome, descricao, ativo')
        .eq('ativo', true)
        .order('nome', { ascending: true })

      if (sistemaData?.id) {
        perfisQuery = perfisQuery.eq('sistema_id', sistemaData.id)
      }

      const { data: perfis, error: perfisErr } = await perfisQuery
      if (perfisErr) throw perfisErr

      return new Response(JSON.stringify({ perfis: perfis || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list_gestores') {
      const { data: gestores, error: gestoresErr } = await adminClient
        .from('core_usuarios')
        .select('id, auth_user_id, nome, email, ativo')
        .eq('ativo', true)
        .order('nome', { ascending: true })

      if (gestoresErr) throw gestoresErr

      const mappedGestores = (gestores || []).map((g) => ({
        id: g.id,
        name: g.nome,
        nome: g.nome,
        email: g.email,
        auth_user_id: g.auth_user_id,
      }))

      return new Response(JSON.stringify({ gestores: mappedGestores }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'hide_from_management') {
      const targetUserId = body.usuario_id || body.id
      const targetLegaldeskId = body.legaldesk_id

      if (!targetUserId && !targetLegaldeskId) {
        return new Response(JSON.stringify({ error: 'ID do usuário ou ID legaldesk ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // 1. Se tem targetUserId, inativa no core_usuarios e revoga acesso Conectaí
      if (targetUserId) {
        await adminClient.from('core_usuarios').update({ ativo: false }).eq('id', targetUserId)

        const { data: conectaiSistema } = await adminClient
          .from('core_sistemas')
          .select('id')
          .eq('codigo', SYSTEM_CODE_CONECTAI)
          .maybeSingle()

        if (conectaiSistema) {
          const { data: currentAccesses } = await adminClient
            .from('core_usuario_sistemas')
            .select('sistema_id, perfil_id, ativo')
            .eq('usuario_id', targetUserId)
            .eq('ativo', true)

          const remainingAccesses = (currentAccesses || [])
            .filter((a) => a.sistema_id !== conectaiSistema.id)
            .map((a) => ({ sistema_id: a.sistema_id, perfil_id: a.perfil_id }))

          await adminClient.rpc('core_atualizar_usuario_acessos', {
            p_usuario_id: targetUserId,
            p_acessos: remainingAccesses,
          })
        }
      }

      // 2. Se tem targetLegaldeskId, marca exibir_gestao_usuarios = false
      if (targetLegaldeskId) {
        await adminClient
          .from('legaldesk_usuarios')
          .update({ exibir_gestao_usuarios: false })
          .eq('id', targetLegaldeskId)
      } else if (targetUserId) {
        // Tenta achar pelo email do core_usuario
        const { data: cu } = await adminClient
          .from('core_usuarios')
          .select('email')
          .eq('id', targetUserId)
          .maybeSingle()

        if (cu?.email) {
          await adminClient
            .from('legaldesk_usuarios')
            .update({ exibir_gestao_usuarios: false })
            .ilike('email', cu.email.trim())
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'grant_access' || action === 'set_system_access') {
      const targetUserId = body.usuario_id || body.id
      const targetPerfilCodigo = body.perfil
      const targetPerfilId = body.perfil_id
      const targetGestorId = body.gestor_id !== undefined ? body.gestor_id : undefined

      if (!targetUserId) {
        return new Response(JSON.stringify({ error: 'ID do usuário corporativo ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: conectaiSistema } = await adminClient
        .from('core_sistemas')
        .select('id, codigo, ativo')
        .eq('codigo', SYSTEM_CODE_CONECTAI)
        .maybeSingle()

      if (!conectaiSistema || !conectaiSistema.ativo) {
        return new Response(
          JSON.stringify({ error: 'Sistema Conectaí não encontrado ou inativo.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      let resolvedPerfilId: string | null = null
      if (targetPerfilId) {
        resolvedPerfilId = targetPerfilId
      } else if (targetPerfilCodigo) {
        const normCodigo = String(targetPerfilCodigo).trim().toUpperCase()
        const { data: perfilData } = await adminClient
          .from('core_perfis')
          .select('id')
          .eq('sistema_id', conectaiSistema.id)
          .ilike('codigo', normCodigo)
          .eq('ativo', true)
          .maybeSingle()

        if (!perfilData) {
          return new Response(
            JSON.stringify({
              error: `Perfil "${targetPerfilCodigo}" não encontrado para o Conectaí.`,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        resolvedPerfilId = perfilData.id
      } else {
        return new Response(JSON.stringify({ error: 'Perfil de acesso é obrigatório.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let validatedGestorId: string | null | undefined = undefined
      if (targetGestorId !== undefined) {
        if (
          targetGestorId &&
          typeof targetGestorId === 'string' &&
          targetGestorId.trim() &&
          targetGestorId !== 'none'
        ) {
          const trimmedGId = targetGestorId.trim()
          if (trimmedGId === targetUserId) {
            return new Response(
              JSON.stringify({ error: 'O usuário não pode ser gestor de si mesmo.' }),
              {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              },
            )
          }
          const { data: gestorData } = await adminClient
            .from('core_usuarios')
            .select('id, ativo')
            .eq('id', trimmedGId)
            .maybeSingle()

          if (!gestorData || !gestorData.ativo) {
            return new Response(
              JSON.stringify({ error: 'O gestor selecionado precisa estar ativo.' }),
              {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              },
            )
          }
          validatedGestorId = gestorData.id
        } else {
          validatedGestorId = null
        }
      }

      const { data: currentAccesses } = await adminClient
        .from('core_usuario_sistemas')
        .select('sistema_id, perfil_id, ativo')
        .eq('usuario_id', targetUserId)
        .eq('ativo', true)

      const otherAccesses = (currentAccesses || [])
        .filter((a) => a.sistema_id !== conectaiSistema.id)
        .map((a) => ({
          sistema_id: a.sistema_id,
          perfil_id: a.perfil_id,
        }))

      const newAccessesPayload = [
        ...otherAccesses,
        {
          sistema_id: conectaiSistema.id,
          perfil_id: resolvedPerfilId!,
        },
      ]

      const userUpdates: Record<string, any> = { ativo: true }
      if (validatedGestorId !== undefined) {
        userUpdates.gestor_id = validatedGestorId
      }

      const { error: userUpdateErr } = await adminClient
        .from('core_usuarios')
        .update(userUpdates)
        .eq('id', targetUserId)

      if (userUpdateErr) throw userUpdateErr

      const { error: rpcErr } = await adminClient.rpc('core_atualizar_usuario_acessos', {
        p_usuario_id: targetUserId,
        p_acessos: newAccessesPayload,
      })

      if (rpcErr) throw rpcErr

      const { data: targetUser } = await adminClient
        .from('core_usuarios')
        .select('id, email, nome, auth_user_id')
        .eq('id', targetUserId)
        .single()

      if (targetUser && !targetUser.auth_user_id) {
        try {
          const { data: authUsersList } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
          const existingAuth = (authUsersList?.users || []).find(
            (u) => u.email?.toLowerCase() === targetUser.email.toLowerCase(),
          )

          if (existingAuth) {
            await adminClient
              .from('core_usuarios')
              .update({ auth_user_id: existingAuth.id })
              .eq('id', targetUserId)
          } else {
            const inviteRedirectUrl = 'https://acessos-ricci.goskip.app/primeiro-acesso'
            const inviteOptions: { data: { nome: string }; redirectTo?: string } = {
              data: { nome: targetUser.nome },
              redirectTo: inviteRedirectUrl,
            }
            const { data: inviteData } = await adminClient.auth.admin.inviteUserByEmail(
              targetUser.email,
              inviteOptions,
            )
            if (inviteData?.user?.id) {
              await adminClient
                .from('core_usuarios')
                .update({ auth_user_id: inviteData.user.id })
                .eq('id', targetUserId)
            }
          }
        } catch (inviteErr) {
          console.warn('Aviso: convite auth não enviado na concessão:', inviteErr)
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          usuario_id: targetUserId,
          perfil_id: resolvedPerfilId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (action === 'inactivate_user') {
      const targetUserId = body.usuario_id || body.id

      if (!targetUserId) {
        return new Response(JSON.stringify({ error: 'ID do usuário corporativo ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const adminSafety = await willKeepAtLeastOneGestorAcessoAdmin(targetUserId, false)
      if (!adminSafety.safe) {
        return new Response(JSON.stringify({ error: adminSafety.error }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updatedUser, error: updateErr } = await adminClient
        .from('core_usuarios')
        .update({ ativo: false })
        .eq('id', targetUserId)
        .select()
        .single()

      if (updateErr) throw updateErr

      return new Response(JSON.stringify({ success: true, usuario: updatedUser }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'reactivate_user') {
      const targetUserId = body.usuario_id || body.id

      if (!targetUserId) {
        return new Response(JSON.stringify({ error: 'ID do usuário corporativo ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { error: updateErr } = await adminClient
        .from('core_usuarios')
        .update({ ativo: true })
        .eq('id', targetUserId)

      if (updateErr) throw updateErr

      const { data: conectaiSistema } = await adminClient
        .from('core_sistemas')
        .select('id')
        .eq('codigo', SYSTEM_CODE_CONECTAI)
        .maybeSingle()

      if (conectaiSistema) {
        const { data: currentAccesses } = await adminClient
          .from('core_usuario_sistemas')
          .select('sistema_id, perfil_id, ativo')
          .eq('usuario_id', targetUserId)

        const existingConectai = (currentAccesses || []).find(
          (a) => a.sistema_id === conectaiSistema.id,
        )

        let perfilId = existingConectai?.perfil_id
        if (!perfilId) {
          const { data: opPerfil } = await adminClient
            .from('core_perfis')
            .select('id')
            .eq('sistema_id', conectaiSistema.id)
            .eq('codigo', 'OPERACIONAL')
            .maybeSingle()
          perfilId = opPerfil?.id
        }

        if (perfilId) {
          const otherAccesses = (currentAccesses || [])
            .filter((a) => a.sistema_id !== conectaiSistema.id && a.ativo)
            .map((a) => ({
              sistema_id: a.sistema_id,
              perfil_id: a.perfil_id,
            }))

          const newPayload = [
            ...otherAccesses,
            { sistema_id: conectaiSistema.id, perfil_id: perfilId },
          ]

          await adminClient.rpc('core_atualizar_usuario_acessos', {
            p_usuario_id: targetUserId,
            p_acessos: newPayload,
          })
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'revoke_access') {
      const targetUserId = body.usuario_id || body.id

      if (!targetUserId) {
        return new Response(JSON.stringify({ error: 'ID do usuário corporativo ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: conectaiSistema } = await adminClient
        .from('core_sistemas')
        .select('id')
        .eq('codigo', SYSTEM_CODE_CONECTAI)
        .maybeSingle()

      if (!conectaiSistema) {
        return new Response(JSON.stringify({ error: 'Sistema Conectaí não encontrado.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: currentAccesses } = await adminClient
        .from('core_usuario_sistemas')
        .select('sistema_id, perfil_id, ativo')
        .eq('usuario_id', targetUserId)
        .eq('ativo', true)

      const remainingAccesses = (currentAccesses || [])
        .filter((a) => a.sistema_id !== conectaiSistema.id)
        .map((a) => ({
          sistema_id: a.sistema_id,
          perfil_id: a.perfil_id,
        }))

      const { error: rpcErr } = await adminClient.rpc('core_atualizar_usuario_acessos', {
        p_usuario_id: targetUserId,
        p_acessos: remainingAccesses,
      })

      if (rpcErr) throw rpcErr

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'set_gestor') {
      const targetUserId = body.usuario_id || body.id
      const targetGestorId = body.gestor_id

      if (!targetUserId) {
        return new Response(JSON.stringify({ error: 'ID do usuário corporativo ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let validatedGestorId: string | null = null
      if (
        targetGestorId &&
        typeof targetGestorId === 'string' &&
        targetGestorId.trim() &&
        targetGestorId !== 'none'
      ) {
        const trimmedGId = targetGestorId.trim()
        if (trimmedGId === targetUserId) {
          return new Response(
            JSON.stringify({ error: 'O usuário não pode ser gestor de si mesmo.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        const { data: gestorData } = await adminClient
          .from('core_usuarios')
          .select('id, ativo')
          .eq('id', trimmedGId)
          .maybeSingle()

        if (!gestorData || !gestorData.ativo) {
          return new Response(
            JSON.stringify({ error: 'O gestor selecionado precisa estar ativo.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        validatedGestorId = gestorData.id
      }

      const { error: updateErr } = await adminClient
        .from('core_usuarios')
        .update({ gestor_id: validatedGestorId })
        .eq('id', targetUserId)

      if (updateErr) throw updateErr

      return new Response(JSON.stringify({ success: true, gestor_id: validatedGestorId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'change_perfil') {
      const targetUserId = body.usuario_id || body.id
      const targetPerfilCodigo = body.perfil
      const targetPerfilId = body.perfil_id
      const targetEmail = body.email
      const targetGestorId = body.gestor_id

      if (!targetUserId) {
        return new Response(JSON.stringify({ error: 'ID do usuário ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: conectaiSistema } = await adminClient
        .from('core_sistemas')
        .select('id')
        .eq('codigo', SYSTEM_CODE_CONECTAI)
        .maybeSingle()

      if (!conectaiSistema) {
        return new Response(JSON.stringify({ error: 'Sistema Conectaí não localizado.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let resolvedPerfilId: string | null = null
      if (targetPerfilId) {
        resolvedPerfilId = targetPerfilId
      } else if (targetPerfilCodigo) {
        const normCodigo = String(targetPerfilCodigo).trim().toUpperCase()
        const { data: perfilData } = await adminClient
          .from('core_perfis')
          .select('id')
          .eq('sistema_id', conectaiSistema.id)
          .ilike('codigo', normCodigo)
          .eq('ativo', true)
          .maybeSingle()

        if (!perfilData) {
          return new Response(
            JSON.stringify({
              error: `Perfil "${targetPerfilCodigo}" não encontrado para o Conectaí.`,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        resolvedPerfilId = perfilData.id
      } else {
        return new Response(JSON.stringify({ error: 'Perfil de acesso é obrigatório.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let validatedGestorId: string | null = null
      if (
        targetGestorId &&
        typeof targetGestorId === 'string' &&
        targetGestorId.trim() &&
        targetGestorId !== 'none'
      ) {
        const trimmedGId = targetGestorId.trim()
        if (trimmedGId === targetUserId) {
          return new Response(
            JSON.stringify({ error: 'O usuário não pode ser gestor de si mesmo.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        const { data: gestorData } = await adminClient
          .from('core_usuarios')
          .select('id, ativo')
          .eq('id', trimmedGId)
          .maybeSingle()

        if (!gestorData || !gestorData.ativo) {
          return new Response(
            JSON.stringify({ error: 'O gestor selecionado precisa estar ativo.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        validatedGestorId = gestorData.id
      }

      const userUpdates: Record<string, any> = { gestor_id: validatedGestorId }
      if (targetEmail) {
        const normEmail = String(targetEmail).trim().toLowerCase()
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(normEmail)) {
          return new Response(JSON.stringify({ error: 'Formato de e-mail inválido.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const { data: existingEmailUser } = await adminClient
          .from('core_usuarios')
          .select('id')
          .ilike('email', normEmail)
          .neq('id', targetUserId)
          .maybeSingle()

        if (existingEmailUser) {
          return new Response(
            JSON.stringify({ error: 'Já existe outro usuário cadastrado com este e-mail.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }

        userUpdates.email = normEmail

        const { data: currCoreUser } = await adminClient
          .from('core_usuarios')
          .select('auth_user_id')
          .eq('id', targetUserId)
          .single()

        if (currCoreUser?.auth_user_id) {
          try {
            await adminClient.auth.admin.updateUserById(currCoreUser.auth_user_id, {
              email: normEmail,
            })
          } catch (authErr) {
            console.warn('Aviso ao sincronizar email no Auth:', authErr)
          }
        }
      }

      const { error: userUpdateErr } = await adminClient
        .from('core_usuarios')
        .update(userUpdates)
        .eq('id', targetUserId)

      if (userUpdateErr) throw userUpdateErr

      const { data: currentAccesses } = await adminClient
        .from('core_usuario_sistemas')
        .select('sistema_id, perfil_id, ativo')
        .eq('usuario_id', targetUserId)
        .eq('ativo', true)

      const otherAccesses = (currentAccesses || [])
        .filter((a) => a.sistema_id !== conectaiSistema.id)
        .map((a) => ({
          sistema_id: a.sistema_id,
          perfil_id: a.perfil_id,
        }))

      const newAccessesPayload = [
        ...otherAccesses,
        {
          sistema_id: conectaiSistema.id,
          perfil_id: resolvedPerfilId!,
        },
      ]

      const { error: rpcErr } = await adminClient.rpc('core_atualizar_usuario_acessos', {
        p_usuario_id: targetUserId,
        p_acessos: newAccessesPayload,
      })

      if (rpcErr) throw rpcErr

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'create_user') {
      const { nome, email, ativo, gestor_id, sistemas, perfil, send_invite } = body

      const normNome = String(nome || '').trim()
      const normEmail = String(email || '')
        .trim()
        .toLowerCase()
      const isAtivo = ativo ?? true

      if (!normNome || !normEmail) {
        return new Response(JSON.stringify({ error: 'Nome e e-mail são obrigatórios.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(normEmail)) {
        return new Response(JSON.stringify({ error: 'Formato de e-mail inválido.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: existingUser, error: checkEmailErr } = await adminClient
        .from('core_usuarios')
        .select('id')
        .ilike('email', normEmail)
        .maybeSingle()

      if (checkEmailErr) throw checkEmailErr
      if (existingUser) {
        return new Response(
          JSON.stringify({ error: 'Já existe um usuário cadastrado com este e-mail.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      let validatedGestorId: string | null = null
      if (gestor_id && typeof gestor_id === 'string' && gestor_id.trim() && gestor_id !== 'none') {
        const { data: gestorData, error: gestorErr } = await adminClient
          .from('core_usuarios')
          .select('id, ativo')
          .eq('id', gestor_id.trim())
          .maybeSingle()

        if (gestorErr || !gestorData) {
          return new Response(JSON.stringify({ error: 'Gestor informado não encontrado.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        if (!gestorData.ativo) {
          return new Response(
            JSON.stringify({ error: 'O gestor selecionado precisa estar ativo.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        validatedGestorId = gestorData.id
      }

      let rawSistemas = sistemas
      if (!rawSistemas && perfil) {
        const { data: conectaiSistema } = await adminClient
          .from('core_sistemas')
          .select('id')
          .eq('codigo', SYSTEM_CODE_CONECTAI)
          .maybeSingle()

        const normPerfilCodigo = String(perfil).trim().toUpperCase()
        const { data: perfilData } = await adminClient
          .from('core_perfis')
          .select('id')
          .eq('sistema_id', conectaiSistema?.id || '')
          .ilike('codigo', normPerfilCodigo)
          .maybeSingle()

        if (conectaiSistema && perfilData) {
          rawSistemas = [{ sistema_id: conectaiSistema.id, perfil_id: perfilData.id }]
        }
      }

      const valSistemas = await validateSistemasPairs(rawSistemas)
      if (!valSistemas.valid) {
        return new Response(JSON.stringify({ error: valSistemas.error }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const sanitizedSistemas: SistemaInput[] = valSistemas.rows || []

      const { data: newUsuario, error: insertUserErr } = await adminClient
        .from('core_usuarios')
        .insert({
          nome: normNome,
          email: normEmail,
          ativo: isAtivo,
          gestor_id: validatedGestorId,
          auth_user_id: null,
        })
        .select()
        .single()

      if (insertUserErr || !newUsuario) {
        throw insertUserErr || new Error('Falha ao inserir core_usuarios.')
      }

      const acessosPayload = sanitizedSistemas.map((item) => ({
        sistema_id: item.sistema_id,
        perfil_id: item.perfil_id,
      }))

      if (acessosPayload.length > 0) {
        const { error: rpcAcessosErr } = await adminClient.rpc('core_atualizar_usuario_acessos', {
          p_usuario_id: newUsuario.id,
          p_acessos: acessosPayload,
        })

        if (rpcAcessosErr) {
          await adminClient.from('core_usuarios').update({ ativo: false }).eq('id', newUsuario.id)
          return new Response(
            JSON.stringify({
              error: `Falha ao atribuir acessos do usuário: ${rpcAcessosErr.message}. O usuário foi criado inativo e sem acessos.`,
              usuario_id: newUsuario.id,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }
      }

      let linkedAuthUserId: string | null = null
      let inviteWarning: string | null = null

      try {
        const { data: authUsersList } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
        const existingAuth = (authUsersList?.users || []).find(
          (u) => u.email?.toLowerCase() === normEmail,
        )

        if (existingAuth) {
          linkedAuthUserId = existingAuth.id
          await adminClient
            .from('core_usuarios')
            .update({ auth_user_id: linkedAuthUserId })
            .eq('id', newUsuario.id)
        } else if ((send_invite ?? true) && isAtivo) {
          const inviteRedirectUrl = 'https://acessos-ricci.goskip.app/primeiro-acesso'
          const inviteOptions: { data: { nome: string }; redirectTo?: string } = {
            data: { nome: normNome },
            redirectTo: inviteRedirectUrl,
          }

          const { data: inviteData, error: inviteErr } =
            await adminClient.auth.admin.inviteUserByEmail(normEmail, inviteOptions)

          if (inviteErr) {
            console.error('Falha ao disparar convite Supabase Auth:', inviteErr)
            inviteWarning = `Usuário e acessos cadastrados com sucesso, mas o envio do convite falhou: ${inviteErr.message}.`
          } else if (inviteData?.user?.id) {
            linkedAuthUserId = inviteData.user.id
            await adminClient
              .from('core_usuarios')
              .update({ auth_user_id: linkedAuthUserId })
              .eq('id', newUsuario.id)
          }
        }
      } catch (authErr: unknown) {
        const aErr = authErr as Error
        console.error('Erro na etapa de associação de Auth/convite:', aErr)
        inviteWarning = `Usuário cadastrado com sucesso, mas ocorreu um erro no convite: ${aErr?.message}.`
      }

      const { data: finalUsuario } = await adminClient
        .from('core_usuarios')
        .select()
        .eq('id', newUsuario.id)
        .single()

      return new Response(
        JSON.stringify({
          success: true,
          usuario: finalUsuario || newUsuario,
          invite_sent: Boolean(linkedAuthUserId && !inviteWarning),
          invite_warning: inviteWarning,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (action === 'update_user') {
      const { id, nome, email, ativo, gestor_id, sistemas } = body

      if (!id) {
        return new Response(JSON.stringify({ error: 'ID do usuário ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const normNome = String(nome || '').trim()
      const normEmail = String(email || '')
        .trim()
        .toLowerCase()
      const prospectiveAtivo = ativo !== undefined ? Boolean(ativo) : true

      if (!normNome || !normEmail) {
        return new Response(JSON.stringify({ error: 'Nome e e-mail são obrigatórios.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (gestor_id && gestor_id === id) {
        return new Response(
          JSON.stringify({ error: 'O usuário não pode ser gestor de si mesmo.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const { data: existingEmailUser } = await adminClient
        .from('core_usuarios')
        .select('id')
        .ilike('email', normEmail)
        .neq('id', id)
        .maybeSingle()

      if (existingEmailUser) {
        return new Response(
          JSON.stringify({ error: 'Já existe outro usuário cadastrado com este e-mail.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      let validatedGestorId: string | null = null
      if (gestor_id && typeof gestor_id === 'string' && gestor_id.trim() && gestor_id !== 'none') {
        const { data: gestorData, error: gestorErr } = await adminClient
          .from('core_usuarios')
          .select('id, ativo')
          .eq('id', gestor_id.trim())
          .maybeSingle()

        if (gestorErr || !gestorData) {
          return new Response(JSON.stringify({ error: 'Gestor informado não encontrado.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        if (!gestorData.ativo) {
          return new Response(
            JSON.stringify({ error: 'O gestor selecionado precisa estar ativo.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
        validatedGestorId = gestorData.id
      }

      let validatedSistemas: SistemaInput[] | undefined = undefined
      if (Array.isArray(sistemas)) {
        const valSistemas = await validateSistemasPairs(sistemas)
        if (!valSistemas.valid) {
          return new Response(JSON.stringify({ error: valSistemas.error }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        validatedSistemas = valSistemas.rows || []
      }

      const adminSafety = await willKeepAtLeastOneGestorAcessoAdmin(
        id,
        prospectiveAtivo,
        validatedSistemas,
      )
      if (!adminSafety.safe) {
        return new Response(JSON.stringify({ error: adminSafety.error }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: updatedUser, error: updateErr } = await adminClient
        .from('core_usuarios')
        .update({
          nome: normNome,
          email: normEmail,
          ativo: prospectiveAtivo,
          gestor_id: validatedGestorId,
        })
        .eq('id', id)
        .select()
        .single()

      if (updateErr) throw updateErr

      if (validatedSistemas !== undefined) {
        const acessosPayload = validatedSistemas.map((item) => ({
          sistema_id: item.sistema_id,
          perfil_id: item.perfil_id,
        }))

        const { error: rpcAcessosErr } = await adminClient.rpc('core_atualizar_usuario_acessos', {
          p_usuario_id: id,
          p_acessos: acessosPayload,
        })

        if (rpcAcessosErr) {
          return new Response(
            JSON.stringify({
              error: `Falha ao atualizar acessos do usuário: ${rpcAcessosErr.message}`,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }
      }

      return new Response(JSON.stringify({ success: true, usuario: updatedUser }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'toggle_status') {
      const { id } = body

      if (!id) {
        return new Response(JSON.stringify({ error: 'ID do usuário ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: currentUser, error: getErr } = await adminClient
        .from('core_usuarios')
        .select('id, ativo')
        .eq('id', id)
        .single()

      if (getErr || !currentUser) {
        return new Response(JSON.stringify({ error: 'Usuário não encontrado.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const novoStatus = !currentUser.ativo

      if (!novoStatus) {
        const adminSafety = await willKeepAtLeastOneGestorAcessoAdmin(id, false)
        if (!adminSafety.safe) {
          return new Response(JSON.stringify({ error: adminSafety.error }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }

      const { data: updatedUser, error: updateErr } = await adminClient
        .from('core_usuarios')
        .update({ ativo: novoStatus })
        .eq('id', id)
        .select()
        .single()

      if (updateErr) throw updateErr

      return new Response(
        JSON.stringify({ success: true, usuario: updatedUser, ativo: novoStatus }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (action === 'invite_user') {
      const { id } = body

      if (!id) {
        return new Response(JSON.stringify({ error: 'ID do usuário ausente.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: usuario, error: userErr } = await adminClient
        .from('core_usuarios')
        .select('id, nome, email, auth_user_id, ativo')
        .eq('id', id)
        .single()

      if (userErr || !usuario) {
        return new Response(JSON.stringify({ error: 'Usuário não encontrado.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!usuario.ativo) {
        return new Response(
          JSON.stringify({
            error:
              'Operação não permitida: não é possível convidar ou redefinir senha de um usuário inativo.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const appUrlEnv = Deno.env.get('APP_URL')
      const APP_URL = appUrlEnv ? appUrlEnv.replace(/\/+$/, '') : null

      if (!APP_URL) {
        return new Response(
          JSON.stringify({
            error:
              'A variável segura APP_URL não está configurada no backend. Configure o domínio publicado do Gestor de Acessos.',
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const recoveryRedirectUrl = 'https://acessos-ricci.goskip.app/redefinir-senha'
      const inviteRedirectUrl = 'https://acessos-ricci.goskip.app/primeiro-acesso'

      if (usuario.auth_user_id) {
        const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(usuario.email, {
          redirectTo: recoveryRedirectUrl,
        })
        if (resetErr) throw resetErr

        return new Response(
          JSON.stringify({
            success: true,
            message: `Link de redefinição enviado com sucesso para ${usuario.email}.`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const { data: authUsersList } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
      const existingAuth = (authUsersList?.users || []).find(
        (u) => u.email?.toLowerCase() === usuario.email.toLowerCase(),
      )

      let authUserId: string | null = null
      if (existingAuth) {
        authUserId = existingAuth.id
        // Usuário já existe no Auth mas não estava vinculado no core_usuarios:
        // Não criar duplicata e enviar link de redefinição para o usuário definir/redefinir senha
        const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(usuario.email, {
          redirectTo: recoveryRedirectUrl,
        })
        if (resetErr) throw resetErr
      } else {
        const { data: inviteData, error: inviteErr } =
          await adminClient.auth.admin.inviteUserByEmail(usuario.email, {
            data: { nome: usuario.nome },
            redirectTo: inviteRedirectUrl,
          })

        if (inviteErr) throw inviteErr
        authUserId = inviteData.user?.id || null
      }
      if (authUserId) {
        await adminClient
          .from('core_usuarios')
          .update({ auth_user_id: authUserId })
          .eq('id', usuario.id)
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Convite de acesso despachado para ${usuario.email}.`,
          auth_user_id: authUserId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({ error: `Ação "${action}" não reconhecida.` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const error = err as Error
    console.error('Erro na função manage-core-user:', error)
    return new Response(JSON.stringify({ error: error?.message || 'Erro interno no servidor.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
