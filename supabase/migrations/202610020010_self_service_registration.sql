-- Created only by the server after a verified Auth identity. This table tracks
-- public allocations separately from existing operator workspaces for quotas.
create table public.self_service_registrations (
 user_id uuid not null references auth.users(id),
 workspace_id uuid not null unique references public.workspaces(id),
 mode text not null check(mode in ('demo','live')),
 created_at timestamptz not null default now(),
 primary key(user_id,mode)
);
create index self_service_registration_capacity on public.self_service_registrations(mode,created_at);
alter table public.self_service_registrations enable row level security;
alter table public.self_service_registrations force row level security;
revoke all on public.self_service_registrations from public,anon,authenticated,mediaflock_app;
