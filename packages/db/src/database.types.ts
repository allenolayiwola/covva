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
      appointment_requests: {
        Row: {
          appointment_letter_path: string | null
          broker_org_id: string
          category_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          insurer_org_id: string | null
          proposed_insurer_name: string | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_letter_path?: string | null
          broker_org_id: string
          category_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          insurer_org_id?: string | null
          proposed_insurer_name?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_letter_path?: string | null
          broker_org_id?: string
          category_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          insurer_org_id?: string | null
          proposed_insurer_name?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_requests_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_requests_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_requests_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      claim_fraud_flags: {
        Row: {
          claim_id: string
          created_at: string
          details: Json
          id: string
          kind: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          score: number
          status: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          details?: Json
          id?: string
          kind: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number
          status?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_fraud_flags_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_info_requests: {
        Row: {
          claim_id: string
          created_at: string
          document_id: string | null
          due_at: string | null
          fulfilled_at: string | null
          fulfilled_by: string | null
          id: string
          kind: string
          message: string
          requested_by: string | null
          requested_by_party: Database["public"]["Enums"]["party"]
          requested_party: Database["public"]["Enums"]["party"]
          response: string | null
        }
        Insert: {
          claim_id: string
          created_at?: string
          document_id?: string | null
          due_at?: string | null
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          kind?: string
          message: string
          requested_by?: string | null
          requested_by_party?: Database["public"]["Enums"]["party"]
          requested_party?: Database["public"]["Enums"]["party"]
          response?: string | null
        }
        Update: {
          claim_id?: string
          created_at?: string
          document_id?: string | null
          due_at?: string | null
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          kind?: string
          message?: string
          requested_by?: string | null
          requested_by_party?: Database["public"]["Enums"]["party"]
          requested_party?: Database["public"]["Enums"]["party"]
          response?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_info_requests_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_info_requests_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_jobs: {
        Row: {
          claim_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          direct_billing: boolean
          estimate: number | null
          id: string
          invoice_document_id: string | null
          kind: string
          notes: string | null
          scheduled_for: string | null
          service_partner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          claim_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          direct_billing?: boolean
          estimate?: number | null
          id?: string
          invoice_document_id?: string | null
          kind: string
          notes?: string | null
          scheduled_for?: string | null
          service_partner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          claim_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          direct_billing?: boolean
          estimate?: number | null
          id?: string
          invoice_document_id?: string | null
          kind?: string
          notes?: string | null
          scheduled_for?: string | null
          service_partner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_jobs_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_jobs_invoice_document_id_fkey"
            columns: ["invoice_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_jobs_service_partner_id_fkey"
            columns: ["service_partner_id"]
            isOneToOne: false
            referencedRelation: "service_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_messages: {
        Row: {
          attachments: Json
          author_id: string | null
          author_party: Database["public"]["Enums"]["party"]
          body: string
          claim_id: string
          created_at: string
          id: string
          internal: boolean
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          author_party?: Database["public"]["Enums"]["party"]
          body: string
          claim_id: string
          created_at?: string
          id?: string
          internal?: boolean
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          author_party?: Database["public"]["Enums"]["party"]
          body?: string
          claim_id?: string
          created_at?: string
          id?: string
          internal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "claim_messages_claim_id_fkey"
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
          fraud_score: number | null
          fraud_status: string
          id: string
          incident_at: string | null
          incident_type: string
          insurer_org_id: string
          insurer_reference: string | null
          location: string | null
          location_gps: Json | null
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
          fraud_score?: number | null
          fraud_status?: string
          id?: string
          incident_at?: string | null
          incident_type: string
          insurer_org_id: string
          insurer_reference?: string | null
          location?: string | null
          location_gps?: Json | null
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
          fraud_score?: number | null
          fraud_status?: string
          id?: string
          incident_at?: string | null
          incident_type?: string
          insurer_org_id?: string
          insurer_reference?: string | null
          location?: string | null
          location_gps?: Json | null
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
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
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
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
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
      crm_accounts: {
        Row: {
          agreement_signed_at: string | null
          application_id: string | null
          contact: Json
          created_at: string
          created_by: string | null
          estimated_value: number | null
          expected_go_live: string | null
          id: string
          kind: string
          lead_id: string | null
          live_at: string | null
          lost_reason: string | null
          name: string
          org_id: string | null
          owner_user_id: string | null
          region: string | null
          source: string
          stage: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          agreement_signed_at?: string | null
          application_id?: string | null
          contact?: Json
          created_at?: string
          created_by?: string | null
          estimated_value?: number | null
          expected_go_live?: string | null
          id?: string
          kind: string
          lead_id?: string | null
          live_at?: string | null
          lost_reason?: string | null
          name: string
          org_id?: string | null
          owner_user_id?: string | null
          region?: string | null
          source?: string
          stage?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          agreement_signed_at?: string | null
          application_id?: string | null
          contact?: Json
          created_at?: string
          created_by?: string | null
          estimated_value?: number | null
          expected_go_live?: string | null
          id?: string
          kind?: string
          lead_id?: string | null
          live_at?: string | null
          lost_reason?: string | null
          name?: string
          org_id?: string | null
          owner_user_id?: string | null
          region?: string | null
          source?: string
          stage?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_attachments: {
        Row: {
          account_id: string
          content_type: string | null
          created_at: string
          id: string
          name: string
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          account_id: string
          content_type?: string | null
          created_at?: string
          id?: string
          name: string
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          account_id?: string
          content_type?: string | null
          created_at?: string
          id?: string
          name?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_attachments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "crm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_meetings: {
        Row: {
          account_id: string
          attendees: Json
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          location: string | null
          starts_at: string
          summary: string | null
        }
        Insert: {
          account_id: string
          attendees?: Json
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          location?: string | null
          starts_at: string
          summary?: string | null
        }
        Update: {
          account_id?: string
          attendees?: Json
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          location?: string | null
          starts_at?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_meetings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "crm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notes: {
        Row: {
          account_id: string
          author_id: string | null
          body: string
          created_at: string
          id: string
          pinned: boolean
        }
        Insert: {
          account_id: string
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          pinned?: boolean
        }
        Update: {
          account_id?: string
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          pinned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crm_notes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "crm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stage_events: {
        Row: {
          account_id: string
          at: string
          by: string | null
          from_stage: string | null
          id: string
          note: string | null
          to_stage: string
        }
        Insert: {
          account_id: string
          at?: string
          by?: string | null
          from_stage?: string | null
          id?: string
          note?: string | null
          to_stage: string
        }
        Update: {
          account_id?: string
          at?: string
          by?: string | null
          from_stage?: string | null
          id?: string
          note?: string | null
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_stage_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "crm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          account_id: string
          assignee_id: string | null
          created_at: string
          created_by: string | null
          done_at: string | null
          due_at: string | null
          id: string
          reminder_sent_at: string | null
          title: string
        }
        Insert: {
          account_id: string
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          reminder_sent_at?: string | null
          title: string
        }
        Update: {
          account_id?: string
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          reminder_sent_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "crm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_broker_assignments: {
        Row: {
          account_manager_id: string | null
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
          account_manager_id?: string | null
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
          account_manager_id?: string | null
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
          duration_seconds: number | null
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
          duration_seconds?: number | null
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
          duration_seconds?: number | null
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
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
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
      fx_rates: {
        Row: {
          base: string
          created_at: string
          created_by: string | null
          fetched_at: string
          id: string
          note: string | null
          quote: string
          rate: number
          source: string
          valid_until: string | null
        }
        Insert: {
          base?: string
          created_at?: string
          created_by?: string | null
          fetched_at?: string
          id?: string
          note?: string | null
          quote: string
          rate: number
          source?: string
          valid_until?: string | null
        }
        Update: {
          base?: string
          created_at?: string
          created_by?: string | null
          fetched_at?: string
          id?: string
          note?: string | null
          quote?: string
          rate?: number
          source?: string
          valid_until?: string | null
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
          broker_org_id: string | null
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
          broker_org_id?: string | null
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
          broker_org_id?: string | null
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
      issuance_jobs: {
        Row: {
          attempts: number
          created_at: string
          documents: Json
          error: string | null
          id: string
          insurer_org_id: string
          mode: string
          nic_registration: Json
          notes: string | null
          policy_id: string
          request_id: string | null
          review_until: string | null
          status: string
          underwriting_outcome: Json
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          documents?: Json
          error?: string | null
          id?: string
          insurer_org_id: string
          mode?: string
          nic_registration?: Json
          notes?: string | null
          policy_id: string
          request_id?: string | null
          review_until?: string | null
          status?: string
          underwriting_outcome?: Json
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          documents?: Json
          error?: string | null
          id?: string
          insurer_org_id?: string
          mode?: string
          nic_registration?: Json
          notes?: string | null
          policy_id?: string
          request_id?: string | null
          review_until?: string | null
          status?: string
          underwriting_outcome?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issuance_jobs_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issuance_jobs_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: true
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
          },
          {
            foreignKeyName: "issuance_jobs_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: true
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issuance_jobs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_verifications: {
        Row: {
          checked_at: string | null
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
          checked_at?: string | null
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
          checked_at?: string | null
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
          metadata: Json
          name: string
          notes: string | null
          organization: string | null
          phone: string | null
          source_page: string | null
          status: string
          tags: string[]
          utm: Json
        }
        Insert: {
          category_slug?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["lead_kind"]
          message?: string | null
          metadata?: Json
          name: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          source_page?: string | null
          status?: string
          tags?: string[]
          utm?: Json
        }
        Update: {
          category_slug?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["lead_kind"]
          message?: string | null
          metadata?: Json
          name?: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          source_page?: string | null
          status?: string
          tags?: string[]
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
          licence_status: string
          licence_verified_at: string | null
          licence_verified_by: string | null
          logo_url: string | null
          name: string
          nic_licence_class: string | null
          nic_licence_expires_on: string | null
          nic_licence_number: string | null
          onboarding_checklist: Json
          paystack_split_code: string | null
          paystack_subaccount_code: string | null
          professional_indemnity_expires_on: string | null
          region: string | null
          registration_number: string | null
          require_mfa: boolean
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          suspended_reason: string | null
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
          licence_status?: string
          licence_verified_at?: string | null
          licence_verified_by?: string | null
          logo_url?: string | null
          name: string
          nic_licence_class?: string | null
          nic_licence_expires_on?: string | null
          nic_licence_number?: string | null
          onboarding_checklist?: Json
          paystack_split_code?: string | null
          paystack_subaccount_code?: string | null
          professional_indemnity_expires_on?: string | null
          region?: string | null
          registration_number?: string | null
          require_mfa?: boolean
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          suspended_reason?: string | null
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
          licence_status?: string
          licence_verified_at?: string | null
          licence_verified_by?: string | null
          logo_url?: string | null
          name?: string
          nic_licence_class?: string | null
          nic_licence_expires_on?: string | null
          nic_licence_number?: string | null
          onboarding_checklist?: Json
          paystack_split_code?: string | null
          paystack_subaccount_code?: string | null
          professional_indemnity_expires_on?: string | null
          region?: string | null
          registration_number?: string | null
          require_mfa?: boolean
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          suspended_reason?: string | null
          type?: Database["public"]["Enums"]["org_type"]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      partner_applications: {
        Row: {
          address: string | null
          agreement: Json
          applicant_user_id: string
          assisted_by: string | null
          commercial_model: string | null
          company_name: string | null
          compliance_contact: Json
          created_at: string
          created_org_id: string | null
          documents: Json
          id: string
          integration_levels: Json
          legal_name: string | null
          nic_licence_class: string | null
          nic_licence_expires_on: string | null
          nic_licence_number: string | null
          primary_contact: Json
          principal_officer: Json
          region: string | null
          registration_number: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          settlement_account: Json
          status: string
          submitted_at: string | null
          type: Database["public"]["Enums"]["org_type"]
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          agreement?: Json
          applicant_user_id: string
          assisted_by?: string | null
          commercial_model?: string | null
          company_name?: string | null
          compliance_contact?: Json
          created_at?: string
          created_org_id?: string | null
          documents?: Json
          id?: string
          integration_levels?: Json
          legal_name?: string | null
          nic_licence_class?: string | null
          nic_licence_expires_on?: string | null
          nic_licence_number?: string | null
          primary_contact?: Json
          principal_officer?: Json
          region?: string | null
          registration_number?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_account?: Json
          status?: string
          submitted_at?: string | null
          type: Database["public"]["Enums"]["org_type"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          agreement?: Json
          applicant_user_id?: string
          assisted_by?: string | null
          commercial_model?: string | null
          company_name?: string | null
          compliance_contact?: Json
          created_at?: string
          created_org_id?: string | null
          documents?: Json
          id?: string
          integration_levels?: Json
          legal_name?: string | null
          nic_licence_class?: string | null
          nic_licence_expires_on?: string | null
          nic_licence_number?: string | null
          primary_contact?: Json
          principal_officer?: Json
          region?: string | null
          registration_number?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_account?: Json
          status?: string
          submitted_at?: string | null
          type?: Database["public"]["Enums"]["org_type"]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_applications_created_org_id_fkey"
            columns: ["created_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_accounts: {
        Row: {
          account_name: string | null
          account_number: string
          active: boolean
          bank_name: string | null
          created_at: string
          currency: string
          customer_id: string
          id: string
          provider: string
          provider_customer_code: string | null
          raw: Json | null
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number: string
          active?: boolean
          bank_name?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          id?: string
          provider?: string
          provider_customer_code?: string | null
          raw?: Json | null
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string
          active?: boolean
          bank_name?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          provider?: string
          provider_customer_code?: string | null
          raw?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          billing_country: string | null
          brand: string | null
          created_at: string
          currency: string | null
          exp_month: number | null
          exp_year: number | null
          id: string
          is_default: boolean
          last4: string | null
          provider_customer_ref: string | null
          provider_token_ref: string
          psp: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_country?: string | null
          brand?: string | null
          created_at?: string
          currency?: string | null
          exp_month?: number | null
          exp_year?: number | null
          id?: string
          is_default?: boolean
          last4?: string | null
          provider_customer_ref?: string | null
          provider_token_ref: string
          psp: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_country?: string | null
          brand?: string | null
          created_at?: string
          currency?: string | null
          exp_month?: number | null
          exp_year?: number | null
          id?: string
          is_default?: boolean
          last4?: string | null
          provider_customer_ref?: string | null
          provider_token_ref?: string
          psp?: string
          status?: string
          updated_at?: string
          user_id?: string
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
          channel_detail: Json | null
          created_at: string
          currency: string
          customer_id: string
          display_amount: number | null
          display_currency: string | null
          failure_reason: string | null
          fx_quoted_at: string | null
          fx_rate: number | null
          fx_source: string | null
          id: string
          idempotency_key: string
          paid_at: string | null
          payee_org_id: string
          policy_id: string | null
          provider: string
          provider_reference: string | null
          psp: string | null
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
          channel_detail?: Json | null
          created_at?: string
          currency?: string
          customer_id: string
          display_amount?: number | null
          display_currency?: string | null
          failure_reason?: string | null
          fx_quoted_at?: string | null
          fx_rate?: number | null
          fx_source?: string | null
          id?: string
          idempotency_key: string
          paid_at?: string | null
          payee_org_id: string
          policy_id?: string | null
          provider?: string
          provider_reference?: string | null
          psp?: string | null
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
          channel_detail?: Json | null
          created_at?: string
          currency?: string
          customer_id?: string
          display_amount?: number | null
          display_currency?: string | null
          failure_reason?: string | null
          fx_quoted_at?: string | null
          fx_rate?: number | null
          fx_source?: string | null
          id?: string
          idempotency_key?: string
          paid_at?: string | null
          payee_org_id?: string
          policy_id?: string | null
          provider?: string
          provider_reference?: string | null
          psp?: string | null
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
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
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
          sticker_number: string | null
          sum_insured: number | null
          summary: string | null
          underinsurance_flag: Json | null
          updated_at: string
          verification_code: string | null
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
          sticker_number?: string | null
          sum_insured?: number | null
          summary?: string | null
          underinsurance_flag?: Json | null
          updated_at?: string
          verification_code?: string | null
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
          sticker_number?: string | null
          sum_insured?: number | null
          summary?: string | null
          underinsurance_flag?: Json | null
          updated_at?: string
          verification_code?: string | null
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
      policy_number_blocks: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          created_by: string | null
          id: string
          insurer_org_id: string
          last_number: number
          next_number: number
          pad: number
          prefix: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          insurer_org_id: string
          last_number: number
          next_number: number
          pad?: number
          prefix?: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          insurer_org_id?: string
          last_number?: number
          next_number?: number
          pad?: number
          prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_number_blocks_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_number_blocks_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_bundles: {
        Row: {
          audience: string
          created_at: string
          description: string | null
          discount_pct: number
          id: string
          items: Json
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          audience?: string
          created_at?: string
          description?: string | null
          discount_pct?: number
          id?: string
          items?: Json
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          audience?: string
          created_at?: string
          description?: string | null
          discount_pct?: number
          id?: string
          items?: Json
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
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
          assisted_service: boolean
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
          whatsapp_opt_in: boolean
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          active_workspace?: Json | null
          assisted_service?: boolean
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
          whatsapp_opt_in?: boolean
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          active_workspace?: Json | null
          assisted_service?: boolean
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
          whatsapp_opt_in?: boolean
        }
        Relationships: []
      }
      property_inspections: {
        Row: {
          address: string | null
          completed_at: string | null
          created_at: string
          gps: Json | null
          id: string
          notes: string | null
          partner_org_id: string | null
          photos: Json
          policy_id: string | null
          report: Json | null
          request_id: string | null
          requested_by: string | null
          scheduled_for: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          completed_at?: string | null
          created_at?: string
          gps?: Json | null
          id?: string
          notes?: string | null
          partner_org_id?: string | null
          photos?: Json
          policy_id?: string | null
          report?: Json | null
          request_id?: string | null
          requested_by?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          completed_at?: string | null
          created_at?: string
          gps?: Json | null
          id?: string
          notes?: string | null
          partner_org_id?: string | null
          photos?: Json
          policy_id?: string | null
          report?: Json | null
          request_id?: string | null
          requested_by?: string | null
          scheduled_for?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_inspections_partner_org_id_fkey"
            columns: ["partner_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_inspections_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
          },
          {
            foreignKeyName: "property_inspections_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_inspections_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      property_updates: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          policy_id: string
          storage_path: string
          taken_at: string | null
          uploaded_by: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          policy_id: string
          storage_path: string
          taken_at?: string | null
          uploaded_by: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          policy_id?: string
          storage_path?: string
          taken_at?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_updates_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
          },
          {
            foreignKeyName: "property_updates_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_shares: {
        Row: {
          channel: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          quote_id: string | null
          request_id: string | null
          token: string
          view_count: number
          viewed_at: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          quote_id?: string | null
          request_id?: string | null
          token?: string
          view_count?: number
          viewed_at?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          quote_id?: string | null
          request_id?: string | null
          token?: string
          view_count?: number
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_shares_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_shares_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
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
      remittance_partners: {
        Row: {
          api_key_hash: string | null
          created_at: string
          id: string
          kind: string
          name: string
          settings: Json
          slug: string
          status: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          api_key_hash?: string | null
          created_at?: string
          id?: string
          kind?: string
          name: string
          settings?: Json
          slug: string
          status?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          api_key_hash?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          settings?: Json
          slug?: string
          status?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
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
          bundle_id: string | null
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
          sla_choice: string | null
          sla_choice_at: string | null
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
          bundle_id?: string | null
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
          sla_choice?: string | null
          sla_choice_at?: string | null
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
          bundle_id?: string | null
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
          sla_choice?: string | null
          sla_choice_at?: string | null
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
            foreignKeyName: "requests_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "product_bundles"
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
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
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
      service_partners: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          direct_billing_insurer_ids: string[]
          email: string | null
          gps: Json | null
          id: string
          kind: string
          name: string
          notes: string | null
          phone: string | null
          rating: number | null
          region: string | null
          services: string[]
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          direct_billing_insurer_ids?: string[]
          email?: string | null
          gps?: Json | null
          id?: string
          kind: string
          name: string
          notes?: string | null
          phone?: string | null
          rating?: number | null
          region?: string | null
          services?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          direct_billing_insurer_ids?: string[]
          email?: string | null
          gps?: Json | null
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          phone?: string | null
          rating?: number | null
          region?: string | null
          services?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
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
      sla_timers: {
        Row: {
          breached_at: string | null
          broker_org_id: string | null
          created_at: string
          due_at: string
          escalated_at: string | null
          escalation_level: number
          id: string
          insurer_org_id: string | null
          last_notified_at: string | null
          resolved_at: string | null
          started_at: string
          subject_id: string
          subject_type: string
          updated_at: string
        }
        Insert: {
          breached_at?: string | null
          broker_org_id?: string | null
          created_at?: string
          due_at: string
          escalated_at?: string | null
          escalation_level?: number
          id?: string
          insurer_org_id?: string | null
          last_notified_at?: string | null
          resolved_at?: string | null
          started_at?: string
          subject_id: string
          subject_type: string
          updated_at?: string
        }
        Update: {
          breached_at?: string | null
          broker_org_id?: string | null
          created_at?: string
          due_at?: string
          escalated_at?: string | null
          escalation_level?: number
          id?: string
          insurer_org_id?: string | null
          last_notified_at?: string | null
          resolved_at?: string | null
          started_at?: string
          subject_id?: string
          subject_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_timers_broker_org_id_fkey"
            columns: ["broker_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_timers_insurer_org_id_fkey"
            columns: ["insurer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_subscriptions: {
        Row: {
          application_id: string | null
          beneficiary_id: string | null
          cadence: string
          cancelled_at: string | null
          created_at: string
          display_amount: number
          display_currency: string
          failures: number
          fx_rate: number | null
          fx_source: string | null
          ghs_amount: number
          id: string
          last_charged_at: string | null
          metadata: Json
          next_charge_at: string
          past_due_since: string | null
          paused_at: string | null
          payment_method_id: string | null
          policy_id: string | null
          psp: string
          psp_subscription_ref: string | null
          request_id: string | null
          sponsor_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          beneficiary_id?: string | null
          cadence?: string
          cancelled_at?: string | null
          created_at?: string
          display_amount?: number
          display_currency?: string
          failures?: number
          fx_rate?: number | null
          fx_source?: string | null
          ghs_amount: number
          id?: string
          last_charged_at?: string | null
          metadata?: Json
          next_charge_at?: string
          past_due_since?: string | null
          paused_at?: string | null
          payment_method_id?: string | null
          policy_id?: string | null
          psp?: string
          psp_subscription_ref?: string | null
          request_id?: string | null
          sponsor_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          beneficiary_id?: string | null
          cadence?: string
          cancelled_at?: string | null
          created_at?: string
          display_amount?: number
          display_currency?: string
          failures?: number
          fx_rate?: number | null
          fx_source?: string | null
          ghs_amount?: number
          id?: string
          last_charged_at?: string | null
          metadata?: Json
          next_charge_at?: string
          past_due_since?: string | null
          paused_at?: string | null
          payment_method_id?: string | null
          policy_id?: string | null
          psp?: string
          psp_subscription_ref?: string | null
          request_id?: string | null
          sponsor_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_subscriptions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_subscriptions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_subscriptions_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
          },
          {
            foreignKeyName: "sponsor_subscriptions_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_subscriptions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_charges: {
        Row: {
          attempt: number
          created_at: string
          error: string | null
          id: string
          payment_id: string | null
          status: string
          subscription_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          error?: string | null
          id?: string
          payment_id?: string | null
          status?: string
          subscription_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          error?: string | null
          id?: string
          payment_id?: string | null
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_charges_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_charges_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "sponsor_subscriptions"
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
      vehicle_lookups: {
        Row: {
          created_at: string
          data: Json
          expires_at: string
          fetched_at: string
          id: string
          registration: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          expires_at?: string
          fetched_at?: string
          id?: string
          registration: string
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          expires_at?: string
          fetched_at?: string
          id?: string
          registration?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_contacts: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          last_inbound_at: string | null
          last_outbound_at: string | null
          locale: string
          opted_in: boolean
          opted_in_at: string | null
          opted_out_at: string | null
          phone: string
          updated_at: string
          user_id: string | null
          wa_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          locale?: string
          opted_in?: boolean
          opted_in_at?: string | null
          opted_out_at?: string | null
          phone: string
          updated_at?: string
          user_id?: string | null
          wa_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          locale?: string
          opted_in?: boolean
          opted_in_at?: string | null
          opted_out_at?: string | null
          phone?: string
          updated_at?: string
          user_id?: string | null
          wa_id?: string
        }
        Relationships: []
      }
      wa_conversations: {
        Row: {
          assigned_org_id: string | null
          assigned_user_id: string | null
          bot_turns: number
          claim_id: string | null
          closed_at: string | null
          contact_id: string
          created_at: string
          id: string
          last_message_at: string
          policy_id: string | null
          request_id: string | null
          status: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          assigned_org_id?: string | null
          assigned_user_id?: string | null
          bot_turns?: number
          claim_id?: string | null
          closed_at?: string | null
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          policy_id?: string | null
          request_id?: string | null
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          assigned_org_id?: string | null
          assigned_user_id?: string | null
          bot_turns?: number
          claim_id?: string | null
          closed_at?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          policy_id?: string | null
          request_id?: string | null
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_conversations_assigned_org_id_fkey"
            columns: ["assigned_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_conversations_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_conversations_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "partner_renewal_pipeline"
            referencedColumns: ["policy_id"]
          },
          {
            foreignKeyName: "wa_conversations_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_conversations_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_handoffs: {
        Row: {
          complaint_id: string | null
          conversation_id: string
          created_at: string
          id: string
          lead_id: string | null
          note: string | null
          org_id: string | null
          reason: string
          request_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          to_party: string
        }
        Insert: {
          complaint_id?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          note?: string | null
          org_id?: string | null
          reason: string
          request_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          to_party: string
        }
        Update: {
          complaint_id?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          note?: string | null
          org_id?: string | null
          reason?: string
          request_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          to_party?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_handoffs_complaint_id_fkey"
            columns: ["complaint_id"]
            isOneToOne: false
            referencedRelation: "complaints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_handoffs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_handoffs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_handoffs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          direction: string
          error: string | null
          id: string
          kind: string
          payload: Json
          sender_party: string | null
          sender_user_id: string | null
          status: string
          template_name: string | null
          wa_message_id: string | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          kind?: string
          payload?: Json
          sender_party?: string | null
          sender_user_id?: string | null
          status?: string
          template_name?: string | null
          wa_message_id?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          kind?: string
          payload?: Json
          sender_party?: string | null
          sender_user_id?: string | null
          status?: string
          template_name?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_templates: {
        Row: {
          body: string
          buttons: Json
          category: string
          created_at: string
          description: string | null
          id: string
          language: string
          meta_template_id: string | null
          name: string
          rejection_reason: string | null
          status: string
          updated_at: string
          variables: string[]
        }
        Insert: {
          body: string
          buttons?: Json
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name: string
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          variables?: string[]
        }
        Update: {
          body?: string
          buttons?: Json
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name?: string
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          variables?: string[]
        }
        Relationships: []
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
      crm_pipeline_summary: {
        Row: {
          avg_days: number | null
          count: number | null
          estimated_value: number | null
          key: string | null
          metric: string | null
        }
        Relationships: []
      }
      partner_activity: {
        Row: {
          action: string | null
          actor_id: string | null
          actor_role: string | null
          changed_fields: string[] | null
          entity_id: string | null
          entity_type: string | null
          id: number | null
          occurred_at: string | null
          org_id: string | null
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          actor_role?: string | null
          changed_fields?: never
          entity_id?: string | null
          entity_type?: string | null
          id?: number | null
          occurred_at?: string | null
          org_id?: string | null
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          actor_role?: string | null
          changed_fields?: never
          entity_id?: string | null
          entity_type?: string | null
          id?: number | null
          occurred_at?: string | null
          org_id?: string | null
        }
        Relationships: []
      }
      partner_renewal_pipeline: {
        Row: {
          broker_org_id: string | null
          category_id: string | null
          cover_end: string | null
          currency: string | null
          customer_id: string | null
          days_left: number | null
          has_renewal_request: boolean | null
          insurer_org_id: string | null
          internal_reference: string | null
          policy_id: string | null
          policy_number: string | null
          premium: number | null
          status: Database["public"]["Enums"]["policy_status"] | null
        }
        Insert: {
          broker_org_id?: string | null
          category_id?: string | null
          cover_end?: string | null
          currency?: string | null
          customer_id?: string | null
          days_left?: never
          has_renewal_request?: never
          insurer_org_id?: string | null
          internal_reference?: string | null
          policy_id?: string | null
          policy_number?: string | null
          premium?: number | null
          status?: Database["public"]["Enums"]["policy_status"] | null
        }
        Update: {
          broker_org_id?: string | null
          category_id?: string | null
          cover_end?: string | null
          currency?: string | null
          customer_id?: string | null
          days_left?: never
          has_renewal_request?: never
          insurer_org_id?: string | null
          internal_reference?: string | null
          policy_id?: string | null
          policy_number?: string | null
          premium?: number | null
          status?: Database["public"]["Enums"]["policy_status"] | null
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
        ]
      }
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
      allocate_policy_number: {
        Args: { p_category?: string; p_insurer: string }
        Returns: string
      }
      approve_partner_application: {
        Args: { p_id: string; p_note?: string }
        Returns: {
          application_id: string
          org_id: string
          slug: string
        }[]
      }
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
      crm_lead_to_account: { Args: { p_lead_id: string }; Returns: string }
      crm_move_stage: {
        Args: {
          p_account_id: string
          p_lost_reason?: string
          p_note?: string
          p_to_stage: string
        }
        Returns: {
          agreement_signed_at: string | null
          application_id: string | null
          contact: Json
          created_at: string
          created_by: string | null
          estimated_value: number | null
          expected_go_live: string | null
          id: string
          kind: string
          lead_id: string | null
          live_at: string | null
          lost_reason: string | null
          name: string
          org_id: string | null
          owner_user_id: string | null
          region: string | null
          source: string
          stage: string
          tags: string[]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_appointment_request: {
        Args: { p_decision: string; p_id: string; p_note?: string }
        Returns: {
          appointment_id: string
          broker_org_id: string
          category_id: string
          insurer_org_id: string
          request_id: string
          status: string
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
      latest_fx_rate: {
        Args: { p_quote: string }
        Returns: {
          base: string
          created_at: string
          created_by: string | null
          fetched_at: string
          id: string
          note: string | null
          quote: string
          rate: number
          source: string
          valid_until: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "fx_rates"
          isOneToOne: false
          isSetofReturn: true
        }
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
      partner_claims_summary: { Args: { p_org_id: string }; Returns: Json }
      partner_commission_summary: {
        Args: { p_org_id: string; p_period?: string }
        Returns: {
          currency: string
          earned: number
          entries: number
          outstanding: number
          paid: number
          period: string
          period_end: string
          period_start: string
          platform_fee: number
          revenue_share: number
          statement_id: string
          statement_net_due: number
          statement_status: string
        }[]
      }
      partner_lapses: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          active: number
          cancelled: number
          ended: number
          expired: number
          lapse_rate: number
          lapsed: number
          renewed: number
        }[]
      }
      partner_renewals: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          category_id: string
          category_name: string
          contact_allowed: boolean
          cover_end: string
          currency: string
          customer_email: string
          customer_id: string
          customer_name: string
          customer_phone: string
          days_left: number
          internal_reference: string
          marketing_allowed: boolean
          policy_id: string
          policy_number: string
          premium: number
          reminders_sent: number
          renewal_request_id: string
          renewal_status: Database["public"]["Enums"]["request_status"]
          status: Database["public"]["Enums"]["policy_status"]
        }[]
      }
      partner_sales_summary: {
        Args: { p_from?: string; p_org_id: string; p_to?: string }
        Returns: {
          broker_commission: number
          conversions: number
          day: string
          platform_fee: number
          policies_issued: number
          premium: number
          quotes: number
          requests: number
        }[]
      }
      partner_sla_performance: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          on_time_rate: number
          requests_breached: number
          requests_measured: number
          requests_on_time: number
          requests_open_overdue: number
          submissions_late: number
          submissions_measured: number
          submissions_on_time: number
          submissions_open_overdue: number
        }[]
      }
      refresh_licence_status: { Args: never; Returns: Json }
      reject_partner_application: {
        Args: { p_id: string; p_note: string }
        Returns: string
      }
      request_routing_mode: { Args: { p_request: string }; Returns: string }
      return_partner_application: {
        Args: { p_id: string; p_note: string }
        Returns: string
      }
      revoke_my_session: { Args: { p_session_id: string }; Returns: boolean }
      run_claim_fraud_checks: { Args: { p_claim_id: string }; Returns: Json }
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
      verify_policy: {
        Args: { p_code?: string; p_insurer?: string; p_policy_number?: string }
        Returns: Json
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
        | "sticker"
        | "claim_video"
        | "medical_report"
        | "repair_estimate"
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
        "sticker",
        "claim_video",
        "medical_report",
        "repair_estimate",
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
