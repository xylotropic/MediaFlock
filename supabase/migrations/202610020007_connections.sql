alter table provider_connections add column redirect_mode text not null default 'override' check(redirect_mode in ('override','project'));
alter table provider_connections add column requested_permissions text[] not null default array['posts','feeds'];
alter table provider_connections add column connection_type text;
