-- Phase 3 — SME & group (additive; no drops, no deletes).
--
-- Business accounts are `organizations` of type 'enterprise' with a `business_profile`
-- ({ industry, employees, tin, registration_number, billing_email, billing_contact }). People join them through
-- `memberships` (roles owner / admin / finance / viewer; `memberships.team` is the business's own department label,
-- e.g. "HR") and the existing `invitations` + accept_invitation() flow.
--
-- * group_schemes      — group health / life / funeral / personal-accident schemes of a business. The broker of
--                        record and the insurer are set by the platform (routing / placement), never by the business.
-- * scheme_members     — the census (employees + dependants). PII is visible to the business owners/admins, the
--                        scheme's broker and insurer, platform staff and the member themselves (`user_id`, linked by
--                        verified phone through public.link_my_scheme_memberships()). Finance / viewer roles see counts.
-- * fleet_vehicles     — business vehicles (registration normalised), optionally linked to the fleet policy.
-- * business_assets    — property, stock, equipment and liability exposures, optionally linked to a policy.
-- * business_invoices  — consolidated monthly statements. Each line names its insurer; payment is one `payments` row per
--                        insurer line (premiums settle to each insurer's subaccount — Covva never pools client funds).
-- * requests           — business_org_id is guarded (owner/admin of an enterprise org); business owners/admins/finance
--                        read the business's requests; placement syncs the scheme's broker / insurer / policy.
-- * public.create_business_account() — any signed-in customer creates an enterprise org and becomes its owner.

-- ---------------------------------------------------------------------------
-- 1. Business profile on organisations
-- ---------------------------------------------------------------------------
alter table public.organizations add column if not exists business_profile jsonb not null default '{}'::jsonb;
comment on column public.organizations.business_profile is
  'Enterprise (business account) details: { industry, employees, tin, registration_number, billing_email, billing_contact }.';

create sequence if not exists public.group_scheme_ref_seq start 1001;
create sequence if not exists public.business_invoice_ref_seq start 1001;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.group_schemes (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('GS-' || nextval('public.group_scheme_ref_seq')::text),
  business_org_id uuid not null references public.organizations (id),
  category_id uuid not null references public.product_categories (id),
  name text not null,
  status text not null default 'draft',
  broker_org_id uuid references public.organizations (id),
  insurer_org_id uuid references public.organizations (id),
  policy_id uuid references public.policies (id) on delete set null,
  request_id uuid references public.requests (id) on delete set null,
  member_count integer not null default 0,
  renewal_date date,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_schemes_status_check check (status in ('draft', 'quoting', 'active', 'lapsed', 'cancelled')),
  constraint group_schemes_name_check check (length(btrim(name)) between 2 and 160)
);
comment on table public.group_schemes is
  'Group health / life / funeral / personal-accident scheme of a business account. policy_id = the master policy. broker/insurer/policy are set by placement (requests/policies triggers), never by the business.';
create index if not exists group_schemes_business_idx on public.group_schemes (business_org_id, status);
create index if not exists group_schemes_broker_idx on public.group_schemes (broker_org_id) where broker_org_id is not null;
create index if not exists group_schemes_insurer_idx on public.group_schemes (insurer_org_id) where insurer_org_id is not null;
create index if not exists group_schemes_request_idx on public.group_schemes (request_id) where request_id is not null;

create table if not exists public.scheme_members (
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references public.group_schemes (id),
  employee_ref text,
  full_name text not null,
  date_of_birth date,
  gender text,
  phone text,
  email extensions.citext,
  ghana_card_last4 text,
  relationship text not null default 'employee',
  principal_member_id uuid references public.scheme_members (id),
  cover_tier text,
  salary_band text,
  status text not null default 'active',
  user_id uuid references auth.users (id) on delete set null,
  joined_at date not null default current_date,
  left_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheme_members_relationship_check check (relationship in ('employee', 'spouse', 'child', 'parent')),
  constraint scheme_members_status_check check (status in ('active', 'pending', 'removed')),
  constraint scheme_members_gender_check check (gender is null or gender in ('female', 'male', 'other')),
  constraint scheme_members_card_check check (ghana_card_last4 is null or ghana_card_last4 ~ '^[0-9]{4}$'),
  constraint scheme_members_name_check check (length(btrim(full_name)) between 2 and 160),
  constraint scheme_members_dependant_check check (relationship = 'employee' or principal_member_id is not null)
);
comment on table public.scheme_members is
  'Census of a group scheme. Only the last 4 digits of a Ghana Card are stored. salary_band drives life cover multiples. user_id links the member''s own Covva account (verified phone).';
create index if not exists scheme_members_scheme_idx on public.scheme_members (scheme_id, status);
create index if not exists scheme_members_user_idx on public.scheme_members (user_id) where user_id is not null;
create index if not exists scheme_members_principal_idx on public.scheme_members (principal_member_id) where principal_member_id is not null;
create unique index if not exists scheme_members_employee_ref_uidx on public.scheme_members (scheme_id, lower(employee_ref))
  where employee_ref is not null and relationship = 'employee' and status <> 'removed';

create table if not exists public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  business_org_id uuid not null references public.organizations (id),
  registration text not null,
  make text,
  model text,
  year integer,
  value numeric(14, 2),
  use text not null default 'private',
  driver_name text,
  status text not null default 'active',
  policy_id uuid references public.policies (id) on delete set null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_vehicles_use_check check (use in ('private', 'commercial', 'hire')),
  constraint fleet_vehicles_status_check check (status in ('active', 'removed')),
  constraint fleet_vehicles_year_check check (year is null or year between 1950 and 2100),
  constraint fleet_vehicles_value_check check (value is null or value >= 0),
  constraint fleet_vehicles_registration_check check (length(btrim(registration)) between 2 and 20)
);
comment on table public.fleet_vehicles is 'Vehicles of a business account (fleet motor). registration is normalised (e.g. "GR 1234-23").';
create index if not exists fleet_vehicles_business_idx on public.fleet_vehicles (business_org_id, status);
create unique index if not exists fleet_vehicles_registration_uidx on public.fleet_vehicles (business_org_id, registration) where status = 'active';

