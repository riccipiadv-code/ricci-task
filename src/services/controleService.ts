import { supabase } from '@/lib/supabase/client'
import { getLocalDateStr } from '@/lib/formatters'
import {
  TaskControleRecord,
  TaskStatusRecord,
  TaskStatusProvidenciaRecord,
  TaskTipoPrazoRecord,
  TaskNomeControleRecord,
  TaskUsuarioAtivoRecord,
  TaskUsuarioRecord,
  SaveUsuarioInput,
  TaskProvidenciaRecord,
  SaveControleInput,
  SaveControleResult,
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
  // GESTÃO DE USUÁRIOS DO RICCI TASK (core_* como fonte central)
  // Única fonte para Responsável e Executor nos controles e providências
  // --------------------------------------------------------------------------
  /**
   * Retorna os usuários disponíveis para seleção em NOVOS Responsáveis e Executores:
   * Usa a função SQL RPC public.task_listar_usuarios_core_elegiveis() como ÚNICA fonte
   * de elegibilidade, retornando IDs centrais (core_usuarios.id), nomes e e-mails centrais
   * diretamente do Gestor de Acessos (core_*).
   *
   * Corte definitivo: NÃO consulta nem exige ponte em task_usuarios.
   * Fail-Closed estrito: se a RPC falhar, lança erro e bloqueia novas atribuições sem fallback.
   */
  async getUsuariosAtivos(): Promise<TaskUsuarioAtivoRecord[]> {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'task_listar_usuarios_core_elegiveis',
    )

    if (rpcError) {
      console.error('Falha na RPC task_listar_usuarios_core_elegiveis:', rpcError)
      throw new Error(
        rpcError.message ||
          'Falha técnica ao consultar usuários elegíveis no Gestor de Acessos. Novos vínculos estão temporariamente suspensos.',
      )
    }

    if (!rpcData || !Array.isArray(rpcData) || rpcData.length === 0) {
      return []
    }

    const lista: TaskUsuarioAtivoRecord[] = rpcData.map((item: any) => ({
      id: item.id, // ID Central definitivo
      nome: (item.nome || '').trim(),
      email: (item.email || '').trim().toLowerCase(),
      ativo: item.ativo ?? true,
      core_usuario_id: item.id,
      task_usuario_id: item.id, // retrocompatibilidade sem ponte
    }))

    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  },

  /**
   * Resolve e recupera nomes e e-mails centrais de usuários a partir de core_usuarios
   * (incluindo usuários centrais inativos referenciados por casos antigos).
   */
  async getCoreUsuariosByIds(
    ids: string[],
  ): Promise<Map<string, { id: string; nome: string; email: string; ativo: boolean }>> {
    const userMap = new Map<string, { id: string; nome: string; email: string; ativo: boolean }>()
    const validIds = Array.from(new Set(ids.filter(Boolean)))
    if (validIds.length === 0) return userMap

    try {
      const { data, error } = await supabase
        .from('core_usuarios')
        .select('id, nome, email, ativo')
        .in('id', validIds)

      if (error) {
        console.warn('Aviso ao consultar core_usuarios por IDs:', error)
      } else if (data) {
        for (const u of data) {
          userMap.set(u.id, {
            id: u.id,
            nome: (u.nome || '').trim(),
            email: (u.email || '').trim().toLowerCase(),
            ativo: Boolean(u.ativo),
          })
        }
      }
    } catch (err) {
      console.warn('Falha segura ao buscar usuários centrais por IDs:', err)
    }

    return userMap
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
          data_conclusao: input.data_conclusao !== undefined ? input.data_conclusao : null,
          email_alertas: input.email_alertas ?? false,
          email_alerta_inclusao: input.email_alerta_inclusao ?? false,
          email_alerta_atraso: input.email_alerta_atraso ?? false,
          email_alerta_atualizacao: input.email_alerta_atualizacao ?? false,
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
          data_conclusao: input.data_conclusao !== undefined ? input.data_conclusao : null,
          email_alertas: input.email_alertas ?? false,
          email_alerta_inclusao: input.email_alerta_inclusao ?? false,
          email_alerta_atraso: input.email_alerta_atraso ?? false,
          email_alerta_atualizacao: input.email_alerta_atualizacao ?? false,
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

  async updateProvidenciaStatus(
    id: string,
    statusId: string,
    dataConclusao?: string | null,
  ): Promise<TaskProvidenciaRecord> {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('task_providencias')
      .update({
        status_id: statusId,
        data_conclusao: dataConclusao !== undefined ? dataConclusao : null,
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
  // ESCOPO CENTRAL DE ACESSO A CONTROLES (ADMINISTRADOR / GESTOR / OPERACIONAL)
  // --------------------------------------------------------------------------
  /**
   * Avalia se um caso está dentro do escopo de acesso central do usuário logado:
   * - ADMINISTRADOR: tudo permitido.
   * - GESTOR: apenas casos próprios (responsável_core_usuario_id ou executor_core_usuario_id igual ao ID central do gestor).
   *   Ser gestor de um responsável ou executor NÃO dá mais acesso ao caso no Ricci Task.
   * - OPERACIONAL: apenas casos próprios (responsável_core_usuario_id ou executor_core_usuario_id).
   * Negativo quando identidade, perfil válido ou IDs centrais estiverem ausentes.
   */
  async checkControleAccessScope(
    controle: {
      responsavel_core_usuario_id?: string | null
      executor_core_usuario_id?: string | null
      responsavel_usuario_id?: string | null
      executor_usuario_id?: string | null
    },
    userPerfil: string | null,
    userCoreId: string | null,
  ): Promise<boolean> {
    if (!userPerfil || !userCoreId) return false
    const trimmedCoreId = userCoreId.trim()
    if (!trimmedCoreId) return false

    const perfilUpper = userPerfil.trim().toUpperCase()
    if (perfilUpper === 'ADMINISTRADOR') return true

    if (perfilUpper !== 'GESTOR' && perfilUpper !== 'OPERACIONAL') {
      return false
    }

    // Comparação exclusiva por IDs centrais (sem fallback para IDs legados)
    const respCore = controle.responsavel_core_usuario_id || null
    const execCore = controle.executor_core_usuario_id || null

    if (!respCore && !execCore) return false

    const isProprio = Boolean(
      (respCore && respCore === trimmedCoreId) || (execCore && execCore === trimmedCoreId),
    )

    return isProprio
  },

  /**
   * Filtra uma lista de controles aplicando o escopo central:
   * - ADMINISTRADOR: sem filtro (todos os casos)
   * - GESTOR: apenas casos próprios (responsavel_core_usuario_id ou executor_core_usuario_id igual a userCoreId)
   * - OPERACIONAL: apenas casos próprios (responsavel_core_usuario_id ou executor_core_usuario_id igual a userCoreId)
   * Negativo/vazio quando identidade ou perfil válido estiverem ausentes.
   */
  async applyAccessScopeToControles(
    controles: TaskControleRecord[],
    userPerfil: string | null,
    userCoreId: string | null,
  ): Promise<TaskControleRecord[]> {
    if (!userPerfil || !userCoreId) return []
    const trimmedCoreId = userCoreId.trim()
    if (!trimmedCoreId) return []

    const perfilUpper = userPerfil.trim().toUpperCase()
    if (perfilUpper === 'ADMINISTRADOR') {
      return controles
    }

    if (perfilUpper === 'OPERACIONAL' || perfilUpper === 'GESTOR') {
      return controles.filter((c) => {
        const respCore = c.responsavel_core_usuario_id || null
        const execCore = c.executor_core_usuario_id || null
        return respCore === trimmedCoreId || execCore === trimmedCoreId
      })
    }

    return []
  },

  // --------------------------------------------------------------------------
  // LISTAGEM PRINCIPAL DE CONTROLES (task_tarefas)
  // Resolvendo responsáveis e executores diretamente por IDs centrais em core_usuarios
  // --------------------------------------------------------------------------
  async getControles(
    usuariosParam?: TaskUsuarioAtivoRecord[],
    scopeUser?: { perfil: string | null; coreUserId: string | null },
  ): Promise<TaskControleRecord[]> {
    const list = await this.fetchControlesList({ apenasArquivados: false }, usuariosParam)
    if (scopeUser && scopeUser.perfil && scopeUser.coreUserId) {
      return this.applyAccessScopeToControles(list, scopeUser.perfil, scopeUser.coreUserId)
    }
    return list
  },

  async getControlesArquivados(
    usuariosParam?: TaskUsuarioAtivoRecord[],
    scopeUser?: { perfil: string | null; coreUserId: string | null },
  ): Promise<TaskControleRecord[]> {
    const list = await this.fetchControlesList({ apenasArquivados: true }, usuariosParam)
    if (scopeUser && scopeUser.perfil && scopeUser.coreUserId) {
      return this.applyAccessScopeToControles(list, scopeUser.perfil, scopeUser.coreUserId)
    }
    return list
  },

  async fetchControlesList(
    options: { apenasArquivados: boolean },
    usuariosParam?: TaskUsuarioAtivoRecord[],
  ): Promise<TaskControleRecord[]> {
    // 1. Consulta parte de public.task_tarefas com LEFT JOINs opcionais (sem !inner).
    let query = supabase.from('task_tarefas').select(`
        *,
        nome_controle_obj:task_nomes_controle(id, nome),
        status_obj:task_status(id, codigo, nome, ordem, finaliza, ativo)
      `)

    if (options.apenasArquivados) {
      query = query.not('arquivado_at', 'is', null).order('arquivado_at', { ascending: false })
    } else {
      query = query.is('arquivado_at', null)
    }

    const { data: tarefasRaw, error: tarefasError } = await query

    if (tarefasError) {
      console.error('Erro ao buscar task_tarefas:', tarefasError)
      throw tarefasError
    }

    if (!tarefasRaw || tarefasRaw.length === 0) {
      return []
    }

    const tarefaIds = tarefasRaw.map((t) => t.id)

    // 2. Busca providências associadas aos controles de forma resiliente
    const provsByTarefa: Record<string, TaskProvidenciaRecord[]> = {}
    try {
      const { data: providenciasRaw, error: provError } = await supabase
        .from('task_providencias')
        .select(`
          *,
          tipo_prazo:task_tipos_prazo(*),
          status:task_status_providencia(*)
        `)
        .in('tarefa_id', tarefaIds)
        .order('prazo_conclusao', { ascending: true })
        .order('ordem', { ascending: true })

      if (!provError && providenciasRaw) {
        for (const p of providenciasRaw as unknown as TaskProvidenciaRecord[]) {
          if (!provsByTarefa[p.tarefa_id]) {
            provsByTarefa[p.tarefa_id] = []
          }
          provsByTarefa[p.tarefa_id].push(p)
        }
      }
    } catch (provErr) {
      console.error('Aviso ao buscar providências dos controles:', provErr)
    }

    // 3. Monta mapa de resolução de usuários pelos IDs centrais
    const usuariosMap = new Map<
      string,
      { id: string; nome: string; email?: string; ativo?: boolean }
    >()
    if (usuariosParam && usuariosParam.length > 0) {
      usuariosParam.forEach((u) => usuariosMap.set(u.id, u))
    }

    // Identifica quais IDs centrais precisam ser resolvidos em core_usuarios
    // (incluindo usuários centrais inativos referenciados por casos antigos)
    const neededCoreIds = new Set<string>()
    for (const t of tarefasRaw) {
      const respCore = t.responsavel_core_usuario_id || t.responsavel_usuario_id
      const execCore = t.executor_core_usuario_id || t.executor_usuario_id
      if (respCore && !usuariosMap.has(respCore)) neededCoreIds.add(respCore)
      if (execCore && !usuariosMap.has(execCore)) neededCoreIds.add(execCore)
    }

    if (neededCoreIds.size > 0) {
      const fetchedCoreUsers = await this.getCoreUsuariosByIds(Array.from(neededCoreIds))
      for (const [id, u] of fetchedCoreUsers.entries()) {
        usuariosMap.set(id, u)
      }
    }

    // 4. Monta o modelo hidratado com IDs centrais prioritários
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

      const respCoreId = t.responsavel_core_usuario_id || t.responsavel_usuario_id
      const execCoreId = t.executor_core_usuario_id || t.executor_usuario_id

      const respUsuario = respCoreId ? usuariosMap.get(respCoreId) || null : null
      const execUsuario = execCoreId ? usuariosMap.get(execCoreId) || null : null

      return {
        id: t.id,
        nome_controle_id: t.nome_controle_id,
        numero_caso: Number(t.numero_caso ?? 0),
        identificacao_caso: t.identificacao_caso,
        status_id: t.status_id,
        data_autorizacao: t.data_autorizacao,
        prazo_conclusao: t.prazo_conclusao,
        responsavel_usuario_id: t.responsavel_usuario_id || respCoreId,
        executor_usuario_id: t.executor_usuario_id || execCoreId,
        responsavel_core_usuario_id: respCoreId,
        executor_core_usuario_id: execCoreId,
        pasta_cliente: t.pasta_cliente,
        pasta_ricci: t.pasta_ricci,
        created_at: t.created_at,
        created_by: t.created_by,
        updated_at: t.updated_at,
        updated_by: t.updated_by,
        deleted_at: t.deleted_at,
        deleted_by: t.deleted_by,
        arquivado_at: t.arquivado_at || null,

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

    // 5. Ordenação:
    // Para arquivados: arquivado_at decrescente
    // Para a lista principal: data da próxima providência aberta em ordem crescente
    if (options.apenasArquivados) {
      controles.sort((a, b) => {
        const dataA = a.arquivado_at ? new Date(a.arquivado_at).getTime() : 0
        const dataB = b.arquivado_at ? new Date(b.arquivado_at).getTime() : 0
        if (dataA !== dataB) {
          return dataB - dataA
        }
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      })
    } else {
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
    }

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

    const raw: any = t
    const respCoreId = raw.responsavel_core_usuario_id || raw.responsavel_usuario_id
    const execCoreId = raw.executor_core_usuario_id || raw.executor_usuario_id

    const usuariosMap = new Map<string, TaskUsuarioAtivoRecord>()
    if (usuariosParam && usuariosParam.length > 0) {
      usuariosParam.forEach((u) => usuariosMap.set(u.id, u))
    }

    const missingIds: string[] = []
    if (respCoreId && !usuariosMap.has(respCoreId)) missingIds.push(respCoreId)
    if (execCoreId && !usuariosMap.has(execCoreId)) missingIds.push(execCoreId)

    if (missingIds.length > 0) {
      const fetched = await this.getCoreUsuariosByIds(missingIds)
      for (const [uid, u] of fetched.entries()) {
        usuariosMap.set(uid, {
          id: u.id,
          nome: u.nome,
          email: u.email,
          ativo: u.ativo,
          core_usuario_id: u.id,
        })
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

    const respUsuario = respCoreId ? usuariosMap.get(respCoreId) || null : null
    const execUsuario = execCoreId ? usuariosMap.get(execCoreId) || null : null

    return {
      id: raw.id,
      nome_controle_id: raw.nome_controle_id,
      numero_caso: Number(raw.numero_caso ?? 0),
      identificacao_caso: raw.identificacao_caso,
      status_id: raw.status_id,
      data_autorizacao: raw.data_autorizacao,
      prazo_conclusao: raw.prazo_conclusao,
      responsavel_usuario_id: raw.responsavel_usuario_id || respCoreId,
      executor_usuario_id: raw.executor_usuario_id || execCoreId,
      responsavel_core_usuario_id: respCoreId,
      executor_core_usuario_id: execCoreId,
      pasta_cliente: raw.pasta_cliente,
      pasta_ricci: raw.pasta_ricci,
      created_at: raw.created_at,
      created_by: raw.created_by,
      updated_at: raw.updated_at,
      updated_by: raw.updated_by,
      deleted_at: raw.deleted_at,
      deleted_by: raw.deleted_by,
      arquivado_at: raw.arquivado_at || null,

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

  /**
   * PONTO 1 & PONTO 2: Salvamento Atômico e Eliminação Total de Sucesso Presumido.
   * Realiza a gravação do caso, de sua atribuição e das providências em UMA ÚNICA TRANSAÇÃO no servidor
   * autorizada pelo estado anterior do caso (task_salvar_controle_transacional).
   * Se o editor perder o acesso após a transição, a transação conclui atomicamente e retorna os
   * dados efetivamente gravados pelo banco (sem fabricar snapshot local e sem UPDATE de zero linhas).
   */
  async saveControleTransacional(
    input: SaveControleInput,
    usuariosParam?: TaskUsuarioAtivoRecord[],
    callerPerfil?: string | null,
  ): Promise<SaveControleResult> {
    // Autoridade definitiva: IDs CENTRAIS (core_usuarios.id)
    const targetRespCoreId = input.responsavel_core_usuario_id || input.responsavel_usuario_id
    const targetExecCoreId = input.executor_core_usuario_id || input.executor_usuario_id

    if (!targetRespCoreId) {
      throw new Error(
        'Gravação bloqueada: o Responsável selecionado não possui ID central válido no Gestor de Acessos.',
      )
    }
    if (!targetExecCoreId) {
      throw new Error(
        'Gravação bloqueada: o Executor selecionado não possui ID central válido no Gestor de Acessos.',
      )
    }

    // Se for edição (input.id presente), consultamos o registro anterior primeiro (fail-closed)
    // para detecção de alteração real antes de executar qualquer operação.
    let existingRecord: any = null
    if (input.id) {
      const { data: existingData, error: existingErr } = await supabase
        .from('task_tarefas')
        .select(`
          id,
          nome_controle_id,
          numero_caso,
          identificacao_caso,
          status_id,
          data_autorizacao,
          prazo_conclusao,
          responsavel_usuario_id,
          executor_usuario_id,
          responsavel_core_usuario_id,
          executor_core_usuario_id,
          pasta_cliente,
          pasta_ricci,
          updated_at,
          arquivado_at
        `)
        .eq('id', input.id)
        .single()

      if (existingErr || !existingData) {
        console.error(
          'Falha ao consultar registro anterior de task_tarefas para checagem de alteração:',
          existingErr,
        )
        throw new Error(
          'Gravação bloqueada: não foi possível carregar os dados anteriores do controle para validação.',
        )
      }
      existingRecord = existingData
    }

    const isCallerAdmin = callerPerfil?.toUpperCase() === 'ADMINISTRADOR'

    // Proteção de prazo_conclusao do caso por perfil:
    // Administrador: pode editar prazo_conclusao normalmente.
    // Gestor e Operacional: não podem alterar prazo_conclusao; em edição, preserva estritamente o valor do banco.
    let finalPrazoConclusao = input.prazo_conclusao || null
    if (!isCallerAdmin && input.id && existingRecord) {
      finalPrazoConclusao = existingRecord.prazo_conclusao || null
    }

    // Monta dados do caso para a RPC
    const dadosCaso: any = {
      nome_controle_id: input.nome_controle_id,
      identificacao_caso: input.identificacao_caso.trim(),
      status_id: input.status_id,
      data_autorizacao: input.data_autorizacao || null,
      prazo_conclusao: finalPrazoConclusao,
      responsavel_core_usuario_id: targetRespCoreId,
      executor_core_usuario_id: targetExecCoreId,
      responsavel_usuario_id: input.responsavel_usuario_id || null,
      executor_usuario_id: input.executor_usuario_id || null,
      pasta_cliente: input.pasta_cliente?.trim() || null,
      pasta_ricci: input.pasta_ricci?.trim() || null,
    }

    // Se o chamador não for ADMINISTRADOR, busca os valores existentes no banco
    // para garantir proteção contra adulteração manual de data_conclusao no payload da RPC.
    // Em edição, preserva estritamente o valor do banco; na criação por não-admin, não permite definição manual (envia null).
    let dbProvidenciasMap: Map<string, string | null> | null = null

    if (!isCallerAdmin && input.id && input.providencias && input.providencias.length > 0) {
      const provIdsWithId = input.providencias.map((p) => p.id).filter(Boolean) as string[]
      if (provIdsWithId.length > 0) {
        try {
          const { data: dbProvs } = await supabase
            .from('task_providencias')
            .select('id, data_conclusao')
            .in('id', provIdsWithId)
          if (dbProvs) {
            dbProvidenciasMap = new Map(
              dbProvs.map((dp: any) => [
                dp.id,
                dp.data_conclusao ? dp.data_conclusao.split('T')[0] : null,
              ]),
            )
          }
        } catch (fetchErr) {
          console.warn('Aviso: falha ao verificar valores anteriores de data_conclusao:', fetchErr)
        }
      }
    }

    // Lista de providências para envio à transação (preservando temp_id para correlação explícita)
    const providenciasPayload = (input.providencias || []).map((p) => {
      let finalDataConclusao = p.data_conclusao || null
      if (!isCallerAdmin) {
        if (p.id) {
          // Em edição por não-administrador: preserva o valor existente no banco
          if (dbProvidenciasMap && dbProvidenciasMap.has(p.id)) {
            finalDataConclusao = dbProvidenciasMap.get(p.id) ?? null
          }
        } else {
          // Na criação por não-administrador: não permite definição manual
          finalDataConclusao = null
        }
      }

      return {
        id: p.id || null,
        temp_id: (p as any).temp_id || (p as any).tempId || null,
        providencia: p.providencia.trim(),
        prazo_conclusao: p.prazo_conclusao,
        tipo_prazo_id: p.tipo_prazo_id,
        status_id: p.status_id,
        ordem: p.ordem ?? 0,
        data_conclusao: finalDataConclusao,
        email_alertas: p.email_alertas ?? false,
        email_alerta_inclusao: p.email_alerta_inclusao ?? false,
        email_alerta_atraso: p.email_alerta_atraso ?? false,
        email_alerta_atualizacao: p.email_alerta_atualizacao ?? false,
      }
    })

    // Chamada à RPC transacional única no servidor (all-or-nothing)
    const { data: rpcRaw, error: rpcErr } = await (supabase.rpc as any)(
      'task_salvar_controle_transacional',
      {
        p_tarefa_id: input.id || null,
        p_dados_caso: dadosCaso,
        p_providencias: providenciasPayload,
        p_motivo: input.motivo_transicao || 'Salvar controle de caso',
      },
    )

    if (rpcErr) {
      console.error('Falha na RPC task_salvar_controle_transacional:', rpcErr)
      throw new Error(
        rpcErr.message ||
          'Falha transacional ao salvar controle no banco de dados. Todas as alterações foram desfeitas.',
      )
    }

    const rpcResult = typeof rpcRaw === 'string' ? JSON.parse(rpcRaw) : rpcRaw
    if (!rpcResult || rpcResult.success !== true) {
      throw new Error('Falha na confirmação do salvamento transacional pelo servidor.')
    }

    // Eliminação do sucesso presumido: os dados retornados DEVEM vir do banco
    const savedCasoDb = rpcResult.caso
    if (!savedCasoDb || !savedCasoDb.id || !savedCasoDb.updated_at) {
      throw new Error(
        'Falha na confirmação do salvamento: o servidor não retornou os dados reais gravados do caso.',
      )
    }

    const tarefaId = savedCasoDb.id
    const transicaoId = rpcResult.transicao_id || null
    const perdaAcesso = Boolean(rpcResult.perda_acesso)
    const provsDb = rpcResult.providencias || []
    const eventosProvidencias = Array.isArray(rpcResult.eventos_providencias)
      ? rpcResult.eventos_providencias
      : []

    // Notifica auto-arquivamento se status finalizou
    if (savedCasoDb.arquivado_at && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ricci:controles-changed', {
          detail: { action: 'auto-archive', controleId: tarefaId },
        }),
      )
    }

    // Tentativa de releitura hidratada completa (se o usuário ainda tiver acesso via RLS)
    let fullyLoaded: TaskControleRecord | null = null
    if (!perdaAcesso) {
      try {
        fullyLoaded = await this.getControleById(tarefaId, usuariosParam)
      } catch (loadErr) {
        console.warn('Aviso ao reler controle gravado:', loadErr)
      }
    }

    // Se houve perda de acesso ou releitura não retornou, monta a estrutura a partir dos
    // DADOS REAIS EFETIVAMENTE RETORNADOS PELO BANCO (nunca snapshot local fabricado)
    let finalControle: TaskControleRecord
    if (fullyLoaded) {
      finalControle = fullyLoaded
    } else {
      // Hidrata com catálogos conhecidos mantendo os dados exatos do banco
      const statusFinal = usuariosParam ? null : null
      finalControle = {
        ...savedCasoDb,
        numero_caso: Number(savedCasoDb.numero_caso ?? 0),
        providencias: provsDb,
      } as TaskControleRecord
    }

    return {
      controle: finalControle,
      transicao_id: transicaoId,
      perda_acesso: perdaAcesso,
      providencias: provsDb,
      eventos_providencias: eventosProvidencias,
    }
  },

  async saveControle(
    input: SaveControleInput,
    usuariosParam?: TaskUsuarioAtivoRecord[],
    callerPerfil?: string | null,
  ): Promise<TaskControleRecord> {
    const result = await this.saveControleTransacional(input, usuariosParam, callerPerfil)
    return result.controle
  },

  /**
   * Alias de getProvidencias para clareza
   */
  async getProvidenciasByControleId(tarefaId: string): Promise<TaskProvidenciaRecord[]> {
    return this.getProvidencias(tarefaId)
  },

  /**
   * Localiza o status de Controle "Concluído" pelo código, aceitando as variações
   * 'concluido' e 'concluida' (nunca pelo texto exibido).
   */
  async getStatusControleConcluido(): Promise<TaskStatusRecord | null> {
    const { data, error } = await supabase
      .from('task_status')
      .select('*')
      .in('codigo', ['concluido', 'concluida'])
      .eq('ativo', true)
      .limit(1)

    if (error) {
      console.error('Erro ao buscar status de controle concluído:', error)
      throw error
    }
    return data && data[0] ? (data[0] as TaskStatusRecord) : null
  },

  /**
   * Encerra um Controle em UMA ÚNICA OPERAÇÃO:
   * status_id = Concluído (ou outro finalizador informado), arquivado_at = data/hora atual,
   * updated_at e updated_by. Não usa delete().
   */
  async encerrarControle(controleId: string, statusId?: string): Promise<TaskControleRecord> {
    if (!controleId) {
      throw new Error('ID do controle não informado para encerramento.')
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id || null

    let finalStatusId = statusId
    if (!finalStatusId) {
      const statusConcluido = await this.getStatusControleConcluido()
      if (!statusConcluido) {
        throw new Error('Status "Concluído" de Controle não foi localizado no catálogo.')
      }
      finalStatusId = statusConcluido.id
    }

    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('task_tarefas')
      .update({
        status_id: finalStatusId,
        arquivado_at: nowIso,
        updated_at: nowIso,
        updated_by: userId,
      })
      .eq('id', controleId)
      .select()
      .single()

    if (error) {
      console.error('Erro ao encerrar controle no Supabase:', error)
      throw error
    }

    if (!data) {
      const noRowError = new Error('Nenhuma linha foi retornada após encerrar o controle.')
      console.error(noRowError)
      throw noRowError
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ricci:controles-changed', {
          detail: { action: 'encerrar', controleId },
        }),
      )
    }

    const fullyLoaded = await this.getControleById(controleId)
    return (fullyLoaded || data) as TaskControleRecord
  },

  async archiveControle(id: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('task_tarefas')
      .update({
        arquivado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao arquivar controle:', error)
      throw error
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ricci:controles-changed', {
          detail: { action: 'archive', controleId: id },
        }),
      )
    }
  },

  async unarchiveControle(id: string): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('task_tarefas')
      .update({
        arquivado_at: null,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao desarquivar controle:', error)
      throw error
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ricci:controles-changed', {
          detail: { action: 'unarchive', controleId: id },
        }),
      )
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

  /**
   * Notifica a atribuição de uma tarefa/caso via Edge Function (notify-task-assignment).
   * A função backend consulta todos os dados e dispara por e-mail com idempotência e segurança.
   */
  async notifyAssignment(
    tarefaId: string,
    tipo: 'nova_atribuicao' | 'alteracao_atribuicao' | 'atribuicao',
    transicaoId?: string | null,
  ): Promise<{
    success: boolean
    sent?: boolean
    reason?: string
    error?: string
    message?: string
  }> {
    return this.invokeTaskEmailNotification({
      tarefa_id: tarefaId,
      tipo,
      transicao_id: transicaoId || undefined,
    })
  },

  /**
   * Notifica a inclusão de uma nova providência com alertas ativos via Edge Function.
   */
  async notifyProvidenciaInclusao(
    tarefaId: string,
    providenciaId: string,
  ): Promise<{
    success: boolean
    sent?: boolean
    reason?: string
    error?: string
    message?: string
  }> {
    return this.invokeTaskEmailNotification({
      tarefa_id: tarefaId,
      providencia_id: providenciaId,
      tipo: 'providencia_inclusao',
    })
  },

  /**
   * Notifica a atualização relevante de uma providência com alertas ativos via Edge Function.
   */
  async notifyProvidenciaAtualizacao(
    tarefaId: string,
    providenciaId: string,
  ): Promise<{
    success: boolean
    sent?: boolean
    reason?: string
    error?: string
    message?: string
  }> {
    return this.invokeTaskEmailNotification({
      tarefa_id: tarefaId,
      providencia_id: providenciaId,
      tipo: 'providencia_atualizacao',
    })
  },

  /**
   * Disparo genérico e seguro de notificações por e-mail do Ricci Task.
   */
  async invokeTaskEmailNotification(payload: {
    tarefa_id: string
    providencia_id?: string
    tipo:
      | 'nova_atribuicao'
      | 'alteracao_atribuicao'
      | 'atribuicao'
      | 'providencia_inclusao'
      | 'providencia_atualizacao'
    transicao_id?: string
  }): Promise<{
    success: boolean
    sent?: boolean
    reason?: string
    error?: string
    message?: string
  }> {
    try {
      const { data, error } = await supabase.functions.invoke('notify-task-assignment', {
        body: payload,
      })

      if (error) {
        let detailedError = error.message || 'Erro ao invocar função de notificação.'
        // Supabase FunctionsHttpError pode carregar contexto em error.context
        if ((error as any)?.context?.json) {
          try {
            const parsedContext = await (error as any).context.json()
            if (parsedContext?.error) {
              detailedError = `${detailedError} [Edge Function: ${parsedContext.error}]`
            }
          } catch {
            // Contexto não pôde ser parseado como JSON
          }
        }
        console.error(
          'Erro na chamada da Edge Function notify-task-assignment:',
          detailedError,
          error,
        )
        return {
          success: false,
          sent: false,
          error: detailedError,
        }
      }

      return {
        success: data?.success ?? true,
        sent: data?.sent ?? false,
        reason: data?.reason,
        message: data?.message,
        error: data?.error,
      }
    } catch (err: any) {
      console.error('Falha de rede ou execução ao notificar Ricci Task:', err)
      return {
        success: false,
        sent: false,
        error: err?.message || 'Falha ao conectar com o serviço de notificação.',
      }
    }
  },

  /**
   * Executa a rotina de alertas diários de providências atrasadas via Edge Function (notify-task-overdue).
   * Processa com idempotência diária na tabela task_email_eventos.
   */
  async triggerOverdueNotifications(): Promise<{
    success: boolean
    message?: string
    processed?: number
    sent?: number
    skipped?: number
    errors?: number
    error?: string
  }> {
    try {
      const { data, error } = await supabase.functions.invoke('notify-task-overdue', {
        body: {},
      })

      if (error) {
        console.error('Erro na chamada da Edge Function notify-task-overdue:', error)
        return {
          success: false,
          error: error.message || 'Erro ao invocar rotina de alertas de atraso.',
        }
      }

      return {
        success: data?.success ?? true,
        message: data?.message,
        processed: data?.processed ?? 0,
        sent: data?.sent ?? 0,
        skipped: data?.skipped ?? 0,
        errors: data?.errors ?? 0,
        error: data?.error,
      }
    } catch (err: any) {
      console.error('Falha de rede ou execução ao processar providências atrasadas:', err)
      return {
        success: false,
        error: err?.message || 'Falha ao conectar com o serviço de alertas de atraso.',
      }
    }
  },
}
