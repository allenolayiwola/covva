-- =============================================================================
-- Commercial terms, money ledger, checkout splits and settlement statements
-- (Addendum 2 §F monetisation, §G transparency; roadmap Phase 0 "Commercial
-- terms and ledger"). Additive only: no drops, no deletes.
--
-- Invariant kept from 20261026120100 (payments_guard): premiums settle to the
-- INSURER. Covva never holds client funds. The broker and platform shares
-- recorded here are commission / fee portions only, and the `insurer` party of
-- a split must be the payment's payee (the policy's insurer).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns on existing tables
-- ---------------------------------------------------------------------------
-- Where the business came from: Covva-sourced (marketplace lead) or broker-sourced
-- (the broker's own client, brought onto the platform for back-office tools).
alter table public.policies add column if not exists source text not null default 'covva';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'policies_source_check') then
    alter table public.policies add constraint policies_source_check check (source in ('covva', 'broker'));
  end if;
end $$;
comment on column public.policies.source is 'covva = marketplace-sourced lead (revenue share may apply); broker = the broker''s own client (subscription model, no revenue share).';

-- Set when a broker brings its own client onto the platform; null for Covva-sourced requests.
alter table public.requests add column if not exists source_broker_org_id uuid references public.organizations (id);
comment on column public.requests.source_broker_org_id is 'Broker that sourced this client (broker-sourced business). Null when Covva generated the lead.';

-- Fee transparency shown to the customer: premium, taxes, platform fee, broker commission, total.
alter table public.quotes add column if not exists fee_breakdown jsonb;
comment on column public.quotes.fee_breakdown is 'What the customer sees: { premium, taxes, fees, platform_fee, broker_commission, total, source, notes }. The platform fee and commission are paid by the insurer out of the premium, never added on top.';

-- Paystack split group (multi-subaccount) configured for this organisation's checkouts.
-- Paystack settles one subaccount per transaction; a three-way split needs a split group
-- (`split_code`). When absent, checkout falls back to the insurer's single subaccount and
-- commission / fees are settled by periodic statement.
alter table public.organizations add column if not exists paystack_split_code text;
comment on column public.organizations.paystack_split_code is 'Paystack split group code (SPL_…) for three-way checkout splits. Null = single insurer subaccount + periodic settlement.';

-- ---------------------------------------------------------------------------
-- 2. Commercial terms per organisation
-- ---------------------------------------------------------------------------
create table if not exists public.org_commercial_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- broker: revenue_share | subscription; insurer: insurer_fee
  model text not null check (model in ('revenue_share', 'subscription', 'insurer_fee')),
  -- Covva's share of the broker's commission on Covva-sourced business (revenue_share brokers only).
  revenue_share_pct numeric(5, 2) not null default 0 check (revenue_share_pct >= 0 and revenue_share_pct <= 100),
  subscription_plan_id uuid references public.plans (id),
  -- Insurer-side platform fee on Covva-sourced business, as % of the net premium.
  platform_fee_pct numeric(5, 2) not null default 0 check (platform_fee_pct >= 0 and platform_fee_pct <= 100),
  -- Broker commission as % of the net premium (insurer terms: what the insurer pays brokers;
  -- broker terms: an agreed override, 0 = use the insurer's rate).
  broker_commission_pct numeric(5, 2) not null default 0 check (broker_commission_pct >= 0 and broker_commission_pct <= 100),
  effective_from date not null default current_date,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_by uuid references auth.users (id),
  notes text,
  created_at timestamptz not null default now()
);
-- One open-ended (active) row per organisation; earlier rows are closed with effective_to.
create unique index if not exists org_commercial_terms_one_open_per_org on public.org_commercial_terms (org_id) where effective_to is null;
create index if not exists org_commercial_terms_org_idx on public.org_commercial_terms (org_id, effective_from desc);

