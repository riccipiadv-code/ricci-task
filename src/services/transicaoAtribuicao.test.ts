import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkTransitionNotificationAccess,
  CheckTransitionNotificationParams,
} from '../../supabase/functions/_shared/core-auth'
import { controleService } from './controleService'
import { supabase } from '../lib/supabase/client'

describe('Transição Exata de Atribuição e Idempotência (Ponto 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('permite notificação quando transição bate rigorosamente com o estado gravado do caso', async () => {
    const mockSupabase: any = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'task_transicoes_atribuicao') {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'trans-correta-1',
                    tarefa_id: 'caso-100',
                    autor_core_id: 'cu-autor',
                    novo_responsavel_core_id: 'cu-resp-atual',
                    novo_executor_core_id: 'cu-exec-atual',
                    versao_resultante_updated_at: '2025-05-10T14:30:00Z',
                    created_at: '2025-05-10T14:30:00Z',
                  },
                ],
                error: null,
              }),
          }
          return chain
        }
        return {}
      }),
    }

    const params: CheckTransitionNotificationParams = {
      transicaoId: 'trans-correta-1',
      tipoEvento: 'alteracao_atribuicao',
      tarefa: {
        id: 'caso-100',
        responsavel_core_usuario_id: 'cu-resp-atual',
        executor_core_usuario_id: 'cu-exec-atual',
        updated_at: '2025-05-10T14:30:00Z',
      },
    }

    const check = await checkTransitionNotificationAccess(mockSupabase, 'cu-autor', params)
    expect(check.allowed).toBe(true)
    expect(check.status).toBe('ok')
    expect(check.transition.id).toBe('trans-correta-1')
  })

  it('BLOQUEIA envio se transição for antiga e não corresponder ao estado atual do caso (outra alteração ocorreu)', async () => {
    const mockSupabase: any = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'task_transicoes_atribuicao') {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'trans-antiga-99',
                    tarefa_id: 'caso-100',
                    autor_core_id: 'cu-antigo-autor',
                    novo_responsavel_core_id: 'cu-resp-antigo',
                    novo_executor_core_id: 'cu-exec-antigo',
                    versao_resultante_updated_at: '2025-01-01T10:00:00Z', // Versão defasada!
                    created_at: '2025-01-01T10:00:00Z',
                  },
                ],
                error: null,
              }),
          }
          return chain
        }
        return {}
      }),
    }

    // A tarefa foi atualizada posteriormente para outra versão e outros destinatários
    const params: CheckTransitionNotificationParams = {
      transicaoId: 'trans-antiga-99',
      tipoEvento: 'alteracao_atribuicao',
      tarefa: {
        id: 'caso-100',
        responsavel_core_usuario_id: 'cu-resp-novo',
        executor_core_usuario_id: 'cu-exec-novo',
        updated_at: '2025-05-10T15:00:00Z',
      },
    }

    const check = await checkTransitionNotificationAccess(mockSupabase, 'cu-antigo-autor', params)
    expect(check.allowed).toBe(false)
    expect(check.status).toBe('denied')
    expect(check.error).toMatch(/Transições antigas não podem autorizar novas notificações/)
  })

  it('retorna status "technical_failure" em caso de erro de consulta (fail-closed, retry possível)', async () => {
    const mockSupabase: any = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'task_transicoes_atribuicao') {
          const chain: any = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: () =>
              Promise.resolve({
                data: null,
                error: { message: 'Connection timeout with database' },
              }),
          }
          return chain
        }
        return {}
      }),
    }

    const params: CheckTransitionNotificationParams = {
      transicaoId: 'trans-qq',
      tipoEvento: 'alteracao_atribuicao',
      tarefa: {
        id: 'caso-100',
        updated_at: '2025-05-10T15:00:00Z',
      },
    }

    const check = await checkTransitionNotificationAccess(mockSupabase, 'cu-autor', params)
    expect(check.allowed).toBe(false)
    expect(check.status).toBe('technical_failure')
    expect(check.error).toMatch(/Falha técnica ao verificar registro de transição/)
  })

  it('notifyAssignment envia transicao_id no payload da chamada à Edge Function', async () => {
    const invokeSpy = vi
      .spyOn(supabase.functions, 'invoke')
      .mockResolvedValue({ data: { success: true, sent: true }, error: null } as any)

    await controleService.notifyAssignment('caso-100', 'alteracao_atribuicao', 'trans-uuid-999')

    expect(invokeSpy).toHaveBeenCalledWith('notify-task-assignment', {
      body: {
        tarefa_id: 'caso-100',
        tipo: 'alteracao_atribuicao',
        transicao_id: 'trans-uuid-999',
      },
    })
  })
})
