import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type',
}

class ImapSocketClient {
  private conn: Deno.TlsConn | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private buffer = ''
  private decoder = new TextDecoder('utf-8')
  private encoder = new TextEncoder()
  private tagCounter = 0

  async connect(hostname: string, port: number, timeoutMs = 15000): Promise<void> {
    const connectPromise = Deno.connectTls({ hostname, port })
    this.conn = await this.withTimeout(connectPromise, timeoutMs, 'Connection timeout')
    this.reader = this.conn.readable.getReader()
    this.writer = this.conn.writable.getWriter()
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
    let timer: number | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(errorMsg)), ms)
    })
    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /**
   * Reads one line at a time from the internal buffer, fetching more data from the stream as needed.
   * Strips the trailing \r\n or \n.
   */
  async readLine(timeoutMs = 15000): Promise<string> {
    const readLineInternal = async (): Promise<string> => {
      while (true) {
        const crlfIndex = this.buffer.indexOf('\r\n')
        if (crlfIndex !== -1) {
          const line = this.buffer.substring(0, crlfIndex)
          this.buffer = this.buffer.substring(crlfIndex + 2)
          return line
        }

        const lfIndex = this.buffer.indexOf('\n')
        if (lfIndex !== -1) {
          const line = this.buffer.substring(0, lfIndex)
          this.buffer = this.buffer.substring(lfIndex + 1)
          return line
        }

        if (!this.reader) throw new Error('Reader not initialized')
        const { value, done } = await this.reader.read()
        if (done) {
          if (this.buffer.length > 0) {
            const line = this.buffer
            this.buffer = ''
            return line
          }
          throw new Error('Connection closed by remote host')
        }
        if (value) {
          this.buffer += this.decoder.decode(value, { stream: true })
        }
      }
    }

    return await this.withTimeout(readLineInternal(), timeoutMs, 'Timeout waiting for line')
  }

  private async sendRaw(data: string): Promise<void> {
    if (!this.writer) throw new Error('Not connected')
    await this.writer.write(this.encoder.encode(data))
  }

  async readGreeting(timeoutMs = 10000): Promise<string> {
    const line = await this.readLine(timeoutMs)
    return line
  }

  async readTaggedResponse(
    tag: string,
    timeoutMs = 15000,
  ): Promise<{ isOk: boolean; responseLine: string }> {
    const startTime = Date.now()
    while (true) {
      const remainingTime = Math.max(1000, timeoutMs - (Date.now() - startTime))
      const line = await this.readLine(remainingTime)

      if (line.startsWith(`${tag} `)) {
        const isOk = line.startsWith(`${tag} OK`)
        return { isOk, responseLine: line }
      }
      // Untagged responses (e.g. starting with `*`) or continuation lines are ignored here
    }
  }

  async sendCommand(
    command: string,
    timeoutMs = 15000,
  ): Promise<{ tag: string; isOk: boolean; responseLine: string }> {
    this.tagCounter += 1
    const tag = `A${String(this.tagCounter).padStart(4, '0')}`

    await this.sendRaw(`${tag} ${command}\r\n`)
    const { isOk, responseLine } = await this.readTaggedResponse(tag, timeoutMs)

    return { tag, isOk, responseLine }
  }

  /**
   * Performs IMAP LOGIN using RFC 3501 literal syntax:
   * 1. A0001 LOGIN {byte_length}\r\n
   * 2. Wait for '+' continuation response
   * 3. Send username\r\n + {byte_length}\r\n
   * 4. Wait for '+' continuation response
   * 5. Send password\r\n
   * 6. Read tagged response
   */
  async loginWithLiteral(
    user: string,
    pass: string,
    timeoutMs = 15000,
  ): Promise<{ tag: string; isOk: boolean; responseLine: string }> {
    this.tagCounter += 1
    const tag = `A${String(this.tagCounter).padStart(4, '0')}`

    const userBytes = this.encoder.encode(user)
    const passBytes = this.encoder.encode(pass)

    // Step 1: Send LOGIN with user literal byte length
    await this.sendRaw(`${tag} LOGIN {${userBytes.length}}\r\n`)

    // Step 2: Wait for continuation '+'
    const cont1 = await this.readLine(timeoutMs)
    if (!cont1.startsWith('+')) {
      throw new Error(`Unexpected server response waiting for user continuation: ${cont1}`)
    }

    // Step 3: Send username and password literal byte length
    await this.sendRaw(`${user} {${passBytes.length}}\r\n`)

    // Step 4: Wait for continuation '+'
    const cont2 = await this.readLine(timeoutMs)
    if (!cont2.startsWith('+')) {
      throw new Error(`Unexpected server response waiting for pass continuation: ${cont2}`)
    }

    // Step 5: Send password
    await this.sendRaw(`${pass}\r\n`)

    // Step 6: Read final tagged response
    const { isOk, responseLine } = await this.readTaggedResponse(tag, timeoutMs)

    return { tag, isOk, responseLine }
  }

  async close(): Promise<void> {
    try {
      if (this.writer) {
        this.tagCounter += 1
        const tag = `A${String(this.tagCounter).padStart(4, '0')}`
        await this.writer.write(this.encoder.encode(`${tag} LOGOUT\r\n`))
      }
    } catch {
      // Best effort logout, ignore error
    }

    try {
      if (this.reader) {
        this.reader.releaseLock()
        this.reader = null
      }
    } catch {
      // Ignore reader release error
    }

    try {
      if (this.writer) {
        this.writer.releaseLock()
        this.writer = null
      }
    } catch {
      // Ignore writer release error
    }

    try {
      if (this.conn) {
        this.conn.close()
        this.conn = null
      }
    } catch {
      // Ignore connection close error
    }
  }
}

