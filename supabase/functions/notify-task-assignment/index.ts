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
    const { tarefa_id, providencia_id, tipo } = body

    if (!tarefa_id) {
      return new Response(JSON.stringify({ error: 'Parâmetro tarefa_id é obrigatório.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Tipos suportados:
    // Legados/Atribuição: 'nova_atribuicao', 'alteracao_atribuicao', 'atribuicao'
    // Providências: 'providencia_inclusao', 'providencia_atualizacao'
    const allowedTipos = [
      'nova_atribuicao',
      'alteracao_atribuicao',
      'atribuicao',
      'providencia_inclusao',
      'providencia_atualizacao',
    ]

    if (!tipo || !allowedTipos.includes(tipo)) {
      return new Response(
        JSON.stringify({
          error: `Parâmetro tipo inválido. Valores aceitos: ${allowedTipos.join(', ')}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (
      (tipo === 'providencia_inclusao' || tipo === 'providencia_atualizacao') &&
      !providencia_id
    ) {
      return new Response(
        JSON.stringify({
          error: `Parâmetro providencia_id é obrigatório para notificações do tipo ${tipo}.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Normalização do tipo_evento para a tabela task_email_eventos (check constraint: atribuicao, alteracao_atribuicao, providencia_inclusao, providencia_atualizacao, providencia_atraso)
    let dbTipoEvento:
      | 'atribuicao'
      | 'alteracao_atribuicao'
      | 'providencia_inclusao'
      | 'providencia_atualizacao'
    if (tipo === 'nova_atribuicao' || tipo === 'atribuicao') {
      dbTipoEvento = 'atribuicao'
    } else if (tipo === 'alteracao_atribuicao') {
      dbTipoEvento = 'alteracao_atribuicao'
    } else if (tipo === 'providencia_inclusao') {
      dbTipoEvento = 'providencia_inclusao'
    } else {
      dbTipoEvento = 'providencia_atualizacao'
    }

    // 3. Buscar dados de task_tarefas com nome do controle e updated_at estável
    const { data: tarefa, error: tarefaError } = await supabase
      .from('task_tarefas')
      .select(`
        id,
        numero_caso,
        identificacao_caso,
        nome_controle_id,
        executor_usuario_id,
        responsavel_usuario_id,
        created_at,
        updated_at,
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

    // Se for evento de providência, carregar a providência específica e validar
    let providenciaAlvo: any = null
    if (providencia_id) {
      const { data: provData, error: provFetchError } = await supabase
        .from('task_providencias')
        .select(`
          id,
          tarefa_id,
          providencia,
          prazo_conclusao,
          tipo_prazo_id,
          status_id,
          ordem,
          created_at,
          updated_at,
          deleted_at,
          email_alertas,
          email_alerta_inclusao,
          email_alerta_atualizacao,
          status:task_status_providencia(id, codigo, nome, finaliza),
          tipo_prazo:task_tipos_prazo(id, nome)
        `)
        .eq('id', providencia_id)
        .maybeSingle()

      if (provFetchError) {
        console.error('Erro ao buscar task_providencias:', provFetchError)
        throw new Error(`Erro ao buscar providência: ${provFetchError.message}`)
      }

      if (!provData) {
        return new Response(JSON.stringify({ error: 'Providência não encontrada.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (provData.deleted_at) {
        return new Response(
          JSON.stringify({
            triggered: false,
            sent: false,
            reason: 'providencia_excluida',
            message: 'A providência informada foi excluída.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      // Validação de flags de e-mail na providência
      if (!provData.email_alertas) {
        return new Response(
          JSON.stringify({
            triggered: false,
            sent: false,
            reason: 'email_alertas_desativado',
            message: 'A providência não está configurada para receber alertas por e-mail.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (dbTipoEvento === 'providencia_inclusao' && !provData.email_alerta_inclusao) {
        return new Response(
          JSON.stringify({
            triggered: false,
            sent: false,
            reason: 'alerta_inclusao_desativado',
            message: 'O alerta de inclusão desta providência está desativado.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (dbTipoEvento === 'providencia_atualizacao' && !provData.email_alerta_atualizacao) {
        return new Response(
          JSON.stringify({
            triggered: false,
            sent: false,
            reason: 'alerta_atualizacao_desativado',
            message: 'O alerta de atualização desta providência está desativado.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      providenciaAlvo = provData
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

    // 4. Buscar Executor e Responsável em task_usuarios (regra única de destinatários)
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

    // REGRA ÚNICA DE DESTINATÁRIOS:
    // - TO = Executor, CC = Responsável. E-mails sempre obtidos de task_usuarios.
    // - Normalizar endereços com trim().toLowerCase() antes de enviar.
    // - Se TO e CC forem iguais: TO = Executor, CC = vazio (não duplicar).
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

    const respEmailRaw = responsavelUser?.email?.trim().toLowerCase() || ''
    let ccEmail: string | null = null
    if (isValidEmail(respEmailRaw) && respEmailRaw !== toEmail) {
      ccEmail = respEmailRaw
    }

    // 5. Chave de idempotência (event_key)
    // - Atribuição: ocorrência específica da alteração via timestamp estável de salvamento no Supabase (updated_at ou created_at)
    //   combinado com tarefa e destinatários (executor e responsável).
    //   Formato: atribuicao:{tarefa.id}:{tarefa.updated_at}:{currentExecId}:{currentRespId}
    //   Permite que retorno a combinações anteriores gere novo envio, enquanto saves sem alteração
    //   de destinatários e retries preservam a idempotência.
    // - Inclusão: ID único da providência
    // - Atualização: ID da providência + timestamp de updated_at
    let eventKey = ''
    const currentExecId = tarefa.executor_usuario_id || 'sem_exec'
    const currentRespId = tarefa.responsavel_usuario_id || 'sem_resp'

    if (dbTipoEvento === 'atribuicao' || dbTipoEvento === 'alteracao_atribuicao') {
      const tarefaSaveStamp = tarefa.updated_at || tarefa.created_at || 'sem_timestamp'
      eventKey = `atribuicao:${tarefa.id}:${tarefaSaveStamp}:${currentExecId}:${currentRespId}`
    } else if (dbTipoEvento === 'providencia_inclusao') {
      eventKey = `providencia_inclusao:${providenciaAlvo.id}`
    } else {
      // providencia_atualizacao
      const provUpdatedAt =
        providenciaAlvo.updated_at || providenciaAlvo.created_at || new Date().toISOString()
      eventKey = `providencia_atualizacao:${providenciaAlvo.id}:${provUpdatedAt}`
    }

    // 6. Verificar/Registrar chave de idempotência na tabela task_email_eventos
    const { data: existingEvent, error: checkEventError } = await supabase
      .from('task_email_eventos')
      .select('id, event_key, status, sent_at')
      .eq('event_key', eventKey)
      .maybeSingle()

    if (checkEventError) {
      console.warn('Aviso ao consultar task_email_eventos:', checkEventError)
    }

    // Se já foi enviado com sucesso, abortar envio imediatamente
    if (existingEvent && existingEvent.status === 'success') {
      return new Response(
        JSON.stringify({
          triggered: true,
          sent: false,
          reason: 'already_sent',
          message: 'Notificação já enviada anteriormente para este evento.',
          event_key: eventKey,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Se não existir, inserir como pending para travar concorrência
    let eventoId = existingEvent?.id
    if (!existingEvent) {
      const { data: insertedEvent, error: insertEventError } = await supabase
        .from('task_email_eventos')
        .insert({
          tarefa_id: tarefa.id,
          providencia_id: providenciaAlvo ? providenciaAlvo.id : null,
          tipo_evento: dbTipoEvento,
          event_key: eventKey,
          to_email: toEmail,
          cc_email: ccEmail,
          status: 'pending',
          data_referencia: new Date().toISOString().split('T')[0],
        })
        .select('id')
        .maybeSingle()

      if (insertEventError) {
        // Se deu erro de constraint de chave única (concorrência de disparos simultâneos)
        if (insertEventError.code === '23505' || insertEventError.message?.includes('23505')) {
          const { data: raceEvent } = await supabase
            .from('task_email_eventos')
            .select('id, status')
            .eq('event_key', eventKey)
            .maybeSingle()

          if (raceEvent && raceEvent.status === 'success') {
            return new Response(
              JSON.stringify({
                triggered: true,
                sent: false,
                reason: 'already_sent',
                message: 'Notificação já enviada concorrentemente.',
                event_key: eventKey,
              }),
              {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              },
            )
          }
          eventoId = raceEvent?.id
        } else {
          console.warn(
            'Aviso ao registrar evento pendente em task_email_eventos:',
            insertEventError,
          )
        }
      } else if (insertedEvent) {
        eventoId = insertedEvent.id
      }
    } else {
      // Já existia com status pending ou error, reusar eventoId
      eventoId = existingEvent.id
    }

    // 7. Preparar conteúdo de e-mail de acordo com o tipo
    // Dados gerais
    const execNomeFull = (executorUser?.nome || '').trim()
    const execFirstName = execNomeFull ? execNomeFull.split(/\s+/)[0] : 'Executor'
    const respNomeFull = (responsavelUser?.nome || '').trim()
    const numeroCasoStr = tarefa.numero_caso != null ? String(tarefa.numero_caso) : ''

    let subject = ''
    const bodyLines: string[] = []

    if (dbTipoEvento === 'atribuicao' || dbTipoEvento === 'alteracao_atribuicao') {
      // 5. Buscar providências não excluídas e identificar a próxima providência aberta
      const { data: providenciasRaw } = await supabase
        .from('task_providencias')
        .select(`
          id,
          providencia,
          prazo_conclusao,
          ordem,
          deleted_at,
          status:task_status_providencia(id, codigo, nome, finaliza)
        `)
        .eq('tarefa_id', tarefa.id)
        .is('deleted_at', null)
        .order('prazo_conclusao', { ascending: true })
        .order('ordem', { ascending: true })

      let proximaProvidenciaAberta: { providencia: string; prazo_conclusao: string | null } | null =
        null
      if (providenciasRaw && providenciasRaw.length > 0) {
        const abertas = providenciasRaw.filter((p: any) => !p.status?.finaliza)
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

      subject = `Nova atribuição Ricci Task [Caso ${numeroCasoStr}]`
      bodyLines.push(`Olá, ${execFirstName}.`)
      bodyLines.push('')
      bodyLines.push('Uma nova tarefa foi atribuída a você no Ricci Task.')
      bodyLines.push('')
      if (nomeControle) bodyLines.push(`Controle: ${nomeControle}`)
      bodyLines.push(`Caso: ${numeroCasoStr}`)
      if (tarefa.identificacao_caso?.trim())
        bodyLines.push(`Identificação: ${tarefa.identificacao_caso.trim()}`)
      if (respNomeFull) bodyLines.push(`Responsável: ${respNomeFull}`)

      if (proximaProvidenciaAberta && proximaProvidenciaAberta.providencia) {
        bodyLines.push('')
        bodyLines.push(`Providência: ${proximaProvidenciaAberta.providencia}`)
        if (proximaProvidenciaAberta.prazo_conclusao) {
          bodyLines.push(`Prazo: ${formatDateBR(proximaProvidenciaAberta.prazo_conclusao)}`)
        }
      }
    } else if (dbTipoEvento === 'providencia_inclusao') {
      subject = `Nova providência Ricci Task [Caso ${numeroCasoStr}]`
      bodyLines.push(`Olá, ${execFirstName}.`)
      bodyLines.push('')
      bodyLines.push('Uma nova providência foi incluída no Ricci Task para o seu caso.')
      bodyLines.push('')
      if (nomeControle) bodyLines.push(`Controle: ${nomeControle}`)
      bodyLines.push(`Caso: ${numeroCasoStr}`)
      if (tarefa.identificacao_caso?.trim())
        bodyLines.push(`Identificação: ${tarefa.identificacao_caso.trim()}`)
      if (respNomeFull) bodyLines.push(`Responsável: ${respNomeFull}`)
      bodyLines.push('')
      bodyLines.push(`Providência: ${(providenciaAlvo.providencia || '').trim()}`)
      if (providenciaAlvo.prazo_conclusao) {
        bodyLines.push(`Prazo: ${formatDateBR(providenciaAlvo.prazo_conclusao)}`)
      }
      if (providenciaAlvo.status?.nome) {
        bodyLines.push(`Status da Providência: ${providenciaAlvo.status.nome}`)
      }
    } else {
      // dbTipoEvento === 'providencia_atualizacao'
      subject = `Providência atualizada Ricci Task [Caso ${numeroCasoStr}]`
      bodyLines.push(`Olá, ${execFirstName}.`)
      bodyLines.push('')
      bodyLines.push('Uma providência foi atualizada no Ricci Task para o seu caso.')
      bodyLines.push('')
      if (nomeControle) bodyLines.push(`Controle: ${nomeControle}`)
      bodyLines.push(`Caso: ${numeroCasoStr}`)
      if (tarefa.identificacao_caso?.trim())
        bodyLines.push(`Identificação: ${tarefa.identificacao_caso.trim()}`)
      if (respNomeFull) bodyLines.push(`Responsável: ${respNomeFull}`)
      bodyLines.push('')
      bodyLines.push(`Providência: ${(providenciaAlvo.providencia || '').trim()}`)
      if (providenciaAlvo.prazo_conclusao) {
        bodyLines.push(`Prazo: ${formatDateBR(providenciaAlvo.prazo_conclusao)}`)
      }
      if (providenciaAlvo.status?.nome) {
        bodyLines.push(`Status da Providência: ${providenciaAlvo.status.nome}`)
      }
    }

    bodyLines.push('')
    bodyLines.push('Acesse o Ricci Task para consultar o caso.')
    bodyLines.push('https://riccitask.goskip.app/')

    const emailText = bodyLines.join('\n')

    // 8. Configuração SMTP existente
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

    // 9. Configurar transporte SMTP
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

    // 10. Envio e registro em email_send_logs e task_email_eventos
    try {
      await transporter.sendMail(mailOptions)
    } catch (sendError: any) {
      console.error('Erro no transporte SMTP:', sendError)

      // Registrar erro em task_email_eventos
      if (eventoId) {
        await supabase
          .from('task_email_eventos')
          .update({
            status: 'error',
            erro: sendError.message || String(sendError),
          })
          .eq('id', eventoId)
      }

      await supabase.from('email_send_logs').insert({
        type: `ricci_task_${dbTipoEvento}`,
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

    // Sucesso no envio: atualizar task_email_eventos para 'success' com sent_at
    const agoraIso = new Date().toISOString()
    if (eventoId) {
      await supabase
        .from('task_email_eventos')
        .update({
          status: 'success',
          sent_at: agoraIso,
          erro: null,
        })
        .eq('id', eventoId)
    }

    // Registrar em email_send_logs
    const { error: logError } = await supabase.from('email_send_logs').insert({
      type: `ricci_task_${dbTipoEvento}`,
      to_email: toEmail,
      subject: mailOptions.subject,
      status: 'success',
      created_by: user.id,
      created_at: agoraIso,
    })

    if (logError) {
      console.error('Erro ao registrar log em email_send_logs:', logError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: true,
        message: 'Notificação enviada com sucesso.',
        event_key: eventKey,
        tipo_evento: dbTipoEvento,
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
