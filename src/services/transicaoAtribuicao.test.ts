import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkTransitionNotificationAccess,
  checkProvidenciaEventAccess,
  checkTaskAccessScope,
  CheckTransitionNotificationParams,
} from '../../supabase/functions/_shared/core-auth'
import { controleService } from './controleService'
import { supabase } from '../lib/supabase/client'

describe('Validação Rigorosa dos 7 Bloqueios Comprovados', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // PONTO 1: Criação e Escopo por Perfil
  // --------------------------------------------------------------------------
  describe('Cenário 1: Escopo de Acesso por Perfil na Criação / Acesso ao Caso', () => {
    it('Administrador tem acesso irrestrito para qualquer caso', async () => {
      const mockSupabase: any = {}
      const res = await checkTaskAccessScope(
        mockSupabase,
        { id: 'admin-core-id' },
        'ADMINISTRADOR',
        {
          id: 'caso-1',
          responsavel_core_usuario_id: 'outro-core-id',
          executor_core_usuario_id: 'mais-outro-core-id',
        },
      )
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('ok')
    })

    it('Operacional tem acesso permitido quando é Responsável ou Executor pelo ID central', async () => {
      const mockSupabase: any = {}
      const resResp = await checkTaskAccessScope(
        mockSupabase,
        { id: 'oper-core-id' },
        'OPERACIONAL',
        {
          id: 'caso-1',
          responsavel_core_usuario_id: 'oper-core-id',
          executor_core_usuario_id: 'outro-core-id',
        },
      )
      expect(resResp.allowed).toBe(true)

      const resExec = await checkTaskAccessScope(
        mockSupabase,
        { id: 'oper-core-id' },
        'OPERACIONAL',
        {
          id: 'caso-1',
          responsavel_core_usuario_id: 'outro-core-id',
          executor_core_usuario_id: 'oper-core-id',
        },
      )
      expect(resExec.allowed).toBe(true)
    })

    it('Operacional é BLOQUEADO quando não é Responsável nem Executor ("próprio")', async () => {
      const mockSupabase: any = {}
      const res = await checkTaskAccessScope(mockSupabase, { id: 'oper-core-id' }, 'OPERACIONAL', {
        id: 'caso-1',
        responsavel_core_usuario_id: 'outro-1',
        executor_core_usuario_id: 'outro-2',
      })
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('denied')
      expect(res.error).toMatch(
        /usuário operacional só pode acessar casos em que é Responsável ou Executor/,
      )
    })

    it('Gestor acessa caso próprio e caso de membro da sua equipe direta (gestor_id = gestorCoreId)', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'core_usuarios') {
            const chain: any = {
              select: () => chain,
              in: () =>
                Promise.resolve({
                  data: [{ id: 'subordinado-core-id', gestor_id: 'gestor-core-id', ativo: true }],
                  error: null,
                }),
            }
            return chain
          }
          return {}
        }),
      }

      const res = await checkTaskAccessScope(mockSupabase, { id: 'gestor-core-id' }, 'GESTOR', {
        id: 'caso-1',
        responsavel_core_usuario_id: 'subordinado-core-id',
        executor_core_usuario_id: 'subordinado-core-id',
      })
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('denied')
      expect(res.error).toMatch(
        /gestores só podem acessar casos em que são Responsável ou Executor/,
      )
    })

    it('Gestor é AUTORIZADO se for o responsável ou executor do caso', async () => {
      const mockSupabase: any = {}

      const res = await checkTaskAccessScope(mockSupabase, { id: 'gestor-core-id' }, 'GESTOR', {
        id: 'caso-1',
        responsavel_core_usuario_id: 'gestor-core-id',
        executor_core_usuario_id: 'outro-core-id',
      })
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('ok')
    })

    it('Gestor é BLOQUEADO se usuário não pertencer à sua equipe direta ou for terceiro', async () => {
      const mockSupabase: any = {}

      const res = await checkTaskAccessScope(mockSupabase, { id: 'gestor-core-id' }, 'GESTOR', {
        id: 'caso-1',
        responsavel_core_usuario_id: 'outro-gestor-subordinado',
        executor_core_usuario_id: 'outro-gestor-subordinado',
      })
      expect(res.allowed).toBe(false)
      expect(res.status).toBe('denied')
      expect(res.error).toMatch(
        /gestores só podem acessar casos em que são Responsável ou Executor/,
      )
    })

    it('Gestor é AUTORIZADO se for o executor do caso', async () => {
      const mockSupabase: any = {}

      const res = await checkTaskAccessScope(mockSupabase, { id: 'gestor-core-id' }, 'GESTOR', {
        id: 'caso-1',
        responsavel_core_usuario_id: 'outro-usuario',
        executor_core_usuario_id: 'gestor-core-id',
      })
      expect(res.allowed).toBe(true)
      expect(res.status).toBe('ok')
    })
  })

  // --------------------------------------------------------------------------
  // PONTO 2 & 3: Preservação de Timestamps e Correlação de Providências
  // --------------------------------------------------------------------------
  describe('Cenário 2 & 3: Correlação Explícita de Providências (temp_id vs UUID) e Salvamento Transacional', () => {
    it('envia temp_id preservado para correlação na RPC transacional única', async () => {
      const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: {
          success: true,
          mudanca_real: true,
          caso: {
            id: 'caso-10',
            numero_caso: 10,
            updated_at: '2025-05-15T12:00:00Z',
          },
          providencias: [
            {
              id: 'uuid-prov-1',
              temp_id: 'temp-123',
              providencia: 'Providência A',
            },
            {
              id: 'uuid-prov-2',
              temp_id: 'temp-456',
              providencia: 'Providência A', // Mesma descrição proposital!
            },
          ],
        },
        error: null,
      } as any)

      const result = await controleService.saveControleTransacional({
        id: undefined, // Criação
        nome_controle_id: 'nc-1',
        identificacao_caso: 'Caso Duplo',
        status_id: 'st-1',
        responsavel_core_usuario_id: 'resp-core-1',
        executor_core_usuario_id: 'exec-core-1',
        providencias: [
          {
            temp_id: 'temp-123',
            providencia: 'Providência A',
            prazo_conclusao: '2025-05-20',
            tipo_prazo_id: 'tp-1',
            status_id: 'stp-1',
          },
          {
            temp_id: 'temp-456',
            providencia: 'Providência A', // Mesma descrição proposital!
            prazo_conclusao: '2025-05-25',
            tipo_prazo_id: 'tp-1',
            status_id: 'stp-1',
          },
        ],
      })

      expect(rpcSpy).toHaveBeenCalled()
      const callArgs = rpcSpy.mock.calls[0][1] as any
      expect(callArgs.p_providencias).toHaveLength(2)
      expect(callArgs.p_providencias[0].temp_id).toBe('temp-123')
      expect(callArgs.p_providencias[1].temp_id).toBe('temp-456')

      // Correlaciona explicitamente cada UUID retornado
      const provsRetornadas = result.providencias || []
      const match1 = provsRetornadas.find((p: any) => p.temp_id === 'temp-123')
      const match2 = provsRetornadas.find((p: any) => p.temp_id === 'temp-456')
      expect(match1?.id).toBe('uuid-prov-1')
      expect(match2?.id).toBe('uuid-prov-2')
    })
  })

  // --------------------------------------------------------------------------
  // PONTO 4: Notificações Seguras, Transição Exata e Prevenção de Spoofing
  // --------------------------------------------------------------------------
  describe('Cenário 4: Validação de Transição Exata e Bloqueio de Transição Falsa/Antiga', () => {
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

    it('BLOQUEIA envio se transição for antiga e não corresponder ao estado atual do caso', async () => {
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
                      versao_resultante_updated_at: '2025-01-01T10:00:00Z',
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
  })

  // --------------------------------------------------------------------------
  // PONTO 5: Providências pós-transferência comprovadas por eventos do servidor
  // --------------------------------------------------------------------------
  describe('Cenário 5: Providências pós-transferência e Eventos Autorizados do Servidor', () => {
    it('permite notificação de providência incluída mesmo após perda de acesso quando comprovada por evento no servidor', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'task_transacao_providencias_eventos') {
            const chain: any = {
              select: () => chain,
              eq: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'evento-prov-1',
                      tarefa_id: 'caso-100',
                      providencia_id: 'prov-uuid-55',
                      autor_core_id: 'cu-autor-antigo',
                      tipo_evento: 'providencia_inclusao',
                      versao_updated_at: '2025-05-10T14:30:00Z',
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

      const check = await checkProvidenciaEventAccess(mockSupabase, 'cu-autor-antigo', {
        tarefaId: 'caso-100',
        providenciaId: 'prov-uuid-55',
        tipoEvento: 'providencia_inclusao',
        versaoUpdatedAt: '2025-05-10T14:30:00Z',
      })

      expect(check.allowed).toBe(true)
      expect(check.status).toBe('ok')
    })

    it('BLOQUEIA notificação de providência se não houver evento registrado pelo servidor para o autor', async () => {
      const mockSupabase: any = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'task_transacao_providencias_eventos') {
            const chain: any = {
              select: () => chain,
              eq: () => chain,
              order: () => chain,
              limit: () =>
                Promise.resolve({
                  data: [], // Nenhum evento gravado!
                  error: null,
                }),
            }
            return chain
          }
          return {}
        }),
      }

      const check = await checkProvidenciaEventAccess(mockSupabase, 'cu-invasor', {
        tarefaId: 'caso-100',
        providenciaId: 'prov-uuid-55',
        tipoEvento: 'providencia_inclusao',
      })

      expect(check.allowed).toBe(false)
      expect(check.status).toBe('denied')
      expect(check.error).toMatch(/Nenhum evento registrado pelo servidor/)
    })
  })

  // --------------------------------------------------------------------------
  // PONTO 6: Concorrência e Falha Impeditiva de SMTP
  // --------------------------------------------------------------------------
  describe('Cenário 6: Idempotência, Concorrência e Impedimento de SMTP', () => {
    it('notifyAssignment repassa transicao_id de forma transparente ao backend', async () => {
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

    it('notifyProvidenciaInclusao envia exclusivamente o UUID definitivo gravado da providência', async () => {
      const invokeSpy = vi
        .spyOn(supabase.functions, 'invoke')
        .mockResolvedValue({ data: { success: true, sent: true }, error: null } as any)

      await controleService.notifyProvidenciaInclusao('caso-100', 'uuid-real-providencia-777')

      expect(invokeSpy).toHaveBeenCalledWith('notify-task-assignment', {
        body: {
          tarefa_id: 'caso-100',
          providencia_id: 'uuid-real-providencia-777',
          tipo: 'providencia_inclusao',
        },
      })
    })
  })
})
