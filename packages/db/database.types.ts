export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      account_observations: {
        Row: {
          accepted_by: string | null;
          account_id: string;
          evaluation_window: NonNullable<Json>;
          id: string;
          insight_id: string;
          last_evaluated_at: string;
          limitations: string;
          method: string;
          rule_id: string | null;
          status: string;
          text: string;
          workspace_id: string;
        };
        Insert: {
          accepted_by?: string | null;
          account_id: string;
          evaluation_window: NonNullable<Json>;
          id?: string;
          insight_id: string;
          last_evaluated_at?: string;
          limitations: string;
          method: string;
          rule_id?: string | null;
          status?: string;
          text: string;
          workspace_id: string;
        };
        Update: {
          accepted_by?: string | null;
          account_id?: string;
          evaluation_window?: NonNullable<Json>;
          id?: string;
          insight_id?: string;
          last_evaluated_at?: string;
          limitations?: string;
          method?: string;
          rule_id?: string | null;
          status?: string;
          text?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_observations_workspace_id_account_id_fkey";
            columns: ["workspace_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "account_observations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "account_observations_workspace_id_insight_id_fkey";
            columns: ["workspace_id", "insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "account_observations_workspace_id_rule_id_fkey";
            columns: ["workspace_id", "rule_id"];
            isOneToOne: false;
            referencedRelation: "account_rules";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      account_rules: {
        Row: {
          account_id: string;
          active: boolean;
          created_at: string;
          created_by: string;
          id: string;
          source: string;
          text: string;
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          active?: boolean;
          created_at?: string;
          created_by: string;
          id?: string;
          source: string;
          text: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          active?: boolean;
          created_at?: string;
          created_by?: string;
          id?: string;
          source?: string;
          text?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "account_rules_workspace_id_account_id_fkey";
            columns: ["workspace_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "account_rules_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage: {
        Row: {
          created_at: string;
          id: string;
          model: string;
          operation: string;
          reserved_tokens: number;
          state: string;
          used_tokens: number | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          model: string;
          operation: string;
          reserved_tokens: number;
          state: string;
          used_tokens?: number | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          model?: string;
          operation?: string;
          reserved_tokens?: number;
          state?: string;
          used_tokens?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_usage_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      api_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          name: string;
          prefix: string;
          revoked_at: string | null;
          scopes: string[];
          token_hash: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          name: string;
          prefix: string;
          revoked_at?: string | null;
          scopes: string[];
          token_hash: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          name?: string;
          prefix?: string;
          revoked_at?: string | null;
          scopes?: string[];
          token_hash?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "api_tokens_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      approvals: {
        Row: {
          account_id: string;
          approved_by: string | null;
          created_at: string;
          decided_at: string | null;
          id: string;
          reason: string | null;
          requested_by: string;
          revision_id: string;
          scheduled_at: string;
          snapshot: NonNullable<Json>;
          snapshot_hash: string;
          status: string;
          variant_id: string;
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          approved_by?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          reason?: string | null;
          requested_by: string;
          revision_id: string;
          scheduled_at: string;
          snapshot: NonNullable<Json>;
          snapshot_hash: string;
          status: string;
          variant_id: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          approved_by?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          reason?: string | null;
          requested_by?: string;
          revision_id?: string;
          scheduled_at?: string;
          snapshot?: NonNullable<Json>;
          snapshot_hash?: string;
          status?: string;
          variant_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_workspace_id_revision_id_variant_id_fkey";
            columns: ["workspace_id", "revision_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "content_revisions";
            referencedColumns: ["workspace_id", "id", "variant_id"];
          },
          {
            foreignKeyName: "approvals_workspace_id_variant_id_account_id_fkey";
            columns: ["workspace_id", "variant_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "platform_variants";
            referencedColumns: ["workspace_id", "id", "account_id"];
          },
        ];
      };
      asset_derivatives: {
        Row: {
          asset_id: string;
          checksum: string | null;
          created_at: string;
          error: string | null;
          id: string;
          lease_expires_at: string | null;
          lease_token: string | null;
          metadata: NonNullable<Json>;
          recipe: NonNullable<Json>;
          status: string;
          storage_path: string | null;
          workspace_id: string;
        };
        Insert: {
          asset_id: string;
          checksum?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          metadata?: NonNullable<Json>;
          recipe: NonNullable<Json>;
          status: string;
          storage_path?: string | null;
          workspace_id: string;
        };
        Update: {
          asset_id?: string;
          checksum?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          metadata?: NonNullable<Json>;
          recipe?: NonNullable<Json>;
          status?: string;
          storage_path?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "asset_derivatives_workspace_id_asset_id_fkey";
            columns: ["workspace_id", "asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "asset_derivatives_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      assets: {
        Row: {
          bytes: number;
          checksum: string;
          created_at: string;
          duration: number | null;
          filename: string;
          height: number | null;
          id: string;
          mime_type: string;
          notes: string;
          provenance: string;
          storage_path: string;
          tags: string[];
          width: number | null;
          workspace_id: string;
        };
        Insert: {
          bytes: number;
          checksum: string;
          created_at?: string;
          duration?: number | null;
          filename: string;
          height?: number | null;
          id?: string;
          mime_type: string;
          notes?: string;
          provenance: string;
          storage_path: string;
          tags?: string[];
          width?: number | null;
          workspace_id: string;
        };
        Update: {
          bytes?: number;
          checksum?: string;
          created_at?: string;
          duration?: number | null;
          filename?: string;
          height?: number | null;
          id?: string;
          mime_type?: string;
          notes?: string;
          provenance?: string;
          storage_path?: string;
          tags?: string[];
          width?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assets_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_kind: string;
          created_at: string;
          details: NonNullable<Json>;
          id: string;
          resource_id: string | null;
          resource_type: string;
          workspace_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_kind: string;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          resource_id?: string | null;
          resource_type: string;
          workspace_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_kind?: string;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          resource_id?: string | null;
          resource_type?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      content_assets: {
        Row: {
          asset_id: string;
          package_id: string;
          position: number;
          workspace_id: string;
        };
        Insert: {
          asset_id: string;
          package_id: string;
          position: number;
          workspace_id: string;
        };
        Update: {
          asset_id?: string;
          package_id?: string;
          position?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_assets_workspace_id_asset_id_fkey";
            columns: ["workspace_id", "asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "content_assets_workspace_id_package_id_fkey";
            columns: ["workspace_id", "package_id"];
            isOneToOne: false;
            referencedRelation: "content_packages";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      content_packages: {
        Row: {
          brief: string;
          created_at: string;
          created_by: string;
          id: string;
          source_notes: string;
          tags: string[];
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          brief?: string;
          created_at?: string;
          created_by: string;
          id?: string;
          source_notes?: string;
          tags?: string[];
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          brief?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          source_notes?: string;
          tags?: string[];
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_packages_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      content_revisions: {
        Row: {
          content_hash: string;
          created_at: string;
          created_by: string;
          id: string;
          package_id: string;
          payload: NonNullable<Json>;
          provenance: string;
          revision: number;
          variant_id: string | null;
          workspace_id: string;
        };
        Insert: {
          content_hash: string;
          created_at?: string;
          created_by: string;
          id?: string;
          package_id: string;
          payload: NonNullable<Json>;
          provenance: string;
          revision: number;
          variant_id?: string | null;
          workspace_id: string;
        };
        Update: {
          content_hash?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          package_id?: string;
          payload?: NonNullable<Json>;
          provenance?: string;
          revision?: number;
          variant_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_revisions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_revisions_workspace_id_package_id_fkey";
            columns: ["workspace_id", "package_id"];
            isOneToOne: false;
            referencedRelation: "content_packages";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "content_revisions_workspace_id_variant_id_fkey";
            columns: ["workspace_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "platform_variants";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      demo_provider_calls: {
        Row: {
          created_at: string;
          id: string;
          local_key: string;
          operation: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          local_key: string;
          operation: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          local_key?: string;
          operation?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "demo_provider_calls_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      demo_provider_jobs: {
        Row: {
          account_id: string;
          created_at: string;
          fault: string | null;
          id: string;
          local_key: string;
          payload: NonNullable<Json>;
          platform_post_id: string | null;
          scheduled_at: string;
          snapshot_hash: string;
          state: string;
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          fault?: string | null;
          id: string;
          local_key: string;
          payload: NonNullable<Json>;
          platform_post_id?: string | null;
          scheduled_at: string;
          snapshot_hash: string;
          state: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          fault?: string | null;
          id?: string;
          local_key?: string;
          payload?: NonNullable<Json>;
          platform_post_id?: string | null;
          scheduled_at?: string;
          snapshot_hash?: string;
          state?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "demo_provider_jobs_workspace_id_account_id_fkey";
            columns: ["workspace_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "demo_provider_jobs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      experiment_accounts: {
        Row: {
          account_id: string;
          experiment_id: string;
          formats: string[];
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          experiment_id: string;
          formats: string[];
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          experiment_id?: string;
          formats?: string[];
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "experiment_accounts_workspace_id_account_id_fkey";
            columns: ["workspace_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "experiment_accounts_workspace_id_experiment_id_fkey";
            columns: ["workspace_id", "experiment_id"];
            isOneToOne: false;
            referencedRelation: "experiments";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      experiment_assignments: {
        Row: {
          arm: string;
          experiment_id: string;
          id: string;
          revision_id: string;
          variant_id: string;
          workspace_id: string;
        };
        Insert: {
          arm: string;
          experiment_id: string;
          id?: string;
          revision_id: string;
          variant_id: string;
          workspace_id: string;
        };
        Update: {
          arm?: string;
          experiment_id?: string;
          id?: string;
          revision_id?: string;
          variant_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "experiment_assignments_workspace_id_experiment_id_fkey";
            columns: ["workspace_id", "experiment_id"];
            isOneToOne: false;
            referencedRelation: "experiments";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "experiment_assignments_workspace_id_revision_id_variant_id_fkey";
            columns: ["workspace_id", "revision_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "content_revisions";
            referencedColumns: ["workspace_id", "id", "variant_id"];
          },
          {
            foreignKeyName: "experiment_assignments_workspace_id_variant_id_fkey";
            columns: ["workspace_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "platform_variants";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      experiments: {
        Row: {
          changed_variable: string;
          created_at: string;
          created_by: string;
          denominator: string | null;
          end_at: string | null;
          end_condition: string;
          horizon_hours: number;
          hypothesis: string;
          id: string;
          name: string;
          planned_samples: number;
          primary_metric: string;
          start_at: string | null;
          status: string;
          workspace_id: string;
        };
        Insert: {
          changed_variable: string;
          created_at?: string;
          created_by: string;
          denominator?: string | null;
          end_at?: string | null;
          end_condition?: string;
          horizon_hours: number;
          hypothesis: string;
          id?: string;
          name: string;
          planned_samples: number;
          primary_metric: string;
          start_at?: string | null;
          status?: string;
          workspace_id: string;
        };
        Update: {
          changed_variable?: string;
          created_at?: string;
          created_by?: string;
          denominator?: string | null;
          end_at?: string | null;
          end_condition?: string;
          horizon_hours?: number;
          hypothesis?: string;
          id?: string;
          name?: string;
          planned_samples?: number;
          primary_metric?: string;
          start_at?: string | null;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "experiments_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      insight_evidence: {
        Row: {
          insight_id: string;
          snapshot_id: string;
          workspace_id: string;
        };
        Insert: {
          insight_id: string;
          snapshot_id: string;
          workspace_id: string;
        };
        Update: {
          insight_id?: string;
          snapshot_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "insight_evidence_workspace_id_insight_id_fkey";
            columns: ["workspace_id", "insight_id"];
            isOneToOne: false;
            referencedRelation: "insights";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "insight_evidence_workspace_id_snapshot_id_fkey";
            columns: ["workspace_id", "snapshot_id"];
            isOneToOne: false;
            referencedRelation: "metric_snapshots";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      insights: {
        Row: {
          account_id: string | null;
          body: string;
          evaluated_at: string;
          experiment_id: string | null;
          id: string;
          limitations: string;
          method: string;
          next_action: string;
          title: string;
          workspace_id: string;
        };
        Insert: {
          account_id?: string | null;
          body: string;
          evaluated_at?: string;
          experiment_id?: string | null;
          id?: string;
          limitations: string;
          method: string;
          next_action: string;
          title: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string | null;
          body?: string;
          evaluated_at?: string;
          experiment_id?: string | null;
          id?: string;
          limitations?: string;
          method?: string;
          next_action?: string;
          title?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "insights_workspace_id_account_id_fkey";
            columns: ["workspace_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "insights_workspace_id_experiment_id_fkey";
            columns: ["workspace_id", "experiment_id"];
            isOneToOne: false;
            referencedRelation: "experiments";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "insights_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_secrets: {
        Row: {
          ciphertext: string | null;
          config: NonNullable<Json>;
          enabled: boolean;
          id: string;
          iv: string | null;
          last_checked_at: string | null;
          service: string;
          status: string;
          tag: string | null;
          updated_at: string;
          updated_by: string;
          workspace_id: string;
        };
        Insert: {
          ciphertext?: string | null;
          config?: NonNullable<Json>;
          enabled?: boolean;
          id?: string;
          iv?: string | null;
          last_checked_at?: string | null;
          service: string;
          status?: string;
          tag?: string | null;
          updated_at?: string;
          updated_by: string;
          workspace_id: string;
        };
        Update: {
          ciphertext?: string | null;
          config?: NonNullable<Json>;
          enabled?: boolean;
          id?: string;
          iv?: string | null;
          last_checked_at?: string | null;
          service?: string;
          status?: string;
          tag?: string | null;
          updated_at?: string;
          updated_by?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "integration_secrets_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          role?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      metric_collection_jobs: {
        Row: {
          due_at: string;
          error: string | null;
          horizon_hours: number;
          id: string;
          job_id: string;
          lease_expires_at: string | null;
          lease_token: string | null;
          retry_count: number;
          state: string;
          workspace_id: string;
        };
        Insert: {
          due_at: string;
          error?: string | null;
          horizon_hours: number;
          id?: string;
          job_id: string;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          retry_count?: number;
          state?: string;
          workspace_id: string;
        };
        Update: {
          due_at?: string;
          error?: string | null;
          horizon_hours?: number;
          id?: string;
          job_id?: string;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          retry_count?: number;
          state?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "metric_collection_jobs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "metric_collection_jobs_workspace_id_job_id_fkey";
            columns: ["workspace_id", "job_id"];
            isOneToOne: false;
            referencedRelation: "publish_jobs";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      metric_snapshots: {
        Row: {
          account_id: string;
          availability: string;
          definition: string;
          denominator: string | null;
          horizon_hours: number;
          id: string;
          job_id: string;
          metric: string;
          observed_at: string;
          period_end: string | null;
          period_start: string | null;
          platform_post_id: string;
          provenance: string;
          raw: NonNullable<Json>;
          scope: string;
          unit: string;
          value: number | null;
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          availability: string;
          definition: string;
          denominator?: string | null;
          horizon_hours: number;
          id?: string;
          job_id: string;
          metric: string;
          observed_at: string;
          period_end?: string | null;
          period_start?: string | null;
          platform_post_id: string;
          provenance: string;
          raw: NonNullable<Json>;
          scope: string;
          unit: string;
          value?: number | null;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          availability?: string;
          definition?: string;
          denominator?: string | null;
          horizon_hours?: number;
          id?: string;
          job_id?: string;
          metric?: string;
          observed_at?: string;
          period_end?: string | null;
          period_start?: string | null;
          platform_post_id?: string;
          provenance?: string;
          raw?: NonNullable<Json>;
          scope?: string;
          unit?: string;
          value?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "metric_snapshots_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "metric_snapshots_workspace_id_job_id_account_id_fkey";
            columns: ["workspace_id", "job_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "publish_jobs";
            referencedColumns: ["workspace_id", "id", "account_id"];
          },
        ];
      };
      platform_variants: {
        Row: {
          account_id: string;
          created_at: string;
          current_revision_id: string | null;
          format: string;
          id: string;
          package_id: string;
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          current_revision_id?: string | null;
          format: string;
          id?: string;
          package_id: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          current_revision_id?: string | null;
          format?: string;
          id?: string;
          package_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_variants_workspace_id_account_id_fkey";
            columns: ["workspace_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "platform_variants_workspace_id_current_revision_id_id_fkey";
            columns: ["workspace_id", "current_revision_id", "id"];
            isOneToOne: false;
            referencedRelation: "content_revisions";
            referencedColumns: ["workspace_id", "id", "variant_id"];
          },
          {
            foreignKeyName: "platform_variants_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_variants_workspace_id_package_id_fkey";
            columns: ["workspace_id", "package_id"];
            isOneToOne: false;
            referencedRelation: "content_packages";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      provider_connections: {
        Row: {
          account_id: string | null;
          connection_type: string | null;
          created_at: string;
          expires_at: string;
          external_binding: string;
          id: string;
          imported_ids: string[];
          integration_hash: string | null;
          platform: string;
          redirect_mode: string;
          requested_permissions: string[];
          state_hash: string;
          status: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          account_id?: string | null;
          connection_type?: string | null;
          created_at?: string;
          expires_at: string;
          external_binding: string;
          id?: string;
          imported_ids?: string[];
          integration_hash?: string | null;
          platform: string;
          redirect_mode?: string;
          requested_permissions?: string[];
          state_hash: string;
          status?: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string | null;
          connection_type?: string | null;
          created_at?: string;
          expires_at?: string;
          external_binding?: string;
          id?: string;
          imported_ids?: string[];
          integration_hash?: string | null;
          platform?: string;
          redirect_mode?: string;
          requested_permissions?: string[];
          state_hash?: string;
          status?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_connections_workspace_id_account_id_fkey";
            columns: ["workspace_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "provider_connections_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_events: {
        Row: {
          authenticated: boolean;
          id: string;
          job_id: string | null;
          payload: NonNullable<Json>;
          processed_at: string | null;
          provider_event_id: string;
          received_at: string;
          workspace_id: string;
        };
        Insert: {
          authenticated?: boolean;
          id?: string;
          job_id?: string | null;
          payload: NonNullable<Json>;
          processed_at?: string | null;
          provider_event_id: string;
          received_at?: string;
          workspace_id: string;
        };
        Update: {
          authenticated?: boolean;
          id?: string;
          job_id?: string | null;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          provider_event_id?: string;
          received_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_events_workspace_id_job_id_fkey";
            columns: ["workspace_id", "job_id"];
            isOneToOne: false;
            referencedRelation: "publish_jobs";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      publication_targets: {
        Row: {
          account_id: string;
          approval_id: string;
          created_at: string;
          id: string;
          local_key: string;
          provenance: string;
          variant_id: string;
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          approval_id: string;
          created_at?: string;
          id?: string;
          local_key: string;
          provenance: string;
          variant_id: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          approval_id?: string;
          created_at?: string;
          id?: string;
          local_key?: string;
          provenance?: string;
          variant_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "publication_targets_workspace_id_approval_id_account_id_fkey";
            columns: ["workspace_id", "approval_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "approvals";
            referencedColumns: ["workspace_id", "id", "account_id"];
          },
          {
            foreignKeyName: "publication_targets_workspace_id_approval_id_variant_id_ac_fkey";
            columns: [
              "workspace_id",
              "approval_id",
              "variant_id",
              "account_id",
            ];
            isOneToOne: false;
            referencedRelation: "approvals";
            referencedColumns: [
              "workspace_id",
              "id",
              "variant_id",
              "account_id",
            ];
          },
          {
            foreignKeyName: "publication_targets_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      publish_attempts: {
        Row: {
          error: Json | null;
          finished_at: string | null;
          id: string;
          job_id: string;
          lease_token: string;
          operation: string;
          outcome: string;
          provider_response: Json | null;
          started_at: string;
          workspace_id: string;
        };
        Insert: {
          error?: Json | null;
          finished_at?: string | null;
          id?: string;
          job_id: string;
          lease_token: string;
          operation: string;
          outcome?: string;
          provider_response?: Json | null;
          started_at?: string;
          workspace_id: string;
        };
        Update: {
          error?: Json | null;
          finished_at?: string | null;
          id?: string;
          job_id?: string;
          lease_token?: string;
          operation?: string;
          outcome?: string;
          provider_response?: Json | null;
          started_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "publish_attempts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "publish_attempts_workspace_id_job_id_fkey";
            columns: ["workspace_id", "job_id"];
            isOneToOne: false;
            referencedRelation: "publish_jobs";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      publish_jobs: {
        Row: {
          account_id: string;
          cancel_requested: boolean;
          created_at: string;
          error: Json | null;
          generation: number;
          id: string;
          lease_expires_at: string | null;
          lease_token: string | null;
          next_run_at: string;
          platform_post_id: string | null;
          provider_job_id: string | null;
          published_at: string | null;
          receipt: Json | null;
          retry_count: number;
          scheduling_owner: string;
          state: string;
          target_id: string;
          updated_at: string;
          variant_id: string;
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          cancel_requested?: boolean;
          created_at?: string;
          error?: Json | null;
          generation?: number;
          id?: string;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          next_run_at?: string;
          platform_post_id?: string | null;
          provider_job_id?: string | null;
          published_at?: string | null;
          receipt?: Json | null;
          retry_count?: number;
          scheduling_owner?: string;
          state: string;
          target_id: string;
          updated_at?: string;
          variant_id: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          cancel_requested?: boolean;
          created_at?: string;
          error?: Json | null;
          generation?: number;
          id?: string;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          next_run_at?: string;
          platform_post_id?: string | null;
          provider_job_id?: string | null;
          published_at?: string | null;
          receipt?: Json | null;
          retry_count?: number;
          scheduling_owner?: string;
          state?: string;
          target_id?: string;
          updated_at?: string;
          variant_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "publish_jobs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "publish_jobs_workspace_id_target_id_account_id_fkey";
            columns: ["workspace_id", "target_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "publication_targets";
            referencedColumns: ["workspace_id", "id", "account_id"];
          },
          {
            foreignKeyName: "publish_jobs_workspace_id_target_id_variant_id_account_id_fkey";
            columns: ["workspace_id", "target_id", "variant_id", "account_id"];
            isOneToOne: false;
            referencedRelation: "publication_targets";
            referencedColumns: [
              "workspace_id",
              "id",
              "variant_id",
              "account_id",
            ];
          },
        ];
      };
      request_limits: {
        Row: {
          count: number;
          key: string;
          window_at: string;
        };
        Insert: {
          count: number;
          key: string;
          window_at: string;
        };
        Update: {
          count?: number;
          key?: string;
          window_at?: string;
        };
        Relationships: [];
      };
      revision_assets: {
        Row: {
          asset_id: string;
          derivative_id: string | null;
          position: number;
          revision_id: string;
          workspace_id: string;
        };
        Insert: {
          asset_id: string;
          derivative_id?: string | null;
          position: number;
          revision_id: string;
          workspace_id: string;
        };
        Update: {
          asset_id?: string;
          derivative_id?: string | null;
          position?: number;
          revision_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "revision_assets_workspace_id_asset_id_fkey";
            columns: ["workspace_id", "asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["workspace_id", "id"];
          },
          {
            foreignKeyName: "revision_assets_workspace_id_derivative_id_asset_id_fkey";
            columns: ["workspace_id", "derivative_id", "asset_id"];
            isOneToOne: false;
            referencedRelation: "asset_derivatives";
            referencedColumns: ["workspace_id", "id", "asset_id"];
          },
          {
            foreignKeyName: "revision_assets_workspace_id_revision_id_fkey";
            columns: ["workspace_id", "revision_id"];
            isOneToOne: false;
            referencedRelation: "content_revisions";
            referencedColumns: ["workspace_id", "id"];
          },
        ];
      };
      social_accounts: {
        Row: {
          account_type: string;
          audience: string;
          capabilities: NonNullable<Json>;
          capability_generation: number;
          connection_generation: number;
          created_at: string;
          display_name: string;
          external_binding: string | null;
          handle: string;
          id: string;
          last_synced_at: string | null;
          permissions: string[];
          platform: string;
          posting_preferences: NonNullable<Json>;
          provenance: string;
          provider_account_id: string | null;
          status: string;
          timezone: string;
          workspace_id: string;
          writing_guidelines: string;
        };
        Insert: {
          account_type: string;
          audience?: string;
          capabilities?: NonNullable<Json>;
          capability_generation?: number;
          connection_generation?: number;
          created_at?: string;
          display_name: string;
          external_binding?: string | null;
          handle: string;
          id?: string;
          last_synced_at?: string | null;
          permissions?: string[];
          platform: string;
          posting_preferences?: NonNullable<Json>;
          provenance: string;
          provider_account_id?: string | null;
          status?: string;
          timezone?: string;
          workspace_id: string;
          writing_guidelines?: string;
        };
        Update: {
          account_type?: string;
          audience?: string;
          capabilities?: NonNullable<Json>;
          capability_generation?: number;
          connection_generation?: number;
          created_at?: string;
          display_name?: string;
          external_binding?: string | null;
          handle?: string;
          id?: string;
          last_synced_at?: string | null;
          permissions?: string[];
          platform?: string;
          posting_preferences?: NonNullable<Json>;
          provenance?: string;
          provider_account_id?: string | null;
          status?: string;
          timezone?: string;
          workspace_id?: string;
          writing_guidelines?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_accounts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      worker_health: {
        Row: {
          heartbeat_at: string;
          id: string;
          jobs_processed: number;
          last_error: string | null;
          started_at: string;
          status: string;
        };
        Insert: {
          heartbeat_at: string;
          id: string;
          jobs_processed?: number;
          last_error?: string | null;
          started_at: string;
          status: string;
        };
        Update: {
          heartbeat_at?: string;
          id?: string;
          jobs_processed?: number;
          last_error?: string | null;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      workspace_services: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          notes: string;
          type: string;
          url: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          notes?: string;
          type: string;
          url: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          notes?: string;
          type?: string;
          url?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_services_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          id: string;
          mode: string;
          name: string;
          timezone: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          mode: string;
          name: string;
          timezone?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mode?: string;
          name?: string;
          timezone?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      mf_allowed: { Args: { w: string }; Returns: boolean };
      mf_policy: { Args: { w: string }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
