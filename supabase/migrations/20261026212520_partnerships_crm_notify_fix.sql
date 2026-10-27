-- Applied directly to production on 20261026212520; backfilled from supabase_migrations.schema_migrations statements.
-- Partnerships CRM follow-up: channels literal cast (mirrors 20261028100100_partnerships_crm.sql).
-- Replay-only: no-op on a fresh database when public.crm_accounts (20261028100100) is not yet created.
do $guard$
begin
  if to_regclass('public.crm_accounts') is null then
    return;
  end if;

  execute $sql$
    create or replace function private.crm_notify(p_users uuid[], p_kind text, p_title text, p_body text, p_link text, p_data jsonb) returns int
    language plpgsql security definer set search_path = '' as $$
    declare v_n int := 0;
    begin
      insert into public.notifications (user_id, kind, title, body, link, data, channels)
      select distinct u, p_kind, left(p_title, 200), left(p_body, 2000), p_link, coalesce(p_data, '{}'::jsonb), '{in_app}'::text[]
      from unnest(coalesce(p_users, '{}'::uuid[])) as u
      where u is not null;
      get diagnostics v_n = row_count;
      return v_n;
    end $$
  $sql$;

  execute $sql$
    grant execute on function private.crm_notify(uuid[], text, text, text, text, jsonb) to authenticated, service_role
  $sql$;
end
$guard$;
