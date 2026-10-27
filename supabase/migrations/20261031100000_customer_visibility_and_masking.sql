-- RLS / masking regressions introduced with business (SME) accounts.
--
-- What regressed (20261030100300_sme_group.sql, which reached PR #1 through the base-branch merge):
--   1. create_business_account() wrote account_type = 'business' and business_name onto the OWNER's
--      personal profile. private.partner_renewals() shows coalesce(business_name, masked name), so an
--      insurer saw that customer unmasked as "E2E-SME Test Business"
--      (analytics-rules: "insurer members see masked customer names").
--   2. Customers became org owners (enterprise memberships). The audit policy lets an owner/admin/
--      supervisor of ANY org read that org's audit rows, so a customer now sees audit_events directly
--      and through the security_invoker view public.partner_activity
--      (analytics-rules: "the security_invoker views apply the caller's RLS";
--       db-rules: "customer sees only their own data: no audit log, no memberships, no other profiles").
--   3. The business-accounts e2e spec created its test business as the shared demo customer, so that
--      account now has an E2E business membership.
--
-- Fix (no test is weakened):
--   1. Renewal names: a business name is used only for business accounts (account_type = 'business').
--   2. Org-scoped audit reads are limited to partner organisations (broker, insurer, distributor).
--      Business accounts and their members get no raw audit log; platform staff still read everything.
--   3. Members see their own membership rows only while they are active.
--   4. Data correction, limited to E2E-tagged business accounts: offboard them, deactivate their
--      memberships, and reset any personal profile that carries an E2E business name.
-- Additive and idempotent: create or replace / alter policy / guarded updates. No drops, no deletes.
-- NOT applied by CI or by the PR author; apply it with the normal migration process.

-- 1. Masked renewal names --------------------------------------------------------------------------
create or replace function private.partner_renewals(p_org_id uuid, p_days int, p_org_type public.org_type)
returns table (
  policy_id uuid,
  internal_reference text,
  policy_number text,
  category_id uuid,
  category_name text,
  cover_end date,
  days_left int,
  premium numeric,
  currency text,
  status public.policy_status,
  customer_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  contact_allowed boolean,
  marketing_allowed boolean,
  renewal_request_id uuid,
  renewal_status public.request_status,
  reminders_sent int
)
language sql stable security definer set search_path = '' as $$
  with latest_consent as (
    select distinct on (c.user_id, c.type) c.user_id, c.type, c.granted
    from public.consents c
    order by c.user_id, c.type, c.created_at desc
  )
  select p.id,
         p.internal_reference,
         p.policy_number,
         p.category_id,
         cat.name,
         p.cover_end::date,
         (p.cover_end::date - current_date)::int,
         p.premium,
         p.currency::text,
         p.status,
         p.customer_id,
         case
           -- A business name is shown only for business accounts; an individual's name is always masked
           -- for insurers, even if a business name was ever written onto their personal profile.
           when p_org_type = 'insurer' then coalesce(
             case when pr.account_type = 'business' then nullif(btrim(pr.business_name), '') end,
             private.mask_person_name(coalesce(pr.preferred_name, pr.full_name)),
             'Customer')
           else coalesce(
             case when pr.account_type = 'business' then nullif(btrim(pr.business_name), '') end,
             nullif(btrim(pr.full_name), ''), pr.preferred_name, pr.email, 'Customer')
         end,
         case when p_org_type = 'insurer' then null else pr.email end,
         case when p_org_type = 'insurer' then null else pr.phone end,
         coalesce((select lc.granted from latest_consent lc where lc.user_id = p.customer_id
                     and lc.type = case when p_org_type = 'insurer' then 'data_sharing_insurer'::public.consent_type else 'data_sharing_broker'::public.consent_type end), false),
         coalesce((select lc.granted from latest_consent lc where lc.user_id = p.customer_id and lc.type = 'marketing'), false),
         rr.id,
         rr.status,
         coalesce(jsonb_array_length(case when jsonb_typeof(p.renewal_reminders_sent) = 'array' then p.renewal_reminders_sent else '[]'::jsonb end), 0)::int
  from public.policies p
  join public.product_categories cat on cat.id = p.category_id
  left join public.profiles pr on pr.id = p.customer_id
  left join lateral (
    select r.id, r.status
    from public.requests r
    where r.related_policy_id = p.id and r.type = 'renewal' and r.status not in ('cancelled', 'closed_no_cover')
    order by r.created_at desc
    limit 1
  ) rr on true
  where p.status = 'active'
    and p.cover_end is not null
    and p.cover_end::date >= current_date
    and p.cover_end::date <= current_date + greatest(p_days, 0)
    and (p.broker_org_id = p_org_id or p.insurer_org_id = p_org_id)
  order by p.cover_end asc, p.internal_reference;
$$;

-- 2. Audit log: org-scoped reads only for partner organisations -------------------------------------
create or replace function private.is_partner_org(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org and o.type::text in ('broker', 'insurer', 'distributor')
  );
$$;
revoke execute on function private.is_partner_org(uuid) from public, anon;
grant execute on function private.is_partner_org(uuid) to authenticated, service_role;

alter policy "audit: staff and org leads read" on public.audit_events
  using (
    (select private.is_platform_staff())
    or (org_id is not null
        and private.is_partner_org(org_id)
        and private.has_org_role(org_id, '{owner,admin,supervisor}'))
  );

-- 3. Memberships: your own rows only while active --------------------------------------------------
alter policy "memberships: read own org" on public.memberships
  using (
    (user_id = (select auth.uid()) and active)
    or org_id in (select private.user_org_ids())
    or (select private.is_platform_staff())
  );

-- 4. Data correction for E2E-tagged business accounts -----------------------------------------------
update public.memberships m
   set active = false
  from public.organizations o
 where o.id = m.org_id
   and o.type::text = 'enterprise'
   and o.name like 'E2E-%'
   and m.active;

update public.organizations o
   set status = 'offboarded'
 where o.type::text = 'enterprise'
   and o.name like 'E2E-%'
   and o.status <> 'offboarded';

update public.profiles p
   set account_type = 'individual', business_name = null
 where p.business_name like 'E2E-%'
   and not exists (
     select 1 from public.memberships m
     join public.organizations o on o.id = m.org_id
     where m.user_id = p.id and m.active and o.type::text = 'enterprise' and o.status <> 'offboarded'
   );
