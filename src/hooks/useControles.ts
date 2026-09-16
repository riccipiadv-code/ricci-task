import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  TaskControleRecord,
  TaskStatusRecord,
  TaskStatusProvidenciaRecord,
  TaskTipoPrazoRecord,
  TaskNomeControleRecord,
  TaskUsuarioAtivoRecord,
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
  const [usuariosAtivos, setUsuariosAtivos] = useState<TaskUsuarioAtivoRecord[]>([])

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

  // Carrega catálogos, usuários ativos via RPC e controles
  const carregarDadosCompletos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [stList, stProvList, tpList, nomes, users] = await Promise.all([
        controleService.getStatus(),
        controleService.getStatusProvidencia(),
        controleService.getTiposPrazo(),
        controleService.getNomesControle({ incluirInativos: true }),
        controleService.getUsuariosAtivos(),
      ])

      const ctrlList = await controleService.getControles(users)

      setStatusList(stList)
      setStatusProvidenciaList(stProvList)
      setTiposPrazoList(tpList)
      setNomesControle(nomes)
      setUsuariosAtivos(users)
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

  const refreshUsuariosAtivos = useCallback(async () => {
    try {
      const users = await controleService.getUsuariosAtivos()
      setUsuariosAtivos(users)
      return users
    } catch (err: any) {
      console.error('Erro ao recarregar usuários ativos:', err)
      return []
    }
  }, [])

  const refreshControles = useCallback(async () => {
    try {
      const ctrlList = await controleService.getControles(usuariosAtivos)
      setControles(ctrlList)
    } catch (err: any) {
      console.error('Erro ao recarregar controles:', err)
    }
  }, [usuariosAtivos])

  const refreshNomesControle = useCallback(async () => {
    try {
      const nomes = await controleService.getNomesControle({ incluirInativos: true })
      setNomesControle(nomes)
    } catch (err: any) {
      console.error('Erro ao recarregar nomes de controle:', err)
    }
  }, [])

  const metrics: ControleMetrics = useMemo(() => {
    return controleService.calculateMetrics(controles)
  }, [controles])

  // Ações de cadastro de Nomes do Controle
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
    usuariosAtivos,
    metrics,
    loading,
    error,
    settings,
    updateSettings,
    refreshControles,
    refreshNomesControle,
    refreshUsuariosAtivos,
    saveNomeControle,
    toggleNomeControleAtivo,
    excluirNomeControle,
    archiveControle,
    recarregarTudo: carregarDadosCompletos,
  }
}
