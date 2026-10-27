-- Applied directly to production on 20261027000306; backfilled from supabase_migrations.schema_migrations statements.
-- Narrow grants for 20261030100400_endorsements_accounting (live had the schema-wide private grant).
revoke execute on function private.refresh_service_partner_rating(uuid) from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.is_platform_staff() to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated, service_role;
