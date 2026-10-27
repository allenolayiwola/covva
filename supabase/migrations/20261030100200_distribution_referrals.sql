-- =============================================================================
-- Embedded distribution and referrals (roadmap Phase 3; Addendum 6 item 6 —
-- referral credits now, the full loyalty engine in Phase 4 reuses the ledger).
--
-- Additive only (no drops, no deletes). Policies are created only when missing.
--
--   * org_type gains `distributor`: car dealers, banks/lenders, landlords, fleets,
--     travel agents, remittance providers and employers that offer Covva quotes
--     at their point of sale (widget or partner API). Distributors are NOT
--     brokers or insurers: they never advise, quote binding cover or touch money.
--   * distribution_partners: one commercial/technical profile per distributor
--     organisation (segment, categories, widget origins, brand, revenue share).
--     revenue_share_pct is a share of COVVA'S PLATFORM FEE only — never of the
--     premium, which always settles to the insurer.
--   * referral_links / referral_attributions: codes (8 chars, RFC 4648 base32)
--     owned by a customer, distributor or broker; one attribution per request.
--   * reward_ledger: append-only journal of referral credits, partner revenue
--     share accruals, redemptions and reversals. Credits are GHS credit units,
--     not cash, and are only redeemable against Covva's own platform fees (or a
--     future premium where the insurer funds and approves it).
--   * reward_rules: configurable rules (per insurer from Phase 4). The seeded
--     customer referral rule is INACTIVE by default: inducements to buy
--     insurance need NIC / insurer approval before they are switched on.
--
-- Note: the new enum value cannot be used as an enum literal inside the same
-- transaction, so every comparison below uses `type::text = 'distributor'`.
-- =============================================================================

alter type public.org_type add value if not exists 'distributor';

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.ensure_policy(p_table text, p_name text, p_sql text) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;

-- WCAG 2.x contrast ratio of a #rrggbb colour against white (1 … 21). Mirrors contrastOk() in @im/core.
create or replace function private.wcag_contrast_on_white(p_hex text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  c numeric[];
  i int;
  v numeric;
  l numeric;
begin
  if p_hex is null or p_hex !~ '^#[0-9a-fA-F]{6}$' then return null; end if;
  c := array[
    ('x' || substr(p_hex, 2, 2))::bit(8)::int / 255.0,
    ('x' || substr(p_hex, 4, 2))::bit(8)::int / 255.0,
    ('x' || substr(p_hex, 6, 2))::bit(8)::int / 255.0
  ];
  for i in 1..3 loop
    v := c[i];
    c[i] := case when v <= 0.04045 then v / 12.92 else power((v + 0.055) / 1.055, 2.4) end;
  end loop;
  l := 0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3];
  return round(1.05 / (l + 0.05), 2);
end $$;

-- Referral codes: 8 characters of the RFC 4648 base32 alphabet (no 0/1/8/9 look-alikes).
create or replace function private.new_referral_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  v text;
  i int;
begin
  loop
    v := '';
    for i in 1..8 loop
      v := v || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.referral_links where code = v);
  end loop;
  return v;
end $$;

-- +233 24*****67 style masking for partner reports.
create or replace function private.mask_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_phone is null or length(regexp_replace(p_phone, '\s', '', 'g')) < 6 then null
    else left(regexp_replace(p_phone, '\s', '', 'g'), 4)
         || repeat('*', greatest(length(regexp_replace(p_phone, '\s', '', 'g')) - 6, 2))
         || right(regexp_replace(p_phone, '\s', '', 'g'), 2)
  end;
$$;

create or replace function private.first_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), '');
$$;

