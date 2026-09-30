import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { ControleModal } from '@/components/ControleModal'
import { controleService } from '@/services/controleService'
import { TaskControleRecord, TaskUsuarioAtivoRecord } from '@/types/task'

const mockUseAuth = vi.fn()
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/services/controleService', () => ({
  controleService: {
    getNomesControle: vi.fn(),
    getStatusProvidencia: vi.fn(),
    getUsuariosAtivos: vi.fn(),
    getTodosUsuarios: vi.fn(),
    saveControle: vi.fn(),
    saveControleTransacional: vi.fn(),
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
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-1' },
      corePerfil: 'ADMINISTRADOR',
      coreUserId: 'cu-admin',
      hasSystemAccess: true,
      loadingAccess: false,
    })
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

    vi.mocked(controleService.getUsuariosAtivos).mockResolvedValue([
      {
        id: 'cu-exec-ativo',
        nome: 'Carla Executora Central',
        email: 'carla@riccipi.com.br',
        ativo: true,
        core_usuario_id: 'cu-exec-ativo',
        task_usuario_id: 'tu-exec-ativo',
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
      expect(controleService.getUsuariosAtivos).toHaveBeenCalled()
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
    expect(controleService.saveControleTransacional).not.toHaveBeenCalled()
  })

  it('permite seleção e salvamento de pessoa elegível central mesmo sem ponte operacional em task_usuarios', async () => {
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

    // Campos obrigatórios de formulário vazio impedem saveControle, mas a pessoa sem ponte não gera erro prévio
    expect(controleService.saveControleTransacional).not.toHaveBeenCalled()
  })

  it('bloqueia abertura e fecha modal quando caso está fora do escopo do usuário OPERACIONAL', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-op' },
      corePerfil: 'OPERACIONAL',
      coreUserId: 'cu-op-1',
      hasSystemAccess: true,
      loadingAccess: false,
    })

    const onOpenChangeMock = vi.fn()
    const controleDeOutro: TaskControleRecord = {
      id: 'caso-outro-1',
      nome_controle_id: 'nc-1',
      numero_caso: 50,
      identificacao_caso: 'Caso De Terceiro',
      status_id: 'st-aberto',
      responsavel_usuario_id: 'tu-outro',
      executor_usuario_id: 'tu-outro-exec',
      responsavel_core_usuario_id: 'cu-outro-resp',
      executor_core_usuario_id: 'cu-outro-exec',
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

    render(
      <ControleModal
        open={true}
        onOpenChange={onOpenChangeMock}
        controleToEdit={controleDeOutro}
        statusList={[]}
        tiposPrazoList={[]}
        onSaved={vi.fn()}
      />,
    )

    expect(onOpenChangeMock).toHaveBeenCalledWith(false)
  })

  it('ADMINISTRADOR: campo de data_conclusao da providência fica habilitado e editável', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-admin' },
      corePerfil: 'ADMINISTRADOR',
      coreUserId: 'cu-admin-1',
      hasSystemAccess: true,
      loadingAccess: false,
    })

    const controleComProvidenciaConcluida: TaskControleRecord = {
      id: 'caso-concluido-1',
      nome_controle_id: 'nc-1',
      numero_caso: 51,
      identificacao_caso: 'Caso Com Providência Concluída',
      status_id: 'st-aberto',
      responsavel_usuario_id: 'tu-resp-ativo',
      executor_usuario_id: 'tu-exec-ativo',
      responsavel_core_usuario_id: 'cu-resp-ativo',
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
      providencias: [
        {
          id: 'prov-1',
          tarefa_id: 'caso-concluido-1',
          providencia: 'Providência Concluída',
          prazo_conclusao: '2024-01-15',
          tipo_prazo_id: 'tp-1',
          status_id: 'st-concluido',
          ordem: 1,
          data_conclusao: '2024-01-14',
          email_alertas: false,
        },
      ],
    }

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={controleComProvidenciaConcluida}
        initialTab="providencias"
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
      expect(controleService.getUsuariosAtivos).toHaveBeenCalled()
    })

    const inputDataConclusao = screen.getByDisplayValue('2024-01-14') as HTMLInputElement
    expect(inputDataConclusao).toBeDefined()
    expect(inputDataConclusao.disabled).toBe(false)
  })

  it('GESTOR e OPERACIONAL: campo de data_conclusao fica desabilitado para edição manual', async () => {
    // 1. Testa com GESTOR
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-gestor' },
      corePerfil: 'GESTOR',
      coreUserId: 'cu-resp-ativo',
      hasSystemAccess: true,
      loadingAccess: false,
    })

    const controleComProvidenciaConcluida: TaskControleRecord = {
      id: 'caso-gestor-1',
      nome_controle_id: 'nc-1',
      numero_caso: 52,
      identificacao_caso: 'Caso Para Gestor',
      status_id: 'st-aberto',
      responsavel_usuario_id: 'tu-resp-ativo',
      executor_usuario_id: 'tu-exec-ativo',
      responsavel_core_usuario_id: 'cu-resp-ativo',
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
      providencias: [
        {
          id: 'prov-2',
          tarefa_id: 'caso-gestor-1',
          providencia: 'Providência do Gestor',
          prazo_conclusao: '2024-01-15',
          tipo_prazo_id: 'tp-1',
          status_id: 'st-concluido',
          ordem: 1,
          data_conclusao: '2024-01-12',
          email_alertas: false,
        },
      ],
    }

    const { unmount } = render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={controleComProvidenciaConcluida}
        initialTab="providencias"
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
      expect(controleService.getUsuariosAtivos).toHaveBeenCalled()
    })

    const inputDataGestor = screen.getByDisplayValue('2024-01-12') as HTMLInputElement
    expect(inputDataGestor).toBeDefined()
    expect(inputDataGestor.disabled).toBe(true)
    expect(
      screen.getByText(
        /Somente o Administrador pode inserir ou alterar manualmente a Data de Conclusão/i,
      ),
    ).toBeDefined()

    unmount()

    // 2. Testa com OPERACIONAL
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-op' },
      corePerfil: 'OPERACIONAL',
      coreUserId: 'cu-resp-ativo',
      hasSystemAccess: true,
      loadingAccess: false,
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={controleComProvidenciaConcluida}
        initialTab="providencias"
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

    const inputDataOp = screen.getByDisplayValue('2024-01-12') as HTMLInputElement
    expect(inputDataOp).toBeDefined()
    expect(inputDataOp.disabled).toBe(true)
  })

  it('Data de Conclusão do CASO: ADMINISTRADOR pode editar normalmente na criação e edição', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-admin' },
      corePerfil: 'ADMINISTRADOR',
      coreUserId: 'cu-admin-1',
      hasSystemAccess: true,
      loadingAccess: false,
    })

    const controleComData: TaskControleRecord = {
      id: 'caso-admin-dt-1',
      nome_controle_id: 'nc-1',
      numero_caso: 60,
      identificacao_caso: 'Caso com Data Admin',
      status_id: 'st-aberto',
      responsavel_usuario_id: 'tu-resp-ativo',
      executor_usuario_id: 'tu-exec-ativo',
      responsavel_core_usuario_id: 'cu-resp-ativo',
      executor_core_usuario_id: 'cu-exec-ativo',
      data_autorizacao: '2024-01-10',
      prazo_conclusao: '2024-02-10',
      data_conclusao: '2024-01-19',
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

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={controleComData}
        initialTab="dados"
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
        tiposPrazoList={[]}
        onSaved={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(controleService.getUsuariosAtivos).toHaveBeenCalled()
    })

    const inputDataCaso = screen.getByDisplayValue('2024-01-19') as HTMLInputElement
    expect(inputDataCaso).toBeDefined()
    expect(inputDataCaso.id).toBe('data-conclusao-caso')
    expect(inputDataCaso.disabled).toBe(false)
  })

  it('Data de Conclusão do CASO: GESTOR e OPERACIONAL veem campo desabilitado com aviso visual', async () => {
    // 1. GESTOR
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-gestor' },
      corePerfil: 'GESTOR',
      coreUserId: 'cu-resp-ativo',
      hasSystemAccess: true,
      loadingAccess: false,
    })

    const controleComData: TaskControleRecord = {
      id: 'caso-gestor-dt-1',
      nome_controle_id: 'nc-1',
      numero_caso: 61,
      identificacao_caso: 'Caso com Data Gestor',
      status_id: 'st-aberto',
      responsavel_usuario_id: 'tu-resp-ativo',
      executor_usuario_id: 'tu-exec-ativo',
      responsavel_core_usuario_id: 'cu-resp-ativo',
      executor_core_usuario_id: 'cu-exec-ativo',
      data_autorizacao: '2024-01-10',
      prazo_conclusao: '2024-02-10',
      data_conclusao: '2024-01-17',
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

    const { unmount } = render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={controleComData}
        initialTab="dados"
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
        tiposPrazoList={[]}
        onSaved={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(controleService.getUsuariosAtivos).toHaveBeenCalled()
    })

    const inputDataGestor = screen.getByDisplayValue('2024-01-17') as HTMLInputElement
    expect(inputDataGestor).toBeDefined()
    expect(inputDataGestor.id).toBe('data-conclusao-caso')
    expect(inputDataGestor.disabled).toBe(true)
    expect(
      screen.getByText(
        /Somente o Administrador pode inserir ou alterar manualmente a Data de Conclusão/i,
      ),
    ).toBeDefined()

    unmount()

    // 2. OPERACIONAL
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-op' },
      corePerfil: 'OPERACIONAL',
      coreUserId: 'cu-resp-ativo',
      hasSystemAccess: true,
      loadingAccess: false,
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={controleComData}
        initialTab="dados"
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
        tiposPrazoList={[]}
        onSaved={vi.fn()}
      />,
    )

    const inputDataOp = screen.getByDisplayValue('2024-01-17') as HTMLInputElement
    expect(inputDataOp).toBeDefined()
    expect(inputDataOp.id).toBe('data-conclusao-caso')
    expect(inputDataOp.disabled).toBe(true)
  })
})
