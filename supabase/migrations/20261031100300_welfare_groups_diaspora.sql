-- Phase 4 — Funeral cover & welfare groups + advanced diaspora (additive; no drops, no deletes).
--
-- A welfare group (association, church, alumni, hometown union, family) is run by a group admin, enrols members,
-- keeps beneficiary records per member and collects a contribution per member per period. The cover itself is an
-- ordinary request → broker of record → insurer → master policy on the group (same placement sync as SME group
-- schemes); each contribution is a premium payment on that policy that settles to the insurer (and the broker's
-- commission) through the existing Paystack splits. Covva records who paid for whom and never pools or holds money.
--
-- * welfare_groups         — the group, its admin, contribution plan, placement (broker / insurer / policy / request).
-- * welfare_members        — enrolment (invited by the admin, joined by link or linked by verified phone), consent.
-- * welfare_beneficiaries  — who receives the funeral benefit for each member (PII; member + admin + partner).
-- * welfare_sponsors       — a sponsor abroad who pays contributions for one or more members (sees only those members).
-- * welfare_contributions  — one row per member per period: due / paid (payment_id) / waived / failed.
-- * requests.welfare_group_id, claims.welfare_group_id / welfare_member_id — links into the existing flows.
-- * product_bundles.settings — bundle composition rules (Parents' Care Pack: named parents, one monthly amount).
--
-- Access: members see their group; admins manage it; sponsors see the members they pay for; the broker of record and
-- the insurer see the group; platform staff see all; other customers see nothing.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create sequence if not exists public.welfare_group_ref_seq start 1001;

create table if not exists public.welfare_groups (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('WG-' || nextval('public.welfare_group_ref_seq')::text),
  name text not null,
  kind text not null default 'association',
  description text,
  region text,
  admin_user_id uuid not null references auth.users (id),
  category_id uuid references public.product_categories (id),
  status text not null default 'draft',
  broker_org_id uuid references public.organizations (id),
  insurer_org_id uuid references public.organizations (id),
  policy_id uuid references public.policies (id) on delete set null,
  request_id uuid references public.requests (id) on delete set null,
  -- Contribution plan: GHS per member per period; the sponsor abroad sees it in their currency (FX display only).
  contribution_amount numeric(12, 2) not null default 0,
  contribution_cadence text not null default 'monthly',
  contribution_day integer not null default 1,
  plan_starts_on date not null default current_date,
  currency char(3) not null default 'GHS',
  rules text,
  invite_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  invite_enabled boolean not null default true,
  consent_version text not null default 'welfare-2026-10',
  member_count integer not null default 0,
  renewal_date date,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welfare_groups_name_check check (length(btrim(name)) between 2 and 160),
  constraint welfare_groups_kind_check check (kind in ('association', 'church', 'alumni', 'hometown_union', 'family', 'union', 'other')),
  constraint welfare_groups_status_check check (status in ('draft', 'quoting', 'active', 'lapsed', 'cancelled')),
  constraint welfare_groups_cadence_check check (contribution_cadence in ('monthly', 'quarterly', 'annual')),
  constraint welfare_groups_day_check check (contribution_day between 1 and 28),
  constraint welfare_groups_amount_check check (contribution_amount >= 0),
  constraint welfare_groups_currency_check check (currency = 'GHS')
);
comment on table public.welfare_groups is
  'Funeral / welfare group (association, church, alumni, hometown union, family). policy_id = the master policy; broker / insurer / policy / request are set by placement (requests / policies triggers), never by the group. Contributions are GHS per member per period and settle to the insurer — Covva never pools money.';
create index if not exists welfare_groups_admin_idx on public.welfare_groups (admin_user_id, status);
create index if not exists welfare_groups_broker_idx on public.welfare_groups (broker_org_id) where broker_org_id is not null;
create index if not exists welfare_groups_insurer_idx on public.welfare_groups (insurer_org_id) where insurer_org_id is not null;
create index if not exists welfare_groups_request_idx on public.welfare_groups (request_id) where request_id is not null;

create table if not exists public.welfare_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.welfare_groups (id),
  full_name text not null,
  phone text,
  email extensions.citext,
  date_of_birth date,
  gender text,
  ghana_card_last4 text,
  role text not null default 'member',
  status text not null default 'invited',
  user_id uuid references auth.users (id) on delete set null,
  joined_via text not null default 'admin',
  consent_at timestamptz,
  consent_channel text,
  consent_version text,
  -- The admin attests that a member without a Covva account agreed (on paper / in a meeting) to be enrolled.
  consent_attested_by uuid references auth.users (id),
  joined_at date not null default current_date,
  left_at date,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welfare_members_name_check check (length(btrim(full_name)) between 2 and 160),
  constraint welfare_members_role_check check (role in ('member', 'admin')),
  constraint welfare_members_status_check check (status in ('invited', 'pending', 'active', 'suspended', 'left')),
  constraint welfare_members_gender_check check (gender is null or gender in ('female', 'male', 'other')),
  constraint welfare_members_card_check check (ghana_card_last4 is null or ghana_card_last4 ~ '^[0-9]{4}$'),
  constraint welfare_members_joined_via_check check (joined_via in ('admin', 'link', 'csv', 'phone')),
  constraint welfare_members_consent_channel_check check (consent_channel is null or consent_channel in ('app', 'link', 'sms', 'whatsapp'))
);
comment on table public.welfare_members is
  'Members of a welfare group. Only the last 4 digits of a Ghana Card are stored. user_id is linked by the join link or the member''s verified sign-in phone (link_my_welfare_memberships), never set by the admin. consent_at records the member''s agreement to be enrolled and to data sharing with the broker / insurer.';
create index if not exists welfare_members_group_idx on public.welfare_members (group_id, status);
create index if not exists welfare_members_user_idx on public.welfare_members (user_id) where user_id is not null;
create unique index if not exists welfare_members_user_uidx on public.welfare_members (group_id, user_id) where user_id is not null and status <> 'left';

create table if not exists public.welfare_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.welfare_groups (id),
  member_id uuid not null references public.welfare_members (id),
  full_name text not null,
  relationship text not null default 'other',
  phone text,
  date_of_birth date,
  share_pct numeric(5, 2) not null default 100,
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'active',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welfare_beneficiaries_name_check check (length(btrim(full_name)) between 2 and 160),
  constraint welfare_beneficiaries_relationship_check check (relationship in ('spouse', 'child', 'parent', 'sibling', 'other')),
  constraint welfare_beneficiaries_share_check check (share_pct > 0 and share_pct <= 100),
  constraint welfare_beneficiaries_status_check check (status in ('active', 'removed'))
);
comment on table public.welfare_beneficiaries is
  'Who receives the funeral / welfare benefit for a member. Recorded for the insurer''s claim; the insurer decides every claim. user_id is linked by verified phone so a beneficiary with a Covva account can raise and follow a claim.';