-- ---------------------------------------------------------------------------
-- 1. Distribution partners
-- ---------------------------------------------------------------------------
create table if not exists public.distribution_partners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations (id) on delete cascade,
  crm_account_id uuid references public.crm_accounts (id) on delete set null,
  segment text not null default 'other' check (segment in ('car_dealer', 'bank', 'landlord', 'fleet', 'travel_agent', 'remittance', 'employer', 'other')),
  allowed_categories text[] not null default '{}',
  widget_domains text[] not null default '{}',
  brand jsonb not null default '{}'::jsonb,
  revenue_share_pct numeric(5, 2) not null default 0 check (revenue_share_pct >= 0 and revenue_share_pct <= 100),
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  contract_ref text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.distribution_partners is 'Embedded distribution partners (distributor organisations): dealers, banks, landlords, fleets, travel agents, remittance providers, employers. They refer customers; they never advise, bind cover or collect premiums.';
comment on column public.distribution_partners.allowed_categories is 'Category slugs the widget/API may quote. Empty = every available (non-planned) category.';
comment on column public.distribution_partners.widget_domains is 'Allowed embedding origins for the widget (CSP frame-ancestors), e.g. https://dealer.example.com or https://*.bank.example. Empty = the widget cannot be framed.';
comment on column public.distribution_partners.brand is '{ primary_colour: "#rrggbb" (must pass WCAG AA 4.5:1 on white), logo_url: "https://…" } for co-branding.';
comment on column public.distribution_partners.revenue_share_pct is 'Share of COVVA''S PLATFORM FEE on converted business paid to the partner. Never a share of the premium (the premium settles to the insurer).';
create index if not exists distribution_partners_status_idx on public.distribution_partners (status);

create or replace function private.distribution_partners_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
  d text;
  v_colour text;
  v_logo text;
begin
  select type::text into v_type from public.organizations where id = new.org_id;
  if v_type is distinct from 'distributor' then
    raise exception 'Distribution partners must be distributor organisations' using errcode = 'P0001';
  end if;
  if coalesce(array_length(new.widget_domains, 1), 0) > 20 then
    raise exception 'At most 20 widget domains' using errcode = 'P0001';
  end if;
  new.widget_domains := array(select distinct lower(btrim(x)) from unnest(new.widget_domains) x where btrim(x) <> '');
  foreach d in array new.widget_domains loop
    if d !~ '^https://(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{2,5})?$'
       and d !~ '^http://localhost(:[0-9]{2,5})?$' then
      raise exception 'Widget domains must be https origins like https://shop.example.com (got %)', d using errcode = 'P0001';
    end if;
  end loop;
  if jsonb_typeof(new.brand) is distinct from 'object' then
    raise exception 'brand must be a JSON object' using errcode = 'P0001';
  end if;
  v_colour := new.brand ->> 'primary_colour';
  if v_colour is not null then
    if v_colour !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'The brand colour must be a hex colour like #0B6E4F' using errcode = 'P0001';
    end if;
    if private.wcag_contrast_on_white(v_colour) < 4.5 then
      raise exception 'The brand colour % is too light: white text needs a contrast of at least 4.5:1 (WCAG AA)', v_colour using errcode = 'P0001';
    end if;
  end if;
  v_logo := new.brand ->> 'logo_url';
  if v_logo is not null and v_logo !~ '^https://' then
    raise exception 'The logo must be an https:// URL' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'distribution_partners_guard' and tgrelid = 'public.distribution_partners'::regclass) then
    create trigger distribution_partners_guard before insert or update on public.distribution_partners
      for each row execute function private.distribution_partners_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Referral links and attributions
-- ---------------------------------------------------------------------------
create table if not exists public.referral_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-7]{8}$'),
  owner_kind text not null check (owner_kind in ('customer', 'distributor', 'broker')),
  owner_user_id uuid references auth.users (id) on delete set null,
  owner_org_id uuid references public.organizations (id) on delete cascade,
  campaign text check (campaign is null or length(campaign) <= 80),
  landing_path text not null default '/' check (landing_path ~ '^/[^/\\]' or landing_path = '/'),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  check ((owner_kind = 'customer' and owner_user_id is not null) or (owner_kind in ('distributor', 'broker') and owner_org_id is not null))
);
comment on table public.referral_links is 'Referral codes. ?ref=CODE on any page sets the first-party covva_ref cookie (30 days); the next request created is attributed to the code. Distributor codes also identify the partner for the embedded widget (?partner=CODE).';
comment on column public.referral_links.landing_path is 'Relative path the shared link opens (e.g. /insurance/motor). Never an absolute URL.';
create index if not exists referral_links_owner_user_idx on public.referral_links (owner_user_id) where owner_user_id is not null;
create index if not exists referral_links_owner_org_idx on public.referral_links (owner_org_id, created_at desc) where owner_org_id is not null;
-- One default (campaign-less, enabled) link per customer.
create unique index if not exists referral_links_one_default_per_customer on public.referral_links (owner_user_id)
  where owner_kind = 'customer' and campaign is null and disabled_at is null;

