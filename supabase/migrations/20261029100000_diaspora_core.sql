-- =============================================================================
-- Diaspora core (build prompt "DIASPORA", Roadmap Phase 2): sponsor accounts,
-- households, beneficiaries with SMS/WhatsApp OTP consent, sponsorships
-- (payer ↔ policy ↔ beneficiary, gifts), proxy claims with consent, dual
-- notifications. Additive only: no drops, no deletes; policies, triggers and
-- columns are created only when missing.
--
-- Payments (multi-currency, FX, recurring sponsor payments, bundles) live in a
-- separate migration owned by the payments stream.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sponsor fields on profiles
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists country_code text not null default 'GH';
alter table public.profiles add column if not exists preferred_currency char(3) not null default 'GHS';
alter table public.profiles add column if not exists is_sponsor boolean not null default false;
alter table public.profiles add column if not exists timezone text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_country_code_check') then
    alter table public.profiles add constraint profiles_country_code_check check (country_code ~ '^[A-Z]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_preferred_currency_check') then
    alter table public.profiles add constraint profiles_preferred_currency_check check (preferred_currency ~ '^[A-Z]{3}$');
  end if;
end $$;
comment on column public.profiles.country_code is 'ISO-3166 alpha-2 country of residence. Anything other than GH marks a diaspora sponsor (is_sponsor).';
comment on column public.profiles.preferred_currency is 'Currency the user prefers to see prices in (GHS, GBP, USD, EUR, CAD …). Premiums always settle in GHS.';
comment on column public.profiles.is_sponsor is 'Diaspora sponsor: lives abroad and buys/manages cover for family in Ghana.';
comment on column public.profiles.timezone is 'IANA time zone for reminders (e.g. Europe/London). Null = Africa/Accra.';

-- New sign-ups carry country/currency in the auth metadata (sign-up form asks for the country).
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_country text := upper(coalesce(nullif(trim(new.raw_user_meta_data ->> 'country_code'), ''), 'GH'));
  v_currency text := upper(coalesce(nullif(trim(new.raw_user_meta_data ->> 'preferred_currency'), ''), 'GHS'));
