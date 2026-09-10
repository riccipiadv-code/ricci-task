import { supabase } from '@/lib/supabase/client'
import { checkSupabaseConnection, type SupabaseConnectionStatus } from './supabaseConnection'

/**
 * Ponto único de exportação e abstração da camada Supabase para o Ricci Task.
 * Nesta fase:
 * 1. Estabelece a conexão com o Supabase vinculado ao projeto.
 * 2. Disponibiliza métodos de diagnóstico e verificação de saúde da conexão (sem tabelas).
 * 3. Mantém a interface pronta para ser expandida quando as tabelas próprias e isoladas
 *    (com prefixo definido na revisão de lógica) forem criadas na próxima etapa.
 */
export const supabaseDataService = {
  client: supabase,
  checkConnection: checkSupabaseConnection,
}

export type { SupabaseConnectionStatus }
export { checkSupabaseConnection }
