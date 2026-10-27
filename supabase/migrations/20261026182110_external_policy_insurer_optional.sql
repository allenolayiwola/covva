-- Applied directly to production on 20261026182110; backfilled from supabase_migrations.schema_migrations statements.
alter table public.policies alter column insurer_org_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'policies_insurer_required_unless_external') then
    alter table public.policies add constraint policies_insurer_required_unless_external
      check (external_source or insurer_org_id is not null);
  end if;
end $$;
