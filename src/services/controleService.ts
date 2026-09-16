import { supabase } from '@/lib/supabase/client'
import { getLocalDateStr } from '@/lib/formatters'
import {
  TaskControleRecord,
  TaskStatusRecord,
  TaskStatusProvidenciaRecord,
  TaskTipoPrazoRecord,
  TaskNomeControleRecord,
  TaskUsuarioAtivoRecord,
  TaskProvidenciaRecord,
  SaveControleInput,
  SaveProvidenciaInput,
  SaveNomeControleInput,
  ControleMetrics,
} from '@/types/task'

export const controleService = {
  // --------------------------------------------------------------------------
  // LISTAGEM DE STATUS (task_status)
  // --------------------------------------------------------------------------
  async getStatus(): Promise<TaskStatusRecord[]> {
    const { data, error } = await supabase
      .from('task_status')
      .select('*')
      .eq('ativo', true)
      .order('ordem', { ascending: true })

    if (error) {
      console.error('Erro ao buscar task_status:', error)
      throw error
    }
    return (data || []) as TaskStatusRecord[]
  },

  // --------------------------------------------------------------------------
  // LISTAGEM DE STATUS DE PROVIDÊNCIA (task_status_providencia)
  // --------------------------------------------------------------------------
  async getStatusProvidencia(): Promise<TaskStatusProvidenciaRecord[]> {
    const { data, error } = await supabase
      .from('task_status_providencia')
      .select('*')
      .eq('ativo', true)
      .order('ordem', { ascending: true })

    if (error) {
      console.error('Erro ao buscar task_status_providencia:', error)
      throw error
    }
    return (data || []) as TaskStatusProvidenciaRecord[]
  },

  // --------------------------------------------------------------------------
  // LISTAGEM DE TIPOS DE PRAZO (task_tipos_prazo)
  // --------------------------------------------------------------------------
  async getTiposPrazo(): Promise<TaskTipoPrazoRecord[]> {
    const { data, error } = await supabase
      .from('task_tipos_prazo')
      .select('*')
      .eq('ativo', true)
      .order('ordem', { ascending: true })

    if (error) {
      console.error('Erro ao buscar task_tipos_prazo:', error)
      throw error
    }
    return (data || []) as TaskTipoPrazoRecord[]
  },

  // --------------------------------------------------------------------------
  // GESTÃO DE NOMES DOS CONTROLES (task_nomes_controle)
  // --------------------------------------------------------------------------
  async getNomesControle(options?: {
    incluirInativos?: boolean
  }): Promise<TaskNomeControleRecord[]> {
    let query = supabase
      .from('task_nomes_controle')
      .select('*')
      .is('deleted_at', null)
      .order('nome', { ascending: true })

    if (!options?.incluirInativos) {
      query = query.eq('ativo', true)
    }

    const { data, error } = await query
    if (error) {
      console.error('Erro ao buscar task_nomes_controle:', error)
      throw error
    }
    return (data || []) as TaskNomeControleRecord[]
  },

  async saveNomeControle(input: SaveNomeControleInput): Promise<TaskNomeControleRecord> {
    const cleanNome = input.nome.trim()
    if (!cleanNome) {
      throw new Error('O Nome do Controle é obrigatório.')
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id || null

    if (input.id) {
      const { data, error } = await supabase
        .from('task_nomes_controle')
        .update({
          nome: cleanNome,
          ativo: input.ativo !== undefined ? input.ativo : true,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq('id', input.id)
        .select()
        .single()

      if (error) throw error
      return data as TaskNomeControleRecord
    } else {
      const { data, error } = await supabase
        .from('task_nomes_controle')
        .insert({
          nome: cleanNome,
          ativo: input.ativo !== undefined ? input.ativo : true,
          created_by: userId,
          updated_by: userId,
        })
        .select()
        .single()

      if (error) throw error
      return data as TaskNomeControleRecord
    }
  },

  async toggleNomeControleAtivo(id: string, ativo: boolean): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('task_nomes_controle')
      .update({
        ativo,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      })
      .eq('id', id)

    if (error) throw error
  },

  async deleteNomeControle(id: string): Promise<void> {
    const { count, error: checkError } = await supabase
      .from('task_tarefas')
      .select('id', { count: 'exact', head: true })
      .eq('nome_controle_id', id)
      .is('deleted_at', null)

    if (checkError) throw checkError
    if (count && count > 0) {
      throw new Error(
        `Este Nome do Controle está associado a ${count} controle(s) de caso ativo(s) e não pode ser excluído.`,
      )
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('task_nomes_controle')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null,
        ativo: false,
      })
      .eq('id', id)

    if (error) throw error
  },

  // --------------------------------------------------------------------------
  // LISTAGEM DE USUÁRIOS ATIVOS VIA RPC (task_listar_usuarios_ativos)
  // Única fonte para Responsável e Executor (Profiles do Conectaí)
  // --------------------------------------------------------------------------
  async getUsuariosAtivos(): Promise<TaskUsuarioAtivoRecord[]> {
    const { data, error } = await supabase.rpc('task_listar_usuarios_ativos')

    if (error) {
      console.error('Erro ao executar RPC task_listar_usuarios_ativos:', error)
      throw new Error(
        'Não foi possível carregar a lista de usuários ativos. Verifique sua conexão.',
      )
    }

    const lista = (data || []) as TaskUsuarioAtivoRecord[]
    // Ordenar alfabeticamente por nome
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  },

  // --------------------------------------------------------------------------
  // GESTÃO DE PROVIDÊNCIAS (task_providencias)
  // --------------------------------------------------------------------------
  async getProvidencias(tarefaId: string): Promise<TaskProvidenciaRecord[]> {
    const { data, error } = await supabase
      .from('task_providencias')
      .select(`
        *,
        tipo_prazo:task_tipos_prazo(*),
        status:task_status_providencia(*)
      `)
      .eq('tarefa_id', tarefaId)
      .is('deleted_at', null)
      .order('prazo_conclusao', { ascending: true })
      .order('ordem', { ascending: true })

    if (error) {
      console.error('Erro ao buscar task_providencias:', error)
      throw error
    }

    return (data || []) as unknown as TaskProvidenciaRecord[]
  },

  async saveProvidencia(input: SaveProvidenciaInput): Promise<TaskProvidenciaRecord> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id || null

    if (input.id) {
      const { data, error } = await supabase
        .from('task_providencias')
        .update({
          providencia: input.providencia.trim(),
          prazo_conclusao: input.prazo_conclusao,
          tipo_prazo_id: input.tipo_prazo_id,
          status_id: input.status_id,
          ordem: input.ordem ?? 0,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq('id', input.id)
        .select(`
          *,
          tipo_prazo:task_tipos_prazo(*),
          status:task_status_providencia(*)
        `)
        .single()

      if (error) throw error
      return data as unknown as TaskProvidenciaRecord
    } else {
      const { data, error } = await supabase
        .from('task_providencias')
        .insert({
          tarefa_id: input.tarefa_id,
          providencia: input.providencia.trim(),
          prazo_conclusao: input.prazo_conclusao,
          tipo_prazo_id: input.tipo_prazo_id,
          status_id: input.status_id,
          ordem: input.ordem ?? 0,
          created_by: userId,
          updated_by: userId,
        })
        .select(`
          *,
          tipo_prazo:task_tipos_prazo(*),
          status:task_status_providencia(*)
        `)
        .single()

      if (error) throw error
      return data as unknown as TaskProvidenciaRecord
    }
  },

  async updateProvidenciaStatus(id: string, statusId: string): Promise<TaskProvidenciaRecord> {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('task_providencias')
      .update({
        status_id: statusId,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      })
      .eq('id', id)
      .select(`
        *,
        tipo_prazo:task_tipos_prazo(*),
        status:task_status_providencia(*)
      `)
      .single()

    if (error) {
      console.error('Erro ao atualizar status da providência:', error)
      throw error
    }
    return data as unknown as TaskProvidenciaRecord
  },

  async deleteProvidencia(id: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('task_providencias')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null,
      })
      .eq('id', id)

    if (error) throw error
  },

  // --------------------------------------------------------------------------
  // LISTAGEM PRINCIPAL DE CONTROLES (task_tarefas)
  // Resolvendo responsáveis e executores a partir dos usuários ativos da RPC
  // --------------------------------------------------------------------------
  async getControles(usuariosParam?: TaskUsuarioAtivoRecord[]): Promise<TaskControleRecord[]> {
    // 1. Garante que temos a lista de usuários para resolver os nomes
    let usuariosMap = new Map<string, TaskUsuarioAtivoRecord>()
    if (usuariosParam && usuariosParam.length > 0) {
      usuariosParam.forEach((u) => usuariosMap.set(u.id, u))
    } else {
      try {
        const users = await this.getUsuariosAtivos()
        users.forEach((u) => usuariosMap.set(u.id, u))
      } catch (err) {
        console.error('Aviso ao obter usuários para resolução de controles:', err)
      }
    }

    // 2. Busca os controles ativos com joins nas tabelas auxiliares próprias
    const { data: tarefasRaw, error: tarefasError } = await supabase
      .from('task_tarefas')
      .select(`
        *,
        nome_controle_obj:task_nomes_controle(id, nome),
        status_obj:task_status(id, codigo, nome, ordem, finaliza, ativo)
      `)
      .is('deleted_at', null)

    if (tarefasError) {
      console.error('Erro ao buscar task_tarefas:', tarefasError)
      throw tarefasError
    }

    if (!tarefasRaw || tarefasRaw.length === 0) {
      return []
    }

    const tarefaIds = tarefasRaw.map((t) => t.id)

    // 3. Busca todas as providências ativas desses controles
    const { data: providenciasRaw, error: provError } = await supabase
      .from('task_providencias')
      .select(`
        *,
        tipo_prazo:task_tipos_prazo(*),
        status:task_status_providencia(*)
      `)
      .in('tarefa_id', tarefaIds)
      .is('deleted_at', null)
      .order('prazo_conclusao', { ascending: true })
      .order('ordem', { ascending: true })

    if (provError) {
      console.error('Erro ao buscar providências dos controles:', provError)
      throw provError
    }

    // Agrupa providências por tarefa_id
    const provsByTarefa: Record<string, TaskProvidenciaRecord[]> = {}
    for (const p of (providenciasRaw || []) as unknown as TaskProvidenciaRecord[]) {
      if (!provsByTarefa[p.tarefa_id]) {
        provsByTarefa[p.tarefa_id] = []
      }
      provsByTarefa[p.tarefa_id].push(p)
    }

    // 4. Monta o modelo hidratado
    const controles: TaskControleRecord[] = tarefasRaw.map((t: any) => {
      const provs = provsByTarefa[t.id] || []

      // Ordena providências: abertas primeiro por prazo crescente, depois finalizadas
      const provsOrdenadas = [...provs].sort((a, b) => {
        const aFinaliza = Boolean(a.status?.finaliza)
        const bFinaliza = Boolean(b.status?.finaliza)
        if (aFinaliza !== bFinaliza) {
          return aFinaliza ? 1 : -1
        }
        return (a.prazo_conclusao || '').localeCompare(b.prazo_conclusao || '')
      })

      // Próxima providência aberta (finaliza !== true)
      const provAbertas = provs.filter((p) => !p.status?.finaliza)
      provAbertas.sort((a, b) => (a.prazo_conclusao || '').localeCompare(b.prazo_conclusao || ''))
      const proximaProvAberta = provAbertas[0] || null

      const respUsuario = usuariosMap.get(t.responsavel_usuario_id) || null
      const execUsuario = usuariosMap.get(t.executor_usuario_id) || null

      return {
        id: t.id,
        nome_controle_id: t.nome_controle_id,
        identificacao_caso: t.identificacao_caso,
        status_id: t.status_id,
        data_autorizacao: t.data_autorizacao,
        prazo_conclusao: t.prazo_conclusao,
        responsavel_usuario_id: t.responsavel_usuario_id,
        executor_usuario_id: t.executor_usuario_id,
        pasta_cliente: t.pasta_cliente,
        pasta_ricci: t.pasta_ricci,
        created_at: t.created_at,
        created_by: t.created_by,
        updated_at: t.updated_at,
        updated_by: t.updated_by,
        deleted_at: t.deleted_at,
        deleted_by: t.deleted_by,

        nome_controle: t.nome_controle_obj?.nome || null,
        responsavel_nome: respUsuario?.nome || null,
        executor_nome: execUsuario?.nome || null,
        status: t.status_obj || null,
        responsavel_usuario: respUsuario,
        executor_usuario: execUsuario,

        providencias: provsOrdenadas,
        proxima_providencia: proximaProvAberta,
      }
    })

    // 5. Ordenação padrão: data da próxima providência aberta em ordem crescente.
    controles.sort((a, b) => {
      const aData = a.proxima_providencia?.prazo_conclusao || null
      const bData = b.proxima_providencia?.prazo_conclusao || null

      if (aData && bData) {
        if (aData !== bData) {
          return aData.localeCompare(bData)
        }
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }

      if (aData && !bData) return -1
      if (!aData && bData) return 1

      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })

    return controles
  },

  async getControleById(
    id: string,
    usuariosParam?: TaskUsuarioAtivoRecord[],
  ): Promise<TaskControleRecord | null> {
    const { data: t, error } = await supabase
      .from('task_tarefas')
      .select(`
        *,
        nome_controle_obj:task_nomes_controle(id, nome),
        status_obj:task_status(id, codigo, nome, ordem, finaliza, ativo)
      `)
      .eq('id', id)
      .single()

    if (error || !t) {
      console.error('Erro ao buscar task_tarefas por id:', error)
      return null
    }

    let usuariosMap = new Map<string, TaskUsuarioAtivoRecord>()
    if (usuariosParam && usuariosParam.length > 0) {
      usuariosParam.forEach((u) => usuariosMap.set(u.id, u))
    } else {
      try {
        const users = await this.getUsuariosAtivos()
        users.forEach((u) => usuariosMap.set(u.id, u))
      } catch (err) {
        console.error('Aviso ao obter usuários para resolução de controle:', err)
      }
    }

    const provs = await this.getProvidencias(id)
    const provsOrdenadas = [...provs].sort((a, b) => {
      const aFinaliza = Boolean(a.status?.finaliza)
      const bFinaliza = Boolean(b.status?.finaliza)
      if (aFinaliza !== bFinaliza) {
        return aFinaliza ? 1 : -1
      }
      return (a.prazo_conclusao || '').localeCompare(b.prazo_conclusao || '')
    })
    const provAbertas = provs.filter((p) => !p.status?.finaliza)
    provAbertas.sort((a, b) => (a.prazo_conclusao || '').localeCompare(b.prazo_conclusao || ''))

    const raw: any = t
    const respUsuario = usuariosMap.get(raw.responsavel_usuario_id) || null
    const execUsuario = usuariosMap.get(raw.executor_usuario_id) || null

    return {
      id: raw.id,
      nome_controle_id: raw.nome_controle_id,
      identificacao_caso: raw.identificacao_caso,
      status_id: raw.status_id,
      data_autorizacao: raw.data_autorizacao,
      prazo_conclusao: raw.prazo_conclusao,
      responsavel_usuario_id: raw.responsavel_usuario_id,
      executor_usuario_id: raw.executor_usuario_id,
      pasta_cliente: raw.pasta_cliente,
      pasta_ricci: raw.pasta_ricci,
      created_at: raw.created_at,
      created_by: raw.created_by,
      updated_at: raw.updated_at,
      updated_by: raw.updated_by,
      deleted_at: raw.deleted_at,
      deleted_by: raw.deleted_by,

      nome_controle: raw.nome_controle_obj?.nome || null,
      responsavel_nome: respUsuario?.nome || null,
      executor_nome: execUsuario?.nome || null,
      status: raw.status_obj || null,
      responsavel_usuario: respUsuario,
      executor_usuario: execUsuario,

      providencias: provsOrdenadas,
      proxima_providencia: provAbertas[0] || null,
    }
  },

  async saveControle(
    input: SaveControleInput,
    usuariosParam?: TaskUsuarioAtivoRecord[],
  ): Promise<TaskControleRecord> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id || null

    const payload = {
      nome_controle_id: input.nome_controle_id,
      identificacao_caso: input.identificacao_caso.trim(),
      status_id: input.status_id,
      data_autorizacao: input.data_autorizacao || null,
      prazo_conclusao: input.prazo_conclusao || null,
      responsavel_usuario_id: input.responsavel_usuario_id,
      executor_usuario_id: input.executor_usuario_id,
      pasta_cliente: input.pasta_cliente?.trim() || null,
      pasta_ricci: input.pasta_ricci?.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    }

    if (input.id) {
      const { data, error } = await supabase
        .from('task_tarefas')
        .update(payload)
        .eq('id', input.id)
        .select()
        .single()

      if (error) {
        console.error('Erro ao atualizar task_tarefas:', error)
        throw error
      }
      const loaded = await this.getControleById(data.id, usuariosParam)
      return (loaded || data) as TaskControleRecord
    } else {
      const { data, error } = await supabase
        .from('task_tarefas')
        .insert({
          ...payload,
          created_by: userId,
        })
        .select()
        .single()

      if (error) {
        console.error('Erro ao criar task_tarefas:', error)
        throw error
      }
      const loaded = await this.getControleById(data.id, usuariosParam)
      return (loaded || data) as TaskControleRecord
    }
  },

  async archiveControle(id: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('task_tarefas')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao arquivar controle:', error)
      throw error
    }
  },

  async getControleUpdatedAt(id: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('task_tarefas')
      .select('updated_at')
      .eq('id', id)
      .single()

    if (error || !data) return null
    return data.updated_at
  },

  calculateMetrics(controles: TaskControleRecord[]): ControleMetrics {
    const total = controles.length
    let pendentes = 0
    let emAndamento = 0
    let prazosVencidos = 0
    let concluidos = 0

    const todayStr = getLocalDateStr()

    for (const c of controles) {
      const codigo = c.status?.codigo || ''
      const finaliza = Boolean(c.status?.finaliza)

      if (finaliza) {
        // Status final do Controle: Concluído (ordem 90) e Cancelado (ordem 99)
        concluidos++
      } else {
        // Controles abertos (não finalizados)
        if (codigo === 'pendente' || c.status?.nome?.toLowerCase() === 'pendente') {
          pendentes++
        } else if (codigo === 'em_andamento' || c.status?.nome?.toLowerCase() === 'em andamento') {
          emAndamento++
        }

        // Verifica se há prazo geral vencido ou providência aberta vencida
        const prazoGeral = c.prazo_conclusao ? c.prazo_conclusao.split('T')[0] : null
        const provData = c.proxima_providencia?.prazo_conclusao
          ? c.proxima_providencia.prazo_conclusao.split('T')[0]
          : null

        const prazoGeralVencido = prazoGeral ? prazoGeral < todayStr : false
        const provVencida = provData ? provData < todayStr : false

        if (prazoGeralVencido || provVencida) {
          prazosVencidos++
        }
      }
    }

    return {
      total,
      pendentes,
      emAndamento,
      prazosVencidos,
      concluidos,
    }
  },
}
