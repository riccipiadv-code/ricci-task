import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  TaskControleRecord,
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
  const [statusList, setStatusList] = useState<TaskStatusRecord[]>([])
  const [tiposPrazoList, setTiposPrazoList] = useState<TaskTipoPrazoRecord[]>([])
  const [responsaveisCatalogo, setResponsaveisCatalogo] = useState<TaskResponsavelRecord[]>([])
  const [usuariosInternos, setUsuariosInternos] = useState<LegaldeskUsuarioRecord[]>([])
  const [settings, setSettingsState] = useState<AppSettings>(() => controleService.getSettings())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Carrega metadados (status, responsáveis, tipos de prazo)
  const loadMetadata = useCallback(async () => {
    try {
      const [statuses, tipos, catResps, users] = await Promise.all([
        controleService.getStatusList(),
        controleService.getTiposPrazoList(),
        controleService.getResponsaveisCatalogo(),
        controleService.getUsuariosInternosLegaldesk(),
      ])
      setStatusList(statuses)
      setTiposPrazoList(tipos)
      setResponsaveisCatalogo(catResps)
      setUsuariosInternos(users)
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

  // Lista unificada e agrupada de opções de responsáveis para formulários
  const responsaveisOptions = useMemo<ResponsavelOption[]>(() => {
    const internas: ResponsavelOption[] = usuariosInternos.map((u) => ({
      value: `interno:${u.id}`,
      id: u.id,
      grupo: 'interno',
      nome: u.nome,
      detalhe: u.email || (u.sigla ? `Sigla: ${u.sigla}` : undefined),
      tipo: 'interno',
    }))

    const catalogos: ResponsavelOption[] = responsaveisCatalogo.map((r) => ({
      value: `catalogo:${r.id}`,
      id: r.id,
      grupo: 'catalogo',
      nome: r.nome,
      detalhe: r.tipo === 'equipe' ? 'Equipe interna' : 'Terceiro / Correspondente',
      tipo: r.tipo,
    }))

    return [...internas, ...catalogos]
  }, [usuariosInternos, responsaveisCatalogo])

  return {
    controles,
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
