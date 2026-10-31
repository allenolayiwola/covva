-- Local only: supabase test db. All fixtures roll back; never run on production.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Payload's schema is optional locally. Exercise the applied hardening migration
-- on a fixture as well as checking every existing CMS table.
create schema if not exists cms;
create table cms.e2e_schema_rule (title text);
grant usage on schema cms to anon, authenticated;
\ir ../migrations/20261031120100_cms_schema_hardening.sql

-- Effective privileges include grants inherited from PUBLIC or other roles.
select ok(not has_schema_privilege(r.role_name, 'cms', 'USAGE'),
          r.role_name || ': no USAGE on cms')
from (values ('anon'), ('authenticated')) r(role_name);

select ok(not has_table_privilege(r.role_name, c.oid,
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'),
          r.role_name || ': no privileges on cms.' || c.relname)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) r(role_name)
where n.nspname = 'cms' and c.relkind in ('r', 'p');

-- The hardening migration enables RLS without forcing the Payload owner through it.
select ok(c.relrowsecurity, 'cms.' || c.relname || ': RLS enabled')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'cms' and c.relkind in ('r', 'p');

select * from finish();
rollback;