create or replace function private.org_commercial_terms_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.org_type;
begin
  select type into v_type from public.organizations where id = new.org_id;
  if v_type = 'broker' and new.model not in ('revenue_share', 'subscription') then
    raise exception 'A broker is on the revenue share or subscription model' using errcode = 'P0001';
  end if;
  if v_type = 'insurer' and new.model <> 'insurer_fee' then
    raise exception 'An insurer is on the insurer fee model' using errcode = 'P0001';
  end if;
  if v_type = 'platform' then
    raise exception 'The platform organisation has no commercial terms' using errcode = 'P0001';
  end if;
  if new.model = 'subscription' and new.subscription_plan_id is null then
    raise exception 'A subscription model needs a plan' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'org_commercial_terms_guard' and tgrelid = 'public.org_commercial_terms'::regclass) then
    create trigger org_commercial_terms_guard before insert or update on public.org_commercial_terms
      for each row execute function private.org_commercial_terms_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Checkout splits (one row per party per payment)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_splits (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  party text not null check (party in ('insurer', 'broker', 'platform')),
  org_id uuid references public.organizations (id),
  amount numeric(14, 2) not null check (amount >= 0),
  pct numeric(7, 4),
  subaccount_code text,
  provider_split_ref text,
  status text not null default 'pending' check (status in ('pending', 'settled', 'failed')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_id, party)
);
create index if not exists payment_splits_org_idx on public.payment_splits (org_id, created_at desc);

-- The insurer party must be the payment's payee (an insurer, enforced by payments_guard);
-- broker and platform parties can only be the matching organisation types.
create or replace function private.payment_splits_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_payee uuid;
  v_type public.org_type;
begin
  select payee_org_id into v_payee from public.payments where id = new.payment_id;
  if new.org_id is not null then
    select type into v_type from public.organizations where id = new.org_id;
  end if;
  if new.party = 'insurer' and new.org_id is distinct from v_payee then
    raise exception 'The insurer share of a premium must go to the payment payee (the policy insurer)' using errcode = 'P0001';
  end if;
  if new.party = 'broker' and v_type is distinct from 'broker' then
    raise exception 'The broker share must go to a broker organisation' using errcode = 'P0001';
  end if;
  if new.party = 'platform' and new.org_id is not null and v_type is distinct from 'platform' then
    raise exception 'The platform share must go to the platform organisation' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'payment_splits_guard' and tgrelid = 'public.payment_splits'::regclass) then
    create trigger payment_splits_guard before insert or update on public.payment_splits
      for each row execute function private.payment_splits_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Ledger (append-only journal of every money movement)
-- ---------------------------------------------------------------------------
-- `amount` is a credit to `org_id` (positive) and, when set, a debit to
-- `counterparty_org_id`. payment_id / policy_id are plain references (no FK) so
-- the journal outlives any row it describes.
create table if not exists public.ledger_entries (
  id bigint generated always as identity primary key,
  entry_type text not null check (entry_type in ('premium_received', 'premium_to_insurer', 'broker_commission', 'platform_fee', 'revenue_share', 'subscription_fee', 'refund', 'adjustment')),
  payment_id uuid,
  policy_id uuid,
  org_id uuid not null references public.organizations (id),
  counterparty_org_id uuid references public.organizations (id),
  amount numeric(14, 2) not null,
  currency char(3) not null default 'GHS',
  memo text,
  reference text,
  created_at timestamptz not null default now()
);
-- Idempotent posting: one entry per payment and type (adjustments may repeat).
create unique index if not exists ledger_entries_payment_type_uidx on public.ledger_entries (payment_id, entry_type)
  where payment_id is not null and entry_type <> 'adjustment';
create index if not exists ledger_entries_org_idx on public.ledger_entries (org_id, created_at desc);
create index if not exists ledger_entries_counterparty_idx on public.ledger_entries (counterparty_org_id, created_at desc) where counterparty_org_id is not null;
create index if not exists ledger_entries_payment_idx on public.ledger_entries (payment_id) where payment_id is not null;
create index if not exists ledger_entries_reference_idx on public.ledger_entries (reference) where reference is not null;

create or replace function private.ledger_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'ledger_entries is append-only' using errcode = 'P0001';
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ledger_entries_no_update' and tgrelid = 'public.ledger_entries'::regclass) then
    create trigger ledger_entries_no_update before update or delete on public.ledger_entries
      for each row execute function private.ledger_immutable();
  end if;
end $$;

-- Premiums are only ever credited to an insurer.
create or replace function private.ledger_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.entry_type in ('premium_received', 'premium_to_insurer')
     and not exists (select 1 from public.organizations where id = new.org_id and type = 'insurer') then
    raise exception 'Premiums are credited to a licensed insurer only — never to the platform or a broker' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ledger_entries_guard' and tgrelid = 'public.ledger_entries'::regclass) then
    create trigger ledger_entries_guard before insert on public.ledger_entries
      for each row execute function private.ledger_entries_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Settlement statements per organisation per period