begin
  if v_country !~ '^[A-Z]{2}$' then v_country := 'GH'; end if;
  if v_currency !~ '^[A-Z]{3}$' then v_currency := 'GHS'; end if;
  insert into public.profiles (id, email, phone, full_name, account_type, business_name, country_code, preferred_currency, is_sponsor, timezone)
  values (
    new.id,
    new.email,
    coalesce(new.phone, new.raw_user_meta_data ->> 'phone'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce((new.raw_user_meta_data ->> 'account_type')::public.account_type, 'individual'),
    new.raw_user_meta_data ->> 'business_name',
    v_country,
    v_currency,
    v_country <> 'GH',
    nullif(trim(new.raw_user_meta_data ->> 'timezone'), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Households and beneficiaries
-- ---------------------------------------------------------------------------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'My family',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.households is 'A sponsor''s family group. One per owner by default; members are beneficiaries and/or Covva users.';
create unique index if not exists households_owner_default on public.households (owner_user_id);

create table if not exists public.beneficiaries (
  id uuid primary key default gen_random_uuid(),
  sponsor_user_id uuid not null references auth.users (id) on delete cascade,
  household_id uuid references public.households (id) on delete set null,
  full_name text not null,
  relationship text not null default 'other' check (relationship in ('parent', 'spouse', 'child', 'sibling', 'other')),
  phone text not null,                       -- E.164 Ghana number (+233XXXXXXXXX)
  email extensions.citext,
  date_of_birth date,
  ghana_card_number text,                    -- masked in every UI; only the last 4 are shown
  address text,
  region text,
  linked_user_id uuid references auth.users (id) on delete set null,  -- set when the beneficiary has their own Covva account
  consent_status text not null default 'pending' check (consent_status in ('pending', 'granted', 'declined', 'expired')),
  consent_channel text check (consent_channel is null or consent_channel in ('sms', 'whatsapp')),
  consent_code_hash text,
  consent_sent_at timestamptz,
  consent_granted_at timestamptz,
  consent_expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beneficiaries_phone_check check (phone ~ '^\+233\d{9}$'),
  constraint beneficiaries_not_self check (linked_user_id is null or linked_user_id <> sponsor_user_id)
);
comment on table public.beneficiaries is
  'Family member in Ghana a sponsor abroad buys cover for. Consent (data sharing) is captured from the beneficiary by SMS/WhatsApp OTP or a signed link; the consent_* columns mirror the data_sharing row in beneficiary_consents.';
create index if not exists beneficiaries_sponsor_idx on public.beneficiaries (sponsor_user_id, created_at desc);
create index if not exists beneficiaries_linked_idx on public.beneficiaries (linked_user_id) where linked_user_id is not null;
create index if not exists beneficiaries_phone_idx on public.beneficiaries (phone);
create index if not exists beneficiaries_consent_idx on public.beneficiaries (consent_status);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  beneficiary_id uuid references public.beneficiaries (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'sponsor', 'member')),
  created_at timestamptz not null default now(),
  constraint household_members_subject check (user_id is not null or beneficiary_id is not null)
);
create unique index if not exists household_members_user_unique on public.household_members (household_id, user_id) where user_id is not null;
create unique index if not exists household_members_beneficiary_unique on public.household_members (household_id, beneficiary_id) where beneficiary_id is not null;
create index if not exists household_members_household_idx on public.household_members (household_id);

-- ---------------------------------------------------------------------------
-- 3. Beneficiary consents (one row per beneficiary × kind) and sponsorships
-- ---------------------------------------------------------------------------
create table if not exists public.beneficiary_consents (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries (id) on delete cascade,
  kind text not null check (kind in ('data_sharing', 'proxy_claims', 'policy_purchase')),
  granted boolean not null default false,
  granted_at timestamptz,
  declined_at timestamptz,
  channel text check (channel is null or channel in ('sms', 'whatsapp', 'link')),
  code_hash text,
  requested_at timestamptz,
  expires_at timestamptz,
  attempts int not null default 0,
  locked_at timestamptz,
  requested_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (beneficiary_id, kind)
);
comment on table public.beneficiary_consents is
  'Consent decisions captured from the beneficiary (not the sponsor): data_sharing (needed to buy cover for them), proxy_claims (sponsor may start/follow claims on their behalf), policy_purchase. OTP codes are stored hashed with a 15-minute expiry and 5 attempts.';
create index if not exists beneficiary_consents_pending_idx on public.beneficiary_consents (kind, granted, requested_at desc);

create table if not exists public.sponsorships (
  id uuid primary key default gen_random_uuid(),
  sponsor_user_id uuid not null references auth.users (id) on delete cascade,
  beneficiary_id uuid not null references public.beneficiaries (id) on delete cascade,
  request_id uuid references public.requests (id) on delete set null,
  policy_id uuid references public.policies (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'ended')),
  gift boolean not null default false,
  gift_message text,
  gift_revealed_at timestamptz,
  notify_beneficiary boolean not null default true,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sponsorships_gift_message_len check (gift_message is null or length(gift_message) <= 500)
);
comment on table public.sponsorships is 'Links the payer abroad (sponsor) to the policy and the beneficiary it covers. One sponsorship per policy. Gifts carry a personal message revealed to the beneficiary.';
create unique index if not exists sponsorships_one_per_policy on public.sponsorships (policy_id) where policy_id is not null;
create unique index if not exists sponsorships_one_per_request on public.sponsorships (request_id) where request_id is not null;
create index if not exists sponsorships_sponsor_idx on public.sponsorships (sponsor_user_id, status);
create index if not exists sponsorships_beneficiary_idx on public.sponsorships (beneficiary_id);

-- ---------------------------------------------------------------------------
-- 4. Columns on existing tables
-- ---------------------------------------------------------------------------
alter table public.requests add column if not exists sponsor_user_id uuid references auth.users (id) on delete set null;
alter table public.requests add column if not exists beneficiary_id uuid references public.beneficiaries (id) on delete set null;
comment on column public.requests.sponsor_user_id is 'Diaspora sponsor paying for this cover when the request is for a family member (customer_id stays the account that created it).';
comment on column public.requests.beneficiary_id is 'Family member in Ghana the cover is for (beneficiaries row), when not the requester.';
create index if not exists requests_sponsor_idx on public.requests (sponsor_user_id) where sponsor_user_id is not null;
create index if not exists requests_beneficiary_idx on public.requests (beneficiary_id) where beneficiary_id is not null;

