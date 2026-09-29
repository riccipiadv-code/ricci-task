import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer'
import {
  verifyRicciTaskAdmin,
  resolveValidatedRecipientByCoreId,
  RecipientResolutionResult,
} from '../_shared/core-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type, x-task-cron-secret',
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

/**
 * Retorna a data no fuso de São Paulo (America/Sao_Paulo / UTC-3) no formato YYYY-MM-DD.
 * Garante alinhamento exato com o fuso horário utilizado pelos operadores do Ricci Task.
 */
function getSaoPauloDateStr(now: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return formatter.format(now) // Formato "YYYY-MM-DD"
  } catch {
    return now.toISOString().split('T')[0]
  }
}

interface OverdueProcessResult {
  providencia_id: string
  tarefa_id: string
  event_key: string
  status: 'sent' | 'skipped' | 'error'
  reason?: string
  to?: string
  cc?: string | null
  error?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const TASK_OVERDUE_CRON_SECRET = Deno.env.get('TASK_OVERDUE_CRON_SECRET')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Erro interno de configuração de servidor (chaves do Supabase)' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }

  // Cliente service role interno para operações protegidas e idempotência
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    // Comparação em tempo constante para mitigar timing attacks
    const timingSafeEqual = (a: string, b: string): boolean => {
      if (a.length !== b.length) return false
      let diff = 0
      for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
      }
      return diff === 0
    }

    // 1. Autorização segregada:
    // A) Execução automática do cron:
    //    Identificada pelo header dedicado 'x-task-cron-secret'.
    //    Comparada exclusivamente com TASK_OVERDUE_CRON_SECRET (deve estar configurado).
    // B) Execução manual de teste:
    //    Permitida somente para usuário autenticado com perfil administrativo
    //    validado no backend (core_usuarios e vínculo RICCI_TASK com perfil ADMINISTRADOR). Usuário comum autenticado recebe 403.
    const cronSecretHeader = req.headers.get('x-task-cron-secret')
    const authHeader = req.headers.get('Authorization')

    let isCronExecution = false
    let callerUserId: string | null = null

    if (cronSecretHeader !== null) {
      // Tentativa de execução via cron secret
      const headerSecretTrimmed = cronSecretHeader.trim()
      const envSecretTrimmed = (TASK_OVERDUE_CRON_SECRET || '').trim()

      if (
        !envSecretTrimmed ||
        !headerSecretTrimmed ||
        !timingSafeEqual(headerSecretTrimmed, envSecretTrimmed)
      ) {
        console.warn('Acesso negado: segredo de cron TASK_OVERDUE_CRON_SECRET ausente ou inválido.')
        return new Response(
          JSON.stringify({
            error: 'Não autorizado. Segredo do cron inválido ou não configurado.',
          }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      isCronExecution = true
      callerUserId = null
    }

    if (!isCronExecution) {
      // Tentativa de execução manual: exige token JWT de usuário autenticado
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: 'Token de autenticação ou segredo de cron não fornecido.' }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      const token = authHeader.replace(/^Bearer\s+/i, '').trim()
      if (!token) {
        return new Response(JSON.stringify({ error: 'Token de autenticação Bearer vazio.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser(token)

      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: 'Não autorizado. Autenticação inválida ou expirada.' }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      // Validar no backend se o usuário possui perfil ADMINISTRADOR central de RICCI_TASK:
      // auth.users.id → core_usuarios.auth_user_id → core_usuario_sistemas → sistema RICCI_TASK → core_perfis.codigo = 'ADMINISTRADOR'
      // Valida ativo em core_usuarios, core_usuario_sistemas, core_sistemas e core_perfis.
      // Substitui integralmente a autorização legada local/profiles.
      const adminCheck = await verifyRicciTaskAdmin(supabase, user.id)

      if (!adminCheck.allowed || !adminCheck.coreUser) {
        console.warn(
          `Acesso proibido: usuário ${user.id} (${user.email}) não possui perfil central ADMINISTRADOR em RICCI_TASK.`,
          adminCheck.error,
        )
        return new Response(
          JSON.stringify({
            error:
              adminCheck.error ||
              'Permissão negada. Apenas usuários com perfil ADMINISTRADOR do Ricci Task podem disparar manualmente a rotina de atrasos.',
          }),
          {
            status: adminCheck.status || 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      callerUserId = user.id
    }

    // 2. Data de referência de hoje no fuso padrão do projeto (America/Sao_Paulo)
    const todayStr = getSaoPauloDateStr()

    // 3. Consultar providências abertas e atrasadas
    // Regras:
    // - deleted_at IS NULL
    // - email_alertas = true
    // - email_alerta_atraso = true
    // - prazo_conclusao < hoje (comparação por string YYYY-MM-DD segura)
    // - status com finaliza != true
    const { data: providenciasRaw, error: provError } = await supabase
      .from('task_providencias')
      .select(`
        id,
        tarefa_id,
        providencia,
        prazo_conclusao,
        status_id,
        ordem,
        deleted_at,
        email_alertas,
        email_alerta_atraso,
        status:task_status_providencia(id, codigo, nome, finaliza)
      `)
      .is('deleted_at', null)
      .eq('email_alertas', true)
      .eq('email_alerta_atraso', true)
      .not('prazo_conclusao', 'is', null)
      .lt('prazo_conclusao', todayStr)
      .order('prazo_conclusao', { ascending: true })

    if (provError) {
      console.error('Erro ao consultar task_providencias atrasadas:', provError)
      throw new Error(`Erro ao consultar providências: ${provError.message}`)
    }

    // Filtrar status finaliza != true (garantindo também quando join status vier nulo ou com finaliza true)
    const providenciasAbertas = (providenciasRaw || []).filter((p: any) => {
      const st = p.status as { finaliza?: boolean | null } | null
      return st ? st.finaliza !== true : true
    })

    if (providenciasAbertas.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Nenhuma providência atrasada com alerta ativo para processar.',
          today: todayStr,
          processed: 0,
          sent: 0,
          skipped: 0,
          errors: 0,
          details: [],
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 4. Carregar configurações SMTP ativas antecipadamente (apenas se houver itens)
    const { data: setting, error: settingError } = await supabase
      .from('email_settings')
      .select('*')
      .eq('active', true)
      .limit(1)
      .maybeSingle()

    if (settingError) {
      console.error('Erro ao consultar email_settings:', settingError)
      throw new Error(`Erro ao consultar configurações de e-mail: ${settingError.message}`)
    }

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

    // Inicializar transporte SMTP
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

    // 5. Coletar IDs de tarefas únicas para buscar dados dos casos
    // NOTA DE MIGRAÇÃO: Preparado para funcionar após o DROP das colunas legadas executor_usuario_id / responsavel_usuario_id.
    // Nenhuma consulta (SELECT) ou gravação referencia essas colunas.
    const tarefaIds = Array.from(new Set(providenciasAbertas.map((p) => p.tarefa_id)))

    const { data: tarefasList, error: tarefasError } = await supabase
      .from('task_tarefas')
      .select(`
        id,
        numero_caso,
        identificacao_caso,
        nome_controle_id,
        executor_core_usuario_id,
        responsavel_core_usuario_id,
        deleted_at,
        nome_controle:task_nomes_controle(nome)
      `)
      .in('id', tarefaIds)

    if (tarefasError) {
      console.error('Erro ao consultar task_tarefas:', tarefasError)
      throw new Error(`Erro ao consultar tarefas: ${tarefasError.message}`)
    }

    const tarefasMap = new Map<string, any>()
    for (const t of tarefasList || []) {
      tarefasMap.set(t.id, t)
    }

    // 6. Cache de resoluções de destinatários no Gestor de Acessos para otimizar chamadas
    // Resolução ocorre exclusivamente via core_usuarios (sem consultar task_usuarios).
    const recipientResolutionCache = new Map<string, RecipientResolutionResult>()

    const getRecipientResolution = async (
      coreUsuarioId?: string | null,
    ): Promise<RecipientResolutionResult> => {
      if (coreUsuarioId) {
        if (recipientResolutionCache.has(coreUsuarioId)) {
          return recipientResolutionCache.get(coreUsuarioId)!
        }
        const resolved = await resolveValidatedRecipientByCoreId(supabase, coreUsuarioId)
        recipientResolutionCache.set(coreUsuarioId, resolved)
        return resolved
      }

      return { status: 'missing_user_id', recipient: null }
    }

    // 7. Processar cada providência atrasada
    const results: OverdueProcessResult[] = []
    let totalSent = 0
    let totalSkipped = 0
    let totalErrors = 0

    const INTERVALO_REENVIO_HORAS = 72
    const INTERVALO_REENVIO_MS = INTERVALO_REENVIO_HORAS * 60 * 60 * 1000

    for (const prov of providenciasAbertas) {
      const tarefa = tarefasMap.get(prov.tarefa_id)

      // Se a tarefa não existir ou estiver excluída, pular
      if (!tarefa || tarefa.deleted_at) {
        results.push({
          providencia_id: prov.id,
          tarefa_id: prov.tarefa_id,
          event_key: `providencia_atraso:${prov.id}:${todayStr}`,
          status: 'skipped',
          reason: !tarefa ? 'tarefa_nao_encontrada' : 'tarefa_excluida',
        })
        totalSkipped++
        continue
      }

      // REGRA DE REPETIÇÃO A CADA 72 HORAS:
      // - Mantém o primeiro envio quando a providência entrar em atraso.
      // - Depois, só permitir novo envio quando tiverem transcorrido 72 horas do sent_at do último envio BEM-SUCEDIDO daquela providência.
      // - Repetir a cada 72 horas enquanto continuar atrasada e com alertas ativos.
      // - Consulta o último evento BEM-SUCEDIDO (status = 'success' AND sent_at IS NOT NULL) desta providência.
      // Idempotência do ciclo diário para proteção contra disparos repetidos/concorrentes no mesmo dia
      // providencia_atraso:{providencia_id}:{AAAA-MM-DD}
      const eventKey = `providencia_atraso:${prov.id}:${todayStr}`

      const { data: ultimoEnvioSucesso, error: checkUltimoSucessoError } = await supabase
        .from('task_email_eventos')
        .select('id, sent_at')
        .eq('providencia_id', prov.id)
        .eq('tipo_evento', 'providencia_atraso')
        .eq('status', 'success')
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (checkUltimoSucessoError) {
        console.error(
          `Falha técnica ao consultar último envio de sucesso para providência ${prov.id}:`,
          checkUltimoSucessoError,
        )
        const errMsg =
          checkUltimoSucessoError.message || 'Falha técnica ao consultar histórico de envios'

        results.push({
          providencia_id: prov.id,
          tarefa_id: tarefa.id,
          event_key: eventKey,
          status: 'error',
          reason: 'falha_consulta_central',
          error: errMsg,
        })
        totalErrors++
        continue
      }

      if (ultimoEnvioSucesso && ultimoEnvioSucesso.sent_at) {
        const sentAtMs = new Date(ultimoEnvioSucesso.sent_at).getTime()
        const agoraMs = Date.now()
        const diferencaMs = agoraMs - sentAtMs

        if (diferencaMs < INTERVALO_REENVIO_MS) {
          const horasRestantes = Math.ceil((INTERVALO_REENVIO_MS - diferencaMs) / (60 * 60 * 1000))
          results.push({
            providencia_id: prov.id,
            tarefa_id: tarefa.id,
            event_key: eventKey,
            status: 'skipped',
            reason: 'intervalo_72h_nao_atingido',
          })
          totalSkipped++
          continue
        }
      }

      // Verificar se o evento deste dia já foi enviado com sucesso
      const { data: existingEvent, error: checkEventError } = await supabase
        .from('task_email_eventos')
        .select('id, event_key, status, sent_at')
        .eq('event_key', eventKey)
        .maybeSingle()

      if (checkEventError) {
        console.error(
          `Falha técnica ao consultar task_email_eventos para chave ${eventKey}:`,
          checkEventError,
        )
        const errMsg = checkEventError.message || 'Falha técnica ao consultar chave de idempotência'

        results.push({
          providencia_id: prov.id,
          tarefa_id: tarefa.id,
          event_key: eventKey,
          status: 'error',
          reason: 'falha_consulta_central',
          error: errMsg,
        })
        totalErrors++
        continue
      }

      if (existingEvent && existingEvent.status === 'success') {
        results.push({
          providencia_id: prov.id,
          tarefa_id: tarefa.id,
          event_key: eventKey,
          status: 'skipped',
          reason: 'already_sent_today',
        })
        totalSkipped++
        continue
      }

      // Obter resolução do Executor validada no Gestor de Acessos
      // Autoridade central: usa exclusivamente o executor_core_usuario_id gravado na tarefa.
      // Validando usuário, vínculo com RICCI_TASK, sistema e perfil ativos.
      // Diferenciação estrita: falha técnica vs vínculo comprovadamente inválido.
      const execResolution = await getRecipientResolution(tarefa.executor_core_usuario_id)

      // Se falhou tecnicamente na consulta central do Executor:
      // Registra como 'error' com erro 'falha_consulta_central' (permite retry, não marca skipped/sucesso)
      if (execResolution.status === 'technical_failure') {
        console.error(
          `Falha técnica na consulta central do Executor para caso ${tarefa.numero_caso}, providência ${prov.id}:`,
          execResolution.error,
        )

        const errMsg = execResolution.error || 'Falha técnica ao consultar Gestor de Acessos'

        if (!existingEvent) {
          await supabase.from('task_email_eventos').insert({
            tarefa_id: tarefa.id,
            providencia_id: prov.id,
            tipo_evento: 'providencia_atraso',
            event_key: eventKey,
            to_email: null,
            cc_email: null,
            status: 'error',
            erro: 'falha_consulta_central',
            data_referencia: todayStr,
          })
        } else if (existingEvent.status === 'pending') {
          await supabase
            .from('task_email_eventos')
            .update({
              status: 'error',
              erro: 'falha_consulta_central',
            })
            .eq('id', existingEvent.id)
        }

        results.push({
          providencia_id: prov.id,
          tarefa_id: tarefa.id,
          event_key: eventKey,
          status: 'error',
          reason: 'falha_consulta_central',
          error: errMsg,
        })
        totalErrors++
        continue
      }

      const validatedExec = execResolution.recipient

      if (
        execResolution.status !== 'valid' ||
        !validatedExec ||
        !isValidEmail(validatedExec.email)
      ) {
        console.warn(
          `Alerta de atraso ignorado: Executor sem vínculo central ativo válido para RICCI_TASK ou sem e-mail (caso ${tarefa.numero_caso}, providência ${prov.id})`,
        )

        if (!existingEvent) {
          await supabase.from('task_email_eventos').insert({
            tarefa_id: tarefa.id,
            providencia_id: prov.id,
            tipo_evento: 'providencia_atraso',
            event_key: eventKey,
            to_email: null,
            cc_email: null,
            status: 'skipped',
            erro: 'executor_sem_vinculo_central_valido',
            data_referencia: todayStr,
          })
        }

        results.push({
          providencia_id: prov.id,
          tarefa_id: tarefa.id,
          event_key: eventKey,
          status: 'skipped',
          reason: 'executor_sem_vinculo_central_valido',
        })
        totalSkipped++
        continue
      }

      const toEmail = validatedExec.email.trim().toLowerCase()

      // Obter dados do Responsável validados centralmente
      // Autoridade central: usa exclusivamente o responsavel_core_usuario_id gravado na tarefa.
      const respResolution = await getRecipientResolution(tarefa.responsavel_core_usuario_id)

      // Se falhou tecnicamente na consulta do Responsável:
      if (respResolution.status === 'technical_failure') {
        console.error(
          `Falha técnica na consulta central do Responsável para caso ${tarefa.numero_caso}, providência ${prov.id}:`,
          respResolution.error,
        )

        const errMsg =
          respResolution.error || 'Falha técnica ao consultar Responsável no Gestor de Acessos'

        if (!existingEvent) {
          await supabase.from('task_email_eventos').insert({
            tarefa_id: tarefa.id,
            providencia_id: prov.id,
            tipo_evento: 'providencia_atraso',
            event_key: eventKey,
            to_email: toEmail,
            cc_email: null,
            status: 'error',
            erro: 'falha_consulta_central',
            data_referencia: todayStr,
          })
        } else if (existingEvent.status === 'pending') {
          await supabase
            .from('task_email_eventos')
            .update({
              status: 'error',
              erro: 'falha_consulta_central',
            })
            .eq('id', existingEvent.id)
        }

        results.push({
          providencia_id: prov.id,
          tarefa_id: tarefa.id,
          event_key: eventKey,
          status: 'error',
          reason: 'falha_consulta_central',
          error: errMsg,
        })
        totalErrors++
        continue
      }

      const validatedResp = respResolution.recipient
      const respEmailRaw = validatedResp?.email?.trim().toLowerCase() || ''
      let ccEmail: string | null = null
      if (isValidEmail(respEmailRaw) && respEmailRaw !== toEmail) {
        ccEmail = respEmailRaw
      }

      // Inserir registro com status 'pending' antes de disparar o e-mail (lock de idempotência)
      let eventoId = existingEvent?.id
      if (!existingEvent) {
        const { data: insertedEvent, error: insertEventError } = await supabase
          .from('task_email_eventos')
          .insert({
            tarefa_id: tarefa.id,
            providencia_id: prov.id,
            tipo_evento: 'providencia_atraso',
            event_key: eventKey,
            to_email: toEmail,
            cc_email: ccEmail,
            status: 'pending',
            data_referencia: todayStr,
          })
          .select('id')
          .maybeSingle()

        if (insertEventError) {
          // Em caso de concorrência simultânea (unique violation 23505)
          if (insertEventError.code === '23505' || insertEventError.message?.includes('23505')) {
            const { data: raceEvent } = await supabase
              .from('task_email_eventos')
              .select('id, status')
              .eq('event_key', eventKey)
              .maybeSingle()

            if (raceEvent && raceEvent.status === 'success') {
              results.push({
                providencia_id: prov.id,
                tarefa_id: tarefa.id,
                event_key: eventKey,
                status: 'skipped',
                reason: 'already_sent_today',
              })
              totalSkipped++
              continue
            }
            eventoId = raceEvent?.id
          } else {
            console.warn(
              `Aviso ao registrar evento pendente para chave ${eventKey}:`,
              insertEventError,
            )
          }
        } else if (insertedEvent) {
          eventoId = insertedEvent.id
        }
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

      // Montar conteúdo do e-mail: resolução exclusiva a partir dos registros validados no Gestor de Acessos (core_usuarios)
      // SEM qualquer consulta a task_usuarios.
      const execNomeFull = (validatedExec.nome || '').trim()
      const execFirstName = execNomeFull ? execNomeFull.split(/\s+/)[0] : 'Executor'
      const respNomeFull = (validatedResp?.nome || '').trim()
      const numeroCasoStr = tarefa.numero_caso != null ? String(tarefa.numero_caso) : ''
      const identificacaoCasoStr = (tarefa.identificacao_caso || '').trim()
      const provDescricao = (prov.providencia || '').trim()
      const prazoFormatado = formatDateBR(prov.prazo_conclusao)

      const subject = `Providência atrasada Ricci Task [Caso ${numeroCasoStr}]`

      const bodyLines: string[] = []
      bodyLines.push(`Olá, ${execFirstName}.`)
      bodyLines.push('')
      bodyLines.push(
        'Constatamos que uma providência sob sua execução está com o prazo vencido no Ricci Task.',
      )
      bodyLines.push('')
      if (nomeControle) bodyLines.push(`Controle: ${nomeControle}`)
      if (numeroCasoStr) bodyLines.push(`Caso nº: ${numeroCasoStr}`)
      if (identificacaoCasoStr) bodyLines.push(`Identificação do Caso: ${identificacaoCasoStr}`)
      if (respNomeFull) bodyLines.push(`Responsável: ${respNomeFull}`)
      bodyLines.push('')
      if (provDescricao) bodyLines.push(`Providência: ${provDescricao}`)
      if (prazoFormatado) bodyLines.push(`Prazo Vencido: ${prazoFormatado}`)
      bodyLines.push('')
      bodyLines.push('Acesse o Ricci Task para consultar e atualizar a providência.')
      bodyLines.push('https://riccitask.goskip.app/')

      const emailText = bodyLines.join('\n')

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

      // Disparar envio via transporter SMTP
      try {
        await transporter.sendMail(mailOptions)

        // Atualizar evento para 'success' com sent_at
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

        // Registrar em email_send_logs com type próprio do Ricci Task
        const { error: logError } = await supabase.from('email_send_logs').insert({
          type: 'ricci_task_providencia_atraso',
          to_email: toEmail,
          subject: mailOptions.subject,
          status: 'success',
          created_by: callerUserId,
          created_at: agoraIso,
        })

        if (logError) {
          console.error('Erro ao inserir email_send_logs de atraso:', logError)
        }

        results.push({
          providencia_id: prov.id,
          tarefa_id: tarefa.id,
          event_key: eventKey,
          status: 'sent',
          to: toEmail,
          cc: ccEmail,
        })
        totalSent++
      } catch (sendError: any) {
        console.error(
          `Erro no transporte SMTP ao enviar alerta de atraso para providência ${prov.id}:`,
          sendError,
        )

        const errMsg = sendError.message || String(sendError)

        // Registrar status 'error' em task_email_eventos
        if (eventoId) {
          await supabase
            .from('task_email_eventos')
            .update({
              status: 'error',
              erro: errMsg,
            })
            .eq('id', eventoId)
        }

        // Registrar em email_send_logs
        await supabase.from('email_send_logs').insert({
          type: 'ricci_task_providencia_atraso',
          to_email: toEmail,
          subject: mailOptions.subject,
          status: 'error',
          error_message: errMsg,
          created_by: callerUserId,
          created_at: new Date().toISOString(),
        })

        results.push({
          providencia_id: prov.id,
          tarefa_id: tarefa.id,
          event_key: eventKey,
          status: 'error',
          error: errMsg,
          to: toEmail,
          cc: ccEmail,
        })
        totalErrors++
      }
    }

    const hasTechnicalOrProcessingErrors = totalErrors > 0
    const message = hasTechnicalOrProcessingErrors
      ? `Processamento de providências atrasadas concluído com falhas (${totalErrors} erro(s), ${totalSent} enviado(s), ${totalSkipped} ignorado(s)).`
      : `Processamento diário de providências atrasadas concluído com sucesso.`

    return new Response(
      JSON.stringify({
        success: !hasTechnicalOrProcessingErrors,
        partial: hasTechnicalOrProcessingErrors && totalSent > 0,
        message,
        today: todayStr,
        processed: providenciasAbertas.length,
        sent: totalSent,
        skipped: totalSkipped,
        errors: totalErrors,
        details: results,
      }),
      {
        // 207 Multi-Status quando há sucesso parcial ou falhas parciais tratadas,
        // garantindo que os clientes e orquestradores não interpretem como 100% bem-sucedido
        // enquanto preservam o payload detalhado dos envios que já deram certo.
        status: hasTechnicalOrProcessingErrors ? 207 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error: any) {
    console.error('Erro geral na Edge Function notify-task-overdue:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Erro interno ao processar notificações de atraso.',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