create index if not exists welfare_beneficiaries_member_idx on public.welfare_beneficiaries (member_id, status);
create index if not exists welfare_beneficiaries_group_idx on public.welfare_beneficiaries (group_id);
create index if not exists welfare_beneficiaries_user_idx on public.welfare_beneficiaries (user_id) where user_id is not null;

create table if not exists public.welfare_sponsors (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.welfare_groups (id),
  member_id uuid not null references public.welfare_members (id),
  sponsor_user_id uuid references auth.users (id) on delete set null,
  sponsor_name text,
  sponsor_email extensions.citext,
  sponsor_phone text,
  display_currency char(3) not null default 'GHS',
  status text not null default 'invited',
  invite_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  invited_by uuid references auth.users (id),
  accepted_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welfare_sponsors_status_check check (status in ('invited', 'active', 'ended')),
  constraint welfare_sponsors_currency_check check (display_currency in ('GHS', 'GBP', 'USD', 'EUR', 'CAD')),
  constraint welfare_sponsors_contact_check check (sponsor_email is not null or sponsor_phone is not null or sponsor_user_id is not null)
);
comment on table public.welfare_sponsors is
  'A sponsor abroad who pays contributions for one member (one row per member sponsored). Linked by the invite link or a verified e-mail match. The sponsor sees only the members they pay for.';
create index if not exists welfare_sponsors_member_idx on public.welfare_sponsors (member_id, status);
create index if not exists welfare_sponsors_user_idx on public.welfare_sponsors (sponsor_user_id) where sponsor_user_id is not null;
create unique index if not exists welfare_sponsors_user_member_uidx on public.welfare_sponsors (member_id, sponsor_user_id) where sponsor_user_id is not null and status <> 'ended';

create table if not exists public.welfare_contributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.welfare_groups (id),
  member_id uuid not null references public.welfare_members (id),
  period_start date not null,
  due_at date not null,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'GHS',
  status text not null default 'due',
  paid_by_user_id uuid references auth.users (id),
  paid_via text,
  sponsor_id uuid references public.welfare_sponsors (id),
  payment_id uuid references public.payments (id),
  paid_at timestamptz,
  display_currency char(3),
  display_amount numeric(14, 2),
  fx_rate numeric(18, 8),
  reminded_before_at timestamptz,
  reminded_after_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welfare_contributions_amount_check check (amount >= 0),
  constraint welfare_contributions_status_check check (status in ('due', 'paid', 'waived', 'failed', 'cancelled')),
  constraint welfare_contributions_paid_via_check check (paid_via is null or paid_via in ('member', 'sponsor', 'admin')),
  constraint welfare_contributions_currency_check check (currency = 'GHS'),
  constraint welfare_contributions_member_period_uniq unique (member_id, period_start)
);
comment on table public.welfare_contributions is
  'One contribution per member per period. paid = a succeeded payments row (GHS, payee = insurer, broker commission by split) paid by the member, a sponsor abroad or the admin on the member''s behalf. Covva records who paid for whom; the money never touches a Covva account.';
create index if not exists welfare_contributions_group_idx on public.welfare_contributions (group_id, status, due_at);
create index if not exists welfare_contributions_member_idx on public.welfare_contributions (member_id, period_start desc);
create index if not exists welfare_contributions_payment_idx on public.welfare_contributions (payment_id) where payment_id is not null;
create index if not exists welfare_contributions_due_idx on public.welfare_contributions (due_at) where status in ('due', 'failed');

-- Links into the existing flows.
alter table public.requests add column if not exists welfare_group_id uuid references public.welfare_groups (id);
comment on column public.requests.welfare_group_id is 'Set when the request is the cover request of a welfare group (group admin only); placement syncs the group''s broker / insurer / policy.';
create index if not exists requests_welfare_group_idx on public.requests (welfare_group_id) where welfare_group_id is not null;

alter table public.claims add column if not exists welfare_group_id uuid references public.welfare_groups (id);
alter table public.claims add column if not exists welfare_member_id uuid references public.welfare_members (id);
comment on column public.claims.welfare_group_id is 'Funeral / welfare claim raised on a welfare group''s master policy (the member concerned is welfare_member_id).';
create index if not exists claims_welfare_group_idx on public.claims (welfare_group_id) where welfare_group_id is not null;

