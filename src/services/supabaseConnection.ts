import { supabase } from '@/lib/supabase/client'

export interface SupabaseConnectionStatus {
  status: 'checking' | 'connected' | 'disconnected'
  latencyMs?: number
  url?: string
  checkedAt?: string
  errorMessage?: string
}

/**
 * Realiza uma verificação leve de conexão ao Supabase SEM depender de tabelas.
 * Usa supabase.auth.getSession() para checar acessibilidade e integridade do endpoint
 * e das chaves anon/publishable já configuradas na plataforma.
 */
export async function checkSupabaseConnection(): Promise<SupabaseConnectionStatus> {
  const start = performance.now()
  const checkedAt = new Date().toISOString()
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || ''

  try {
    // getSession() valida a comunicação com o serviço Supabase Auth sem precisar de nenhuma tabela
    const { error } = await supabase.auth.getSession()
    const latencyMs = Math.round(performance.now() - start)

    if (error) {
      return {
        status: 'disconnected',
        latencyMs,
        url: supabaseUrl,
        checkedAt,
        errorMessage: error.message,
      }
    }

    return {
      status: 'connected',
      latencyMs,
      url: supabaseUrl,
      checkedAt,
    }
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start)
    const message = err instanceof Error ? err.message : 'Falha ao conectar com o Supabase'
    return {
      status: 'disconnected',
      latencyMs,
      url: supabaseUrl,
      checkedAt,
      errorMessage: message,
    }
  }
}
