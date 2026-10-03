-- Browser grants target staging only. The worker owns the final original path.
alter table asset_uploads add column final_storage_path text generated always as
  (workspace_id::text || '/originals/' || id::text || '/' || filename) stored;
alter table asset_uploads add constraint asset_uploads_final_path_unique unique(final_storage_path);
alter table asset_uploads add column staged_bytes bigint not null default 0
  check(staged_bytes>=0 and staged_bytes<=52428800);
alter table asset_uploads drop constraint asset_uploads_reserved_bytes_check;
alter table asset_uploads add constraint asset_uploads_reserved_bytes_check
  check(reserved_bytes in (0,52428800,104857600));
alter table asset_uploads alter column reserved_bytes set default 104857600;
update asset_uploads set reserved_bytes=104857600
  where status in ('awaiting_upload','queued','validating') and reserved_bytes>0;

-- Return capacity only: no identifiers, filenames or other workspace details.
-- Unknown objects count too, including output left by a recovered media lease.
create function mf_media_storage_usage() returns bigint
language sql stable security definer set search_path=public as $$
 with object_sizes as materialized (
   select o.name,case when o.metadata->>'size' ~ '^[0-9]+$'
     then (o.metadata->>'size')::bigint else 52428800 end as bytes
   from storage.objects o where o.bucket_id='mediaflock'
 )
 select (
   (select coalesce(sum(greatest(a.bytes,coalesce(o.bytes,0))),0)
     from public.assets a left join object_sizes o on o.name=a.storage_path) +
   (select coalesce(sum(greatest(u.reserved_bytes+u.staged_bytes,
       (case when registered_stage.id is null then coalesce(stage.bytes,0) else 0 end) +
       (case when registered_final.id is null then coalesce(final.bytes,0) else 0 end))),0)
     from public.asset_uploads u
     left join object_sizes stage on stage.name=u.storage_path
     left join object_sizes final on final.name=u.final_storage_path
     left join public.assets registered_stage on registered_stage.storage_path=u.storage_path
     left join public.assets registered_final on registered_final.storage_path=u.final_storage_path) +
   (select coalesce(sum(greatest(case when d.status='ready'
     then coalesce((d.metadata->>'bytes')::bigint,52428800) else 52428800 end,coalesce(o.bytes,0))),0)
     from public.asset_derivatives d left join object_sizes o on o.name=d.storage_path) +
   (select coalesce(sum(o.bytes),0)
     from object_sizes o where
     not exists(select 1 from public.assets a where a.storage_path=o.name)
     and not exists(select 1 from public.asset_uploads u
       where u.storage_path=o.name or u.final_storage_path=o.name)
     and not exists(select 1 from public.asset_derivatives d where d.storage_path=o.name))
 )::bigint;
$$;
revoke all on function mf_media_storage_usage() from public,anon,authenticated;
grant execute on function mf_media_storage_usage() to mediaflock_app;
