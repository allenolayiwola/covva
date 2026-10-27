-- =============================================================================
-- Instalment premiums and micro / on-demand cover (roadmap Phase 3; Addendum 6 item 1;
-- build prompt "Instalment premiums (monthly/quarterly) with automated collections,
-- retries, grace periods, and lapse/reinstatement handling that follows insurer rules").
--
-- Additive only: no drops, no deletes; every statement is idempotent.
--
-- Money invariants (unchanged): every instalment and every micro cover window is an
-- ordinary premium payment — a `payments` row in GHS whose payee is the INSURER
-- (payments_guard) with the same split / ledger path as a checkout. Covva never holds
-- client funds. Grace, lapse and reinstatement rules are the insurer's, stored on the
-- product version (`instalment_plans`) and snapshotted on each schedule.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Product versions: short periods, instalment plans, micro flag, audiences
-- ---------------------------------------------------------------------------
alter table public.product_versions add column if not exists periods text[] not null default '{year}';
alter table public.product_versions add column if not exists instalment_plans jsonb not null default '[]'::jsonb;
alter table public.product_versions add column if not exists micro boolean not null default false;
alter table public.product_versions add column if not exists audience_tags text[] not null default '{}';
comment on column public.product_versions.periods is 'Policy periods the insurer prices this version for: day, week, month, quarter, year. Short periods use rating.period_factors (or pro rata with the minimum premium).';
comment on column public.product_versions.instalment_plans is 'Insurer instalment plans: [{key: monthly|quarterly, count, deposit_pct, surcharge_pct, grace_days, lapse_after_days, reinstatement: {allowed, within_days, requires_review}}]. Rules are the insurer''s; Covva only applies them.';
comment on column public.product_versions.micro is 'Micro / on-demand product (daily, weekly or monthly low-cost cover, pay as you go).';
comment on column public.product_versions.audience_tags is 'Who the micro product is for: okada, trotro, ride_hailing, trader, artisan, event.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_versions_periods_check') then
    alter table public.product_versions add constraint product_versions_periods_check
      check (cardinality(periods) > 0 and periods <@ array['day', 'week', 'month', 'quarter', 'year']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_versions_instalment_plans_array') then
    alter table public.product_versions add constraint product_versions_instalment_plans_array
      check (jsonb_typeof(instalment_plans) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_versions_audience_tags_check') then
    alter table public.product_versions add constraint product_versions_audience_tags_check
      check (audience_tags <@ array['okada', 'trotro', 'ride_hailing', 'trader', 'artisan', 'event']::text[]);
  end if;
end $$;
create index if not exists product_versions_micro_idx on public.product_versions (micro) where micro;

-- ---------------------------------------------------------------------------
-- 2. Instalment schedules and instalments
-- ---------------------------------------------------------------------------
create table if not exists public.instalment_schedules (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.policies (id),
  application_id uuid references public.applications (id),
  customer_id uuid not null references auth.users (id),
  -- Who pays: the customer, or a sponsor paying for them.
  payer_user_id uuid not null references auth.users (id),
  insurer_org_id uuid not null references public.organizations (id),
  plan_key text not null,
  -- Snapshot of the insurer's plan at purchase (grace / lapse / reinstatement rules).
  plan jsonb not null default '{}'::jsonb,
  currency char(3) not null default 'GHS',
  total_amount numeric(14, 2) not null,
  instalment_count integer not null,
  status text not null default 'active',
  grace_until timestamptz,
  lapsed_at timestamptz,
  reinstated_at timestamptz,
  reinstatement_requested_at timestamptz,
  reinstatement_review text,
  payment_method_id uuid references public.payment_methods (id),
  channel text not null default 'mobile_money',
  momo_network text,
  -- Masked for display (e.g. 024•••4567). The full number is only passed to the PSP at charge time.
  momo_phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.instalment_schedules is 'A policy premium paid in instalments under the insurer''s plan. Each instalment is a premium payment to the insurer (GHS); Covva never holds the money.';
comment on column public.instalment_schedules.momo_phone is 'Masked mobile money number for display only.';
comment on column public.instalment_schedules.reinstatement_review is 'null | pending | approved | declined — insurer review of a reinstatement when the plan requires it.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instalment_schedules_status_check') then
    alter table public.instalment_schedules add constraint instalment_schedules_status_check
      check (status in ('active', 'grace', 'lapsed', 'completed', 'cancelled', 'reinstated'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instalment_schedules_plan_key_check') then
    alter table public.instalment_schedules add constraint instalment_schedules_plan_key_check check (plan_key in ('monthly', 'quarterly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instalment_schedules_currency_check') then
    alter table public.instalment_schedules add constraint instalment_schedules_currency_check check (currency = 'GHS');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instalment_schedules_amount_check') then
    alter table public.instalment_schedules add constraint instalment_schedules_amount_check check (total_amount > 0 and instalment_count between 1 and 24);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instalment_schedules_channel_check') then
    alter table public.instalment_schedules add constraint instalment_schedules_channel_check check (channel in ('mobile_money', 'card'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instalment_schedules_network_check') then
    alter table public.instalment_schedules add constraint instalment_schedules_network_check check (momo_network is null or momo_network in ('mtn', 'vod', 'atl'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instalment_schedules_review_check') then
    alter table public.instalment_schedules add constraint instalment_schedules_review_check
      check (reinstatement_review is null or reinstatement_review in ('pending', 'approved', 'declined'));
  end if;
end $$;
create index if not exists instalment_schedules_policy_idx on public.instalment_schedules (policy_id);
create index if not exists instalment_schedules_application_idx on public.instalment_schedules (application_id);
create index if not exists instalment_schedules_customer_idx on public.instalment_schedules (customer_id, created_at desc);
create index if not exists instalment_schedules_payer_idx on public.instalment_schedules (payer_user_id, created_at desc);
create index if not exists instalment_schedules_insurer_idx on public.instalment_schedules (insurer_org_id, status);
create index if not exists instalment_schedules_status_idx on public.instalment_schedules (status);

create table if not exists public.instalments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.instalment_schedules (id) on delete cascade,
  seq integer not null,
  due_at timestamptz not null,
  amount numeric(14, 2) not null,
  status text not null default 'due',
  payment_id uuid references public.payments (id),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, seq)
);
comment on table public.instalments is 'One instalment of a schedule. Collections retry on day 0, +2 and +5 after the due date; grace and lapse follow the schedule''s plan.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instalments_status_check') then
    alter table public.instalments add constraint instalments_status_check check (status in ('due', 'paid', 'failed', 'waived', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instalments_amount_check') then
    alter table public.instalments add constraint instalments_amount_check check (amount > 0 and seq >= 1 and attempts >= 0);
  end if;
end $$;
create index if not exists instalments_due_idx on public.instalments (due_at) where status in ('due', 'failed');
create index if not exists instalments_payment_idx on public.instalments (payment_id);

-- ---------------------------------------------------------------------------
-- 3. Policies: period, micro, auto-renew, instalment schedule
-- ---------------------------------------------------------------------------
alter table public.policies add column if not exists period text not null default 'year';
alter table public.policies add column if not exists micro boolean not null default false;
alter table public.policies add column if not exists auto_renew boolean not null default false;
alter table public.policies add column if not exists instalment_schedule_id uuid references public.instalment_schedules (id);
comment on column public.policies.period is 'Policy period: day, week, month, quarter or year (micro cover uses the short periods).';
comment on column public.policies.auto_renew is 'Micro cover: renew automatically before the window ends (stored method charged, or a pay link sent).';
comment on column public.policies.instalment_schedule_id is 'Set when the premium is paid in instalments (instalment_schedules).';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'policies_period_check') then
    alter table public.policies add constraint policies_period_check check (period in ('day', 'week', 'month', 'quarter', 'year'));
  end if;
end $$;
create index if not exists policies_micro_idx on public.policies (micro, cover_end) where micro;
create index if not exists policies_instalment_schedule_idx on public.policies (instalment_schedule_id) where instalment_schedule_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Micro sessions (pay-as-you-go cover windows)
-- ---------------------------------------------------------------------------
create table if not exists public.micro_sessions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies (id),
  customer_id uuid not null references auth.users (id),
  period text not null default 'day',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  amount numeric(14, 2) not null,
  payment_id uuid references public.payments (id),
  channel text not null default 'app',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.micro_sessions is 'A daily / weekly / monthly micro cover window. Active only once its premium payment (to the insurer) succeeded.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'micro_sessions_channel_check') then
    alter table public.micro_sessions add constraint micro_sessions_channel_check check (channel in ('app', 'whatsapp', 'ussd', 'web'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'micro_sessions_status_check') then
    alter table public.micro_sessions add constraint micro_sessions_status_check check (status in ('pending', 'active', 'failed', 'expired', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'micro_sessions_period_check') then
    alter table public.micro_sessions add constraint micro_sessions_period_check check (period in ('day', 'week', 'month', 'quarter', 'year'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'micro_sessions_window_check') then
    alter table public.micro_sessions add constraint micro_sessions_window_check check (ends_at > starts_at and amount > 0);
  end if;
end $$;
create index if not exists micro_sessions_policy_idx on public.micro_sessions (policy_id, ends_at desc);
create index if not exists micro_sessions_customer_idx on public.micro_sessions (customer_id, ends_at desc);
create index if not exists micro_sessions_payment_idx on public.micro_sessions (payment_id);

-- USSD purchases are recorded with their own request source (used by the USSD channel).
alter type public.request_source add value if not exists 'ussd';

-- ---------------------------------------------------------------------------
-- 5. Insurer-direct orders (micro L2 instant products have no broker of record)
--    Same guard as 20261026120100 plus one exception: an order the routing engine sent
--    directly to the insurer (order_routing.mode = insurer_direct) is the insurer's own
--    sale, so no broker of record / broker disclosure is required. Every other check stays.
-- ---------------------------------------------------------------------------
create or replace function private.applications_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_req public.requests; v_quote public.quotes;
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    select * into v_req from public.requests where id = new.request_id;
    select * into v_quote from public.quotes where id = new.quote_id;
    if v_req.broker_org_id is null then
      if not (private.request_is_insurer_direct(new.request_id) and v_quote.broker_org_id is null) then
        raise exception 'A broker of record must be assigned before an application is submitted' using errcode = 'P0001';
      end if;
    elsif not exists (
      select 1 from public.broker_disclosures d
      where d.request_id = new.request_id and d.broker_org_id = v_req.broker_org_id
    ) then
      raise exception 'The broker of record must be disclosed to the customer before application' using errcode = 'P0001';
    end if;
    if v_quote.status <> 'ready_to_accept' then
      raise exception 'Only a quote that is ready to accept can be applied for (current: %)', v_quote.status using errcode = 'P0001';
    end if;
    if v_quote.valid_until is not null and v_quote.valid_until < now() then
      raise exception 'This quote has expired and must be revalidated' using errcode = 'P0001';
    end if;
    if new.terms_accepted_at is null then
      raise exception 'Terms and declarations must be accepted' using errcode = 'P0001';
    end if;
    new.submitted_at := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Housekeeping: updated_at + audit
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['instalment_schedules', 'instalments', 'micro_sessions'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS: customer / payer read own; the policy's insurer reads; staff all.
--    Writes are server-side (service role) or platform staff.
-- ---------------------------------------------------------------------------
alter table public.instalment_schedules enable row level security;
alter table public.instalments enable row level security;
alter table public.micro_sessions enable row level security;

select private.ensure_policy('instalment_schedules', 'instalment schedules: parties read', $p$
  create policy "instalment schedules: parties read" on public.instalment_schedules for select to authenticated
  using (
    customer_id = (select auth.uid())
    or payer_user_id = (select auth.uid())
    or insurer_org_id in (select private.user_org_ids())
    or (select private.is_platform_staff())
  )$p$);
select private.ensure_policy('instalment_schedules', 'instalment schedules: staff manage', $p$
  create policy "instalment schedules: staff manage" on public.instalment_schedules for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

select private.ensure_policy('instalments', 'instalments: parties read', $p$
  create policy "instalments: parties read" on public.instalments for select to authenticated
  using (
    (select private.is_platform_staff())
    or exists (
      select 1 from public.instalment_schedules s
      where s.id = instalments.schedule_id
        and (s.customer_id = (select auth.uid()) or s.payer_user_id = (select auth.uid()) or s.insurer_org_id in (select private.user_org_ids()))
    )
  )$p$);
select private.ensure_policy('instalments', 'instalments: staff manage', $p$
  create policy "instalments: staff manage" on public.instalments for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

select private.ensure_policy('micro_sessions', 'micro sessions: parties read', $p$
  create policy "micro sessions: parties read" on public.micro_sessions for select to authenticated
  using (
    customer_id = (select auth.uid())
    or (select private.is_platform_staff())
    or exists (select 1 from public.policies p where p.id = micro_sessions.policy_id and p.insurer_org_id in (select private.user_org_ids()))
  )$p$);
select private.ensure_policy('micro_sessions', 'micro sessions: staff manage', $p$
  create policy "micro sessions: staff manage" on public.micro_sessions for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;
