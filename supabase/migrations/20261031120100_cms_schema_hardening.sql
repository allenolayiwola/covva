-- Payload uses DATABASE_URI as the table owner; do not FORCE RLS.
-- The schema is optional on fresh databases (Payload owns its migrations).
-- Exposure could not be established from hosted PostgREST settings: protect
-- existing tables regardless of whether cms is currently an exposed schema.
do $$
declare t record;
begin
  if exists (select 1 from pg_namespace where nspname = 'cms') then
    revoke all on schema cms from public, anon, authenticated;
    for t in select tablename from pg_tables where schemaname = 'cms' loop
      execute format('alter table cms.%I enable row level security', t.tablename);
    end loop;
  end if;
end $$;
