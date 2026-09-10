import { supabase } from '@/lib/supabase/client'
import {
  TaskControleRecord,
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

    // 2. Busca dependências em paralelo: status, responsáveis catálogo, internos, prazos
    const [statusRes, respCatRes, respIntRes, prazosRes] = await Promise.all([
      supabase.from('task_status').select('*'),
      supabase.from('task_responsaveis').select('*'),
      supabase
        .from('legaldesk_usuarios')
        .select('id, source_id, nome, sigla, email, ativo, tipo_usuario, departamento'),
      supabase
        .from('task_prazos')
        .select('*, task_tipos_prazo (*)')
        .in('tarefa_id', tarefaIds)
        .eq('ativo', true)
        .order('data_prazo', { ascending: true }),
    ])

    const statusMap = new Map<string, TaskStatusRecord>()
    ;(statusRes.data || []).forEach((s) => statusMap.set(s.id, s as TaskStatusRecord))

    const respCatMap = new Map<string, TaskResponsavelRecord>()
    ;(respCatRes.data || []).forEach((r) => respCatMap.set(r.id, r as TaskResponsavelRecord))

    const respIntMap = new Map<string, LegaldeskUsuarioRecord>()
    ;(respIntRes.data || []).forEach((u) => respIntMap.set(u.id, u as LegaldeskUsuarioRecord))

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
      const respInt = t.responsavel_legaldesk_id
        ? respIntMap.get(t.responsavel_legaldesk_id) || null
        : null
      const respCat = t.responsavel_id ? respCatMap.get(t.responsavel_id) || null : null
      const prazos = prazosByTarefa.get(t.id) || []

      // Prazo destaque: principal ativo ou próximo ativo mais próximo
      const principalPrazo = prazos.find((p) => p.principal && p.ativo)
      const proximoPrazo = prazos.length > 0 ? prazos[0] : null
      const prazoDestaque = principalPrazo || proximoPrazo || null

      let responsavelNome = 'Não atribuído'
      let responsavelTipoBadge = '—'
      if (respInt) {
        responsavelNome = respInt.nome
        responsavelTipoBadge = 'Interno'
      } else if (respCat) {
        responsavelNome = respCat.nome
        responsavelTipoBadge = respCat.tipo === 'equipe' ? 'Equipe' : 'Terceiro'
      }

      return {
        id: t.id,
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
        responsavel_interno: respInt,
        responsavel_catalogo: respCat,
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

    const [statusRes, respCatRes, respIntRes, prazosRes, andamentosRes] = await Promise.all([
      t.status_id
        ? supabase.from('task_status').select('*').eq('id', t.status_id).maybeSingle()
        : Promise.resolve({ data: null }),
      t.responsavel_id
        ? supabase.from('task_responsaveis').select('*').eq('id', t.responsavel_id).maybeSingle()
        : Promise.resolve({ data: null }),
      t.responsavel_legaldesk_id
        ? supabase
            .from('legaldesk_usuarios')
            .select('id, source_id, nome, sigla, email, ativo, tipo_usuario, departamento')
            .eq('id', t.responsavel_legaldesk_id)
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

    let responsavelNome = 'Não atribuído'
    let responsavelTipoBadge = '—'
    if (respIntRes.data) {
      responsavelNome = respIntRes.data.nome
      responsavelTipoBadge = 'Interno'
    } else if (respCatRes.data) {
      responsavelNome = respCatRes.data.nome
      responsavelTipoBadge = respCatRes.data.tipo === 'equipe' ? 'Equipe' : 'Terceiro'
    }

    return {
      ...t,
      status: (statusRes.data as TaskStatusRecord) || null,
      responsavel_interno: (respIntRes.data as LegaldeskUsuarioRecord) || null,
      responsavel_catalogo: (respCatRes.data as TaskResponsavelRecord) || null,
      prazos,
      andamentos,
      responsavel_nome: responsavelNome,
      responsavel_tipo_badge: responsavelTipoBadge,
      prazo_destaque: principalPrazo || proximoPrazo,
    }
  },

  async saveControle(input: SaveControleInput): Promise<TaskControleRecord> {
    // Garante checagem: apenas um responsável preenchido
    if (input.responsavel_legaldesk_id && input.responsavel_id) {
      throw new Error('Preencha apenas um responsável (interno OU catálogo).')
    }
    if (!input.responsavel_legaldesk_id && !input.responsavel_id) {
      throw new Error('O campo Responsável é obrigatório.')
    }
    if (!input.identificacao_caso.trim()) {
      throw new Error('Identificação do Caso é obrigatória.')
    }
    if (!input.status_id) {
      throw new Error('Status é obrigatório.')
    }

    const payload: any = {
      controle_cliente: input.controle_cliente?.trim() || null,
      controle_ricci: input.controle_ricci?.trim() || null,
      identificacao_caso: input.identificacao_caso.trim(),
      status_id: input.status_id,
      descricao_status: input.descricao_status?.trim() || null,
      proximas_providencias: input.proximas_providencias?.trim() || null,
      responsavel_legaldesk_id: input.responsavel_legaldesk_id || null,
      responsavel_id: input.responsavel_id || null,
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
