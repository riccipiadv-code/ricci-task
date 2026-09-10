import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type',
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
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)

    if (userError || !user) {
      throw new Error('Não autorizado.')
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('perfil')
      .eq('id', user.id)
      .single()

    if (profileError || profile?.perfil !== 'administrador') {
      throw new Error(
        'Permissão negada: apenas administradores podem alterar configurações de e-mail de leitura.',
      )
    }

    const body = await req.json().catch(() => ({}))
    const { email, imap_host, imap_port, secret } = body

    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new Error('O e-mail é obrigatório.')
    }

    const normalizedEmail = email.trim()
    const parsedPort =
      imap_port !== undefined && imap_port !== null && imap_port !== '' ? Number(imap_port) : 993

    if (isNaN(parsedPort)) {
      throw new Error('Porta IMAP inválida.')
    }

    const hostValue =
      typeof imap_host === 'string' && imap_host.trim() ? imap_host.trim() : 'imap.gmail.com'

    const now = new Date().toISOString()

    // Verificar se já existe registro para esse e-mail
    const { data: existingSetting, error: findError } = await supabase
      .from('email_reading_settings')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (findError) {
      throw findError
    }

    let savedSetting

    if (existingSetting) {
      const { data, error } = await supabase
        .from('email_reading_settings')
        .update({
          email: normalizedEmail,
          imap_host: hostValue,
          imap_port: parsedPort,
          active: true,
          updated_by: user.id,
          updated_at: now,
        })
        .eq('id', existingSetting.id)
        .select()
        .single()

      if (error) throw error
      savedSetting = data
    } else {
      const { data, error } = await supabase
        .from('email_reading_settings')
        .insert([
          {
            email: normalizedEmail,
            imap_host: hostValue,
            imap_port: parsedPort,
            active: true,
            secret_configured: false,
            updated_by: user.id,
            created_at: now,
            updated_at: now,
          },
        ])
        .select()
        .single()

      if (error) throw error
      savedSetting = data
    }

    const trimmedSecret = typeof secret === 'string' ? secret.trim() : ''

    if (trimmedSecret.length > 0) {
      const { error: secretError } = await supabase.from('email_reading_secrets').upsert(
        {
          setting_id: savedSetting.id,
          secret_value: trimmedSecret,
          updated_at: now,
        },
        { onConflict: 'setting_id' },
      )

      if (secretError) throw secretError

      const { data: updatedSetting, error: updateFlagError } = await supabase
        .from('email_reading_settings')
        .update({
          secret_configured: true,
          updated_at: now,
        })
        .eq('id', savedSetting.id)
        .select()
        .single()

      if (updateFlagError) throw updateFlagError
      savedSetting = updatedSetting
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
