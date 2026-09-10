import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

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

  /**
   * Reads exactly `n` bytes from the buffer/stream.
   * Consumes from this.buffer first; if insufficient, reads from stream until n bytes are gathered.
   */
  async readBytes(n: number, timeoutMs = 15000): Promise<string> {
    const readBytesInternal = async (): Promise<string> => {
      let currentBytes = this.encoder.encode(this.buffer)

      while (currentBytes.length < n) {
        if (!this.reader) throw new Error('Reader not initialized')
        const { value, done } = await this.reader.read()
        if (done) {
          if (currentBytes.length > 0) {
            const result = this.decoder.decode(currentBytes)
            this.buffer = ''
            return result
          }
          throw new Error('Connection closed by remote host while reading bytes')
        }
        if (value && value.length > 0) {
          const merged = new Uint8Array(currentBytes.length + value.length)
          merged.set(currentBytes)
          merged.set(value, currentBytes.length)
          currentBytes = merged
        }
      }

      const neededBytes = currentBytes.slice(0, n)
      const remainingBytes = currentBytes.slice(n)

      this.buffer = this.decoder.decode(remainingBytes, { stream: true })
      return this.decoder.decode(neededBytes)
    }

    return await this.withTimeout(readBytesInternal(), timeoutMs, 'Timeout waiting for bytes')
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
   * Performs IMAP LOGIN using RFC 3501 literal syntax
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

  /**
   * Performs IMAP SEARCH command and counts matches
   * Example command: SEARCH SUBJECT "[CONECTAI:469]"
   * Untagged response format: * SEARCH 1 2 3
   */
  async searchSubject(
    subjectQuery: string,
    timeoutMs = 15000,
  ): Promise<{ isOk: boolean; count: number; matchingIds: number[]; responseLine: string }> {
    this.tagCounter += 1
    const tag = `A${String(this.tagCounter).padStart(4, '0')}`

    // Quote the subject query if not already quoted or escape internal quotes
    const sanitizedQuery = subjectQuery.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    await this.sendRaw(`${tag} SEARCH SUBJECT "${sanitizedQuery}"\r\n`)

    const startTime = Date.now()
    const matchingIds: number[] = []
    let isOk = false
    let finalResponseLine = ''

    while (true) {
      const remainingTime = Math.max(1000, timeoutMs - (Date.now() - startTime))
      const line = await this.readLine(remainingTime)

      if (line.startsWith('* SEARCH')) {
        // e.g. "* SEARCH 12 34 56" or "* SEARCH"
        const numbersPart = line.substring('* SEARCH'.length).trim()
        if (numbersPart.length > 0) {
          const ids = numbersPart
            .split(/\s+/)
            .map((num) => parseInt(num, 10))
            .filter((num) => !isNaN(num) && num > 0)
          matchingIds.push(...ids)
        }
      } else if (line.startsWith(`${tag} `)) {
        isOk = line.startsWith(`${tag} OK`)
        finalResponseLine = line
        break
      }
    }

    return {
      isOk,
      count: matchingIds.length,
      matchingIds,
      responseLine: finalResponseLine,
    }
  }

  /**
   * Decodes MIME encoded-word RFC 2047 strings (e.g. =?UTF-8?B?...?= or =?ISO-8859-1?Q?...?=)
   */
  private decodeMimeWords(str: string): string {
    return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/gi, (_, charset, encoding, text) => {
      try {
        const enc = encoding.toUpperCase()
        if (enc === 'B') {
          const binaryStr = atob(text.trim())
          const bytes = new Uint8Array(binaryStr.length)
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i)
          }
          const textDecoder = new TextDecoder(charset.toLowerCase() || 'utf-8')
          return textDecoder.decode(bytes)
        } else if (enc === 'Q') {
          const unescaped = text
            .replace(/_/g, ' ')
            .replace(/=([0-9A-Fa-f]{2})/g, (__: string, hex: string) => {
              return String.fromCharCode(parseInt(hex, 16))
            })
          const bytes = new Uint8Array(unescaped.length)
          for (let i = 0; i < unescaped.length; i++) {
            bytes[i] = unescaped.charCodeAt(i)
          }
          const textDecoder = new TextDecoder(charset.toLowerCase() || 'utf-8')
          return textDecoder.decode(bytes)
        }
      } catch {
        // fallback to original match if decode fails
      }
      return text
    })
  }

  /**
   * Extracts clean email address from string (e.g. `"Name" <email@dominio.com>` -> `email@dominio.com`)
   */
  private extractEmailAddress(raw: string): string {
    if (!raw) return ''
    const match = raw.match(/<([^>]+)>/)
    if (match && match[1]) {
      return match[1].trim()
    }
    const emailMatch = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
    if (emailMatch) {
      return emailMatch[0].trim()
    }
    return raw.trim()
  }

  /**
   * Formats a date string (RFC 2822 or IMAP internal date) to DD/MM/AAAA HH:MM
   */
  private formatDateBR(rawDate: string): string {
    if (!rawDate) return ''
    const cleaned = rawDate.replace(/"/g, '').trim()
    const parsedDate = new Date(cleaned)

    if (isNaN(parsedDate.getTime())) {
      // Manual parse for IMAP INTERNALDATE format like "26-Aug-2026 11:30:00 -0300"
      const imapRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})/
      const m = cleaned.match(imapRegex)
      if (m) {
        const day = m[1].padStart(2, '0')
        const monthNames: Record<string, string> = {
          jan: '01',
          feb: '02',
          mar: '03',
          apr: '04',
          may: '05',
          jun: '06',
          jul: '07',
          aug: '08',
          sep: '09',
          oct: '10',
          nov: '11',
          dec: '12',
        }
        const month = monthNames[m[2].toLowerCase()] || '01'
        const year = m[3]
        const hours = m[4].padStart(2, '0')
        const mins = m[5]
        return `${day}/${month}/${year} ${hours}:${mins}`
      }
      return cleaned
    }

    const pad = (n: number) => String(n).padStart(2, '0')
    const day = pad(parsedDate.getDate())
    const month = pad(parsedDate.getMonth() + 1)
    const year = parsedDate.getFullYear()
    const hours = pad(parsedDate.getHours())
    const minutes = pad(parsedDate.getMinutes())

    return `${day}/${month}/${year} ${hours}:${minutes}`
  }

  /**
   * Parses raw header text (handling multiline continuation headers)
   */
  private parseHeaders(headerText: string): {
    from: string
    to: string
    subject: string
    date: string
  } {
    const rawLines = headerText.split(/\r?\n/)
    const unfoldedLines: string[] = []

    for (const line of rawLines) {
      if (/^\s+/.test(line) && unfoldedLines.length > 0) {
        unfoldedLines[unfoldedLines.length - 1] += ' ' + line.trim()
      } else if (line.trim().length > 0) {
        unfoldedLines.push(line)
      }
    }

    let from = ''
    let to = ''
    let subject = ''
    let date = ''

    for (const line of unfoldedLines) {
      const fromMatch = line.match(/^From:\s*(.*)$/i)
      if (fromMatch && !from) {
        from = this.extractEmailAddress(fromMatch[1])
        continue
      }
      const toMatch = line.match(/^To:\s*(.*)$/i)
      if (toMatch && !to) {
        to = this.extractEmailAddress(toMatch[1])
        continue
      }
      const subjMatch = line.match(/^Subject:\s*(.*)$/i)
      if (subjMatch && !subject) {
        subject = this.decodeMimeWords(subjMatch[1].trim())
        continue
      }
      const dateMatch = line.match(/^Date:\s*(.*)$/i)
      if (dateMatch && !date) {
        date = dateMatch[1].trim()
        continue
      }
    }

    return { from, to, subject, date }
  }

  /**
   * Fetches headers, date and raw RFC 822 content for message IDs without marking as seen
   * Command: FETCH ids (INTERNALDATE BODY.PEEK[])
   */
  async fetchEmailMessages(
    messageIds: number[],
    timeoutMs = 30000,
  ): Promise<Array<{ date: string; from: string; to: string; subject: string; raw: string }>> {
    if (messageIds.length === 0) return []

    this.tagCounter += 1
    const tag = `A${String(this.tagCounter).padStart(4, '0')}`
    const idsString = messageIds.join(',')

    await this.sendRaw(`${tag} FETCH ${idsString} (INTERNALDATE BODY.PEEK[])\r\n`)

    const startTime = Date.now()
    const fetchedMap = new Map<
      number,
      { date: string; from: string; to: string; subject: string; raw: string }
    >()

    while (true) {
      const remainingTime = Math.max(1000, timeoutMs - (Date.now() - startTime))
      const line = await this.readLine(remainingTime)

      if (line.startsWith(`${tag} `)) {
        break
      }

      // Untagged FETCH line, e.g.:
      // * 1 FETCH (INTERNALDATE "26-Aug-2026 11:30:00 -0300" BODY[] {12345}
      const fetchStartMatch = line.match(/^\*\s+(\d+)\s+FETCH\s+\((.*)$/i)
      if (fetchStartMatch) {
        const msgSeq = parseInt(fetchStartMatch[1], 10)
        const fetchLineRest = fetchStartMatch[2]

        // Extract INTERNALDATE if present
        let internalDate = ''
        const internalDateMatch = fetchLineRest.match(/INTERNALDATE\s+"([^"]+)"/i)
        if (internalDateMatch) {
          internalDate = internalDateMatch[1]
        }

        // Check if there is a literal size indicator like {12345}
        let rawMessage = ''
        const literalMatch = fetchLineRest.match(/\{(\d+)\}\s*$/)
        if (literalMatch) {
          const byteCount = parseInt(literalMatch[1], 10)
          rawMessage = await this.readBytes(byteCount, remainingTime)
        } else {
          // If body was returned in quotes (rare for entire BODY)
          const bodyMatch = fetchLineRest.match(/BODY(?:\[\])?\s+"([^"]*)"/i)
          if (bodyMatch) {
            rawMessage = bodyMatch[1]
          }
        }

        // Extract headers from the beginning of the raw RFC 822 message (headers and body are separated by \r\n\r\n or \n\n)
        const headerEndIndex = rawMessage.search(/\r?\n\r?\n/)
        const headerText =
          headerEndIndex !== -1 ? rawMessage.substring(0, headerEndIndex) : rawMessage

        const parsed = this.parseHeaders(headerText)
        const finalDateRaw = parsed.date || internalDate
        const formattedDate = this.formatDateBR(finalDateRaw)

        fetchedMap.set(msgSeq, {
          date: formattedDate,
          from: parsed.from,
          to: parsed.to,
          subject: parsed.subject,
          raw: rawMessage,
        })
      }
    }

    // Return in the order of messageIds
    const result: Array<{ date: string; from: string; to: string; subject: string; raw: string }> =
      []
    for (const id of messageIds) {
      const item = fetchedMap.get(id)
      if (item) {
        result.push(item)
      } else {
        // Fallback placeholder if not matched by seq number directly
        result.push({
          date: '',
          from: '',
          to: '',
          subject: '',
          raw: '',
        })
      }
    }

    return result
  }

  /**
   * Compatibility wrapper for fetchEmailHeaders
   */
  async fetchEmailHeaders(
    messageIds: number[],
    timeoutMs = 20000,
  ): Promise<Array<{ date: string; from: string; to: string; subject: string; raw?: string }>> {
    return await this.fetchEmailMessages(messageIds, timeoutMs)
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
        error: 'Permissão negada: apenas administradores podem buscar e-mails de leitura.',
      }),
      {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }

  let controle = ''
  try {
    const body = await req.json()
    controle =
      typeof body?.controle === 'string' || typeof body?.controle === 'number'
        ? String(body.controle).trim()
        : ''
  } catch {
    // Body parsing error or empty body
  }

  if (!controle) {
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Código de controle não informado.',
      }),
      {
        status: 200,
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
          message: 'Não foi possível buscar e-mails.',
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
          message: 'Não foi possível buscar e-mails.',
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
          message: 'Não foi possível buscar e-mails.',
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
          message: 'Não foi possível buscar e-mails.',
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
            message: 'Não foi possível buscar e-mails.',
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
          message: 'Não foi possível buscar e-mails.',
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
            message: 'Não foi possível buscar e-mails.',
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
          message: 'Não foi possível buscar e-mails.',
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
            message: 'Não foi possível buscar e-mails.',
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
          message: 'Não foi possível buscar e-mails.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 4. Send SEARCH SUBJECT "[CONECTAI:CONTROLE]"
    const searchSubjectPattern = `[CONECTAI:${controle}]`
    let searchCount = 0
    let matchingIds: number[] = []

    try {
      const searchRes = await client.searchSubject(searchSubjectPattern, 15000)
      if (!searchRes.isOk) {
        console.error('IMAP SEARCH failed. Server response:', searchRes.responseLine)
        await client.close()
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Não foi possível buscar e-mails.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
      searchCount = searchRes.count
      matchingIds = searchRes.matchingIds || []
    } catch (err) {
      console.error('IMAP SEARCH command failed:', err instanceof Error ? err.message : String(err))
      await client.close()
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Não foi possível buscar e-mails.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // 5. Fetch email messages (headers + raw RFC 822) if searchCount > 0
    let emails: Array<{ date: string; from: string; to: string; subject: string; raw: string }> = []
    if (searchCount > 0 && matchingIds.length > 0) {
      try {
        emails = await client.fetchEmailMessages(matchingIds, 30000)
      } catch (err) {
        console.error(
          'IMAP FETCH messages failed:',
          err instanceof Error ? err.message : String(err),
        )
      }
    }

    // 6. Close connection (best-effort LOGOUT inside close)
    await client.close()

    return new Response(
      JSON.stringify({
        success: true,
        controle,
        quantidade: searchCount,
        emails,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    console.error(
      'Unexpected error during IMAP search:',
      err instanceof Error ? err.message : String(err),
    )
    await client.close()
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Não foi possível buscar e-mails.',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
