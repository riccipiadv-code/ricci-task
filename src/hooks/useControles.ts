import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  TaskControleRecord,
  TaskNomeControleRecord,
  TaskResponsavelControleRecord,
  TaskStatusRecord,
  TaskTipoPrazoRecord,
  TaskResponsavelRecord,
  LegaldeskUsuarioRecord,
  ResponsavelOption,
  SaveControleInput,
  SavePrazoInput,
  SaveAndamentoInput,
  AppSettings,
  DashboardMetrics,
} from '@/types/task'
import { controleService } from '@/services/controleService'
import { useAuth } from '@/hooks/use-auth'

export function useControles() {
  const { user } = useAuth()
  const [controles, setControles] = useState<TaskControleRecord[]>([])
  const [nomesControle, setNomesControle] = useState<TaskNomeControleRecord[]>([])
  const [responsaveisControle, setResponsaveisControle] = useState<TaskResponsavelControleRecord[]>(
    [],
  )
  const [statusList, setStatusList] = useState<TaskStatusRecord[]>([])
  const [tiposPrazoList, setTiposPrazoList] = useState<TaskTipoPrazoRecord[]>([])
  const [responsaveisCatalogo, setResponsaveisCatalogo] = useState<TaskResponsavelRecord[]>([])
  const [usuariosInternos, setUsuariosInternos] = useState<LegaldeskUsuarioRecord[]>([])
  const [settings, setSettingsState] = useState<AppSettings>(() => controleService.getSettings())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Carrega metadados (status, tipos de prazo, nomes dos controles e responsáveis pelo controle)
  const loadMetadata = useCallback(async () => {
    try {
      const [statuses, tipos, nomes, resps] = await Promise.all([
        controleService.getStatusList(),
        controleService.getTiposPrazoList(),
        controleService.getNomesControle({ incluirInativos: true }),
        controleService.getResponsaveisControle({ incluirInativos: true }),
      ])
      setStatusList(statuses)
      setTiposPrazoList(tipos)
      setNomesControle(nomes)
      setResponsaveisControle(resps)
    } catch (err: any) {
      console.error('Erro ao carregar metadados:', err)
      setError(err?.message || 'Falha ao carregar cadastros')
    }
  }, [])

  // Carrega controles ativos (deleted_at is null)
  const refreshControles = useCallback(async () => {
    try {
      setError(null)
      const data = await controleService.getControles()
      setControles(data)
    } catch (err: any) {
      console.error('Erro ao carregar controles:', err)
      setError(err?.message || 'Falha ao carregar controles do Supabase')
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadMetadata(), refreshControles()])
    setLoading(false)
  }, [loadMetadata, refreshControles])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  // Salvar controle (novo ou edição)
  const saveControle = useCallback(
    async (input: SaveControleInput) => {
      const saved = await controleService.saveControle(input)
      await refreshControles()
      return saved
    },
    [refreshControles],
  )

  // Arquivar controle (preencher deleted_at e deleted_by)
  const arquivarControle = useCallback(
    async (id: string) => {
      await controleService.arquivarControle(id, user?.id)
      await refreshControles()
    },
    [user?.id, refreshControles],
  )

  // Salvar prazo
  const savePrazo = useCallback(
    async (input: SavePrazoInput) => {
      const saved = await controleService.savePrazo(input)
      await refreshControles()
      return saved
    },
    [refreshControles],
  )

  const togglePrazoAtivo = useCallback(
    async (id: string, ativo: boolean) => {
      await controleService.togglePrazoAtivo(id, ativo)
      await refreshControles()
    },
    [refreshControles],
  )

  const deletePrazo = useCallback(
    async (id: string) => {
      await controleService.deletePrazo(id)
      await refreshControles()
    },
    [refreshControles],
  )

  // Salvar andamento
  const saveAndamento = useCallback(
    async (input: SaveAndamentoInput) => {
      const saved = await controleService.saveAndamento(input)
      await refreshControles()
      return saved
    },
    [refreshControles],
  )

  const deleteAndamento = useCallback(
    async (id: string) => {
      await controleService.deleteAndamento(id)
      await refreshControles()
    },
    [refreshControles],
  )

  // Preferências
  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    const next = controleService.saveSettings(updates)
    setSettingsState(next)
    return next
  }, [])

  // Métricas calculadas para dashboard
  const metrics: DashboardMetrics = useMemo(() => {
    return controleService.calculateMetrics(controles)
  }, [controles])

  // Lista de opções de responsáveis alimentada EXCLUSIVAMENTE por task_responsaveis_controle
  const responsaveisOptions = useMemo<ResponsavelOption[]>(() => {
    return responsaveisControle
      .filter((r) => r.ativo)
      .map((r) => ({
        value: r.id,
        id: r.id,
        grupo: 'catalogo',
        nome: r.nome,
        detalhe: undefined,
        tipo: 'equipe',
      }))
  }, [responsaveisControle])

  // CRUD Nomes dos Controles
  const refreshNomesControle = useCallback(async () => {
    try {
      const data = await controleService.getNomesControle({ incluirInativos: true })
      setNomesControle(data)
    } catch (err: any) {
      console.error('Erro ao atualizar nomes de controle:', err)
    }
  }, [])

  const saveNomeControle = useCallback(
    async (input: { id?: string; nome: string; ativo?: boolean }) => {
      const saved = await controleService.saveNomeControle(input, user?.id)
      await refreshNomesControle()
      await refreshControles()
      return saved
    },
    [user?.id, refreshNomesControle, refreshControles],
  )

  const toggleNomeControleAtivo = useCallback(
    async (id: string, ativo: boolean) => {
      await controleService.toggleNomeControleAtivo(id, ativo, user?.id)
      await refreshNomesControle()
      await refreshControles()
    },
    [user?.id, refreshNomesControle, refreshControles],
  )

  const excluirNomeControle = useCallback(
    async (id: string) => {
      await controleService.excluirNomeControle(id, user?.id)
      await refreshNomesControle()
      await refreshControles()
    },
    [user?.id, refreshNomesControle, refreshControles],
  )

  // CRUD Responsáveis pelo Controle
  const refreshResponsaveisControle = useCallback(async () => {
    try {
      const data = await controleService.getResponsaveisControle({ incluirInativos: true })
      setResponsaveisControle(data)
    } catch (err: any) {
      console.error('Erro ao atualizar responsaveis do controle:', err)
    }
  }, [])

  const saveResponsavelControle = useCallback(
    async (input: { id?: string; nome: string; ativo?: boolean }) => {
      const saved = await controleService.saveResponsavelControle(input, user?.id)
      await refreshResponsaveisControle()
      await refreshControles()
      return saved
    },
    [user?.id, refreshResponsaveisControle, refreshControles],
  )

  const toggleResponsavelControleAtivo = useCallback(
    async (id: string, ativo: boolean) => {
      await controleService.toggleResponsavelControleAtivo(id, ativo, user?.id)
      await refreshResponsaveisControle()
      await refreshControles()
    },
    [user?.id, refreshResponsaveisControle, refreshControles],
  )

  const excluirResponsavelControle = useCallback(
    async (id: string) => {
      await controleService.excluirResponsavelControle(id, user?.id)
      await refreshResponsaveisControle()
      await refreshControles()
    },
    [user?.id, refreshResponsaveisControle, refreshControles],
  )

  return {
    controles,
    nomesControle,
    responsaveisControle,
    statusList,
    tiposPrazoList,
    responsaveisCatalogo,
    usuariosInternos,
    responsaveisOptions,
    metrics,
    settings,
    loading,
    error,
    refreshAll,
    refreshControles,
    refreshNomesControle,
    refreshResponsaveisControle,
    saveNomeControle,
    toggleNomeControleAtivo,
    excluirNomeControle,
    saveResponsavelControle,
    toggleResponsavelControleAtivo,
    excluirResponsavelControle,
    saveControle,
    arquivarControle,
    savePrazo,
    togglePrazoAtivo,
    deletePrazo,
    saveAndamento,
    deleteAndamento,
    updateSettings,
  }
}
