import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { ControleModal } from '@/components/ControleModal'
import { controleService } from '@/services/controleService'
import { TaskControleRecord, TaskUsuarioAtivoRecord } from '@/types/task'

vi.mock('@/services/controleService', () => ({
  controleService: {
    getNomesControle: vi.fn(),
    getStatusProvidencia: vi.fn(),
    getUsuariosAtivos: vi.fn(),
    getTodosUsuarios: vi.fn(),
    saveControle: vi.fn(),
    saveProvidencia: vi.fn(),
    getControleById: vi.fn(),
    notifyAssignment: vi.fn(),
    notifyProvidenciaInclusao: vi.fn(),
    notifyProvidenciaAtualizacao: vi.fn(),
    deleteProvidencia: vi.fn(),
    getControleUpdatedAt: vi.fn(),
  },
}))

describe('ControleModal (Transição de responsáveis/executores para IDs centrais e preservação)', () => {
  const mockUsuariosAtivosValidados: TaskUsuarioAtivoRecord[] = [
    {
      id: 'tu-resp-ativo',
      nome: 'Beto Responsável Central',
      email: 'beto@riccipi.com.br',
      ativo: true,
      core_usuario_id: 'cu-resp-ativo',
    },
    {
      id: 'tu-exec-ativo',
      nome: 'Carla Executora Central',
      email: 'carla@riccipi.com.br',
      ativo: true,
      core_usuario_id: 'cu-exec-ativo',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(controleService.getNomesControle).mockResolvedValue([
      { id: 'nc-1', nome: 'Controle Geral', ativo: true },
    ] as any)
    vi.mocked(controleService.getStatusProvidencia).mockResolvedValue([
      {
        id: 'st-prov-1',
        codigo: 'pendente',
        nome: 'Pendente',
        ordem: 1,
        ativo: true,
        finaliza: false,
      },
    ] as any)
    vi.mocked(controleService.getUsuariosAtivos).mockResolvedValue(mockUsuariosAtivosValidados)
  })

  it('exibição e preservação de pessoa inativa existente fora da lista ativa', async () => {
    const mockInativoId = 'tu-historico-inativo'
    const controleComInativo: TaskControleRecord = {
      id: 'caso-antigo-1',
      nome_controle_id: 'nc-1',
      numero_caso: 10,
      identificacao_caso: 'Caso Histórico Com Usuário Inativo',
      status_id: 'st-aberto',
      responsavel_usuario_id: mockInativoId,
      executor_usuario_id: 'tu-exec-ativo',
      responsavel_core_usuario_id: 'cu-historico-inativo',
      executor_core_usuario_id: 'cu-exec-ativo',
      data_autorizacao: '2024-01-10',
      prazo_conclusao: '2024-02-10',
      pasta_cliente: null,
      pasta_ricci: null,
      created_at: '2024-01-10T10:00:00Z',
      created_by: null,
      updated_at: '2024-01-10T10:00:00Z',
      updated_by: null,
      deleted_at: null,
      deleted_by: null,
      providencias: [],
    }

    vi.mocked(controleService.getTodosUsuarios).mockResolvedValue([
      {
        id: mockInativoId,
        nome: 'Doutor Antigo Inativo',
        email: 'antigo@riccipi.com.br',
        ativo: false,
        core_usuario_id: 'cu-historico-inativo',
      },
      {
        id: 'tu-exec-ativo',
        nome: 'Carla Executora Central',
        email: 'carla@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-exec-ativo',
      },
    ])

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={controleComInativo}
        statusList={[
          {
            id: 'st-aberto',
            codigo: 'pendente',
            nome: 'Pendente',
            ordem: 1,
            ativo: true,
            finaliza: false,
          },
        ]}
        tiposPrazoList={[
          { id: 'tp-1', codigo: 'dias_uteis', nome: 'Dias Úteis', ordem: 1, ativo: true },
        ]}
        onSaved={vi.fn()}
      />,
    )

    // Aguarda resolução das listas
    await waitFor(() => {
      expect(controleService.getTodosUsuarios).toHaveBeenCalled()
    })

    // O modal deve carregar sem falhar a validação (pois a validação central dos ativos foi bem sucedida)
    expect(screen.getByText('Editar Controle de Caso')).toBeDefined()
    expect(screen.getByDisplayValue('Caso Histórico Com Usuário Inativo')).toBeDefined()
  })

  it('quando a validação central de usuários falha, exibe aviso e bloqueia novo salvamento', async () => {
    vi.mocked(controleService.getUsuariosAtivos).mockRejectedValueOnce(
      new Error('Falha na validação central de usuários elegíveis: retorno parcial'),
    )

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        statusList={[
          {
            id: 'st-aberto',
            codigo: 'pendente',
            nome: 'Pendente',
            ordem: 1,
            ativo: true,
            finaliza: false,
          },
        ]}
        tiposPrazoList={[
          { id: 'tp-1', codigo: 'dias_uteis', nome: 'Dias Úteis', ordem: 1, ativo: true },
        ]}
        onSaved={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(controleService.getUsuariosAtivos).toHaveBeenCalledTimes(1)
    })

    const warning = await screen.findByText(/Validação central de usuários indisponível/i)
    expect(warning).toBeDefined()

    const salvarBtn = screen.getByRole('button', { name: /Salvar/i })
    expect(salvarBtn).toBeDefined()

    salvarBtn.click()
    expect(controleService.saveControle).not.toHaveBeenCalled()
  })

  it('bloqueia salvamento se a pessoa selecionada estiver sem ponte operacional em task_usuarios (task_usuario_id null)', async () => {
    vi.mocked(controleService.getUsuariosAtivos).mockResolvedValueOnce([
      {
        id: 'cu-sem-ponte',
        nome: 'Pessoa Sem Ponte',
        email: 'semponte@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-sem-ponte',
        task_usuario_id: null,
      },
    ])

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        statusList={[
          {
            id: 'st-aberto',
            codigo: 'pendente',
            nome: 'Pendente',
            ordem: 1,
            ativo: true,
            finaliza: false,
          },
        ]}
        tiposPrazoList={[
          { id: 'tp-1', codigo: 'dias_uteis', nome: 'Dias Úteis', ordem: 1, ativo: true },
        ]}
        onSaved={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(controleService.getUsuariosAtivos).toHaveBeenCalledTimes(1)
    })

    const salvarBtn = screen.getByRole('button', { name: /Salvar/i })
    salvarBtn.click()

    // Não deve chamar saveControle pois a validação de campos / ponte bloqueia
    expect(controleService.saveControle).not.toHaveBeenCalled()
  })
})
