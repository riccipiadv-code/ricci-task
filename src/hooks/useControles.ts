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

  // Carrega catálogos, usuários e controles.
  // Resiliente: se a busca de usuários falhar, usamos uma lista vazia, registramos o erro no console
  // e prosseguimos com o carregamento dos Controles (task_tarefas) normalmente.
  const carregarDadosCompletos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 1. Busca usuários e tabelas auxiliares de forma independente e tolerante a falhas
      // Nenhuma falha em consultas auxiliares pode impedir o carregamento de task_tarefas
      let users: TaskUsuarioAtivoRecord[] = []
      try {
        users = await controleService.getUsuariosAtivos()
      } catch (userErr: any) {
        console.error('Falha ao carregar usuários de task_usuarios em useControles:', userErr)
        users = []
      }
      setUsuariosAtivos(users)

      // Executa cada consulta auxiliar independentemente, com fallback seguro para lista vazia
      const [stList, stProvList, tpList, nomes] = await Promise.all([
        controleService.getStatus().catch((err) => {
          console.error('Aviso ao buscar task_status (usando lista vazia):', err)
          return [] as TaskStatusRecord[]
        }),
        controleService.getStatusProvidencia().catch((err) => {
          console.error('Aviso ao buscar task_status_providencia (usando lista vazia):', err)
          return [] as TaskStatusProvidenciaRecord[]
        }),
        controleService.getTiposPrazo().catch((err) => {
          console.error('Aviso ao buscar task_tipos_prazo (usando lista vazia):', err)
          return [] as TaskTipoPrazoRecord[]
        }),
        controleService.getNomesControle({ incluirInativos: true }).catch((err) => {
          console.error('Aviso ao buscar task_nomes_controle (usando lista vazia):', err)
          return [] as TaskNomeControleRecord[]
        }),
      ])

      setStatusList(stList)
      setStatusProvidenciaList(stProvList)
      setTiposPrazoList(tpList)
      setNomesControle(nomes)

      // 2. Busca task_tarefas da lista principal (garantindo carregamento mesmo se auxiliares falharem)
      const ctrlList = await controleService.getControles(users)
      setControles(ctrlList)
    } catch (err: any) {
      console.error('Erro ao carregar controles do Ricci Task:', err)
      setError(err?.message || 'Falha ao sincronizar dados com o Supabase.')
    } finally {
      setLoading(false)
    }
  }, [])

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

  useEffect(() => {
    if (user) {
      carregarDadosCompletos()
    }
  }, [user, carregarDadosCompletos])

  // Ouve eventos de alteração global (ex: arquivar/desarquivar feito em qualquer tela)
  useEffect(() => {
    const handleGlobalChange = () => {
      refreshControles()
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('ricci:controles-changed', handleGlobalChange)
      return () => {
        window.removeEventListener('ricci:controles-changed', handleGlobalChange)
      }
    }
  }, [refreshControles])

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

  const unarchiveControle = useCallback(
    async (id: string) => {
      await controleService.unarchiveControle(id)
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
    updateProvidenciaStatus: async (id: string, statusId: string) => {
      const updated = await controleService.updateProvidenciaStatus(id, statusId)
      await refreshControles()
      return updated
    },
    archiveControle,
    unarchiveControle,
    recarregarTudo: carregarDadosCompletos,
  }
}
