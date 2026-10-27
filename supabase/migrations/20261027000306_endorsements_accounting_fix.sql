-- Applied directly to production on 20261027000306; backfilled from supabase_migrations.schema_migrations statements.
-- Narrow grants for 20261030100400_endorsements_accounting (live had the schema-wide private grant).
-- Replay-only: no-op on a fresh database when private.refresh_service_partner_rating(uuid) (20261030100400) is not yet created.
do $guard$
begin
  if to_regprocedure('private.refresh_service_partner_rating(uuid)') is null then
    return;
  end if;

  execute $sql$
    revoke execute on function private.refresh_service_partner_rating(uuid) from public, anon, authenticated
  $sql$;

  execute $sql$
    grant execute on function private.is_org_member(uuid) to authenticated, service_role
  $sql$;

  execute $sql$
    grant execute on function private.is_platform_staff() to authenticated, service_role
  $sql$;

  execute $sql$
    grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated, service_role
  $sql$;
end
$guard$;
