-- =============================================================================
-- Phase 3 — Endorsements, accounting exports / tax rules, partner self-onboarding
-- and ratings. Additive only: no drops, no deletes; every object is guarded.
--
-- * endorsements                 — structured mid-term changes (change vehicle, add driver, …) on an
--                                  active policy. The customer (or broker of record) proposes, the broker
--                                  or insurer quotes the premium adjustment, the customer agrees (and pays
--                                  any additional premium to the insurer), and ONLY THE INSURER accepts,
--                                  rejects and applies the change to the policy (endorsements_guard).
-- * tax_rules                    — VAT / NHIL / GETFund / COVID levy / NIC levy / Fire Service levy.
--                                  Rates are NOT hard-coded: seeded rows have rate null and status
--                                  'needs_confirmation' until finance / a tax adviser confirms them.
-- * tax_entries                  — tax lines computed from ledger entries for ACTIVE rules only. The
--                                  ledger_entries.entry_type check (ledger_entries_entry_type_check)
--                                  does not allow 'tax' and is left untouched (non-destructive option):
--                                  tax lines live here, one per (ledger entry, tax code), append-only.
-- * accounting_exports           — generated CSVs (insurer statement, commission, tax, platform revenue,
--                                  Xero / QuickBooks / Sage) in the private documents bucket.
-- * service_partner_applications — public self-onboarding for garages, towing, hospitals, clinics,
--                                  pharmacies and assessors (written by a server action with the service
--                                  role; staff review creates the service_partners row).
-- * service_partner_reviews      — one rating per completed claim job; service_partners.rating is the
--                                  average of published reviews once there are at least 3.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Endorsements
-- ---------------------------------------------------------------------------
create sequence if not exists public.endorsement_ref_seq start 1001;
grant usage, select on sequence public.endorsement_ref_seq to authenticated, service_role;

