-- Approval locks must not grant the runtime role membership write privileges.
-- The verified server transaction may fence one owner in its current workspace.
create function public.mf_approval_owner_current(w uuid, u uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if current_setting('mediaflock.server_verified',true) is distinct from '1'
   or current_setting('mediaflock.workspace',true) is distinct from w::text
   or not public.mf_allowed(w) then
   raise exception 'Approval workspace denied' using errcode='42501';
 end if;
 perform 1 from public.memberships where workspace_id=w and user_id=u and role='owner' for share;
 return found;
end $$;
revoke all on function public.mf_approval_owner_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mf_approval_owner_current(uuid,uuid) to mediaflock_app;
