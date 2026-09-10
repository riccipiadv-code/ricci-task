export function normalizeManyChatPayload(payload: any) {
  let sub =
    payload?.contact ||
    payload?.subscriber ||
    payload?.data?.subscriber ||
    payload?.data ||
    payload?.user ||
    payload
  if (Array.isArray(sub)) sub = sub[0]

  const subscriberId = sub?.id || sub?.user_id || sub?.subscriber_id || payload?.user_id || null
  const eventType =
    payload?.event || payload?.type || (subscriberId ? 'subscriber_update' : 'unknown')

  const nomeRaw = sub?.name || sub?.full_name || ''
  const nome = nomeRaw || `${sub?.first_name || ''} ${sub?.last_name || ''}`.trim() || 'Sem nome'
  const firstName = sub?.first_name || nome.split(' ')[0] || null
  const lastName = sub?.last_name || nome.split(' ').slice(1).join(' ') || null
  const telefone = sub?.phone || sub?.whatsapp_phone || null
  const status = sub?.status || 'unknown'
  const foto = sub?.profile_pic || sub?.avatar_url || sub?.ava || null
  const genero = sub?.gender || null
  const locale = sub?.locale || null
  const timezone = sub?.timezone || null
  const lastInteraction = sub?.last_interaction_at || sub?.last_interaction || null

  const generatedAt = payload?.generated || sub?.generated || null
  const externalTransfers = payload?.external_transfers || sub?.external_transfers || null
  const messagesPayload = payload?.messages || sub?.messages || null

  const lead_nome_exibicao = sub?.name || nomeRaw || nome
  const manychat_live_chat_url = sub?.live_chat_url || null
  let subscribed_at = sub?.subscribed || null
  if (subscribed_at && !isNaN(new Date(subscribed_at).getTime())) {
    subscribed_at = new Date(subscribed_at).toISOString()
  } else {
    subscribed_at = null
  }
  const whatsapp_phone = sub?.whatsapp_phone || telefone

  const customFields = sub?.custom_fields || payload?.custom_fields
  let cfMap: Record<string, any> = {}
  if (Array.isArray(customFields)) {
    customFields.forEach((cf: any) => {
      if (cf.name) cfMap[cf.name] = cf.value
    })
  } else if (typeof customFields === 'object' && customFields !== null) {
    cfMap = customFields
  }

  const nome_servico =
    cfMap['nome_servico'] !== undefined && cfMap['nome_servico'] !== null
      ? String(cfMap['nome_servico']).trim()
      : null
  const user_servico =
    cfMap['user_servico'] !== undefined && cfMap['user_servico'] !== null
      ? String(cfMap['user_servico']).trim()
      : null

  let lead_nome = cfMap['user_nome'] || sub?.name || sub?.first_name || null
  let lead_email = cfMap['user_email'] || sub?.email || null
  let lead_empresa_pf = cfMap['user_empresa'] || cfMap['user_tipo'] || null
  let lead_resumo = cfMap['user_resumo'] || null

  const depto_id = null

  let lead_servico = nome_servico && nome_servico.length > 0 ? nome_servico : null
  if (!lead_servico && user_servico && user_servico.length > 0) {
    lead_servico = mapServicoLegado(user_servico)
  }

  const chatgpt_resposta = cfMap['chatgpt_resposta_anterior'] || null

  if (chatgpt_resposta) {
    let text = String(chatgpt_resposta)
    const markers = [
      '------------------------------------------------------------------',
      '▶️',
      'Em breve você será atendido',
      'Obrigado pelo contato',
    ]
    for (const marker of markers) {
      const idx = text.indexOf(marker)
      if (idx !== -1) {
        text = text.substring(0, idx)
      }
    }

    const lines = text.split('\n')
    let currentField = null
    let resumoLines: string[] = []

    for (const line of lines) {
      const tLine = line.trim()
      if (!lead_nome && tLine.startsWith('👤 Nome:')) {
        lead_nome = tLine.replace('👤 Nome:', '').trim()
        currentField = 'nome'
      } else if (!lead_empresa_pf && tLine.startsWith('🏢 Empresa/PF:')) {
        lead_empresa_pf = tLine.replace('🏢 Empresa/PF:', '').trim()
        currentField = 'empresa'
      } else if (!lead_email && tLine.startsWith('📧 E-mail:')) {
        lead_email = tLine.replace('📧 E-mail:', '').trim()
        currentField = 'email'
      } else if (!lead_servico && tLine.startsWith('🛠️ Serviço Selecionado:')) {
        lead_servico = mapServicoLegado(tLine.replace('🛠️ Serviço Selecionado:', '').trim())
        currentField = 'servico'
      } else if (tLine.startsWith('📝 Resumo da Solicitação:')) {
        const val = tLine.replace('📝 Resumo da Solicitação:', '').trim()
        if (val) resumoLines.push(val)
        currentField = 'resumo'
      } else if (currentField === 'resumo' && tLine) {
        resumoLines.push(tLine)
      }
    }

    if (!lead_resumo && resumoLines.length > 0) {
      lead_resumo = resumoLines.join('\n').trim()
    } else if (!lead_resumo && !currentField) {
      lead_resumo = text.trim()
    }
  }

  const attributes: Record<string, string> = {}
  const extractAttributes = (obj: any) => {
    if (!obj || typeof obj !== 'object') return
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        if (key.startsWith('custom_field') || key.startsWith('question') || key.startsWith('cf_')) {
          attributes[key] = String(value)
        }
      }
    }
  }

  extractAttributes(payload)
  extractAttributes(payload?.data)
  extractAttributes(payload?.subscriber)
  extractAttributes(sub)
  extractAttributes(cfMap)

  return {
    subscriber_id: subscriberId ? String(subscriberId) : null,
    event_type: eventType,
    sub,
    extracted: {
      nome,
      first_name: firstName,
      last_name: lastName,
      telefone,
      status,
      foto,
      genero,
      locale,
      timezone,
      last_interaction: lastInteraction,
      generated_at: generatedAt,
      external_transfers: externalTransfers,
      messages_payload: messagesPayload,
      lead_nome_exibicao,
      manychat_live_chat_url,
      subscribed_at,
      whatsapp_phone,
      lead_nome,
      lead_servico,
      lead_email,
      lead_empresa_pf,
      lead_resumo,
      depto_id,
      nome_servico: nome_servico && nome_servico.length > 0 ? nome_servico : null,
      user_servico: user_servico && user_servico.length > 0 ? user_servico : null,
      attributes,
    },
  }
}