create table if not exists public.endorsements (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('END-' || nextval('public.endorsement_ref_seq')::text),
  policy_id uuid not null references public.policies (id),
  request_id uuid references public.requests (id) on delete set null,
  customer_id uuid not null references auth.users (id),
  insurer_org_id uuid not null references public.organizations (id),
  broker_org_id uuid references public.organizations (id),
  kind text not null,
  -- Structured before/after: { before: {...}, after: {...}, summary?: [...] }
  changes jsonb not null default '{}'::jsonb,
  effective_from date not null default current_date,
  status text not null default 'draft',
  -- Positive = additional premium; negative = refund. Set by the broker or insurer (quote).
  premium_adjustment numeric(14, 2),
  -- Indicative pro-rata adjustment from the rating engine at submission (never binding).
  proposed_adjustment numeric(14, 2),
  currency char(3) not null default 'GHS',
  -- Underwriting rules re-run for the changed risk: { outcome, reasons, rules }.
  underwriting jsonb,
  adjustment_payment_id uuid references public.payments (id) on delete set null,
  refund_status text,
  insurer_note text,
  broker_note text,
  quoted_by uuid references auth.users (id),
  quoted_at timestamptz,
  customer_accepted_at timestamptz,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  applied_by uuid references auth.users (id),
  applied_at timestamptz,
  cancelled_reason text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.endorsements is 'Mid-term changes to a policy. Only the insurer accepts, rejects and applies a change (endorsements_guard). premium_adjustment: positive = additional premium paid to the insurer, negative = refund.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'endorsements_kind_check') then
    alter table public.endorsements add constraint endorsements_kind_check check (kind in (
      'change_vehicle', 'add_driver', 'remove_driver', 'change_address', 'change_sum_insured',
      'add_member', 'remove_member', 'change_use', 'cancel_policy', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'endorsements_status_check') then
    alter table public.endorsements add constraint endorsements_status_check check (status in ('draft', 'submitted', 'quoted', 'accepted', 'rejected', 'applied', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'endorsements_refund_status_check') then
    alter table public.endorsements add constraint endorsements_refund_status_check check (refund_status is null or refund_status in ('not_needed', 'requested', 'manual', 'processed'));
  end if;
end $$;
create index if not exists endorsements_policy_idx on public.endorsements (policy_id, created_at desc);
create index if not exists endorsements_customer_idx on public.endorsements (customer_id, created_at desc);
create index if not exists endorsements_insurer_idx on public.endorsements (insurer_org_id, status);
create index if not exists endorsements_broker_idx on public.endorsements (broker_org_id, status) where broker_org_id is not null;
create index if not exists endorsements_request_idx on public.endorsements (request_id) where request_id is not null;

-- Who may do what. Party fields come from the policy (never from the caller); only the insurer
-- (underwriting roles) or the service role accepts / rejects / applies.
create or replace function private.endorsements_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_service boolean := private.is_service_role();
  v_policy public.policies;
  v_insurer boolean;
  v_broker boolean;
  v_customer boolean;
  v_staff boolean := private.is_platform_staff();
  v_paid boolean;
begin
  if tg_op = 'INSERT' then
    select * into v_policy from public.policies where id = new.policy_id;
    if v_policy.id is null then
      raise exception 'Policy not found' using errcode = 'P0001';
    end if;
    new.customer_id := v_policy.customer_id;
    new.insurer_org_id := v_policy.insurer_org_id;
    new.broker_org_id := v_policy.broker_org_id;
    new.currency := coalesce(v_policy.currency, 'GHS');
    new.created_by := coalesce(new.created_by, v_uid);
    if v_service then
      return new;
    end if;
    if v_policy.external_source then
      raise exception 'Changes to a policy bought elsewhere go to that insurer directly' using errcode = 'P0001';
    end if;
    if v_policy.status <> 'active' then
      raise exception 'Only an active policy can be changed (this one is %)', replace(v_policy.status::text, '_', ' ') using errcode = 'P0001';
    end if;
    if not (v_policy.customer_id = v_uid or private.is_org_member(v_policy.broker_org_id) or v_staff) then
      raise exception 'Only the policyholder or the broker of record can ask for a change' using errcode = 'P0001';
    end if;
    if new.status not in ('draft', 'submitted') then
      raise exception 'A new change starts as a draft or is submitted' using errcode = 'P0001';
    end if;
    new.premium_adjustment := null; new.adjustment_payment_id := null; new.refund_status := null;
    new.insurer_note := null; new.quoted_by := null; new.quoted_at := null; new.customer_accepted_at := null;
    new.decided_by := null; new.decided_at := null; new.applied_by := null; new.applied_at := null;
    return new;
  end if;

  -- UPDATE --------------------------------------------------------------------
  if new.policy_id is distinct from old.policy_id or new.customer_id is distinct from old.customer_id
     or new.insurer_org_id is distinct from old.insurer_org_id or new.broker_org_id is distinct from old.broker_org_id
     or new.reference is distinct from old.reference or new.created_at is distinct from old.created_at then
    if not v_service then
      raise exception 'The policy and parties of a change cannot be altered' using errcode = 'P0001';
    end if;
  end if;

  v_insurer := v_service or private.has_org_role(old.insurer_org_id, '{owner,admin,underwriter}');
  v_broker := private.is_org_member(old.broker_org_id);
  v_customer := old.customer_id = v_uid;

  -- Server-only fields (payment link, refund progress, underwriting result).
  if not v_service and (new.adjustment_payment_id is distinct from old.adjustment_payment_id
     or new.refund_status is distinct from old.refund_status
     or new.underwriting is distinct from old.underwriting
     or new.proposed_adjustment is distinct from old.proposed_adjustment) then
    raise exception 'Payment, refund and underwriting details are recorded by the platform' using errcode = 'P0001';
  end if;

  -- Decision fields: insurer only.
  if not v_insurer and (new.insurer_note is distinct from old.insurer_note or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at or new.applied_at is distinct from old.applied_at or new.applied_by is distinct from old.applied_by) then
    raise exception 'Only the insurer records its decision on a change' using errcode = 'P0001';
  end if;

  -- The adjustment is quoted by the broker of record or the insurer, while the change is open.
  if new.premium_adjustment is distinct from old.premium_adjustment then
    if not (v_insurer or v_broker) then
      raise exception 'Only the broker or the insurer can quote a premium adjustment' using errcode = 'P0001';
    end if;
    if old.status not in ('submitted', 'quoted') then
      raise exception 'A % change cannot be re-quoted', old.status using errcode = 'P0001';
    end if;
    -- A new price needs the customer's agreement again.
    new.customer_accepted_at := null;
  end if;

  -- What the customer may edit: the details while draft (or submitted, before a quote).
  if not (v_insurer or v_broker or v_staff) then
    if not v_customer then
      raise exception 'You cannot change this request' using errcode = 'P0001';
    end if;
    if (new.kind is distinct from old.kind or new.changes is distinct from old.changes or new.effective_from is distinct from old.effective_from)
       and old.status not in ('draft', 'submitted') then
      raise exception 'The details can no longer be edited — ask your broker' using errcode = 'P0001';
    end if;
    if new.broker_note is distinct from old.broker_note or new.quoted_by is distinct from old.quoted_by or new.quoted_at is distinct from old.quoted_at then
      raise exception 'Only the broker or insurer can add a quote note' using errcode = 'P0001';
    end if;
    if new.customer_accepted_at is distinct from old.customer_accepted_at and (old.status <> 'quoted' or new.customer_accepted_at is null) then
      raise exception 'You can agree to the price once the change has been quoted' using errcode = 'P0001';
    end if;
  elsif new.customer_accepted_at is distinct from old.customer_accepted_at and new.customer_accepted_at is not null and not v_service and not v_customer then
    raise exception 'Only the policyholder agrees to the price of a change' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    case new.status
      when 'submitted' then
        if old.status <> 'draft' then
          raise exception 'Only a draft can be submitted' using errcode = 'P0001';
        end if;
        if not (v_customer or v_broker or v_service or v_staff) then
          raise exception 'Only the policyholder or broker submits a change' using errcode = 'P0001';
        end if;
      when 'quoted' then
        if old.status not in ('submitted', 'quoted') then
          raise exception 'Only a submitted change can be quoted' using errcode = 'P0001';
        end if;
        if not (v_insurer or v_broker) then
          raise exception 'Only the broker or the insurer can quote a change' using errcode = 'P0001';
        end if;
        if new.premium_adjustment is null then
          raise exception 'Set the premium adjustment (0 when there is no change in premium)' using errcode = 'P0001';
        end if;
        new.quoted_at := now();
        new.quoted_by := coalesce(v_uid, new.quoted_by);
      when 'accepted', 'rejected' then
        if not v_insurer then
          raise exception 'Only the insurer can accept or reject a change to cover' using errcode = 'P0001';
        end if;
        if old.status not in ('submitted', 'quoted') then
          raise exception 'A % change cannot be decided', old.status using errcode = 'P0001';
        end if;
        if new.status = 'accepted' then
          new.premium_adjustment := coalesce(new.premium_adjustment, 0);
          if new.premium_adjustment <> 0 and new.customer_accepted_at is null then
            raise exception 'The customer must agree to the premium adjustment before the insurer accepts the change' using errcode = 'P0001';
          end if;
        end if;
        new.decided_at := now();
        new.decided_by := coalesce(v_uid, new.decided_by);
      when 'applied' then
        if not v_insurer then
          raise exception 'Only the insurer can apply a change to the policy' using errcode = 'P0001';
        end if;
        if old.status <> 'accepted' then
          raise exception 'Only an accepted change can be applied' using errcode = 'P0001';
        end if;
        if coalesce(new.premium_adjustment, 0) > 0 then
          select exists (select 1 from public.payments p where p.id = new.adjustment_payment_id and p.status = 'succeeded') into v_paid;
          if not coalesce(v_paid, false) then
            raise exception 'The additional premium has not been paid yet' using errcode = 'P0001';
          end if;
        end if;
        new.applied_at := now();
        new.applied_by := coalesce(v_uid, new.applied_by);
      when 'cancelled' then
        if old.status not in ('draft', 'submitted', 'quoted') then
          raise exception 'A % change cannot be withdrawn', old.status using errcode = 'P0001';
        end if;
        if not (v_customer or v_broker or v_insurer or v_staff) then
          raise exception 'You cannot withdraw this change' using errcode = 'P0001';
        end if;
      when 'draft' then
        raise exception 'A change cannot go back to draft' using errcode = 'P0001';
      else
        null;
    end case;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'endorsements_guard' and tgrelid = 'public.endorsements'::regclass) then
    create trigger endorsements_guard before insert or update on public.endorsements
      for each row execute function private.endorsements_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.endorsements'::regclass) then
    create trigger set_updated_at before update on public.endorsements for each row execute function private.set_updated_at();
  end if;
end $$;

alter table public.endorsements enable row level security;
select private.ensure_policy('endorsements', 'endorsements: parties read', $p$
  create policy "endorsements: parties read" on public.endorsements for select to authenticated
  using (
    customer_id = (select auth.uid())
    or private.is_org_member(broker_org_id)
    or private.is_org_member(insurer_org_id)
    or (select private.is_platform_staff())
  )$p$);
select private.ensure_policy('endorsements', 'endorsements: policyholder or broker create', $p$
  create policy "endorsements: policyholder or broker create" on public.endorsements for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    or private.is_org_member(broker_org_id)
    or (select private.is_platform_staff())
  )$p$);
-- Customers: open changes only; broker of record: until the insurer decides; insurer: always
-- (the guard decides which fields and statuses each party may set).
select private.ensure_policy('endorsements', 'endorsements: parties update', $p$
  create policy "endorsements: parties update" on public.endorsements for update to authenticated
  using (
    (customer_id = (select auth.uid()) and status in ('draft', 'submitted', 'quoted'))
    or (private.is_org_member(broker_org_id) and status in ('draft', 'submitted', 'quoted'))
    or private.is_org_member(insurer_org_id)
    or (select private.is_platform_staff())
  )
  with check (
    customer_id = (select auth.uid())
    or private.is_org_member(broker_org_id)
    or private.is_org_member(insurer_org_id)
    or (select private.is_platform_staff())
  )$p$);

-- ---------------------------------------------------------------------------
-- 2. Tax rules (rates need confirmation) and tax lines
-- ---------------------------------------------------------------------------
create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  applies_to text not null,
  -- Percentage (e.g. 15 = 15%). Null until finance confirms it.
  rate numeric(7, 4),
  -- true: the base amount already includes the tax (tax = base × rate / (100 + rate)).
  inclusive boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'needs_confirmation',
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.tax_rules is 'VAT and levies applied to platform fees, broker commission, premiums or subscriptions. rate is a percentage; rules with status needs_confirmation are never applied.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tax_rules_applies_to_check') then
    alter table public.tax_rules add constraint tax_rules_applies_to_check check (applies_to in ('platform_fee', 'broker_commission', 'premium', 'subscription'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tax_rules_status_check') then
    alter table public.tax_rules add constraint tax_rules_status_check check (status in ('needs_confirmation', 'active', 'retired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tax_rules_rate_check') then
    alter table public.tax_rules add constraint tax_rules_rate_check check (rate is null or (rate >= 0 and rate <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tax_rules_active_rate_check') then
    alter table public.tax_rules add constraint tax_rules_active_rate_check check (status <> 'active' or rate is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tax_rules_dates_check') then
    alter table public.tax_rules add constraint tax_rules_dates_check check (effective_to is null or effective_to >= effective_from);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.tax_rules'::regclass) then
    create trigger set_updated_at before update on public.tax_rules for each row execute function private.set_updated_at();
  end if;
end $$;

create or replace function private.tax_rules_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active' or old.rate is distinct from new.rate) then
    new.confirmed_by := coalesce((select auth.uid()), new.confirmed_by);
    new.confirmed_at := now();
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tax_rules_before' and tgrelid = 'public.tax_rules'::regclass) then
    create trigger tax_rules_before before insert or update on public.tax_rules for each row execute function private.tax_rules_before();
  end if;
end $$;

alter table public.tax_rules enable row level security;
select private.ensure_policy('tax_rules', 'tax rules: signed-in read', $p$
  create policy "tax rules: signed-in read" on public.tax_rules for select to authenticated using (true)$p$);
select private.ensure_policy('tax_rules', 'tax rules: staff insert', $p$
  create policy "tax rules: staff insert" on public.tax_rules for insert to authenticated with check ((select private.is_platform_staff()))$p$);
select private.ensure_policy('tax_rules', 'tax rules: staff update', $p$
  create policy "tax rules: staff update" on public.tax_rules for update to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- Seed: no rates. Finance / the tax adviser confirms each rate and base before activation.
insert into public.tax_rules (code, name, applies_to, rate, inclusive, status, description) values
  ('VAT', 'Value Added Tax', 'platform_fee', null, false, 'needs_confirmation',
   'Most insurance premiums are VAT-exempt in Ghana, but platform and broker fees may be VATable. Confirm the rate, the base (platform fee, broker commission, subscriptions) and whether Covva is VAT-registered with the finance team / tax adviser before activating.'),
  ('NHIL', 'National Health Insurance Levy', 'platform_fee', null, false, 'needs_confirmation',
   'Levied alongside VAT on VATable supplies. Insurance premiums are generally exempt. Confirm the rate and whether it applies to Covva''s fees with the finance team / tax adviser.'),
  ('GETFUND', 'GETFund Levy', 'platform_fee', null, false, 'needs_confirmation',
   'Ghana Education Trust Fund levy on VATable supplies. Confirm the rate and base with the finance team / tax adviser; do not apply to premiums unless advised.'),
  ('COVID_LEVY', 'COVID-19 Health Recovery Levy', 'platform_fee', null, false, 'needs_confirmation',
   'Levy on VATable supplies (subject to change in each budget). Confirm whether it is still in force, its rate and base with the finance team / tax adviser.'),
  ('NIC_LEVY', 'NIC premium levy', 'premium', null, false, 'needs_confirmation',
   'Regulatory levy on premiums collected by insurers (remitted by the insurer, not Covva). Record only for reporting; confirm the rate and who remits it with the finance team / tax adviser.'),
  ('FIRE_SERVICE_LEVY', 'Ghana National Fire Service levy', 'premium', null, false, 'needs_confirmation',
   'Levy on fire / property premiums collected by insurers. Confirm the rate, the lines it covers and who remits it with the finance team / tax adviser.')
on conflict (code) do nothing;

create table if not exists public.tax_entries (
  id bigint generated always as identity primary key,
  ledger_entry_id bigint not null references public.ledger_entries (id),
  tax_rule_id uuid references public.tax_rules (id),
  tax_code text not null,
  -- The organisation that earned the taxed amount (platform for fees, broker for commission).
  org_id uuid not null references public.organizations (id),
  base_amount numeric(14, 2) not null,
  rate numeric(7, 4) not null,
  inclusive boolean not null default false,
  amount numeric(14, 2) not null,
  currency char(3) not null default 'GHS',
  created_at timestamptz not null default now(),
  unique (ledger_entry_id, tax_code)
);
comment on table public.tax_entries is 'Tax lines (VAT / levies) computed from ledger entries for ACTIVE tax rules only. Append-only. Kept separate because ledger_entries.entry_type does not allow tax and is left unchanged.';
create index if not exists tax_entries_org_idx on public.tax_entries (org_id, created_at desc);

create or replace function private.tax_entries_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'tax_entries is append-only' using errcode = 'P0001';
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tax_entries_no_update' and tgrelid = 'public.tax_entries'::regclass) then
    create trigger tax_entries_no_update before update or delete on public.tax_entries
      for each row execute function private.tax_entries_immutable();
  end if;
end $$;
alter table public.tax_entries enable row level security;
select private.ensure_policy('tax_entries', 'tax entries: org read', $p$
  create policy "tax entries: org read" on public.tax_entries for select to authenticated
  using (private.has_org_role(org_id, '{owner,admin,finance}') or (select private.is_platform_staff()))$p$);

-- ---------------------------------------------------------------------------
-- 3. Accounting exports
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id),
  kind text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'queued',
  storage_path text,
  row_count int,
  error text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.accounting_exports is 'Generated accounting CSVs. org_id null = platform-level export. Files live in the private documents bucket under exports/<org|platform>/<kind>-<period>.csv.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounting_exports_kind_check') then
    alter table public.accounting_exports add constraint accounting_exports_kind_check check (kind in ('insurer_statement', 'commission_report', 'tax_report', 'platform_revenue', 'xero_csv', 'quickbooks_csv', 'sage_csv'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounting_exports_status_check') then
    alter table public.accounting_exports add constraint accounting_exports_status_check check (status in ('queued', 'ready', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounting_exports_period_check') then
    alter table public.accounting_exports add constraint accounting_exports_period_check check (period_end >= period_start);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.accounting_exports'::regclass) then
    create trigger set_updated_at before update on public.accounting_exports for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists accounting_exports_org_idx on public.accounting_exports (org_id, created_at desc);
alter table public.accounting_exports enable row level security;
-- Writes: service role only (server code authorises first).
select private.ensure_policy('accounting_exports', 'accounting exports: org finance read', $p$
  create policy "accounting exports: org finance read" on public.accounting_exports for select to authenticated
  using ((org_id is not null and private.has_org_role(org_id, '{owner,admin,finance}')) or (select private.is_platform_staff()))$p$);

-- ---------------------------------------------------------------------------
-- 4. Service partner self-onboarding and ratings
-- ---------------------------------------------------------------------------
alter table public.service_partners add column if not exists review_count int not null default 0;
comment on column public.service_partners.review_count is 'Published customer reviews. rating is shown (non-null) only from 3 reviews.';

create table if not exists public.service_partner_applications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  name text not null,
  -- { contact_name, phone, email }
  contacts jsonb not null default '{}'::jsonb,
  address text,
  region text,
  services text[] not null default '{}',
  -- [{ storage_path?, name, note? }]
  documents jsonb not null default '[]'::jsonb,
  status text not null default 'submitted',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  service_partner_id uuid references public.service_partners (id),
  lead_id uuid references public.leads (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.service_partner_applications is 'Public applications to join the post-claim partner network. Created by a server action (service role); staff approval creates the service_partners row.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_partner_applications_kind_check') then
    alter table public.service_partner_applications add constraint service_partner_applications_kind_check check (kind in ('garage', 'towing', 'hospital', 'clinic', 'pharmacy', 'assessor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_partner_applications_status_check') then
    alter table public.service_partner_applications add constraint service_partner_applications_status_check check (status in ('submitted', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.service_partner_applications'::regclass) then
    create trigger set_updated_at before update on public.service_partner_applications for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists service_partner_applications_status_idx on public.service_partner_applications (status, created_at desc);
alter table public.service_partner_applications enable row level security;
select private.ensure_policy('service_partner_applications', 'partner applications: staff read', $p$
  create policy "partner applications: staff read" on public.service_partner_applications for select to authenticated
  using ((select private.is_platform_staff()))$p$);
select private.ensure_policy('service_partner_applications', 'partner applications: staff update', $p$
  create policy "partner applications: staff update" on public.service_partner_applications for update to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

create table if not exists public.service_partner_reviews (
  id uuid primary key default gen_random_uuid(),
  service_partner_id uuid not null references public.service_partners (id),
  claim_job_id uuid not null unique references public.claim_jobs (id),
  customer_id uuid not null references auth.users (id),
  rating int not null,
  comment text,
  status text not null default 'published',
  hidden_reason text,
  moderated_by uuid references auth.users (id),
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.service_partner_reviews is 'One rating per completed claim job, by the claim''s customer. Published reviews feed service_partners.rating (shown from 3 reviews). Staff can hide a review; reviews are never deleted.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_partner_reviews_rating_check') then
    alter table public.service_partner_reviews add constraint service_partner_reviews_rating_check check (rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_partner_reviews_status_check') then
    alter table public.service_partner_reviews add constraint service_partner_reviews_status_check check (status in ('published', 'hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_partner_reviews_comment_check') then
    alter table public.service_partner_reviews add constraint service_partner_reviews_comment_check check (comment is null or char_length(comment) <= 1000);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.service_partner_reviews'::regclass) then
    create trigger set_updated_at before update on public.service_partner_reviews for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists service_partner_reviews_partner_idx on public.service_partner_reviews (service_partner_id, status, created_at desc);

-- A review needs a completed job on the reviewer's own claim; the partner comes from the job.
create or replace function private.service_partner_reviews_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.claim_jobs;
  v_customer uuid;
  v_privileged boolean := private.is_service_role() or private.is_platform_staff();
begin
  if tg_op = 'INSERT' then
    select * into v_job from public.claim_jobs where id = new.claim_job_id;
    if v_job.id is null then
      raise exception 'Job not found' using errcode = 'P0001';
    end if;
    select customer_id into v_customer from public.claims where id = v_job.claim_id;
    new.service_partner_id := v_job.service_partner_id;
    if not private.is_service_role() then
      if v_customer is distinct from (select auth.uid()) then
        raise exception 'Only the customer on the claim can rate this partner' using errcode = 'P0001';
      end if;
      if v_job.status <> 'completed' then
        raise exception 'You can rate the partner once the job is completed' using errcode = 'P0001';
      end if;
      new.customer_id := v_customer;
      new.status := 'published';
      new.hidden_reason := null; new.moderated_by := null; new.moderated_at := null;
    end if;
    new.comment := nullif(btrim(coalesce(new.comment, '')), '');
    return new;
  end if;
  -- UPDATE: moderation (staff / service role) only; the review itself stays as written.
  if not v_privileged then
    raise exception 'Reviews are moderated by Covva staff' using errcode = 'P0001';
  end if;
  if new.claim_job_id is distinct from old.claim_job_id or new.customer_id is distinct from old.customer_id
     or new.service_partner_id is distinct from old.service_partner_id or new.rating is distinct from old.rating
     or new.comment is distinct from old.comment then
    raise exception 'A review''s rating and comment cannot be edited — hide it instead' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    new.moderated_by := coalesce((select auth.uid()), new.moderated_by);
    new.moderated_at := now();
  end if;
  return new;
end $$;

-- service_partners.rating = average of published reviews, only once there are 3 or more.
create or replace function private.refresh_service_partner_rating(p_partner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
  v_avg numeric;
begin
  select count(*), avg(rating) into v_count, v_avg from public.service_partner_reviews
   where service_partner_id = p_partner and status = 'published';
  update public.service_partners
     set review_count = v_count,
         rating = case when v_count >= 3 then round(v_avg, 2) else null end
   where id = p_partner
     and (review_count is distinct from v_count or rating is distinct from (case when v_count >= 3 then round(v_avg, 2) else null end));
end $$;

create or replace function private.service_partner_reviews_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_service_partner_rating(new.service_partner_id);
  if tg_op = 'UPDATE' and old.service_partner_id is distinct from new.service_partner_id then
    perform private.refresh_service_partner_rating(old.service_partner_id);
  end if;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'service_partner_reviews_guard' and tgrelid = 'public.service_partner_reviews'::regclass) then
    create trigger service_partner_reviews_guard before insert or update on public.service_partner_reviews
      for each row execute function private.service_partner_reviews_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'service_partner_reviews_after' and tgrelid = 'public.service_partner_reviews'::regclass) then
    create trigger service_partner_reviews_after after insert or update on public.service_partner_reviews
      for each row execute function private.service_partner_reviews_after();
  end if;
end $$;

alter table public.service_partner_reviews enable row level security;
select private.ensure_policy('service_partner_reviews', 'partner reviews: public read published', $p$
  create policy "partner reviews: public read published" on public.service_partner_reviews for select to anon, authenticated
  using (status = 'published')$p$);
select private.ensure_policy('service_partner_reviews', 'partner reviews: own and staff read', $p$
  create policy "partner reviews: own and staff read" on public.service_partner_reviews for select to authenticated
  using (customer_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('service_partner_reviews', 'partner reviews: customer create', $p$
  create policy "partner reviews: customer create" on public.service_partner_reviews for insert to authenticated
  with check (customer_id = (select auth.uid()))$p$);
select private.ensure_policy('service_partner_reviews', 'partner reviews: staff moderate', $p$
  create policy "partner reviews: staff moderate" on public.service_partner_reviews for update to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);
-- Anonymous visitors never see who wrote a review: column-level read for anon.
revoke select on public.service_partner_reviews from anon;
grant select (id, service_partner_id, rating, comment, status, created_at) on public.service_partner_reviews to anon;

-- ---------------------------------------------------------------------------
-- 5. Audit, grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['endorsements', 'tax_rules', 'accounting_exports', 'service_partner_applications', 'service_partner_reviews'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

-- Grants: only the helpers the RLS policies above call (all pre-existing, re-granted idempotently).
-- Trigger functions (endorsements_guard, tax_rules_before, tax_entries_immutable,
-- service_partner_reviews_guard, service_partner_reviews_after) run as triggers and need no grant;
-- refresh_service_partner_rating is only called from the SECURITY DEFINER trigger above, so it is
-- not executable by API roles.
revoke execute on function private.refresh_service_partner_rating(uuid) from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.is_platform_staff() to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated, service_role;
