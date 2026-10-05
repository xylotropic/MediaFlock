-- Additive: existing provider rows, permissions and approval fingerprints stay intact.
alter table integration_secrets drop constraint integration_secrets_service_check;
alter table integration_secrets add constraint integration_secrets_service_check check(service in ('openai','postforme','elevenlabs'));
alter table integration_secrets add column generation bigint not null default 0;
create table voice_requests (
 id uuid primary key, workspace_id uuid not null references workspaces(id), user_id uuid not null references auth.users(id), connection_generation bigint not null, audio_hash text not null, duration_seconds numeric not null check(duration_seconds>=0.1 and duration_seconds<=90), state text not null check(state in ('dispatched','complete','failed','unknown','acknowledged')), created_at timestamptz not null default now(), finished_at timestamptz, unique(workspace_id,id)
);
create unique index voice_single_inflight on voice_requests(workspace_id) where state in ('dispatched','unknown');
create index voice_daily_admission on voice_requests(workspace_id,created_at);
alter table voice_requests enable row level security;
alter table voice_requests force row level security;
create policy workspace_access on voice_requests to mediaflock_app using(mf_policy(workspace_id)) with check(mf_policy(workspace_id));
grant select,insert,update on voice_requests to mediaflock_app;
revoke all on voice_requests from anon,authenticated;
