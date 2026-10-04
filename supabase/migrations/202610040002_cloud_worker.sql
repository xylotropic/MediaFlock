-- Cloud admission is infrastructure authority. It cannot create human approval.
create table public.cloud_worker_control (
 mode text primary key check(mode in ('demo','live')),
 enabled boolean not null default false,
 work_enabled boolean not null default false,
 next_lane text not null default 'metrics' check(next_lane in ('metrics','publishing')),
 lease_token uuid,
 lease_expires_at timestamptz,
 admitted_minute timestamptz,
 last_started_at timestamptz,
 last_completed_at timestamptz,
 last_work_error text,
 last_work_error_at timestamptz,
 last_result jsonb,
 deployment_id text
);
insert into public.cloud_worker_control(mode) values('demo'),('live');
alter table public.cloud_worker_control enable row level security;
revoke all on public.cloud_worker_control from public,anon,authenticated,service_role,mediaflock_app;

create table public.cloud_worker_runs (
 id uuid primary key,
 mode text not null references public.cloud_worker_control(mode),
 started_at timestamptz not null default now(),
 completed_at timestamptz,
 outcome text not null default 'running' check(outcome in ('running','completed','failed','interrupted')),
 lanes jsonb not null default '[]',
 deployment_id text
);
alter table public.cloud_worker_runs enable row level security;
revoke all on public.cloud_worker_runs from public,anon,authenticated,service_role,mediaflock_app;
