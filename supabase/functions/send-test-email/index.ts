import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer'

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
      throw new Error('Permissão negada: apenas gestores podem testar o envio de e-mails.')
    }

    const { to_email } = await req.json()
    if (!to_email) throw new Error('Destinatário não informado.')

    // Fetch active settings
    const { data: setting, error: settingError } = await supabase
      .from('email_settings')
      .select('*')
      .eq('active', true)
      .limit(1)
      .maybeSingle()

    if (settingError) throw settingError
    if (!setting) throw new Error('Nenhuma configuração de e-mail ativa encontrada.')

    // Fetch secret
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

    const mailOptions = {
      from: `"${setting.sender_name}" <${setting.sender_email}>`,
      to: to_email,
      replyTo: setting.reply_to || undefined,
      subject: 'Teste de envio - Conectaí',
      text: 'Este é um e-mail de teste do sistema Conectaí. Se você recebeu isso, a configuração está correta!',
      html: '<h3>Teste Conectaí</h3><p>Este é um e-mail de teste do sistema Conectaí.</p><p>Se você recebeu isso, a configuração está correta!</p>',
    }

    try {
      await transporter.sendMail(mailOptions)
    } catch (sendError: any) {
      await supabase.from('email_send_logs').insert({
        type: 'test',
        to_email,
        subject: mailOptions.subject,
        status: 'error',
        error_message: sendError.message || String(sendError),
        created_by: user.id,
        created_at: new Date().toISOString(),
      })
      throw new Error(`Erro ao enviar e-mail pelo provedor: ${sendError.message}`)
    }

    const { error: logError } = await supabase.from('email_send_logs').insert({
      type: 'test',
      to_email,
      subject: mailOptions.subject,
      status: 'success',
      created_by: user.id,
      created_at: new Date().toISOString(),
    })

    if (logError) console.error('Erro ao logar envio com sucesso', logError)

    return new Response(
      JSON.stringify({ success: true, message: 'E-mail de teste enviado com sucesso!' }),
      {
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
