-- Partner workspace access gaps (additive; no drops).

-- Colleagues: members of the same organisation can read each other's profiles.
create or replace function private.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on b.org_id = a.org_id
    where a.user_id = (select auth.uid()) and a.active and b.user_id = p_user and b.active
  );
$$;
grant execute on function private.shares_org_with(uuid) to authenticated;

create policy "profiles: colleagues read" on public.profiles
  for select to authenticated using (private.shares_org_with(id));

-- Servicing brokers/insurers can see the consents of customers they serve (proof of data-sharing consent).
create policy "consents: servicing partners read" on public.consents
  for select to authenticated using (private.can_view_customer(user_id));

-- Complaint owners (and staff) can add timeline notes.
create policy "complaint events: owner notes" on public.complaint_events
  for insert to authenticated
  with check (actor_id = (select auth.uid()) and exists (
    select 1 from public.complaints c where c.id = complaint_id
      and (c.owner_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))));

-- Assisted requests: a broker/insurer member may look up an existing customer by exact email or phone.
-- Returns minimal fields only and never lists customers.
create or replace function public.find_customer_for_partner(p_email text default null, p_phone text default null)
returns table (id uuid, full_name text, email text, phone text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email::text, p.phone
  from public.profiles p
  where exists (
      select 1 from public.memberships m join public.organizations o on o.id = m.org_id
      where m.user_id = (select auth.uid()) and m.active and o.type in ('broker', 'insurer', 'platform') and o.status = 'active')
    and ((p_email is not null and p.email = p_email::extensions.citext)
      or (p_phone is not null and regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g')))
  limit 1;
$$;
revoke execute on function public.find_customer_for_partner(text, text) from public, anon;
grant execute on function public.find_customer_for_partner(text, text) to authenticated;