create table if not exists public.business_assets (
  id uuid primary key default gen_random_uuid(),
  business_org_id uuid not null references public.organizations (id),
  kind text not null,
  description text not null,
  address text,
  value numeric(14, 2),
  status text not null default 'active',
  policy_id uuid references public.policies (id) on delete set null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_assets_kind_check check (kind in ('property', 'stock', 'equipment', 'liability_exposure')),
  constraint business_assets_status_check check (status in ('active', 'removed')),
  constraint business_assets_value_check check (value is null or value >= 0),
  constraint business_assets_description_check check (length(btrim(description)) between 2 and 300)
);
comment on table public.business_assets is 'Property, stock, equipment and liability exposures of a business account (for property / liability quotes).';
create index if not exists business_assets_business_idx on public.business_assets (business_org_id, status);

create table if not exists public.business_invoices (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('BINV-' || nextval('public.business_invoice_ref_seq')::text),
  business_org_id uuid not null references public.organizations (id),
  period_start date not null,
  period_end date not null,
  currency char(3) not null default 'GHS',
  total numeric(14, 2) not null default 0,
  lines jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  due_at timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_invoices_status_check check (status in ('draft', 'issued', 'paid', 'overdue')),
  constraint business_invoices_period_check check (period_end >= period_start),
  constraint business_invoices_total_check check (total >= 0),
  constraint business_invoices_period_uniq unique (business_org_id, period_start, period_end)
);
comment on table public.business_invoices is
  'Consolidated statement for a business account. lines: [{ policy_id, scheme_id, application_id?, description, amount, insurer_org_id, insurer_name, payment_id?, status? }]. Paying = one payments row per insurer line (each settles to that insurer); Covva never holds or pools the money.';
