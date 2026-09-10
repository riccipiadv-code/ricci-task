import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

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
    const token = authHeader.replace('Bearer ', '')
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)

    if (userError || !user) throw new Error('Não autorizado.')

    const { data: profile } = await supabase
      .from('profiles')
      .select('perfil')
      .eq('id', user.id)
      .single()
    if (profile?.perfil !== 'administrador') {
      throw new Error('Permissão negada: apenas gestores podem alterar configurações de e-mail.')
    }

    const { setting, secret } = await req.json()
    if (!setting) throw new Error('Configuração não enviada.')

    let savedSetting
    const payload = {
      provider: setting.provider,
      sender_name: setting.sender_name,
      sender_email: setting.sender_email,
      reply_to: setting.reply_to || null,
      smtp_host: setting.smtp_host || null,
      smtp_port: setting.smtp_port || null,
      smtp_user: setting.smtp_user || null,
      smtp_secure: setting.smtp_secure ?? true,
      active: setting.active ?? true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }

    if (setting.id) {
      const { data, error } = await supabase
        .from('email_settings')
        .update(payload)
        .eq('id', setting.id)
        .select()
        .single()
      if (error) throw error
      savedSetting = data
    } else {
      const { data, error } = await supabase
        .from('email_settings')
        .insert([{ ...payload, created_at: new Date().toISOString() }])
        .select()
        .single()
      if (error) throw error
      savedSetting = data
    }

    if (secret) {
      const { error: secretError } = await supabase.from('email_secrets').upsert(
        {
          setting_id: savedSetting.id,
          secret_value: secret,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'setting_id' },
      )
      if (secretError) throw secretError

      await supabase
        .from('email_settings')
        .update({ secret_configured: true })
        .eq('id', savedSetting.id)

      savedSetting.secret_configured = true
    }

    return new Response(JSON.stringify({ success: true, setting: savedSetting }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