create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.referral_links (code),
  request_id uuid unique references public.requests (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  policy_id uuid references public.policies (id) on delete set null,
  customer_id uuid references auth.users (id) on delete set null,
  source text not null default 'link' check (source in ('link', 'widget', 'api')),
  first_touch_at timestamptz not null default now(),
  converted_at timestamptz,
  partner_org_id uuid references public.organizations (id),
  rewards_evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (request_id is not null or lead_id is not null)
);
comment on table public.referral_attributions is 'Which code brought a request (unique per request) or a partner API lead. converted_at = the attributed policy became active; rewards are evaluated after the holding period by the referral-rewards cron.';
comment on column public.referral_attributions.partner_org_id is 'Distributor/broker organisation that owns the code (null for customer referrals).';
comment on column public.referral_attributions.rewards_evaluated_at is 'Set once every active reward rule has been decided (posted or not eligible) for this attribution.';
create index if not exists referral_attributions_code_idx on public.referral_attributions (code, created_at desc);
create index if not exists referral_attributions_partner_idx on public.referral_attributions (partner_org_id, created_at desc) where partner_org_id is not null;
create index if not exists referral_attributions_customer_idx on public.referral_attributions (customer_id) where customer_id is not null;
create index if not exists referral_attributions_policy_idx on public.referral_attributions (policy_id) where policy_id is not null;
create index if not exists referral_attributions_lead_idx on public.referral_attributions (lead_id) where lead_id is not null;
create index if not exists referral_attributions_pending_idx on public.referral_attributions (converted_at) where converted_at is not null and rewards_evaluated_at is null;

create or replace function private.referral_attributions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.referral_links;
begin
  select * into v_link from public.referral_links where code = new.code;
  if v_link.id is null then
    raise exception 'Unknown referral code' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and v_link.disabled_at is not null then
    raise exception 'This referral code is no longer active' using errcode = 'P0001';
  end if;
  if v_link.owner_kind = 'customer' and new.customer_id is not null and new.customer_id = v_link.owner_user_id then
    raise exception 'You cannot refer yourself' using errcode = 'P0001';
  end if;
  new.partner_org_id := case when v_link.owner_kind in ('distributor', 'broker') then v_link.owner_org_id else null end;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'referral_attributions_guard' and tgrelid = 'public.referral_attributions'::regclass) then
    create trigger referral_attributions_guard before insert or update on public.referral_attributions
      for each row execute function private.referral_attributions_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Reward rules and the reward ledger
-- ---------------------------------------------------------------------------
create table if not exists public.reward_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{3,60}$'),
  kind text not null check (kind in ('referral_credit', 'referral_bonus', 'partner_revenue_share')),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  conditions jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  insurer_org_id uuid references public.organizations (id),
  description text,
  regulatory_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.reward_rules is 'Reward rules. conditions: { min_premium, categories[], first_policy_only, holding_days, friend_amount, owner_kinds[], expiry_days }. insurer_org_id scopes a rule to one insurer (Phase 4 loyalty). Customer inducements stay inactive until NIC / insurer approval is on file.';

