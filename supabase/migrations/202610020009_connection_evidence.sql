alter table social_accounts add column external_binding text;
alter table provider_connections add column integration_hash text;
alter table provider_connections add column imported_ids uuid[] not null default '{}';
