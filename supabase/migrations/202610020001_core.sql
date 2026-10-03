create extension if not exists pgcrypto;
create role mediaflock_app nologin;

create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null, timezone text not null default 'America/New_York', mode text not null check(mode in ('demo','live')), created_at timestamptz not null default now()
);
create table public.memberships (
 workspace_id uuid not null references workspaces(id), user_id uuid not null references auth.users(id), role text not null check(role in ('owner','reviewer','editor','viewer')), primary key(workspace_id,user_id)
);
create function public.mf_allowed(w uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select (current_setting('mediaflock.service',true)='1' and current_setting('mediaflock.workspace',true)=w::text)
 or exists(select 1 from memberships where workspace_id=w and user_id=auth.uid());
$$;
create function public.mf_policy(w uuid) returns boolean language sql stable as $$
 select public.mf_allowed(w) and (current_setting('mediaflock.workspace',true) is null or current_setting('mediaflock.workspace',true)='' or current_setting('mediaflock.workspace',true)=w::text);
$$;

create table social_accounts (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), provider_account_id text, platform text not null check(platform in ('youtube','facebook','instagram','tiktok','linkedin','x')), handle text not null, display_name text not null, account_type text not null, status text not null default 'unknown' check(status in ('connected','disconnected','unknown','permission_missing')), capabilities jsonb not null default '{}', permissions text[] not null default '{}', timezone text not null default 'America/New_York', posting_preferences jsonb not null default '{}', audience text not null default '', writing_guidelines text not null default '', last_synced_at timestamptz, provenance text not null check(provenance in ('simulated','provider')), created_at timestamptz not null default now(), unique(workspace_id,id), unique(workspace_id,provider_account_id)
);
create table provider_connections (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), user_id uuid not null references auth.users(id), platform text not null, state_hash text not null unique, external_binding text not null unique, status text not null default 'pending' check(status in ('pending','verified','expired','failed')), expires_at timestamptz not null, account_id uuid, created_at timestamptz not null default now(), foreign key(workspace_id,account_id) references social_accounts(workspace_id,id), unique(workspace_id,id)
);
create table account_rules (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), account_id uuid not null, text text not null, source text not null check(source in ('user','accepted_observation')), active boolean not null default true, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), foreign key(workspace_id,account_id) references social_accounts(workspace_id,id), unique(workspace_id,id)
);
create table assets (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), filename text not null, storage_path text not null unique, mime_type text not null, bytes bigint not null check(bytes>0 and bytes<=52428800), checksum text not null, width integer, height integer, duration numeric, tags text[] not null default '{}', notes text not null default '', provenance text not null check(provenance in ('uploaded','fixture')), created_at timestamptz not null default now(), unique(workspace_id,id)
);
create table asset_derivatives (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), asset_id uuid not null, storage_path text unique, checksum text, recipe jsonb not null, metadata jsonb not null default '{}', status text not null check(status in ('queued','processing','ready','failed')), error text, created_at timestamptz not null default now(), foreign key(workspace_id,asset_id) references assets(workspace_id,id), unique(workspace_id,id), unique(workspace_id,id,asset_id)
);
create table content_packages (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), title text not null, source_notes text not null default '', brief text not null default '', tags text[] not null default '{}', created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id,id)
);
create table content_assets (
 workspace_id uuid not null, package_id uuid not null, asset_id uuid not null, position integer not null check(position>=0), primary key(package_id,asset_id), unique(package_id,position), foreign key(workspace_id,package_id) references content_packages(workspace_id,id), foreign key(workspace_id,asset_id) references assets(workspace_id,id)
);
create table platform_variants (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), package_id uuid not null, account_id uuid not null, format text not null, current_revision_id uuid, created_at timestamptz not null default now(), foreign key(workspace_id,package_id) references content_packages(workspace_id,id), foreign key(workspace_id,account_id) references social_accounts(workspace_id,id), unique(workspace_id,id), unique(workspace_id,id,account_id)
);
create table content_revisions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), package_id uuid not null, variant_id uuid, revision integer not null check(revision>0), payload jsonb not null, content_hash text not null, created_by uuid not null references auth.users(id), provenance text not null check(provenance in ('manual','demo_ai','openai','fixture')), created_at timestamptz not null default now(), foreign key(workspace_id,package_id) references content_packages(workspace_id,id), foreign key(workspace_id,variant_id) references platform_variants(workspace_id,id), unique(workspace_id,id), unique(workspace_id,id,variant_id), unique(variant_id,revision)
);
alter table platform_variants add foreign key(workspace_id,current_revision_id,id) references content_revisions(workspace_id,id,variant_id) deferrable initially deferred;
create table revision_assets (
 workspace_id uuid not null, revision_id uuid not null, asset_id uuid not null, derivative_id uuid, position integer not null check(position>=0), primary key(revision_id,position), foreign key(workspace_id,revision_id) references content_revisions(workspace_id,id), foreign key(workspace_id,asset_id) references assets(workspace_id,id), foreign key(workspace_id,derivative_id,asset_id) references asset_derivatives(workspace_id,id,asset_id)
);
create table approvals (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), variant_id uuid not null, account_id uuid not null, revision_id uuid not null, snapshot jsonb not null, snapshot_hash text not null, scheduled_at timestamptz not null, status text not null check(status in ('pending','approved','rejected','revoked')), requested_by uuid not null references auth.users(id), approved_by uuid references auth.users(id), reason text, created_at timestamptz not null default now(), decided_at timestamptz, foreign key(workspace_id,variant_id,account_id) references platform_variants(workspace_id,id,account_id), foreign key(workspace_id,revision_id,variant_id) references content_revisions(workspace_id,id,variant_id), unique(workspace_id,id), unique(workspace_id,id,account_id), check(status<>'approved' or approved_by is not null)
);
create table publication_targets (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), approval_id uuid not null, account_id uuid not null, local_key text not null unique, provenance text not null check(provenance in ('simulated','provider')), created_at timestamptz not null default now(), foreign key(workspace_id,approval_id,account_id) references approvals(workspace_id,id,account_id), unique(approval_id), unique(workspace_id,id), unique(workspace_id,id,account_id)
);
create table publish_jobs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), target_id uuid not null unique, account_id uuid not null, state text not null check(state in ('queued','submitting','scheduled','processing','published','failed','cancelled','needs_reconciliation')), scheduling_owner text not null default 'local' check(scheduling_owner in ('local','provider')), provider_job_id text, platform_post_id text, receipt jsonb, error jsonb, cancel_requested boolean not null default false, retry_count integer not null default 0, lease_token uuid, lease_expires_at timestamptz, next_run_at timestamptz not null default now(), generation integer not null default 0, published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), foreign key(workspace_id,target_id,account_id) references publication_targets(workspace_id,id,account_id), unique(workspace_id,id), unique(workspace_id,id,account_id)
);
create index publish_claim on publish_jobs(next_run_at) where state not in ('published','failed','cancelled');
create index jobs_account_state on publish_jobs(account_id,state);
create table publish_attempts (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), job_id uuid not null, operation text not null check(operation in ('submit','status','cancel','reconcile')), lease_token uuid not null, started_at timestamptz not null default now(), finished_at timestamptz, outcome text not null default 'started', error jsonb, provider_response jsonb, foreign key(workspace_id,job_id) references publish_jobs(workspace_id,id), unique(workspace_id,id)
);
create table provider_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), provider_event_id text not null, job_id uuid, authenticated boolean not null default false, payload jsonb not null, received_at timestamptz not null default now(), processed_at timestamptz, foreign key(workspace_id,job_id) references publish_jobs(workspace_id,id), unique(workspace_id,provider_event_id), unique(workspace_id,id)
);
create table metric_snapshots (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), account_id uuid not null, job_id uuid not null, platform_post_id text not null, metric text not null, definition text not null, value numeric, unit text not null, denominator text, scope text not null check(scope in ('lifetime','period')), availability text not null check(availability in ('available','unsupported','unknown','permission_missing','missed')), horizon_hours integer not null check(horizon_hours>0), observed_at timestamptz not null, period_start timestamptz, period_end timestamptz, provenance text not null check(provenance in ('simulated','provider')), raw jsonb not null, foreign key(workspace_id,job_id,account_id) references publish_jobs(workspace_id,id,account_id), unique(workspace_id,id), unique(job_id,metric,horizon_hours), check((availability='available' and value is not null) or (availability<>'available' and value is null))
);
create index metrics_comparison on metric_snapshots(account_id,metric,horizon_hours,observed_at desc);
create table experiments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), name text not null, hypothesis text not null, changed_variable text not null check(changed_variable in ('hook','format','cta','publishing_window')), primary_metric text not null, denominator text, horizon_hours integer not null check(horizon_hours>0), planned_samples integer not null check(planned_samples>=3), start_at timestamptz, end_at timestamptz, end_condition text not null default 'Planned sample size and evaluation horizon reached', status text not null default 'active' check(status in ('draft','active','completed')), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(workspace_id,id)
);
create table experiment_accounts (
 workspace_id uuid not null, experiment_id uuid not null, account_id uuid not null, formats text[] not null, primary key(experiment_id,account_id), foreign key(workspace_id,experiment_id) references experiments(workspace_id,id), foreign key(workspace_id,account_id) references social_accounts(workspace_id,id)
);
create table experiment_assignments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, experiment_id uuid not null, variant_id uuid not null, revision_id uuid not null, arm text not null check(arm in ('A','B')), foreign key(workspace_id,experiment_id) references experiments(workspace_id,id), foreign key(workspace_id,variant_id) references platform_variants(workspace_id,id), foreign key(workspace_id,revision_id,variant_id) references content_revisions(workspace_id,id,variant_id), unique(experiment_id,variant_id), unique(workspace_id,id)
);
create table insights (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), experiment_id uuid, account_id uuid, title text not null, body text not null, method text not null, limitations text not null, next_action text not null, evaluated_at timestamptz not null default now(), foreign key(workspace_id,experiment_id) references experiments(workspace_id,id), foreign key(workspace_id,account_id) references social_accounts(workspace_id,id), unique(workspace_id,id)
);
create table insight_evidence (
 workspace_id uuid not null, insight_id uuid not null, snapshot_id uuid not null, primary key(insight_id,snapshot_id), foreign key(workspace_id,insight_id) references insights(workspace_id,id), foreign key(workspace_id,snapshot_id) references metric_snapshots(workspace_id,id)
);
create table account_observations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), account_id uuid not null, insight_id uuid not null, text text not null, status text not null default 'proposed' check(status in ('proposed','accepted','rejected')), method text not null, limitations text not null, evaluation_window jsonb not null, last_evaluated_at timestamptz not null default now(), accepted_by uuid references auth.users(id), rule_id uuid, foreign key(workspace_id,account_id) references social_accounts(workspace_id,id), foreign key(workspace_id,insight_id) references insights(workspace_id,id), foreign key(workspace_id,rule_id) references account_rules(workspace_id,id), unique(workspace_id,id)
);
create table api_tokens (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), user_id uuid not null references auth.users(id), name text not null, token_hash text not null unique, prefix text not null, scopes text[] not null, expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(), unique(workspace_id,id), check(not scopes && array['approve'])
);
create table audit_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), actor_id uuid, actor_kind text not null, action text not null, resource_type text not null, resource_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now(), unique(workspace_id,id)
);
create table demo_provider_jobs (
 id text primary key, workspace_id uuid not null references workspaces(id), local_key text not null unique, account_id uuid not null, snapshot_hash text not null, payload jsonb not null, state text not null, scheduled_at timestamptz not null, platform_post_id text, fault text, created_at timestamptz not null default now(), foreign key(workspace_id,account_id) references social_accounts(workspace_id,id), unique(workspace_id,id)
);
create table worker_health (
 id text primary key, started_at timestamptz not null, heartbeat_at timestamptz not null, status text not null, jobs_processed integer not null default 0, last_error text
);
create table metric_collection_jobs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), job_id uuid not null, horizon_hours integer not null, due_at timestamptz not null, state text not null default 'queued' check(state in ('queued','running','done','failed','missed')), error text, retry_count integer not null default 0, lease_token uuid, lease_expires_at timestamptz, foreign key(workspace_id,job_id) references publish_jobs(workspace_id,id), unique(job_id,horizon_hours), unique(workspace_id,id)
);
create table ai_usage (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), operation text not null, model text not null, reserved_tokens integer not null, used_tokens integer, state text not null check(state in ('reserved','complete','failed')), created_at timestamptz not null default now(), unique(workspace_id,id)
);
create table request_limits (key text not null, window_at timestamptz not null, count integer not null, primary key(key,window_at));

