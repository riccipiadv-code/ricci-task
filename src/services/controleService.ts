import { supabase } from '@/lib/supabase/client'
import {
  TaskControleRecord,
  TaskNomeControleRecord,
  TaskResponsavelControleRecord,
  TaskStatusRecord,
  TaskTipoPrazoRecord,
  TaskResponsavelRecord,
  LegaldeskUsuarioRecord,
  TaskPrazoRecord,
  TaskAndamentoRecord,
  SaveControleInput,
  SavePrazoInput,
  SaveAndamentoInput,
  AppSettings,
  DashboardMetrics,
} from '@/types/task'

const SETTINGS_KEY = 'ricci_app_settings'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'claro',
  defaultView: 'todos',
  notificationsEnabled: true,
}

export const controleService = {
  // --------------------------------------------------------------------------
  // Metadados / Cadastros Auxiliares (somente leitura)
  // --------------------------------------------------------------------------
  async getStatusList(): Promise<TaskStatusRecord[]> {
    const { data, error } = await supabase
      .from('task_status')
      .select('*')
      .eq('ativo', true)
      .order('ordem', { ascending: true })
      .order('nome', { ascending: true })

    if (error) {
      console.error('Erro ao buscar task_status:', error)
      throw error
    }
    return (data as TaskStatusRecord[]) || []
  },

  async getTiposPrazoList(): Promise<TaskTipoPrazoRecord[]> {
    const { data, error } = await supabase
      .from('task_tipos_prazo')
      .select('*')
      .eq('ativo', true)
      .order('ordem', { ascending: true })
      .order('nome', { ascending: true })

    if (error) {
      console.error('Erro ao buscar task_tipos_prazo:', error)
      throw error
    }
    return (data as TaskTipoPrazoRecord[]) || []
  },

  async getResponsaveisCatalogo(): Promise<TaskResponsavelRecord[]> {
    const { data, error } = await supabase
      .from('task_responsaveis')
      .select('*')
      .eq('ativo', true)
      .order('ordem', { ascending: true })
      .order('nome', { ascending: true })

    if (error) {
      console.error('Erro ao buscar task_responsaveis:', error)
      throw error
    }
    return (data as TaskResponsavelRecord[]) || []
  },

  async getUsuariosInternosLegaldesk(): Promise<LegaldeskUsuarioRecord[]> {
    const { data, error } = await supabase
      .from('legaldesk_usuarios')
      .select('id, source_id, nome, sigla, email, ativo, tipo_usuario, departamento')
      .eq('ativo', true)
      .order('nome', { ascending: true })

    if (error) {
      console.error('Erro ao buscar legaldesk_usuarios:', error)
      throw error
    }
    return (data as LegaldeskUsuarioRecord[]) || []
  },

  // --------------------------------------------------------------------------
  // Nomes dos Controles (task_nomes_controle)
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
    return (data as TaskNomeControleRecord[]) || []
  },

  async saveNomeControle(
    input: { id?: string; nome: string; ativo?: boolean },
    userId?: string | null,
  ): Promise<TaskNomeControleRecord> {
    const nomeLimpo = input.nome.trim()
    if (!nomeLimpo) {
      throw new Error('O Nome do Controle é obrigatório.')
    }
    if (nomeLimpo.length > 500) {
      throw new Error('O Nome do Controle não pode exceder 500 caracteres.')
    }
    // Não permitir valor composto apenas por pontuação e espaços
    // Mantém validação: precisa conter ao menos um caractere alfanumérico
    if (!/[\p{L}\p{N}]/u.test(nomeLimpo)) {
      throw new Error(
        'O Nome do Controle deve conter letras ou números (não apenas pontuação ou espaços).',
      )
    }

    const payload: any = {
      nome: nomeLimpo,
      ativo: input.ativo !== undefined ? input.ativo : true,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    }

    if (input.id) {
      const { data, error } = await supabase
        .from('task_nomes_controle')
        .update(payload)
        .eq('id', input.id)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe um Nome do Controle equivalente a este.')
        }
        console.error('Erro ao atualizar task_nomes_controle:', error)
        throw error
      }
      return data as TaskNomeControleRecord
    } else {
      payload.created_by = userId || null
      const { data, error } = await supabase
        .from('task_nomes_controle')
        .insert(payload)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe um Nome do Controle equivalente a este.')
        }
        console.error('Erro ao inserir task_nomes_controle:', error)
        throw error
      }
      return data as TaskNomeControleRecord
    }
  },

  async toggleNomeControleAtivo(id: string, ativo: boolean, userId?: string | null): Promise<void> {
    const { error } = await supabase
      .from('task_nomes_controle')
      .update({
        ativo,
        updated_at: new Date().toISOString(),
        updated_by: userId || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao alternar status de task_nomes_controle:', error)
      throw error
    }
  },

  async excluirNomeControle(id: string, userId?: string | null): Promise<void> {
    // 1. Verificação prévia no frontend se está em uso em casos ativos
    const { count, error: countErr } = await supabase
      .from('task_tarefas')
      .select('id', { count: 'exact', head: true })
      .eq('nome_controle_id', id)
      .is('deleted_at', null)

    if (countErr) {
      console.error('Erro ao verificar uso de task_nomes_controle:', countErr)
    }
    if (count && count > 0) {
      throw new Error(
        `Não é possível excluir: este Nome do Controle está vinculado a ${count} caso(s) ativo(s).`,
      )
    }

    // 2. Exclusão lógica: preencher deleted_at e deleted_by (trigger do banco também protege)
    const { error } = await supabase
      .from('task_nomes_controle')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: userId || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao excluir task_nomes_controle:', error)
      if (error.message?.includes('vinculado a caso(s) ativo(s)')) {
        throw new Error('Não é possível excluir: Nome do Controle vinculado a caso(s) ativo(s).')
      }
      throw error
    }
  },

  // --------------------------------------------------------------------------
  // Responsáveis pelo Controle (task_responsaveis_controle)
  // --------------------------------------------------------------------------
  async getResponsaveisControle(options?: {
    incluirInativos?: boolean
  }): Promise<TaskResponsavelControleRecord[]> {
    let query = supabase
      .from('task_responsaveis_controle')
      .select('*')
      .is('deleted_at', null)
      .order('nome', { ascending: true })

    if (!options?.incluirInativos) {
      query = query.eq('ativo', true)
    }

    const { data, error } = await query
    if (error) {
      console.error('Erro ao buscar task_responsaveis_controle:', error)
      throw error
    }
    return (data as TaskResponsavelControleRecord[]) || []
  },

  async saveResponsavelControle(
    input: { id?: string; nome: string; ativo?: boolean },
    userId?: string | null,
  ): Promise<TaskResponsavelControleRecord> {
    const nomeLimpo = input.nome.trim()
    if (!nomeLimpo) {
      throw new Error('O nome do responsável é obrigatório.')
    }
    if (nomeLimpo.length > 255) {
      throw new Error('O nome do responsável não pode exceder 255 caracteres.')
    }
    if (!/[\p{L}\p{N}]/u.test(nomeLimpo)) {
      throw new Error(
        'O nome do responsável deve conter letras ou números (não apenas pontuação ou espaços).',
      )
    }

    const payload: any = {
      nome: nomeLimpo,
      ativo: input.ativo !== undefined ? input.ativo : true,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    }

    if (input.id) {
      const { data, error } = await supabase
        .from('task_responsaveis_controle')
        .update(payload)
        .eq('id', input.id)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe um Responsável equivalente a este.')
        }
        console.error('Erro ao atualizar task_responsaveis_controle:', error)
        throw error
      }
      return data as TaskResponsavelControleRecord
    } else {
      payload.created_by = userId || null
      const { data, error } = await supabase
        .from('task_responsaveis_controle')
        .insert(payload)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe um Responsável equivalente a este.')
        }
        console.error('Erro ao inserir task_responsaveis_controle:', error)
        throw error
      }
      return data as TaskResponsavelControleRecord
    }
  },

  async toggleResponsavelControleAtivo(
    id: string,
    ativo: boolean,
    userId?: string | null,
  ): Promise<void> {
    const { error } = await supabase
      .from('task_responsaveis_controle')
      .update({
        ativo,
        updated_at: new Date().toISOString(),
        updated_by: userId || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao alternar status de task_responsaveis_controle:', error)
      throw error
    }
  },

  async excluirResponsavelControle(id: string, userId?: string | null): Promise<void> {
    // 1. Verificação prévia no frontend se está em uso em casos ativos
    const { count, error: countErr } = await supabase
      .from('task_tarefas')
      .select('id', { count: 'exact', head: true })
      .eq('responsavel_controle_id', id)
      .is('deleted_at', null)

    if (countErr) {
      console.error('Erro ao verificar uso de task_responsaveis_controle:', countErr)
    }
    if (count && count > 0) {
      throw new Error(
        `Não é possível excluir: este Responsável está vinculado a ${count} caso(s) ativo(s).`,
      )
    }

    // 2. Exclusão lógica: preencher deleted_at e deleted_by (trigger do banco também protege)
    const { error } = await supabase
      .from('task_responsaveis_controle')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: userId || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao excluir task_responsaveis_controle:', error)
      if (error.message?.includes('vinculado a caso(s) ativo(s)')) {
        throw new Error('Não é possível excluir: Responsável vinculado a caso(s) ativo(s).')
      }
      throw error
    }
  },

  // --------------------------------------------------------------------------
  // Controles (task_tarefas)
  // --------------------------------------------------------------------------
  async getControles(): Promise<TaskControleRecord[]> {
    // 1. Busca controles não excluídos
    const { data: tarefas, error: errTarefas } = await supabase
      .from('task_tarefas')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })

    if (errTarefas) {
      console.error('Erro ao listar task_tarefas:', errTarefas)
      throw errTarefas
    }
    if (!tarefas || tarefas.length === 0) {
      return []
    }

    const tarefaIds = tarefas.map((t) => t.id)

    // 2. Busca dependências em paralelo: status, nomes_controle, responsaveis_controle, prazos
    const [statusRes, nomesRes, respCtrlRes, prazosRes] = await Promise.all([
      supabase.from('task_status').select('*'),
      supabase.from('task_nomes_controle').select('*'),
      supabase.from('task_responsaveis_controle').select('*'),
      supabase
        .from('task_prazos')
        .select('*, task_tipos_prazo (*)')
        .in('tarefa_id', tarefaIds)
        .eq('ativo', true)
        .order('data_prazo', { ascending: true }),
    ])

    const statusMap = new Map<string, TaskStatusRecord>()
    ;(statusRes.data || []).forEach((s) => statusMap.set(s.id, s as TaskStatusRecord))

    const nomesMap = new Map<string, TaskNomeControleRecord>()
    ;(nomesRes.data || []).forEach((n) => nomesMap.set(n.id, n as TaskNomeControleRecord))

    const respCtrlMap = new Map<string, TaskResponsavelControleRecord>()
    ;(respCtrlRes.data || []).forEach((r) =>
      respCtrlMap.set(r.id, r as TaskResponsavelControleRecord),
    )

    const prazosByTarefa = new Map<string, TaskPrazoRecord[]>()
    ;(prazosRes.data || []).forEach((raw: any) => {
      const p: TaskPrazoRecord = {
        id: raw.id,
        tarefa_id: raw.tarefa_id,
        data_prazo: raw.data_prazo,
        tipo_prazo_id: raw.tipo_prazo_id,
        descricao: raw.descricao,
        principal: raw.principal,
        ativo: raw.ativo,
        created_at: raw.created_at,
        created_by: raw.created_by,
        updated_at: raw.updated_at,
        updated_by: raw.updated_by,
        tipo_prazo: raw.task_tipos_prazo || null,
      }
      const existing = prazosByTarefa.get(p.tarefa_id) || []
      existing.push(p)
      prazosByTarefa.set(p.tarefa_id, existing)
    })

    // 3. Monta os objetos de controles completos
    const controles: TaskControleRecord[] = tarefas.map((t) => {
      const status = statusMap.get(t.status_id) || null
      const nomeControleRel = t.nome_controle_id ? nomesMap.get(t.nome_controle_id) || null : null
      const respControleRel = t.responsavel_controle_id
        ? respCtrlMap.get(t.responsavel_controle_id) || null
        : null
      const prazos = prazosByTarefa.get(t.id) || []

      // Prazo destaque: principal ativo ou próximo ativo mais próximo
      const principalPrazo = prazos.find((p) => p.principal && p.ativo)
      const proximoPrazo = prazos.length > 0 ? prazos[0] : null
      const prazoDestaque = principalPrazo || proximoPrazo || null

      const nomeExibicao = nomeControleRel?.nome || t.nome_controle || ''
      const responsavelNome = respControleRel?.nome || 'Não atribuído'
      const responsavelTipoBadge = respControleRel ? 'Controle' : '—'

      return {
        id: t.id,
        nome_controle: nomeExibicao,
        nome_controle_id: t.nome_controle_id,
        responsavel_controle_id: t.responsavel_controle_id,
        controle_cliente: t.controle_cliente,
        controle_ricci: t.controle_ricci,
        identificacao_caso: t.identificacao_caso,
        status_id: t.status_id,
        descricao_status: t.descricao_status,
        proximas_providencias: t.proximas_providencias,
        responsavel_legaldesk_id: t.responsavel_legaldesk_id,
        responsavel_id: t.responsavel_id,
        follow_up: t.follow_up,
        data_referencia: t.data_referencia,
        created_at: t.created_at,
        created_by: t.created_by,
        updated_at: t.updated_at,
        updated_by: t.updated_by,
        deleted_at: t.deleted_at,
        deleted_by: t.deleted_by,
        status,
        nome_controle_rel: nomeControleRel,
        responsavel_controle_rel: respControleRel,
        responsavel_interno: null,
        responsavel_catalogo: null,
        prazos,
        responsavel_nome: responsavelNome,
        responsavel_tipo_badge: responsavelTipoBadge,
        prazo_destaque: prazoDestaque,
      }
    })

    // 4. Ordenação especificada:
    // "por prazo principal ou próximo prazo ativo, depois follow-up e, por fim, updated_at decrescente."
    controles.sort((a, b) => {
      const datePrazoA = a.prazo_destaque?.data_prazo
      const datePrazoB = b.prazo_destaque?.data_prazo

      if (datePrazoA && datePrazoB) {
        if (datePrazoA !== datePrazoB) return datePrazoA.localeCompare(datePrazoB)
      } else if (datePrazoA && !datePrazoB) {
        return -1
      } else if (!datePrazoA && datePrazoB) {
        return 1
      }

      // Desempate por follow-up
      if (a.follow_up && b.follow_up) {
        if (a.follow_up !== b.follow_up) return a.follow_up.localeCompare(b.follow_up)
      } else if (a.follow_up && !b.follow_up) {
        return -1
      } else if (!a.follow_up && b.follow_up) {
        return 1
      }

      // Desempate final por updated_at decrescente
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })

    return controles
  },

  async getControleById(id: string): Promise<TaskControleRecord | null> {
    const { data: t, error } = await supabase
      .from('task_tarefas')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error || !t) {
      if (error) console.error('Erro ao buscar controle por ID:', error)
      return null
    }

    const [statusRes, nomeRes, respCtrlRes, prazosRes, andamentosRes] = await Promise.all([
      t.status_id
        ? supabase.from('task_status').select('*').eq('id', t.status_id).maybeSingle()
        : Promise.resolve({ data: null }),
      t.nome_controle_id
        ? supabase
            .from('task_nomes_controle')
            .select('*')
            .eq('id', t.nome_controle_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      t.responsavel_controle_id
        ? supabase
            .from('task_responsaveis_controle')
            .select('*')
            .eq('id', t.responsavel_controle_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('task_prazos')
        .select('*, task_tipos_prazo (*)')
        .eq('tarefa_id', t.id)
        .order('data_prazo', { ascending: true }),
      supabase
        .from('task_andamentos')
        .select('*')
        .eq('tarefa_id', t.id)
        .order('data_andamento', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

    const prazos: TaskPrazoRecord[] = (prazosRes.data || []).map((raw: any) => ({
      id: raw.id,
      tarefa_id: raw.tarefa_id,
      data_prazo: raw.data_prazo,
      tipo_prazo_id: raw.tipo_prazo_id,
      descricao: raw.descricao,
      principal: raw.principal,
      ativo: raw.ativo,
      created_at: raw.created_at,
      created_by: raw.created_by,
      updated_at: raw.updated_at,
      updated_by: raw.updated_by,
      tipo_prazo: raw.task_tipos_prazo || null,
    }))

    const andamentos: TaskAndamentoRecord[] = (andamentosRes.data || []).map((a: any) => ({
      id: a.id,
      tarefa_id: a.tarefa_id,
      data_andamento: a.data_andamento,
      descricao: a.descricao,
      created_at: a.created_at,
      created_by: a.created_by,
      updated_at: a.updated_at,
      updated_by: a.updated_by,
    }))

    const principalPrazo = prazos.find((p) => p.principal && p.ativo)
    const proximoPrazo = prazos.filter((p) => p.ativo)[0] || null

    const nomeRel = nomeRes.data as TaskNomeControleRecord | null
    const respRel = respCtrlRes.data as TaskResponsavelControleRecord | null

    return {
      ...t,
      nome_controle: nomeRel?.nome || t.nome_controle || '',
      status: (statusRes.data as TaskStatusRecord) || null,
      nome_controle_rel: nomeRel,
      responsavel_controle_rel: respRel,
      responsavel_interno: null,
      responsavel_catalogo: null,
      prazos,
      andamentos,
      responsavel_nome: respRel?.nome || 'Não atribuído',
      responsavel_tipo_badge: respRel ? 'Controle' : '—',
      prazo_destaque: principalPrazo || proximoPrazo,
    }
  },

  async saveControle(input: SaveControleInput): Promise<TaskControleRecord> {
    if (!input.nome_controle_id) {
      throw new Error('O campo Nome do Controle é obrigatório.')
    }
    if (!input.responsavel_controle_id) {
      throw new Error('O campo Responsável pelo Controle é obrigatório.')
    }
    if (!input.identificacao_caso.trim()) {
      throw new Error('Identificação do Caso é obrigatória.')
    }
    if (!input.status_id) {
      throw new Error('Status é obrigatório.')
    }

    const payload: any = {
      nome_controle_id: input.nome_controle_id,
      responsavel_controle_id: input.responsavel_controle_id,
      controle_cliente: input.controle_cliente?.trim() || null,
      controle_ricci: input.controle_ricci?.trim() || null,
      identificacao_caso: input.identificacao_caso.trim(),
      status_id: input.status_id,
      descricao_status: input.descricao_status?.trim() || null,
      proximas_providencias: input.proximas_providencias?.trim() || null,
      follow_up: input.follow_up || null,
      data_referencia: input.data_referencia || new Date().toISOString().split('T')[0],
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
      const loaded = await this.getControleById(data.id)
      return loaded!
    } else {
      const { data, error } = await supabase.from('task_tarefas').insert(payload).select().single()

      if (error) {
        console.error('Erro ao inserir task_tarefas:', error)
        throw error
      }
      const loaded = await this.getControleById(data.id)
      return loaded!
    }
  },

  /**
   * Arquivamento de controle: regra obrigatória:
   * "NUNCA faça delete() em task_tarefas. Apenas preencher deleted_at e deleted_by com o usuário autenticado."
   */
  async arquivarControle(id: string, userId?: string | null): Promise<void> {
    const { error } = await supabase
      .from('task_tarefas')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: userId || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Erro ao arquivar task_tarefas:', error)
      throw error
    }
  },

  // --------------------------------------------------------------------------
  // Prazos (task_prazos)
  // --------------------------------------------------------------------------
  async savePrazo(input: SavePrazoInput): Promise<TaskPrazoRecord> {
    if (!input.tarefa_id) throw new Error('ID do controle é obrigatório para o prazo.')
    if (!input.data_prazo) throw new Error('A data do prazo é obrigatória.')

    // Se marcado como principal, desmarca qualquer outro prazo principal da mesma tarefa
    if (input.principal) {
      await supabase
        .from('task_prazos')
        .update({ principal: false })
        .eq('tarefa_id', input.tarefa_id)
        .eq('principal', true)
    }

    const payload: any = {
      tarefa_id: input.tarefa_id,
      data_prazo: input.data_prazo,
      tipo_prazo_id: input.tipo_prazo_id || null,
      descricao: input.descricao?.trim() || null,
      principal: Boolean(input.principal),
      ativo: input.ativo !== undefined ? input.ativo : true,
    }

    if (input.id) {
      const { data, error } = await supabase
        .from('task_prazos')
        .update(payload)
        .eq('id', input.id)
        .select('*, task_tipos_prazo (*)')
        .single()

      if (error) {
        console.error('Erro ao atualizar task_prazos:', error)
        throw error
      }
      return {
        ...data,
        tipo_prazo: (data as any).task_tipos_prazo || null,
      } as TaskPrazoRecord
    } else {
      const { data, error } = await supabase
        .from('task_prazos')
        .insert(payload)
        .select('*, task_tipos_prazo (*)')
        .single()

      if (error) {
        console.error('Erro ao inserir task_prazos:', error)
        throw error
      }
      return {
        ...data,
        tipo_prazo: (data as any).task_tipos_prazo || null,
      } as TaskPrazoRecord
    }
  },

  async togglePrazoAtivo(id: string, ativo: boolean): Promise<void> {
    const { error } = await supabase.from('task_prazos').update({ ativo }).eq('id', id)
    if (error) {
      console.error('Erro ao atualizar status do prazo:', error)
      throw error
    }
  },

  async deletePrazo(id: string): Promise<void> {
    const { error } = await supabase.from('task_prazos').delete().eq('id', id)
    if (error) {
      console.error('Erro ao excluir task_prazos:', error)
      throw error
    }
  },

  // --------------------------------------------------------------------------
  // Andamentos (task_andamentos)
  // --------------------------------------------------------------------------
  async getAndamentos(tarefaId: string): Promise<TaskAndamentoRecord[]> {
    const { data, error } = await supabase
      .from('task_andamentos')
      .select('*')
      .eq('tarefa_id', tarefaId)
      .order('data_andamento', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Erro ao buscar task_andamentos:', error)
      throw error
    }
    return (data as TaskAndamentoRecord[]) || []
  },

  async saveAndamento(input: SaveAndamentoInput): Promise<TaskAndamentoRecord> {
    if (!input.tarefa_id) throw new Error('ID do controle é obrigatório para o andamento.')
    if (!input.data_andamento) throw new Error('A data do andamento é obrigatória.')
    if (!input.descricao.trim()) throw new Error('A descrição do andamento é obrigatória.')

    const payload = {
      tarefa_id: input.tarefa_id,
      data_andamento: input.data_andamento,
      descricao: input.descricao.trim(),
    }

    if (input.id) {
      const { data, error } = await supabase
        .from('task_andamentos')
        .update(payload)
        .eq('id', input.id)
        .select()
        .single()

      if (error) {
        console.error('Erro ao atualizar task_andamentos:', error)
        throw error
      }
      return data as TaskAndamentoRecord
    } else {
      const { data, error } = await supabase
        .from('task_andamentos')
        .insert(payload)
        .select()
        .single()

      if (error) {
        console.error('Erro ao criar task_andamentos:', error)
        throw error
      }
      return data as TaskAndamentoRecord
    }
  },

  async deleteAndamento(id: string): Promise<void> {
    const { error } = await supabase.from('task_andamentos').delete().eq('id', id)
    if (error) {
      console.error('Erro ao excluir task_andamentos:', error)
      throw error
    }
  },

  // --------------------------------------------------------------------------
  // Recarregar timestamp de última atualização do controle
  // --------------------------------------------------------------------------
  async getControleUpdatedAt(id: string): Promise<string | null> {
    const { data } = await supabase
      .from('task_tarefas')
      .select('updated_at')
      .eq('id', id)
      .maybeSingle()

    return data?.updated_at || null
  },

  // --------------------------------------------------------------------------
  // Métricas do Dashboard
  // --------------------------------------------------------------------------
  calculateMetrics(controles: TaskControleRecord[]): DashboardMetrics {
    const today = new Date().toISOString().split('T')[0]
    let emAndamento = 0
    let aguardandoAutorizacao = 0
    let prazosVencidos = 0
    let followUpsVencidos = 0
    let concluidos = 0

    for (const c of controles) {
      const isFinalizado = Boolean(c.status?.finaliza)
      const statusCodigo = c.status?.codigo

      if (isFinalizado) {
        concluidos++
      } else {
        if (statusCodigo === 'em_andamento') {
          emAndamento++
        } else if (statusCodigo === 'aguardando_autorizacao') {
          aguardandoAutorizacao++
        }

        // Prazos vencidos: controles NÃO finalizados com prazo de destaque antes de hoje
        if (c.prazo_destaque?.data_prazo && c.prazo_destaque.data_prazo < today) {
          prazosVencidos++
        }

        // Follow-ups vencidos: controles NÃO finalizados com follow_up antes de hoje
        if (c.follow_up && c.follow_up < today) {
          followUpsVencidos++
        }
      }
    }

    return {
      emAndamento,
      aguardandoAutorizacao,
      prazosVencidos,
      followUpsVencidos,
      concluidos,
      total: controles.length,
    }
  },

  // --------------------------------------------------------------------------
  // Preferências locais do usuário (apenas tema e visualização da tela)
  // --------------------------------------------------------------------------
  getSettings(): AppSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (!raw) return DEFAULT_SETTINGS
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    } catch {
      return DEFAULT_SETTINGS
    }
  },

  saveSettings(updates: Partial<AppSettings>): AppSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try {
      const current = this.getSettings()
      const merged = { ...current, ...updates }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged))
      return merged
    } catch {
      return DEFAULT_SETTINGS
    }
  },
}