create index if not exists business_invoices_business_idx on public.business_invoices (business_org_id, period_start desc);
create index if not exists business_invoices_status_idx on public.business_invoices (status, due_at);

-- ---------------------------------------------------------------------------
-- 3. Access helpers (security definer → no policy recursion)
-- ---------------------------------------------------------------------------
create or replace function private.is_business_org(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org is not null and exists (select 1 from public.organizations o where o.id = p_org and o.type = 'enterprise' and o.status <> 'offboarded');
$$;

-- Owner/admin of the scheme's business.
create or replace function private.can_admin_scheme(p_scheme uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_schemes s where s.id = p_scheme and private.has_org_role(s.business_org_id, '{owner,admin}'));
$$;

-- Member of the scheme's broker of record or insurer.
create or replace function private.is_scheme_partner(p_scheme uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_schemes s
    where s.id = p_scheme
      and (s.broker_org_id in (select private.user_org_ids()) or s.insurer_org_id in (select private.user_org_ids()))
  );
$$;

-- The caller is a (linked) member of the scheme.
create or replace function private.is_scheme_member_user(p_scheme uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.scheme_members m
    where m.scheme_id = p_scheme and m.user_id = (select auth.uid()) and m.status <> 'removed'
  );
$$;

-- The caller's broker / insurer services this business (scheme, business request or business policy).
create or replace function private.services_business(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org is not null and (
    exists (
      select 1 from public.group_schemes s
      where s.business_org_id = p_org
        and (s.broker_org_id in (select private.user_org_ids()) or s.insurer_org_id in (select private.user_org_ids()))
    )
    or exists (
      select 1 from public.requests r
      where r.business_org_id = p_org and r.broker_org_id in (select private.user_org_ids())
    )
    or exists (
      select 1 from public.policies p join public.requests r on r.id = p.request_id
      where r.business_org_id = p_org and p.insurer_org_id in (select private.user_org_ids())
    )
  );
$$;

create or replace function private.request_business_org(p_request uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.business_org_id from public.requests r where r.id = p_request;
$$;

-- Ghana phone → digits in 233XXXXXXXXX form (for matching a verified sign-in phone).
create or replace function private.ghana_phone_digits(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d ~ '^0[0-9]{9}$' then '233' || substr(d, 2)
    when d ~ '^[0-9]{9}$' then '233' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- Only the helpers that RLS policies call need EXECUTE for API roles (guards/RPCs below are SECURITY DEFINER).
revoke all on function private.is_business_org(uuid), private.ghana_phone_digits(text) from public, anon, authenticated;
grant execute on function private.can_admin_scheme(uuid), private.is_scheme_partner(uuid), private.is_scheme_member_user(uuid),
  private.services_business(uuid), private.request_business_org(uuid)
  to authenticated, service_role;
grant execute on function private.is_business_org(uuid), private.ghana_phone_digits(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Guards
-- ---------------------------------------------------------------------------
-- Business accounts only use the business roles.
create or replace function private.business_role_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.organizations o where o.id = new.org_id and o.type = 'enterprise')
     and new.role not in ('owner', 'admin', 'finance', 'viewer') then
    raise exception 'Business accounts use the roles owner, admin, finance and viewer' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'invitations_business_role_guard' and tgrelid = 'public.invitations'::regclass) then
    create trigger invitations_business_role_guard before insert or update of role on public.invitations
      for each row execute function private.business_role_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'memberships_business_role_guard' and tgrelid = 'public.memberships'::regclass) then
    create trigger memberships_business_role_guard before insert or update of role on public.memberships
      for each row execute function private.business_role_guard();
  end if;
end $$;

-- Group schemes: the business creates drafts and may cancel; the broker of record, insurer, master policy, request
-- and member_count are set by the platform (service role, staff, placement triggers). The servicing broker may move
-- the status and record the insurer / policy / renewal date.
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
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'group_schemes_guard' and tgrelid = 'public.group_schemes'::regclass) then
    create trigger group_schemes_guard before insert or update on public.group_schemes
      for each row execute function private.group_schemes_guard();
  end if;
end $$;

-- Scheme members: dependants hang off an employee of the same scheme; accounts are linked only by the system
-- (verified phone); a member never moves to another scheme; removal stamps left_at.
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
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'scheme_members_guard' and tgrelid = 'public.scheme_members'::regclass) then
    create trigger scheme_members_guard before insert or update on public.scheme_members
      for each row execute function private.scheme_members_guard();
  end if;
