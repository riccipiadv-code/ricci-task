import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  normalizeManyChatPayload,
  enrichManyChatRecord,
  resolveManyChatService,
} from '../_shared/manychat.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let executionMode = 'automatic'
  if (req.method === 'POST') {
    try {
      const clonedReq = req.clone()
      const text = await clonedReq.text()
      if (text) {
        const body = JSON.parse(text)
        if (body.execution_mode) {
          executionMode = body.execution_mode
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  const executionSteps: any[] = []
  const addStep = (step: string, status: 'ok' | 'fail' | 'info', details?: any) => {
    executionSteps.push({ step, status, details, timestamp: new Date().toISOString() })
  }

  addStep('secrets', 'ok', 'Verificando variáveis de ambiente')
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    addStep('secrets', 'fail', 'Variáveis de ambiente ausentes')
    return new Response(
      JSON.stringify({
        success: false,
        stage: 'secrets',
        message: 'Variáveis de ambiente ausentes (SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY)',
        steps: executionSteps,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    addStep('sync_control_check', 'info')

    const { data: lastSync } = await supabase
      .from('manychat_sync_control')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastSync && lastSync.status === 'running') {
      const isStale = new Date().getTime() - new Date(lastSync.created_at).getTime() > 5 * 60000
      if (!isStale) {
        addStep('sync_control_check', 'fail', 'Sync already running')
        return new Response(
          JSON.stringify({
            success: false,
            stage: 'sync_control_check',
            message:
              'Sincronização já está em andamento (automática ou outra execução manual). Aguarde alguns instantes.',
            steps: executionSteps,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      } else {
        await supabase
          .from('manychat_sync_control')
          .update({
            status: 'error',
            last_error: 'Execução anterior travada (stale). Recuperada pela nova rodada.',
          })
          .eq('id', lastSync.id)
        addStep('sync_control_check', 'info', 'Execução travada recuperada.')
      }
    }

    const { data: currentSync, error: syncError } = await supabase
      .from('manychat_sync_control')
      .insert({
        sync_type: executionMode === 'manual' ? 'manual' : 'automatic',
        status: 'running',
      })
      .select()
      .single()

    if (syncError) throw syncError

    let insertedCount = 0
    let updatedCount = 0
    let errorCount = 0
    let ignoredCount = 0
    let foundCount = 0

    addStep('queue_fetch', 'info', 'Buscando registros pendentes')
    const { data: pendingLogs, error: fetchError } = await supabase
      .from('integration_logs')
      .select('*')
      .in('status', ['pending', 'received'])
      .order('created_at', { ascending: true })
      .limit(100)

    if (fetchError) throw new Error(`Erro ao buscar fila: ${fetchError.message}`)

    if (pendingLogs && pendingLogs.length > 0) {
      foundCount = pendingLogs.length

      const isBulkImport = pendingLogs.some(
        (log) => log.event_type === 'bulk_import' || log.detected_event_type === 'bulk_import',
      )
      if (isBulkImport) {
        await supabase
          .from('manychat_sync_control')
          .update({ sync_type: 'bulk_import' })
          .eq('id', currentSync.id)
      }

      addStep('queue_process_start', 'info', { queue_size: foundCount, isBulkImport })

      for (const log of pendingLogs) {
        try {
          const payload = log.payload as any
          const { subscriber_id, sub, extracted } = normalizeManyChatPayload(payload)
          // Prioriza o subscriber_id normalizado do payload, caso contrário tenta usar o salvo no log
          const finalSubscriberId = subscriber_id || log.subscriber_id

          if (!finalSubscriberId) {
            ignoredCount++
            await supabase
              .from('integration_logs')
              .update({
                status: 'error',
                error_message:
                  'Ignorado: Payload não contém um ID de subscriber estruturado e válido',
              })
              .eq('id', log.id)
            continue
          }

          if (finalSubscriberId) {
            const manychatIdStr = String(finalSubscriberId)

            const { data: existing } = await supabase
              .from('manychat_contatos')
              .select('id, origem, origem_id, responsavel_id')
              .eq('manychat_id', manychatIdStr)
              .maybeSingle()

            const isInsert = !existing
            const now = new Date().toISOString()

            let generatedAtDate = null
            if (extracted.generated_at) {
              const parsed = new Date(extracted.generated_at)
              if (!isNaN(parsed.getTime())) {
                generatedAtDate = parsed.toISOString()
              }
            }

            const record: any = {
              manychat_id: manychatIdStr,
              nome: extracted.nome,
              first_name: extracted.first_name,
              last_name: extracted.last_name,
              telefone: extracted.telefone,
              status: extracted.status,
              foto: extracted.foto,
              genero: extracted.genero,
              last_interaction_at: extracted.last_interaction
                ? new Date(extracted.last_interaction).toISOString()
                : now,
              payload_bruto: payload,
              manychat_data: sub,
              external_transfers: extracted.external_transfers,
              messages_payload: extracted.messages_payload,
              generated_at: generatedAtDate,
              last_synced_at: now,
              last_update_status: 'updated',
              last_update_log: null,
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

            await enrichManyChatRecord(supabase, record, existing)

            const { error: upsertError } = await supabase
              .from('manychat_contatos')
              .upsert(record, { onConflict: 'manychat_id' })

            if (upsertError) throw upsertError

            if (extracted.attributes && Object.keys(extracted.attributes).length > 0) {
              const attrsToInsert = Object.entries(extracted.attributes).map(([key, value]) => ({
                manychat_id: manychatIdStr,
                attribute_key: key,
                attribute_value: value,
                updated_at: now,
              }))

              await supabase
                .from('manychat_contact_attributes')
                .upsert(attrsToInsert, { onConflict: 'manychat_id,attribute_key' })
            }

            if (isInsert) {
              insertedCount++
            } else {
              updatedCount++
            }
          }

          await supabase.from('integration_logs').update({ status: 'processed' }).eq('id', log.id)
        } catch (err: any) {
          errorCount++

          await supabase
            .from('integration_logs')
            .update({ status: 'error', error_message: err.message })
            .eq('id', log.id)

          const payload = log.payload as any
          const { subscriber_id } = normalizeManyChatPayload(payload)
          const finalId = subscriber_id || log.subscriber_id

          if (finalId) {
            await supabase.from('manychat_contatos').upsert(
              {
                manychat_id: String(finalId),
                last_synced_at: new Date().toISOString(),
                last_update_status: 'error',
                last_update_log: err.message || 'Erro estrutural ao processar payload do webhook',
              },
              { onConflict: 'manychat_id' },
            )
          }
        }
      }

      addStep('database_update', 'ok', { insertedCount, updatedCount, errorCount, ignoredCount })
      addStep('integration_log_update', 'ok', { processed: foundCount })
    } else {
      addStep('queue_process_start', 'info', { message: 'Fila vazia. Nenhum evento pendente.' })
    }

    let finalStatus = 'success'
    if (errorCount > 0 || ignoredCount > 0) {
      if (insertedCount > 0 || updatedCount > 0) finalStatus = 'partial_success'
      else finalStatus = 'error'
    } else if (foundCount > 0 && insertedCount === 0 && updatedCount === 0) {
      // Se encontrou itens mas não inseriu, não atualizou, não errou e não ignorou... algo falhou silenciosamente
      finalStatus = 'error'
    }

    let lastErrorMsg = null
    if (errorCount > 0 || ignoredCount > 0) {
      lastErrorMsg = `Houve ${errorCount} erros e ${ignoredCount} ignorados durante o processamento. Consulte logs individuais.`
    } else if (foundCount > 0 && insertedCount === 0 && updatedCount === 0) {
      lastErrorMsg =
        'Falha de consumo: Itens encontrados na fila, mas nenhum foi processado efetivamente.'
    }

    await supabase
      .from('manychat_sync_control')
      .update({
        status: finalStatus,
        last_successful_sync:
          finalStatus === 'success' || finalStatus === 'partial_success'
            ? new Date().toISOString()
            : undefined,
        inserted_count: insertedCount,
        updated_count: updatedCount,
        error_count: errorCount + ignoredCount,
        last_error: lastErrorMsg,
      })
      .eq('id', currentSync.id)

    if (executionMode === 'manual') {
      await supabase.from('integration_logs').insert({
        event_type: 'manual_sync_execution',
        status:
          finalStatus === 'success' || finalStatus === 'partial_success' ? 'processed' : 'error',
        error_message: lastErrorMsg,
        processing_context: {
          foundCount,
          insertedCount,
          updatedCount,
          errorCount,
          ignoredCount,
          finalStatus,
        },
        received_at: new Date().toISOString(),
      })
    }

    addStep('final', 'ok', {
      foundCount,
      insertedCount,
      updatedCount,
      errorCount,
      ignoredCount,
      finalStatus,
    })

    return new Response(
      JSON.stringify({
        success: finalStatus !== 'error',
        foundCount,
        insertedCount,
        updatedCount,
        errorCount,
        ignoredCount,
        status: finalStatus,
        message: lastErrorMsg,
        steps: executionSteps,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    addStep('final', 'fail', error.message)
    const stage =
      executionSteps.length > 0 ? executionSteps[executionSteps.length - 1].step : 'unknown'
    const structuredErrorMessage = `[Etapa: ${stage}] ${error.message || String(error)}`

    try {
      const { data: runningSync } = await supabase
        .from('manychat_sync_control')
        .select('id')
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (runningSync) {
        await supabase
          .from('manychat_sync_control')
          .update({ status: 'error', last_error: structuredErrorMessage })
          .eq('id', runningSync.id)
      } else {
        await supabase.from('manychat_sync_control').insert({
          sync_type: 'error_recovery',
          status: 'error',
          last_error: structuredErrorMessage,
        })
      }

      if (executionMode === 'manual') {
        await supabase.from('integration_logs').insert({
          event_type: 'manual_sync_execution',
          status: 'error',
          error_message: structuredErrorMessage,
          processing_context: { stage, steps: executionSteps },
          received_at: new Date().toISOString(),
        })
      }
    } catch (e) {
      console.error('Error recovering sync control', e)
    }

    return new Response(
      JSON.stringify({
        success: false,
        stage: stage,
        message: error.message || 'Erro interno na sincronização',
        details: String(error),
        steps: executionSteps,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