-- Bundle composition rules (Parents' Care Pack): { named_members: { role, min, max }, cadence, payer, items_per_member }.
alter table public.product_bundles add column if not exists settings jsonb not null default '{}'::jsonb;
comment on column public.product_bundles.settings is 'Composition rules: named_members { role, min, max } (one set of items per named person), cadence (one amount per period for the sponsor), payer (sponsor | customer).';

update public.product_bundles
   set name = 'Parents'' Care Pack',
       description = 'Funeral cover, a private health plan and personal accident cover for one or both parents, quoted together by a participating broker and paid as one monthly amount by the sponsor abroad. Cover for the family home can be added.',
       items = '[{"category_slug": "life-funeral", "required": true}, {"category_slug": "health", "required": true}, {"category_slug": "personal-accident", "required": false}, {"category_slug": "home", "required": false}]'::jsonb,
       settings = '{"named_members": {"role": "parent", "min": 1, "max": 2}, "cadence": "monthly", "payer": "sponsor", "per_member_items": ["life-funeral", "health", "personal-accident"]}'::jsonb
 where slug = 'parents-care-pack'
   and not (settings ? 'named_members');

-- ---------------------------------------------------------------------------
-- 2. Access helpers (security definer → no policy recursion)
-- ---------------------------------------------------------------------------
-- The group's admin (creator) or a linked, active member with the admin role.
create or replace function private.is_welfare_admin(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_group is not null and (
    exists (select 1 from public.welfare_groups g where g.id = p_group and g.admin_user_id = (select auth.uid()))
    or exists (select 1 from public.welfare_members m where m.group_id = p_group and m.user_id = (select auth.uid()) and m.role = 'admin' and m.status = 'active')
  );
$$;

-- A linked member of the group (any status but left).
create or replace function private.is_welfare_member_user(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.welfare_members m where m.group_id = p_group and m.user_id = (select auth.uid()) and m.status <> 'left');
$$;

-- Member of the broker of record or the insurer on the group.
create or replace function private.is_welfare_partner(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.welfare_groups g
    where g.id = p_group and (g.broker_org_id in (select private.user_org_ids()) or g.insurer_org_id in (select private.user_org_ids()))
  );
$$;

-- The caller sponsors at least one member of the group (active sponsorship).
create or replace function private.is_welfare_sponsor(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.welfare_sponsors s where s.group_id = p_group and s.sponsor_user_id = (select auth.uid()) and s.status = 'active');
$$;

-- The caller sponsors this member.
create or replace function private.sponsors_welfare_member(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.welfare_sponsors s where s.member_id = p_member and s.sponsor_user_id = (select auth.uid()) and s.status = 'active');
$$;

-- The caller is this member.
create or replace function private.is_welfare_member_self(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.welfare_members m where m.id = p_member and m.user_id = (select auth.uid()));
$$;

-- The caller is a linked beneficiary of this member.
create or replace function private.is_welfare_beneficiary_user(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.welfare_beneficiaries b where b.member_id = p_member and b.user_id = (select auth.uid()) and b.status = 'active');
$$;

-- Everyone who may read a member's row: the member, their sponsors, the admins, the partners, staff.
create or replace function private.can_read_welfare_member(p_group uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_welfare_member_self(p_member)
      or private.sponsors_welfare_member(p_member)
      or private.is_welfare_admin(p_group)
      or private.is_welfare_partner(p_group)
      or (select private.is_platform_staff());
$$;

grant execute on function
  private.is_welfare_admin(uuid), private.is_welfare_member_user(uuid), private.is_welfare_partner(uuid), private.is_welfare_sponsor(uuid),
  private.sponsors_welfare_member(uuid), private.is_welfare_member_self(uuid), private.is_welfare_beneficiary_user(uuid), private.can_read_welfare_member(uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Guards
-- ---------------------------------------------------------------------------
-- System paths: the service role, platform staff, nested triggers (count upkeep, placement sync) and the RPCs below
-- (which set app.welfare_sys for the transaction).
create or replace function private.welfare_is_system() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_service_role() or private.is_platform_staff() or pg_trigger_depth() > 1
      or coalesce(current_setting('app.welfare_sys', true), '') = '1';
$$;
revoke all on function private.welfare_is_system() from public, anon, authenticated;
grant execute on function private.welfare_is_system() to service_role;

-- Groups: the admin creates drafts, edits the plan and may cancel; placement fields are the platform's; the broker
-- of record may move the status and record the renewal date.
create or replace function private.welfare_groups_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_broker boolean;
begin
  if tg_op = 'INSERT' then
    new.name := btrim(new.name);
    if private.welfare_is_system() then return new; end if;
    if (select auth.uid()) is null then
      raise exception 'Please sign in to create a welfare group' using errcode = 'P0001';
    end if;
    new.status := 'draft';
    new.admin_user_id := (select auth.uid());
    new.created_by := (select auth.uid());
    new.broker_org_id := null; new.insurer_org_id := null; new.policy_id := null; new.request_id := null;
    new.member_count := 0;
    return new;
  end if;
  new.name := btrim(new.name);
  if private.welfare_is_system() then return new; end if;
  new.member_count := old.member_count;
  new.request_id := old.request_id;
  new.created_by := old.created_by;
  new.reference := old.reference;
  if new.admin_user_id is distinct from old.admin_user_id then
    if not private.is_welfare_admin(old.id) then
      raise exception 'Only a group admin can hand the group to another admin' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.welfare_members m where m.group_id = old.id and m.user_id = new.admin_user_id and m.status = 'active') then
      raise exception 'The new admin must be an active, linked member of the group' using errcode = 'P0001';
    end if;
  end if;
  if new.broker_org_id is distinct from old.broker_org_id then
    raise exception 'The broker of record is set when a licensed broker accepts the group''s request' using errcode = 'P0001';
  end if;
  v_broker := old.broker_org_id is not null and private.is_org_member(old.broker_org_id);
  if v_broker and not private.is_welfare_admin(old.id) then
    -- Broker: status / renewal only; the plan and the join link belong to the group.
    new.name := old.name; new.kind := old.kind; new.description := old.description; new.rules := old.rules;
    new.contribution_amount := old.contribution_amount; new.contribution_cadence := old.contribution_cadence;
    new.contribution_day := old.contribution_day; new.plan_starts_on := old.plan_starts_on;
    new.invite_token := old.invite_token; new.invite_enabled := old.invite_enabled; new.admin_user_id := old.admin_user_id;
    if new.insurer_org_id is distinct from old.insurer_org_id or new.policy_id is distinct from old.policy_id then
      raise exception 'The insurer and master policy are recorded when the cover is placed' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.insurer_org_id is distinct from old.insurer_org_id or new.policy_id is distinct from old.policy_id then
    raise exception 'The insurer and master policy are recorded when the cover is placed' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and new.status <> 'cancelled' then
    raise exception 'A group can only be cancelled by its admin; other status changes follow the quote and the policy' using errcode = 'P0001';
  end if;
  if new.category_id is distinct from old.category_id and old.status <> 'draft' then
    raise exception 'The type of cover can only change while the group is a draft' using errcode = 'P0001';
  end if;
  if new.contribution_amount is distinct from old.contribution_amount and new.contribution_amount < 0 then
    raise exception 'The contribution cannot be negative' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'welfare_groups_guard' and tgrelid = 'public.welfare_groups'::regclass) then
    create trigger welfare_groups_guard before insert or update on public.welfare_groups
      for each row execute function private.welfare_groups_guard();
  end if;
end $$;

-- Members: accounts and consent are linked by the join / link RPCs only; a member never moves group; the admin
-- cannot pretend a member consented; a member may only leave (and fix their own contact details).
create or replace function private.welfare_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
begin
  new.full_name := btrim(new.full_name);
  if new.status = 'left' then
    new.left_at := coalesce(new.left_at, current_date);
  end if;
  -- One phone number per member of a group (members are matched to accounts by phone).
  if new.phone is not null and new.status <> 'left' and exists (
    select 1 from public.welfare_members x
    where x.group_id = new.group_id and x.id <> new.id and x.status <> 'left' and x.phone is not null
      and private.ghana_phone_digits(x.phone) = private.ghana_phone_digits(new.phone)
  ) then
    raise exception 'Another member of this group already uses this phone number' using errcode = 'P0001';
  end if;
  if private.welfare_is_system() then return new; end if;
  if tg_op = 'INSERT' then
    if not private.is_welfare_admin(new.group_id) then
      raise exception 'Only the group admin can add members' using errcode = 'P0001';
    end if;
    if new.status not in ('invited', 'active') then new.status := 'invited'; end if;
    new.user_id := null; new.consent_at := null; new.consent_channel := null; new.consent_version := null;
    new.created_by := (select auth.uid());
    if new.joined_via not in ('admin', 'csv') then new.joined_via := 'admin'; end if;
    if new.status = 'active' then
      if new.consent_attested_by is distinct from (select auth.uid()) then
        raise exception 'Confirm that the member agreed to be enrolled before adding them as active' using errcode = 'P0001';
      end if;
    else
      new.consent_attested_by := null;
    end if;
    return new;
  end if;
  if new.group_id <> old.group_id then
    raise exception 'A member cannot move to another group' using errcode = 'P0001';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Members link their own account with the join link or by signing in with the same phone number' using errcode = 'P0001';
  end if;
  if new.consent_at is distinct from old.consent_at or new.consent_version is distinct from old.consent_version or new.consent_channel is distinct from old.consent_channel then
    raise exception 'Consent is recorded by the member, not on their behalf' using errcode = 'P0001';
  end if;
  new.created_by := old.created_by; new.joined_via := old.joined_via;
  v_admin := private.is_welfare_admin(old.group_id);
  if v_admin then
    if old.status = 'left' and new.status <> 'left' then
      raise exception 'A member who left must be enrolled again' using errcode = 'P0001';
    end if;
    if new.status = 'active' and old.status in ('invited', 'pending') and old.consent_at is null then
      if old.user_id is not null then
        raise exception 'This member has not yet agreed to be enrolled' using errcode = 'P0001';
      end if;
      if new.consent_attested_by is distinct from (select auth.uid()) then
        raise exception 'Confirm that the member agreed to be enrolled before activating them' using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;
  if old.user_id = (select auth.uid()) then
    -- The member: contact details and leaving only.
    new.role := old.role; new.status := case when new.status = 'left' then 'left' else old.status end;
    new.notes := old.notes; new.joined_at := old.joined_at; new.ghana_card_last4 := old.ghana_card_last4;
    new.consent_attested_by := old.consent_attested_by;
    return new;
  end if;
  raise exception 'Only the group admin can change a member' using errcode = 'P0001';
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'welfare_members_guard' and tgrelid = 'public.welfare_members'::regclass) then
    create trigger welfare_members_guard before insert or update on public.welfare_members
      for each row execute function private.welfare_members_guard();
  end if;
end $$;

-- member_count = active + pending + invited (everyone not left).
create or replace function private.welfare_member_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.welfare_groups g
     set member_count = (select count(*) from public.welfare_members m where m.group_id = g.id and m.status <> 'left')
   where g.id = new.group_id;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'welfare_members_count' and tgrelid = 'public.welfare_members'::regclass) then
    create trigger welfare_members_count after insert or update of status on public.welfare_members
      for each row execute function private.welfare_member_count();
  end if;