end $$;

-- member_count = active + pending members.
create or replace function private.scheme_member_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.group_schemes s
     set member_count = (select count(*) from public.scheme_members m where m.scheme_id = s.id and m.status <> 'removed')
   where s.id = new.scheme_id;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'scheme_members_count' and tgrelid = 'public.scheme_members'::regclass) then
    create trigger scheme_members_count after insert or update of status, scheme_id on public.scheme_members
      for each row execute function private.scheme_member_count();
  end if;
end $$;

-- Registrations: upper-case, tidy spacing (the app normalises "GR123423" → "GR 1234-23" before writing).
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
end $$;
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
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'fleet_vehicles_normalise' and tgrelid = 'public.fleet_vehicles'::regclass) then
    create trigger fleet_vehicles_normalise before insert or update on public.fleet_vehicles
      for each row execute function private.fleet_vehicles_normalise();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'business_assets_guard' and tgrelid = 'public.business_assets'::regclass) then
    create trigger business_assets_guard before insert or update on public.business_assets
      for each row execute function private.business_assets_guard();
  end if;
end $$;

-- Requests for a business: only owners/admins of an enterprise org may attach it.
create or replace function private.requests_business_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.business_org_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.business_org_id is not distinct from old.business_org_id then return new; end if;
  if not private.is_business_org(new.business_org_id) then
    raise exception 'Cover for a business must be requested from a business account' using errcode = 'P0001';
  end if;
  if private.is_service_role() or private.is_platform_staff() then return new; end if;
  if not private.has_org_role(new.business_org_id, '{owner,admin}') then
    raise exception 'Only business owners and admins can request cover for the business' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'requests_business_guard' and tgrelid = 'public.requests'::regclass) then
    create trigger requests_business_guard before insert or update of business_org_id on public.requests
      for each row execute function private.requests_business_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Placement sync: broker acceptance → scheme broker; policy → scheme insurer/policy/status, fleet & assets
-- ---------------------------------------------------------------------------
create or replace function private.sme_sync_request_broker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.broker_org_id is not null and new.broker_org_id is distinct from old.broker_org_id then
    update public.group_schemes
       set broker_org_id = new.broker_org_id,
           status = case when status = 'draft' then 'quoting' else status end
     where request_id = new.id and broker_org_id is distinct from new.broker_org_id;
  end if;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'requests_sme_sync_broker' and tgrelid = 'public.requests'::regclass) then
    create trigger requests_sme_sync_broker after update of broker_org_id on public.requests
      for each row execute function private.sme_sync_request_broker();
  end if;
end $$;

