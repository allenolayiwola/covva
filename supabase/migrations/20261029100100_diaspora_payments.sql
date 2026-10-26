-- =============================================================================
-- Diaspora payments (roadmap Phase 2 "Diaspora core" + Phase 4 advanced diaspora):
-- multi-currency display with transparent FX, settlement in GHS to the insurer,
-- recurring sponsor payments, product bundles, property cover with inspections and
-- photo updates, and a placeholder for remittance / diaspora-bank partner APIs.
--
-- Additive only: no drops, no deletes. Every statement is idempotent so the file can
-- be re-applied next to the concurrently built diaspora data model (beneficiaries,
-- sponsorships, households, policies.sponsor_user_id, requests.beneficiary_id), which
-- this migration never creates and references only through runtime-guarded helpers.
--
-- Money invariants kept from 20261026120100 (payments_guard) and the ledger:
--   * `payments.amount` / `payments.currency` stay the GHS contract amount the INSURER
--     receives. The display_* columns are what the payer saw in their own currency.
--   * Covva never holds client funds. A foreign-currency card is charged for the GHS
--     amount by the PSP (Paystack international); the Stripe path is OFF by default
--     because the PSP would receive foreign currency before the insurer is paid
--     (needs a legal view — see docs/OPERATIONS.md).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Runtime-guarded helper: is the caller the sponsor of a policy?
--    `policies.sponsor_user_id` belongs to the diaspora data-model migration. The check
--    is evaluated with dynamic SQL so this file applies before or after that column
--    exists and starts honouring it the moment it appears.
-- ---------------------------------------------------------------------------
create or replace function private.is_policy_sponsor(p_policy uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v boolean := false;
begin
  if p_policy is null then
    return false;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'policies' and column_name = 'sponsor_user_id'
  ) then
    execute 'select exists (select 1 from public.policies p where p.id = $1 and p.sponsor_user_id = (select auth.uid()))'
      into v using p_policy;
  end if;
  return coalesce(v, false);
end $$;
comment on function private.is_policy_sponsor(uuid) is 'True when the caller sponsors the policy (policies.sponsor_user_id); false until the diaspora data model adds that column.';