create table if not exists public.reward_ledger (
  id bigint generated always as identity primary key,
  user_id uuid,
  org_id uuid references public.organizations (id),
  kind text not null check (kind in ('referral_credit', 'referral_bonus', 'partner_revenue_share', 'redemption', 'reversal', 'adjustment')),
  amount numeric(12, 2) not null,
  currency char(3) not null default 'GHS',
  reference text,
  rule_key text,
  related_policy_id uuid,
  related_attribution_id uuid,
  memo text,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (user_id is not null or org_id is not null),
  check ((kind in ('redemption', 'reversal') and amount <= 0) or (kind in ('referral_credit', 'referral_bonus', 'partner_revenue_share') and amount >= 0) or kind = 'adjustment')
);
comment on table public.reward_ledger is 'Append-only reward journal. Customer credits are GHS credit units (not cash, not client money) redeemable only against Covva platform fees or insurer-funded premium discounts. partner_revenue_share rows accrue the partner''s share of Covva''s platform fee and are settled by statement. user_id / related ids are plain references so the journal outlives the rows it describes.';
comment on column public.reward_ledger.reference is 'Idempotency key, e.g. ref:<attribution id>:referrer. Unique when set.';
create unique index if not exists reward_ledger_reference_uidx on public.reward_ledger (reference) where reference is not null;
create index if not exists reward_ledger_user_idx on public.reward_ledger (user_id, created_at desc) where user_id is not null;
create index if not exists reward_ledger_org_idx on public.reward_ledger (org_id, created_at desc) where org_id is not null;
create index if not exists reward_ledger_attribution_idx on public.reward_ledger (related_attribution_id) where related_attribution_id is not null;

