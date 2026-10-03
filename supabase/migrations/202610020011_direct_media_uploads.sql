-- Originals are registered only after the worker verifies their actual bytes.
-- Signed URLs target one fresh object and cannot overwrite an existing object.
create table asset_uploads (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id),
 user_id uuid not null,
 request_id uuid not null,
 filename text not null,
 storage_path text not null unique,
 declared_mime_type text not null check(declared_mime_type in ('image/png','image/jpeg','image/webp','video/mp4','video/quicktime')),
 declared_bytes bigint not null check(declared_bytes>0 and declared_bytes<=52428800),
 expected_checksum text not null check(expected_checksum ~ '^[a-f0-9]{64}$'),
 tags text[] not null default '{}',
 notes text not null default '',
 status text not null check(status in ('awaiting_upload','queued','validating','ready','failed','expired')),
 reserved_bytes bigint not null default 52428800 check(reserved_bytes in (0,52428800)),
 signed_url text,
 expires_at timestamptz not null default now()+interval '135 minutes',
 lease_token uuid,
 lease_expires_at timestamptz,
 asset_id uuid,
 error text,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(workspace_id,user_id,request_id),
 unique(workspace_id,id),
 foreign key(workspace_id,asset_id) references assets(workspace_id,id),
 check((status='ready')=(asset_id is not null))
);
create index asset_uploads_queue on asset_uploads(status,created_at);
alter table asset_uploads enable row level security;
alter table asset_uploads force row level security;
create policy workspace_access on asset_uploads for all to mediaflock_app using(mf_policy(workspace_id)) with check(mf_policy(workspace_id));
revoke all on asset_uploads from anon,authenticated;
grant select,insert,update on asset_uploads to mediaflock_app;