create or replace function private.sme_sync_policy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_risk jsonb;
begin
  if new.request_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.cover_end is not distinct from old.cover_end
     and new.insurer_org_id is not distinct from old.insurer_org_id then
    return null;
  end if;
  select r.business_org_id, r.risk_data into v_org, v_risk from public.requests r where r.id = new.request_id;
  if v_org is null then return null; end if;

  update public.group_schemes s
     set policy_id = new.id,
         insurer_org_id = new.insurer_org_id,
         broker_org_id = coalesce(s.broker_org_id, new.broker_org_id),
         status = case
           when new.status in ('active', 'renewed') then 'active'
           when new.status in ('lapsed', 'expired') then 'lapsed'
           when new.status = 'cancelled' then 'cancelled'
           else s.status end,
         renewal_date = coalesce(new.cover_end, s.renewal_date)
   where s.request_id = new.request_id;

  if jsonb_typeof(v_risk -> 'fleet_vehicle_ids') = 'array' then
    update public.fleet_vehicles v set policy_id = new.id
     where v.business_org_id = v_org and v.policy_id is null
       and v.id::text in (select x from jsonb_array_elements_text(v_risk -> 'fleet_vehicle_ids') x where x ~* '^[0-9a-f-]{36}$');
  end if;
  if jsonb_typeof(v_risk -> 'business_asset_ids') = 'array' then
    update public.business_assets a set policy_id = new.id
     where a.business_org_id = v_org and a.policy_id is null
       and a.id::text in (select x from jsonb_array_elements_text(v_risk -> 'business_asset_ids') x where x ~* '^[0-9a-f-]{36}$');
  end if;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'policies_sme_sync' and tgrelid = 'public.policies'::regclass) then
    create trigger policies_sme_sync after insert or update of status, cover_end, insurer_org_id on public.policies
      for each row execute function private.sme_sync_policy();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------------
-- A signed-in customer creates a business account (enterprise org, active) and becomes its owner.
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

  update public.profiles set account_type = 'business', business_name = coalesce(business_name, v_name) where id = v_uid;
  return v_org;
end $$;
revoke all on function public.create_business_account(text, jsonb) from public, anon;
grant execute on function public.create_business_account(text, jsonb) to authenticated, service_role;
comment on function public.create_business_account(text, jsonb) is
  'Create a business account (enterprise organisation, active) owned by the caller. Max 5 owned business accounts per user.';

-- A member signs in with the phone number on the census → their scheme_members rows are linked to their account.
-- Uses the VERIFIED sign-in phone (auth.users.phone_confirmed_at), never the editable profile phone.
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
end $$;
revoke all on function public.link_my_scheme_memberships() from public, anon;
grant execute on function public.link_my_scheme_memberships() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.group_schemes enable row level security;
alter table public.scheme_members enable row level security;
alter table public.fleet_vehicles enable row level security;
alter table public.business_assets enable row level security;
alter table public.business_invoices enable row level security;

-- Group schemes: every business member (counts and status only — no PII on this table), the broker / insurer on the
-- scheme, linked members and staff read. Owners/admins create and edit (guarded); the servicing broker updates.
select private.ensure_policy('group_schemes', 'group schemes: parties read', $p$
  create policy "group schemes: parties read" on public.group_schemes for select to authenticated
  using (
    (select private.is_platform_staff())
    or private.is_org_member(business_org_id)
    or broker_org_id in (select private.user_org_ids())
    or insurer_org_id in (select private.user_org_ids())
    or private.is_scheme_member_user(id)
  )$p$);
select private.ensure_policy('group_schemes', 'group schemes: business admins create', $p$
  create policy "group schemes: business admins create" on public.group_schemes for insert to authenticated
  with check (private.has_org_role(business_org_id, '{owner,admin}') or (select private.is_platform_staff()))$p$);
select private.ensure_policy('group_schemes', 'group schemes: business admins and broker update', $p$
  create policy "group schemes: business admins and broker update" on public.group_schemes for update to authenticated
  using (private.has_org_role(business_org_id, '{owner,admin}') or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))
  with check (private.has_org_role(business_org_id, '{owner,admin}') or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))$p$);

-- Scheme members (PII): business owners/admins, the scheme's broker and insurer, staff and the member themselves.
select private.ensure_policy('scheme_members', 'scheme members: parties read', $p$
  create policy "scheme members: parties read" on public.scheme_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_platform_staff())
    or private.can_admin_scheme(scheme_id)
    or private.is_scheme_partner(scheme_id)
  )$p$);