-- Only BFF/domain services may mutate application rows. Direct Auth users get SELECT with RLS.
do $$ declare t text; begin
 foreach t in array array['workspaces','memberships','social_accounts','provider_connections','account_rules','assets','asset_derivatives','content_packages','content_assets','platform_variants','content_revisions','revision_assets','approvals','publication_targets','publish_jobs','publish_attempts','provider_events','metric_snapshots','experiments','experiment_accounts','experiment_assignments','insights','insight_evidence','account_observations','api_tokens','audit_events','demo_provider_jobs','metric_collection_jobs','ai_usage'] loop
 execute format('alter table %I enable row level security',t);
 execute format('alter table %I force row level security',t);
 execute format('create policy workspace_access on %I for all to mediaflock_app using (mf_policy(%I)) with check (mf_policy(%I))',t,case when t='workspaces' then 'id' else 'workspace_id' end,case when t='workspaces' then 'id' else 'workspace_id' end);
 execute format('grant select,insert,update,delete on %I to mediaflock_app',t);
 end loop;
end $$;
grant usage on schema public to mediaflock_app;
revoke all on all tables in schema public from anon,authenticated;
-- Tokens, pending connections and provider fixture internals are BFF-only.
do $$ declare t text; begin
 foreach t in array array['workspaces','memberships','social_accounts','account_rules','assets','asset_derivatives','content_packages','content_assets','platform_variants','content_revisions','revision_assets','approvals','publication_targets','publish_jobs','publish_attempts','metric_snapshots','experiments','experiment_accounts','experiment_assignments','insights','insight_evidence','account_observations','audit_events'] loop
 execute format('grant select on %I to authenticated',t);
 execute format('create policy authenticated_read on %I for select to authenticated using (mf_allowed(%I))',t,case when t='workspaces' then 'id' else 'workspace_id' end);
 end loop;
