-- Server-only identity state also covers email recovery for accounts that have
-- never created a recovery code. Every actual BFF human request binds its
-- verified Auth token to auth.sessions and this durable cutoff.
create table public.account_security_state (
 user_id uuid primary key references auth.users(id),
 session_cutoff_at timestamptz not null,
 state text not null check(state in ('active','resetting','uncertain')),
 reset_attempt_id uuid not null,
 updated_at timestamptz not null default now()
);
alter table public.account_security_state enable row level security;
alter table public.account_security_state force row level security;
revoke all on public.account_security_state from public,anon,authenticated,mediaflock_app;
alter table public.account_recovery_codes add column auth_cutoff_at timestamptz;

create function public.mf_auth_session_current() returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare current_user_id uuid := auth.uid(); session_id text := auth.jwt()->>'session_id'; cutoff timestamptz; security_state text;
begin
 select session_cutoff_at,state into cutoff,security_state from account_security_state where user_id=current_user_id;
 if not found then return true; end if;
 if security_state<>'active' or session_id is null or session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 return exists(select 1 from auth.sessions s where s.id=session_id::uuid and s.user_id=current_user_id and s.created_at>cutoff);
end $$;
revoke all on function public.mf_auth_session_current() from public,anon,authenticated,mediaflock_app;

create or replace function public.mf_allowed(w uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select (current_setting('mediaflock.service',true)='1' and current_setting('mediaflock.workspace',true)=w::text)
 or (exists(select 1 from memberships where workspace_id=w and user_id=auth.uid())
 and (current_setting('mediaflock.server_verified',true)='1' or public.mf_auth_session_current()));
$$;