import { createClient } from 'jsr:@supabase/supabase-js@2'

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

  const token = authHeader.replace(/^Bearer\s+/i, '')
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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.perfil !== 'administrador') {
    return new Response(
      JSON.stringify({
        error:
          'Permissão negada: apenas administradores podem testar conexão de e-mail de leitura.',
      }),
      {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }

  const client = new ImapSocketClient()

  try {
    const { data: setting, error: settingError } = await supabase
      .from('email_reading_settings')
      .select('*')
      .eq('active', true)
      .limit(1)
      .maybeSingle()

    if (settingError || !setting) {
      console.error('Active email reading setting not found:', settingError)
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Não foi possível conectar ao E-mail Leitura.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const { data: secretData, error: secretError } = await supabase
      .from('email_reading_secrets')
      .select('secret_value')
      .eq('setting_id', setting.id)
      .maybeSingle()

    if (secretError || !secretData?.secret_value) {
      console.error('Email reading secret not found or empty for active setting')
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Não foi possível conectar ao E-mail Leitura.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    const imapUser = (setting.email || '').trim()
    const imapPass = secretData.secret_value.trim()
    const imapHost = (setting.imap_host || '').trim() || 'imap.gmail.com'
    const imapPort = Number(setting.imap_port) || 993

    if (!imapUser || !imapPass || !imapHost || isNaN(imapPort)) {
      console.error('Incomplete IMAP configuration values from database')
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Não foi possível conectar ao E-mail Leitura.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Connect TLS
    try {
      await client.connect(imapHost, imapPort, 15000)
    } catch (err) {
      console.error('IMAP TLS connection failed:', err instanceof Error ? err.message : String(err))
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Não foi possível conectar ao E-mail Leitura.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 1. Read greeting
    try {
      const greeting = await client.readGreeting(15000)
      if (!greeting.startsWith('* OK')) {
        console.error('Invalid IMAP greeting received:', greeting)
        await client.close()
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Não foi possível conectar ao E-mail Leitura.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    } catch (err) {
      console.error(
        'Failed reading IMAP greeting:',
        err instanceof Error ? err.message : String(err),
      )
      await client.close()
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Não foi possível conectar ao E-mail Leitura.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 2. Send LOGIN with literal syntax
    try {
      const loginRes = await client.loginWithLiteral(imapUser, imapPass, 15000)
      if (!loginRes.isOk) {
        console.error('IMAP authentication failed. Server response:', loginRes.responseLine)
        await client.close()
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Não foi possível conectar ao E-mail Leitura.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    } catch (err) {
      console.error('IMAP login command failed:', err instanceof Error ? err.message : String(err))
      await client.close()
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Não foi possível conectar ao E-mail Leitura.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 3. Send SELECT INBOX
    try {
      const selectRes = await client.sendCommand('SELECT INBOX', 15000)
      if (!selectRes.isOk) {
        console.error('IMAP SELECT INBOX failed. Server response:', selectRes.responseLine)
        await client.close()
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Não foi possível conectar ao E-mail Leitura.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    } catch (err) {
      console.error(
        'IMAP SELECT INBOX command failed:',
        err instanceof Error ? err.message : String(err),
      )
      await client.close()
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Não foi possível conectar ao E-mail Leitura.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 4. Close connection (best-effort LOGOUT inside close)
    await client.close()

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Conexão com o E-mail Leitura realizada com sucesso.',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    console.error(
      'Unexpected error during IMAP test:',
      err instanceof Error ? err.message : String(err),
    )
    await client.close()
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Não foi possível conectar ao E-mail Leitura.',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
