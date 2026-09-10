import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  normalizeManyChatPayload,
  enrichManyChatRecord,
  resolveManyChatService,
} from '../_shared/manychat.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ success: false, error: 'Secrets missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let rawPayload
  try {
    rawPayload = await req.json()
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payloads = Array.isArray(rawPayload) ? rawPayload : [rawPayload]

  let processed = 0
  let errors = 0

  for (const payload of payloads) {
    const { subscriber_id, event_type, sub, extracted } = normalizeManyChatPayload(payload)

    let status = 'processed'
    let errorMessage = null

    if (!subscriber_id) {
      status = 'error'
      errorMessage = 'Missing subscriber_id'
    } else {
      const record: any = {
        manychat_id: String(subscriber_id),
        nome: extracted.nome,
        first_name: extracted.first_name,
        last_name: extracted.last_name,
        telefone: extracted.telefone,
        status: extracted.status,
        foto: extracted.foto,
        genero: extracted.genero,
        last_interaction_at: extracted.last_interaction
          ? new Date(extracted.last_interaction).toISOString()
          : new Date().toISOString(),
        payload_bruto: payload,
        manychat_data: sub,
        external_transfers: extracted.external_transfers,
        messages_payload: extracted.messages_payload,
        generated_at: extracted.generated_at
          ? new Date(extracted.generated_at).toISOString()
          : null,
        last_synced_at: new Date().toISOString(),
        last_update_status: 'updated',
        lead_nome_exibicao: extracted.lead_nome_exibicao,
        manychat_live_chat_url: extracted.manychat_live_chat_url,
        subscribed_at: extracted.subscribed_at,
        whatsapp_phone: extracted.whatsapp_phone,
        lead_nome: extracted.lead_nome,
        lead_servico: extracted.lead_servico,
        lead_email: extracted.lead_email,
        lead_empresa_pf: extracted.lead_empresa_pf,
        lead_resumo: extracted.lead_resumo,
        depto_id: extracted.depto_id,
      }

      const resolvedService = await resolveManyChatService(
        supabase,
        extracted.nome_servico,
        extracted.user_servico,
      )

      record.lead_servico = resolvedService.lead_servico
      record.servico_id = resolvedService.servico_id
      record.depto_id = resolvedService.depto_id

      const { data: existingContact } = await supabase
        .from('manychat_contatos')
        .select('id, origem, origem_id, responsavel_id')
        .eq('manychat_id', String(subscriber_id))
        .maybeSingle()

      if (!existingContact) {
        record.current_stage = 'nivel_1_novo'
        record.sla_status = 'green'
        record.sla_started_at = new Date().toISOString()
      }

      await enrichManyChatRecord(supabase, record, existingContact)

      const { error: upsertError } = await supabase
        .from('manychat_contatos')
        .upsert(record, { onConflict: 'manychat_id' })

      if (upsertError) {
        status = 'error'
        errorMessage = upsertError.message
      } else if (extracted.attributes && Object.keys(extracted.attributes).length > 0) {
        const attrsToInsert = Object.entries(extracted.attributes).map(([key, value]) => ({
          manychat_id: String(subscriber_id),
          attribute_key: key,
          attribute_value: String(value),
          updated_at: new Date().toISOString(),
        }))
        await supabase
          .from('manychat_contact_attributes')
          .upsert(attrsToInsert, { onConflict: 'manychat_id,attribute_key' })
      }
    }

    await supabase.from('integration_logs').insert({
      event_type: event_type,
      payload: payload,
      status: status,
      error_message: errorMessage,
      subscriber_id: subscriber_id,
      detected_event_type: event_type,
      received_at: new Date().toISOString(),
      processing_context: {
        extracted_keys: sub && typeof sub === 'object' ? Object.keys(sub) : [],
        extracted_data: extracted,
        has_id: !!subscriber_id,
      },
    })

    if (status === 'error') {
      errors++
    } else {
      processed++
    }
  }

  const isSuccess = processed > 0 || payloads.length === 0

  return new Response(
    JSON.stringify({
      success: isSuccess,
      processed,
      errors,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