alter table public.policies add column if not exists beneficiary_id uuid references public.beneficiaries (id) on delete set null;
alter table public.policies add column if not exists sponsor_user_id uuid references auth.users (id) on delete set null;
comment on column public.policies.sponsor_user_id is 'Diaspora sponsor who pays for this policy (reads it, gets dual notifications, may claim by proxy with consent).';
comment on column public.policies.beneficiary_id is 'Beneficiary in Ghana covered by this policy.';
create index if not exists policies_sponsor_idx on public.policies (sponsor_user_id) where sponsor_user_id is not null;
create index if not exists policies_beneficiary_idx on public.policies (beneficiary_id) where beneficiary_id is not null;

alter table public.claims add column if not exists reported_by_user_id uuid references auth.users (id) on delete set null;
alter table public.claims add column if not exists proxy_consent_id uuid references public.beneficiary_consents (id) on delete set null;
comment on column public.claims.reported_by_user_id is 'Who reported the claim when not the policyholder (a sponsor filing by proxy). Null = the customer.';
comment on column public.claims.proxy_consent_id is 'The beneficiary''s proxy_claims consent that authorised a sponsor-filed claim.';
create index if not exists claims_reported_by_idx on public.claims (reported_by_user_id) where reported_by_user_id is not null;

alter table public.notifications add column if not exists recipient_role text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_recipient_role_check') then
    alter table public.notifications add constraint notifications_recipient_role_check
      check (recipient_role is null or recipient_role in ('sponsor', 'beneficiary', 'customer'));
  end if;
end $$;
comment on column public.notifications.recipient_role is 'Dual notifications: which party this copy went to (sponsor / beneficiary / customer).';

-- Policies issued from a sponsored request inherit sponsor + beneficiary (service role writes the policy).
create or replace function private.policies_inherit_sponsor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.request_id is not null and (new.sponsor_user_id is null or new.beneficiary_id is null) then
    select sponsor_user_id, beneficiary_id into r from public.requests where id = new.request_id;
    if found then
      new.sponsor_user_id := coalesce(new.sponsor_user_id, r.sponsor_user_id);
      new.beneficiary_id := coalesce(new.beneficiary_id, r.beneficiary_id);
    end if;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'policies_inherit_sponsor' and tgrelid = 'public.policies'::regclass) then
    create trigger policies_inherit_sponsor before insert on public.policies
      for each row execute function private.policies_inherit_sponsor();
  end if;
end $$;

-- A sponsorship becomes active once its request has a policy (sponsorship.policy_id follows).
create or replace function private.sponsorships_follow_policy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.request_id is not null then
    update public.sponsorships
       set policy_id = coalesce(policy_id, new.id),
           status = case when status = 'draft' then 'active' else status end,
           started_at = coalesce(started_at, now())
     where request_id = new.request_id and (policy_id is null or policy_id = new.id);
  end if;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sponsorships_follow_policy' and tgrelid = 'public.policies'::regclass) then
    create trigger sponsorships_follow_policy after insert on public.policies
      for each row execute function private.sponsorships_follow_policy();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Housekeeping triggers (updated_at + audit)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['households', 'beneficiaries', 'beneficiary_consents', 'sponsorships'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

-- Sponsors never write consent fields directly (only the OTP / link RPCs and the service role do),
-- and cannot re-point a beneficiary at another sponsor or account.
create or replace function private.beneficiaries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- System paths bypass the guard: the service role, staff, the consent RPCs (app.consent_rpc) and
  -- nested triggers (account linking from the profiles trigger).
  if private.is_service_role() or private.is_platform_staff() or coalesce(current_setting('app.consent_rpc', true), '') = '1' or pg_trigger_depth() > 1 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.sponsor_user_id <> (select auth.uid()) then
      raise exception 'A beneficiary belongs to the sponsor who adds them' using errcode = 'P0001';
    end if;
    new.consent_status := 'pending';
    new.consent_channel := null; new.consent_code_hash := null; new.consent_sent_at := null;
    new.consent_granted_at := null; new.consent_expires_at := null;
    new.linked_user_id := null;
    return new;
  end if;
  if new.sponsor_user_id <> old.sponsor_user_id then
    raise exception 'A beneficiary cannot be moved to another sponsor' using errcode = 'P0001';
  end if;
  if new.linked_user_id is distinct from old.linked_user_id then
    raise exception 'Accounts are linked automatically when the beneficiary signs up with this number' using errcode = 'P0001';
  end if;
  if new.consent_status is distinct from old.consent_status
     or new.consent_code_hash is distinct from old.consent_code_hash
     or new.consent_sent_at is distinct from old.consent_sent_at
     or new.consent_granted_at is distinct from old.consent_granted_at
     or new.consent_expires_at is distinct from old.consent_expires_at
     or new.consent_channel is distinct from old.consent_channel then
    raise exception 'Consent is captured from the beneficiary by code or link, never edited directly' using errcode = 'P0001';
  end if;
  -- A phone change invalidates consent captured on the old number.
  if new.phone <> old.phone and old.consent_status = 'granted' then
    new.consent_status := 'pending';
    new.consent_granted_at := null;
    update public.beneficiary_consents set granted = false, granted_at = null, code_hash = null, expires_at = null, attempts = 0, locked_at = null
     where beneficiary_id = old.id;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'beneficiaries_guard' and tgrelid = 'public.beneficiaries'::regclass) then
    create trigger beneficiaries_guard before insert or update on public.beneficiaries
      for each row execute function private.beneficiaries_guard();
  end if;
