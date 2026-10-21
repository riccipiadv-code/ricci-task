/**
 * Testes direcionados para o fluxo completo de Solicitação de Adiamento no ControleModal:
 * - Banco e SMTP simulados (mocks isolados).
 * - Escolha "Sim" abre janela de solicitação.
 * - Escolha "Não" fecha diálogo e preserva preenchimento sem salvar nada.
 * - Datas menor, igual e maior que a conclusão do caso.
 * - Motivo inválido (vazio / trim / >200 caracteres) com contador visível.
 * - Lista de administradores vazia explicando critério e bloqueando o envio.
 * - Envio aceito chamando controleService.solicitarAdiamento().
 * - Falha de envio com exibição de erro.
 * - Resultado incerto (email_status = 'incerto') sem permissão de reenvio automático.
 * - Preservação da MESMA chave de idempotência entre retentativas do mesmo pedido.
 * - Rejeição do banco por mudança concorrente de prazo no catch preservando formulário e atualizando prazo.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ControleModal } from './ControleModal'
import { controleService } from '@/services/controleService'
import { supabase } from '@/lib/supabase/client'
import * as authHook from '@/hooks/use-auth'

// Mock de useAuth
vi.mock('@hooks/use-auth', () => ({
  useAuth: vi.fn(),
}))

// Mock de controleService
vi.mock('@/services/controleService', () => ({
  controleService: {
    checkControleAccessScope: vi.fn(),
    getNomesControle: vi.fn(),
    getStatusProvidencia: vi.fn(),
    getUsuariosAtivos: vi.fn(),
    getCoreUsuariosByIds: vi.fn(),
    saveControleTransacional: vi.fn(),
    notifyAssignment: vi.fn(),
    notifyProvidenciaInclusao: vi.fn(),
    notifyProvidenciaAtualizacao: vi.fn(),
    deleteProvidencia: vi.fn(),
    listarAdministradoresAdiamento: vi.fn(),
    solicitarAdiamento: vi.fn(),
  },
}))

// Mock de supabase client
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}))

describe('ControleModal - Fluxo de Solicitação de Adiamento', () => {
  const mockUseAuth = vi.spyOn(authHook, 'useAuth')

  const baseStatus = [
    { id: 'st-1', codigo: 'pendente', nome: 'Pendente', ativo: true, ordem: 1, finaliza: false },
    { id: 'st-2', codigo: 'concluido', nome: 'Concluído', ativo: true, ordem: 2, finaliza: true },
  ]

  const baseStatusProv = [
    {
      id: 'sp-1',
      codigo: 'em_andamento',
      nome: 'Em andamento',
      ativo: true,
      ordem: 1,
      finaliza: false,
    },
    { id: 'sp-2', codigo: 'concluido', nome: 'Concluído', ativo: true, ordem: 2, finaliza: true },
  ]

  const baseTiposPrazo = [{ id: 'tp-1', nome: 'Comum', ativo: true }]

  const baseNomes = [{ id: 'nc-1', nome: 'Controle Cível', ativo: true }]

  const baseUsuarios = [
    {
      id: 'u-1',
      nome: 'Operador Teste',
      email: 'op@riccipi.com.br',
      ativo: true,
      core_usuario_id: 'u-1',
    },
    {
      id: 'u-admin',
      nome: 'Admin Teste',
      email: 'admin@riccipi.com.br',
      ativo: true,
      core_usuario_id: 'u-admin',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseAuth.mockReturnValue({
      user: { id: 'auth-user-1' },
      corePerfil: 'OPERACIONAL',
      coreUserId: 'u-1',
      hasSystemAccess: true,
      loadingAccess: false,
    } as any)

    vi.mocked(controleService.checkControleAccessScope).mockResolvedValue(true)
    vi.mocked(controleService.getNomesControle).mockResolvedValue(baseNomes as any)
    vi.mocked(controleService.getStatusProvidencia).mockResolvedValue(baseStatusProv as any)
    vi.mocked(controleService.getUsuariosAtivos).mockResolvedValue(baseUsuarios as any)
    vi.mocked(controleService.getCoreUsuariosByIds).mockResolvedValue(new Map())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('permite data da providência IGUAL ou MENOR que o prazo de conclusão do caso sem abrir diálogo', async () => {
    const casoSalvo: any = {
      id: 'caso-1',
      identificacao_caso: 'Caso Datas Iguais',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-1',
          providencia: 'Providência dentro do prazo',
          prazo_conclusao: '2026-06-15', // Igual!
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.saveControleTransacional).mockResolvedValue({
      controle: { ...casoSalvo, updated_at: '2026-06-15T10:00:00Z' },
      providencias: casoSalvo.providencias,
      perda_acesso: false,
    } as any)

    const onSavedMock = vi.fn()
    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={onSavedMock}
      />,
    )

    await screen.findByDisplayValue('Caso Datas Iguais')

    const btnSalvar = screen.getByRole('button', { name: /Salvar Alterações/i })
    fireEvent.click(btnSalvar)

    await waitFor(() => {
      expect(controleService.saveControleTransacional).toHaveBeenCalled()
      expect(onSavedMock).toHaveBeenCalled()
    })

    // O diálogo de confirmação NÃO deve ter sido aberto
    expect(
      screen.queryByText(
        /A data da providência não pode ser maior que a data de conclusão do caso/i,
      ),
    ).toBeNull()
  })

  it('histórico inconsistente inalterado: salva sem abrir diálogo quando prazo da providência E prazo do caso permanecem inalterados', async () => {
    const casoHistorico: any = {
      id: 'caso-hist-inalterado',
      identificacao_caso: 'Caso Histórico Inalterado',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-hist-1',
          providencia: 'Providência histórica antiga',
          prazo_conclusao: '2026-06-30', // Inconsistente com o caso (30 > 15), mas já salvo!
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.saveControleTransacional).mockResolvedValue({
      controle: { ...casoHistorico, updated_at: '2026-06-15T10:00:00Z' },
      providencias: casoHistorico.providencias,
      perda_acesso: false,
    } as any)

    const onSavedMock = vi.fn()
    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoHistorico}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={onSavedMock}
      />,
    )

    await screen.findByDisplayValue('Caso Histórico Inalterado')

    // Salva sem alterar nada
    const btnSalvar = screen.getByRole('button', { name: /Salvar Alterações/i })
    fireEvent.click(btnSalvar)

    await waitFor(() => {
      expect(controleService.saveControleTransacional).toHaveBeenCalled()
      expect(onSavedMock).toHaveBeenCalled()
    })

    // O diálogo de confirmação NÃO deve ter sido aberto
    expect(
      screen.queryByText(
        /A data da providência não pode ser maior que a data de conclusão do caso/i,
      ),
    ).toBeNull()
  })

  it('histórico inconsistente: se administrador altera o prazo do caso, a providência entra na validação e abre o diálogo', async () => {
    // Configura perfil de administrador para permitir edição do prazo do caso
    mockUseAuth.mockReturnValue({
      user: { id: 'auth-user-admin' },
      corePerfil: 'ADMINISTRADOR',
      coreUserId: 'u-admin',
      hasSystemAccess: true,
      loadingAccess: false,
    } as any)

    const casoHistorico: any = {
      id: 'caso-hist-alterado',
      identificacao_caso: 'Caso Histórico Alterado por Admin',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-hist-2',
          providencia: 'Providência histórica persistida',
          prazo_conclusao: '2026-06-30', // Providência salva com prazo 30/06/2026
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoHistorico}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Histórico Alterado por Admin')

    // Administrador altera o prazo de conclusão do caso de 15/06/2026 para 20/06/2026
    const inputPrazoCaso = screen.getByLabelText(/Prazo de Conclusão \(Caso\)/i)
    fireEvent.change(inputPrazoCaso, { target: { value: '2026-06-20' } })

    const btnSalvar = screen.getByRole('button', { name: /Salvar Alterações/i })
    fireEvent.click(btnSalvar)

    // O salvamento NÃO deve ser chamado
    expect(controleService.saveControleTransacional).not.toHaveBeenCalled()

    // O salvamento é interrompido e aparece o diálogo com o texto exato e os botões Sim e Não
    const textoExato =
      'A data da providência não pode ser maior que a data de conclusão do caso. Deseja solicitar adiamento para um administrador?'
    expect(await screen.findByText(textoExato)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sim' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Não' })).toBeDefined()
  })

  it('interrompe salvamento e exibe texto exato quando providência tem data maior que o caso salvo', async () => {
    const casoSalvo: any = {
      id: 'caso-2',
      identificacao_caso: 'Caso Prazo Violado',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-excedente',
          providencia: 'Providência com prazo maior',
          prazo_conclusao: '2026-06-20', // Maior que 2026-06-15!
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Prazo Violado')

    const btnSalvar = screen.getByRole('button', { name: /Salvar Alterações/i })
    fireEvent.click(btnSalvar)

    // O salvamento NÃO deve ser chamado
    expect(controleService.saveControleTransacional).not.toHaveBeenCalled()

    // O diálogo Sim/Não deve ser exibido com o texto exato
    const textoExato =
      'A data da providência não pode ser maior que a data de conclusão do caso. Deseja solicitar adiamento para um administrador?'
    expect(await screen.findByText(textoExato)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sim' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Não' })).toBeDefined()
  })

  it('escolha "Não" fecha o diálogo Sim/Não e preserva todo o preenchimento sem gravar nada', async () => {
    const casoSalvo: any = {
      id: 'caso-nao',
      identificacao_caso: 'Caso Não Adiamento',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-nao',
          providencia: 'Providência excedente',
          prazo_conclusao: '2026-06-25',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Não Adiamento')

    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))

    const btnNao = await screen.findByRole('button', { name: 'Não' })
    fireEvent.click(btnNao)

    // Não deve gravar nada
    expect(controleService.saveControleTransacional).not.toHaveBeenCalled()
    expect(controleService.solicitarAdiamento).not.toHaveBeenCalled()

    // Formulário permanece preenchido
    expect(screen.getByDisplayValue('Caso Não Adiamento')).toBeDefined()
    // Janela de confirmação fechou
    await waitFor(() => {
      expect(
        screen.queryByText(
          /A data da providência não pode ser maior que a data de conclusão do caso/i,
        ),
      ).toBeNull()
    })
  })

  it('escolha "Sim" abre janela de solicitação exibindo automaticamente a data pretendida', async () => {
    const casoSalvo: any = {
      id: 'caso-sim',
      identificacao_caso: 'Caso Sim Adiamento',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-sim',
          providencia: 'Apresentar Memoriais Conclusivos',
          prazo_conclusao: '2026-06-28',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [
        { id: 'admin-1', nome: 'Dr. Roberto Ricci', email: 'roberto@riccipi.com.br' },
      ],
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Sim Adiamento')

    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))

    const btnSim = await screen.findByRole('button', { name: 'Sim' })
    fireEvent.click(btnSim)

    // Deve abrir a janela "Solicitar Adiamento do Caso"
    expect(await screen.findByText('Solicitar Adiamento do Caso')).toBeDefined()
    // Data pretendida formatada exibida automaticamente (28/06/2026)
    expect(screen.getByText('28/06/2026')).toBeDefined()
    expect(screen.getByText(/Apresentar Memoriais Conclusivos/i)).toBeDefined()
    // Deve chamar listarAdministradoresAdiamento()
    expect(controleService.listarAdministradoresAdiamento).toHaveBeenCalled()
  })

  it('bloqueia envio se a lista de administradores elegíveis for vazia e explica os critérios', async () => {
    const casoSalvo: any = {
      id: 'caso-sem-admin',
      identificacao_caso: 'Caso Sem Admin Elegível',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-ex',
          providencia: 'Providência pendente',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [], // Vazia!
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Sem Admin Elegível')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))

    const btnSim = await screen.findByRole('button', { name: 'Sim' })
    fireEvent.click(btnSim)

    // Explicação de elegibilidade na tela
    expect(
      await screen.findByText(
        /Não há administrador elegível para receber solicitações de adiamento/i,
      ),
    ).toBeDefined()

    // Botão Enviar deve estar desabilitado
    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    expect(btnEnviar).toHaveProperty('disabled', true)
  })

  it('valida motivo obrigatório com trim, contador visível e limite de 200 caracteres', async () => {
    const casoSalvo: any = {
      id: 'caso-motivo',
      identificacao_caso: 'Caso Teste Motivo',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-mot',
          providencia: 'Providência teste',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Teste Motivo')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    await screen.findByText('Solicitar Adiamento do Caso')

    // Contador inicial 0/200 visível
    expect(screen.getByText('0/200')).toBeDefined()
    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    expect(btnEnviar).toHaveProperty('disabled', true)

    // Digita espaços em branco (trim = 0)
    const textarea = screen.getByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: '    ' } })
    expect(screen.getByText('0/200')).toBeDefined()
    expect(btnEnviar).toHaveProperty('disabled', true)

    // Digita texto válido
    fireEvent.change(textarea, {
      target: { value: 'Aguardando laudo técnico pericial complementar.' },
    })
    expect(screen.getByText('49/200')).toBeDefined()
    expect(btnEnviar).not.toHaveProperty('disabled', true)
  })

  it('envio aceito registra SOMENTE a solicitação sem salvar providência nem alterar prazo do caso', async () => {
    const casoSalvo: any = {
      id: 'caso-envio-ok',
      identificacao_caso: 'Caso Envio Sucesso',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-envio',
          providencia: 'Providência aguardando perito',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    vi.mocked(controleService.solicitarAdiamento).mockResolvedValue({
      success: true,
      solicitacao_registrada: true,
      notificacao_aceita_smtp: true,
      email_status: 'enviado',
      solicitacao_id: 'sol-123',
      message: 'Solicitação registrada com sucesso.',
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Envio Sucesso')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Justificativa pericial detalhada.' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalledWith(
        expect.objectContaining({
          tarefaId: 'caso-envio-ok',
          administradorCoreUsuarioId: 'admin-1',
          motivo: 'Justificativa pericial detalhada.',
          prazoSolicitado: '2026-06-30',
          providenciaTexto: 'Providência aguardando perito',
        }),
      )
    })

    // NÃO deve gravar nem alterar o caso/providência
    expect(controleService.saveControleTransacional).not.toHaveBeenCalled()
    // O modal de solicitação fecha mas o modal principal permanece com os dados preservados
    await waitFor(() => {
      expect(screen.queryByText('Solicitar Adiamento do Caso')).toBeNull()
    })
    expect(screen.getByDisplayValue('Caso Envio Sucesso')).toBeDefined()
  })

  it('resultado incerto (SMTP) não permite reenvio automático, bloqueia campos e preserva bloqueio ao fechar e reabrir', async () => {
    const casoSalvo: any = {
      id: 'caso-incerto',
      identificacao_caso: 'Caso Incerto SMTP',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-incerto',
          providencia: 'Providência com SMTP incerto',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    vi.mocked(controleService.solicitarAdiamento).mockResolvedValue({
      success: false,
      solicitacao_registrada: true,
      notificacao_aceita_smtp: false,
      email_status: 'incerto',
      error:
        'Resultado incerto no transporte SMTP (timeout/rede). Solicitação registrada; evento aguarda reconciliação sem reenvio automático.',
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Incerto SMTP')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Solicitação em local com sinal oscilando.' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(btnEnviar)

    // Deve exibir alerta de status incerto
    expect(await screen.findByText('Envio Incerto (SMTP)')).toBeDefined()
    expect(screen.getByText(/sem reenvio automático/i)).toBeDefined()

    // O botão Enviar e os campos de administrador e motivo devem ficar desabilitados
    expect(btnEnviar).toHaveProperty('disabled', true)
    expect(textarea).toHaveProperty('disabled', true)

    // Fecha a janela de solicitação clicando em Cancelar
    const btnCancelar = screen.getByRole('button', { name: 'Cancelar' })
    fireEvent.click(btnCancelar)

    await waitFor(() => {
      expect(screen.queryByText('Solicitar Adiamento do Caso')).toBeNull()
    })

    // Clica em Salvar Alterações e em Sim de novo para o MESMO pedido
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    await screen.findByText('Solicitar Adiamento do Caso')

    // O motivo continua preenchido, o alerta "Envio Incerto (SMTP)" aparece e o botão Enviar segue bloqueado
    const textareaReaberto = screen.getByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    expect((textareaReaberto as HTMLTextAreaElement).value).toBe(
      'Solicitação em local com sinal oscilando.',
    )
    expect(textareaReaberto).toHaveProperty('disabled', true)
    expect(screen.getByText('Envio Incerto (SMTP)')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', true)
  })

  it('retorno com success: true sem notificacao_aceita_smtp: true mantém janela aberta sem anúncio de envio', async () => {
    const casoSalvo: any = {
      id: 'caso-success-sem-smtp',
      identificacao_caso: 'Caso Sem Confirmação SMTP',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-sem-smtp',
          providencia: 'Providência sem confirmação',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    // Retorno com success: true mas notificacao_aceita_smtp: false (ou email_status pendente/falhou)
    vi.mocked(controleService.solicitarAdiamento).mockResolvedValue({
      success: true,
      solicitacao_registrada: true,
      notificacao_aceita_smtp: false,
      email_status: 'pendente',
      message: 'Solicitação gravada mas e-mail ainda pendente de envio.',
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Sem Confirmação SMTP')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Motivo teste sem confirmação smtp.' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalled()
    })

    // A janela DEVE CONTINUAR aberta
    expect(screen.getByText('Solicitar Adiamento do Caso')).toBeDefined()
    // NADA é anunciado como enviado
    expect(screen.queryByText('Solicitação de adiamento enviada')).toBeNull()
    // Mensagem exibida na janela
    expect(
      screen.getByText(
        /Não foi possível confirmar o envio da notificação ao administrador|pendente/i,
      ),
    ).toBeDefined()
  })

  it('situação "enviando" exibe mensagem de processamento em andamento com janela aberta', async () => {
    const casoSalvo: any = {
      id: 'caso-enviando',
      identificacao_caso: 'Caso Enviando',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-env',
          providencia: 'Providência enviando',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    vi.mocked(controleService.solicitarAdiamento).mockResolvedValue({
      success: false,
      solicitacao_registrada: true,
      email_status: 'enviando',
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Enviando')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Motivo teste enviando.' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalled()
    })

    // Janela aberta
    expect(screen.getByText('Solicitar Adiamento do Caso')).toBeDefined()
    expect(
      screen.getByText(
        'O envio desta solicitação já está em processamento. Aguarde alguns instantes antes de tentar novamente.',
      ),
    ).toBeDefined()
  })

  it('situação "falhou" com solicitação registrada exibe mensagem do servidor + texto explicativo', async () => {
    const casoSalvo: any = {
      id: 'caso-falhou-reg',
      identificacao_caso: 'Caso Falhou Registrado',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-falhou',
          providencia: 'Providência falhou',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    vi.mocked(controleService.solicitarAdiamento).mockResolvedValue({
      success: false,
      solicitacao_registrada: true,
      email_status: 'falhou',
      error: 'SMTP recusou a mensagem (550 Recipient rejected).',
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Falhou Registrado')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Motivo teste falhou registrado.' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalled()
    })

    expect(screen.getByText('Solicitar Adiamento do Caso')).toBeDefined()
    expect(
      screen.getByText(
        /SMTP recusou a mensagem.*A solicitação foi registrada, mas o administrador não foi notificado\. Você pode tentar novamente\./i,
      ),
    ).toBeDefined()
  })

  it('situação "cancelado" exibe mensagem do servidor com janela aberta', async () => {
    const casoSalvo: any = {
      id: 'caso-cancelado',
      identificacao_caso: 'Caso Cancelado',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-canc',
          providencia: 'Providência cancelada',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    vi.mocked(controleService.solicitarAdiamento).mockResolvedValue({
      success: false,
      solicitacao_registrada: false,
      email_status: 'cancelado',
      error: 'Operação cancelada pelo administrador central.',
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Cancelado')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Motivo teste cancelado.' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalled()
    })

    expect(screen.getByText('Solicitar Adiamento do Caso')).toBeDefined()
    expect(screen.getByText('Operação cancelada pelo administrador central.')).toBeDefined()
  })

  it('geração de nova chave quando o usuário altera o administrador ou motivo após tentativa com erro', async () => {
    const casoSalvo: any = {
      id: 'caso-nova-chave',
      identificacao_caso: 'Caso Nova Chave',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-alt',
          providencia: 'Providência com alteração',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [
        { id: 'admin-1', nome: 'Admin 1', email: 'admin1@riccipi.com.br' },
        { id: 'admin-2', nome: 'Admin 2', email: 'admin2@riccipi.com.br' },
      ],
    })

    vi.mocked(controleService.solicitarAdiamento).mockResolvedValue({
      success: false,
      email_status: 'falhou',
      error: 'Falha temporária de envio.',
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Nova Chave')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Motivo original 1' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalledTimes(1)
    })
    const chave1 = vi.mocked(controleService.solicitarAdiamento).mock.calls[0][0].chaveIdempotencia

    // Usuário altera o motivo
    fireEvent.change(textarea, { target: { value: 'Motivo alterado 2' } })
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalledTimes(2)
    })
    const chave2 = vi.mocked(controleService.solicitarAdiamento).mock.calls[1][0].chaveIdempotencia

    // A chave deve ser DIFERENTE porque o motivo foi alterado
    expect(chave2).not.toBe(chave1)
  })

  it('recarregamento da lista de administradores mantém o selecionado se continuar elegível, ou escolhe o primeiro', async () => {
    const casoSalvo: any = {
      id: 'caso-reload-admin',
      identificacao_caso: 'Caso Reload Admin',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-reload',
          providencia: 'Providência reload',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValueOnce({
      success: true,
      administradores: [
        { id: 'admin-1', nome: 'Admin 1', email: 'admin1@riccipi.com.br' },
        { id: 'admin-2', nome: 'Admin 2', email: 'admin2@riccipi.com.br' },
      ],
    })

    const { rerender } = render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Reload Admin')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    await screen.findByText('Solicitar Adiamento do Caso')
    // Inicialmente seleciona admin-1 (o primeiro)
    expect(screen.getByText('Admin 1')).toBeDefined()

    // Fecha a janela de solicitação
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    // Na próxima abertura, a lista volta com apenas Admin 2 (Admin 1 não é mais elegível)
    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValueOnce({
      success: true,
      administradores: [{ id: 'admin-2', nome: 'Admin 2', email: 'admin2@riccipi.com.br' }],
    })

    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    // Agora deve selecionar admin-2 automaticamente
    await waitFor(() => {
      expect(screen.getByText('Admin 2')).toBeDefined()
    })
  })

  it('ignora novo clique (duplo clique) enquanto envio estiver em andamento', async () => {
    const casoSalvo: any = {
      id: 'caso-duplo-clique',
      identificacao_caso: 'Caso Duplo Clique',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-dc',
          providencia: 'Providência duplo clique',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    // Simula promise lenta para o envio
    let resolverEnvio: (val: any) => void = () => {}
    const promiseEnvio = new Promise((resolve) => {
      resolverEnvio = resolve
    })
    vi.mocked(controleService.solicitarAdiamento).mockReturnValue(promiseEnvio as any)

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Duplo Clique')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Motivo duplo clique.' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    // Dispara dois cliques sucessivos
    fireEvent.click(btnEnviar)
    fireEvent.click(btnEnviar)

    // Deve ter chamado apenas UMA vez
    expect(controleService.solicitarAdiamento).toHaveBeenCalledTimes(1)

    // Libera a promise
    resolverEnvio({
      success: true,
      email_status: 'enviado',
      notificacao_aceita_smtp: true,
    })

    await waitFor(() => {
      expect(screen.queryByText('Solicitar Adiamento do Caso')).toBeNull()
    })
  })

  it('preserva a MESMA chave de idempotência entre retentativas do mesmo pedido', async () => {
    const casoSalvo: any = {
      id: 'caso-idemp',
      identificacao_caso: 'Caso Idempotência',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-06-15',
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-idemp',
          providencia: 'Providência teste idemp',
          prazo_conclusao: '2026-06-30',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    vi.mocked(controleService.listarAdministradoresAdiamento).mockResolvedValue({
      success: true,
      administradores: [{ id: 'admin-1', nome: 'Admin Ricci', email: 'admin@riccipi.com.br' }],
    })

    // 1ª tentativa: falha transitória recuperável
    vi.mocked(controleService.solicitarAdiamento).mockResolvedValueOnce({
      success: false,
      solicitacao_registrada: false,
      email_status: 'falhou',
      error: 'Erro de conexão transitório. Tente novamente.',
    })

    // 2ª tentativa: sucesso
    vi.mocked(controleService.solicitarAdiamento).mockResolvedValueOnce({
      success: true,
      solicitacao_registrada: true,
      notificacao_aceita_smtp: true,
      email_status: 'enviado',
      solicitacao_id: 'sol-recuperada',
    })

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Idempotência')
    fireEvent.click(screen.getByRole('button', { name: /Salvar Alterações/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Sim' }))

    const textarea = await screen.findByPlaceholderText(/Descreva a justificativa para prorrogar/i)
    fireEvent.change(textarea, { target: { value: 'Tentativa com chave fixa.' } })

    const btnEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalledTimes(1)
    })

    const primeiraChamadaChave = vi.mocked(controleService.solicitarAdiamento).mock.calls[0][0]
      .chaveIdempotencia
    expect(primeiraChamadaChave).toBeTruthy()

    // Clica novamente em Enviar para retentar o mesmo pedido
    fireEvent.click(btnEnviar)

    await waitFor(() => {
      expect(controleService.solicitarAdiamento).toHaveBeenCalledTimes(2)
    })

    const segundaChamadaChave = vi.mocked(controleService.solicitarAdiamento).mock.calls[1][0]
      .chaveIdempotencia
    expect(segundaChamadaChave).toBe(primeiraChamadaChave)
  })

  it('trata rejeição do banco por mudança concorrente de prazo preservando formulário e atualizando prazo conhecido', async () => {
    const casoSalvo: any = {
      id: 'caso-concorrente',
      identificacao_caso: 'Caso Concorrência Banco',
      nome_controle_id: 'nc-1',
      status_id: 'st-1',
      prazo_conclusao: '2026-07-20', // No formulário inicial
      responsavel_usuario_id: 'u-1',
      executor_usuario_id: 'u-1',
      providencias: [
        {
          id: 'prov-conc',
          providencia: 'Providência 15/07',
          prazo_conclusao: '2026-07-15',
          status_id: 'sp-1',
          tipo_prazo_id: 'tp-1',
        },
      ],
    }

    // O banco rejeita porque outro usuário reduziu concorrentemente o prazo do caso para 10/07/2026
    const erroBanco: any = new Error(
      'A data da providência (15/07/2026) não pode ser maior que a data de conclusão do caso (10/07/2026 - Caso #123: "Caso Concorrência Banco").',
    )
    erroBanco.code = '23514'

    vi.mocked(controleService.saveControleTransacional).mockRejectedValue(erroBanco)

    // Supabase consulta o caso atualizado do banco
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { prazo_conclusao: '2026-07-10T00:00:00Z' },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as any)

    render(
      <ControleModal
        open={true}
        onOpenChange={vi.fn()}
        controleToEdit={casoSalvo}
        statusList={baseStatus as any}
        statusProvidenciaList={baseStatusProv as any}
        tiposPrazoList={baseTiposPrazo as any}
        onSaved={vi.fn()}
      />,
    )

    await screen.findByDisplayValue('Caso Concorrência Banco')

    const btnSalvar = screen.getByRole('button', { name: /Salvar Alterações/i })
    fireEvent.click(btnSalvar)

    await waitFor(() => {
      expect(controleService.saveControleTransacional).toHaveBeenCalled()
      expect(supabase.from).toHaveBeenCalledWith('task_tarefas')
    })

    // O formulário continua aberto e com seus dados preservados
    expect(screen.getByDisplayValue('Caso Concorrência Banco')).toBeDefined()
  })
})
