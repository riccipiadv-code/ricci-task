import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Token não encontrado' }), {
      status: 401,
      headers: corsHeaders,
    })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Configuração do servidor ausente.' }), {
      status: 500,
      headers: corsHeaders,
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    const token = authHeader.replace('Bearer ', '')
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)
    if (userError || !user) throw new Error('Não autorizado.')

    const body = await req.json()
    const { action, legaldesk_id, email, name, perfil } = body

    if (!action) {
      throw new Error('Parâmetro obrigatório ausente: action.')
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('perfil, ativo')
      .eq('id', user.id)
      .single()

    const adminActions = [
      'list_users',
      'list_perfis',
      'list_hidden_users',
      'create_user',
      'grant_access',
      'revoke_access',
      'change_perfil',
      'hide_from_management',
    ]

    if (adminActions.includes(action)) {
      if (!profile || !profile.ativo || profile.perfil !== 'administrador') {
        throw new Error('Permissão negada. Apenas administradores podem gerenciar usuários.')
      }
    }

    if (action === 'list_users') {
      // 1. Consultar todos os legaldesk_usuarios onde exibir_gestao_usuarios = true ordenados por nome
      const { data: ldUsers, error: ldError } = await supabase
        .from('legaldesk_usuarios')
        .select('*')
        .eq('exibir_gestao_usuarios', true)
        .order('nome')

      if (ldError) throw ldError

      // 2. Consultar todos os profiles
      const { data: profiles, error: profError } = await supabase.from('profiles').select('*')

      if (profError) throw profError

      // 3. Consultar todos os usuários de auth.users via listUsers (uma única chamada)
      const {
        data: { users: authUsers },
        error: authListError,
      } = await supabase.auth.admin.listUsers({ perPage: 1000 })

      if (authListError) throw authListError

      // Criar Set dos IDs de auth existentes
      const authUserIdsSet = new Set((authUsers || []).map((u) => u.id))

      // 4. Cruzar dados para cada legaldesk_usuario
      const usersList = (ldUsers || []).map((ld) => {
        // Vínculo exato de acesso Conectaí: profiles.legaldesk_usuario_id = legaldesk_usuarios.id
        const exactProf = profiles?.find((p) => p.legaldesk_usuario_id === ld.id)
        const temAcesso = Boolean(exactProf)

        // Vínculo principal: legaldesk_usuario_id; Fallback: e-mail (para compatibilidade das outras props)
        const prof =
          exactProf ||
          (ld.email
            ? profiles?.find((p) => p.email?.toLowerCase() === ld.email?.toLowerCase())
            : undefined)

        const profileId = prof?.id || null
        const perfilVal = prof?.perfil || null
        const ativoSys = prof?.ativo ?? false
        const authUserExists = profileId ? authUserIdsSet.has(profileId) : false

        let status: 'sem_acesso' | 'ativo' | 'bloqueado' | 'inconsistente'

        if (!prof && !authUserExists) {
          status = 'sem_acesso'
        } else if (prof && authUserExists && ativoSys) {
          status = 'ativo'
        } else if (prof && authUserExists && !ativoSys) {
          status = 'bloqueado'
        } else if (prof && !authUserExists) {
          status = 'inconsistente'
        } else {
          // Caso de fallback seguro (ex: sem profile mas authUserExists, trata como sem_acesso ou inconsistente)
          status = 'sem_acesso'
        }

        return {
          legaldesk_id: ld.id,
          nome: ld.nome,
          sigla: ld.sigla || '',
          email: ld.email || prof?.email || '',
          ativo_ld: ld.ativo ?? false,
          profile_id: profileId,
          perfil: perfilVal,
          ativo_sys: ativoSys,
          auth_user_exists: authUserExists,
          status,
          tem_acesso: temAcesso,
        }
      })

      return new Response(JSON.stringify({ users: usersList }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list_perfis') {
      const { data: perfis, error: perfisError } = await supabase
        .from('perfis_acesso')
        .select('codigo, nome')
        .eq('ativo', true)
        .order('ordem', { ascending: true })
        .order('nome', { ascending: true })

      if (perfisError) throw perfisError

      return new Response(JSON.stringify({ perfis: perfis || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list_responsaveis') {
      if (!profile || !profile.ativo) {
        throw new Error('Permissão negada. Usuário sem perfil ativo.')
      }

      // 1. Consultar todos os legaldesk_usuarios onde exibir_gestao_usuarios = true ordenados por nome
      const { data: ldUsers, error: ldError } = await supabase
        .from('legaldesk_usuarios')
        .select('id, nome, email')
        .eq('exibir_gestao_usuarios', true)
        .order('nome')

      if (ldError) throw ldError

      // 2. Consultar todos os profiles
      const { data: profiles, error: profError } = await supabase
        .from('profiles')
        .select('id, email, legaldesk_usuario_id, ativo')

      if (profError) throw profError

      // 3. Consultar todos os usuários de auth.users via listUsers (uma única chamada)
      const {
        data: { users: authUsers },
        error: authListError,
      } = await supabase.auth.admin.listUsers({ perPage: 1000 })

      if (authListError) throw authListError

      // Criar Set dos IDs de auth existentes
      const authUserIdsSet = new Set((authUsers || []).map((u) => u.id))

      // 4. Filtrar e mapear apenas os que possuem status "ativo"
      const responsaveisList = (ldUsers || [])
        .filter((ld) => {
          const prof =
            profiles?.find((p) => p.legaldesk_usuario_id === ld.id) ||
            (ld.email
              ? profiles?.find((p) => p.email?.toLowerCase() === ld.email?.toLowerCase())
              : undefined)

          const profileId = prof?.id || null
          const ativoSys = prof?.ativo ?? false
          const authUserExists = profileId ? authUserIdsSet.has(profileId) : false

          return prof && authUserExists && ativoSys
        })
        .map((ld) => ({
          id: ld.id,
          nome: ld.nome,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome))

      return new Response(JSON.stringify({ responsaveis: responsaveisList }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'list_hidden_users') {
      const { data: hiddenUsers, error: hiddenError } = await supabase
        .from('legaldesk_usuarios')
        .select('id, nome, sigla, email')
        .eq('exibir_gestao_usuarios', false)
        .order('nome')

      if (hiddenError) throw hiddenError

      return new Response(JSON.stringify({ users: hiddenUsers || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'create_user') {
      const { nome, sigla, email: inputEmail, perfil: inputPerfil } = body

      if (!nome || !sigla || !inputEmail || !inputPerfil) {
        throw new Error('Parâmetros obrigatórios ausentes: nome, sigla, email e perfil.')
      }

      // 1a. Normalização
      const normNome = String(nome).trim()
      const normSigla = String(sigla).trim().toUpperCase()
      const normEmail = String(inputEmail).trim().toLowerCase()
      const targetPerfil = String(inputPerfil).trim()

      if (!normNome || !normSigla || !normEmail || !targetPerfil) {
        throw new Error('Preencha todos os campos obrigatórios.')
      }

      // 1b. Validar perfil em public.perfis_acesso com ativo = true
      const { data: validPerfil, error: perfilError } = await supabase
        .from('perfis_acesso')
        .select('codigo')
        .eq('codigo', targetPerfil)
        .eq('ativo', true)
        .maybeSingle()

      if (perfilError || !validPerfil) {
        throw new Error('Perfil inválido.')
      }

      // 1c. Verificar duplicidade de e-mail (case-insensitive)
      // - legaldesk_usuarios.email
      const { data: ldEmailMatch, error: ldEmailErr } = await supabase
        .from('legaldesk_usuarios')
        .select('id')
        .ilike('email', normEmail)
        .limit(1)

      if (ldEmailErr) throw ldEmailErr
      if (ldEmailMatch && ldEmailMatch.length > 0) {
        throw new Error('Já existe um usuário cadastrado com este e-mail.')
      }

      // - profiles.email
      const { data: profEmailMatch, error: profEmailErr } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', normEmail)
        .limit(1)

      if (profEmailErr) throw profEmailErr
      if (profEmailMatch && profEmailMatch.length > 0) {
        throw new Error('Já existe um usuário cadastrado com este e-mail.')
      }

      // - Supabase Auth (listUsers)
      const {
        data: { users: authUsersList },
        error: authListErr,
      } = await supabase.auth.admin.listUsers({ perPage: 1000 })

      if (authListErr) throw authListErr
      const authEmailExists = (authUsersList || []).some(
        (u) => u.email?.toLowerCase() === normEmail,
      )
      if (authEmailExists) {
        throw new Error('Já existe um usuário cadastrado com este e-mail.')
      }

      // 1d. Verificar duplicidade de sigla (case-insensitive)
      const { data: ldSiglaMatch, error: ldSiglaErr } = await supabase
        .from('legaldesk_usuarios')
        .select('id')
        .ilike('sigla', normSigla)
        .limit(1)

      if (ldSiglaErr) throw ldSiglaErr
      if (ldSiglaMatch && ldSiglaMatch.length > 0) {
        throw new Error('Já existe um usuário cadastrado com esta sigla.')
      }

      // 1e. Criar legaldesk_usuarios
      const newLdId = crypto.randomUUID()
      const { error: ldInsertErr } = await supabase.from('legaldesk_usuarios').insert({
        id: newLdId,
        source_id: `CONECTAI:${newLdId}`,
        origem: 'CONECTAI',
        nome: normNome,
        sigla: normSigla,
        email: normEmail,
        ativo: true,
        exibir_gestao_usuarios: true,
      })

      if (ldInsertErr) {
        throw new Error(`Erro ao salvar usuário no LegalDesk: ${ldInsertErr.message}`)
      }

      // 1f. Criar Auth
      let authUserId: string | null = null
      const { data: authData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
        normEmail,
        {
          data: { name: normNome },
        },
      )

      if (inviteErr) {
        // Rollback: deletar SOMENTE o registro recém-criado em legaldesk_usuarios
        await supabase.from('legaldesk_usuarios').delete().eq('id', newLdId)

        if (
          inviteErr.message.includes('already exists') ||
          inviteErr.message.includes('already registered')
        ) {
          throw new Error('Já existe um usuário cadastrado com este e-mail.')
        } else {
          throw new Error(`Erro ao convidar usuário por e-mail: ${inviteErr.message}`)
        }
      }

      authUserId = authData.user?.id || null

      if (!authUserId) {
        // Rollback: deletar SOMENTE o registro recém-criado em legaldesk_usuarios
        await supabase.from('legaldesk_usuarios').delete().eq('id', newLdId)
        throw new Error('Não foi possível obter o ID do usuário Auth.')
      }

      // 1g. Completar Profile
      // O trigger on_auth_user_created -> handle_new_user() pode já ter inserido o profile correspondente pelo authUserId.
      // Usamos upsert ou update por id.
      const { error: profileUpsertErr } = await supabase.from('profiles').upsert(
        {
          id: authUserId,
          name: normNome,
          email: normEmail,
          legaldesk_usuario_id: newLdId,
          perfil: targetPerfil,
          ativo: true,
        },
        { onConflict: 'id' },
      )

      if (profileUpsertErr) {
        // Marcar usuário no LegalDesk como inconsistente (sem exibir na gestão e inativo)
        await supabase
          .from('legaldesk_usuarios')
          .update({ exibir_gestao_usuarios: false, ativo: false })
          .eq('id', newLdId)

        throw new Error(
          'O acesso ao sistema foi criado, mas a configuração do perfil falhou. O usuário foi marcado como inconsistente. Contate o suporte técnico.',
        )
      }

      return new Response(
        JSON.stringify({
          success: true,
          legaldesk_id: newLdId,
          profile_id: authUserId,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!legaldesk_id) {
      throw new Error('Parâmetros obrigatórios ausentes: legaldesk_id.')
    }

    // 1. Localizar o profile existente: PRIMEIRO por legaldesk_usuario_id, DEPOIS fallback por email
    let { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, email, legaldesk_usuario_id, perfil, ativo, name')
      .eq('legaldesk_usuario_id', legaldesk_id)
      .maybeSingle()

    if (!existingProfile && email) {
      const { data: profileByEmail } = await supabase
        .from('profiles')
        .select('id, email, legaldesk_usuario_id, perfil, ativo, name')
        .eq('email', email)
        .maybeSingle()
      existingProfile = profileByEmail
    }

    if (action === 'grant_access') {
      const targetLegaldeskId = body.legaldesk_usuario_id || legaldesk_id
      const targetPerfil = String(perfil || '').trim()

      if (!targetLegaldeskId) {
        throw new Error('Parâmetro obrigatório ausente: legaldesk_usuario_id.')
      }

      if (!targetPerfil) {
        throw new Error('Perfil de acesso é obrigatório.')
      }

      // 2. Validar que o perfil desejado existe e está ativo em perfis_acesso
      const { data: validPerfil, error: perfilError } = await supabase
        .from('perfis_acesso')
        .select('codigo')
        .eq('codigo', targetPerfil)
        .eq('ativo', true)
        .maybeSingle()

      if (perfilError || !validPerfil) {
        throw new Error('Perfil de acesso inválido ou inativo.')
      }

      // 3. Buscar novamente o registro em legaldesk_usuarios pelo ID (não confiar em nome/email do frontend)
      const { data: ldUser, error: ldUserErr } = await supabase
        .from('legaldesk_usuarios')
        .select('id, nome, email, ativo')
        .eq('id', targetLegaldeskId)
        .maybeSingle()

      if (ldUserErr) throw ldUserErr
      if (!ldUser) {
        throw new Error('Colaborador não encontrado no cadastro de usuários.')
      }

      if (!ldUser.ativo) {
        throw new Error('Colaborador está inativo no cadastro.')
      }

      const ldEmail = String(ldUser.email || '')
        .trim()
        .toLowerCase()
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!ldEmail || !emailRegex.test(ldEmail)) {
        throw new Error('Colaborador não possui um e-mail válido cadastrado.')
      }

      // 4. Verificar se já existe profiles vinculado pelo legaldesk_usuario_id
      const { data: profByLdId, error: profByLdErr } = await supabase
        .from('profiles')
        .select('id, email, legaldesk_usuario_id')
        .eq('legaldesk_usuario_id', targetLegaldeskId)
        .maybeSingle()

      if (profByLdErr) throw profByLdErr
      if (profByLdId) {
        throw new Error('Este colaborador já possui acesso configurado no sistema.')
      }

      // 5. Verificar se já existe profile com o mesmo e-mail
      const { data: profByEmail, error: profByEmailErr } = await supabase
        .from('profiles')
        .select('id, email, legaldesk_usuario_id')
        .ilike('email', ldEmail)
        .maybeSingle()

      if (profByEmailErr) throw profByEmailErr
      if (profByEmail) {
        throw new Error('Já existe um perfil com este e-mail cadastrado no sistema.')
      }

      // 6. Verificar se já existe usuário no Supabase Auth com o mesmo e-mail
      const {
        data: { users: authUsersList },
        error: authListErr,
      } = await supabase.auth.admin.listUsers({ perPage: 1000 })

      if (authListErr) throw authListErr
      const authUserExists = (authUsersList || []).some((u) => u.email?.toLowerCase() === ldEmail)

      if (authUserExists) {
        throw new Error(
          'Já existe um usuário no Supabase Auth com este e-mail. Não é possível duplicar.',
        )
      }

      // 7. Criar/convidar no Supabase Auth usando o mesmo mecanismo seguro de create_user
      const { data: authData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
        ldEmail,
        {
          data: { name: ldUser.nome },
        },
      )

      if (inviteErr) {
        if (
          inviteErr.message.includes('already exists') ||
          inviteErr.message.includes('already registered')
        ) {
          throw new Error('Já existe um usuário cadastrado no Auth com este e-mail.')
        }
        throw new Error(`Erro ao convidar usuário por e-mail: ${inviteErr.message}`)
      }

      const authUserId = authData.user?.id
      if (!authUserId) {
        throw new Error('Não foi possível obter o ID do usuário criado no Auth.')
      }

      // 8. Criar/completar o profile correspondente
      // Nota: trigger handle_new_user pode ter inserido esqueleto de profile no insert do auth.users,
      // então utilizamos upsert por id.
      const { error: profileUpsertErr } = await supabase.from('profiles').upsert(
        {
          id: authUserId,
          name: ldUser.nome,
          email: ldEmail,
          legaldesk_usuario_id: targetLegaldeskId,
          perfil: targetPerfil,
          ativo: true,
        },
        { onConflict: 'id' },
      )

      if (profileUpsertErr) {
        console.error('Falha ao criar/atualizar profile após criação no Auth:', profileUpsertErr)
        throw new Error(
          'O usuário foi criado no Auth, mas o perfil não foi concluído corretamente. Contate o suporte técnico.',
        )
      }

      return new Response(
        JSON.stringify({
          success: true,
          legaldesk_usuario_id: targetLegaldeskId,
          profile_id: authUserId,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (action === 'revoke_access') {
      if (!existingProfile) {
        throw new Error('Usuário não possui perfil ativo para revogar acesso.')
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ ativo: false })
        .eq('id', existingProfile.id)

      if (updateError) throw updateError

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'change_perfil') {
      if (!existingProfile) {
        throw new Error('Usuário não possui perfil para alterar permissão.')
      }
      if (!perfil) {
        throw new Error('Perfil inválido.')
      }

      // Consultar perfis válidos ativos no banco
      const { data: validPerfisData, error: perfisError } = await supabase
        .from('perfis_acesso')
        .select('codigo')
        .eq('ativo', true)

      if (perfisError) throw perfisError

      const validPerfis = (validPerfisData || []).map((p: { codigo: string }) => p.codigo)
      if (!validPerfis.includes(perfil)) {
        throw new Error(`Perfil inválido: ${perfil}`)
      }

      // 1. Reler os dados atuais completos para garantir consistência e ter dados de backup para compensação
      const { data: currentProfile, error: currProfErr } = await supabase
        .from('profiles')
        .select('id, email, legaldesk_usuario_id, perfil, name')
        .eq('id', existingProfile.id)
        .single()

      if (currProfErr || !currentProfile) {
        throw new Error('Não foi possível carregar os dados atuais do perfil.')
      }

      const currentLdId = currentProfile.legaldesk_usuario_id || legaldesk_id
      const { data: currentLdUser, error: currLdErr } = await supabase
        .from('legaldesk_usuarios')
        .select('id, email, nome, sigla, origem, source_id')
        .eq('id', currentLdId)
        .single()

      if (currLdErr || !currentLdUser) {
        throw new Error('Não foi possível carregar os dados atuais do colaborador.')
      }

      // 2. Verificar se o e-mail foi enviado e se houve alteração
      let isEmailChanged = false
      let normNewEmail = ''
      const previousEmail = currentProfile.email || currentLdUser.email || ''

      if (email !== undefined && email !== null) {
        const rawEmail = String(email).trim().toLowerCase()
        if (!rawEmail) {
          throw new Error('E-mail é obrigatório.')
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(rawEmail)) {
          throw new Error('Formato de e-mail inválido.')
        }

        normNewEmail = rawEmail
        if (normNewEmail !== String(previousEmail).trim().toLowerCase()) {
          isEmailChanged = true
        }
      }

      // 3. Se o e-mail mudou, validar duplicidade em: legaldesk_usuarios, profiles e Supabase Auth
      if (isEmailChanged) {
        // 3a. legaldesk_usuarios (excluindo o próprio currentLdId)
        const { data: ldMatch, error: ldCheckErr } = await supabase
          .from('legaldesk_usuarios')
          .select('id')
          .ilike('email', normNewEmail)
          .neq('id', currentLdId)
          .limit(1)

        if (ldCheckErr) throw ldCheckErr
        if (ldMatch && ldMatch.length > 0) {
          throw new Error('Este e-mail já está vinculado a outro usuário.')
        }

        // 3b. profiles (excluindo o próprio currentProfile.id)
        const { data: profMatch, error: profCheckErr } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', normNewEmail)
          .neq('id', currentProfile.id)
          .limit(1)

        if (profCheckErr) throw profCheckErr
        if (profMatch && profMatch.length > 0) {
          throw new Error('Este e-mail já está vinculado a outro usuário.')
        }

        // 3c. Supabase Auth (listUsers, excluindo o próprio currentProfile.id)
        const {
          data: { users: authUsersList },
          error: authListErr,
        } = await supabase.auth.admin.listUsers({ perPage: 1000 })

        if (authListErr) throw authListErr
        const otherAuthUserExists = (authUsersList || []).some(
          (u) => u.id !== currentProfile.id && u.email?.toLowerCase() === normNewEmail,
        )

        if (otherAuthUserExists) {
          throw new Error('Este e-mail já está vinculado a outro usuário.')
        }
      }

      // 4. Executar atualizações com tratamento de compensação/rollback em caso de falha parcial
      const previousPerfil = currentProfile.perfil
      const previousLdEmail = currentLdUser.email
      const previousProfEmail = currentProfile.email

      if (isEmailChanged) {
        // Etapa 1: Atualizar Auth via API administrativa
        const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(
          currentProfile.id,
          {
            email: normNewEmail,
          },
        )

        if (authUpdateErr) {
          throw new Error(`Falha ao atualizar e-mail no Auth: ${authUpdateErr.message}`)
        }

        // Etapa 2: Atualizar profiles (email e perfil)
        const { error: profUpdateErr } = await supabase
          .from('profiles')
          .update({
            email: normNewEmail,
            perfil,
          })
          .eq('id', currentProfile.id)

        if (profUpdateErr) {
          // Compensação: reverter Auth para o email anterior
          console.error('Falha ao atualizar profiles. Revertendo Auth...', profUpdateErr)
          try {
            if (previousProfEmail) {
              await supabase.auth.admin.updateUserById(currentProfile.id, {
                email: previousProfEmail,
              })
            }
          } catch (compErr) {
            console.error('Falha na compensação do Auth:', compErr)
          }
          throw new Error(
            `Falha ao sincronizar e-mail no perfil do usuário: ${profUpdateErr.message}`,
          )
        }

        // Etapa 3: Atualizar legaldesk_usuarios (somente email)
        const { error: ldUpdateErr } = await supabase
          .from('legaldesk_usuarios')
          .update({
            email: normNewEmail,
          })
          .eq('id', currentLdId)

        if (ldUpdateErr) {
          // Compensação: reverter profiles e Auth
          console.error(
            'Falha ao atualizar legaldesk_usuarios. Revertendo profiles e Auth...',
            ldUpdateErr,
          )
          try {
            await supabase
              .from('profiles')
              .update({
                email: previousProfEmail,
                perfil: previousPerfil,
              })
              .eq('id', currentProfile.id)

            if (previousProfEmail) {
              await supabase.auth.admin.updateUserById(currentProfile.id, {
                email: previousProfEmail,
              })
            }
          } catch (compErr) {
            console.error('Falha na compensação de profiles/Auth:', compErr)
          }
          throw new Error(
            `Falha ao sincronizar e-mail no cadastro de colaboradores: ${ldUpdateErr.message}`,
          )
        }
      } else {
        // Se o e-mail não foi alterado, atualizar apenas o perfil em profiles
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ perfil })
          .eq('id', currentProfile.id)

        if (updateError) throw updateError
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'hide_from_management') {
      // Proteção contra autoexclusão
      if (existingProfile?.id && existingProfile.id === user.id) {
        throw new Error('Você não pode ocultar sua própria conta.')
      }

      // Passo 1: UPDATE legaldesk_usuarios SET exibir_gestao_usuarios = false WHERE id = legaldesk_id
      // Se falhar -> ABORTAR (throw error)
      const { error: ldHideError } = await supabase
        .from('legaldesk_usuarios')
        .update({ exibir_gestao_usuarios: false })
        .eq('id', legaldesk_id)

      if (ldHideError) {
        throw new Error(`Falha ao inativar usuário no LegalDesk: ${ldHideError.message}`)
      }

      // Passo 2: Se existir profile, UPDATE profiles SET ativo = false WHERE id = existingProfile.id
      // Se falhar -> logar mas NÃO reverter o passo 1 (o usuário já foi inativado da gestão)
      // Se NÃO existir profile -> não faz nada em profiles, nunca cria profile e nunca faz DELETE
      let deactivated = false
      if (existingProfile?.id) {
        const { error: profDeactivateError } = await supabase
          .from('profiles')
          .update({ ativo: false })
          .eq('id', existingProfile.id)

        if (profDeactivateError) {
          console.error('Erro ao desativar perfil do usuário:', profDeactivateError)
        } else {
          deactivated = true
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          hidden: true,
          deactivated,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    throw new Error(`Ação desconhecida: ${action}`)
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