end $$;

-- Sponsorships: a sponsor may only link their own beneficiaries/requests/policies; gift reveal and
-- status transitions to active are system-driven.
create or replace function private.sponsorships_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if private.is_service_role() or private.is_platform_staff() or coalesce(current_setting('app.consent_rpc', true), '') = '1' or pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.sponsor_user_id <> v_uid then
    raise exception 'A sponsorship belongs to the sponsor who creates it' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.beneficiaries b where b.id = new.beneficiary_id and b.sponsor_user_id = v_uid) then
    raise exception 'Add the family member as a beneficiary first' using errcode = 'P0001';
  end if;
  if new.request_id is not null and not exists (select 1 from public.requests r where r.id = new.request_id and (r.customer_id = v_uid or r.sponsor_user_id = v_uid)) then
    raise exception 'That request is not yours' using errcode = 'P0001';
  end if;
  if new.policy_id is not null and not exists (select 1 from public.policies p where p.id = new.policy_id and (p.customer_id = v_uid or p.sponsor_user_id = v_uid)) then
    raise exception 'That policy is not one you pay for' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.gift_revealed_at := null;
    new.status := case when new.policy_id is not null then 'active' else 'draft' end;
    new.started_at := case when new.policy_id is not null then now() else null end;
  else
    if new.gift_revealed_at is distinct from old.gift_revealed_at then
      raise exception 'Only the beneficiary can open a gift' using errcode = 'P0001';
    end if;
    if new.status = 'active' and old.status <> 'active' and new.policy_id is null then
      raise exception 'A sponsorship is active once a policy is linked' using errcode = 'P0001';
    end if;
    if new.status = 'ended' and old.status <> 'ended' then new.ended_at := coalesce(new.ended_at, now()); end if;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sponsorships_guard' and tgrelid = 'public.sponsorships'::regclass) then
    create trigger sponsorships_guard before insert or update on public.sponsorships
      for each row execute function private.sponsorships_guard();
  end if;
end $$;

-- Automatic account linking: when a user's profile carries the beneficiary's phone number, the
-- beneficiary record is linked to that account (sponsor excluded). Runs on sign-up (profile insert)
-- and whenever the phone is set/changed.
create or replace function private.link_beneficiary_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_digits text;
begin
  if new.phone is null then return new; end if;
  if tg_op = 'UPDATE' and new.phone is not distinct from old.phone then return new; end if;
  v_digits := regexp_replace(new.phone, '\D', '', 'g');
  if length(v_digits) < 9 then return new; end if;
  update public.beneficiaries b
     set linked_user_id = new.id
   where b.linked_user_id is null and b.sponsor_user_id <> new.id
     and regexp_replace(b.phone, '\D', '', 'g') = v_digits;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_link_beneficiary' and tgrelid = 'public.profiles'::regclass) then
    create trigger profiles_link_beneficiary after insert or update of phone on public.profiles
      for each row execute function private.link_beneficiary_profile();
  end if;