-- ---------------------------------------------------------------------------
create table if not exists public.settlement_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  currency char(3) not null default 'GHS',
  -- Premiums received directly by the org (insurers; net of refunds).
  gross_premium numeric(14, 2) not null default 0,
  -- Broker commission: earned (+, brokers) or payable (−, insurers).
  commission numeric(14, 2) not null default 0,
  -- Platform fees and revenue share owed to Covva by this org.
  platform_fee numeric(14, 2) not null default 0,
  -- Positive: due to the organisation; negative: the organisation owes.
  net_due numeric(14, 2) not null default 0,
  line_count int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid')),
  pdf_path text,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, period_start, period_end)
);
create index if not exists settlement_statements_org_idx on public.settlement_statements (org_id, period_start desc);
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'settlement_statements_updated' and tgrelid = 'public.settlement_statements'::regclass) then
    create trigger settlement_statements_updated before update on public.settlement_statements
      for each row execute function private.set_updated_at();
  end if;
end $$;

create table if not exists public.settlement_lines (
  id bigint generated always as identity primary key,
  statement_id uuid not null references public.settlement_statements (id) on delete cascade,
  ledger_entry_id bigint not null references public.ledger_entries (id),
  unique (statement_id, ledger_entry_id)
);

-- ---------------------------------------------------------------------------
-- 6. Row level security. Writes happen only through the service role or the
--    SECURITY DEFINER functions below (no insert/update policies).
-- ---------------------------------------------------------------------------
alter table public.org_commercial_terms enable row level security;
alter table public.payment_splits enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.settlement_statements enable row level security;
alter table public.settlement_lines enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'commercial terms: org read') then
    create policy "commercial terms: org read" on public.org_commercial_terms for select to authenticated
      using (private.has_org_role(org_id, '{owner,admin,finance}') or (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'payment splits: org read') then
    create policy "payment splits: org read" on public.payment_splits for select to authenticated
      using (private.has_org_role(org_id, '{owner,admin,finance}') or (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'ledger: org read') then
    create policy "ledger: org read" on public.ledger_entries for select to authenticated
      using (private.has_org_role(org_id, '{owner,admin,finance}')
          or (counterparty_org_id is not null and private.has_org_role(counterparty_org_id, '{owner,admin,finance}'))
          or (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'statements: org read') then
    create policy "statements: org read" on public.settlement_statements for select to authenticated
      using (private.has_org_role(org_id, '{owner,admin,finance}') or (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'statement lines: org read') then
    create policy "statement lines: org read" on public.settlement_lines for select to authenticated
      using (exists (select 1 from public.settlement_statements s where s.id = statement_id
               and (private.has_org_role(s.org_id, '{owner,admin,finance}') or (select private.is_platform_staff()))));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Privileged functions (platform staff or service role)
-- ---------------------------------------------------------------------------
-- Set an organisation's commercial terms from a date; the previous open row is closed.
create or replace function public.set_commercial_terms(
  p_org uuid,
  p_model text,
  p_revenue_share_pct numeric default 0,
  p_platform_fee_pct numeric default 0,
  p_broker_commission_pct numeric default 0,
  p_subscription_plan_id uuid default null,
  p_effective_from date default current_date,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_open public.org_commercial_terms;
  v_id uuid;
begin
  if not (private.is_platform_staff() or private.is_service_role()) then
    raise exception 'Only platform staff can set commercial terms' using errcode = 'P0001';
  end if;
  select * into v_open from public.org_commercial_terms t where t.org_id = p_org and t.effective_to is null for update;
  if v_open.id is not null then
    update public.org_commercial_terms
       set effective_to = greatest(v_open.effective_from, p_effective_from - 1)
     where id = v_open.id;
  end if;
  insert into public.org_commercial_terms (org_id, model, revenue_share_pct, platform_fee_pct, broker_commission_pct, subscription_plan_id, effective_from, approved_by, approved_at, created_by, notes)
  values (p_org, p_model, coalesce(p_revenue_share_pct, 0), coalesce(p_platform_fee_pct, 0), coalesce(p_broker_commission_pct, 0), p_subscription_plan_id, coalesce(p_effective_from, current_date), v_uid, now(), v_uid, p_notes)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.set_commercial_terms(uuid, text, numeric, numeric, numeric, uuid, date, text) from public, anon;
grant execute on function public.set_commercial_terms(uuid, text, numeric, numeric, numeric, uuid, date, text) to authenticated, service_role;

-- Build (or refresh, while still draft) the settlement statement for an org and period.
-- Idempotent: unique (org_id, period_start, period_end); lines are added, never removed
-- (the ledger is append-only, so a refresh can only pick up new entries).
create or replace function public.build_settlement_statement(p_org uuid, p_start date, p_end date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_status text;
  v_from timestamptz := p_start::timestamptz;
  v_to timestamptz := (p_end + 1)::timestamptz;
  v_gross numeric(14, 2);
  v_commission numeric(14, 2);
  v_fee numeric(14, 2);
  v_net numeric(14, 2);
  v_count int;
  v_currency char(3);
begin
  if not (private.is_platform_staff() or private.is_service_role()) then
    raise exception 'Only platform staff can build settlement statements' using errcode = 'P0001';
  end if;
  if p_end < p_start then
    raise exception 'The period end must not be before its start' using errcode = 'P0001';
  end if;

  select id, status into v_id, v_status from public.settlement_statements s
   where s.org_id = p_org and s.period_start = p_start and s.period_end = p_end for update;
  if v_id is not null and v_status <> 'draft' then
    return v_id; -- issued / paid statements are frozen
  end if;

  select
    coalesce(sum(case when e.org_id = p_org and e.entry_type in ('premium_received', 'premium_to_insurer', 'refund') then e.amount else 0 end), 0),
    coalesce(sum(case when e.entry_type = 'broker_commission' and e.org_id = p_org then e.amount
                      when e.entry_type = 'broker_commission' and e.counterparty_org_id = p_org then -e.amount else 0 end), 0),
    coalesce(sum(case when e.entry_type in ('platform_fee', 'revenue_share', 'subscription_fee') and e.counterparty_org_id = p_org then e.amount else 0 end), 0),
    coalesce(sum(case when e.entry_type in ('premium_received', 'premium_to_insurer', 'refund') then 0
                      when e.org_id = p_org then e.amount
                      when e.counterparty_org_id = p_org then -e.amount else 0 end), 0),
    count(*),
    max(e.currency)
  into v_gross, v_commission, v_fee, v_net, v_count, v_currency
  from public.ledger_entries e
  where e.created_at >= v_from and e.created_at < v_to
    and (e.org_id = p_org or e.counterparty_org_id = p_org);

  if v_id is null then
    insert into public.settlement_statements (org_id, period_start, period_end, currency, gross_premium, commission, platform_fee, net_due, line_count, status)
    values (p_org, p_start, p_end, coalesce(v_currency, 'GHS'), v_gross, v_commission, v_fee, v_net, v_count, 'draft')
    returning id into v_id;
  else
    update public.settlement_statements
       set gross_premium = v_gross, commission = v_commission, platform_fee = v_fee, net_due = v_net, line_count = v_count,
           currency = coalesce(v_currency, currency)
     where id = v_id;
  end if;

  insert into public.settlement_lines (statement_id, ledger_entry_id)
  select v_id, e.id from public.ledger_entries e
   where e.created_at >= v_from and e.created_at < v_to
     and (e.org_id = p_org or e.counterparty_org_id = p_org)
  on conflict (statement_id, ledger_entry_id) do nothing;

  return v_id;
end $$;
revoke execute on function public.build_settlement_statement(uuid, date, date) from public, anon;
grant execute on function public.build_settlement_statement(uuid, date, date) to authenticated, service_role;

-- Statement lifecycle: draft → issued → paid. Never deleted.
create or replace function public.transition_settlement_statement(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if not (private.is_platform_staff() or private.is_service_role()) then
    raise exception 'Only platform staff can issue settlement statements' using errcode = 'P0001';
  end if;
  select status into v_status from public.settlement_statements where id = p_id for update;
  if v_status is null then
    raise exception 'Statement not found' using errcode = 'P0001';
  end if;
  if p_status = 'issued' and v_status = 'draft' then
    update public.settlement_statements set status = 'issued', issued_at = now() where id = p_id;
  elsif p_status = 'paid' and v_status = 'issued' then
    update public.settlement_statements set status = 'paid', paid_at = now() where id = p_id;
  else
    raise exception 'Cannot move a statement from % to %', v_status, p_status using errcode = 'P0001';
  end if;
end $$;
revoke execute on function public.transition_settlement_statement(uuid, text) from public, anon;
grant execute on function public.transition_settlement_statement(uuid, text) to authenticated, service_role;

grant execute on all functions in schema private to authenticated, service_role;
