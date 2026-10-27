-- Applied directly to production on 20261027000309; backfilled from supabase_migrations.schema_migrations statements.
-- Brings the live SME & group objects in line with supabase/migrations/20261030100300_sme_group.sql (guards recognise
-- nested trigger writes and the phone-link RPC; fleet/asset guards are SECURITY DEFINER; private helpers that no
-- policy calls are not executable by API roles). Additive / idempotent: create or replace + grants/revokes only.
-- Replay-only: no-op on a fresh database when private.is_business_org(uuid) (20261030100300) is not yet created.

do $guard$
begin
  if to_regprocedure('private.is_business_org(uuid)') is null then
    return;
  end if;

  execute $sql$
    revoke all on function private.is_business_org(uuid), private.ghana_phone_digits(text) from public, anon, authenticated
  $sql$;

  execute $sql$
    grant execute on function private.can_admin_scheme(uuid), private.is_scheme_partner(uuid), private.is_scheme_member_user(uuid),
      private.services_business(uuid), private.request_business_org(uuid)
      to authenticated, service_role
  $sql$;

  execute $sql$
    grant execute on function private.is_business_org(uuid), private.ghana_phone_digits(text) to service_role
  $sql$;

  execute $sql$
    create or replace function private.group_schemes_guard() returns trigger
    language plpgsql security definer set search_path = '' as $$
    declare
      v_broker boolean;
    begin
      -- System paths: service role, staff and nested triggers (member_count upkeep, placement sync). Inside SECURITY
      -- DEFINER functions is_service_role() reads the JWT, so trigger-driven writes are recognised by depth instead.
      if private.is_service_role() or private.is_platform_staff() or pg_trigger_depth() > 1 then
        return new;
      end if;
      if tg_op = 'INSERT' then
        if not private.is_business_org(new.business_org_id) then
          raise exception 'Group schemes belong to a business account' using errcode = 'P0001';
        end if;
        new.status := 'draft';
        new.broker_org_id := null; new.insurer_org_id := null; new.policy_id := null; new.request_id := null;
        new.member_count := 0;
        new.created_by := (select auth.uid());
        return new;
      end if;
      if new.business_org_id <> old.business_org_id then
        raise exception 'A scheme cannot move to another business account' using errcode = 'P0001';
      end if;
      new.member_count := old.member_count;
      new.request_id := old.request_id;
      new.created_by := old.created_by;
      v_broker := old.broker_org_id is not null and private.is_org_member(old.broker_org_id);
      if new.broker_org_id is distinct from old.broker_org_id then
        raise exception 'The broker of record is set when a broker accepts the scheme' using errcode = 'P0001';
      end if;
      if v_broker then
        return new;
      end if;
      if new.insurer_org_id is distinct from old.insurer_org_id or new.policy_id is distinct from old.policy_id then
        raise exception 'The insurer and master policy are recorded when the scheme is placed' using errcode = 'P0001';
      end if;
      if new.status is distinct from old.status and new.status <> 'cancelled' then
        raise exception 'A business can only cancel a scheme; other status changes follow the quote and the policy' using errcode = 'P0001';
      end if;
      if new.category_id is distinct from old.category_id and old.status <> 'draft' then
        raise exception 'The type of cover can only change while the scheme is a draft' using errcode = 'P0001';
      end if;
      return new;
    end $$
  $sql$;

  execute $sql$
    create or replace function private.scheme_members_guard() returns trigger
    language plpgsql security definer set search_path = '' as $$
    begin
      if new.principal_member_id is not null and not exists (
        select 1 from public.scheme_members p
        where p.id = new.principal_member_id and p.scheme_id = new.scheme_id and p.relationship = 'employee'
      ) then
        raise exception 'A dependant must be linked to an employee on the same scheme' using errcode = 'P0001';
      end if;
      if new.relationship = 'employee' then
        new.principal_member_id := null;
      end if;
      if new.status = 'removed' then
        new.left_at := coalesce(new.left_at, current_date);
      end if;
      -- System paths: service role, staff, nested triggers and the verified-phone linking RPC (app.sme_link).
      if private.is_service_role() or private.is_platform_staff() or pg_trigger_depth() > 1
         or coalesce(current_setting('app.sme_link', true), '') = '1' then
        return new;
      end if;
      if tg_op = 'INSERT' then
        new.user_id := null;
        return new;
      end if;
      if new.scheme_id <> old.scheme_id then
        raise exception 'A member cannot move to another scheme' using errcode = 'P0001';
      end if;
      if new.user_id is distinct from old.user_id then
        raise exception 'Members link their own account by signing in with the same phone number' using errcode = 'P0001';
      end if;
      return new;
    end $$
  $sql$;

  execute $sql$
    create or replace function private.fleet_vehicles_normalise() returns trigger
    language plpgsql security definer set search_path = '' as $$
    begin
      new.registration := upper(regexp_replace(btrim(new.registration), '\s+', ' ', 'g'));
      if tg_op = 'UPDATE' and new.business_org_id <> old.business_org_id and not (private.is_service_role() or private.is_platform_staff()) then
        raise exception 'A vehicle cannot move to another business account' using errcode = 'P0001';
      end if;
      if tg_op = 'INSERT' and not private.is_business_org(new.business_org_id) then
        raise exception 'Vehicles belong to a business account' using errcode = 'P0001';
      end if;
      if not (private.is_service_role() or private.is_platform_staff() or pg_trigger_depth() > 1) then
        if tg_op = 'INSERT' then
          new.policy_id := null;
          new.created_by := (select auth.uid());
        elsif new.policy_id is distinct from old.policy_id then
          raise exception 'The policy is linked when the fleet cover is issued' using errcode = 'P0001';
        end if;
      end if;
      return new;
    end $$
  $sql$;

  execute $sql$
    create or replace function private.business_assets_guard() returns trigger
    language plpgsql security definer set search_path = '' as $$
    begin
      if tg_op = 'UPDATE' and new.business_org_id <> old.business_org_id and not (private.is_service_role() or private.is_platform_staff()) then
        raise exception 'An asset cannot move to another business account' using errcode = 'P0001';
      end if;
      if tg_op = 'INSERT' and not private.is_business_org(new.business_org_id) then
        raise exception 'Assets belong to a business account' using errcode = 'P0001';
      end if;
      if not (private.is_service_role() or private.is_platform_staff() or pg_trigger_depth() > 1) then
        if tg_op = 'INSERT' then
          new.policy_id := null;
          new.created_by := (select auth.uid());
        elsif new.policy_id is distinct from old.policy_id then
          raise exception 'The policy is linked when the cover is issued' using errcode = 'P0001';
        end if;
      end if;
      return new;
    end $$
  $sql$;

  execute $sql$
    create or replace function public.link_my_scheme_memberships() returns integer
    language plpgsql security definer set search_path = '' as $$
    declare
      v_uid uuid := auth.uid();
      v_phone text;
      v_n integer := 0;
    begin
      if v_uid is null then return 0; end if;
      select private.ghana_phone_digits(u.phone) into v_phone
        from auth.users u where u.id = v_uid and u.phone is not null and u.phone_confirmed_at is not null;
      if v_phone is null or length(v_phone) < 12 then return 0; end if;
      perform set_config('app.sme_link', '1', true);
      update public.scheme_members m
         set user_id = v_uid
       where m.user_id is null and m.status <> 'removed' and m.phone is not null
         and private.ghana_phone_digits(m.phone) = v_phone;
      get diagnostics v_n = row_count;
      perform set_config('app.sme_link', '', true);
      return v_n;
    end $$
  $sql$;

  execute $sql$
    revoke all on function public.link_my_scheme_memberships() from public, anon
  $sql$;

  execute $sql$
    grant execute on function public.link_my_scheme_memberships() to authenticated, service_role
  $sql$;

  execute $sql$
    revoke delete, truncate on public.group_schemes, public.scheme_members, public.fleet_vehicles, public.business_assets, public.business_invoices from service_role
  $sql$;
end
$guard$;