end $$;

-- Also link a new beneficiary to an existing account with the same number.
create or replace function private.link_beneficiary_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if new.linked_user_id is not null then return new; end if;
  select p.id into v_user from public.profiles p
   where p.id <> new.sponsor_user_id and p.phone is not null
     and regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(new.phone, '\D', '', 'g')
   limit 1;
  if v_user is not null then new.linked_user_id := v_user; end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'beneficiaries_link_account' and tgrelid = 'public.beneficiaries'::regclass) then
    -- Runs after the guard (alphabetical order: beneficiaries_guard < beneficiaries_link_account) so the
    -- guard's linked_user_id reset does not undo the lookup.
    create trigger beneficiaries_link_account before insert on public.beneficiaries
      for each row execute function private.link_beneficiary_on_insert();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Access helpers
-- ---------------------------------------------------------------------------
create or replace function private.is_beneficiary_user(p_beneficiary uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.beneficiaries b where b.id = p_beneficiary and b.linked_user_id = (select auth.uid()));
$$;

create or replace function private.is_policy_sponsor(p_policy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.policies p where p.id = p_policy and p.sponsor_user_id = (select auth.uid()));
$$;

create or replace function private.is_policy_beneficiary(p_policy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.policies p join public.beneficiaries b on b.id = p.beneficiary_id
    where p.id = p_policy and b.linked_user_id = (select auth.uid()));
$$;

-- Sponsors and linked beneficiaries can access the policy (documents, timeline) and its claims.
create or replace function private.can_access_policy(p_policy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.policies p where p.id = p_policy and (
      p.customer_id = (select auth.uid())
      or p.sponsor_user_id = (select auth.uid())
      or p.broker_org_id in (select private.user_org_ids())
      or p.insurer_org_id in (select private.user_org_ids())
      or private.is_platform_staff()
      or (p.beneficiary_id is not null and private.is_beneficiary_user(p.beneficiary_id))
    )
  );
$$;

