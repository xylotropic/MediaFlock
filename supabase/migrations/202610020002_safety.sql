create table demo_provider_calls(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),local_key text not null,operation text not null,created_at timestamptz not null default now());
alter table demo_provider_calls enable row level security;
alter table demo_provider_calls force row level security;
create policy workspace_access on demo_provider_calls to mediaflock_app using(mf_policy(workspace_id)) with check(mf_policy(workspace_id));
grant select,insert on demo_provider_calls to mediaflock_app;
-- A remote ID cannot accidentally be attached to two local delivery intents in one workspace.
create unique index provider_job_identity on publish_jobs(workspace_id,provider_job_id) where provider_job_id is not null;
create function mf_ready_derivative() returns trigger language plpgsql as $$ begin if old.status='ready' then raise exception 'Completed derivatives are immutable'; end if;return new;end $$;
create trigger immutable_derivative before update or delete on asset_derivatives for each row execute function mf_ready_derivative();
revoke delete on assets,asset_derivatives,content_revisions,revision_assets,approvals,publication_targets,publish_jobs,publish_attempts,provider_events,metric_snapshots,audit_events from mediaflock_app;
-- Runtime membership writes are not part of V1; privileged setup owns membership provisioning.
revoke insert,update,delete on memberships,workspaces from mediaflock_app;
grant update(name,timezone) on workspaces to mediaflock_app;