create or replace function private.reward_ledger_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'reward_ledger is append-only' using errcode = 'P0001';
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'reward_ledger_no_update' and tgrelid = 'public.reward_ledger'::regclass) then
    create trigger reward_ledger_no_update before update or delete on public.reward_ledger
      for each row execute function private.reward_ledger_immutable();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. updated_at + audit triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['distribution_partners', 'referral_attributions', 'reward_rules'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
  end loop;
  foreach t in array array['distribution_partners', 'referral_links', 'referral_attributions', 'reward_rules'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
  -- The reward ledger is append-only: audit inserts only.
  if not exists (select 1 from pg_trigger where tgname = 'audit_reward_ledger' and tgrelid = 'public.reward_ledger'::regclass) then
    create trigger audit_reward_ledger after insert on public.reward_ledger for each row execute function private.write_audit();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.distribution_partners enable row level security;
alter table public.referral_links enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.reward_rules enable row level security;
alter table public.reward_ledger enable row level security;

-- Staff read everything.
do $$
declare t text;
begin
  foreach t in array array['distribution_partners', 'referral_links', 'referral_attributions', 'reward_rules', 'reward_ledger'] loop
    perform private.ensure_policy(t, t || ': staff read', format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_platform_staff()))', t || ': staff read', t));
  end loop;
end $$;

-- Staff write partner profiles, links and rules (admin console). Attributions and the
-- reward ledger are written by the server (service role) only.
select private.ensure_policy('distribution_partners', 'distribution_partners: staff write', $p$
  create policy "distribution_partners: staff write" on public.distribution_partners for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('referral_links', 'referral_links: staff write', $p$
  create policy "referral_links: staff write" on public.referral_links for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('reward_rules', 'reward_rules: staff write', $p$
  create policy "reward_rules: staff write" on public.reward_rules for update to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))
$p$);

-- Distributors: their own partner row, links and attributions (no customer PII here:
-- names / phones only through partner_referral_report(), masked).
select private.ensure_policy('distribution_partners', 'distribution_partners: members read own', $p$
  create policy "distribution_partners: members read own" on public.distribution_partners for select to authenticated
  using (org_id in (select private.user_org_ids()))
$p$);
select private.ensure_policy('referral_links', 'referral_links: owners read own', $p$
  create policy "referral_links: owners read own" on public.referral_links for select to authenticated
  using (owner_user_id = (select auth.uid()) or (owner_org_id is not null and owner_org_id in (select private.user_org_ids())))
$p$);
select private.ensure_policy('referral_attributions', 'referral_attributions: partner reads own', $p$
  create policy "referral_attributions: partner reads own" on public.referral_attributions for select to authenticated
  using (partner_org_id is not null and partner_org_id in (select private.user_org_ids()))
$p$);
-- Customers: the attribution of their own requests (referrers see their friends only
-- as anonymous rows through my_referrals()).
select private.ensure_policy('referral_attributions', 'referral_attributions: customer reads own', $p$
  create policy "referral_attributions: customer reads own" on public.referral_attributions for select to authenticated
  using (customer_id = (select auth.uid()))
$p$);
-- Rewards: a customer reads their own credits; distributor owners/admins/finance read their accruals.
select private.ensure_policy('reward_ledger', 'reward_ledger: user reads own', $p$
  create policy "reward_ledger: user reads own" on public.reward_ledger for select to authenticated
  using (user_id = (select auth.uid()))
$p$);
select private.ensure_policy('reward_ledger', 'reward_ledger: org finance reads own', $p$
  create policy "reward_ledger: org finance reads own" on public.reward_ledger for select to authenticated
  using (org_id is not null and private.has_org_role(org_id, '{owner,admin,finance}'))
$p$);
-- Active rules are public knowledge for signed-in users (honest copy on the referrals page).
select private.ensure_policy('reward_rules', 'reward_rules: signed-in read active', $p$
  create policy "reward_rules: signed-in read active" on public.reward_rules for select to authenticated
  using (active)
$p$);

grant select on public.distribution_partners, public.referral_links, public.referral_attributions, public.reward_rules, public.reward_ledger to authenticated;
grant insert, update on public.distribution_partners, public.referral_links to authenticated;
grant update on public.reward_rules to authenticated;
revoke all on public.distribution_partners, public.referral_links, public.referral_attributions, public.reward_rules, public.reward_ledger from anon;

-- ---------------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------------
-- Public widget config for an enabled distributor code (anon may call: shown inside the iframe).
create or replace function public.embed_partner(p_code text)
returns table (org_id uuid, org_name text, code text, segment text, allowed_categories text[], widget_domains text[], primary_colour text, logo_url text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, l.code, p.segment, p.allowed_categories, p.widget_domains,
         p.brand ->> 'primary_colour', coalesce(p.brand ->> 'logo_url', o.logo_url)
  from public.referral_links l
  join public.distribution_partners p on p.org_id = l.owner_org_id
  join public.organizations o on o.id = p.org_id
  where l.code = upper(btrim(p_code))
    and l.owner_kind = 'distributor'
    and l.disabled_at is null
    and p.status = 'active'
    and o.status = 'active'
  limit 1;
$$;
revoke execute on function public.embed_partner(text) from public;
grant execute on function public.embed_partner(text) to anon, authenticated, service_role;

-- Partner referral report: masked customer details only (first name + masked phone).
create or replace function public.partner_referral_report(p_org_id uuid, p_from date default null, p_to date default null)
returns table (
  attribution_id uuid, code text, campaign text, source text, first_touch_at timestamptz, created_at timestamptz,
  converted_at timestamptz, request_reference text, category_slug text, request_status text, policy_status text,
  customer_first_name text, customer_phone_masked text, revenue_share numeric
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_service_role() or (select private.is_platform_staff()) or private.is_org_member(p_org_id)) then
    raise exception 'You are not a member of this organisation' using errcode = '42501';
  end if;
  return query
  select a.id, a.code, l.campaign, a.source, a.first_touch_at, a.created_at, a.converted_at,
         r.reference, c.slug, r.status::text, pol.status::text,
         private.first_name(coalesce(pr.full_name, ld.name)),
         private.mask_phone(coalesce(pr.phone, ld.phone)),
         coalesce((select sum(g.amount) from public.reward_ledger g
                   where g.related_attribution_id = a.id and g.org_id = p_org_id and g.kind in ('partner_revenue_share', 'reversal', 'adjustment')), 0)
  from public.referral_attributions a
  join public.referral_links l on l.code = a.code
  left join public.requests r on r.id = a.request_id
  left join public.product_categories c on c.id = r.category_id
  left join public.policies pol on pol.id = a.policy_id
  left join public.profiles pr on pr.id = a.customer_id
  left join public.leads ld on ld.id = a.lead_id
  where a.partner_org_id = p_org_id
    and (p_from is null or a.created_at >= p_from::timestamptz)
    and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
  order by a.created_at desc
  limit 2000;
end $$;
revoke execute on function public.partner_referral_report(uuid, date, date) from public, anon;
grant execute on function public.partner_referral_report(uuid, date, date) to authenticated, service_role;

-- A referrer's friends, anonymously: status and dates only.
create or replace function public.my_referrals()
returns table (attribution_id uuid, code text, source text, joined_at timestamptz, converted_at timestamptz, rewarded boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.code, a.source, a.created_at, a.converted_at,
         exists (select 1 from public.reward_ledger g where g.related_attribution_id = a.id and g.user_id = (select auth.uid()) and g.amount > 0)
  from public.referral_attributions a
  join public.referral_links l on l.code = a.code
  where l.owner_kind = 'customer' and l.owner_user_id = (select auth.uid())
  order by a.created_at desc
  limit 500;
$$;
revoke execute on function public.my_referrals() from public, anon;
grant execute on function public.my_referrals() to authenticated, service_role;

-- The caller's personal (campaign-less) referral link, created on first use.
create or replace function public.ensure_my_referral_link(p_code text default null)
returns public.referral_links
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.referral_links;
begin
  if v_uid is null then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  select * into v_row from public.referral_links
   where owner_kind = 'customer' and owner_user_id = v_uid and campaign is null and disabled_at is null
   limit 1;
  if v_row.id is not null then return v_row; end if;
  if p_code is not null and (p_code !~ '^[A-Z2-7]{8}$' or exists (select 1 from public.referral_links where code = p_code)) then
    p_code := null;
  end if;
  insert into public.referral_links (code, owner_kind, owner_user_id, landing_path, created_by)
  values (coalesce(p_code, private.new_referral_code()), 'customer', v_uid, '/', v_uid)
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.ensure_my_referral_link(text) from public, anon;
grant execute on function public.ensure_my_referral_link(text) to authenticated;

-- Distributor (or broker) owners/admins create campaign links for their organisation.
create or replace function public.create_partner_referral_link(p_org_id uuid, p_campaign text default null, p_landing_path text default '/', p_code text default null)
returns public.referral_links
language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
  v_row public.referral_links;
begin
  if not (private.is_service_role() or (select private.is_platform_staff()) or private.has_org_role(p_org_id, '{owner,admin}')) then
    raise exception 'Only owners and admins can create links' using errcode = '42501';
  end if;
  select type::text into v_type from public.organizations where id = p_org_id;
  if v_type not in ('distributor', 'broker') then
    raise exception 'Only distributor and broker organisations have partner links' using errcode = 'P0001';
  end if;
  if v_type = 'distributor' and not exists (select 1 from public.distribution_partners where org_id = p_org_id) then
    raise exception 'This organisation is not set up as a distribution partner yet' using errcode = 'P0001';
  end if;
  if p_code is not null and (p_code !~ '^[A-Z2-7]{8}$' or exists (select 1 from public.referral_links where code = p_code)) then
    p_code := null;
  end if;
  insert into public.referral_links (code, owner_kind, owner_org_id, campaign, landing_path, created_by)
  values (coalesce(p_code, private.new_referral_code()), v_type, p_org_id, nullif(btrim(coalesce(p_campaign, '')), ''), coalesce(nullif(btrim(p_landing_path), ''), '/'), (select auth.uid()))
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.create_partner_referral_link(uuid, text, text, text) from public, anon;
grant execute on function public.create_partner_referral_link(uuid, text, text, text) to authenticated, service_role;

-- Disable / re-enable a link (owner, org owners/admins, staff).
create or replace function public.set_referral_link_disabled(p_link_id uuid, p_disabled boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.referral_links;
begin
  select * into v_link from public.referral_links where id = p_link_id;
  if v_link.id is null then
    raise exception 'Link not found' using errcode = 'P0001';
  end if;
  if not (private.is_service_role() or (select private.is_platform_staff())
          or (v_link.owner_user_id is not null and v_link.owner_user_id = (select auth.uid()))
          or (v_link.owner_org_id is not null and private.has_org_role(v_link.owner_org_id, '{owner,admin}'))) then
    raise exception 'You cannot change this link' using errcode = '42501';
  end if;
  update public.referral_links set disabled_at = case when p_disabled then coalesce(disabled_at, now()) else null end where id = p_link_id;
end $$;
revoke execute on function public.set_referral_link_disabled(uuid, boolean) from public, anon;
grant execute on function public.set_referral_link_disabled(uuid, boolean) to authenticated, service_role;

-- Distributor owners/admins manage only the widget settings (domains, colour, logo); the
-- commercial fields (segment, categories, revenue share, status) are staff-only.
create or replace function public.update_partner_widget(p_org_id uuid, p_widget_domains text[], p_primary_colour text default null, p_logo_url text default null)
returns public.distribution_partners
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.distribution_partners;
  v_brand jsonb;
begin
  if not (private.is_service_role() or (select private.is_platform_staff()) or private.has_org_role(p_org_id, '{owner,admin}')) then
    raise exception 'Only owners and admins can change the widget' using errcode = '42501';
  end if;
  select * into v_row from public.distribution_partners where org_id = p_org_id;
  if v_row.id is null then
    raise exception 'This organisation is not set up as a distribution partner yet' using errcode = 'P0001';
  end if;
  v_brand := coalesce(v_row.brand, '{}'::jsonb) - 'primary_colour' - 'logo_url';
  if nullif(btrim(coalesce(p_primary_colour, '')), '') is not null then v_brand := v_brand || jsonb_build_object('primary_colour', btrim(p_primary_colour)); end if;
  if nullif(btrim(coalesce(p_logo_url, '')), '') is not null then v_brand := v_brand || jsonb_build_object('logo_url', btrim(p_logo_url)); end if;
  update public.distribution_partners
     set widget_domains = coalesce(p_widget_domains, '{}'), brand = v_brand
   where org_id = p_org_id
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.update_partner_widget(uuid, text[], text, text) from public, anon;
grant execute on function public.update_partner_widget(uuid, text[], text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Seed rules (inactive customer inducement; partner share active — it is a
--    commercial agreement from Covva's own fee, not an inducement to the customer).
-- ---------------------------------------------------------------------------
insert into public.reward_rules (key, kind, amount, conditions, active, description, regulatory_note) values
  ('customer_referral', 'referral_credit', 20,
   '{"min_premium": 0, "categories": [], "first_policy_only": true, "holding_days": 14, "friend_amount": 20, "owner_kinds": ["customer"], "expiry_days": 365}'::jsonb,
   false,
   'GHS 20 credit to the referrer and GHS 20 to the friend once the friend''s first policy has been active for 14 days. Credits are not cash: they are redeemable only as a discount on Covva platform fees, or on a future premium where the insurer funds the discount.',
   'Referral rewards can be an inducement to buy insurance. Keep this rule inactive until the National Insurance Commission position is confirmed and every participating insurer has approved it in writing. Rewards must never change which insurer or product is shown, nor the order of comparison results.'),
  ('partner_revenue_share', 'partner_revenue_share', 0,
   '{"holding_days": 14, "owner_kinds": ["distributor"]}'::jsonb,
   true,
   'Distributor revenue share: distribution_partners.revenue_share_pct of Covva''s platform fee on each converted policy, accrued after 14 days active and settled by statement.',
   'Paid from Covva''s own platform fee under the partner agreement — never from the premium, which settles to the insurer. Distributors may not advise or arrange cover.')
on conflict (key) do nothing;