export function mapServicoLegado(val: string): string {
  switch (String(val).trim()) {
    case '1':
      return 'Registro de Marcas'
    case '2':
      return 'Proteção de Patentes'
    case '3':
      return 'Desenho Industrial'
    case '4':
      return 'Ações Judiciais'
    case '5':
      return 'Outros Assuntos'
    default:
      return val
  }
}

export interface ResolvedService {
  servico_id: string | null
  lead_servico: string | null
  depto_id: number | null
}

export async function resolveManyChatService(
  supabase: any,
  nomeServico?: string | null,
  userServico?: string | null,
): Promise<ResolvedService> {
  const nomeTrim = nomeServico && typeof nomeServico === 'string' ? nomeServico.trim() : ''
  const userTrim = userServico && typeof userServico === 'string' ? userServico.trim() : ''

  let targetName: string | null = null

  if (nomeTrim) {
    targetName = nomeTrim
  } else if (userTrim) {
    targetName = mapServicoLegado(userTrim)
  }

  if (!targetName) {
    return { servico_id: null, lead_servico: null, depto_id: null }
  }

  // 1. Busca exata por descricao (case-insensitive)
  let { data: servico } = await supabase
    .from('manychat_servicos')
    .select('id, descricao, depto_id')
    .ilike('descricao', targetName)
    .maybeSingle()

  // 2. Se não encontrar, busca parcial
  if (!servico) {
    const { data: servicoLike } = await supabase
      .from('manychat_servicos')
      .select('id, descricao, depto_id')
      .ilike('descricao', `%${targetName}%`)
      .limit(1)
      .maybeSingle()
    servico = servicoLike
  }

  if (servico) {
    return {
      servico_id: servico.id,
      lead_servico: servico.descricao,
      depto_id:
        servico.depto_id !== undefined && servico.depto_id !== null
          ? Number(servico.depto_id)
          : null,
    }
  }

  // Se não encontrar cadastro no banco, preserva o nome como lead_servico e deixa depto_id nulo
  return {
    servico_id: null,
    lead_servico: targetName,
    depto_id: null,
  }
}

let cachedAnaEdithId: string | null | undefined = undefined
let cachedWhatsappOrigemId: number | null | undefined = undefined

export async function getDefaultOrigemId(supabase: any): Promise<number | null> {
  if (cachedWhatsappOrigemId !== undefined) {
    return cachedWhatsappOrigemId
  }

  const { data: origem } = await supabase
    .from('manychat_origens')
    .select('id')
    .eq('nome', 'Whatsapp')
    .limit(1)
    .maybeSingle()

  if (origem) {
    cachedWhatsappOrigemId = origem.id
  } else {
    console.warn('Default origin "Whatsapp" not found in manychat_origens')
    cachedWhatsappOrigemId = null
  }

  return cachedWhatsappOrigemId
}

export async function getDefaultResponsavelId(supabase: any): Promise<string | null> {
  if (cachedAnaEdithId !== undefined) {
    return cachedAnaEdithId
  }

  const { data: user } = await supabase
    .from('legaldesk_usuarios')
    .select('id')
    .eq('nome', 'Ana Edith')
    .limit(1)
    .maybeSingle()

  if (user) {
    cachedAnaEdithId = user.id
  } else {
    console.warn('Default responsible user "Ana Edith" not found in legaldesk_usuarios')
    cachedAnaEdithId = null
  }

  return cachedAnaEdithId
}

export async function enrichManyChatRecord(
  supabase: any,
  record: any,
  existingContact: any | null,
) {
  if (!existingContact || !existingContact.origem) {
    record.origem = 'Whatsapp'
  }

  if (!existingContact || !existingContact.origem_id) {
    if (record.origem === 'Whatsapp' || existingContact?.origem === 'Whatsapp') {
      const origemId = await getDefaultOrigemId(supabase)
      if (origemId) {
        record.origem_id = origemId
      }
    }
  }

  if (!existingContact || !existingContact.responsavel_id) {
    const responsavelId = await getDefaultResponsavelId(supabase)
    if (responsavelId) {
      record.responsavel_id = responsavelId
    }
  }
}
