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
  // GESTÃO DE USUÁRIOS DO RICCI TASK (task_usuarios)
  // Única fonte para Responsável e Executor nos controles e providências
  // --------------------------------------------------------------------------
  /**
   * Retorna os usuários disponíveis para seleção em NOVOS Responsáveis e Executores:
   * Usa a função SQL RPC public.task_listar_usuarios_elegiveis() para listar e provisionar
   * candidatos elegíveis validados centralmente no Gestor de Acessos Ricci (sistema RICCI_TASK).
   *
   * Fail-Closed estrito: se a RPC falhar, lança erro para a interface e NÃO oferece candidatos
   * não validados, nem recorre ao cadastro local.
   *
   * Preserva task_usuarios.id retornado pela RPC como vínculo operacional das tarefas.
   * Apresenta nome e e-mail centrais validados quando disponíveis.
   * Ordenado alfabeticamente por nome.
   */
  async getUsuariosAtivos(): Promise<TaskUsuarioAtivoRecord[]> {
    // 1. Chama a RPC para provisionar e listar os IDs operacionais elegíveis
    const { data: rpcData, error: rpcError } = await supabase.rpc('task_listar_usuarios_elegiveis')

    if (rpcError) {
      console.error('Falha na RPC task_listar_usuarios_elegiveis:', rpcError)
      throw new Error(
        rpcError.message ||
          'Falha técnica ao consultar usuários elegíveis no Gestor de Acessos. Novos vínculos estão temporariamente suspensos.',
      )
    }

    if (!rpcData || !Array.isArray(rpcData) || rpcData.length === 0) {
      return []
    }

    // 2. Consulta complementar às tabelas centrais via cliente Supabase (leitura apenas):
    // Resolve e exibe o NOME e E-MAIL atuais de core_usuarios via vínculo task_usuarios.core_usuario_id.
    // Se a leitura central falhar, NÃO apresenta dados locais como se fossem atuais (fail-closed estrito).
    const taskIds = rpcData.map((item: any) => item.id).filter(Boolean)

    const { data: bridgedUsers, error: bridgeError } = await supabase
      .from('task_usuarios')
      .select(`
        id,
        ativo,
        core_usuario_id,
        core_usuarios!inner(id, nome, email, ativo)
      `)
      .in('id', taskIds)

    if (bridgeError) {
      console.error('Falha técnica ao consultar dados centrais de core_usuarios:', bridgeError)
      throw new Error(
        'Falha técnica ao carregar dados centrais dos usuários (core_usuarios). Novos vínculos estão temporariamente suspensos.',
      )
    }

    const centralMap = new Map<string, { nome: string; email: string; ativo: boolean }>()
    for (const b of bridgedUsers || []) {
      const cu = (b as any).core_usuarios
      if (cu && cu.email) {
        centralMap.set(b.id, {
          nome: cu.nome || '',
          email: cu.email || '',
          ativo: Boolean(b.ativo && cu.ativo),
        })
      }
    }

    // Validação estrita (Fail-Closed):
    // TODOS os IDs retornados pela RPC devem ser resolvidos com nome, e-mail e situação central válidos.
    // Se a leitura vier parcial ou vazia (por exemplo por restrição de RLS ou falha silenciosa sem erro HTTP),
    // deve ser tratada como falha de validação, não oferecendo lista parcial nem usando dados locais como substituto.
    const idsNaoResolvidos = taskIds.filter((id: string) => {
      const c = centralMap.get(id)
      return !c || !c.nome || !c.nome.trim() || !c.email || !c.email.trim()
    })

    if (idsNaoResolvidos.length > 0) {
      console.error(
        `Falha de validação central: ${idsNaoResolvidos.length} de ${taskIds.length} usuários elegíveis não foram resolvidos em core_usuarios (retorno parcial/vazio via RLS sem erro HTTP):`,
        idsNaoResolvidos,
      )
      throw new Error(
        'Falha na validação central de usuários elegíveis: retorno parcial ou incompleto do Gestor de Acessos. Novos vínculos estão temporariamente suspensos.',
      )
    }

    // Monta a lista elegível usando EXCLUSIVAMENTE nome e e-mail centrais validados,
    // preservando o vínculo operacional task_usuarios.id e o ID central core_usuario_id
    const lista: TaskUsuarioAtivoRecord[] = []
    for (const item of rpcData) {
      const central = centralMap.get(item.id)!
      const bridged = (bridgedUsers || []).find((b: any) => b.id === item.id)
      const coreUsuarioId =
        (bridged as any)?.core_usuario_id || (bridged as any)?.core_usuarios?.id || null
      lista.push({
        id: item.id,
        nome: central.nome.trim(),
        email: central.email.trim().toLowerCase(),
        ativo: central.ativo,
        core_usuario_id: coreUsuarioId,
      })
    }

    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  },

  /**
   * Retorna todos os usuários de task_usuarios (ativos e inativos), usando exclusivamente
   * task_usuarios.select('id, nome, email, ativo').
   */
  async getTodosUsuarios(): Promise<TaskUsuarioRecord[]> {
    const { data, error } = await supabase
      .from('task_usuarios')
      .select('id, nome, email, ativo, core_usuario_id')
      .order('nome', { ascending: true })

    if (error) {
      console.error('Erro ao listar task_usuarios:', error)
      throw new Error('Falha ao listar usuários do sistema.')
    }

    return (data || []) as TaskUsuarioRecord[]
  },

  /**
   * Cadastra ou atualiza um usuário em task_usuarios.
   */
  async saveUsuario(input: SaveUsuarioInput): Promise<TaskUsuarioRecord> {
    const cleanNome = input.nome.trim()
    const cleanEmail = input.email.trim().toLowerCase()

    if (!cleanNome) {
      throw new Error('O Nome do usuário é obrigatório.')
    }
    if (!cleanEmail) {
      throw new Error('O E-mail do usuário é obrigatório.')
    }

    const payload = {
      nome: cleanNome,
      email: cleanEmail,
      ativo: input.ativo !== undefined ? input.ativo : true,
      updated_at: new Date().toISOString(),
    }

    if (input.id) {
      const { data, error } = await supabase
        .from('task_usuarios')
        .update(payload)
        .eq('id', input.id)
        .select('id, nome, email, ativo')
        .single()

      if (error) {
        console.error('Erro ao atualizar task_usuarios:', error)
        throw error
      }
      return data as TaskUsuarioRecord
    } else {
      const { data, error } = await supabase
        .from('task_usuarios')
        .insert({
          ...payload,
        })
        .select('id, nome, email, ativo')
        .single()

      if (error) {
        console.error('Erro ao criar task_usuarios:', error)
        throw error
      }
      return data as TaskUsuarioRecord
    }
  },

  /**
   * Altera exclusivamente o campo 'ativo' de um registro em task_usuarios.
   */
  async toggleUsuarioAtivo(id: string, novoAtivo: boolean): Promise<void> {
    const { error } = await supabase
      .from('task_usuarios')
      .update({
        ativo: novoAtivo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao atualizar ativo em task_usuarios:', error)
      throw new Error('Não foi possível alterar a situação do usuário no Ricci Task.')
    }
  },

  /**
   * Exclui fisicamente um usuário do Ricci Task.
   * Se o usuário estiver vinculado a controles (FK violation), lança erro específico.
   */
  async deleteUsuario(id: string): Promise<void> {
    const { error } = await supabase.from('task_usuarios').delete().eq('id', id)

    if (error) {
      console.error('Erro ao excluir task_usuarios:', error)
      throw error
    }
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
  // LISTAGEM PRINCIPAL DE CONTROLES (task_tarefas)
  // Resolvendo responsáveis e executores a partir de task_usuarios
  // --------------------------------------------------------------------------
  async getControles(usuariosParam?: TaskUsuarioAtivoRecord[]): Promise<TaskControleRecord[]> {
    return this.fetchControlesList({ apenasArquivados: false }, usuariosParam)
  },

  async getControlesArquivados(
    usuariosParam?: TaskUsuarioAtivoRecord[],
  ): Promise<TaskControleRecord[]> {
    return this.fetchControlesList({ apenasArquivados: true }, usuariosParam)
  },

  async fetchControlesList(
    options: { apenasArquivados: boolean },
    usuariosParam?: TaskUsuarioAtivoRecord[],
  ): Promise<TaskControleRecord[]> {
    // 1. Garante que temos um mapa de usuários para resolver os nomes de responsáveis e executores.
    // Se falhar ou vier vazio, mantemos mapa vazio para não interromper a busca de task_tarefas.
    let usuariosMap = new Map<string, { id: string; nome: string; email?: string }>()
    if (usuariosParam && usuariosParam.length > 0) {
      usuariosParam.forEach((u) => usuariosMap.set(u.id, u))
    } else {
      try {
        const allUsers = await this.getTodosUsuarios()
        allUsers.forEach((u) => usuariosMap.set(u.id, { id: u.id, nome: u.nome, email: u.email }))
      } catch (err) {
        console.error(
          'Aviso ao obter usuários para resolução de controles (usando lista vazia):',
          err,
        )
      }
    }

    // 2. Consulta parte de public.task_tarefas com LEFT JOINs opcionais (sem !inner).
    // Para a lista principal: exclusivamente .is('arquivado_at', null).
    // Para controles arquivados: exclusivamente .not('arquivado_at', 'is', null).order('arquivado_at', { ascending: false }).
    // Não aplica filtros implícitos de status, prazo, providência, deleted_at, responsável ou executor.
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

    // 3. Busca providências associadas aos controles de forma resiliente
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

    // 4. Monta o modelo hidratado (tolerante a ausência de relacionamentos)
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

      const respUsuario = t.responsavel_usuario_id
        ? usuariosMap.get(t.responsavel_usuario_id) || null
        : null
      const execUsuario = t.executor_usuario_id
        ? usuariosMap.get(t.executor_usuario_id) || null
        : null

      return {
        id: t.id,
        nome_controle_id: t.nome_controle_id,
        numero_caso: Number(t.numero_caso ?? 0),
        identificacao_caso: t.identificacao_caso,
        status_id: t.status_id,
        data_autorizacao: t.data_autorizacao,
        prazo_conclusao: t.prazo_conclusao,
        responsavel_usuario_id: t.responsavel_usuario_id,
        executor_usuario_id: t.executor_usuario_id,
        responsavel_core_usuario_id: t.responsavel_core_usuario_id || null,
        executor_core_usuario_id: t.executor_core_usuario_id || null,
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

    let usuariosMap = new Map<string, TaskUsuarioAtivoRecord>()
    if (usuariosParam && usuariosParam.length > 0) {
      usuariosParam.forEach((u) => usuariosMap.set(u.id, u))
    } else {
      try {
        const allUsers = await this.getTodosUsuarios()
        allUsers.forEach((u) =>
          usuariosMap.set(u.id, {
            id: u.id,
            nome: u.nome,
            email: u.email,
            ativo: u.ativo,
          }),
        )
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
      numero_caso: Number(raw.numero_caso ?? 0),
      identificacao_caso: raw.identificacao_caso,
      status_id: raw.status_id,
      data_autorizacao: raw.data_autorizacao,
      prazo_conclusao: raw.prazo_conclusao,
      responsavel_usuario_id: raw.responsavel_usuario_id,
      executor_usuario_id: raw.executor_usuario_id,
      responsavel_core_usuario_id: raw.responsavel_core_usuario_id || null,
      executor_core_usuario_id: raw.executor_core_usuario_id || null,
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

  async saveControle(
    input: SaveControleInput,
    usuariosParam?: TaskUsuarioAtivoRecord[],
  ): Promise<TaskControleRecord> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userId = user?.id || null

    // Regra A: Verificar se o status recebido é finalizador (task_status.finaliza = true).
    // Se for, preencher arquivado_at com a data/hora atual na mesma operação de salvamento.
    // NÃO desarquivar automaticamente se o status voltar a não finalizador.
    let statusFinaliza = false
    try {
      const { data: statusObj } = await supabase
        .from('task_status')
        .select('finaliza')
        .eq('id', input.status_id)
        .single()
      if (statusObj?.finaliza) {
        statusFinaliza = true
      }
    } catch (checkErr) {
      console.error('Aviso ao verificar se status do controle finaliza:', checkErr)
    }

    // Se for edição (input.id presente), precisamos consultar o registro anterior primeiro (fail-closed estrito)
    // para viabilizar:
    // a) Preservação histórica sem re-resolução de IDs centrais caso a atribuição não tenha mudado;
    // b) Detecção de alteração real antes de executar qualquer UPDATE;
    // c) Bloqueio caso a consulta do registro anterior falhe.
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

    // Regra 5: Para atribuição histórica sem mudança em edição, preservar o par já gravado no registro
    // (central + operacional juntos), sem tentar re-resolver ou sobrescrever com candidatos atuais.
    let resolvedRespCoreId: string | null = null
    let resolvedExecCoreId: string | null = null

    const respNaoMudou = Boolean(
      existingRecord &&
      existingRecord.responsavel_usuario_id === input.responsavel_usuario_id &&
      existingRecord.responsavel_core_usuario_id,
    )
    if (respNaoMudou) {
      // Se um ID central diferente foi enviado no input com o mesmo operacional, valida consistência
      if (
        input.responsavel_core_usuario_id &&
        input.responsavel_core_usuario_id !== existingRecord.responsavel_core_usuario_id
      ) {
        throw new Error(
          'Gravação bloqueada: o ID central do Responsável diverge do vínculo gravado no sistema.',
        )
      }
      resolvedRespCoreId = existingRecord.responsavel_core_usuario_id
    }

    const execNaoMudou = Boolean(
      existingRecord &&
      existingRecord.executor_usuario_id === input.executor_usuario_id &&
      existingRecord.executor_core_usuario_id,
    )
    if (execNaoMudou) {
      if (
        input.executor_core_usuario_id &&
        input.executor_core_usuario_id !== existingRecord.executor_core_usuario_id
      ) {
        throw new Error(
          'Gravação bloqueada: o ID central do Executor diverge do vínculo gravado no sistema.',
        )
      }
      resolvedExecCoreId = existingRecord.executor_core_usuario_id
    }

    // Resolução dos IDs centrais para os casos que não foram preservados:
    // 1. Busca na lista informada de usuários elegíveis validados (usuariosParam)
    // 2. Se ausente, busca direto em task_usuarios (bridge lookup)
    const needBridgeLookup: string[] = []

    if (!resolvedRespCoreId && input.responsavel_usuario_id) {
      const foundResp = (usuariosParam || []).find((u) => u.id === input.responsavel_usuario_id)
      if (foundResp && foundResp.core_usuario_id) {
        resolvedRespCoreId = foundResp.core_usuario_id
      } else {
        needBridgeLookup.push(input.responsavel_usuario_id)
      }
    }

    if (!resolvedExecCoreId && input.executor_usuario_id) {
      const foundExec = (usuariosParam || []).find((u) => u.id === input.executor_usuario_id)
      if (foundExec && foundExec.core_usuario_id) {
        resolvedExecCoreId = foundExec.core_usuario_id
      } else if (!needBridgeLookup.includes(input.executor_usuario_id)) {
        needBridgeLookup.push(input.executor_usuario_id)
      }
    }

    if (needBridgeLookup.length > 0) {
      const { data: usersBridge, error: bridgeErr } = await supabase
        .from('task_usuarios')
        .select('id, core_usuario_id')
        .in('id', needBridgeLookup)

      if (bridgeErr) {
        console.error('Erro ao consultar task_usuarios para mapear core_usuario_id:', bridgeErr)
        throw new Error(
          'Gravação bloqueada: falha ao verificar os vínculos centrais dos usuários em task_usuarios.',
        )
      }

      for (const u of usersBridge || []) {
        if (u.id === input.responsavel_usuario_id && !resolvedRespCoreId) {
          resolvedRespCoreId = u.core_usuario_id || null
        }
        if (u.id === input.executor_usuario_id && !resolvedExecCoreId) {
          resolvedExecCoreId = u.core_usuario_id || null
        }
      }
    }

    // Validação estrita do vínculo central (presença):
    if (!resolvedRespCoreId) {
      throw new Error(
        'Gravação bloqueada: o Responsável selecionado não possui vínculo central (core_usuario_id) válido no Gestor de Acessos.',
      )
    }
    if (!resolvedExecCoreId) {
      throw new Error(
        'Gravação bloqueada: o Executor selecionado não possui vínculo central (core_usuario_id) válido no Gestor de Acessos.',
      )
    }

    // Regra 4: Valide que cada ID central enviado corresponde ao task_usuarios.core_usuario_id do respectivo ID operacional.
    // NÃO aceite uma dupla divergente (ex.: responsavel_usuario_id de pessoa A com responsavel_core_usuario_id de pessoa B).
    if (
      input.responsavel_core_usuario_id &&
      input.responsavel_core_usuario_id !== resolvedRespCoreId
    ) {
      throw new Error(
        'Gravação bloqueada: o ID central do Responsável diverge do vínculo correspondente em task_usuarios.',
      )
    }
    if (input.executor_core_usuario_id && input.executor_core_usuario_id !== resolvedExecCoreId) {
      throw new Error(
        'Gravação bloqueada: o ID central do Executor diverge do vínculo correspondente em task_usuarios.',
      )
    }

    const nowIso = new Date().toISOString()

    if (input.id && existingRecord) {
      // Regra de Detecção de Mudança Real na Edição:
      const cleanNewIdent = input.identificacao_caso.trim()
      const cleanNewDataAut = input.data_autorizacao || null
      const cleanNewPrazo = input.prazo_conclusao || null
      const cleanNewPastaCliente = input.pasta_cliente?.trim() || null
      const cleanNewPastaRicci = input.pasta_ricci?.trim() || null

      const mudouNome = existingRecord.nome_controle_id !== input.nome_controle_id
      const mudouIdent = (existingRecord.identificacao_caso || '').trim() !== cleanNewIdent
      const mudouStatus = existingRecord.status_id !== input.status_id
      const mudouDataAut =
        (existingRecord.data_autorizacao ? existingRecord.data_autorizacao.split('T')[0] : null) !==
        (cleanNewDataAut ? cleanNewDataAut.split('T')[0] : null)
      const mudouPrazo =
        (existingRecord.prazo_conclusao ? existingRecord.prazo_conclusao.split('T')[0] : null) !==
        (cleanNewPrazo ? cleanNewPrazo.split('T')[0] : null)
      const mudouResp =
        existingRecord.responsavel_usuario_id !== input.responsavel_usuario_id ||
        (existingRecord.responsavel_core_usuario_id || null) !== resolvedRespCoreId
      const mudouExec =
        existingRecord.executor_usuario_id !== input.executor_usuario_id ||
        (existingRecord.executor_core_usuario_id || null) !== resolvedExecCoreId
      const mudouPastaCli =
        (existingRecord.pasta_cliente || '').trim() !== (cleanNewPastaCliente || '')
      const mudouPastaRicci =
        (existingRecord.pasta_ricci || '').trim() !== (cleanNewPastaRicci || '')
      const mudouArquivado = Boolean(statusFinaliza && !existingRecord.arquivado_at)

      const houveMudancaReal =
        mudouNome ||
        mudouIdent ||
        mudouStatus ||
        mudouDataAut ||
        mudouPrazo ||
        mudouResp ||
        mudouExec ||
        mudouPastaCli ||
        mudouPastaRicci ||
        mudouArquivado

      // Regra 1: Quando a edição NÃO altera nenhum campo da tarefa, NÃO execute UPDATE em task_tarefas.
      // Retorne o registro existente hidratado.
      if (!houveMudancaReal) {
        const loaded = await this.getControleById(existingRecord.id, usuariosParam)
        return (loaded || existingRecord) as TaskControleRecord
      }

      // Regra 3: Quando houver alteração real, NÃO envie updated_at no payload de update;
      // deixe o gatilho do banco definir updated_at e use o valor retornado pelo banco (.select().single()).
      const updatePayload: {
        nome_controle_id: string
        identificacao_caso: string
        status_id: string
        data_autorizacao: string | null
        prazo_conclusao: string | null
        responsavel_usuario_id: string
        executor_usuario_id: string
        responsavel_core_usuario_id: string | null
        executor_core_usuario_id: string | null
        pasta_cliente: string | null
        pasta_ricci: string | null
        updated_by: string | null
        arquivado_at?: string
      } = {
        nome_controle_id: input.nome_controle_id,
        identificacao_caso: cleanNewIdent,
        status_id: input.status_id,
        data_autorizacao: cleanNewDataAut,
        prazo_conclusao: cleanNewPrazo,
        responsavel_usuario_id: input.responsavel_usuario_id,
        executor_usuario_id: input.executor_usuario_id,
        responsavel_core_usuario_id: resolvedRespCoreId,
        executor_core_usuario_id: resolvedExecCoreId,
        pasta_cliente: cleanNewPastaCliente,
        pasta_ricci: cleanNewPastaRicci,
        updated_by: userId,
      }

      if (statusFinaliza) {
        updatePayload.arquivado_at = existingRecord.arquivado_at || nowIso
      }

      const { data, error } = await supabase
        .from('task_tarefas')
        .update(updatePayload)
        .eq('id', input.id)
        .select()
        .single()

      if (error) {
        console.error('Erro ao atualizar task_tarefas:', error)
        throw error
      }

      // Notifica alteração global caso tenha sido arquivado automaticamente
      if (statusFinaliza && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('ricci:controles-changed', {
            detail: { action: 'auto-archive', controleId: data.id },
          }),
        )
      }

      const loaded = await this.getControleById(data.id, usuariosParam)
      if (loaded) {
        // Assegura que o updated_at retornado pelo banco após o trigger prevaleça
        loaded.updated_at = data.updated_at
        return loaded
      }
      return data as TaskControleRecord
    } else {
      const insertPayload: any = {
        nome_controle_id: input.nome_controle_id,
        identificacao_caso: input.identificacao_caso.trim(),
        status_id: input.status_id,
        data_autorizacao: input.data_autorizacao || null,
        prazo_conclusao: input.prazo_conclusao || null,
        responsavel_usuario_id: input.responsavel_usuario_id,
        executor_usuario_id: input.executor_usuario_id,
        responsavel_core_usuario_id: resolvedRespCoreId,
        executor_core_usuario_id: resolvedExecCoreId,
        pasta_cliente: input.pasta_cliente?.trim() || null,
        pasta_ricci: input.pasta_ricci?.trim() || null,
        updated_at: nowIso,
        created_by: userId || undefined,
        updated_by: userId,
      }
      if (statusFinaliza) {
        insertPayload.arquivado_at = nowIso
      }

      const { data, error } = await supabase
        .from('task_tarefas')
        .insert(insertPayload)
        .select()
        .single()

      if (error) {
        console.error('Erro ao criar task_tarefas:', error)
        throw error
      }

      if (statusFinaliza && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('ricci:controles-changed', {
            detail: { action: 'auto-archive', controleId: data.id },
          }),
        )
      }

      const loaded = await this.getControleById(data.id, usuariosParam)
      return (loaded || data) as TaskControleRecord
    }
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
        console.error('Erro na chamada da Edge Function notify-task-assignment:', error)
        return {
          success: false,
          sent: false,
          error: error.message || 'Erro ao invocar função de notificação.',
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
