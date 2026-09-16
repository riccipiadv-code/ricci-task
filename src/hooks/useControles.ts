import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  TaskControleRecord,
  TaskStatusRecord,
  TaskStatusProvidenciaRecord,
  TaskTipoPrazoRecord,
  TaskNomeControleRecord,
  TaskResponsavelControleRecord,
  TaskExecutorRecord,
  ControleMetrics,
  UserSettings,
} from '@/types/task'
import { controleService } from '@/services/controleService'
import { useAuth } from '@/hooks/use-auth'

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'claro',
  defaultView: 'todos',
  notificationsEnabled: true,
}

export function useControles() {
  const { user } = useAuth()

  const [controles, setControles] = useState<TaskControleRecord[]>([])
  const [statusList, setStatusList] = useState<TaskStatusRecord[]>([])
  const [statusProvidenciaList, setStatusProvidenciaList] = useState<TaskStatusProvidenciaRecord[]>(
    [],
  )
  const [tiposPrazoList, setTiposPrazoList] = useState<TaskTipoPrazoRecord[]>([])
  const [nomesControle, setNomesControle] = useState<TaskNomeControleRecord[]>([])
  const [responsaveisControle, setResponsaveisControle] = useState<TaskResponsavelControleRecord[]>(
    [],
  )
  const [executores, setExecutores] = useState<TaskExecutorRecord[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const saved = localStorage.getItem('ricci_task_settings')
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS
    } catch {
      return DEFAULT_SETTINGS
    }
  })

  const updateSettings = useCallback((newSettings: Partial<UserSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings }
      try {
        localStorage.setItem('ricci_task_settings', JSON.stringify(updated))
      } catch (err) {
        console.error('Erro ao salvar settings no localStorage:', err)
      }
      return updated
    })
  }, [])

  // Carrega catálogos e controles
  const carregarDadosCompletos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [stList, stProvList, tpList, nomes, resps, execs, ctrlList] = await Promise.all([
        controleService.getStatus(),
        controleService.getStatusProvidencia(),
        controleService.getTiposPrazo(),
        controleService.getNomesControle({ incluirInativos: true }),
        controleService.getResponsaveisControle({ incluirInativos: true }),
        controleService.getExecutores({ incluirInativos: true }),
        controleService.getControles(),
      ])

      setStatusList(stList)
      setStatusProvidenciaList(stProvList)
      setTiposPrazoList(tpList)
      setNomesControle(nomes)
      setResponsaveisControle(resps)
      setExecutores(execs)
      setControles(ctrlList)
    } catch (err: any) {
      console.error('Erro ao carregar dados do Ricci Task:', err)
      setError(err?.message || 'Falha ao sincronizar dados com o Supabase.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) {
      carregarDadosCompletos()
    }
  }, [user, carregarDadosCompletos])

  const refreshControles = useCallback(async () => {
    try {
      const ctrlList = await controleService.getControles()
      setControles(ctrlList)
    } catch (err: any) {
      console.error('Erro ao recarregar controles:', err)
    }
  }, [])

  const refreshNomesControle = useCallback(async () => {
    try {
      const nomes = await controleService.getNomesControle({ incluirInativos: true })
      setNomesControle(nomes)
    } catch (err: any) {
      console.error('Erro ao recarregar nomes de controle:', err)
    }
  }, [])

  const refreshResponsaveisControle = useCallback(async () => {
    try {
      const resps = await controleService.getResponsaveisControle({ incluirInativos: true })
      setResponsaveisControle(resps)
    } catch (err: any) {
      console.error('Erro ao recarregar responsáveis:', err)
    }
  }, [])

  const refreshExecutores = useCallback(async () => {
    try {
      const execs = await controleService.getExecutores({ incluirInativos: true })
      setExecutores(execs)
    } catch (err: any) {
      console.error('Erro ao recarregar executores:', err)
    }
  }, [])

  const metrics: ControleMetrics = useMemo(() => {
    return controleService.calculateMetrics(controles)
  }, [controles])

  // Ações de cadastro
  const saveNomeControle = useCallback(
    async (input: { id?: string; nome: string; ativo?: boolean }) => {
      const saved = await controleService.saveNomeControle(input)
      await refreshNomesControle()
      return saved
    },
    [refreshNomesControle],
  )

  const toggleNomeControleAtivo = useCallback(
    async (id: string, ativo: boolean) => {
      await controleService.toggleNomeControleAtivo(id, ativo)
      await refreshNomesControle()
    },
    [refreshNomesControle],
  )

  const excluirNomeControle = useCallback(
    async (id: string) => {
      await controleService.deleteNomeControle(id)
      await refreshNomesControle()
    },
    [refreshNomesControle],
  )

  const saveResponsavelControle = useCallback(
    async (input: { id?: string; nome: string; ativo?: boolean }) => {
      const saved = await controleService.saveResponsavelControle(input)
      await refreshResponsaveisControle()
      return saved
    },
    [refreshResponsaveisControle],
  )

  const toggleResponsavelControleAtivo = useCallback(
    async (id: string, ativo: boolean) => {
      await controleService.toggleResponsavelControleAtivo(id, ativo)
      await refreshResponsaveisControle()
    },
    [refreshResponsaveisControle],
  )

  const excluirResponsavelControle = useCallback(
    async (id: string) => {
      await controleService.deleteResponsavelControle(id)
      await refreshResponsaveisControle()
    },
    [refreshResponsaveisControle],
  )

  const saveExecutor = useCallback(
    async (input: { id?: string; nome: string; ativo?: boolean }) => {
      const saved = await controleService.saveExecutor(input)
      await refreshExecutores()
      return saved
    },
    [refreshExecutores],
  )

  const toggleExecutorAtivo = useCallback(
    async (id: string, ativo: boolean) => {
      await controleService.toggleExecutorAtivo(id, ativo)
      await refreshExecutores()
    },
    [refreshExecutores],
  )

  const excluirExecutor = useCallback(
    async (id: string) => {
      await controleService.deleteExecutor(id)
      await refreshExecutores()
    },
    [refreshExecutores],
  )

  const archiveControle = useCallback(
    async (id: string) => {
      await controleService.archiveControle(id)
      await refreshControles()
    },
    [refreshControles],
  )

  return {
    controles,
    statusList,
    statusProvidenciaList,
    tiposPrazoList,
    nomesControle,
    responsaveisControle,
    executores,
    metrics,
    loading,
    error,
    settings,
    updateSettings,
    refreshControles,
    refreshNomesControle,
    refreshResponsaveisControle,
    refreshExecutores,
    saveNomeControle,
    toggleNomeControleAtivo,
    excluirNomeControle,
    saveResponsavelControle,
    toggleResponsavelControleAtivo,
    excluirResponsavelControle,
    saveExecutor,
    toggleExecutorAtivo,
    excluirExecutor,
    archiveControle,
    recarregarTudo: carregarDadosCompletos,
  }
}
