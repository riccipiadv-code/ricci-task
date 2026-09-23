import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type',
}

function isValidEmail(email?: string | null): boolean {
  if (!email) return false
  const trimmed = email.trim()
  if (!trimmed) return false
  // Validação simples e segura de formato de e-mail
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

function formatDateBR(dateString?: string | null): string {
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

Deno.serve(async (req: Request) => {
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
    // 1. Validar autenticação do usuário
    const token = authHeader.replace('Bearer ', '')
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

    // 2. Extrair parâmetros
    const body = await req.json().catch(() => ({}))
    const { tarefa_id, tipo } = body

    if (!tarefa_id) {
      return new Response(JSON.stringify({ error: 'Parâmetro tarefa_id é obrigatório.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (tipo !== 'nova_atribuicao' && tipo !== 'alteracao_atribuicao') {
      return new Response(
        JSON.stringify({
          error:
            "Parâmetro tipo inválido. Valores aceitos: 'nova_atribuicao' ou 'alteracao_atribuicao'.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 3. Buscar dados de task_tarefas com nome do controle
    const { data: tarefa, error: tarefaError } = await supabase
      .from('task_tarefas')
      .select(`
        id,
        numero_caso,
        identificacao_caso,
        nome_controle_id,
        executor_usuario_id,
        responsavel_usuario_id,
        deleted_at,
        nome_controle:task_nomes_controle(nome)
      `)
      .eq('id', tarefa_id)
      .maybeSingle()

    if (tarefaError) {
      console.error('Erro ao consultar task_tarefas:', tarefaError)
      throw new Error(`Erro ao consultar tarefa: ${tarefaError.message}`)
    }

    if (!tarefa) {
      return new Response(JSON.stringify({ error: 'Tarefa não encontrada.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (tarefa.deleted_at) {
      return new Response(
        JSON.stringify({
          triggered: false,
          sent: false,
          reason: 'tarefa_excluida',
          message: 'A tarefa informada está excluída.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Resolver nome do controle
    let nomeControle = ''
    if (tarefa.nome_controle) {
      const nc = tarefa.nome_controle as any
      nomeControle = (nc.nome || '').trim()
    } else if (tarefa.nome_controle_id) {
      const { data: ncData } = await supabase
        .from('task_nomes_controle')
        .select('nome')
        .eq('id', tarefa.nome_controle_id)
        .maybeSingle()
      nomeControle = (ncData?.nome || '').trim()
    }

    // 4. Buscar Executor e Responsável em task_usuarios (NÃO em profiles / legaldesk_usuarios)
    const userIdsToFetch: string[] = []
    if (tarefa.executor_usuario_id) userIdsToFetch.push(tarefa.executor_usuario_id)
    if (tarefa.responsavel_usuario_id && !userIdsToFetch.includes(tarefa.responsavel_usuario_id)) {
      userIdsToFetch.push(tarefa.responsavel_usuario_id)
    }

    let executorUser: {
      id: string
      nome: string | null
      email: string | null
      ativo: boolean | null
    } | null = null
    let responsavelUser: {
      id: string
      nome: string | null
      email: string | null
      ativo: boolean | null
    } | null = null

    if (userIdsToFetch.length > 0) {
      const { data: usersList, error: usersError } = await supabase
        .from('task_usuarios')
        .select('id, nome, email, ativo')
        .in('id', userIdsToFetch)

      if (usersError) {
        console.error('Erro ao consultar task_usuarios:', usersError)
        throw new Error(`Erro ao consultar usuários: ${usersError.message}`)
      }

      if (usersList) {
        for (const u of usersList) {
          if (u.id === tarefa.executor_usuario_id) executorUser = u
          if (u.id === tarefa.responsavel_usuario_id) responsavelUser = u
        }
      }
    }

    // Regra 1: Validar e-mail do Executor
    const toEmail = executorUser?.email?.trim().toLowerCase() || ''
    if (!isValidEmail(toEmail)) {
      console.warn('Envio abortado: Executor não possui e-mail válido.', {
        tarefa_id,
        executor_usuario_id: tarefa.executor_usuario_id,
        email: executorUser?.email,
      })
      return new Response(
        JSON.stringify({
          triggered: true,
          sent: false,
          reason: 'executor_sem_email_valido',
          message: 'O Executor atribuído não possui e-mail cadastrado ou válido.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Regra 1: Determinar CC (Responsável)
    const respEmailRaw = responsavelUser?.email?.trim().toLowerCase() || ''
    let ccEmail: string | null = null
    if (isValidEmail(respEmailRaw) && respEmailRaw !== toEmail) {
      ccEmail = respEmailRaw
    }

    // 5. Buscar providências não excluídas e identificar a próxima providência aberta
    // Regra operacional: deleted_at IS NULL, status com finaliza != true, priorizando menor prazo_conclusao
    const { data: providenciasRaw, error: provError } = await supabase
      .from('task_providencias')
      .select(`
        id,
        providencia,
        prazo_conclusao,
        ordem,
        deleted_at,
        status:task_status_providencia(id, codigo, nome, finaliza)
      `)
      .eq('tarefa_id', tarefa_id)
      .is('deleted_at', null)
      .order('prazo_conclusao', { ascending: true })
      .order('ordem', { ascending: true })

    if (provError) {
      console.warn('Aviso ao consultar task_providencias:', provError)
    }

    let proximaProvidenciaAberta: { providencia: string; prazo_conclusao: string | null } | null =
      null
    if (providenciasRaw && providenciasRaw.length > 0) {
      const abertas = providenciasRaw.filter((p: any) => {
        const finaliza = Boolean(p.status?.finaliza)
        return !finaliza
      })

      // Ordenar por menor prazo_conclusao (mesmo padrão de controleService)
      abertas.sort((a: any, b: any) => {
        const prazoA = a.prazo_conclusao || ''
        const prazoB = b.prazo_conclusao || ''
        if (prazoA && prazoB) {
          if (prazoA !== prazoB) return prazoA.localeCompare(prazoB)
          return (a.ordem ?? 0) - (b.ordem ?? 0)
        }
        if (prazoA && !prazoB) return -1
        if (!prazoA && prazoB) return 1
        return (a.ordem ?? 0) - (b.ordem ?? 0)
      })

      if (abertas.length > 0) {
        proximaProvidenciaAberta = {
          providencia: (abertas[0].providencia || '').trim(),
          prazo_conclusao: abertas[0].prazo_conclusao,
        }
      }
    }

    // 6. Configuração SMTP existente
    const { data: setting, error: settingError } = await supabase
      .from('email_settings')
      .select('*')
      .eq('active', true)
      .limit(1)
      .maybeSingle()

    if (settingError) throw settingError
    if (!setting) {
      throw new Error('Nenhuma configuração de e-mail ativa encontrada.')
    }

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

    // 7. Montar conteúdo do e-mail
    // Nome do Executor (primeiro nome)
    const execNomeFull = (executorUser?.nome || '').trim()
    const execFirstName = execNomeFull ? execNomeFull.split(/\s+/)[0] : 'Executor'
    const respNomeFull = (responsavelUser?.nome || '').trim()

    const numeroCasoStr = tarefa.numero_caso != null ? String(tarefa.numero_caso) : ''
    const subject = `Nova atribuição Ricci Task [Caso ${numeroCasoStr}]`

    const bodyLines: string[] = [
      `Olá, ${execFirstName}.`,
      '',
      'Uma nova tarefa foi atribuída a você no Ricci Task.',
      '',
    ]

    if (nomeControle) {
      bodyLines.push(`Controle: ${nomeControle}`)
    }
    bodyLines.push(`Caso: ${numeroCasoStr}`)
    if (tarefa.identificacao_caso?.trim()) {
      bodyLines.push(`Identificação: ${tarefa.identificacao_caso.trim()}`)
    }
    if (respNomeFull) {
      bodyLines.push(`Responsável: ${respNomeFull}`)
    }

    if (proximaProvidenciaAberta && proximaProvidenciaAberta.providencia) {
      bodyLines.push('')
      bodyLines.push(`Providência: ${proximaProvidenciaAberta.providencia}`)
      if (proximaProvidenciaAberta.prazo_conclusao) {
        bodyLines.push(`Prazo: ${formatDateBR(proximaProvidenciaAberta.prazo_conclusao)}`)
      }
    }

    bodyLines.push('')
    bodyLines.push('Acesse o Ricci Task para consultar o caso.')
    bodyLines.push('https://riccitask.goskip.app/')

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

    // Remetente padrão com identidade Ricci Task
    const senderName = 'Ricci Task'
    const mailOptions: {
      from: string
      to: string
      cc?: string
      replyTo?: string
      subject: string
      text: string
    } = {
      from: `"${senderName}" <${setting.sender_email}>`,
      to: toEmail,
      ...(ccEmail ? { cc: ccEmail } : {}),
      replyTo: setting.reply_to || undefined,
      subject,
      text: emailText,
    }

    // 9. Envio e registro em email_send_logs
    try {
      await transporter.sendMail(mailOptions)
    } catch (sendError: any) {
      console.error('Erro no transporte SMTP:', sendError)
      await supabase.from('email_send_logs').insert({
        type: 'ricci_task_notification',
        to_email: toEmail,
        subject: mailOptions.subject,
        status: 'error',
        error_message: sendError.message || String(sendError),
        created_by: user.id,
        created_at: new Date().toISOString(),
      })

      return new Response(
        JSON.stringify({
          success: false,
          sent: false,
          error: `Erro ao enviar e-mail pelo provedor: ${sendError.message}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Sucesso no envio -> registrar em email_send_logs
    const { error: logError } = await supabase.from('email_send_logs').insert({
      type: 'ricci_task_notification',
      to_email: toEmail,
      subject: mailOptions.subject,
      status: 'success',
      created_by: user.id,
      created_at: new Date().toISOString(),
    })

    if (logError) {
      console.error('Erro ao registrar log em email_send_logs:', logError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: true,
        message: 'Notificação enviada com sucesso.',
        to: toEmail,
        cc: ccEmail,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    console.error('Erro na Edge Function notify-task-assignment:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno ao processar notificação.' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