create or replace function private.can_access_claim(p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.claims c where c.id = p_claim and (
      c.customer_id = (select auth.uid())
      or c.reported_by_user_id = (select auth.uid())
      or c.broker_org_id in (select private.user_org_ids())
      or c.insurer_org_id in (select private.user_org_ids())
      or private.is_platform_staff()
      or private.is_policy_sponsor(c.policy_id)
      or private.is_policy_beneficiary(c.policy_id)
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.beneficiaries enable row level security;
alter table public.beneficiary_consents enable row level security;
alter table public.sponsorships enable row level security;

select private.ensure_policy('households', 'households: owner and members read', $p$
  create policy "households: owner and members read" on public.households for select to authenticated
  using (owner_user_id = (select auth.uid()) or (select private.is_platform_staff())
      or exists (select 1 from public.household_members m where m.household_id = households.id and m.user_id = (select auth.uid()))
      or exists (select 1 from public.household_members m join public.beneficiaries b on b.id = m.beneficiary_id
                 where m.household_id = households.id and b.linked_user_id = (select auth.uid())))$p$);
select private.ensure_policy('households', 'households: owner writes', $p$
  create policy "households: owner writes" on public.households for all to authenticated
  using (owner_user_id = (select auth.uid()) or (select private.is_platform_staff()))
  with check (owner_user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);

select private.ensure_policy('household_members', 'household members: household can read', $p$
  create policy "household members: household can read" on public.household_members for select to authenticated
  using (exists (select 1 from public.households h where h.id = household_id and (h.owner_user_id = (select auth.uid())))
      or user_id = (select auth.uid())
      or (beneficiary_id is not null and private.is_beneficiary_user(beneficiary_id))
      or (select private.is_platform_staff()))$p$);
select private.ensure_policy('household_members', 'household members: owner writes', $p$
  create policy "household members: owner writes" on public.household_members for all to authenticated
  using (exists (select 1 from public.households h where h.id = household_id and h.owner_user_id = (select auth.uid())) or (select private.is_platform_staff()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.owner_user_id = (select auth.uid())) or (select private.is_platform_staff()))$p$);

select private.ensure_policy('beneficiaries', 'beneficiaries: sponsor, linked user and staff read', $p$
  create policy "beneficiaries: sponsor, linked user and staff read" on public.beneficiaries for select to authenticated
  using (sponsor_user_id = (select auth.uid()) or linked_user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('beneficiaries', 'beneficiaries: sponsor adds own', $p$
  create policy "beneficiaries: sponsor adds own" on public.beneficiaries for insert to authenticated
  with check (sponsor_user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('beneficiaries', 'beneficiaries: sponsor edits own', $p$
  create policy "beneficiaries: sponsor edits own" on public.beneficiaries for update to authenticated
  using (sponsor_user_id = (select auth.uid()) or (select private.is_platform_staff()))
  with check (sponsor_user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);

-- Consent rows are readable by the sponsor and the beneficiary's own account; written only by the RPCs.
select private.ensure_policy('beneficiary_consents', 'beneficiary consents: parties read', $p$
  create policy "beneficiary consents: parties read" on public.beneficiary_consents for select to authenticated
  using (exists (select 1 from public.beneficiaries b where b.id = beneficiary_id
                 and (b.sponsor_user_id = (select auth.uid()) or b.linked_user_id = (select auth.uid())))
      or (select private.is_platform_staff()))$p$);

select private.ensure_policy('sponsorships', 'sponsorships: sponsor and beneficiary read', $p$
  create policy "sponsorships: sponsor and beneficiary read" on public.sponsorships for select to authenticated
  using (sponsor_user_id = (select auth.uid()) or private.is_beneficiary_user(beneficiary_id) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('sponsorships', 'sponsorships: sponsor creates', $p$
  create policy "sponsorships: sponsor creates" on public.sponsorships for insert to authenticated
  with check (sponsor_user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('sponsorships', 'sponsorships: sponsor edits own', $p$
  create policy "sponsorships: sponsor edits own" on public.sponsorships for update to authenticated
  using (sponsor_user_id = (select auth.uid()) or (select private.is_platform_staff()))
  with check (sponsor_user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);

-- Sponsors read the requests, policies and claims they pay for; linked beneficiaries read their policies
-- and claims. Additional (OR-ed) select policies so the existing ones stay untouched.
select private.ensure_policy('requests', 'requests: sponsor reads', $p$
  create policy "requests: sponsor reads" on public.requests for select to authenticated
  using (sponsor_user_id = (select auth.uid()))$p$);
select private.ensure_policy('policies', 'policies: sponsor and beneficiary read', $p$
  create policy "policies: sponsor and beneficiary read" on public.policies for select to authenticated
  using (sponsor_user_id = (select auth.uid()) or (beneficiary_id is not null and private.is_beneficiary_user(beneficiary_id)))$p$);
select private.ensure_policy('claims', 'claims: sponsor, reporter and beneficiary read', $p$
  create policy "claims: sponsor, reporter and beneficiary read" on public.claims for select to authenticated
  using (reported_by_user_id = (select auth.uid()) or private.is_policy_sponsor(policy_id) or private.is_policy_beneficiary(policy_id))$p$);

-- ---------------------------------------------------------------------------
-- 8. Consent OTP RPCs
-- ---------------------------------------------------------------------------
-- The plaintext code must never reach the sponsor (that is the point of beneficiary consent), so the
-- request RPC runs under the service role only: the server verifies the caller is the sponsor through
-- an RLS read of the beneficiary, calls this, and sends the code to the beneficiary's phone.
create or replace function public.request_beneficiary_consent(p_beneficiary_id uuid, p_kind text, p_channel text default 'sms')
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_hash text;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if not private.is_service_role() then
    raise exception 'Consent codes are issued by the platform' using errcode = 'P0001';
  end if;
  if p_kind not in ('data_sharing', 'proxy_claims', 'policy_purchase') then
    raise exception 'Unknown consent kind' using errcode = 'P0001';
  end if;
  if p_channel not in ('sms', 'whatsapp') then
    raise exception 'Consent codes go by SMS or WhatsApp' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.beneficiaries where id = p_beneficiary_id) then
    raise exception 'Beneficiary not found' using errcode = 'P0001';
  end if;
  perform set_config('app.consent_rpc', '1', true);
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  v_hash := encode(extensions.digest(p_beneficiary_id::text || ':' || p_kind || ':' || v_code, 'sha256'), 'hex');

  insert into public.beneficiary_consents (beneficiary_id, kind, granted, channel, code_hash, requested_at, expires_at, attempts, locked_at, requested_by)
  values (p_beneficiary_id, p_kind, false, p_channel, v_hash, now(), v_expires, 0, null, (select auth.uid()))
  on conflict (beneficiary_id, kind) do update
    set channel = excluded.channel, code_hash = excluded.code_hash, requested_at = now(), expires_at = excluded.expires_at,
        attempts = 0, locked_at = null, requested_by = excluded.requested_by;

  if p_kind = 'data_sharing' then
    update public.beneficiaries
       set consent_channel = p_channel, consent_code_hash = v_hash, consent_sent_at = now(), consent_expires_at = v_expires,
           consent_status = case when consent_status = 'granted' then 'granted' else 'pending' end
     where id = p_beneficiary_id;
  end if;
  return v_code;
end $$;
revoke execute on function public.request_beneficiary_consent(uuid, text, text) from public, anon, authenticated;
grant execute on function public.request_beneficiary_consent(uuid, text, text) to service_role;

-- Marks a consent granted (shared by the code and the signed-link paths).
create or replace function private.grant_beneficiary_consent(p_beneficiary_id uuid, p_kind text, p_channel text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.consent_rpc', '1', true);
  update public.beneficiary_consents
     set granted = true, granted_at = now(), declined_at = null, code_hash = null, expires_at = null, attempts = 0, locked_at = null,
         channel = coalesce(p_channel, channel)
   where beneficiary_id = p_beneficiary_id and kind = p_kind;
  if p_kind = 'data_sharing' then
    update public.beneficiaries
       set consent_status = 'granted', consent_granted_at = now(), consent_code_hash = null, consent_expires_at = null,
           consent_channel = coalesce(p_channel, consent_channel)
     where id = p_beneficiary_id;
  end if;
end $$;

-- Confirm with the 6-digit code the beneficiary read out (sponsor enters it) — or the service role on
-- behalf of a verified signed link. 5 attempts, then locked until a new code is requested.
create or replace function public.confirm_beneficiary_consent(p_beneficiary_id uuid, p_kind text, p_code text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.beneficiary_consents;
  v_hash text;
begin
  if not (private.is_service_role() or private.is_platform_staff()
          or exists (select 1 from public.beneficiaries b where b.id = p_beneficiary_id and (b.sponsor_user_id = v_uid or b.linked_user_id = v_uid))) then
    raise exception 'Beneficiary not found' using errcode = 'P0001';
  end if;
  perform set_config('app.consent_rpc', '1', true);
  select * into v_row from public.beneficiary_consents where beneficiary_id = p_beneficiary_id and kind = p_kind for update;
  if v_row.id is null or v_row.code_hash is null then
    raise exception 'No consent code is pending. Send a new code first.' using errcode = 'P0001';
  end if;
  if v_row.granted then
    return jsonb_build_object('status', 'granted', 'granted_at', v_row.granted_at);
  end if;
  if v_row.locked_at is not null then
    raise exception 'Too many incorrect codes. Send a new code to try again.' using errcode = 'P0001';
  end if;
  if v_row.expires_at < now() then
    if p_kind = 'data_sharing' then update public.beneficiaries set consent_status = 'expired' where id = p_beneficiary_id and consent_status = 'pending'; end if;
    raise exception 'That code has expired. Send a new one.' using errcode = 'P0001';
  end if;
  v_hash := encode(extensions.digest(p_beneficiary_id::text || ':' || p_kind || ':' || regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'), 'hex');
  if v_hash <> v_row.code_hash then
    update public.beneficiary_consents
       set attempts = attempts + 1, locked_at = case when attempts + 1 >= 5 then now() else null end
     where id = v_row.id;
    if v_row.attempts + 1 >= 5 then
      raise exception 'Too many incorrect codes. Send a new code to try again.' using errcode = 'P0001';
    end if;
    raise exception 'That code is not right. % attempt(s) left.', 5 - (v_row.attempts + 1) using errcode = 'P0001';
  end if;
  perform private.grant_beneficiary_consent(p_beneficiary_id, p_kind, v_row.channel);
  return jsonb_build_object('status', 'granted', 'granted_at', now());
end $$;
revoke execute on function public.confirm_beneficiary_consent(uuid, text, text) from public, anon;
grant execute on function public.confirm_beneficiary_consent(uuid, text, text) to authenticated, service_role;

-- Signed-link decision (Accept / Decline on /consent/[token]); the server verifies the HMAC token and
-- calls this with the service role. No code is needed because the link itself was sent to the beneficiary.
create or replace function public.decide_beneficiary_consent_link(p_beneficiary_id uuid, p_kind text, p_granted boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service_role() then
    raise exception 'Consent links are verified by the platform' using errcode = 'P0001';
  end if;
  if p_kind not in ('data_sharing', 'proxy_claims', 'policy_purchase') then
    raise exception 'Unknown consent kind' using errcode = 'P0001';
  end if;
  perform set_config('app.consent_rpc', '1', true);
  insert into public.beneficiary_consents (beneficiary_id, kind, granted, channel, requested_at)
  values (p_beneficiary_id, p_kind, false, 'link', now())
  on conflict (beneficiary_id, kind) do nothing;
  if p_granted then
    perform private.grant_beneficiary_consent(p_beneficiary_id, p_kind, 'link');
    return jsonb_build_object('status', 'granted');
  end if;
  update public.beneficiary_consents
     set granted = false, declined_at = now(), code_hash = null, expires_at = null, attempts = 0, locked_at = null, channel = 'link'
   where beneficiary_id = p_beneficiary_id and kind = p_kind;
  if p_kind = 'data_sharing' then
    update public.beneficiaries set consent_status = 'declined', consent_code_hash = null, consent_expires_at = null where id = p_beneficiary_id;
  end if;
  return jsonb_build_object('status', 'declined');
end $$;
revoke execute on function public.decide_beneficiary_consent_link(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.decide_beneficiary_consent_link(uuid, text, boolean) to service_role;

-- "Paid for by <first name>": the beneficiary (or anyone who can access the policy) sees the sponsor's
-- first name without reading the sponsor's profile.
create or replace function public.policy_sponsor_name(p_policy_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select split_part(coalesce(nullif(trim(pr.preferred_name), ''), nullif(trim(pr.full_name), ''), 'A family member'), ' ', 1)
  from public.policies p join public.profiles pr on pr.id = p.sponsor_user_id
  where p.id = p_policy_id and private.can_access_policy(p.id);
$$;
revoke execute on function public.policy_sponsor_name(uuid) from public, anon;
grant execute on function public.policy_sponsor_name(uuid) to authenticated, service_role;

-- The gift reveal: the linked beneficiary opens the gift (sponsor cannot mark it revealed).
create or replace function public.reveal_gift(p_sponsorship_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.sponsorships;
begin
  select s.* into v_row from public.sponsorships s where s.id = p_sponsorship_id
    and (private.is_service_role() or private.is_beneficiary_user(s.beneficiary_id));
  if v_row.id is null then raise exception 'Gift not found' using errcode = 'P0001'; end if;
  if not v_row.gift then raise exception 'This sponsorship is not a gift' using errcode = 'P0001'; end if;
  if v_row.gift_revealed_at is null then
    perform set_config('app.consent_rpc', '1', true);
    update public.sponsorships set gift_revealed_at = now() where id = v_row.id;
    v_row.gift_revealed_at := now();
  end if;
  return jsonb_build_object('id', v_row.id, 'gift_message', v_row.gift_message, 'gift_revealed_at', v_row.gift_revealed_at, 'policy_id', v_row.policy_id);
end $$;
revoke execute on function public.reveal_gift(uuid) from public, anon;
grant execute on function public.reveal_gift(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Realtime + grants
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sponsorships') then
    alter publication supabase_realtime add table public.sponsorships;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'beneficiaries') then
    alter publication supabase_realtime add table public.beneficiaries;
  end if;
end $$;

insert into public.platform_settings (key, value, description) values
  ('diaspora.consent_code_ttl_minutes', '15', 'How long a beneficiary consent code (SMS/WhatsApp OTP) stays valid'),
  ('diaspora.sponsor_countries', '["GB","US","CA","DE","NL","IT","FR","IE","AU"]', 'Countries offered on sign-up as diaspora sponsor locations (ISO-2)')
on conflict (key) do nothing;

grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;