end $$;

create function mf_immutable() returns trigger language plpgsql as $$ begin raise exception 'Immutable record cannot be modified'; end $$;
create trigger immutable_revision before update or delete on content_revisions for each row execute function mf_immutable();
create trigger immutable_revision_assets before update or delete on revision_assets for each row execute function mf_immutable();
create trigger immutable_audit before update or delete on audit_events for each row execute function mf_immutable();
create function mf_approval_snapshot() returns trigger language plpgsql as $$ begin
 if new.snapshot<>old.snapshot or new.snapshot_hash<>old.snapshot_hash or new.revision_id<>old.revision_id or new.account_id<>old.account_id or new.variant_id<>old.variant_id or new.scheduled_at<>old.scheduled_at then raise exception 'Approval snapshot is immutable'; end if; return new;
end $$;
create trigger immutable_approval before update on approvals for each row execute function mf_approval_snapshot();
create function mf_asset_original() returns trigger language plpgsql as $$ begin
 if new.storage_path<>old.storage_path or new.checksum<>old.checksum or new.bytes<>old.bytes or new.mime_type<>old.mime_type then raise exception 'Original assets are immutable'; end if; return new;
end $$;
create trigger preserve_asset before update on assets for each row execute function mf_asset_original();
create function mf_provenance_guard() returns trigger language plpgsql as $$ declare m text; begin
 select mode into m from workspaces where id=new.workspace_id;
 if (m='demo' and new.provenance='provider') or (m='live' and new.provenance='simulated') then raise exception 'Workspace and integration provenance conflict'; end if;return new;
end $$;
create trigger account_provenance before insert or update on social_accounts for each row execute function mf_provenance_guard();
create trigger target_provenance before insert or update on publication_targets for each row execute function mf_provenance_guard();
create trigger metrics_provenance before insert or update on metric_snapshots for each row execute function mf_provenance_guard();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('mediaflock','mediaflock',false,52428800,array['image/png','image/jpeg','image/webp','video/mp4','video/quicktime']) on conflict(id) do nothing;
create policy mediaflock_private_read on storage.objects for select to authenticated using(bucket_id='mediaflock' and exists(select 1 from public.memberships where workspace_id::text=(storage.foldername(name))[1] and user_id=auth.uid()));
-- Uploads and derivatives go through validated server/worker storage services. No anonymous writes.