end $$;

-- Beneficiaries: belong to a member of the same group; accounts link by verified phone only.
create or replace function private.welfare_beneficiaries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.full_name := btrim(new.full_name);
  if not exists (select 1 from public.welfare_members m where m.id = new.member_id and m.group_id = new.group_id) then
    raise exception 'A beneficiary belongs to a member of the same group' using errcode = 'P0001';
  end if;
  if private.welfare_is_system() then return new; end if;
  if tg_op = 'INSERT' then
    new.user_id := null;
    new.created_by := (select auth.uid());
    return new;
  end if;
  if new.member_id <> old.member_id or new.group_id <> old.group_id then
    raise exception 'A beneficiary cannot move to another member' using errcode = 'P0001';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Beneficiaries link their own account by signing in with the same phone number' using errcode = 'P0001';
  end if;
  new.created_by := old.created_by;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'welfare_beneficiaries_guard' and tgrelid = 'public.welfare_beneficiaries'::regclass) then
    create trigger welfare_beneficiaries_guard before insert or update on public.welfare_beneficiaries
      for each row execute function private.welfare_beneficiaries_guard();
  end if;
end $$;

-- Sponsors: invited by the admin or the member; the sponsor links themselves (invite link / verified e-mail); a
-- sponsorship never moves to another member; ending stamps ended_at.
create or replace function private.welfare_sponsors_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.welfare_members m where m.id = new.member_id and m.group_id = new.group_id) then
    raise exception 'A sponsor is linked to a member of the same group' using errcode = 'P0001';
  end if;
  if new.status = 'ended' then new.ended_at := coalesce(new.ended_at, now()); end if;
  if new.status = 'active' then new.accepted_at := coalesce(new.accepted_at, now()); end if;
  if private.welfare_is_system() then return new; end if;
  if tg_op = 'INSERT' then
    if not (private.is_welfare_admin(new.group_id) or private.is_welfare_member_self(new.member_id)) then
      raise exception 'Only the group admin or the member can invite a sponsor' using errcode = 'P0001';
    end if;
    new.status := 'invited'; new.sponsor_user_id := null; new.accepted_at := null; new.ended_at := null;
    new.invited_by := (select auth.uid());
    return new;
  end if;
  if new.member_id <> old.member_id or new.group_id <> old.group_id then
    raise exception 'A sponsorship cannot move to another member' using errcode = 'P0001';
  end if;
  if new.sponsor_user_id is distinct from old.sponsor_user_id then
    raise exception 'Sponsors link their own account with the invite link' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and new.status <> 'ended' then
    raise exception 'A sponsorship becomes active when the sponsor accepts the invitation; afterwards it can only be ended' using errcode = 'P0001';
  end if;
  new.invite_token := old.invite_token; new.invited_by := old.invited_by;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'welfare_sponsors_guard' and tgrelid = 'public.welfare_sponsors'::regclass) then
    create trigger welfare_sponsors_guard before insert or update on public.welfare_sponsors
      for each row execute function private.welfare_sponsors_guard();
  end if;
end $$;

-- Contributions: written by the platform (schedule generation, payment outcomes) and the RPCs; a paid contribution is
-- final and always carries the payments row that settled it to the insurer.
create or replace function private.welfare_contributions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.welfare_members m where m.id = new.member_id and m.group_id = new.group_id) then
    raise exception 'A contribution belongs to a member of the same group' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.member_id <> old.member_id or new.group_id <> old.group_id or new.period_start <> old.period_start then
      raise exception 'A contribution cannot move to another member or period' using errcode = 'P0001';
    end if;
    if old.status = 'paid' and (new.status <> 'paid' or new.payment_id is distinct from old.payment_id or new.amount <> old.amount) then
      raise exception 'A paid contribution cannot be changed' using errcode = 'P0001';
    end if;
    if old.status in ('waived', 'cancelled') and new.status not in ('waived', 'cancelled', 'due') then
      raise exception 'A waived or cancelled contribution can only be reopened as due' using errcode = 'P0001';
    end if;
    if new.status = 'paid' then
      new.paid_at := coalesce(new.paid_at, now());
      if new.payment_id is null then
        raise exception 'A paid contribution needs the payment that settled it' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if not private.welfare_is_system() then
    raise exception 'Contributions are generated and settled by Covva; admins can waive one from the group page' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'welfare_contributions_guard' and tgrelid = 'public.welfare_contributions'::regclass) then
    create trigger welfare_contributions_guard before insert or update on public.welfare_contributions
      for each row execute function private.welfare_contributions_guard();
  end if;
