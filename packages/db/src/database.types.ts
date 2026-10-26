export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_threads: {
        Row: {
          created_at: string
          id: string
          messages: Json
          org_id: string | null
          request_id: string | null
          surface: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          org_id?: string | null
          request_id?: string | null
          surface?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          org_id?: string | null
          request_id?: string | null
          surface?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_threads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          cost_usd: number | null
          created_at: string
          feature: string
          id: number
          input_tokens: number
          latency_ms: number | null
          model: string
          org_id: string | null
          output_tokens: number
          success: boolean
          user_id: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          feature: string
          id?: never
          input_tokens?: number
          latency_ms?: number | null
          model: string
          org_id?: string | null
          output_tokens?: number
          success?: boolean
          user_id?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          feature?: string
          id?: never
          input_tokens?: number
          latency_ms?: number | null
          model?: string
          org_id?: string | null
          output_tokens?: number
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          org_id: string
          prefix: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          org_id: string
          prefix: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          prefix?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          created_at: string
          customer_id: string
          decided_at: string | null
          decision_note: string | null
          declarations: Json
          disclosure_id: string | null
          id: string
          quote_id: string
          request_id: string
          selected_benefits: Json
          status: Database["public"]["Enums"]["application_status"]
          submitted_at: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          decided_at?: string | null
          decision_note?: string | null
          declarations?: Json
          disclosure_id?: string | null
          id?: string
          quote_id: string
          request_id: string
          selected_benefits?: Json
          status?: Database["public"]["Enums"]["application_status"]
          submitted_at?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          decided_at?: string | null
          decision_note?: string | null
          declarations?: Json
          disclosure_id?: string | null
          id?: string
          quote_id?: string
          request_id?: string
          selected_benefits?: Json
          status?: Database["public"]["Enums"]["application_status"]
          submitted_at?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_disclosure_id_fkey"
            columns: ["disclosure_id"]
            isOneToOne: false
            referencedRelation: "broker_disclosures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          data: Json
          entity_id: string | null
          entity_type: string
          hash: string
          id: number
          occurred_at: string
          org_id: string | null
          prev_hash: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          data?: Json
          entity_id?: string | null
          entity_type: string
          hash: string
          id?: never
          occurred_at?: string
          org_id?: string | null
          prev_hash?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          data?: Json
          entity_id?: string | null
          entity_type?: string
          hash?: string
          id?: never
          occurred_at?: string
          org_id?: string | null
          prev_hash?: string | null
        }
        Relationships: []
      }
      broker_disclosures: {
        Row: {
          acknowledged_at: string
          broker_org_id: string
          disclosure_text: string
          id: string
          method: string
          request_id: string
          shown_to: string
          stage: string
        }
        Insert: {
          acknowledged_at?: string
          broker_org_id: string
          disclosure_text: string
          id?: string
          method?: string
          request_id: string
          shown_to: string
          stage?: string
        }
        Update: {
          acknowledged_at?: string
          broker_org_id?: string
          disclosure_text?: string
          id?: string
          method?: string
          request_id?: string
          shown_to?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_disclosures_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_disclosures_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_routing_rules: {
        Row: {
          active: boolean
          broker_org_id: string
          category_id: string
          created_at: string
          daily_capacity: number | null
          id: string
          is_secondary: boolean
          priority: number
          regions: string[]
          segments: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          broker_org_id: string
          category_id: string
          created_at?: string
          daily_capacity?: number | null
          id?: string
          is_secondary?: boolean
          priority?: number
          regions?: string[]
          segments?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          broker_org_id?: string
          category_id?: string
          created_at?: string
          daily_capacity?: number | null
          id?: string
          is_secondary?: boolean
          priority?: number
          regions?: string[]
          segments?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_routing_rules_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_routing_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_events: {
        Row: {
          actor_id: string | null
          actor_party: Database["public"]["Enums"]["party"]
          claim_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["claim_status"] | null
          id: number
          note: string | null
          to_status: Database["public"]["Enums"]["claim_status"] | null
          visible_to_customer: boolean
        }
        Insert: {
          actor_id?: string | null
          actor_party?: Database["public"]["Enums"]["party"]
          claim_id: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["claim_status"] | null
          id?: never
          note?: string | null
          to_status?: Database["public"]["Enums"]["claim_status"] | null
          visible_to_customer?: boolean
        }
        Update: {
          actor_id?: string | null
          actor_party?: Database["public"]["Enums"]["party"]
          claim_id?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["claim_status"] | null
          id?: never
          note?: string | null
          to_status?: Database["public"]["Enums"]["claim_status"] | null
          visible_to_customer?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "claim_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          acknowledged_at: string | null
          amount_claimed: number | null
          broker_org_id: string | null
          completeness: Json | null
          created_at: string
          customer_id: string
          decision_amount: number | null
          decision_at: string | null
          decision_by: string | null
          decision_note: string | null
          delivered_to_insurer_at: string | null
          description: string | null
          id: string
          incident_at: string | null
          incident_type: string
          insurer_org_id: string
          insurer_reference: string | null
          location: string | null
          paid_at: string | null
          policy_id: string
          reference: string
          reported_at: string | null
          required_evidence: Json
          status: Database["public"]["Enums"]["claim_status"]
          third_parties: Json
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          amount_claimed?: number | null
          broker_org_id?: string | null
          completeness?: Json | null
          created_at?: string
          customer_id: string
          decision_amount?: number | null
          decision_at?: string | null
          decision_by?: string | null
          decision_note?: string | null
          delivered_to_insurer_at?: string | null
          description?: string | null
          id?: string
          incident_at?: string | null
          incident_type: string
          insurer_org_id: string
          insurer_reference?: string | null
          location?: string | null
          paid_at?: string | null
          policy_id: string
          reference?: string
          reported_at?: string | null
          required_evidence?: Json
          status?: Database["public"]["Enums"]["claim_status"]
          third_parties?: Json
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          amount_claimed?: number | null
          broker_org_id?: string | null
          completeness?: Json | null
          created_at?: string
          customer_id?: string
          decision_amount?: number | null
          decision_at?: string | null
          decision_by?: string | null
          decision_note?: string | null
          delivered_to_insurer_at?: string | null
          description?: string | null
          id?: string
          incident_at?: string | null
          incident_type?: string
          insurer_org_id?: string
          insurer_reference?: string | null
          location?: string | null
          paid_at?: string | null
          policy_id?: string
          reference?: string
          reported_at?: string | null
          required_evidence?: Json
          status?: Database["public"]["Enums"]["claim_status"]
          third_parties?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claims_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      complaint_events: {
        Row: {
          actor_id: string | null
          actor_party: Database["public"]["Enums"]["party"]
          complaint_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["complaint_status"] | null
          id: number
          note: string | null
          to_status: Database["public"]["Enums"]["complaint_status"] | null
        }
        Insert: {
          actor_id?: string | null
          actor_party?: Database["public"]["Enums"]["party"]
          complaint_id: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["complaint_status"] | null
          id?: never
          note?: string | null
          to_status?: Database["public"]["Enums"]["complaint_status"] | null
        }
        Update: {
          actor_id?: string | null
          actor_party?: Database["public"]["Enums"]["party"]
          complaint_id?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["complaint_status"] | null
          id?: never
          note?: string | null
          to_status?: Database["public"]["Enums"]["complaint_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "complaint_events_complaint_id_fkey"
            columns: ["complaint_id"]
            isOneToOne: false
            referencedRelation: "complaints"
            referencedColumns: ["id"]
          },
        ]
      }
      complaints: {
        Row: {
          acknowledged_at: string | null
          against_party: Database["public"]["Enums"]["party"]
          assigned_to: string | null
          category: string
          claim_id: string | null
          created_at: string
          customer_id: string
          description: string
          desired_outcome: string | null
          due_at: string
          escalated_at: string | null
          id: string
          outcome: string | null
          owner_org_id: string | null
          policy_id: string | null
          reference: string
          request_id: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["complaint_status"]
          subject: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          against_party?: Database["public"]["Enums"]["party"]
          assigned_to?: string | null
          category: string
          claim_id?: string | null
          created_at?: string
          customer_id: string
          description: string
          desired_outcome?: string | null
          due_at?: string
          escalated_at?: string | null
          id?: string
          outcome?: string | null
          owner_org_id?: string | null
          policy_id?: string | null
          reference?: string
          request_id?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["complaint_status"]
          subject: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          against_party?: Database["public"]["Enums"]["party"]
          assigned_to?: string | null
          category?: string
          claim_id?: string | null
          created_at?: string
          customer_id?: string
          description?: string
          desired_outcome?: string | null
          due_at?: string
          escalated_at?: string | null
          id?: string
          outcome?: string | null
          owner_org_id?: string | null
          policy_id?: string | null
          reference?: string
          request_id?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["complaint_status"]
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaints_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_owner_org_id_fkey"
            columns: ["owner_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_configs: {
        Row: {
          auth_type: string | null
          base_url: string | null
          config: Json
          created_at: string
          id: string
          insurer_org_id: string
          last_error: string | null
          last_success_at: string | null
          level: Database["public"]["Enums"]["integration_level"]
          status: string
          updated_at: string
        }
        Insert: {
          auth_type?: string | null
          base_url?: string | null
          config?: Json
          created_at?: string
          id?: string
          insurer_org_id: string
          last_error?: string | null
          last_success_at?: string | null
          level?: Database["public"]["Enums"]["integration_level"]
          status?: string
          updated_at?: string
        }
        Update: {
          auth_type?: string | null
          base_url?: string | null
          config?: Json
          created_at?: string
          id?: string
          insurer_org_id?: string
          last_error?: string | null
          last_success_at?: string | null
          level?: Database["public"]["Enums"]["integration_level"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_configs_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          context: string | null
          created_at: string
          granted: boolean
          id: string
          ip_address: unknown
          type: Database["public"]["Enums"]["consent_type"]
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          granted: boolean
          id?: string
          ip_address?: unknown
          type: Database["public"]["Enums"]["consent_type"]
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          context?: string | null
          created_at?: string
          granted?: boolean
          id?: string
          ip_address?: unknown
          type?: Database["public"]["Enums"]["consent_type"]
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      customer_broker_assignments: {
        Row: {
          active: boolean
          broker_org_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          ended_at: string | null
          id: string
          note: string | null
          source: string
        }
        Insert: {
          active?: boolean
          broker_org_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          ended_at?: string | null
          id?: string
          note?: string | null
          source?: string
        }
        Update: {
          active?: boolean
          broker_org_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          ended_at?: string | null
          id?: string
          note?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_broker_assignments_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          provider: string
          token: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          provider?: string
          token: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          provider?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      document_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          kind: string
          name: string
          product_version_id: string
          status: string
          template: Json
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          kind: string
          name: string
          product_version_id: string
          status?: string
          template?: Json
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          product_version_id?: string
          status?: string
          template?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "product_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_extraction: Json | null
          bucket: string
          checksum: string | null
          claim_id: string | null
          created_at: string
          delivered_to_insurer_at: string | null
          file_name: string
          id: string
          kind: Database["public"]["Enums"]["document_kind"]
          mime_type: string | null
          owner_id: string
          policy_id: string | null
          request_id: string | null
          size_bytes: number | null
          storage_path: string
          task_id: string | null
          uploaded_by: string | null
          uploaded_by_party: Database["public"]["Enums"]["party"]
          verified: boolean
          verified_by: string | null
        }
        Insert: {
          ai_extraction?: Json | null
          bucket?: string
          checksum?: string | null
          claim_id?: string | null
          created_at?: string
          delivered_to_insurer_at?: string | null
          file_name: string
          id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          mime_type?: string | null
          owner_id: string
          policy_id?: string | null
          request_id?: string | null
          size_bytes?: number | null
          storage_path: string
          task_id?: string | null
          uploaded_by?: string | null
          uploaded_by_party?: Database["public"]["Enums"]["party"]
          verified?: boolean
          verified_by?: string | null
        }
        Update: {
          ai_extraction?: Json | null
          bucket?: string
          checksum?: string | null
          claim_id?: string | null
          created_at?: string
          delivered_to_insurer_at?: string | null
          file_name?: string
          id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          mime_type?: string | null
          owner_id?: string
          policy_id?: string | null
          request_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          task_id?: string | null
          uploaded_by?: string | null
          uploaded_by_party?: Database["public"]["Enums"]["party"]
          verified?: boolean
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_claim_fk"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "request_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string | null
          enabled: boolean
          key: string
          rules: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          key: string
          rules?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string | null
          enabled?: boolean
          key?: string
          rules?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      insurer_broker_appointments: {
        Row: {
          active: boolean
          agreement_reference: string | null
          broker_org_id: string
          category_id: string | null
          created_at: string
          ends_on: string | null
          id: string
          insurer_org_id: string
          starts_on: string | null
        }
        Insert: {
          active?: boolean
          agreement_reference?: string | null
          broker_org_id: string
          category_id?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          insurer_org_id: string
          starts_on?: string | null
        }
        Update: {
          active?: boolean
          agreement_reference?: string | null
          broker_org_id?: string
          category_id?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          insurer_org_id?: string
          starts_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurer_broker_appointments_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_broker_appointments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_broker_appointments_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insurer_line_integrations: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          direct_sales: boolean
          id: string
          insurer_org_id: string
          issuance_type: string
          level: string
          nominated_broker_org_ids: string[]
          sla_hours: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          direct_sales?: boolean
          id?: string
          insurer_org_id: string
          issuance_type?: string
          level?: string
          nominated_broker_org_ids?: string[]
          sla_hours?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          direct_sales?: boolean
          id?: string
          insurer_org_id?: string
          issuance_type?: string
          level?: string
          nominated_broker_org_ids?: string[]
          sla_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurer_line_integrations_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_line_integrations_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insurer_submissions: {
        Row: {
          broker_org_id: string
          channel: Database["public"]["Enums"]["integration_level"]
          created_at: string
          decline_reason: string | null
          external_reference: string | null
          id: string
          idempotency_key: string | null
          insurer_org_id: string
          request_id: string
          responded_at: string | null
          response_due_at: string | null
          risk_fingerprint: string
          sent_at: string | null
          status: Database["public"]["Enums"]["submission_status"]
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          broker_org_id: string
          channel?: Database["public"]["Enums"]["integration_level"]
          created_at?: string
          decline_reason?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          insurer_org_id: string
          request_id: string
          responded_at?: string | null
          response_due_at?: string | null
          risk_fingerprint: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          broker_org_id?: string
          channel?: Database["public"]["Enums"]["integration_level"]
          created_at?: string
          decline_reason?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          insurer_org_id?: string
          request_id?: string
          responded_at?: string | null
          response_due_at?: string | null
          risk_fingerprint?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurer_submissions_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_submissions_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurer_submissions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          team: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          team?: string | null
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          team?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          currency: string
          due_on: string | null
          id: string
          issued_at: string | null
          lines: Json
          number: string
          org_id: string
          paid_at: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax: number
          total: number
        }
        Insert: {
          created_at?: string
          currency?: string
          due_on?: string | null
          id?: string
          issued_at?: string | null
          lines?: Json
          number: string
          org_id: string
          paid_at?: string | null
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax?: number
          total?: number
        }
        Update: {
          created_at?: string
          currency?: string
          due_on?: string | null
          id?: string
          issued_at?: string | null
          lines?: Json
          number?: string
          org_id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_verifications: {
        Row: {
          created_at: string
          id: string
          id_number: string | null
          method: string
          provider: string | null
          provider_reference: string | null
          result: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["kyc_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          id_number?: string | null
          method?: string
          provider?: string | null
          provider_reference?: string | null
          result?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["kyc_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          id_number?: string | null
          method?: string
          provider?: string | null
          provider_reference?: string | null
          result?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["kyc_status"]
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          category_slug: string | null
          created_at: string
          email: string | null
          id: string
          kind: Database["public"]["Enums"]["lead_kind"]
          message: string | null
          name: string
          notes: string | null
          organization: string | null
          phone: string | null
          source_page: string | null
          status: string
          utm: Json
        }
        Insert: {
          category_slug?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["lead_kind"]
          message?: string | null
          name: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          source_page?: string | null
          status?: string
          utm?: Json
        }
        Update: {
          category_slug?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["lead_kind"]
          message?: string | null
          name?: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          source_page?: string | null
          status?: string
          utm?: Json
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          amount: number
          counterparty_org_id: string | null
          created_at: string
          currency: string
          entry_type: string
          id: number
          memo: string | null
          org_id: string
          payment_id: string | null
          policy_id: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          counterparty_org_id?: string | null
          created_at?: string
          currency?: string
          entry_type: string
          id?: never
          memo?: string | null
          org_id: string
          payment_id?: string | null
          policy_id?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          counterparty_org_id?: string | null
          created_at?: string
          currency?: string
          entry_type?: string
          id?: never
          memo?: string | null
          org_id?: string
          payment_id?: string | null
          policy_id?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_counterparty_org_id_fkey"
            columns: ["counterparty_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_supervisor: boolean
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          team: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_supervisor?: boolean
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          team?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_supervisor?: boolean
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          team?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      needs_assessments: {
        Row: {
          anonymous_id: string | null
          answers: Json
          created_at: string
          id: string
          suggested_categories: Json
          user_id: string | null
        }
        Insert: {
          anonymous_id?: string | null
          answers?: Json
          created_at?: string
          id?: string
          suggested_categories?: Json
          user_id?: string | null
        }
        Update: {
          anonymous_id?: string | null
          answers?: Json
          created_at?: string
          id?: string
          suggested_categories?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          channels: string[]
          created_at: string
          data: Json
          delivered: Json
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          channels?: string[]
          created_at?: string
          data?: Json
          delivered?: Json
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          channels?: string[]
          created_at?: string
          data?: Json
          delivered?: Json
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      order_offers: {
        Row: {
          accept_token: string
          broker_org_id: string
          created_at: string
          decline_reason: string | null
          id: string
          offered_at: string
          request_id: string
          responded_at: string | null
          responded_by: string | null
          responds_by: string
          round: number
          status: string
          updated_at: string
        }
        Insert: {
          accept_token?: string
          broker_org_id: string
          created_at?: string
          decline_reason?: string | null
          id?: string
          offered_at?: string
          request_id: string
          responded_at?: string | null
          responded_by?: string | null
          responds_by: string
          round?: number
          status?: string
          updated_at?: string
        }
        Update: {
          accept_token?: string
          broker_org_id?: string
          created_at?: string
          decline_reason?: string | null
          id?: string
          offered_at?: string
          request_id?: string
          responded_at?: string | null
          responded_by?: string | null
          responds_by?: string
          round?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_offers_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_offers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      order_routing: {
        Row: {
          broker_org_id: string | null
          candidates: Json
          complexity_flags: string[]
          created_at: string
          current_round: number
          decided_at: string
          decided_by: string
          expires_at: string | null
          id: string
          insurer_org_id: string | null
          max_rounds: number
          mode: string
          offer_batch_size: number
          offer_timeout_minutes: number
          reason: string
          request_id: string
          rule: string | null
          updated_at: string
          version: number
        }
        Insert: {
          broker_org_id?: string | null
          candidates?: Json
          complexity_flags?: string[]
          created_at?: string
          current_round?: number
          decided_at?: string
          decided_by?: string
          expires_at?: string | null
          id?: string
          insurer_org_id?: string | null
          max_rounds?: number
          mode: string
          offer_batch_size?: number
          offer_timeout_minutes?: number
          reason?: string
          request_id: string
          rule?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          broker_org_id?: string | null
          candidates?: Json
          complexity_flags?: string[]
          created_at?: string
          current_round?: number
          decided_at?: string
          decided_by?: string
          expires_at?: string | null
          id?: string
          insurer_org_id?: string | null
          max_rounds?: number
          mode?: string
          offer_batch_size?: number
          offer_timeout_minutes?: number
          reason?: string
          request_id?: string
          rule?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_routing_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_routing_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_routing_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      org_commercial_terms: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          broker_commission_pct: number
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          model: string
          notes: string | null
          org_id: string
          platform_fee_pct: number
          revenue_share_pct: number
          subscription_plan_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          broker_commission_pct?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          model: string
          notes?: string | null
          org_id: string
          platform_fee_pct?: number
          revenue_share_pct?: number
          subscription_plan_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          broker_commission_pct?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          model?: string
          notes?: string | null
          org_id?: string
          platform_fee_pct?: number
          revenue_share_pct?: number
          subscription_plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_commercial_terms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_commercial_terms_subscription_plan_id_fkey"
            columns: ["subscription_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          brand_color: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          description: string | null
          id: string
          integration_level:
            | Database["public"]["Enums"]["integration_level"]
            | null
          legal_name: string | null
          licence_verified_at: string | null
          licence_verified_by: string | null
          logo_url: string | null
          name: string
          nic_licence_class: string | null
          nic_licence_expires_on: string | null
          nic_licence_number: string | null
          paystack_split_code: string | null
          paystack_subaccount_code: string | null
          professional_indemnity_expires_on: string | null
          region: string | null
          registration_number: string | null
          require_mfa: boolean
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          type: Database["public"]["Enums"]["org_type"]
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          brand_color?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          integration_level?:
            | Database["public"]["Enums"]["integration_level"]
            | null
          legal_name?: string | null
          licence_verified_at?: string | null
          licence_verified_by?: string | null
          logo_url?: string | null
          name: string
          nic_licence_class?: string | null
          nic_licence_expires_on?: string | null
          nic_licence_number?: string | null
          paystack_split_code?: string | null
          paystack_subaccount_code?: string | null
          professional_indemnity_expires_on?: string | null
          region?: string | null
          registration_number?: string | null
          require_mfa?: boolean
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          type: Database["public"]["Enums"]["org_type"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          brand_color?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          id?: string
          integration_level?:
            | Database["public"]["Enums"]["integration_level"]
            | null
          legal_name?: string | null
          licence_verified_at?: string | null
          licence_verified_by?: string | null
          logo_url?: string | null
          name?: string
          nic_licence_class?: string | null
          nic_licence_expires_on?: string | null
          nic_licence_number?: string | null
          paystack_split_code?: string | null
          paystack_subaccount_code?: string | null
          professional_indemnity_expires_on?: string | null
          region?: string | null
          registration_number?: string | null
          require_mfa?: boolean
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          type?: Database["public"]["Enums"]["org_type"]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      payment_splits: {
        Row: {
          amount: number
          created_at: string
          id: string
          org_id: string | null
          party: string
          payment_id: string
          pct: number | null
          provider_split_ref: string | null
          settled_at: string | null
          status: string
          subaccount_code: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          org_id?: string | null
          party: string
          payment_id: string
          pct?: number | null
          provider_split_ref?: string | null
          settled_at?: string | null
          status?: string
          subaccount_code?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          org_id?: string | null
          party?: string
          payment_id?: string
          pct?: number | null
          provider_split_ref?: string | null
          settled_at?: string | null
          status?: string
          subaccount_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_splits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_splits_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          application_id: string | null
          authorization_url: string | null
          channel: Database["public"]["Enums"]["payment_channel"] | null
          created_at: string
          currency: string
          customer_id: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          paid_at: string | null
          payee_org_id: string
          policy_id: string | null
          provider: string
          provider_reference: string | null
          quote_id: string | null
          raw_event: Json | null
          reconciled: boolean
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_note: string | null
          request_id: string
          settlement_subaccount: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          application_id?: string | null
          authorization_url?: string | null
          channel?: Database["public"]["Enums"]["payment_channel"] | null
          created_at?: string
          currency?: string
          customer_id: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          paid_at?: string | null
          payee_org_id: string
          policy_id?: string | null
          provider?: string
          provider_reference?: string | null
          quote_id?: string | null
          raw_event?: Json | null
          reconciled?: boolean
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_note?: string | null
          request_id: string
          settlement_subaccount?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          application_id?: string | null
          authorization_url?: string | null
          channel?: Database["public"]["Enums"]["payment_channel"] | null
          created_at?: string
          currency?: string
          customer_id?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          paid_at?: string | null
          payee_org_id?: string
          policy_id?: string | null
          provider?: string
          provider_reference?: string | null
          quote_id?: string | null
          raw_event?: Json | null
          reconciled?: boolean
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_note?: string | null
          request_id?: string
          settlement_subaccount?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payee_org_id_fkey"
            columns: ["payee_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_policy_fk"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          audience: Database["public"]["Enums"]["org_type"]
          code: string
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          included_requests: number | null
          included_seats: number | null
          monthly_fee: number
          name: string
          per_active_policy_fee: number
          per_request_fee: number
          sort_order: number
        }
        Insert: {
          active?: boolean
          audience: Database["public"]["Enums"]["org_type"]
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          included_requests?: number | null
          included_seats?: number | null
          monthly_fee?: number
          name: string
          per_active_policy_fee?: number
          per_request_fee?: number
          sort_order?: number
        }
        Update: {
          active?: boolean
          audience?: Database["public"]["Enums"]["org_type"]
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          included_requests?: number | null
          included_seats?: number | null
          monthly_fee?: number
          name?: string
          per_active_policy_fee?: number
          per_request_fee?: number
          sort_order?: number
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      policies: {
        Row: {
          billing_period: string
          broker_org_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          category_id: string
          cover_end: string | null
          cover_start: string | null
          created_at: string
          currency: string
          customer_id: string
          excess: number | null
          external_insurer_name: string | null
          external_source: boolean
          id: string
          insured_items: Json
          insurer_org_id: string | null
          internal_reference: string
          issued_at: string | null
          issued_by: string | null
          nickname: string | null
          policy_number: string | null
          premium: number | null
          product_version_id: string | null
          quote_id: string | null
          renewal_reminders_sent: Json
          request_id: string | null
          source: string
          status: Database["public"]["Enums"]["policy_status"]
          sum_insured: number | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          billing_period?: string
          broker_org_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          category_id: string
          cover_end?: string | null
          cover_start?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          excess?: number | null
          external_insurer_name?: string | null
          external_source?: boolean
          id?: string
          insured_items?: Json
          insurer_org_id?: string | null
          internal_reference?: string
          issued_at?: string | null
          issued_by?: string | null
          nickname?: string | null
          policy_number?: string | null
          premium?: number | null
          product_version_id?: string | null
          quote_id?: string | null
          renewal_reminders_sent?: Json
          request_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["policy_status"]
          sum_insured?: number | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          billing_period?: string
          broker_org_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          category_id?: string
          cover_end?: string | null
          cover_start?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          excess?: number | null
          external_insurer_name?: string | null
          external_source?: boolean
          id?: string
          insured_items?: Json
          insurer_org_id?: string | null
          internal_reference?: string
          issued_at?: string | null
          issued_by?: string | null
          nickname?: string | null
          policy_number?: string | null
          premium?: number | null
          product_version_id?: string | null
          quote_id?: string | null
          renewal_reminders_sent?: Json
          request_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["policy_status"]
          sum_insured?: number | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "product_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          availability: Database["public"]["Enums"]["category_availability"]
          created_at: string
          default_sla_hours: number
          description: string | null
          icon: string | null
          id: string
          launch_checklist: Json
          name: string
          regulatory_note: string | null
          required_documents: Database["public"]["Enums"]["document_kind"][]
          risk_schema: Json
          segment: string
          short_description: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          availability?: Database["public"]["Enums"]["category_availability"]
          created_at?: string
          default_sla_hours?: number
          description?: string | null
          icon?: string | null
          id?: string
          launch_checklist?: Json
          name: string
          regulatory_note?: string | null
          required_documents?: Database["public"]["Enums"]["document_kind"][]
          risk_schema?: Json
          segment?: string
          short_description?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          availability?: Database["public"]["Enums"]["category_availability"]
          created_at?: string
          default_sla_hours?: number
          description?: string | null
          icon?: string | null
          id?: string
          launch_checklist?: Json
          name?: string
          regulatory_note?: string | null
          required_documents?: Database["public"]["Enums"]["document_kind"][]
          risk_schema?: Json
          segment?: string
          short_description?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      product_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          change_summary: string | null
          claims_process: string | null
          compliance_notes: string | null
          compliance_status: string
          conditions: string | null
          coverage: Json
          created_at: string
          effective_from: string
          effective_to: string | null
          excesses: Json
          exclusions: string[]
          id: string
          insurer_approved_at: string | null
          issuance_type: string
          key_exclusion: string | null
          limits: Json
          optional_benefits: Json
          product_id: string
          rating: Json
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scheduled_effective_from: string | null
          sla_hours: number | null
          status: Database["public"]["Enums"]["product_status"]
          submitted_by: string | null
          supersedes_version_id: string | null
          version: number
          waiting_period_days: number
          wording_url: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          change_summary?: string | null
          claims_process?: string | null
          compliance_notes?: string | null
          compliance_status?: string
          conditions?: string | null
          coverage?: Json
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          excesses?: Json
          exclusions?: string[]
          id?: string
          insurer_approved_at?: string | null
          issuance_type?: string
          key_exclusion?: string | null
          limits?: Json
          optional_benefits?: Json
          product_id: string
          rating?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scheduled_effective_from?: string | null
          sla_hours?: number | null
          status?: Database["public"]["Enums"]["product_status"]
          submitted_by?: string | null
          supersedes_version_id?: string | null
          version: number
          waiting_period_days?: number
          wording_url?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          change_summary?: string | null
          claims_process?: string | null
          compliance_notes?: string | null
          compliance_status?: string
          conditions?: string | null
          coverage?: Json
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          excesses?: Json
          exclusions?: string[]
          id?: string
          insurer_approved_at?: string | null
          issuance_type?: string
          key_exclusion?: string | null
          limits?: Json
          optional_benefits?: Json
          product_id?: string
          rating?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scheduled_effective_from?: string | null
          sla_hours?: number | null
          status?: Database["public"]["Enums"]["product_status"]
          submitted_by?: string | null
          supersedes_version_id?: string | null
          version?: number
          waiting_period_days?: number
          wording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_versions_supersedes_version_id_fkey"
            columns: ["supersedes_version_id"]
            isOneToOne: false
            referencedRelation: "product_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string
          code: string
          created_at: string
          current_version_id: string | null
          data_owner_id: string | null
          id: string
          insurer_org_id: string
          name: string
          status: Database["public"]["Enums"]["product_status"]
          summary: string | null
          tier: string | null
          updated_at: string
        }
        Insert: {
          category_id: string
          code: string
          created_at?: string
          current_version_id?: string | null
          data_owner_id?: string | null
          id?: string
          insurer_org_id: string
          name: string
          status?: Database["public"]["Enums"]["product_status"]
          summary?: string | null
          tier?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string
          code?: string
          created_at?: string
          current_version_id?: string | null
          data_owner_id?: string | null
          id?: string
          insurer_org_id?: string
          name?: string
          status?: Database["public"]["Enums"]["product_status"]
          summary?: string | null
          tier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "product_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          active_workspace: Json | null
          avatar_url: string | null
          business_name: string | null
          city: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          full_name: string | null
          ghana_card_number: string | null
          id: string
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          kyc_verified_at: string | null
          last_seen_platform: string | null
          locale: string
          notification_prefs: Json
          onboarded_at: string | null
          phone: string | null
          preferred_name: string | null
          region: string | null
          updated_at: string
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          active_workspace?: Json | null
          avatar_url?: string | null
          business_name?: string | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          ghana_card_number?: string | null
          id: string
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          kyc_verified_at?: string | null
          last_seen_platform?: string | null
          locale?: string
          notification_prefs?: Json
          onboarded_at?: string | null
          phone?: string | null
          preferred_name?: string | null
          region?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          active_workspace?: Json | null
          avatar_url?: string | null
          business_name?: string | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          ghana_card_number?: string | null
          id?: string
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          kyc_verified_at?: string | null
          last_seen_platform?: string | null
          locale?: string
          notification_prefs?: Json
          onboarded_at?: string | null
          phone?: string | null
          preferred_name?: string | null
          region?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      quotes: {
        Row: {
          accepted_at: string | null
          assumptions: Json
          billing_period: string
          broker_note: string | null
          broker_org_id: string | null
          commission_disclosure: string | null
          conditions: string | null
          coverage: Json
          created_at: string
          currency: string
          excess: number | null
          excesses: Json
          exclusions: string[]
          fee_breakdown: Json | null
          fees: number
          id: string
          insurer_org_id: string
          is_binding: boolean
          key_exclusion: string | null
          limits: Json
          optional_benefits: Json
          paid_placement: boolean
          premium: number
          prepared_by: string | null
          product_id: string | null
          product_version_id: string | null
          request_id: string
          revalidated_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          submission_id: string | null
          sum_insured: number | null
          taxes: number
          updated_at: string
          valid_until: string | null
          waiting_period_days: number
        }
        Insert: {
          accepted_at?: string | null
          assumptions?: Json
          billing_period?: string
          broker_note?: string | null
          broker_org_id?: string | null
          commission_disclosure?: string | null
          conditions?: string | null
          coverage?: Json
          created_at?: string
          currency?: string
          excess?: number | null
          excesses?: Json
          exclusions?: string[]
          fee_breakdown?: Json | null
          fees?: number
          id?: string
          insurer_org_id: string
          is_binding?: boolean
          key_exclusion?: string | null
          limits?: Json
          optional_benefits?: Json
          paid_placement?: boolean
          premium: number
          prepared_by?: string | null
          product_id?: string | null
          product_version_id?: string | null
          request_id: string
          revalidated_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          submission_id?: string | null
          sum_insured?: number | null
          taxes?: number
          updated_at?: string
          valid_until?: string | null
          waiting_period_days?: number
        }
        Update: {
          accepted_at?: string | null
          assumptions?: Json
          billing_period?: string
          broker_note?: string | null
          broker_org_id?: string | null
          commission_disclosure?: string | null
          conditions?: string | null
          coverage?: Json
          created_at?: string
          currency?: string
          excess?: number | null
          excesses?: Json
          exclusions?: string[]
          fee_breakdown?: Json | null
          fees?: number
          id?: string
          insurer_org_id?: string
          is_binding?: boolean
          key_exclusion?: string | null
          limits?: Json
          optional_benefits?: Json
          paid_placement?: boolean
          premium?: number
          prepared_by?: string | null
          product_id?: string | null
          product_version_id?: string | null
          request_id?: string
          revalidated_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          submission_id?: string | null
          sum_insured?: number | null
          taxes?: number
          updated_at?: string
          valid_until?: string | null
          waiting_period_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotes_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "product_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "insurer_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_rows: {
        Row: {
          created_at: string
          factors: Json
          id: string
          loadings: Json
          min_premium: number | null
          rate: number
          rate_kind: string
          rate_table_id: string
        }
        Insert: {
          created_at?: string
          factors?: Json
          id?: string
          loadings?: Json
          min_premium?: number | null
          rate: number
          rate_kind?: string
          rate_table_id: string
        }
        Update: {
          created_at?: string
          factors?: Json
          id?: string
          loadings?: Json
          min_premium?: number | null
          rate?: number
          rate_kind?: string
          rate_table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_rows_rate_table_id_fkey"
            columns: ["rate_table_id"]
            isOneToOne: false
            referencedRelation: "rate_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_tables: {
        Row: {
          base_currency: string
          created_at: string
          factor_keys: string[]
          id: string
          name: string
          product_version_id: string | null
          proposed_insurer_name: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string
          submitted_by: string | null
          submitted_by_org_id: string | null
        }
        Insert: {
          base_currency?: string
          created_at?: string
          factor_keys?: string[]
          id?: string
          name: string
          product_version_id?: string | null
          proposed_insurer_name?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          submitted_by?: string | null
          submitted_by_org_id?: string | null
        }
        Update: {
          base_currency?: string
          created_at?: string
          factor_keys?: string[]
          id?: string
          name?: string
          product_version_id?: string | null
          proposed_insurer_name?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          submitted_by?: string | null
          submitted_by_org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_tables_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "product_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_tables_submitted_by_org_id_fkey"
            columns: ["submitted_by_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_runs: {
        Row: {
          ai_model: string | null
          created_at: string
          criteria: Json
          engine_version: string
          explanation: string | null
          id: string
          inputs: Json
          insurers_compared: number
          labels: Json
          material_exclusions: Json
          needs_assessment_id: string | null
          products_considered: Json
          request_id: string | null
          scores: Json
        }
        Insert: {
          ai_model?: string | null
          created_at?: string
          criteria: Json
          engine_version: string
          explanation?: string | null
          id?: string
          inputs: Json
          insurers_compared?: number
          labels?: Json
          material_exclusions?: Json
          needs_assessment_id?: string | null
          products_considered: Json
          request_id?: string | null
          scores: Json
        }
        Update: {
          ai_model?: string | null
          created_at?: string
          criteria?: Json
          engine_version?: string
          explanation?: string | null
          id?: string
          inputs?: Json
          insurers_compared?: number
          labels?: Json
          material_exclusions?: Json
          needs_assessment_id?: string | null
          products_considered?: Json
          request_id?: string | null
          scores?: Json
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_runs_needs_assessment_id_fkey"
            columns: ["needs_assessment_id"]
            isOneToOne: false
            referencedRelation: "needs_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_runs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_events: {
        Row: {
          actor_id: string | null
          actor_party: Database["public"]["Enums"]["party"]
          created_at: string
          data: Json
          event: string
          from_status: Database["public"]["Enums"]["request_status"] | null
          id: number
          note: string | null
          request_id: string
          to_status: Database["public"]["Enums"]["request_status"] | null
          visible_to_customer: boolean
        }
        Insert: {
          actor_id?: string | null
          actor_party?: Database["public"]["Enums"]["party"]
          created_at?: string
          data?: Json
          event: string
          from_status?: Database["public"]["Enums"]["request_status"] | null
          id?: never
          note?: string | null
          request_id: string
          to_status?: Database["public"]["Enums"]["request_status"] | null
          visible_to_customer?: boolean
        }
        Update: {
          actor_id?: string | null
          actor_party?: Database["public"]["Enums"]["party"]
          created_at?: string
          data?: Json
          event?: string
          from_status?: Database["public"]["Enums"]["request_status"] | null
          id?: never
          note?: string | null
          request_id?: string
          to_status?: Database["public"]["Enums"]["request_status"] | null
          visible_to_customer?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_messages: {
        Row: {
          attachments: Json
          body: string
          created_at: string
          id: string
          internal: boolean
          read_by_broker_at: string | null
          read_by_customer_at: string | null
          request_id: string
          sender_id: string | null
          sender_party: Database["public"]["Enums"]["party"]
        }
        Insert: {
          attachments?: Json
          body: string
          created_at?: string
          id?: string
          internal?: boolean
          read_by_broker_at?: string | null
          read_by_customer_at?: string | null
          request_id: string
          sender_id?: string | null
          sender_party: Database["public"]["Enums"]["party"]
        }
        Update: {
          attachments?: Json
          body?: string
          created_at?: string
          id?: string
          internal?: boolean
          read_by_broker_at?: string | null
          read_by_customer_at?: string | null
          request_id?: string
          sender_id?: string | null
          sender_party?: Database["public"]["Enums"]["party"]
        }
        Relationships: [
          {
            foreignKeyName: "request_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_tasks: {
        Row: {
          assigned_to: string | null
          assignee_party: Database["public"]["Enums"]["party"]
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          detail: string | null
          document_kind: Database["public"]["Enums"]["document_kind"] | null
          due_at: string | null
          id: string
          kind: Database["public"]["Enums"]["task_kind"]
          request_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Insert: {
          assigned_to?: string | null
          assignee_party?: Database["public"]["Enums"]["party"]
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          detail?: string | null
          document_kind?: Database["public"]["Enums"]["document_kind"] | null
          due_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["task_kind"]
          request_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Update: {
          assigned_to?: string | null
          assignee_party?: Database["public"]["Enums"]["party"]
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          detail?: string | null
          document_kind?: Database["public"]["Enums"]["document_kind"] | null
          due_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          request_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_tasks_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          assigned_to: string | null
          broker_org_id: string | null
          business_org_id: string | null
          cancelled_reason: string | null
          category_id: string
          completed_at: string | null
          complexity_flags: string[]
          created_at: string
          customer_id: string
          due_at: string | null
          id: string
          needs_adviser_review: boolean
          needs_assessment_id: string | null
          next_step: string | null
          priority: number
          reference: string
          related_policy_id: string | null
          risk_data: Json
          risk_fingerprint: string | null
          routing_mode: string | null
          sla_breached_at: string | null
          source: Database["public"]["Enums"]["request_source"]
          source_broker_org_id: string | null
          status: Database["public"]["Enums"]["request_status"]
          submitted_at: string | null
          talk_to_expert: boolean
          team: string | null
          title: string | null
          type: Database["public"]["Enums"]["request_type"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          broker_org_id?: string | null
          business_org_id?: string | null
          cancelled_reason?: string | null
          category_id: string
          completed_at?: string | null
          complexity_flags?: string[]
          created_at?: string
          customer_id: string
          due_at?: string | null
          id?: string
          needs_adviser_review?: boolean
          needs_assessment_id?: string | null
          next_step?: string | null
          priority?: number
          reference?: string
          related_policy_id?: string | null
          risk_data?: Json
          risk_fingerprint?: string | null
          routing_mode?: string | null
          sla_breached_at?: string | null
          source?: Database["public"]["Enums"]["request_source"]
          source_broker_org_id?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          submitted_at?: string | null
          talk_to_expert?: boolean
          team?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["request_type"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          broker_org_id?: string | null
          business_org_id?: string | null
          cancelled_reason?: string | null
          category_id?: string
          completed_at?: string | null
          complexity_flags?: string[]
          created_at?: string
          customer_id?: string
          due_at?: string | null
          id?: string
          needs_adviser_review?: boolean
          needs_assessment_id?: string | null
          next_step?: string | null
          priority?: number
          reference?: string
          related_policy_id?: string | null
          risk_data?: Json
          risk_fingerprint?: string | null
          routing_mode?: string | null
          sla_breached_at?: string | null
          source?: Database["public"]["Enums"]["request_source"]
          source_broker_org_id?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          submitted_at?: string | null
          talk_to_expert?: boolean
          team?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["request_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_business_org_id_fkey"
            columns: ["business_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_needs_assessment_id_fkey"
            columns: ["needs_assessment_id"]
            isOneToOne: false
            referencedRelation: "needs_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_related_policy_fk"
            columns: ["related_policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_source_broker_org_id_fkey"
            columns: ["source_broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_lines: {
        Row: {
          id: number
          ledger_entry_id: number
          statement_id: string
        }
        Insert: {
          id?: never
          ledger_entry_id: number
          statement_id: string
        }
        Update: {
          id?: never
          ledger_entry_id?: number
          statement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_lines_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "settlement_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_statements: {
        Row: {
          commission: number
          created_at: string
          currency: string
          gross_premium: number
          id: string
          issued_at: string | null
          line_count: number
          net_due: number
          org_id: string
          paid_at: string | null
          pdf_path: string | null
          period_end: string
          period_start: string
          platform_fee: number
          status: string
          updated_at: string
        }
        Insert: {
          commission?: number
          created_at?: string
          currency?: string
          gross_premium?: number
          id?: string
          issued_at?: string | null
          line_count?: number
          net_due?: number
          org_id: string
          paid_at?: string | null
          pdf_path?: string | null
          period_end: string
          period_start: string
          platform_fee?: number
          status?: string
          updated_at?: string
        }
        Update: {
          commission?: number
          created_at?: string
          currency?: string
          gross_premium?: number
          id?: string
          issued_at?: string | null
          line_count?: number
          net_due?: number
          org_id?: string
          paid_at?: string | null
          pdf_path?: string | null
          period_end?: string
          period_start?: string
          platform_fee?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_statements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          org_id: string
          plan_id: string
          provider_reference: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_on: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          org_id: string
          plan_id: string
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_on?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          org_id?: string
          plan_id?: string
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      underwriting_rules: {
        Row: {
          active: boolean
          condition: Json
          created_at: string
          id: string
          message: string | null
          name: string
          outcome: string
          priority: number
          product_version_id: string
        }
        Insert: {
          active?: boolean
          condition?: Json
          created_at?: string
          id?: string
          message?: string | null
          name: string
          outcome?: string
          priority?: number
          product_version_id: string
        }
        Update: {
          active?: boolean
          condition?: Json
          created_at?: string
          id?: string
          message?: string | null
          name?: string
          outcome?: string
          priority?: number
          product_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "underwriting_rules_product_version_id_fkey"
            columns: ["product_version_id"]
            isOneToOne: false
            referencedRelation: "product_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          details: Json
          id: number
          metric: string
          occurred_at: string
          org_id: string
          quantity: number
          reference_id: string | null
        }
        Insert: {
          details?: Json
          id?: never
          metric: string
          occurred_at?: string
          org_id: string
          quantity?: number
          reference_id?: string | null
        }
        Update: {
          details?: Json
          id?: never
          metric?: string
          occurred_at?: string
          org_id?: string
          quantity?: number
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event: string
          id: number
          last_error: string | null
          next_attempt_at: string | null
          payload: Json
          response_ms: number | null
          status: number | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id: string
          event: string
          id?: never
          last_error?: string | null
          next_attempt_at?: string | null
          payload: Json
          response_ms?: number | null
          status?: number | null
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id?: string
          event?: string
          id?: never
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          response_ms?: number | null
          status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          active: boolean
          created_at: string
          events: string[]
          id: string
          last_delivery_at: string | null
          last_status: number | null
          org_id: string
          secret: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          events?: string[]
          id?: string
          last_delivery_at?: string | null
          last_status?: number | null
          org_id: string
          secret?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          events?: string[]
          id?: string
          last_delivery_at?: string | null
          last_status?: number | null
          org_id?: string
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { p_token: string }
        Returns: {
          org_id: string
          org_name: string
          org_slug: string
          org_type: Database["public"]["Enums"]["org_type"]
          role: Database["public"]["Enums"]["member_role"]
        }[]
      }
      accept_order_offer: {
        Args: { p_offer_id?: string; p_token?: string }
        Returns: {
          broker_org_id: string
          customer_id: string
          offer_id: string
          reference: string
          request_id: string
          round: number
        }[]
      }
      activate_scheduled_versions: { Args: never; Returns: number }
      build_settlement_statement: {
        Args: { p_end: string; p_org: string; p_start: string }
        Returns: string
      }
      complete_broker_change: {
        Args: { p_broker_org_id?: string; p_request: string }
        Returns: {
          customer_id: string
          from_broker_org_id: string
          reference: string
          request_id: string
          to_broker_name: string
          to_broker_org_id: string
        }[]
      }
      decline_order_offer: {
        Args: { p_offer_id: string; p_reason?: string }
        Returns: {
          broker_org_id: string
          offer_id: string
          open_offers: number
          request_id: string
          round: number
        }[]
      }
      find_customer_for_partner: {
        Args: { p_email?: string; p_phone?: string }
        Returns: {
          email: string
          full_name: string
          id: string
          phone: string
        }[]
      }
      invitation_preview: {
        Args: { p_token: string }
        Returns: {
          accepted_at: string
          email: string
          expires_at: string
          invited_by_name: string
          org_id: string
          org_name: string
          org_slug: string
          org_type: Database["public"]["Enums"]["org_type"]
          role: Database["public"]["Enums"]["member_role"]
          team: string
        }[]
      }
      list_my_sessions: {
        Args: never
        Returns: {
          aal: string
          created_at: string
          id: string
          ip: string
          not_after: string
          updated_at: string
          user_agent: string
        }[]
      }
      request_routing_mode: { Args: { p_request: string }; Returns: string }
      set_commercial_terms: {
        Args: {
          p_broker_commission_pct?: number
          p_effective_from?: string
          p_model: string
          p_notes?: string
          p_org: string
          p_platform_fee_pct?: number
          p_revenue_share_pct?: number
          p_subscription_plan_id?: string
        }
        Returns: string
      }
      transition_settlement_statement: {
        Args: { p_id: string; p_status: string }
        Returns: undefined
      }
      verify_audit_chain: {
        Args: { p_limit?: number }
        Returns: {
          checked: number
          first_bad_id: number
          ok: boolean
        }[]
      }
    }
    Enums: {
      account_type: "individual" | "business"
      application_status:
        | "draft"
        | "submitted"
        | "accepted"
        | "rejected"
        | "withdrawn"
      category_availability: "integrated" | "broker_assisted" | "planned"
      claim_status:
        | "draft"
        | "reported"
        | "delivered_to_insurer"
        | "acknowledged"
        | "under_assessment"
        | "info_requested"
        | "approved"
        | "partially_approved"
        | "rejected"
        | "paid"
        | "closed"
        | "withdrawn"
      complaint_status:
        | "open"
        | "acknowledged"
        | "investigating"
        | "resolved"
        | "escalated_nic"
        | "closed"
      consent_type:
        | "terms"
        | "privacy"
        | "marketing"
        | "data_sharing_broker"
        | "data_sharing_insurer"
        | "ai_assistance"
      document_kind:
        | "id_document"
        | "vehicle_registration"
        | "drivers_licence"
        | "photo"
        | "proof_of_address"
        | "medical"
        | "policy_schedule"
        | "certificate"
        | "policy_wording"
        | "receipt"
        | "endorsement"
        | "claim_evidence"
        | "police_report"
        | "invoice"
        | "other"
      integration_level: "portal" | "quote_api" | "policy_api"
      invoice_status: "draft" | "issued" | "paid" | "void" | "overdue"
      kyc_status: "unverified" | "pending" | "verified" | "rejected"
      lead_kind:
        | "customer"
        | "broker"
        | "insurer"
        | "enterprise"
        | "press"
        | "other"
      member_role:
        | "owner"
        | "admin"
        | "supervisor"
        | "adviser"
        | "underwriter"
        | "claims_officer"
        | "finance"
        | "viewer"
        | "platform_admin"
        | "platform_ops"
        | "compliance"
        | "support"
      org_status: "pending" | "active" | "suspended" | "offboarded"
      org_type: "platform" | "broker" | "insurer" | "enterprise"
      party: "customer" | "broker" | "insurer" | "platform" | "system" | "ai"
      payment_channel: "mobile_money" | "card" | "bank_transfer" | "ussd"
      payment_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "refunded"
        | "reversed"
        | "abandoned"
      policy_status:
        | "pending_issuance"
        | "active"
        | "lapsed"
        | "cancelled"
        | "expired"
        | "renewed"
      product_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "suspended"
        | "retired"
      quote_status:
        | "estimate"
        | "awaiting_underwriting"
        | "ready_to_accept"
        | "accepted"
        | "expired"
        | "declined"
        | "withdrawn"
      request_source:
        | "web"
        | "mobile"
        | "whatsapp"
        | "call_centre"
        | "admin"
        | "api"
      request_status:
        | "draft"
        | "submitted"
        | "awaiting_customer_info"
        | "adviser_action"
        | "insurer_response"
        | "quotes_ready"
        | "payment_confirmation"
        | "policy_documents"
        | "completed"
        | "cancelled"
        | "closed_no_cover"
      request_type:
        | "new_cover"
        | "renewal"
        | "switch"
        | "endorsement"
        | "service"
      submission_status:
        | "pending"
        | "sent"
        | "acknowledged"
        | "quoted"
        | "declined"
        | "error"
        | "withdrawn"
      subscription_status: "trialing" | "active" | "past_due" | "cancelled"
      task_kind: "document" | "information" | "review" | "payment" | "signature"
      task_status: "open" | "done" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["individual", "business"],
      application_status: [
        "draft",
        "submitted",
        "accepted",
        "rejected",
        "withdrawn",
      ],
      category_availability: ["integrated", "broker_assisted", "planned"],
      claim_status: [
        "draft",
        "reported",
        "delivered_to_insurer",
        "acknowledged",
        "under_assessment",
        "info_requested",
        "approved",
        "partially_approved",
        "rejected",
        "paid",
        "closed",
        "withdrawn",
      ],
      complaint_status: [
        "open",
        "acknowledged",
        "investigating",
        "resolved",
        "escalated_nic",
        "closed",
      ],
      consent_type: [
        "terms",
        "privacy",
        "marketing",
        "data_sharing_broker",
        "data_sharing_insurer",
        "ai_assistance",
      ],
      document_kind: [
        "id_document",
        "vehicle_registration",
        "drivers_licence",
        "photo",
        "proof_of_address",
        "medical",
        "policy_schedule",
        "certificate",
        "policy_wording",
        "receipt",
        "endorsement",
        "claim_evidence",
        "police_report",
        "invoice",
        "other",
      ],
      integration_level: ["portal", "quote_api", "policy_api"],
      invoice_status: ["draft", "issued", "paid", "void", "overdue"],
      kyc_status: ["unverified", "pending", "verified", "rejected"],
      lead_kind: [
        "customer",
        "broker",
        "insurer",
        "enterprise",
        "press",
        "other",
      ],
      member_role: [
        "owner",
        "admin",
        "supervisor",
        "adviser",
        "underwriter",
        "claims_officer",
        "finance",
        "viewer",
        "platform_admin",
        "platform_ops",
        "compliance",
        "support",
      ],
      org_status: ["pending", "active", "suspended", "offboarded"],
      org_type: ["platform", "broker", "insurer", "enterprise"],
      party: ["customer", "broker", "insurer", "platform", "system", "ai"],
      payment_channel: ["mobile_money", "card", "bank_transfer", "ussd"],
      payment_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "refunded",
        "reversed",
        "abandoned",
      ],
      policy_status: [
        "pending_issuance",
        "active",
        "lapsed",
        "cancelled",
        "expired",
        "renewed",
      ],
      product_status: [
        "draft",
        "pending_approval",
        "approved",
        "suspended",
        "retired",
      ],
      quote_status: [
        "estimate",
        "awaiting_underwriting",
        "ready_to_accept",
        "accepted",
        "expired",
        "declined",
        "withdrawn",
      ],
      request_source: [
        "web",
        "mobile",
        "whatsapp",
        "call_centre",
        "admin",
        "api",
      ],
      request_status: [
        "draft",
        "submitted",
        "awaiting_customer_info",
        "adviser_action",
        "insurer_response",
        "quotes_ready",
        "payment_confirmation",
        "policy_documents",
        "completed",
        "cancelled",
        "closed_no_cover",
      ],
      request_type: [
        "new_cover",
        "renewal",
        "switch",
        "endorsement",
        "service",
      ],
      submission_status: [
        "pending",
        "sent",
        "acknowledged",
        "quoted",
        "declined",
        "error",
        "withdrawn",
      ],
      subscription_status: ["trialing", "active", "past_due", "cancelled"],
      task_kind: ["document", "information", "review", "payment", "signature"],
      task_status: ["open", "done", "cancelled"],
    },
  },
} as const
