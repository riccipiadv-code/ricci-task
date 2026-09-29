/**
 * Edge Function: notify-task-assignment (v0.0.61)
 * Autorização centralizada via verifyRicciTaskCaller (_shared/core-auth.ts)
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer'
import {
  checkProvidenciaEventAccess,
  checkTaskAccessScope,
  checkTransitionNotificationAccess,
  escapeHtml,
  resolveValidatedRecipientByCoreId,
  verifyRicciTaskCaller,
} from '../_shared/core-auth.ts'

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
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token de autenticação não encontrado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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

    // 1.1. Validar autorização central do chamador no Gestor de Acessos Ricci:
    // Exige:
    // - core_usuarios.ativo = true
    // - vínculo ativo em core_usuario_sistemas
    // - core_sistemas.codigo = 'RICCI_TASK' e sistema ativo
    // - perfil ativo em core_perfis
    // Aceita os perfis centrais: ADMINISTRADOR, GESTOR e OPERACIONAL.
    // Sem vínculo válido ou perfil não autorizado -> 403
    // Falha técnica na consulta central -> 500 (erro recuperável)
    // Nada é consultado, enviado ou gravado antes dessa aprovação.
    const callerCheck = await verifyRicciTaskCaller(supabase, user.id)

    if (!callerCheck.allowed) {
      console.warn(
        `Disparo bloqueado: chamador ${user.id} (${user.email}) não possui permissão ativa no RICCI_TASK. Status: ${callerCheck.status}, Motivo: ${callerCheck.error}`,
      )
      return new Response(
        JSON.stringify({
          error:
            callerCheck.error ||
            'Permissão negada: usuário sem permissão ativa para o sistema Ricci Task.',
        }),
        {
          status:
            callerCheck.httpStatus || (callerCheck.status === 'technical_failure' ? 500 : 403),
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 2. Extrair parâmetros
    const body = await req.json().catch(() => ({}))
    const { tarefa_id, providencia_id, tipo, transicao_id } = body

    if (!tarefa_id) {
      return new Response(JSON.stringify({ error: 'Parâmetro tarefa_id é obrigatório.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Tipos suportados:
    // Atribuição: 'alteracao_atribuicao' (legados mantidos para tolerância de rota: 'nova_atribuicao', 'atribuicao')
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
    // Inclui colunas operacionais executor_usuario_id e responsavel_usuario_id para manter tokens históricos
    const { data: tarefa, error: tarefaError } = await supabase
      .from('task_tarefas')
      .select(`
        id,
        numero_caso,
        identificacao_caso,
        nome_controle_id,
        executor_usuario_id,
        responsavel_usuario_id,
        executor_core_usuario_id,
        responsavel_core_usuario_id,
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

    // 3.1. Validação estrita de escopo do chamador sobre o caso (fail-closed obrigatório):
    // A chave SERVICE_ROLE_KEY ignora RLS; portanto a Edge Function deve validar o escopo
    // com base nas regras canônicas do sistema:
    // - Ausência de coreUser ou perfil deve retornar 403 imediatamente (NUNCA pular a checagem).
    // - ADMINISTRADOR: acessa qualquer caso.
    // - GESTOR: próprio (responsável ou executor) OU equipe direta via core_usuarios.gestor_id.
    // - OPERACIONAL: apenas se for Responsável ou Executor pelo ID central.
    // Fora do escopo -> bloquear com 403 (ou 500 em falha técnica) antes de qualquer consulta auxiliar ou envio SMTP.
    if (!callerCheck.coreUser || !callerCheck.perfil) {
      return new Response(
        JSON.stringify({
          error: 'Permissão negada: dados centrais de usuário ou perfil incompletos.',
        }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const scopeCheck = await checkTaskAccessScope(
      supabase,
      callerCheck.coreUser,
      callerCheck.perfil,
      tarefa,
    )

    let authorizedByTransition = false
    let transitionObject: any = null

    // Ponto 4: Para alertas de alteração de atribuição, EXIGE transição válida TAMBÉM quando o chamador ainda possui acesso.
    // Omitir transicao_id não pode contornar essa exigência de transição válida.
    if (dbTipoEvento === 'alteracao_atribuicao' || dbTipoEvento === 'atribuicao') {
      const transValidation = await checkTransitionNotificationAccess(
        supabase,
        callerCheck.coreUser.id,
        {
          transicaoId: transicao_id || null,
          tipoEvento: dbTipoEvento,
          tarefa: {
            id: tarefa.id,
            responsavel_core_usuario_id: tarefa.responsavel_core_usuario_id,
            executor_core_usuario_id: tarefa.executor_core_usuario_id,
            updated_at: tarefa.updated_at,
            created_at: tarefa.created_at,
          },
        },
      )

      if (transValidation.status === 'technical_failure') {
        return new Response(
          JSON.stringify({
            error:
              transValidation.error ||
              'Falha técnica de comunicação ao validar registro de transição.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (!transValidation.allowed) {
        return new Response(
          JSON.stringify({
            error:
              transValidation.error ||
              'Transição inválida ou incompatível com o estado atual da tarefa. Notificação de alteração de atribuição requer transição válida do servidor.',
          }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      transitionObject = transValidation.transition
      authorizedByTransition = true
    }

    if (!scopeCheck.allowed) {
      if (scopeCheck.status === 'technical_failure') {
        return new Response(
          JSON.stringify({
            error:
              scopeCheck.error ||
              'Falha técnica de comunicação ao verificar escopo no Gestor de Acessos.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      // Se o chamador NÃO possui mais acesso ao escopo ATUAL da tarefa (ex.: transferiu o caso e perdeu acesso):
      // Caso 1: Evento de atribuição -> valida registro de transição correspondente
      if (
        (dbTipoEvento === 'alteracao_atribuicao' || dbTipoEvento === 'atribuicao') &&
        !authorizedByTransition
      ) {
        const transCheck = await checkTransitionNotificationAccess(
          supabase,
          callerCheck.coreUser.id,
          {
            transicaoId: transicao_id || null,
            tipoEvento: dbTipoEvento,
            tarefa: {
              id: tarefa.id,
              responsavel_core_usuario_id: tarefa.responsavel_core_usuario_id,
              executor_core_usuario_id: tarefa.executor_core_usuario_id,
              updated_at: tarefa.updated_at,
              created_at: tarefa.created_at,
            },
          },
        )

        if (transCheck.status === 'technical_failure') {
          return new Response(
            JSON.stringify({
              error:
                transCheck.error ||
                'Falha técnica de comunicação ao consultar transição no banco de dados.',
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }

        if (transCheck.allowed) {
          authorizedByTransition = true
          transitionObject = transCheck.transition
        }
      }

      // Caso 2 (Ponto 4 & 5): Eventos de providência após transferência (perda de acesso)
      // Permite os alertas das providências efetivamente incluídas/alteradas naquela transação
      // comprovadas por registros de task_transacao_providencias_eventos no servidor.
      // A versão da providência DEVE ser consultada e validada obrigatoriamente sem tolerância.
      if (
        (dbTipoEvento === 'providencia_inclusao' || dbTipoEvento === 'providencia_atualizacao') &&
        providencia_id
      ) {
        // Buscar versão real da providência no banco de dados para validação estrita
        const { data: provVersionData, error: provVersionErr } = await supabase
          .from('task_providencias')
          .select('updated_at, created_at')
          .eq('id', providencia_id)
          .eq('tarefa_id', tarefa.id)
          .maybeSingle()

        if (provVersionErr) {
          return new Response(
            JSON.stringify({
              error: 'Falha técnica ao verificar versão da providência.',
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }

        const realProvVersion = provVersionData?.updated_at || provVersionData?.created_at || null

        const provCheck = await checkProvidenciaEventAccess(supabase, callerCheck.coreUser.id, {
          tarefaId: tarefa.id,
          providenciaId: providencia_id,
          tipoEvento: dbTipoEvento,
          versaoUpdatedAt: realProvVersion,
        })

        if (provCheck.status === 'technical_failure') {
          return new Response(
            JSON.stringify({
              error:
                provCheck.error ||
                'Falha técnica ao verificar autorização de evento da providência.',
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }

        if (provCheck.allowed) {
          authorizedByTransition = true
        }
      }

      if (!authorizedByTransition) {
        console.warn(
          `Disparo bloqueado: chamador ${callerCheck.coreUser.id} (${callerCheck.perfil}) fora do escopo da tarefa ${tarefa.id}. Motivo: ${scopeCheck.error}`,
        )
        return new Response(
          JSON.stringify({
            error:
              scopeCheck.error ||
              'Permissão negada: você não possui acesso a este caso para disparar notificações.',
          }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    }

    // REGRA DE ATRIBUIÇÃO:
    // A CRIAÇÃO de um caso NÃO deve enviar e-mail.
    // Se a requisição for para evento de atribuição e o caso for uma criação nova
    // (tipo === 'nova_atribuicao' ou tarefa recém-criada sem updated_at distinto de created_at quando tipo for criação),
    // ignorar o disparo de forma segura e controlada.
    if (tipo === 'nova_atribuicao') {
      return new Response(
        JSON.stringify({
          triggered: false,
          sent: false,
          reason: 'criacao_sem_notificacao',
          message:
            'A criação de caso não gera disparo de e-mail de atribuição por regra do sistema.',
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

    // 4. Buscar Executor e Responsável validados centralmente no Gestor de Acessos:
    // Autoridade central: usa exclusivamente os IDs centrais gravados em task_tarefas
    // (executor_core_usuario_id e responsavel_core_usuario_id).
    // Valida: core_usuarios.ativo = true, core_usuario_sistemas.ativo = true, core_sistemas.ativo = true e core_perfis.ativo = true.
    const execTargetId = tarefa.executor_core_usuario_id
    if (!execTargetId) {
      return new Response(
        JSON.stringify({
          triggered: true,
          sent: false,
          reason: 'executor_ausente',
          message: 'A tarefa não possui Executor atribuído.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const execResolution = await resolveValidatedRecipientByCoreId(supabase, execTargetId)

    // Se houve falha técnica de consulta central para o executor, retorna erro 500 (recuperável/retry)
    if (execResolution.status === 'technical_failure') {
      console.error('Falha técnica na consulta central do Executor:', execResolution.error, {
        tarefa_id,
        executor_core_usuario_id: tarefa.executor_core_usuario_id,
      })
      return new Response(
        JSON.stringify({
          success: false,
          sent: false,
          reason: 'falha_consulta_central',
          error:
            'Falha técnica ao validar destinatário no Gestor de Acessos Ricci (erro de conexão/consulta). Tente novamente.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const validatedExecutor = execResolution.recipient
    if (
      execResolution.status !== 'valid' ||
      !validatedExecutor ||
      !isValidEmail(validatedExecutor.email)
    ) {
      console.warn(
        'Envio abortado: Executor sem vínculo central ativo válido no Gestor de Acessos para RICCI_TASK ou sem e-mail.',
        {
          tarefa_id,
          executor_core_usuario_id: tarefa.executor_core_usuario_id,
          reason: execResolution.error,
        },
      )
      return new Response(
        JSON.stringify({
          triggered: true,
          sent: false,
          reason: 'executor_sem_vinculo_central_valido',
          message:
            'O Executor atribuído não possui vínculo central ativo no RICCI_TASK ou e-mail corporativo válido.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const toEmail = validatedExecutor.email.trim().toLowerCase()

    let validatedResponsavel: {
      taskUsuarioId?: string
      coreUsuarioId: string
      nome: string
      email: string
    } | null = null

    const respTargetId = tarefa.responsavel_core_usuario_id
    if (respTargetId) {
      const respResolution = await resolveValidatedRecipientByCoreId(supabase, respTargetId)

      if (respResolution.status === 'technical_failure') {
        console.error('Falha técnica na consulta central do Responsável:', respResolution.error, {
          tarefa_id,
          responsavel_core_usuario_id: tarefa.responsavel_core_usuario_id,
        })
        return new Response(
          JSON.stringify({
            success: false,
            sent: false,
            reason: 'falha_consulta_central',
            error:
              'Falha técnica ao validar responsável no Gestor de Acessos Ricci (erro de conexão/consulta). Tente novamente.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      validatedResponsavel = respResolution.recipient
    }

    const respEmailRaw = validatedResponsavel?.email?.trim().toLowerCase() || ''
    let ccEmail: string | null = null
    if (isValidEmail(respEmailRaw) && respEmailRaw !== toEmail) {
      ccEmail = respEmailRaw
    }

    // 5. Chave de idempotência (event_key)
    // - Atribuição: ocorrência específica da alteração via timestamp estável de salvamento no Supabase (updated_at ou created_at)
    //   combinado com tarefa e destinatários (executor e responsável).
    //   Formato: atribuicao:{tarefa.id}:{tarefa.updated_at||tarefa.created_at||'sem_timestamp'}:{execToken}:{respToken}
    //   REGRA CRÍTICA DE IDEMPOTÊNCIA:
    //   Usa a coluna operacional quando preenchida (token histórico), senão o ID central, senão 'sem_token'.
    const resolveEventKeyToken = (
      historicalToken?: string | null,
      coreId?: string | null,
    ): string => {
      if (historicalToken) return historicalToken
      if (coreId) return coreId
      return 'sem_token'
    }

    let eventKey = ''
    if (dbTipoEvento === 'atribuicao' || dbTipoEvento === 'alteracao_atribuicao') {
      const execToken = resolveEventKeyToken(
        tarefa.executor_usuario_id,
        tarefa.executor_core_usuario_id,
      )
      const respToken = resolveEventKeyToken(
        tarefa.responsavel_usuario_id,
        tarefa.responsavel_core_usuario_id,
      )
      // Chave canônica unificada de atribuição (Ponto 4):
      // Garante que mesmo com transicaoId ou sem transicaoId, a ocorrência seja identificada pelo estado
      // estável da tarefa (updated_at/created_at + destinatários), impedindo envio duplicado por duas chaves.
      const tarefaSaveStamp = tarefa.updated_at || tarefa.created_at || 'sem_timestamp'
      eventKey = `atribuicao:${tarefa.id}:${tarefaSaveStamp}:${execToken}:${respToken}`
    } else if (dbTipoEvento === 'providencia_inclusao') {
      eventKey = `providencia_inclusao:${providenciaAlvo.id}`
    } else {
      // providencia_atualizacao
      const provUpdatedAt =
        providenciaAlvo.updated_at || providenciaAlvo.created_at || new Date().toISOString()
      eventKey = `providencia_atualizacao:${providenciaAlvo.id}:${provUpdatedAt}`
    }

    // 6. PONTOS 5 E 6: Aquisição atômica com token de posse (owner_token)
    // - Gera UUID exclusivo para esta chamada (owner_token)
    // - Exclusividade garantida pelo token de posse + retorno OBRIGATÓRIO (RETURNING via .select())
    // - Bloqueia retry automático em estado 'uncertain' / 'pending_reconciliation'
    const callOwnerToken = crypto.randomUUID()
    const lockCutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    let acquiredEvent: any = null

    // 6.1 Consulta inicial do evento existente
    const { data: existingEvent, error: checkEventError } = await supabase
      .from('task_email_eventos')
      .select('id, event_key, status, sent_at, updated_at, locked_at, owner_token')
      .eq('event_key', eventKey)
      .maybeSingle()

    if (checkEventError) {
      console.error('Falha de banco ao consultar task_email_eventos:', checkEventError)
      return new Response(
        JSON.stringify({
          success: false,
          sent: false,
          error:
            'Falha técnica ao verificar registro de idempotência do evento. Envio SMTP impedido.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Se já foi enviado com sucesso, abortar imediatamente
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

    // Ponto 6: Se o evento está em estado incerto / reconciliação pendente / smtp_maybe_sent, NUNCA permite retry automático
    if (
      existingEvent &&
      (existingEvent.status === 'uncertain' ||
        existingEvent.status === 'pending_reconciliation' ||
        existingEvent.status === 'smtp_maybe_sent')
    ) {
      return new Response(
        JSON.stringify({
          triggered: true,
          sent: false,
          reason: 'uncertain_status_reconciliation_required',
          message:
            'O status de envio deste evento está incerto e aguarda reconciliação manual. Reenvio automático bloqueado para evitar duplicidade.',
          event_key: eventKey,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!existingEvent) {
      // Inserção atômica com owner_token inicial
      const nowIso = new Date().toISOString()
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
          owner_token: callOwnerToken,
          locked_at: nowIso,
          data_referencia: nowIso.split('T')[0],
        })
        .select('id, owner_token, status')
        .maybeSingle()

      if (insertEventError) {
        // Conflito de concorrência (23505)
        if (insertEventError.code === '23505' || insertEventError.message?.includes('23505')) {
          // Tentar adquirir o evento concorrente via update condicional atômico
          const { data: raceAcquired } = await supabase
            .from('task_email_eventos')
            .update({
              status: 'pending',
              owner_token: callOwnerToken,
              locked_at: nowIso,
              to_email: toEmail,
              cc_email: ccEmail,
            })
            .eq('event_key', eventKey)
            .in('status', ['error'])
            .select('id, owner_token, status')
            .maybeSingle()

          if (!raceAcquired) {
            // Verificar se o concorrente concluiu com sucesso
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

            return new Response(
              JSON.stringify({
                triggered: true,
                sent: false,
                reason: 'in_progress',
                message: 'Disparo concorrente detectado para o mesmo evento.',
                event_key: eventKey,
              }),
              {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              },
            )
          }

          acquiredEvent = raceAcquired
        } else {
          // Qualquer outro erro de banco ao registrar: IMPEDIR SMTP
          console.error(
            'Erro impeditivo ao registrar evento em task_email_eventos:',
            insertEventError,
          )
          return new Response(
            JSON.stringify({
              success: false,
              sent: false,
              error:
                'Falha técnica ao registrar controle de evento no banco de dados. Envio cancelado por segurança.',
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          )
        }
      } else {
        acquiredEvent = insertedEvent
      }
    } else {
      // Re-tentativa em evento existente:
      // Aquisição atômica com token de posse condicional ao estado anterior:
      // Só adquire se status = 'error' OU (status = 'pending' com locked_at < lockCutoff)
      const nowIso = new Date().toISOString()
      const { data: updatedRows, error: updateErr } = await supabase
        .from('task_email_eventos')
        .update({
          status: 'pending',
          owner_token: callOwnerToken,
          locked_at: nowIso,
          to_email: toEmail,
          cc_email: ccEmail,
          data_referencia: nowIso.split('T')[0],
        })
        .eq('id', existingEvent.id)
        .neq('status', 'success')
        .neq('status', 'uncertain')
        .neq('status', 'pending_reconciliation')
        .neq('status', 'smtp_maybe_sent')
        .or(`status.eq.error,locked_at.is.null,locked_at.lt.${lockCutoffIso}`)
        .select('id, owner_token, status')

      if (updateErr) {
        console.error('Erro ao tentar adquirir bloqueio atômico:', updateErr)
        return new Response(
          JSON.stringify({
            success: false,
            sent: false,
            error: 'Falha técnica ao tentar adquirir bloqueio atômico para envio.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      // Verificação OBRIGATÓRIA de retorno de linhas adquiridas (Ponto 5)
      if (!updatedRows || updatedRows.length === 0) {
        // Zero linhas adquiridas: outra chamada já adquiriu ou o evento mudou para success/uncertain
        const { data: latestState } = await supabase
          .from('task_email_eventos')
          .select('id, status')
          .eq('id', existingEvent.id)
          .maybeSingle()

        if (latestState && latestState.status === 'success') {
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

        return new Response(
          JSON.stringify({
            triggered: true,
            sent: false,
            reason: 'in_progress',
            message:
              'O envio deste evento já foi adquirido por outra requisição simultânea (aquisição de 0 linhas).',
            event_key: eventKey,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      acquiredEvent = updatedRows[0]
    }

    if (!acquiredEvent || acquiredEvent.owner_token !== callOwnerToken) {
      return new Response(
        JSON.stringify({
          triggered: true,
          sent: false,
          reason: 'lock_acquisition_failed',
          message: 'Falha ao adquirir exclusividade para envio do evento.',
          event_key: eventKey,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const eventoId = acquiredEvent.id

    // 7. Preparar conteúdo de e-mail de acordo com o tipo
    // Dados gerais: resolução exclusiva a partir dos registros validados no Gestor de Acessos (core_usuarios)
    // SEM qualquer consulta a task_usuarios.
    const execNomeFull = (validatedExecutor.nome || '').trim()
    const execFirstName = execNomeFull ? execNomeFull.split(/\s+/)[0] : 'Executor'
    const respNomeFull = (validatedResponsavel?.nome || '').trim()
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

      subject = `Alteração de atribuição Ricci Task [Caso ${numeroCasoStr}]`
      bodyLines.push(`Olá, ${execFirstName}.`)
      bodyLines.push('')
      bodyLines.push('Houve uma alteração de atribuição no seu caso no Ricci Task.')
      bodyLines.push('')
      if (nomeControle) bodyLines.push(`Controle: ${nomeControle}`)
      bodyLines.push(`Caso: ${numeroCasoStr}`)
      if (tarefa.identificacao_caso?.trim())
        bodyLines.push(`Identificação: ${tarefa.identificacao_caso.trim()}`)
      bodyLines.push(`Executor: ${execNomeFull || 'Não definido'}`)
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
    bodyLines.push('https://ricci-task.goskip.app/')

    const escapedSubject = escapeHtml(subject)
    const emailHtml = `
      <div style="font-family: sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a; margin-bottom: 16px;">${escapedSubject}</h2>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          ${bodyLines
            .filter((line) => line !== 'https://ricci-task.goskip.app/')
            .map((line) =>
              line === '' ? '<br/>' : `<p style="margin: 4px 0;">${escapeHtml(line)}</p>`,
            )
            .join('')}
        </div>
        <p style="margin-top: 24px;">
          <a href="https://ricci-task.goskip.app/" style="background-color: #0284c7; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
            Acessar o Ricci Task
          </a>
        </p>
        <p style="margin-top: 16px; font-size: 13px; color: #64748b;">
          Link direto: <a href="https://ricci-task.goskip.app/" style="color: #0284c7;">https://ricci-task.goskip.app/</a>
        </p>
      </div>
    `

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
      html: string
    } = {
      from: `"${senderName}" <${setting.sender_email}>`,
      to: toEmail,
      ...(ccEmail ? { cc: ccEmail } : {}),
      replyTo: setting.reply_to || undefined,
      subject,
      text: emailText,
      html: emailHtml,
    }

    // 10. PONTOS 5 E 6: Envio e registro com tratamento de resultado incerto e posse exclusiva
    // ITEM 1/2: Antes de chamar o envio SMTP, gravar atomicamente status 'smtp_maybe_sent'
    // com UPDATE condicionado ao owner_token atual e RETURNING obrigatório;
    // zero linhas ou erro -> NÃO enviar (erro técnico recuperável).
    const preSmtpIso = new Date().toISOString()
    const { data: maybeSentRows, error: maybeSentErr } = await supabase
      .from('task_email_eventos')
      .update({
        status: 'smtp_maybe_sent',
        locked_at: preSmtpIso,
      })
      .eq('id', eventoId)
      .eq('owner_token', callOwnerToken)
      .select('id, status, owner_token')

    if (maybeSentErr || !maybeSentRows || maybeSentRows.length === 0) {
      console.error(
        'Falha técnica ao marcar status smtp_maybe_sent antes do SMTP:',
        maybeSentErr || '0 linhas afetadas',
      )
      return new Response(
        JSON.stringify({
          success: false,
          sent: false,
          error:
            'Falha técnica ao assegurar pré-registro de envio (smtp_maybe_sent). Envio cancelado por segurança.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    let smtpSuccess = false
    let sendErrorMessage: string | null = null

    try {
      await transporter.sendMail(mailOptions)
      smtpSuccess = true
    } catch (sendError: any) {
      console.error('Erro no transporte SMTP:', sendError)
      sendErrorMessage = sendError.message || String(sendError)

      // Detecta se pode ter sido timeout ou erro de socket com resultado incerto
      const isTimeoutOrNetwork =
        sendError.code === 'ETIMEDOUT' ||
        sendError.code === 'ESOCKET' ||
        sendError.code === 'ECONNRESET' ||
        /timeout/i.test(sendErrorMessage || '')

      const errorStatus = isTimeoutOrNetwork ? 'uncertain' : 'error'

      // Registrar erro ou estado incerto em task_email_eventos (apenas se formos o dono)
      if (eventoId) {
        await supabase
          .from('task_email_eventos')
          .update({
            status: errorStatus,
            erro: sendErrorMessage,
          })
          .eq('id', eventoId)
          .eq('owner_token', callOwnerToken)
      }

      await supabase.from('email_send_logs').insert({
        type: `ricci_task_${dbTipoEvento}`,
        to_email: toEmail,
        subject: mailOptions.subject,
        status: errorStatus,
        error_message: sendErrorMessage,
        created_by: user.id,
        created_at: new Date().toISOString(),
      })

      return new Response(
        JSON.stringify({
          success: false,
          sent: false,
          status: errorStatus,
          error: isTimeoutOrNetwork
            ? 'Resultado incerto no transporte SMTP (timeout/conexão). Marcado para reconciliação manual.'
            : `Erro ao enviar e-mail pelo provedor: ${sendErrorMessage}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 11. PONTO 6: Persistência pós-SMTP com tratamento de falha
    // Se o SMTP teve sucesso, mas a persistência de 'success' falhar:
    // O evento NÃO pode ser deixado como 'error' para não permitir retry automático que duplicaria o e-mail!
    // Deve ser gravado em estado 'uncertain' / 'pending_reconciliation' com o erro correspondente.
    const agoraIso = new Date().toISOString()
    let persistenceFailed = false

    try {
      const { data: updatedSuccessRows, error: updateSuccessErr } = await supabase
        .from('task_email_eventos')
        .update({
          status: 'success',
          sent_at: agoraIso,
          erro: null,
        })
        .eq('id', eventoId)
        .eq('owner_token', callOwnerToken)
        .select('id, status')

      if (updateSuccessErr || !updatedSuccessRows || updatedSuccessRows.length === 0) {
        persistenceFailed = true
        console.error(
          'Falha crítica de persistência após envio SMTP com sucesso:',
          updateSuccessErr,
        )

        // Registrar status incerto para bloquear retries automáticos
        await supabase
          .from('task_email_eventos')
          .update({
            status: 'uncertain',
            sent_at: agoraIso,
            erro: `Enviado via SMTP mas falha na persistência de sucesso: ${updateSuccessErr?.message || '0 linhas atualizadas'}`,
          })
          .eq('id', eventoId)
          .eq('owner_token', callOwnerToken)
      }
    } catch (persErr: any) {
      persistenceFailed = true
      console.error('Exceção ao persistir status de sucesso pós-SMTP:', persErr)
      try {
        await supabase
          .from('task_email_eventos')
          .update({
            status: 'uncertain',
            sent_at: agoraIso,
            erro: `Exceção pós-SMTP: ${persErr?.message || String(persErr)}`,
          })
          .eq('id', eventoId)
          .eq('owner_token', callOwnerToken)
      } catch (_ignored) {}
    }

    // Registrar em email_send_logs
    const { error: logError } = await supabase.from('email_send_logs').insert({
      type: `ricci_task_${dbTipoEvento}`,
      to_email: toEmail,
      subject: mailOptions.subject,
      status: persistenceFailed ? 'uncertain' : 'success',
      created_by: user.id,
      created_at: agoraIso,
      error_message: persistenceFailed
        ? 'Enviado via SMTP mas falha ao atualizar registro de evento.'
        : null,
    })

    if (logError) {
      console.error('Erro ao registrar log em email_send_logs:', logError)
    }

    if (persistenceFailed) {
      return new Response(
        JSON.stringify({
          success: false,
          sent: true,
          status: 'uncertain',
          reason: 'post_send_persistence_failure',
          message:
            'E-mail enviado via SMTP com sucesso, porém houve falha ao registrar confirmação final. Evento marcado como incerto (aguardando reconciliação) para evitar reenvio duplicado.',
          event_key: eventKey,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

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