end $$;

-- Requests for a welfare group: only the group's admin (or the platform) may attach the group.
create or replace function private.requests_welfare_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.welfare_group_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.welfare_group_id is not distinct from old.welfare_group_id then return new; end if;
  if private.is_service_role() or private.is_platform_staff() then return new; end if;
  if not private.is_welfare_admin(new.welfare_group_id) then
    raise exception 'Only the group admin can request cover for a welfare group' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'requests_welfare_guard' and tgrelid = 'public.requests'::regclass) then
    create trigger requests_welfare_guard before insert or update of welfare_group_id on public.requests
      for each row execute function private.requests_welfare_guard();
  end if;
end $$;

-- Claims on a welfare group: the member must belong to the group, and the group's policy must be the claim's policy.
create or replace function private.claims_welfare_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.welfare_group_id is null and new.welfare_member_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.welfare_group_id is not distinct from old.welfare_group_id and new.welfare_member_id is not distinct from old.welfare_member_id then return new; end if;
  if new.welfare_group_id is null or new.welfare_member_id is null then
    raise exception 'A welfare claim names both the group and the member concerned' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.welfare_members m where m.id = new.welfare_member_id and m.group_id = new.welfare_group_id) then
    raise exception 'The member is not on this welfare group' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.welfare_groups g where g.id = new.welfare_group_id and g.policy_id = new.policy_id) then
    raise exception 'A welfare claim is raised on the group''s master policy' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'claims_welfare_guard' and tgrelid = 'public.claims'::regclass) then
    create trigger claims_welfare_guard before insert or update of welfare_group_id, welfare_member_id on public.claims
      for each row execute function private.claims_welfare_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Placement sync: broker acceptance → group broker; policy → group insurer / policy / status
-- ---------------------------------------------------------------------------
create or replace function private.welfare_sync_request_broker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.welfare_group_id is not null and new.broker_org_id is not null and new.broker_org_id is distinct from old.broker_org_id then
    update public.welfare_groups g
       set broker_org_id = new.broker_org_id,
           status = case when g.status = 'draft' then 'quoting' else g.status end
     where g.id = new.welfare_group_id and g.broker_org_id is distinct from new.broker_org_id;
  end if;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'requests_welfare_sync_broker' and tgrelid = 'public.requests'::regclass) then
    create trigger requests_welfare_sync_broker after update of broker_org_id on public.requests
      for each row execute function private.welfare_sync_request_broker();
  end if;
end $$;

create or replace function private.welfare_sync_policy() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid;
begin
  if new.request_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.cover_end is not distinct from old.cover_end
     and new.insurer_org_id is not distinct from old.insurer_org_id then
    return null;
  end if;
  select r.welfare_group_id into v_group from public.requests r where r.id = new.request_id;
  if v_group is null then return null; end if;
  update public.welfare_groups g
     set policy_id = new.id,
         insurer_org_id = new.insurer_org_id,
         broker_org_id = coalesce(g.broker_org_id, new.broker_org_id),
         status = case
           when new.status in ('active', 'renewed') then 'active'
           when new.status in ('lapsed', 'expired') then 'lapsed'
           when new.status = 'cancelled' then 'cancelled'
           else g.status end,
         renewal_date = coalesce(new.cover_end, g.renewal_date)
   where g.id = v_group;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'policies_welfare_sync' and tgrelid = 'public.policies'::regclass) then
    create trigger policies_welfare_sync after insert or update of status, cover_end, insurer_org_id on public.policies
      for each row execute function private.welfare_sync_policy();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------
