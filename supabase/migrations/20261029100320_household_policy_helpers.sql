-- households <-> household_members read policies referenced each other, which makes Postgres raise
-- "infinite recursion detected in policy" on any household insert/select. Break the cycle with
-- SECURITY DEFINER helpers that read the other table without RLS. No rows are deleted.
create or replace function private.is_household_owner(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.households h where h.id = p_household and h.owner_user_id = (select auth.uid()));
$$;
create or replace function private.is_household_member(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members m
     left join public.beneficiaries b on b.id = m.beneficiary_id
     where m.household_id = p_household
       and (m.user_id = (select auth.uid()) or b.linked_user_id = (select auth.uid()))
  );
$$;
revoke execute on function private.is_household_owner(uuid) from public, anon;
revoke execute on function private.is_household_member(uuid) from public, anon;
grant execute on function private.is_household_owner(uuid) to authenticated, service_role;
grant execute on function private.is_household_member(uuid) to authenticated, service_role;

alter policy "households: owner and members read" on public.households
  using (owner_user_id = (select auth.uid()) or (select private.is_platform_staff()) or private.is_household_member(id));

alter policy "household members: household can read" on public.household_members
  using (private.is_household_owner(household_id) or user_id = (select auth.uid())
         or (beneficiary_id is not null and private.is_beneficiary_user(beneficiary_id))
         or (select private.is_platform_staff()));

alter policy "household members: owner writes" on public.household_members
  using (private.is_household_owner(household_id) or (select private.is_platform_staff()))
  with check (private.is_household_owner(household_id) or (select private.is_platform_staff()));