select private.ensure_policy('scheme_members', 'scheme members: business admins add', $p$
  create policy "scheme members: business admins add" on public.scheme_members for insert to authenticated
  with check (private.can_admin_scheme(scheme_id) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('scheme_members', 'scheme members: business admins update', $p$
  create policy "scheme members: business admins update" on public.scheme_members for update to authenticated
  using (private.can_admin_scheme(scheme_id) or (select private.is_platform_staff()))
  with check (private.can_admin_scheme(scheme_id) or (select private.is_platform_staff()))$p$);

-- Fleet and assets: every business member and the brokers/insurers servicing the business read; owners/admins write.
select private.ensure_policy('fleet_vehicles', 'fleet: parties read', $p$
  create policy "fleet: parties read" on public.fleet_vehicles for select to authenticated
  using (private.is_org_member(business_org_id) or (select private.is_platform_staff()) or private.services_business(business_org_id))$p$);
select private.ensure_policy('fleet_vehicles', 'fleet: business admins add', $p$
  create policy "fleet: business admins add" on public.fleet_vehicles for insert to authenticated
  with check (private.has_org_role(business_org_id, '{owner,admin}') or (select private.is_platform_staff()))$p$);
select private.ensure_policy('fleet_vehicles', 'fleet: business admins update', $p$
  create policy "fleet: business admins update" on public.fleet_vehicles for update to authenticated
  using (private.has_org_role(business_org_id, '{owner,admin}') or (select private.is_platform_staff()))
  with check (private.has_org_role(business_org_id, '{owner,admin}') or (select private.is_platform_staff()))$p$);

select private.ensure_policy('business_assets', 'assets: parties read', $p$
  create policy "assets: parties read" on public.business_assets for select to authenticated
  using (private.is_org_member(business_org_id) or (select private.is_platform_staff()) or private.services_business(business_org_id))$p$);
select private.ensure_policy('business_assets', 'assets: business admins add', $p$
  create policy "assets: business admins add" on public.business_assets for insert to authenticated
  with check (private.has_org_role(business_org_id, '{owner,admin}') or (select private.is_platform_staff()))$p$);
select private.ensure_policy('business_assets', 'assets: business admins update', $p$
  create policy "assets: business admins update" on public.business_assets for update to authenticated
  using (private.has_org_role(business_org_id, '{owner,admin}') or (select private.is_platform_staff()))
  with check (private.has_org_role(business_org_id, '{owner,admin}') or (select private.is_platform_staff()))$p$);

-- Invoices: every business role reads (finance pays through the server); written by the platform only.
select private.ensure_policy('business_invoices', 'business invoices: business reads', $p$
  create policy "business invoices: business reads" on public.business_invoices for select to authenticated
  using (private.has_org_role(business_org_id, '{owner,admin,finance,viewer}') or (select private.is_platform_staff()))$p$);
select private.ensure_policy('business_invoices', 'business invoices: staff write', $p$
  create policy "business invoices: staff write" on public.business_invoices for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- The business reads its requests and policies (owners, admins, finance). risk_data on business requests carries
-- census counts only — never member PII.
select private.ensure_policy('requests', 'requests: business account reads', $p$
  create policy "requests: business account reads" on public.requests for select to authenticated
  using (business_org_id is not null and private.has_org_role(business_org_id, '{owner,admin,finance}'))$p$);
select private.ensure_policy('policies', 'policies: business account reads', $p$
  create policy "policies: business account reads" on public.policies for select to authenticated
  using (request_id is not null and private.has_org_role(private.request_business_org(request_id), '{owner,admin,finance}'))$p$);

-- ---------------------------------------------------------------------------
-- 8. Housekeeping: updated_at + audit, grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['group_schemes', 'scheme_members', 'fleet_vehicles', 'business_assets', 'business_invoices'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

grant select, insert, update on public.group_schemes, public.scheme_members, public.fleet_vehicles, public.business_assets to authenticated;
grant select on public.business_invoices to authenticated;
grant select, insert, update on public.group_schemes, public.scheme_members, public.fleet_vehicles, public.business_assets, public.business_invoices to service_role;
grant usage, select on sequence public.group_scheme_ref_seq, public.business_invoice_ref_seq to authenticated, service_role;