-- The signed-in customer creates a group and becomes its admin (and its first, consenting member).
create or replace function public.create_welfare_group(
  p_name text, p_kind text default 'association', p_contribution_amount numeric default 0, p_cadence text default 'monthly',
  p_contribution_day integer default 1, p_description text default null, p_region text default null, p_category_slug text default 'life-funeral',
  p_member_phone text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_cat uuid;
  v_group uuid;
  v_full_name text;
begin
  if v_uid is null then
    raise exception 'Please sign in to create a welfare group' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 160 then
    raise exception 'Enter the group name (2–160 characters)' using errcode = 'P0001';
  end if;
  if coalesce(p_kind, '') not in ('association', 'church', 'alumni', 'hometown_union', 'family', 'union', 'other') then
    raise exception 'Choose the type of group' using errcode = 'P0001';
  end if;
  if coalesce(p_cadence, '') not in ('monthly', 'quarterly', 'annual') then
    raise exception 'Choose monthly, quarterly or yearly contributions' using errcode = 'P0001';
  end if;
  if coalesce(p_contribution_amount, 0) < 0 or coalesce(p_contribution_amount, 0) > 100000 then
    raise exception 'Enter the contribution per member (GH₵ 0 – 100,000)' using errcode = 'P0001';
  end if;
  if coalesce(p_contribution_day, 0) not between 1 and 28 then
    raise exception 'Choose a day of the month between 1 and 28' using errcode = 'P0001';
  end if;
  if (select count(*) from public.welfare_groups g where g.admin_user_id = v_uid and g.status <> 'cancelled') >= 10 then
    raise exception 'You can run up to 10 welfare groups. Contact support for more.' using errcode = 'P0001';
  end if;
  select c.id into v_cat from public.product_categories c where c.slug = coalesce(p_category_slug, 'life-funeral');
  select coalesce(nullif(btrim(p.full_name), ''), 'Group admin') into v_full_name from public.profiles p where p.id = v_uid;

  perform set_config('app.welfare_sys', '1', true);
  insert into public.welfare_groups (name, kind, description, region, admin_user_id, category_id, status, contribution_amount, contribution_cadence, contribution_day, created_by)
  values (v_name, p_kind, nullif(left(btrim(coalesce(p_description, '')), 2000), ''), nullif(left(btrim(coalesce(p_region, '')), 60), ''), v_uid, v_cat, 'draft',
          round(coalesce(p_contribution_amount, 0), 2), p_cadence, p_contribution_day, v_uid)
  returning id into v_group;
  insert into public.welfare_members (group_id, full_name, phone, role, status, user_id, joined_via, consent_at, consent_channel, consent_version, created_by)
  values (v_group, coalesce(v_full_name, 'Group admin'), nullif(left(btrim(coalesce(p_member_phone, '')), 20), ''), 'admin', 'active', v_uid, 'admin', now(), 'app', 'welfare-2026-10', v_uid);
  perform set_config('app.welfare_sys', '', true);
  return v_group;
end $$;
revoke all on function public.create_welfare_group(text, text, numeric, text, integer, text, text, text, text) from public, anon;
grant execute on function public.create_welfare_group(text, text, numeric, text, integer, text, text, text, text) to authenticated, service_role;

-- Join by invitation link: consent is captured here (the member is the caller). An admin-added member with the
-- same phone is linked (and activated); otherwise a pending member is created for the admin to approve.
create or replace function public.join_welfare_group(p_token text, p_full_name text, p_phone text default null, p_consent boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_group public.welfare_groups%rowtype;
  v_member uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := nullif(left(btrim(coalesce(p_phone, '')), 20), '');
  v_digits text := private.ghana_phone_digits(p_phone);
begin
  if v_uid is null then
    raise exception 'Please sign in to join the group' using errcode = 'P0001';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'Please agree to be enrolled and to your details being shared with the broker and insurer' using errcode = 'P0001';
  end if;
  select * into v_group from public.welfare_groups g where g.invite_token = coalesce(p_token, '') and g.invite_enabled and g.status <> 'cancelled';
  if v_group.id is null then
    raise exception 'This invitation link is not valid any more. Ask the group admin for a new one.' using errcode = 'P0001';
  end if;
  select m.id into v_member from public.welfare_members m where m.group_id = v_group.id and m.user_id = v_uid and m.status <> 'left' limit 1;
  if v_member is not null then
    return v_member;
  end if;
  if length(v_name) < 2 then
    raise exception 'Enter your full name' using errcode = 'P0001';
  end if;
  perform set_config('app.welfare_sys', '1', true);
  -- An admin-added row with the same phone: link and activate it.
  if v_digits is not null and length(v_digits) >= 12 then
    select m.id into v_member from public.welfare_members m
     where m.group_id = v_group.id and m.user_id is null and m.status <> 'left' and m.phone is not null and private.ghana_phone_digits(m.phone) = v_digits
     order by m.created_at limit 1;
    if v_member is not null then
      update public.welfare_members m
         set user_id = v_uid, status = case when m.status in ('invited', 'pending') then 'active' else m.status end,
             consent_at = now(), consent_channel = 'link', consent_version = v_group.consent_version, joined_via = 'link'
       where m.id = v_member;
    end if;
  end if;
  if v_member is null then
    insert into public.welfare_members (group_id, full_name, phone, role, status, user_id, joined_via, consent_at, consent_channel, consent_version, created_by)
    values (v_group.id, v_name, v_phone, 'member', 'pending', v_uid, 'link', now(), 'link', v_group.consent_version, v_uid)
    returning id into v_member;
  end if;
  perform set_config('app.welfare_sys', '', true);
  return v_member;
end $$;
revoke all on function public.join_welfare_group(text, text, text, boolean) from public, anon;
grant execute on function public.join_welfare_group(text, text, text, boolean) to authenticated, service_role;

-- A linked member (matched by phone, not yet consented) records their consent; an invited member becomes active.
create or replace function public.consent_welfare_membership(p_member_id uuid, p_consent boolean default true) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_member public.welfare_members%rowtype;
  v_version text;
begin
  if v_uid is null then
    raise exception 'Please sign in' using errcode = 'P0001';
  end if;
  select * into v_member from public.welfare_members m where m.id = p_member_id and m.user_id = v_uid;
  if v_member.id is null then
    raise exception 'Membership not found' using errcode = 'P0001';
  end if;
  select g.consent_version into v_version from public.welfare_groups g where g.id = v_member.group_id;
  perform set_config('app.welfare_sys', '1', true);
  if coalesce(p_consent, false) then
    update public.welfare_members m
       set consent_at = coalesce(m.consent_at, now()), consent_channel = coalesce(m.consent_channel, 'app'), consent_version = coalesce(m.consent_version, v_version),
           status = case when m.status = 'invited' then 'active' else m.status end
     where m.id = v_member.id;
  else
    update public.welfare_members m set status = 'left', left_at = current_date where m.id = v_member.id and m.status <> 'left';
  end if;
  perform set_config('app.welfare_sys', '', true);
  return coalesce(p_consent, false);
end $$;
revoke all on function public.consent_welfare_membership(uuid, boolean) from public, anon;
grant execute on function public.consent_welfare_membership(uuid, boolean) to authenticated, service_role;

-- A sponsor abroad accepts an invitation link: the sponsorship becomes active for the caller.
create or replace function public.accept_welfare_sponsorship(p_token text, p_display_currency text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.welfare_sponsors%rowtype;
  v_cur text := upper(coalesce(p_display_currency, ''));
begin
  if v_uid is null then
    raise exception 'Please sign in to accept the invitation' using errcode = 'P0001';
  end if;
  select * into v_row from public.welfare_sponsors s where s.invite_token = coalesce(p_token, '') and s.status <> 'ended';
  if v_row.id is null then
    raise exception 'This sponsor invitation is not valid any more. Ask the member or the group admin for a new one.' using errcode = 'P0001';
  end if;
  if v_row.sponsor_user_id is not null and v_row.sponsor_user_id <> v_uid then
    raise exception 'This invitation was already accepted by someone else' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.welfare_members m where m.id = v_row.member_id and m.user_id = v_uid) then
    raise exception 'You cannot sponsor yourself; pay your own contributions from the group page' using errcode = 'P0001';
  end if;
  if v_cur <> '' and v_cur not in ('GHS', 'GBP', 'USD', 'EUR', 'CAD') then
    raise exception 'Choose GHS, GBP, USD, EUR or CAD' using errcode = 'P0001';
  end if;
  perform set_config('app.welfare_sys', '1', true);
  update public.welfare_sponsors s
     set sponsor_user_id = v_uid, status = 'active', accepted_at = coalesce(s.accepted_at, now()),
         display_currency = case when v_cur <> '' then v_cur else s.display_currency end
   where s.id = v_row.id;
  perform set_config('app.welfare_sys', '', true);
  return v_row.id;
end $$;
revoke all on function public.accept_welfare_sponsorship(text, text) from public, anon;
grant execute on function public.accept_welfare_sponsorship(text, text) to authenticated, service_role;

-- Sign-in matching (same shape as link_my_scheme_memberships): the VERIFIED sign-in phone links member and
-- beneficiary rows; the VERIFIED sign-in e-mail links sponsor invitations. Returns how many rows were linked.
create or replace function public.link_my_welfare_memberships() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_email text;
  v_n integer := 0;
  v_k integer := 0;
begin
  if v_uid is null then return 0; end if;
  select private.ghana_phone_digits(u.phone), lower(u.email) into v_phone, v_email
    from auth.users u where u.id = v_uid;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.phone is not null and u.phone_confirmed_at is not null) then v_phone := null; end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email is not null and u.email_confirmed_at is not null) then v_email := null; end if;
  perform set_config('app.welfare_sys', '1', true);
  if v_phone is not null and length(v_phone) >= 12 then
    update public.welfare_members m
       set user_id = v_uid, joined_via = case when m.joined_via = 'admin' then 'phone' else m.joined_via end
     where m.user_id is null and m.status <> 'left' and m.phone is not null and private.ghana_phone_digits(m.phone) = v_phone
       and not exists (select 1 from public.welfare_members x where x.group_id = m.group_id and x.user_id = v_uid and x.status <> 'left');
    get diagnostics v_k = row_count; v_n := v_n + v_k;
    update public.welfare_beneficiaries b set user_id = v_uid
     where b.user_id is null and b.status = 'active' and b.phone is not null and private.ghana_phone_digits(b.phone) = v_phone;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  if v_email is not null then
    update public.welfare_sponsors s
       set sponsor_user_id = v_uid, status = 'active', accepted_at = coalesce(s.accepted_at, now())
     where s.sponsor_user_id is null and s.status = 'invited' and s.sponsor_email is not null and lower(s.sponsor_email::text) = v_email
       and not exists (select 1 from public.welfare_members m where m.id = s.member_id and m.user_id = v_uid)
       and not exists (select 1 from public.welfare_sponsors x where x.member_id = s.member_id and x.sponsor_user_id = v_uid and x.status <> 'ended');
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  perform set_config('app.welfare_sys', '', true);
  return v_n;
