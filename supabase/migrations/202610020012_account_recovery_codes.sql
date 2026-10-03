-- A recovery capability belongs to an Auth user, never to an email claim or
-- workspace name. Only its peppered hash is persisted; plaintext is shown once.
create table public.account_recovery_codes (
 user_id uuid not null references auth.users(id),
 mode text not null check(mode in ('demo','live')),
 workspace_id uuid not null references public.workspaces(id),
 code_hash text not null unique check(code_hash ~ '^[a-f0-9]{64}$'),
 generation integer not null default 1 check(generation>0),
 state text not null default 'active' check(state in ('active','claimed','spent','uncertain')),
 attempt_id uuid,
 claimed_at timestamptz,
 used_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(user_id,mode),
 check((state='active' and attempt_id is null and claimed_at is null and used_at is null) or (state<>'active' and attempt_id is not null and claimed_at is not null))
);
alter table public.account_recovery_codes enable row level security;
alter table public.account_recovery_codes force row level security;
revoke all on public.account_recovery_codes from public,anon,authenticated,mediaflock_app;
