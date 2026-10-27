-- Applied directly to production on 20261027070136; backfilled from supabase_migrations.schema_migrations statements.
-- create_business_account no longer rewrites the owner's personal profile (account_type / business_name), which
-- leaked the business name into customer display and analytics masking. Mirrors 20261030100300_sme_group.sql.
-- Replay-only: no-op on a fresh database when private.is_business_org(uuid) (20261030100300) is not yet created.
do $guard$
begin
  if to_regprocedure('private.is_business_org(uuid)') is null then
    return;
  end if;

  execute $sql$
    create or replace function public.create_business_account(p_name text, p_profile jsonb default '{}'::jsonb) returns uuid
    language plpgsql security definer set search_path = '' as $$
    declare
      v_uid uuid := auth.uid();
      v_name text := btrim(coalesce(p_name, ''));
      v_profile jsonb := coalesce(p_profile, '{}'::jsonb);
      v_slug text;
      v_org uuid;
      v_email text := lower(btrim(coalesce(v_profile ->> 'billing_email', '')));
    begin
      if v_uid is null then
        raise exception 'Please sign in to create a business account' using errcode = 'P0001';
      end if;
      if length(v_name) < 2 or length(v_name) > 160 then
        raise exception 'Enter the business name (2–160 characters)' using errcode = 'P0001';
      end if;
      if v_email <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
        raise exception 'Enter a valid billing email' using errcode = 'P0001';
      end if;
      if (select count(*) from public.memberships m join public.organizations o on o.id = m.org_id
           where m.user_id = v_uid and m.role = 'owner' and m.active and o.type = 'enterprise') >= 5 then
        raise exception 'You can own up to 5 business accounts. Contact support for more.' using errcode = 'P0001';
      end if;

      v_slug := trim(both '-' from left(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), 48));
      v_slug := 'biz-' || coalesce(nullif(v_slug, ''), 'business') || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

      insert into public.organizations (type, status, name, slug, legal_name, registration_number, contact_email, contact_phone, address, region, business_profile)
      values (
        'enterprise', 'active', v_name, v_slug,
        nullif(left(btrim(coalesce(v_profile ->> 'legal_name', '')), 160), ''),
        nullif(left(btrim(coalesce(v_profile ->> 'registration_number', '')), 60), ''),
        nullif(v_email, '')::extensions.citext,
        nullif(left(btrim(coalesce(v_profile ->> 'phone', '')), 20), ''),
        nullif(left(btrim(coalesce(v_profile ->> 'address', '')), 300), ''),
        nullif(left(btrim(coalesce(v_profile ->> 'region', '')), 60), ''),
        jsonb_strip_nulls(jsonb_build_object(
          'industry', nullif(left(btrim(coalesce(v_profile ->> 'industry', '')), 120), ''),
          'employees', case when (v_profile ->> 'employees') ~ '^[0-9]{1,7}$' then (v_profile ->> 'employees')::int end,
          'tin', nullif(left(btrim(coalesce(v_profile ->> 'tin', '')), 40), ''),
          'registration_number', nullif(left(btrim(coalesce(v_profile ->> 'registration_number', '')), 60), ''),
          'billing_email', nullif(v_email, ''),
          'billing_contact', nullif(left(btrim(coalesce(v_profile ->> 'billing_contact', '')), 120), '')
        ))
      )
      returning id into v_org;

      insert into public.memberships (org_id, user_id, role, title, active)
      values (v_org, v_uid, 'owner', 'Account owner', true)
      on conflict (org_id, user_id) do nothing;

      -- The owner's personal profile is left untouched (a person can own a business account and still buy personal
      -- cover; profiles.business_name feeds customer display/masking elsewhere).
      return v_org;
    end $$
  $sql$;
end
$guard$;
