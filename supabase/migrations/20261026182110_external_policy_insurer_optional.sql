-- Applied directly to production on 20261026182110; backfilled from supabase_migrations.schema_migrations statements.
-- Replay-only: no-op on a fresh database when the table this hotfix depends on is not yet created.
do $guard$
begin
  if to_regclass('public.policies') is null then
    return;
  end if;

  execute $sql$
    alter table public.policies alter column insurer_org_id drop not null
  $sql$;

  execute $sql$
    do $$
    begin
      if not exists (select 1 from pg_constraint where conname = 'policies_insurer_required_unless_external') then
        alter table public.policies add constraint policies_insurer_required_unless_external
          check (external_source or insurer_org_id is not null);
      end if;
    end $$
  $sql$;
end
$guard$;
