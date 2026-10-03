alter table social_accounts add column connection_generation integer not null default 1;
alter table social_accounts add column capability_generation integer not null default 0;