end $$;
revoke all on function public.link_my_welfare_memberships() from public, anon;
grant execute on function public.link_my_welfare_memberships() to authenticated, service_role;

-- Contribution periods: the first day of each period from `p_from` to `p_through` (cadence months apart), due on the
-- group's contribution day. Pure SQL so the admin RPC and the app's schedule agree.
create or replace function private.welfare_period_starts(p_cadence text, p_from date, p_through date) returns setof date
language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_from)::date + (n * (case p_cadence when 'monthly' then 1 when 'quarterly' then 3 else 12 end) * interval '1 month'))::date
  from generate_series(0, 600) n
  where (date_trunc('month', p_from)::date + (n * (case p_cadence when 'monthly' then 1 when 'quarterly' then 3 else 12 end) * interval '1 month'))::date <= p_through;
$$;
revoke all on function private.welfare_period_starts(text, date, date) from public, anon, authenticated;
grant execute on function private.welfare_period_starts(text, date, date) to service_role;

-- Generate the due contributions for every active member up to `p_through` (default: the current period).
-- Idempotent (unique member + period). Callable by the group admin and the platform.
create or replace function public.generate_welfare_contributions(p_group_id uuid, p_through date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_group public.welfare_groups%rowtype;
  v_through date;
  v_n integer := 0;
begin
  select * into v_group from public.welfare_groups g where g.id = p_group_id;
  if v_group.id is null then
    raise exception 'Group not found' using errcode = 'P0001';
  end if;
  if not (private.is_welfare_admin(v_group.id) or private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only the group admin can generate contributions' using errcode = 'P0001';
  end if;
  if v_group.status = 'cancelled' then
    raise exception 'This group is cancelled' using errcode = 'P0001';
  end if;
  if v_group.contribution_amount <= 0 then
    raise exception 'Set the contribution per member first' using errcode = 'P0001';
  end if;
  v_through := least(coalesce(p_through, current_date), (current_date + interval '13 months')::date);
  perform set_config('app.welfare_sys', '1', true);
  insert into public.welfare_contributions (group_id, member_id, period_start, due_at, amount, status)
  select v_group.id, m.id, p.period_start,
         least(p.period_start + (v_group.contribution_day - 1), (date_trunc('month', p.period_start) + interval '1 month - 1 day')::date),
         v_group.contribution_amount, 'due'
    from public.welfare_members m
    cross join lateral private.welfare_period_starts(v_group.contribution_cadence, greatest(v_group.plan_starts_on, m.joined_at), v_through) as p(period_start)
   where m.group_id = v_group.id and m.status = 'active'
  on conflict (member_id, period_start) do nothing;
  get diagnostics v_n = row_count;
  perform set_config('app.welfare_sys', '', true);
  return v_n;
end $$;
revoke all on function public.generate_welfare_contributions(uuid, date) from public, anon;
grant execute on function public.generate_welfare_contributions(uuid, date) to authenticated, service_role;

-- The admin waives a due / failed contribution (e.g. a bereaved member), with a note. Never touches paid ones.
create or replace function public.waive_welfare_contribution(p_contribution_id uuid, p_note text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.welfare_contributions%rowtype;
begin
  select * into v_row from public.welfare_contributions c where c.id = p_contribution_id;
  if v_row.id is null then
    raise exception 'Contribution not found' using errcode = 'P0001';
  end if;
  if not (private.is_welfare_admin(v_row.group_id) or private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only the group admin can waive a contribution' using errcode = 'P0001';
  end if;
  if v_row.status not in ('due', 'failed') then
    raise exception 'Only a due or failed contribution can be waived' using errcode = 'P0001';
  end if;
  perform set_config('app.welfare_sys', '1', true);
  update public.welfare_contributions c set status = 'waived', note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), paid_by_user_id = null where c.id = v_row.id;
  perform set_config('app.welfare_sys', '', true);
  return true;
end $$;
revoke all on function public.waive_welfare_contribution(uuid, text) from public, anon;
grant execute on function public.waive_welfare_contribution(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
alter table public.welfare_groups enable row level security;
alter table public.welfare_members enable row level security;
alter table public.welfare_beneficiaries enable row level security;
alter table public.welfare_sponsors enable row level security;
alter table public.welfare_contributions enable row level security;

-- Groups: admins, linked members, sponsors (of any member), the broker of record, the insurer and staff read.
-- Admins create (guarded) and edit; the broker of record updates status / renewal (guarded).
select private.ensure_policy('welfare_groups', 'welfare groups: parties read', $p$
  create policy "welfare groups: parties read" on public.welfare_groups for select to authenticated
  using (
    (select private.is_platform_staff())
    or admin_user_id = (select auth.uid())
    or private.is_welfare_member_user(id)
    or private.is_welfare_sponsor(id)
    or broker_org_id in (select private.user_org_ids())
    or insurer_org_id in (select private.user_org_ids())
  )$p$);
select private.ensure_policy('welfare_groups', 'welfare groups: customers create', $p$
  create policy "welfare groups: customers create" on public.welfare_groups for insert to authenticated
  with check (admin_user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('welfare_groups', 'welfare groups: admins and broker update', $p$
  create policy "welfare groups: admins and broker update" on public.welfare_groups for update to authenticated
  using (private.is_welfare_admin(id) or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))
  with check (private.is_welfare_admin(id) or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))$p$);

-- Members (PII): the member, their sponsors, the admins, the broker / insurer and staff.
select private.ensure_policy('welfare_members', 'welfare members: parties read', $p$
  create policy "welfare members: parties read" on public.welfare_members for select to authenticated
  using (user_id = (select auth.uid()) or private.can_read_welfare_member(group_id, id))$p$);
select private.ensure_policy('welfare_members', 'welfare members: admins add', $p$
  create policy "welfare members: admins add" on public.welfare_members for insert to authenticated
  with check (private.is_welfare_admin(group_id) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('welfare_members', 'welfare members: admins and self update', $p$
  create policy "welfare members: admins and self update" on public.welfare_members for update to authenticated
  using (user_id = (select auth.uid()) or private.is_welfare_admin(group_id) or (select private.is_platform_staff()))
  with check (user_id = (select auth.uid()) or private.is_welfare_admin(group_id) or (select private.is_platform_staff()))$p$);

-- Beneficiaries (PII): the member, the admins, the partners, staff, and the beneficiary themselves once linked.
select private.ensure_policy('welfare_beneficiaries', 'welfare beneficiaries: parties read', $p$
  create policy "welfare beneficiaries: parties read" on public.welfare_beneficiaries for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_welfare_member_self(member_id)
    or private.is_welfare_admin(group_id)
    or private.is_welfare_partner(group_id)
    or (select private.is_platform_staff())
  )$p$);
select private.ensure_policy('welfare_beneficiaries', 'welfare beneficiaries: member and admins write', $p$
  create policy "welfare beneficiaries: member and admins write" on public.welfare_beneficiaries for insert to authenticated
  with check (private.is_welfare_member_self(member_id) or private.is_welfare_admin(group_id) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('welfare_beneficiaries', 'welfare beneficiaries: member and admins update', $p$
  create policy "welfare beneficiaries: member and admins update" on public.welfare_beneficiaries for update to authenticated
  using (private.is_welfare_member_self(member_id) or private.is_welfare_admin(group_id) or (select private.is_platform_staff()))
  with check (private.is_welfare_member_self(member_id) or private.is_welfare_admin(group_id) or (select private.is_platform_staff()))$p$);

-- Sponsors: the sponsor, the member they pay for, the admins and staff. The broker sees who pays (no contact details
-- are needed for that, but the row is small) — kept to admins / member / sponsor / staff.
select private.ensure_policy('welfare_sponsors', 'welfare sponsors: parties read', $p$
  create policy "welfare sponsors: parties read" on public.welfare_sponsors for select to authenticated
  using (
    sponsor_user_id = (select auth.uid())
    or private.is_welfare_member_self(member_id)
    or private.is_welfare_admin(group_id)
    or (select private.is_platform_staff())
  )$p$);
select private.ensure_policy('welfare_sponsors', 'welfare sponsors: member and admins invite', $p$
  create policy "welfare sponsors: member and admins invite" on public.welfare_sponsors for insert to authenticated
  with check (private.is_welfare_member_self(member_id) or private.is_welfare_admin(group_id) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('welfare_sponsors', 'welfare sponsors: parties update', $p$
  create policy "welfare sponsors: parties update" on public.welfare_sponsors for update to authenticated
  using (sponsor_user_id = (select auth.uid()) or private.is_welfare_member_self(member_id) or private.is_welfare_admin(group_id) or (select private.is_platform_staff()))
  with check (sponsor_user_id = (select auth.uid()) or private.is_welfare_member_self(member_id) or private.is_welfare_admin(group_id) or (select private.is_platform_staff()))$p$);

-- Contributions: the member, their sponsors, the admins, the broker / insurer and staff read; writes are the
-- platform's (payments) and the RPCs' (generate / waive).
select private.ensure_policy('welfare_contributions', 'welfare contributions: parties read', $p$
  create policy "welfare contributions: parties read" on public.welfare_contributions for select to authenticated
  using (private.can_read_welfare_member(group_id, member_id))$p$);
select private.ensure_policy('welfare_contributions', 'welfare contributions: staff write', $p$
  create policy "welfare contributions: staff write" on public.welfare_contributions for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- Claims on a welfare group: the member concerned and their linked beneficiaries can follow the claim (the admin is
-- the policyholder, the reporter and the partners already can).
select private.ensure_policy('claims', 'claims: welfare member and beneficiaries read', $p$
  create policy "claims: welfare member and beneficiaries read" on public.claims for select to authenticated
  using (welfare_member_id is not null and (private.is_welfare_member_self(welfare_member_id) or private.is_welfare_beneficiary_user(welfare_member_id)))$p$);

-- ---------------------------------------------------------------------------
-- 7. Housekeeping: updated_at + audit, grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['welfare_groups', 'welfare_members', 'welfare_beneficiaries', 'welfare_sponsors', 'welfare_contributions'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

grant select, insert, update on public.welfare_groups, public.welfare_members, public.welfare_beneficiaries, public.welfare_sponsors to authenticated;
grant select on public.welfare_contributions to authenticated;
-- Supabase's default privileges grant ALL on new tables to the API roles; contributions are platform-written only.
revoke insert, update, delete, truncate on public.welfare_contributions from anon, authenticated;
grant select, insert, update on public.welfare_groups, public.welfare_members, public.welfare_beneficiaries, public.welfare_sponsors, public.welfare_contributions to service_role;
grant usage, select on sequence public.welfare_group_ref_seq to authenticated, service_role;
-- Rows are never deleted (members leave, sponsorships end, groups are cancelled, contributions are waived/cancelled).
revoke delete, truncate on public.welfare_groups, public.welfare_members, public.welfare_beneficiaries, public.welfare_sponsors, public.welfare_contributions from service_role;
