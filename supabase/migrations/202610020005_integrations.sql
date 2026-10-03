create table integration_secrets (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), service text not null check(service in ('openai','postforme')), ciphertext text, iv text, tag text, config jsonb not null default '{}', enabled boolean not null default false, last_checked_at timestamptz, status text not null default 'unavailable', updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), unique(workspace_id,service), unique(workspace_id,id)
);
alter table integration_secrets enable row level security;
alter table integration_secrets force row level security;
create policy workspace_access on integration_secrets to mediaflock_app using(mf_policy(workspace_id)) with check(mf_policy(workspace_id));
grant select,insert,update on integration_secrets to mediaflock_app;
revoke all on integration_secrets from anon,authenticated;
create table workspace_services (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),name text not null,type text not null check(type in ('reference','storage','publishing','analytics','automation')),url text not null,notes text not null default '',created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(workspace_id,id)
);
alter table workspace_services enable row level security;
alter table workspace_services force row level security;
create policy workspace_access on workspace_services to mediaflock_app using(mf_policy(workspace_id)) with check(mf_policy(workspace_id));
grant select,insert,update,delete on workspace_services to mediaflock_app;
