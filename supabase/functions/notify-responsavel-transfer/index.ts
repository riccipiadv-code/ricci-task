import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer'
import { resolveGestorFromCore } from '../_shared/core-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Token de autenticação não encontrado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Erro interno de configuração de servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)

    if (userError || !user) throw new Error('Não autorizado.')

    const body = await req.json()
    const {
      type, // 'reabertura' | undefined/null/'transfer'
      contato_id,
      previous_responsavel_id,
      new_responsavel_id,
      responsavel_id,
      previous_stage,
      new_stage,
      // Contrato Central (Etapa de migração para responsavel_core_usuario_id)
      previous_responsavel_core_usuario_id,
      new_responsavel_core_usuario_id,
      responsavel_core_usuario_id,
    } = body

    const isReabertura = type === 'reabertura'

    let targetCoreUsuarioId: string | null = null

    if (isReabertura) {
      // Regra de reabertura:
      // previous_stage = cancelado E new_stage != cancelado E new_stage != orcamento_aprovado
      const prevStageNorm = (previous_stage || '').trim().toLowerCase()
      const newStageNorm = (new_stage || '').trim().toLowerCase()

      if (prevStageNorm !== 'cancelado') {
        return new Response(
          JSON.stringify({ triggered: false, reason: 'previous_stage_not_cancelado' }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (newStageNorm === 'cancelado' || newStageNorm === 'orcamento_aprovado') {
        return new Response(
          JSON.stringify({ triggered: false, reason: 'excluded_stage_transition' }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      targetCoreUsuarioId = responsavel_core_usuario_id ? String(responsavel_core_usuario_id) : null

      // Se responsavel_core_usuario_id não foi passado no body, buscar do contato no banco
      if (!targetCoreUsuarioId && contato_id) {
        const { data: cData } = await supabase
          .from('manychat_contatos')
          .select('responsavel_core_usuario_id')
          .eq('id', contato_id)
          .maybeSingle()
        if (cData?.responsavel_core_usuario_id) {
          targetCoreUsuarioId = String(cData.responsavel_core_usuario_id)
        }
      }

      // Fallback de compatibilidade se enviado responsavel_id antigo (sem quebrar clientes que ainda não atualizaram)
      if (!targetCoreUsuarioId && responsavel_id) {
        // Tentar resolver core_usuarios via core_usuarios.id ou profiles
        targetCoreUsuarioId = String(responsavel_id)
      }

      if (!targetCoreUsuarioId) {
        console.error('Reabertura Conectaí: Atendimento sem responsável atribuído.', {
          contato_id,
          responsavel_core_usuario_id,
          responsavel_id,
        })
        return new Response(
          JSON.stringify({ triggered: false, reason: 'no_responsavel_for_reabertura' }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    } else {
      // 1. Validar se novo responsável foi informado (Nova atribuição)
      const newCentralId = new_responsavel_core_usuario_id || new_responsavel_id
      if (!newCentralId) {
        return new Response(JSON.stringify({ triggered: false, reason: 'no_new_responsavel' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // 2. Validar se houve mudança de responsável (anterior diferente do novo)
      const prevCentralId = previous_responsavel_core_usuario_id || previous_responsavel_id
      const prevIdNorm = prevCentralId ? String(prevCentralId) : null
      const newIdNorm = String(newCentralId)
      if (prevIdNorm === newIdNorm) {
        return new Response(
          JSON.stringify({ triggered: false, reason: 'responsavel_not_changed' }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      targetCoreUsuarioId = newIdNorm
    }

    // 3. Buscar o responsável diretamente em core_usuarios (nome + email)
    // NÃO usar profiles.legaldesk_usuario_id para resolver responsável ou gestor.
    let { data: responsavel, error: respError } = await supabase
      .from('core_usuarios')
      .select('id, nome, email, ativo')
      .eq('id', targetCoreUsuarioId)
      .maybeSingle()

    if (respError) throw respError

    // Se não encontrou em core_usuarios pelo id direto (caso raro de envio com id de legaldesk_usuarios),
    // fazer fallback de compatibilidade buscando legaldesk_usuarios
    if (!responsavel) {
      const { data: legacyResp } = await supabase
        .from('legaldesk_usuarios')
        .select('id, nome, email')
        .eq('id', targetCoreUsuarioId)
        .maybeSingle()

      if (legacyResp) {
        // Tentar encontrar o usuário corporativo correspondente por e-mail em core_usuarios
        if (legacyResp.email) {
          const { data: coreByEmail } = await supabase
            .from('core_usuarios')
            .select('id, nome, email, ativo')
            .ilike('email', legacyResp.email.trim())
            .maybeSingle()
          if (coreByEmail) {
            responsavel = coreByEmail
            targetCoreUsuarioId = coreByEmail.id
          }
        }
        if (!responsavel) {
          responsavel = {
            id: legacyResp.id,
            nome: legacyResp.nome,
            email: legacyResp.email,
            ativo: true,
          }
        }
      }
    }

    // 4. Se não encontrar responsável ou email for nulo/vazio
    const destEmail = responsavel?.email?.trim()
    if (!responsavel || !destEmail) {
      console.error('Responsável não encontrado ou sem e-mail cadastrado em core_usuarios:', {
        targetCoreUsuarioId,
        responsavel,
        isReabertura,
      })
      return new Response(JSON.stringify({ triggered: false, reason: 'no_email' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Buscar o contato em manychat_contatos com serviço e origem
    const { data: contato, error: contatoError } = await supabase
      .from('manychat_contatos')
      .select(
        'controle, lead_nome, lead_empresa_pf, lead_servico, origem, manychat_live_chat_url, manychat_servicos(descricao), manychat_origens(nome)',
      )
      .eq('id', contato_id)
      .maybeSingle()

    if (contatoError) throw contatoError
    if (!contato) throw new Error('Contato não encontrado.')

    // 5.1. Buscar gestor vinculado diretamente pelo core_* (core_usuarios.gestor_id)
    // NÃO utilizar profiles.legaldesk_usuario_id nem profiles.gestor_id.
    const { gestorEmail } = await resolveGestorFromCore(supabase, targetCoreUsuarioId, destEmail)

    // 6. Buscar configuração ativa do E-mail Geral
    const { data: setting, error: settingError } = await supabase
      .from('email_settings')
      .select('*')
      .eq('active', true)
      .limit(1)
      .maybeSingle()

    if (settingError) throw settingError
    if (!setting) throw new Error('Nenhuma configuração de e-mail ativa encontrada.')

    const { data: secretData } = await supabase
      .from('email_secrets')
      .select('secret_value')
      .eq('setting_id', setting.id)
      .limit(1)
      .maybeSingle()

    const secret = secretData?.secret_value
    if (!secret && setting.secret_configured) {
      throw new Error('Configuração de e-mail possui senha, mas não foi possível carregá-la.')
    }
    if (!secret) {
      throw new Error('A senha do e-mail não foi configurada.')
    }

    // 7. Montar o e-mail
    const fullName = (responsavel.nome || '').trim()
    const firstName = fullName ? fullName.split(/\s+/)[0] : 'Responsável'

    const controleStr = contato.controle != null ? String(contato.controle) : ''
    const subject = isReabertura
      ? `Reabertura Conectaí [${controleStr}]`
      : `Nova atribuição Conectaí [${controleStr}]`

    // Determinar Serviço: lead_servico ou manychat_servicos.descricao
    let servicoNome = (contato.lead_servico || '').trim()
    if (!servicoNome) {
      const ms = contato.manychat_servicos as any
      if (Array.isArray(ms) && ms.length > 0) {
        servicoNome = (ms[0]?.descricao || '').trim()
      } else if (ms?.descricao) {
        servicoNome = (ms.descricao || '').trim()
      }
    }

    const empresaStr = (contato.lead_empresa_pf || '').trim()
    const contatoNome = (contato.lead_nome || '').trim()
    const liveChatUrl = (contato.manychat_live_chat_url || '').trim()

    // Determinar Origem: manychat_origens.nome ou contato.origem
    let origemNome = ''
    const mo = contato.manychat_origens as any
    if (Array.isArray(mo) && mo.length > 0) {
      origemNome = (mo[0]?.nome || '').trim()
    } else if (mo?.nome) {
      origemNome = (mo.nome || '').trim()
    }
    if (!origemNome && contato.origem) {
      origemNome = String(contato.origem).trim()
    }

    // Montar corpo (texto simples)
    const openingLine = isReabertura
      ? 'Um atendimento sob sua responsabilidade foi reaberto no Conectaí.'
      : 'Um novo atendimento foi atribuído a você no Conectaí.'

    const bodyLines: string[] = [
      `Olá, ${firstName}.`,
      '',
      openingLine,
      '',
      `Controle: ${controleStr}`,
      `Contato: ${contatoNome}`,
    ]

    if (empresaStr) {
      bodyLines.push(`Empresa: ${empresaStr}`)
    }

    if (servicoNome) {
      bodyLines.push(`Serviço: ${servicoNome}`)
    }

    if (origemNome) {
      bodyLines.push(`Origem: ${origemNome}`)
    }

    bodyLines.push('')
    bodyLines.push('Acesse o Conectaí para consultar o atendimento.')
    bodyLines.push('https://conectai.goskip.app/')

    if (liveChatUrl) {
      bodyLines.push('')
      bodyLines.push(`Link direto ManyChat: ${liveChatUrl}`)
    }

    const emailText = bodyLines.join('\n')

    // 8. Configurar transporte SMTP
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

    const mailOptions: {
      from: string
      to: string
      cc?: string
      replyTo?: string
      subject: string
      text: string
    } = {
      from: `"${setting.sender_name}" <${setting.sender_email}>`,
      to: destEmail,
      ...(gestorEmail ? { cc: gestorEmail } : {}),
      replyTo: setting.reply_to || undefined,
      subject,
      text: emailText,
    }

    // 9. Enviar e logar
    try {
      await transporter.sendMail(mailOptions)
    } catch (sendError: any) {
      await supabase.from('email_send_logs').insert({
        type: 'notification',
        to_email: destEmail,
        subject: mailOptions.subject,
        status: 'error',
        error_message: sendError.message || String(sendError),
        created_by: user.id,
        created_at: new Date().toISOString(),
      })
      return new Response(
        JSON.stringify({
          success: false,
          triggered: true,
          error: `Erro ao enviar e-mail pelo provedor: ${sendError.message}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const { error: logError } = await supabase.from('email_send_logs').insert({
      type: 'notification',
      to_email: destEmail,
      subject: mailOptions.subject,
      status: 'success',
      created_by: user.id,
      created_at: new Date().toISOString(),
    })

    if (logError) {
      console.error('Erro ao logar envio de notificação:', logError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        triggered: true,
        message: 'Notificação enviada com sucesso.',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
