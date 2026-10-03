-- Fence media processing so a recovered worker cannot overwrite a newer result.
alter table asset_derivatives add column lease_token uuid;
alter table asset_derivatives add column lease_expires_at timestamptz;
