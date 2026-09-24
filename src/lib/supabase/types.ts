// AVOID UPDATING THIS FILE DIRECTLY. It is automatically generated.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      anexos: {
        Row: {
          created_at: string
          file_url: string
          id: string
          nome: string
          tarefa_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_url: string
          id?: string
          nome: string
          tarefa_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_url?: string
          id?: string
          nome?: string
          tarefa_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'anexos_tarefa_id_fkey'
            columns: ['tarefa_id']
            isOneToOne: false
            referencedRelation: 'tarefas'
            referencedColumns: ['id']
          },
        ]
      }
      areas: {
        Row: {
          created_at: string
          descricao: string | null
          gestor_id: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          gestor_id?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          gestor_id?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'areas_gestor_id_fkey'
            columns: ['gestor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_gestor'
            columns: ['gestor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      atendimentos: {
        Row: {
          created_at: string
          first_name: string | null
          gender: string | null
          id: string
          last_interaction_at: string | null
          last_name: string | null
          manychat_id: string
          name: string | null
          optin_email: boolean | null
          optin_phone: boolean | null
          profile_pic: string | null
          status: string | null
          updated_at: string
          whatsapp_phone: string | null
        }
        Insert: {
          created_at?: string
          first_name?: string | null
          gender?: string | null
          id?: string
          last_interaction_at?: string | null
          last_name?: string | null
          manychat_id: string
          name?: string | null
          optin_email?: boolean | null
          optin_phone?: boolean | null
          profile_pic?: string | null
          status?: string | null
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Update: {
          created_at?: string
          first_name?: string | null
          gender?: string | null
          id?: string
          last_interaction_at?: string | null
          last_name?: string | null
          manychat_id?: string
          name?: string | null
          optin_email?: boolean | null
          optin_phone?: boolean | null
          profile_pic?: string | null
          status?: string | null
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Relationships: []
      }
      comentarios: {
        Row: {
          conteudo: string
          created_at: string
          id: string
          tarefa_id: string
          user_id: string
        }
        Insert: {
          conteudo: string
          created_at?: string
          id?: string
          tarefa_id: string
          user_id: string
        }
        Update: {
          conteudo?: string
          created_at?: string
          id?: string
          tarefa_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'comentarios_tarefa_id_fkey'
            columns: ['tarefa_id']
            isOneToOne: false
            referencedRelation: 'tarefas'
            referencedColumns: ['id']
          },
        ]
      }
      departamentos: {
        Row: {
          id: string
          nome: string
        }
        Insert: {
          id?: string
          nome: string
        }
        Update: {
          id?: string
          nome?: string
        }
        Relationships: []
      }
      email_reading_secrets: {
        Row: {
          created_at: string
          secret_value: string
          setting_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          secret_value: string
          setting_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          secret_value?: string
          setting_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_reading_secrets_setting_id_fkey'
            columns: ['setting_id']
            isOneToOne: true
            referencedRelation: 'email_reading_settings'
            referencedColumns: ['id']
          },
        ]
      }
      email_reading_settings: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          imap_host: string
          imap_port: number
          secret_configured: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          imap_host?: string
          imap_port?: number
          secret_configured?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          imap_host?: string
          imap_port?: number
          secret_configured?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      email_secrets: {
        Row: {
          created_at: string | null
          secret_value: string
          setting_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          secret_value: string
          setting_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          secret_value?: string
          setting_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'email_secrets_setting_id_fkey'
            columns: ['setting_id']
            isOneToOne: true
            referencedRelation: 'email_settings'
            referencedColumns: ['id']
          },
        ]
      }
      email_send_logs: {
        Row: {
          created_at: string | null
          created_by: string | null
          error_message: string | null
          id: string
          status: string
          subject: string | null
          to_email: string
          type: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          id?: string
          status: string
          subject?: string | null
          to_email: string
          type: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          id?: string
          status?: string
          subject?: string | null
          to_email?: string
          type?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          provider: string
          reply_to: string | null
          secret_configured: boolean | null
          sender_email: string
          sender_name: string
          smtp_host: string | null
          smtp_port: number | null
          smtp_secure: boolean | null
          smtp_user: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          provider?: string
          reply_to?: string | null
          secret_configured?: boolean | null
          sender_email: string
          sender_name: string
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean | null
          smtp_user?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          provider?: string
          reply_to?: string | null
          secret_configured?: boolean | null
          sender_email?: string
          sender_name?: string
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean | null
          smtp_user?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      historico_tarefas: {
        Row: {
          acao: string
          created_at: string
          detalhes: Json | null
          id: string
          tarefa_id: string
          usuario_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          tarefa_id: string
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          tarefa_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'historico_tarefas_tarefa_id_fkey'
            columns: ['tarefa_id']
            isOneToOne: false
            referencedRelation: 'tarefas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'historico_tarefas_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      integration_logs: {
        Row: {
          created_at: string
          detected_event_type: string | null
          error_message: string | null
          event_type: string
          id: string
          payload: Json | null
          processing_context: Json | null
          received_at: string | null
          status: string
          subscriber_id: string | null
        }
        Insert: {
          created_at?: string
          detected_event_type?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          payload?: Json | null
          processing_context?: Json | null
          received_at?: string | null
          status: string
          subscriber_id?: string | null
        }
        Update: {
          created_at?: string
          detected_event_type?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json | null
          processing_context?: Json | null
          received_at?: string | null
          status?: string
          subscriber_id?: string | null
        }
        Relationships: []
      }
      legaldesk_tarefas: {
        Row: {
          ativo: boolean | null
          cliente: string | null
          codigo_cliente: string | null
          data_atualizacao_origem: string | null
          data_criacao_origem: string | null
          data_prazo: string | null
          depto: string | null
          descricao: string | null
          excluido_origem: boolean | null
          id: number
          link_codigo_origem: string | null
          origem: string | null
          processo: string | null
          responsavel: string | null
          sincronizado_em: string | null
          source_id: string
          status: string | null
          tipo_origem: string | null
          titulo: string | null
        }
        Insert: {
          ativo?: boolean | null
          cliente?: string | null
          codigo_cliente?: string | null
          data_atualizacao_origem?: string | null
          data_criacao_origem?: string | null
          data_prazo?: string | null
          depto?: string | null
          descricao?: string | null
          excluido_origem?: boolean | null
          id?: number
          link_codigo_origem?: string | null
          origem?: string | null
          processo?: string | null
          responsavel?: string | null
          sincronizado_em?: string | null
          source_id: string
          status?: string | null
          tipo_origem?: string | null
          titulo?: string | null
        }
        Update: {
          ativo?: boolean | null
          cliente?: string | null
          codigo_cliente?: string | null
          data_atualizacao_origem?: string | null
          data_criacao_origem?: string | null
          data_prazo?: string | null
          depto?: string | null
          descricao?: string | null
          excluido_origem?: boolean | null
          id?: number
          link_codigo_origem?: string | null
          origem?: string | null
          processo?: string | null
          responsavel?: string | null
          sincronizado_em?: string | null
          source_id?: string
          status?: string | null
          tipo_origem?: string | null
          titulo?: string | null
        }
        Relationships: []
      }
      legaldesk_usuarios: {
        Row: {
          ativo: boolean | null
          data_atualizacao_origem: string | null
          data_criacao_origem: string | null
          departamento: string | null
          email: string | null
          exibir_gestao_usuarios: boolean
          id: string
          nome: string
          origem: string | null
          sigla: string | null
          sincronizado_em: string | null
          source_id: string
          tipo_usuario: string | null
        }
        Insert: {
          ativo?: boolean | null
          data_atualizacao_origem?: string | null
          data_criacao_origem?: string | null
          departamento?: string | null
          email?: string | null
          exibir_gestao_usuarios?: boolean
          id?: string
          nome: string
          origem?: string | null
          sigla?: string | null
          sincronizado_em?: string | null
          source_id: string
          tipo_usuario?: string | null
        }
        Update: {
          ativo?: boolean | null
          data_atualizacao_origem?: string | null
          data_criacao_origem?: string | null
          departamento?: string | null
          email?: string | null
          exibir_gestao_usuarios?: boolean
          id?: string
          nome?: string
          origem?: string | null
          sigla?: string | null
          sincronizado_em?: string | null
          source_id?: string
          tipo_usuario?: string | null
        }
        Relationships: []
      }
      manychat_cancel_reasons: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          motivo: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          motivo: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          motivo?: string
        }
        Relationships: []
      }
      manychat_contact_attributes: {
        Row: {
          attribute_key: string
          attribute_value: string | null
          created_at: string
          id: string | null
          manychat_id: string
          updated_at: string
        }
        Insert: {
          attribute_key: string
          attribute_value?: string | null
          created_at?: string
          id?: string | null
          manychat_id: string
          updated_at?: string
        }
        Update: {
          attribute_key?: string
          attribute_value?: string | null
          created_at?: string
          id?: string | null
          manychat_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_contact_attributes_manychat_id_fkey'
            columns: ['manychat_id']
            isOneToOne: false
            referencedRelation: 'manychat_contatos'
            referencedColumns: ['manychat_id']
          },
        ]
      }
      manychat_contatos: {
        Row: {
          cancel_obs: string | null
          cancel_reason: string | null
          cancel_reason_id: string | null
          controle: number | null
          created_at: string
          current_stage: string | null
          data_follow_up: string | null
          deleted_at: string | null
          deleted_by: string | null
          depto_id: number | null
          external_transfers: Json | null
          first_name: string | null
          foto: string | null
          generated_at: string | null
          genero: string | null
          id: string
          last_interaction_at: string | null
          last_name: string | null
          last_stage_change_at: string | null
          last_synced_at: string | null
          last_update_log: string | null
          last_update_status: string | null
          lead_email: string | null
          lead_empresa_pf: string | null
          lead_nome: string | null
          lead_nome_exibicao: string | null
          lead_resumo: string | null
          lead_servico: string | null
          manual_updated_at: string | null
          manual_updated_by: string | null
          manychat_data: Json | null
          manychat_id: string
          manychat_live_chat_url: string | null
          messages_payload: Json | null
          nome: string | null
          numero_cliente: number | null
          observacoes: string | null
          orcamento: string | null
          origem: string | null
          origem_id: number | null
          payload_bruto: Json | null
          porte_empresa: string | null
          porte_empresa_id: number | null
          responsavel_id: string | null
          responsible_user_id: string | null
          servico_id: string | null
          sla_due_at: string | null
          sla_started_at: string | null
          sla_status: string | null
          status: string | null
          subscribed_at: string | null
          telefone: string | null
          updated_at: string
          valor: number | null
          whatsapp_phone: string | null
        }
        Insert: {
          cancel_obs?: string | null
          cancel_reason?: string | null
          cancel_reason_id?: string | null
          controle?: number | null
          created_at?: string
          current_stage?: string | null
          data_follow_up?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          depto_id?: number | null
          external_transfers?: Json | null
          first_name?: string | null
          foto?: string | null
          generated_at?: string | null
          genero?: string | null
          id?: string
          last_interaction_at?: string | null
          last_name?: string | null
          last_stage_change_at?: string | null
          last_synced_at?: string | null
          last_update_log?: string | null
          last_update_status?: string | null
          lead_email?: string | null
          lead_empresa_pf?: string | null
          lead_nome?: string | null
          lead_nome_exibicao?: string | null
          lead_resumo?: string | null
          lead_servico?: string | null
          manual_updated_at?: string | null
          manual_updated_by?: string | null
          manychat_data?: Json | null
          manychat_id: string
          manychat_live_chat_url?: string | null
          messages_payload?: Json | null
          nome?: string | null
          numero_cliente?: number | null
          observacoes?: string | null
          orcamento?: string | null
          origem?: string | null
          origem_id?: number | null
          payload_bruto?: Json | null
          porte_empresa?: string | null
          porte_empresa_id?: number | null
          responsavel_id?: string | null
          responsible_user_id?: string | null
          servico_id?: string | null
          sla_due_at?: string | null
          sla_started_at?: string | null
          sla_status?: string | null
          status?: string | null
          subscribed_at?: string | null
          telefone?: string | null
          updated_at?: string
          valor?: number | null
          whatsapp_phone?: string | null
        }
        Update: {
          cancel_obs?: string | null
          cancel_reason?: string | null
          cancel_reason_id?: string | null
          controle?: number | null
          created_at?: string
          current_stage?: string | null
          data_follow_up?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          depto_id?: number | null
          external_transfers?: Json | null
          first_name?: string | null
          foto?: string | null
          generated_at?: string | null
          genero?: string | null
          id?: string
          last_interaction_at?: string | null
          last_name?: string | null
          last_stage_change_at?: string | null
          last_synced_at?: string | null
          last_update_log?: string | null
          last_update_status?: string | null
          lead_email?: string | null
          lead_empresa_pf?: string | null
          lead_nome?: string | null
          lead_nome_exibicao?: string | null
          lead_resumo?: string | null
          lead_servico?: string | null
          manual_updated_at?: string | null
          manual_updated_by?: string | null
          manychat_data?: Json | null
          manychat_id?: string
          manychat_live_chat_url?: string | null
          messages_payload?: Json | null
          nome?: string | null
          numero_cliente?: number | null
          observacoes?: string | null
          orcamento?: string | null
          origem?: string | null
          origem_id?: number | null
          payload_bruto?: Json | null
          porte_empresa?: string | null
          porte_empresa_id?: number | null
          responsavel_id?: string | null
          responsible_user_id?: string | null
          servico_id?: string | null
          sla_due_at?: string | null
          sla_started_at?: string | null
          sla_status?: string | null
          status?: string | null
          subscribed_at?: string | null
          telefone?: string | null
          updated_at?: string
          valor?: number | null
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fk_manychat_contatos_origem'
            columns: ['origem_id']
            isOneToOne: false
            referencedRelation: 'manychat_origens'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_manychat_contatos_porte_empresa'
            columns: ['porte_empresa_id']
            isOneToOne: false
            referencedRelation: 'manychat_portes_empresa'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_contatos_cancel_reason_id_fkey'
            columns: ['cancel_reason_id']
            isOneToOne: false
            referencedRelation: 'manychat_cancel_reasons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_contatos_depto_id_fkey'
            columns: ['depto_id']
            isOneToOne: false
            referencedRelation: 'manychat_deptos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_contatos_responsavel_id_fkey'
            columns: ['responsavel_id']
            isOneToOne: false
            referencedRelation: 'legaldesk_usuarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_contatos_responsible_user_id_profiles_fkey'
            columns: ['responsible_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_contatos_servico_id_fkey'
            columns: ['servico_id']
            isOneToOne: false
            referencedRelation: 'manychat_servicos'
            referencedColumns: ['id']
          },
        ]
      }
      manychat_contatos_anexos: {
        Row: {
          contato_id: string
          created_at: string
          created_by: string | null
          id: string
          link: string
          nome: string
          ordem: number
          updated_at: string
        }
        Insert: {
          contato_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          link: string
          nome: string
          ordem?: number
          updated_at?: string
        }
        Update: {
          contato_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          link?: string
          nome?: string
          ordem?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_contatos_anexos_contato_id_fkey'
            columns: ['contato_id']
            isOneToOne: false
            referencedRelation: 'manychat_contatos'
            referencedColumns: ['id']
          },
        ]
      }
      manychat_contatos_subservicos: {
        Row: {
          contato_id: string
          created_at: string
          subservico_id: number
        }
        Insert: {
          contato_id: string
          created_at?: string
          subservico_id: number
        }
        Update: {
          contato_id?: string
          created_at?: string
          subservico_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fk_manychat_contatos_subservicos_contato'
            columns: ['contato_id']
            isOneToOne: false
            referencedRelation: 'manychat_contatos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_manychat_contatos_subservicos_subservico'
            columns: ['subservico_id']
            isOneToOne: false
            referencedRelation: 'manychat_subservicos'
            referencedColumns: ['id']
          },
        ]
      }
      manychat_deptos: {
        Row: {
          ativo: boolean
          created_at: string
          id: number
          nome: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id: number
          nome: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome?: string
        }
        Relationships: []
      }
      manychat_origens: {
        Row: {
          ativo: boolean
          created_at: string
          id: number
          nome: string
          ordem: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome: string
          ordem: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome?: string
          ordem?: number
        }
        Relationships: []
      }
      manychat_portes_empresa: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          id: number
          nome: string
          ordem: number
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          id?: number
          nome: string
          ordem: number
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          id?: number
          nome?: string
          ordem?: number
        }
        Relationships: []
      }
      manychat_servicos: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          depto_id: number | null
          descricao: string
          id: string
          ordem_fluxo: number | null
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          depto_id?: number | null
          descricao: string
          id?: string
          ordem_fluxo?: number | null
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          depto_id?: number | null
          descricao?: string
          id?: string
          ordem_fluxo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_servicos_depto_id_fkey'
            columns: ['depto_id']
            isOneToOne: false
            referencedRelation: 'manychat_deptos'
            referencedColumns: ['id']
          },
        ]
      }
      manychat_subservicos: {
        Row: {
          ativo: boolean
          created_at: string
          id: number
          nome: string
          ordem: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome: string
          ordem: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome?: string
          ordem?: number
        }
        Relationships: []
      }
      manychat_sync_control: {
        Row: {
          created_at: string
          error_count: number | null
          id: string
          inserted_count: number | null
          last_cursor: string | null
          last_error: string | null
          last_successful_sync: string | null
          status: string
          sync_type: string
          updated_at: string
          updated_count: number | null
        }
        Insert: {
          created_at?: string
          error_count?: number | null
          id?: string
          inserted_count?: number | null
          last_cursor?: string | null
          last_error?: string | null
          last_successful_sync?: string | null
          status: string
          sync_type: string
          updated_at?: string
          updated_count?: number | null
        }
        Update: {
          created_at?: string
          error_count?: number | null
          id?: string
          inserted_count?: number | null
          last_cursor?: string | null
          last_error?: string | null
          last_successful_sync?: string | null
          status?: string
          sync_type?: string
          updated_at?: string
          updated_count?: number | null
        }
        Relationships: []
      }
      mc_atendimento_custom_fields: {
        Row: {
          atendimento_id: string
          custom_field_id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          atendimento_id: string
          custom_field_id: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          atendimento_id?: string
          custom_field_id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mc_atendimento_custom_fields_atendimento_id_fkey'
            columns: ['atendimento_id']
            isOneToOne: false
            referencedRelation: 'atendimentos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mc_atendimento_custom_fields_custom_field_id_fkey'
            columns: ['custom_field_id']
            isOneToOne: false
            referencedRelation: 'mc_custom_fields'
            referencedColumns: ['id']
          },
        ]
      }
      mc_atendimento_tags: {
        Row: {
          atendimento_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          atendimento_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          atendimento_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mc_atendimento_tags_atendimento_id_fkey'
            columns: ['atendimento_id']
            isOneToOne: false
            referencedRelation: 'atendimentos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mc_atendimento_tags_tag_id_fkey'
            columns: ['tag_id']
            isOneToOne: false
            referencedRelation: 'mc_tags'
            referencedColumns: ['id']
          },
        ]
      }
      mc_audit_log: {
        Row: {
          action: string
          changed_by: string | null
          contato_id: string | null
          created_at: string
          entity_id: string | null
          entity_name: string | null
          field_name: string | null
          id: string
          metadata: Json | null
          new_data: Json | null
          new_value: string | null
          old_data: Json | null
          old_value: string | null
          record_id: string | null
          table_name: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changed_by?: string | null
          contato_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          old_data?: Json | null
          old_value?: string | null
          record_id?: string | null
          table_name?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_by?: string | null
          contato_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_data?: Json | null
          new_value?: string | null
          old_data?: Json | null
          old_value?: string | null
          record_id?: string | null
          table_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mc_audit_log_contato_id_fkey'
            columns: ['contato_id']
            isOneToOne: false
            referencedRelation: 'manychat_contatos'
            referencedColumns: ['id']
          },
        ]
      }
      mc_conversations: {
        Row: {
          atendimento_id: string | null
          created_at: string
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          atendimento_id?: string | null
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          atendimento_id?: string | null
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mc_conversations_atendimento_id_fkey'
            columns: ['atendimento_id']
            isOneToOne: false
            referencedRelation: 'atendimentos'
            referencedColumns: ['id']
          },
        ]
      }
      mc_custom_fields: {
        Row: {
          created_at: string
          id: string
          manychat_id: string
          name: string
          type: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          manychat_id: string
          name: string
          type?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          manychat_id?: string
          name?: string
          type?: string | null
        }
        Relationships: []
      }
      mc_kanban_history: {
        Row: {
          changed_by: string | null
          contato_id: string | null
          created_at: string
          id: string
          manychat_id: string
          new_stage: string
          notes: string | null
          previous_stage: string | null
        }
        Insert: {
          changed_by?: string | null
          contato_id?: string | null
          created_at?: string
          id?: string
          manychat_id: string
          new_stage: string
          notes?: string | null
          previous_stage?: string | null
        }
        Update: {
          changed_by?: string | null
          contato_id?: string | null
          created_at?: string
          id?: string
          manychat_id?: string
          new_stage?: string
          notes?: string | null
          previous_stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mc_kanban_history_contato_id_fkey'
            columns: ['contato_id']
            isOneToOne: false
            referencedRelation: 'manychat_contatos'
            referencedColumns: ['id']
          },
        ]
      }
      mc_messages: {
        Row: {
          content: string | null
          conversation_id: string | null
          created_at: string
          direction: string
          id: string
          manychat_message_id: string | null
          message_type: string | null
        }
        Insert: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          direction: string
          id?: string
          manychat_message_id?: string | null
          message_type?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          manychat_message_id?: string | null
          message_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mc_messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'mc_conversations'
            referencedColumns: ['id']
          },
        ]
      }
      mc_sla_tracking: {
        Row: {
          contato_id: string | null
          created_at: string
          elapsed_business_hours: number | null
          id: string
          last_calculated_at: string | null
          manychat_id: string
          sla_due: string | null
          sla_start: string | null
          sla_status: string | null
          stage: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          contato_id?: string | null
          created_at?: string
          elapsed_business_hours?: number | null
          id?: string
          last_calculated_at?: string | null
          manychat_id: string
          sla_due?: string | null
          sla_start?: string | null
          sla_status?: string | null
          stage?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          contato_id?: string | null
          created_at?: string
          elapsed_business_hours?: number | null
          id?: string
          last_calculated_at?: string | null
          manychat_id?: string
          sla_due?: string | null
          sla_start?: string | null
          sla_status?: string | null
          stage?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mc_sla_tracking_contato_id_fkey'
            columns: ['contato_id']
            isOneToOne: false
            referencedRelation: 'manychat_contatos'
            referencedColumns: ['id']
          },
        ]
      }
      mc_tags: {
        Row: {
          created_at: string
          id: string
          manychat_id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          manychat_id: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          manychat_id?: string
          name?: string
        }
        Relationships: []
      }
      mc_user_profiles: {
        Row: {
          active: boolean | null
          created_at: string | null
          department: string | null
          id: string
          role: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          department?: string | null
          id?: string
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          department?: string | null
          id?: string
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          created_at: string
          id: string
          lida: boolean | null
          titulo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lida?: boolean | null
          titulo: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lida?: boolean | null
          titulo?: string
          user_id?: string
        }
        Relationships: []
      }
      perfis_acesso: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          id: string
          nome: string
          ordem: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          id?: string
          nome: string
          ordem?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          id?: string
          nome?: string
          ordem?: number
          updated_at?: string
        }
        Relationships: []
      }
      prazos: {
        Row: {
          assunto: string | null
          assunto_id: string | null
          caso_codigo: string | null
          cliente: string | null
          cliente_codigo: string | null
          created_at: string
          data_prazo: string | null
          descricao: string | null
          id: string
          manychat_contato_id: string | null
          prioridade: string | null
          profissional_id: string | null
          profissional_responsavel: string | null
          raw_payload: Json | null
          situacao_id: string | null
          status: string | null
          synced_at: string | null
          tipo_compromisso: string | null
          tipo_compromisso_id: string | null
          titulo: string | null
          totvs_id: string
          updated_at: string
        }
        Insert: {
          assunto?: string | null
          assunto_id?: string | null
          caso_codigo?: string | null
          cliente?: string | null
          cliente_codigo?: string | null
          created_at?: string
          data_prazo?: string | null
          descricao?: string | null
          id?: string
          manychat_contato_id?: string | null
          prioridade?: string | null
          profissional_id?: string | null
          profissional_responsavel?: string | null
          raw_payload?: Json | null
          situacao_id?: string | null
          status?: string | null
          synced_at?: string | null
          tipo_compromisso?: string | null
          tipo_compromisso_id?: string | null
          titulo?: string | null
          totvs_id: string
          updated_at?: string
        }
        Update: {
          assunto?: string | null
          assunto_id?: string | null
          caso_codigo?: string | null
          cliente?: string | null
          cliente_codigo?: string | null
          created_at?: string
          data_prazo?: string | null
          descricao?: string | null
          id?: string
          manychat_contato_id?: string | null
          prioridade?: string | null
          profissional_id?: string | null
          profissional_responsavel?: string | null
          raw_payload?: Json | null
          situacao_id?: string | null
          status?: string | null
          synced_at?: string | null
          tipo_compromisso?: string | null
          tipo_compromisso_id?: string | null
          titulo?: string | null
          totvs_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          area_id: string | null
          ativo: boolean | null
          created_at: string
          email: string
          ferias_fim: string | null
          ferias_inicio: string | null
          gestor_id: string | null
          id: string
          legaldesk_usuario_id: string | null
          name: string
          perfil: string | null
          substituto_id: string | null
        }
        Insert: {
          area_id?: string | null
          ativo?: boolean | null
          created_at?: string
          email: string
          ferias_fim?: string | null
          ferias_inicio?: string | null
          gestor_id?: string | null
          id: string
          legaldesk_usuario_id?: string | null
          name: string
          perfil?: string | null
          substituto_id?: string | null
        }
        Update: {
          area_id?: string | null
          ativo?: boolean | null
          created_at?: string
          email?: string
          ferias_fim?: string | null
          ferias_inicio?: string | null
          gestor_id?: string | null
          id?: string
          legaldesk_usuario_id?: string | null
          name?: string
          perfil?: string | null
          substituto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_area_id_fkey'
            columns: ['area_id']
            isOneToOne: false
            referencedRelation: 'areas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_gestor_id_fkey'
            columns: ['gestor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_legaldesk_usuario_id_fkey'
            columns: ['legaldesk_usuario_id']
            isOneToOne: false
            referencedRelation: 'legaldesk_usuarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_substituto_id_fkey'
            columns: ['substituto_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      skip_tarefas: {
        Row: {
          alerta_status: boolean | null
          area_id: string | null
          auxiliar_id: string | null
          cliente_nome: string | null
          created_at: string
          descricao: string | null
          id: string
          numero_caso: string | null
          origem: string | null
          prazo: string | null
          prioridade: string | null
          responsavel_id: string | null
          status: string | null
          tipo_servico: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          alerta_status?: boolean | null
          area_id?: string | null
          auxiliar_id?: string | null
          cliente_nome?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          numero_caso?: string | null
          origem?: string | null
          prazo?: string | null
          prioridade?: string | null
          responsavel_id?: string | null
          status?: string | null
          tipo_servico?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          alerta_status?: boolean | null
          area_id?: string | null
          auxiliar_id?: string | null
          cliente_nome?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          numero_caso?: string | null
          origem?: string | null
          prazo?: string | null
          prioridade?: string | null
          responsavel_id?: string | null
          status?: string | null
          tipo_servico?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'skip_tarefas_area_id_fkey'
            columns: ['area_id']
            isOneToOne: false
            referencedRelation: 'areas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'skip_tarefas_auxiliar_id_fkey'
            columns: ['auxiliar_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'skip_tarefas_responsavel_id_fkey'
            columns: ['responsavel_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      tarefas: {
        Row: {
          alerta_status: boolean | null
          area_id: string | null
          auxiliar_id: string | null
          cliente_nome: string | null
          created_at: string
          descricao: string | null
          id: string
          numero_caso: string | null
          origem: string | null
          prazo: string | null
          prioridade: string | null
          responsavel_id: string | null
          status: string | null
          tipo_servico: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          alerta_status?: boolean | null
          area_id?: string | null
          auxiliar_id?: string | null
          cliente_nome?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          numero_caso?: string | null
          origem?: string | null
          prazo?: string | null
          prioridade?: string | null
          responsavel_id?: string | null
          status?: string | null
          tipo_servico?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          alerta_status?: boolean | null
          area_id?: string | null
          auxiliar_id?: string | null
          cliente_nome?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          numero_caso?: string | null
          origem?: string | null
          prazo?: string | null
          prioridade?: string | null
          responsavel_id?: string | null
          status?: string | null
          tipo_servico?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tarefas_area_id_fkey'
            columns: ['area_id']
            isOneToOne: false
            referencedRelation: 'areas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tarefas_auxiliar_id_fkey'
            columns: ['auxiliar_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tarefas_responsavel_id_fkey'
            columns: ['responsavel_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      task_controle_contadores_caso: {
        Row: {
          created_at: string
          nome_controle_id: string
          ultimo_numero: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          nome_controle_id: string
          ultimo_numero?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          nome_controle_id?: string
          ultimo_numero?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_controle_contadores_caso_nome_controle_fk'
            columns: ['nome_controle_id']
            isOneToOne: true
            referencedRelation: 'task_nomes_controle'
            referencedColumns: ['id']
          },
        ]
      }
      task_email_notificacoes: {
        Row: {
          cc_email: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          event_key: string
          executor_usuario_id: string
          id: string
          responsavel_usuario_id: string | null
          sent_at: string | null
          status: string
          subject: string
          tarefa_id: string
          tipo: string
          to_email: string
        }
        Insert: {
          cc_email?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          event_key: string
          executor_usuario_id: string
          id?: string
          responsavel_usuario_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          tarefa_id: string
          tipo: string
          to_email: string
        }
        Update: {
          cc_email?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          event_key?: string
          executor_usuario_id?: string
          id?: string
          responsavel_usuario_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          tarefa_id?: string
          tipo?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_email_notificacoes_executor_fkey'
            columns: ['executor_usuario_id']
            isOneToOne: false
            referencedRelation: 'task_usuarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_email_notificacoes_responsavel_fkey'
            columns: ['responsavel_usuario_id']
            isOneToOne: false
            referencedRelation: 'task_usuarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_email_notificacoes_tarefa_fkey'
            columns: ['tarefa_id']
            isOneToOne: false
            referencedRelation: 'task_tarefas'
            referencedColumns: ['id']
          },
        ]
      }
      task_importacao_natura_pendencias: {
        Row: {
          andamentos_origem: string | null
          controle_importado_at: string | null
          created_at: string
          identificacao_caso: string
          linha_origem: number
          pasta_cliente: string | null
          pasta_ricci: string | null
          prazo_conclusao: string | null
          providencia_importada_at: string | null
          proxima_providencia: string
          status_origem: string | null
          status_providencia_codigo: string
          tarefa_id: string | null
          tipo_prazo_codigo: string | null
          updated_at: string
        }
        Insert: {
          andamentos_origem?: string | null
          controle_importado_at?: string | null
          created_at?: string
          identificacao_caso: string
          linha_origem: number
          pasta_cliente?: string | null
          pasta_ricci?: string | null
          prazo_conclusao?: string | null
          providencia_importada_at?: string | null
          proxima_providencia: string
          status_origem?: string | null
          status_providencia_codigo: string
          tarefa_id?: string | null
          tipo_prazo_codigo?: string | null
          updated_at?: string
        }
        Update: {
          andamentos_origem?: string | null
          controle_importado_at?: string | null
          created_at?: string
          identificacao_caso?: string
          linha_origem?: number
          pasta_cliente?: string | null
          pasta_ricci?: string | null
          prazo_conclusao?: string | null
          providencia_importada_at?: string | null
          proxima_providencia?: string
          status_origem?: string | null
          status_providencia_codigo?: string
          tarefa_id?: string | null
          tipo_prazo_codigo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_importacao_natura_pendencias_tarefa_id_fkey'
            columns: ['tarefa_id']
            isOneToOne: false
            referencedRelation: 'task_tarefas'
            referencedColumns: ['id']
          },
        ]
      }
      task_nomes_controle: {
        Row: {
          ativo: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          nome: string
          nome_normalizado: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          nome: string
          nome_normalizado?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          nome?: string
          nome_normalizado?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      task_providencias: {
        Row: {
          created_at: string
          created_by: string | null
          data_conclusao: string | null
          deleted_at: string | null
          deleted_by: string | null
          email_alerta_atraso: boolean
          email_alerta_atualizacao: boolean
          email_alerta_inclusao: boolean
          email_alertas: boolean
          id: string
          ordem: number
          prazo_conclusao: string
          providencia: string
          status_id: string
          tarefa_id: string
          tipo_prazo_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_conclusao?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email_alerta_atraso?: boolean
          email_alerta_atualizacao?: boolean
          email_alerta_inclusao?: boolean
          email_alertas?: boolean
          id?: string
          ordem?: number
          prazo_conclusao: string
          providencia: string
          status_id?: string
          tarefa_id: string
          tipo_prazo_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_conclusao?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email_alerta_atraso?: boolean
          email_alerta_atualizacao?: boolean
          email_alerta_inclusao?: boolean
          email_alertas?: boolean
          id?: string
          ordem?: number
          prazo_conclusao?: string
          providencia?: string
          status_id?: string
          tarefa_id?: string
          tipo_prazo_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'task_providencias_status_id_fkey'
            columns: ['status_id']
            isOneToOne: false
            referencedRelation: 'task_status_providencia'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_providencias_tarefa_id_fkey'
            columns: ['tarefa_id']
            isOneToOne: false
            referencedRelation: 'task_tarefas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_providencias_tipo_prazo_id_fkey'
            columns: ['tipo_prazo_id']
            isOneToOne: false
            referencedRelation: 'task_tipos_prazo'
            referencedColumns: ['id']
          },
        ]
      }
      task_status: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          created_by: string | null
          finaliza: boolean
          id: string
          nome: string
          ordem: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          created_by?: string | null
          finaliza?: boolean
          id?: string
          nome: string
          ordem?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          created_by?: string | null
          finaliza?: boolean
          id?: string
          nome?: string
          ordem?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      task_status_providencia: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          created_by: string | null
          finaliza: boolean
          id: string
          nome: string
          ordem: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          created_by?: string | null
          finaliza?: boolean
          id?: string
          nome: string
          ordem?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          created_by?: string | null
          finaliza?: boolean
          id?: string
          nome?: string
          ordem?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      task_tarefas: {
        Row: {
          arquivado_at: string | null
          created_at: string
          created_by: string | null
          data_autorizacao: string | null
          deleted_at: string | null
          deleted_by: string | null
          executor_usuario_id: string
          id: string
          identificacao_caso: string
          nome_controle_id: string
          numero_caso: number
          pasta_cliente: string | null
          pasta_ricci: string | null
          prazo_conclusao: string | null
          responsavel_usuario_id: string
          status_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          arquivado_at?: string | null
          created_at?: string
          created_by?: string | null
          data_autorizacao?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          executor_usuario_id: string
          id?: string
          identificacao_caso: string
          nome_controle_id: string
          numero_caso: number
          pasta_cliente?: string | null
          pasta_ricci?: string | null
          prazo_conclusao?: string | null
          responsavel_usuario_id: string
          status_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          arquivado_at?: string | null
          created_at?: string
          created_by?: string | null
          data_autorizacao?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          executor_usuario_id?: string
          id?: string
          identificacao_caso?: string
          nome_controle_id?: string
          numero_caso?: number
          pasta_cliente?: string | null
          pasta_ricci?: string | null
          prazo_conclusao?: string | null
          responsavel_usuario_id?: string
          status_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'task_tarefas_executor_task_usuario_fkey'
            columns: ['executor_usuario_id']
            isOneToOne: false
            referencedRelation: 'task_usuarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_tarefas_nome_controle_id_fkey'
            columns: ['nome_controle_id']
            isOneToOne: false
            referencedRelation: 'task_nomes_controle'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_tarefas_responsavel_task_usuario_fkey'
            columns: ['responsavel_usuario_id']
            isOneToOne: false
            referencedRelation: 'task_usuarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_tarefas_status_id_fkey'
            columns: ['status_id']
            isOneToOne: false
            referencedRelation: 'task_status'
            referencedColumns: ['id']
          },
        ]
      }
      task_tipos_prazo: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          created_by: string | null
          id: string
          nome: string
          ordem: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          created_by?: string | null
          id?: string
          nome: string
          ordem?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          created_by?: string | null
          id?: string
          nome?: string
          ordem?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      task_usuarios: {
        Row: {
          ativo: boolean
          created_at: string
          email: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          email?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hard_delete_manychat_contato: {
        Args: { p_contato_id: string }
        Returns: undefined
      }
      is_socio_gestor: { Args: never; Returns: boolean }
      soft_delete_manychat_contato: {
        Args: { p_contato_id: string }
        Returns: undefined
      }
      task_listar_usuarios_ativos: {
        Args: never
        Returns: {
          id: string
          nome: string
        }[]
      }
      task_normalizar_nome: { Args: { p_valor: string }; Returns: string }
      task_status_padrao_id: { Args: never; Returns: string }
      task_status_providencia_padrao_id: { Args: never; Returns: string }
    }
    Enums: {
      perfil_type: 'socio_gestor' | 'gestor_area' | 'advogado' | 'estagiario' | 'administrativo'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      perfil_type: ['socio_gestor', 'gestor_area', 'advogado', 'estagiario', 'administrativo'],
    },
  },
} as const