-- ---------------------------------------------------------------------------
-- 1. FX rates (GHS per 1 unit of the quote currency)
-- ---------------------------------------------------------------------------
create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  base char(3) not null default 'GHS',
  quote char(3) not null,
  -- GHS per 1 unit of `quote` (e.g. GBP 20.5 → 1 GBP = GH₵ 20.50)
  rate numeric(18, 8) not null,
  source text not null default 'manual',
  fetched_at timestamptz not null default now(),
  valid_until timestamptz,
  created_by uuid references auth.users (id),
  note text,
  created_at timestamptz not null default now(),
  unique (quote, fetched_at)
);
comment on table public.fx_rates is 'Indicative FX rates used to DISPLAY a GHS premium in the payer''s currency. The GHS amount is always the contract amount the insurer receives; the PSP applies its own rate at charge time.';
comment on column public.fx_rates.rate is 'GHS per 1 unit of quote.';
comment on column public.fx_rates.source is 'manual (admin override, flagged in the UI) | openexchangerates | bog (Bank of Ghana, stub) | provider (the PSP''s own rate).';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fx_rates_rate_positive') then
    alter table public.fx_rates add constraint fx_rates_rate_positive check (rate > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fx_rates_source_check') then
    alter table public.fx_rates add constraint fx_rates_source_check check (source in ('manual', 'openexchangerates', 'bog', 'provider'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fx_rates_base_check') then
    alter table public.fx_rates add constraint fx_rates_base_check check (base = 'GHS');
  end if;
end $$;
create index if not exists fx_rates_quote_fetched_idx on public.fx_rates (quote, fetched_at desc);

-- Latest rate for a currency (the newest fetched row, regardless of source).
create or replace function public.latest_fx_rate(p_quote char(3)) returns setof public.fx_rates
language sql stable security invoker set search_path = '' as $$
  select * from public.fx_rates where quote = upper(p_quote) order by fetched_at desc limit 1;
$$;
comment on function public.latest_fx_rate(char) is 'Newest fx_rates row for a quote currency (GHS per 1 unit). Indicative only.';

alter table public.fx_rates enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'fx rates: public read') then
    create policy "fx rates: public read" on public.fx_rates for select to anon, authenticated using (true);
  end if;
  -- Manual overrides by platform staff only (audited); provider refreshes use the service role.
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'fx rates: staff insert') then
    create policy "fx rates: staff insert" on public.fx_rates for insert to authenticated
      with check ((select private.is_platform_staff()) and source = 'manual');
  end if;
end $$;
-- No update/delete policies: rates are append-only history.

-- Seed: the static indicative table from apps/web/src/components/marketing/content.ts, clearly
-- flagged manual. Replace with a live provider (cron `fx-rates`) before launch.
insert into public.fx_rates (base, quote, rate, source, fetched_at, note)
select 'GHS', v.quote, v.rate, 'manual', timestamptz '2026-10-01 00:00:00+00', 'Seed — indicative October 2026 rate from the marketing site. Replace with a live provider.'
from (values ('GHS', 1.00000000), ('GBP', 20.50000000), ('USD', 15.60000000), ('EUR', 17.40000000), ('CAD', 11.40000000)) as v (quote, rate)
where not exists (select 1 from public.fx_rates f where f.quote = v.quote);

-- Platform settings used by the FX and collections code (safe defaults).
insert into public.platform_settings (key, value, description)
values
  ('fx', '{"margin_pct": 0, "provider": "manual"}'::jsonb, 'FX display: platform margin % added to the indicative rate (shown to the payer) and the rate provider (manual | openexchangerates | bog).'),
  ('payments.grace_days', '14'::jsonb, 'Days a policy paid by sponsor subscription stays in force after a failed collection before the insurer is asked to decide (grace period).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Payments: display currency and PSP
-- ---------------------------------------------------------------------------
alter table public.payments add column if not exists display_currency char(3);
alter table public.payments add column if not exists display_amount numeric(14, 2);
alter table public.payments add column if not exists fx_rate numeric(18, 8);
alter table public.payments add column if not exists fx_source text;
alter table public.payments add column if not exists fx_quoted_at timestamptz;
alter table public.payments add column if not exists psp text;
comment on column public.payments.display_currency is 'Currency the payer chose to see (GHS, GBP, USD, EUR, CAD). amount/currency stay the GHS contract amount.';
comment on column public.payments.display_amount is 'Indicative amount shown in display_currency at checkout (GHS amount ÷ fx_rate, incl. the platform FX margin). The card issuer / PSP applies the final rate.';
comment on column public.payments.fx_rate is 'GHS per 1 unit of display_currency used for the indicative display (null for GHS).';
comment on column public.payments.psp is 'Payment service provider that took the money: paystack_intl (foreign card, settles GHS) | stripe (off by default) | paystack | hubtel | simulator | bank_transfer.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_psp_check') then
    alter table public.payments add constraint payments_psp_check
      check (psp is null or psp in ('paystack_intl', 'stripe', 'paystack', 'hubtel', 'simulator', 'bank_transfer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_display_currency_check') then
    alter table public.payments add constraint payments_display_currency_check
      check (display_currency is null or display_currency in ('GHS', 'GBP', 'USD', 'EUR', 'CAD'));
  end if;
end $$;

-- Saved payment methods: PSP token / customer references only. Never a PAN, CVV or full expiry
-- date beyond month/year. Written by the server after a successful charge the payer agreed to reuse.
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  psp text not null,
  -- PSP references only (Paystack customer_code + authorization_code; Stripe customer + payment_method id)
  provider_customer_ref text,
  provider_token_ref text not null,
  brand text,
  last4 char(4),
  exp_month smallint,
  exp_year smallint,
  billing_country char(2),
  currency char(3),
  is_default boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, psp, provider_token_ref)
);
comment on table public.payment_methods is 'Reusable card authorisations by PSP token reference (never card numbers). Used for sponsor subscriptions.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_methods_psp_check') then
    alter table public.payment_methods add constraint payment_methods_psp_check check (psp in ('paystack_intl', 'stripe', 'paystack', 'simulator'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_methods_status_check') then
    alter table public.payment_methods add constraint payment_methods_status_check check (status in ('active', 'expired', 'revoked'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_methods_last4_check') then
    alter table public.payment_methods add constraint payment_methods_last4_check check (last4 is null or last4 ~ '^[0-9]{4}$');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.payment_methods'::regclass) then
    create trigger set_updated_at before update on public.payment_methods for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists payment_methods_user_idx on public.payment_methods (user_id, is_default desc, created_at desc);

alter table public.payment_methods enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'payment methods: own read') then
    create policy "payment methods: own read" on public.payment_methods for select to authenticated
      using (user_id = (select auth.uid()) or (select private.is_platform_staff()));
  end if;
end $$;
-- Writes (save after a charge, revoke, default) go through the server (service role) after checks.

-- ---------------------------------------------------------------------------
-- 3. Sponsor subscriptions (recurring premium collections paid by a sponsor abroad)
-- ---------------------------------------------------------------------------
create table if not exists public.sponsor_subscriptions (
  id uuid primary key default gen_random_uuid(),
  sponsor_user_id uuid not null references auth.users (id) on delete cascade,
  policy_id uuid references public.policies (id),
  request_id uuid references public.requests (id),
  application_id uuid references public.applications (id),
  -- Beneficiary from the diaspora data model (no FK: that table is built concurrently).
  beneficiary_id uuid,
  cadence text not null default 'monthly',
  display_currency char(3) not null default 'GHS',
  display_amount numeric(14, 2) not null default 0,
  -- Contract amount per charge, settled to the insurer in GHS.
  ghs_amount numeric(14, 2) not null,
  fx_rate numeric(18, 8),
  fx_source text,
  payment_method_id uuid references public.payment_methods (id),
  psp text not null default 'simulator',
  psp_subscription_ref text,
  status text not null default 'active',
  next_charge_at timestamptz not null default now(),
  last_charged_at timestamptz,
  past_due_since timestamptz,
  paused_at timestamptz,
  cancelled_at timestamptz,
  failures integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.sponsor_subscriptions is 'A sponsor''s standing instruction to pay a policy''s premium on a cadence. Each collection creates a payments row (GHS, payee = insurer); Covva never holds the money.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sponsor_subscriptions_cadence_check') then
    alter table public.sponsor_subscriptions add constraint sponsor_subscriptions_cadence_check check (cadence in ('monthly', 'quarterly', 'annual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sponsor_subscriptions_status_check') then
    alter table public.sponsor_subscriptions add constraint sponsor_subscriptions_status_check check (status in ('active', 'past_due', 'paused', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sponsor_subscriptions_psp_check') then
    alter table public.sponsor_subscriptions add constraint sponsor_subscriptions_psp_check check (psp in ('paystack_intl', 'stripe', 'paystack', 'hubtel', 'simulator'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sponsor_subscriptions_currency_check') then
    alter table public.sponsor_subscriptions add constraint sponsor_subscriptions_currency_check check (display_currency in ('GHS', 'GBP', 'USD', 'EUR', 'CAD'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sponsor_subscriptions_amount_check') then
    alter table public.sponsor_subscriptions add constraint sponsor_subscriptions_amount_check check (ghs_amount > 0 and display_amount >= 0);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.sponsor_subscriptions'::regclass) then
    create trigger set_updated_at before update on public.sponsor_subscriptions for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists sponsor_subscriptions_sponsor_idx on public.sponsor_subscriptions (sponsor_user_id, created_at desc);
create index if not exists sponsor_subscriptions_due_idx on public.sponsor_subscriptions (next_charge_at) where status in ('active', 'past_due');
create index if not exists sponsor_subscriptions_policy_idx on public.sponsor_subscriptions (policy_id);

create table if not exists public.subscription_charges (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.sponsor_subscriptions (id) on delete cascade,
  payment_id uuid references public.payments (id),
  attempt integer not null default 1,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_charges_status_check') then
    alter table public.subscription_charges add constraint subscription_charges_status_check check (status in ('pending', 'succeeded', 'failed', 'skipped'));
  end if;
end $$;
create index if not exists subscription_charges_sub_idx on public.subscription_charges (subscription_id, created_at desc);

alter table public.sponsor_subscriptions enable row level security;
alter table public.subscription_charges enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'sponsor subscriptions: sponsor read') then
    create policy "sponsor subscriptions: sponsor read" on public.sponsor_subscriptions for select to authenticated
      using (sponsor_user_id = (select auth.uid()) or (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'sponsor subscriptions: staff write') then
    create policy "sponsor subscriptions: staff write" on public.sponsor_subscriptions for update to authenticated
      using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'subscription charges: sponsor read') then
    create policy "subscription charges: sponsor read" on public.subscription_charges for select to authenticated
      using (
        (select private.is_platform_staff())
        or exists (select 1 from public.sponsor_subscriptions s where s.id = subscription_id and s.sponsor_user_id = (select auth.uid()))
      );
  end if;
end $$;
-- Creation, pause/cancel and collections are server actions (service role) after authorisation checks.

-- ---------------------------------------------------------------------------
-- 4. Product bundles (e.g. "Parents' Care Pack")
-- ---------------------------------------------------------------------------
create table if not exists public.product_bundles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  audience text not null default 'diaspora',
  -- [{ category_slug, product_code?, required }]
  items jsonb not null default '[]'::jsonb,
  discount_pct numeric(5, 2) not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.product_bundles is 'Curated packages of cover types. A bundle creates one request per item (requests.bundle_id); each is quoted by the participating insurer and the discount is applied to the bundle quote only when the insurer catalogue supports it.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_bundles_audience_check') then
    alter table public.product_bundles add constraint product_bundles_audience_check check (audience in ('diaspora', 'sme', 'individual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_bundles_status_check') then
    alter table public.product_bundles add constraint product_bundles_status_check check (status in ('draft', 'published'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_bundles_discount_check') then
    alter table public.product_bundles add constraint product_bundles_discount_check check (discount_pct >= 0 and discount_pct <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_bundles_items_array') then
    alter table public.product_bundles add constraint product_bundles_items_array check (jsonb_typeof(items) = 'array');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.product_bundles'::regclass) then
    create trigger set_updated_at before update on public.product_bundles for each row execute function private.set_updated_at();
  end if;
end $$;

alter table public.product_bundles enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'bundles: public read published') then
    create policy "bundles: public read published" on public.product_bundles for select to anon, authenticated
      using (status = 'published' or (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'bundles: staff write') then
    create policy "bundles: staff write" on public.product_bundles for all to authenticated
      using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));
  end if;
end $$;

insert into public.product_bundles (slug, name, description, audience, items, discount_pct, status)
values (
  'parents-care-pack',
  'Parents'' Care Pack',
  'Funeral cover for both parents plus a private health plan, and optional cover for the family home — quoted together by a participating broker and paid as one monthly or annual amount by the sponsor abroad.',
  'diaspora',
  '[{"category_slug": "life-funeral", "required": false}, {"category_slug": "health", "required": false}, {"category_slug": "home", "required": false}]'::jsonb,
  0,
  'published'
)
on conflict (slug) do nothing;

alter table public.requests add column if not exists bundle_id uuid references public.product_bundles (id);
comment on column public.requests.bundle_id is 'Set when the request was created as part of a product bundle; sibling requests share the bundle_id.';
create index if not exists requests_bundle_idx on public.requests (bundle_id) where bundle_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Property cover: inspections and construction photo updates
-- ---------------------------------------------------------------------------
create table if not exists public.property_inspections (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.policies (id),
  request_id uuid references public.requests (id),
  requested_by uuid references auth.users (id),
  address text,
  gps jsonb,
  status text not null default 'requested',
  -- Inspection partner (an organisation with settings.inspection_partner = true)
  partner_org_id uuid references public.organizations (id),
  scheduled_for timestamptz,
  completed_at timestamptz,
  report jsonb,
  -- [{ storage_path, taken_at, caption }]
  photos jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.property_inspections is 'Site inspections for property cover (homes being built or owned in Ghana), carried out by an inspection partner. The insurer decides what the report means for cover.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'property_inspections_status_check') then
    alter table public.property_inspections add constraint property_inspections_status_check check (status in ('requested', 'assigned', 'scheduled', 'completed', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'property_inspections_target_check') then
    alter table public.property_inspections add constraint property_inspections_target_check check (policy_id is not null or request_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'property_inspections_photos_array') then
    alter table public.property_inspections add constraint property_inspections_photos_array check (jsonb_typeof(photos) = 'array');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.property_inspections'::regclass) then
    create trigger set_updated_at before update on public.property_inspections for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists property_inspections_policy_idx on public.property_inspections (policy_id);
create index if not exists property_inspections_partner_idx on public.property_inspections (partner_org_id, status);

create table if not exists public.property_updates (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies (id),
  storage_path text not null,
  caption text,
  taken_at timestamptz,
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
comment on table public.property_updates is 'Photo updates from the site during construction, uploaded by the customer in Ghana or the sponsor abroad (private documents bucket).';
create index if not exists property_updates_policy_idx on public.property_updates (policy_id, created_at desc);

-- Who may act on a property record: the policy customer, its sponsor, or (via request) the request customer.
create or replace function private.can_manage_property(p_policy uuid, p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_policy is not null and (
            exists (select 1 from public.policies p where p.id = p_policy and p.customer_id = (select auth.uid()))
            or private.is_policy_sponsor(p_policy)))
      or (p_request is not null and private.is_request_customer(p_request));
$$;

alter table public.property_inspections enable row level security;
alter table public.property_updates enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'property inspections: parties read') then
    create policy "property inspections: parties read" on public.property_inspections for select to authenticated
      using (
        (select private.is_platform_staff())
        or private.can_manage_property(policy_id, request_id)
        or (policy_id is not null and private.can_access_policy(policy_id))
        or (request_id is not null and private.can_access_request(request_id))
        or partner_org_id in (select private.user_org_ids())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'property inspections: customer or sponsor requests') then
    create policy "property inspections: customer or sponsor requests" on public.property_inspections for insert to authenticated
      with check (status = 'requested' and partner_org_id is null and requested_by = (select auth.uid()) and private.can_manage_property(policy_id, request_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'property inspections: partner updates assigned') then
    create policy "property inspections: partner updates assigned" on public.property_inspections for update to authenticated
      using (partner_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))
      with check (partner_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'property updates: parties read') then
    create policy "property updates: parties read" on public.property_updates for select to authenticated
      using ((select private.is_platform_staff()) or private.can_manage_property(policy_id, null) or private.can_access_policy(policy_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'property updates: customer or sponsor uploads') then
    create policy "property updates: customer or sponsor uploads" on public.property_updates for insert to authenticated
      with check (uploaded_by = (select auth.uid()) and private.can_manage_property(policy_id, null));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Remittance / diaspora-bank partner placeholder (no UI beyond the admin list)
-- ---------------------------------------------------------------------------
create table if not exists public.remittance_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  kind text not null default 'embedded_partner',
  -- sha256 of the partner's API key; the key itself is shown once and never stored.
  api_key_hash text,
  webhook_url text,
  status text not null default 'draft',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.remittance_partners is 'Future partner integrations (remittance providers, diaspora banks, embedded partners) that will quote and collect through the API. Placeholder: documented, no customer UI yet.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'remittance_partners_kind_check') then
    alter table public.remittance_partners add constraint remittance_partners_kind_check check (kind in ('remittance', 'diaspora_bank', 'embedded_partner'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'remittance_partners_status_check') then
    alter table public.remittance_partners add constraint remittance_partners_status_check check (status in ('draft', 'active', 'suspended'));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.remittance_partners'::regclass) then
    create trigger set_updated_at before update on public.remittance_partners for each row execute function private.set_updated_at();
  end if;
end $$;
alter table public.remittance_partners enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'remittance partners: staff all') then
    create policy "remittance partners: staff all" on public.remittance_partners for all to authenticated
      using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Audit triggers (hash-chained audit log) on the regulated records added here
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fx_rates', 'payment_methods', 'sponsor_subscriptions', 'product_bundles', 'property_inspections', 'remittance_partners'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;
