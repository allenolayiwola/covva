-- =============================================================================
-- Broker scorecards, ratings & reviews, and the in-database analytics layer
-- (roadmap Phase 4: "Broker scorecards … feeding routing priority and shown to
-- customers" and "Analytics warehouse … internal dashboards, anonymised insurer
-- insight reports"). See docs/SCORECARDS_ANALYTICS.md for formulas and rules.
--
-- A. Scorecards
--   * broker_reviews     — one 1–5 star rating (plus optional short text) per completed request
--                          or settled claim, by the customer on it. Moderated: pending → approved
--                          or hidden (staff, with a reason); only approved reviews are public.
--                          The broker may post one reply. Rating and text are immutable.
--   * broker_scorecards  — one row per broker organisation and rolling window (30 / 90 days)
--                          with the raw service measures and the composite score computed by the
--                          server (`@im/core` computeScorecard, cron `scorecard-refresh`).
--   * broker_scorecard_inputs(org, days) — SECURITY DEFINER aggregation of the raw measures
--                          (first response, quote fulfilment, issuance, claims support, SLA
--                          breaches, ratings). Broker members, appointed insurers, staff.
--   * broker_score_summary(ids[]) / broker_public_reviews(id) — the public, anonymised view
--                          (rating from 3 approved reviews, response band, review count,
--                          reviewer shown as "Ama K." or "Verified customer"). Anonymous callers.
--
-- B. Analytics (schema `analytics`, not exposed through PostgREST)
--   * analytics.daily_facts — facts by day × category × region × broker × insurer: requests,
--                          quotes, conversions, policies + premium bands, renewals due/renewed,
--                          claims opened/settled, payment outcomes. No PII.
--   * analytics.rollup_runs — log of every rollup (idempotent per day; dry-run supported).
--   * analytics_rollup(from, to, dry_run) — staff / service role; replaces each day's rows.
--   * analytics_facts(...)   — staff dashboards (group by day/category/region/broker/insurer).
--   * insurer_insight_report(org, month) — anonymised monthly report for an insurer: share of
--                          quotes and wins per category, price position vs the market, renewal
--                          retention, claims timing. Cells under 5 are suppressed; no broker or
--                          customer identities.
--
-- Additive and idempotent: create if not exists / create or replace / guarded policies. No drops.
-- Does not depend on 20261031100100_data_subject_requests or 20261031100300_welfare_groups_diaspora.
-- NOT applied by CI or by the PR author; apply it with the normal migration process.
-- =============================================================================

create or replace function private.ensure_policy(p_table text, p_name text, p_sql text) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;

-- Same helper for a non-public schema (the analytics tables).
create or replace function private.ensure_policy_in(p_schema text, p_table text, p_name text, p_sql text) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_policies where schemaname = p_schema and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;
revoke execute on function private.ensure_policy_in(text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 0. Small pure helpers (mirrored in @im/core scorecards.ts — keep in step)
-- ---------------------------------------------------------------------------
-- Small-cell suppression: counts of 1–4 become null; 0 stays 0 (an empty cell identifies nobody).
create or replace function private.suppress_small(p_count bigint, p_threshold int default 5)
returns int
language sql immutable set search_path = '' as $$
  select case when p_count is null then null when p_count = 0 then 0 when p_count < p_threshold then null else p_count::int end;
$$;

-- Annual premium bands (GHS) used by the pricing distribution.
create or replace function private.premium_band(p_premium numeric)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_premium is null then null
    when p_premium < 500 then 'under_500'
    when p_premium < 2000 then 'from_500_to_2k'
    when p_premium < 10000 then 'from_2k_to_10k'
    else 'over_10k'
  end;
$$;

-- "Ama Kumi" → "Ama K."; a single word, a business or nothing → "Verified customer".
create or replace function private.mask_reviewer_name(p_name text, p_account_type public.account_type)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_account_type = 'business' then 'Verified customer'
    when p_name is null or btrim(p_name) = '' then 'Verified customer'
    when array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) > 1 then private.mask_person_name(p_name)
    else 'Verified customer'
  end;
$$;

-- Response-time band from the median first response (minutes). Null below the minimum sample.
create or replace function private.response_band(p_median_minutes numeric, p_samples int)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_median_minutes is null or coalesce(p_samples, 0) < 5 then null
    when p_median_minutes <= 60 then 'within_hour'
    when p_median_minutes <= 480 then 'same_day'
    when p_median_minutes <= 1440 then 'next_day'
    else 'slower'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Ratings and reviews
-- ---------------------------------------------------------------------------
create table if not exists public.broker_reviews (
  id uuid primary key default gen_random_uuid(),
  broker_org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  subject_type text not null check (subject_type in ('request', 'claim')),
  subject_id uuid not null,
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 600),
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  moderation_reason text check (moderation_reason is null or char_length(moderation_reason) <= 500),
  moderated_by uuid references auth.users (id),
  moderated_at timestamptz,
  reply text check (reply is null or char_length(reply) <= 600),
  replied_by uuid references auth.users (id),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id)
);
comment on table public.broker_reviews is
  'Customer rating (1–5) of the broker of record on a completed request or settled claim; one per subject. Moderated by staff (pending → approved | hidden with a reason); only approved reviews are shown, anonymised. The broker may reply once. Rating and text are immutable.';
comment on column public.broker_reviews.subject_id is 'requests.id or claims.id, by subject_type. The broker is copied from the subject at insert time.';
create index if not exists broker_reviews_broker_idx on public.broker_reviews (broker_org_id, status, created_at desc);
create index if not exists broker_reviews_customer_idx on public.broker_reviews (customer_id, created_at desc);
create index if not exists broker_reviews_status_idx on public.broker_reviews (status, created_at desc) where status = 'pending';

create or replace function private.broker_reviews_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_service boolean := private.is_service_role();
  v_staff boolean := private.is_platform_staff();
  v_req public.requests;
  v_claim public.claims;
begin
  if tg_op = 'INSERT' then
    -- Only the customer on the subject (or trusted server code on their behalf) may rate.
    if not v_service then
      if v_uid is null then
        raise exception 'Sign in to rate your broker' using errcode = 'P0001';
      end if;
      new.customer_id := v_uid;
      new.status := 'pending';
      new.moderation_reason := null; new.moderated_by := null; new.moderated_at := null;
      new.reply := null; new.replied_by := null; new.replied_at := null;
    end if;
    if new.subject_type = 'request' then
      select * into v_req from public.requests r where r.id = new.subject_id;
      if v_req.id is null then
        raise exception 'Request not found' using errcode = 'P0001';
      end if;
      if v_req.customer_id is distinct from new.customer_id then
        raise exception 'Only the customer on the request can rate the broker' using errcode = 'P0001';
      end if;
      if v_req.status <> 'completed' then
        raise exception 'You can rate your broker once the request is completed' using errcode = 'P0001';
      end if;
      if v_req.broker_org_id is null then
        raise exception 'This request had no broker of record to rate' using errcode = 'P0001';
      end if;
      new.broker_org_id := v_req.broker_org_id;
    else
      select * into v_claim from public.claims c where c.id = new.subject_id;
      if v_claim.id is null then
        raise exception 'Claim not found' using errcode = 'P0001';
      end if;
      if v_claim.customer_id is distinct from new.customer_id then
        raise exception 'Only the customer on the claim can rate the broker' using errcode = 'P0001';
      end if;
      if v_claim.status not in ('paid', 'closed') then
        raise exception 'You can rate your broker once the claim is settled' using errcode = 'P0001';
      end if;
      if v_claim.broker_org_id is null then
        raise exception 'This claim had no broker supporting it' using errcode = 'P0001';
      end if;
      new.broker_org_id := v_claim.broker_org_id;
    end if;
    new.comment := nullif(btrim(coalesce(new.comment, '')), '');
    return new;
  end if;

  -- UPDATE: the review itself never changes.
  if new.rating is distinct from old.rating or new.comment is distinct from old.comment
     or new.subject_type is distinct from old.subject_type or new.subject_id is distinct from old.subject_id
     or new.customer_id is distinct from old.customer_id or new.broker_org_id is distinct from old.broker_org_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A review''s rating and text cannot be edited — hide it instead' using errcode = 'P0001';
  end if;

  -- Moderation: staff or the service role.
  if new.status is distinct from old.status or new.moderation_reason is distinct from old.moderation_reason
     or new.moderated_by is distinct from old.moderated_by or new.moderated_at is distinct from old.moderated_at then
    if not (v_service or v_staff) then
      raise exception 'Reviews are moderated by Covva staff' using errcode = 'P0001';
    end if;
    if new.status = 'hidden' and nullif(btrim(coalesce(new.moderation_reason, '')), '') is null then
      raise exception 'Give a reason when hiding a review' using errcode = 'P0001';
    end if;
    if new.status is distinct from old.status then
      new.moderated_by := coalesce(v_uid, new.moderated_by);
      new.moderated_at := now();
    end if;
  end if;

  -- Reply: once, by the broker's team (or staff / service), on an approved review.
  if new.reply is distinct from old.reply or new.replied_by is distinct from old.replied_by or new.replied_at is distinct from old.replied_at then
    if not (v_service or v_staff or private.has_org_role(old.broker_org_id, '{owner,admin,supervisor,adviser}')) then
      raise exception 'Only the broker''s team can reply to this review' using errcode = 'P0001';
    end if;
    if old.reply is not null then
      raise exception 'A review can be answered once' using errcode = 'P0001';
    end if;
    if old.status <> 'approved' then
      raise exception 'You can reply once the review is approved' using errcode = 'P0001';
    end if;
    new.reply := nullif(btrim(coalesce(new.reply, '')), '');
    if new.reply is null then
      raise exception 'Write a reply first' using errcode = 'P0001';
    end if;
    new.replied_by := coalesce(v_uid, new.replied_by);
    new.replied_at := now();
  end if;
  return new;
end $$;

-- Audit without the reviewer's identity or text (the broker's admins can read audit rows for
-- their organisation; the reviewer stays anonymous and pending text stays private).
create or replace function private.write_audit_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb; v_old jsonb; v_changes jsonb := '{}'::jsonb; k text;
  v_hidden text[] := array['customer_id', 'comment', 'reply'];
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    for k in select jsonb_object_keys(v_row) loop
      if k not in ('updated_at') and (v_row -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, case when k = any (v_hidden) then jsonb_build_object('changed', true) else jsonb_build_object('from', v_old -> k, 'to', v_row -> k) end);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, org_id, data)
  values (
    (select auth.uid()),
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    nullif(v_row ->> 'broker_org_id', '')::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('changes', v_changes) else jsonb_build_object('row', v_row - v_hidden) end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'broker_reviews_guard' and tgrelid = 'public.broker_reviews'::regclass) then
    create trigger broker_reviews_guard before insert or update on public.broker_reviews
      for each row execute function private.broker_reviews_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.broker_reviews'::regclass) then
    create trigger set_updated_at before update on public.broker_reviews for each row execute function private.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_broker_reviews' and tgrelid = 'public.broker_reviews'::regclass) then
    create trigger audit_broker_reviews after insert or update or delete on public.broker_reviews
      for each row execute function private.write_audit_review();
  end if;
end $$;

alter table public.broker_reviews enable row level security;
select private.ensure_policy('broker_reviews', 'broker reviews: customer reads own', $p$
  create policy "broker reviews: customer reads own" on public.broker_reviews for select to authenticated
  using (customer_id = (select auth.uid()))$p$);
select private.ensure_policy('broker_reviews', 'broker reviews: staff read', $p$
  create policy "broker reviews: staff read" on public.broker_reviews for select to authenticated
  using ((select private.is_platform_staff()))$p$);
select private.ensure_policy('broker_reviews', 'broker reviews: broker reads approved', $p$
  create policy "broker reviews: broker reads approved" on public.broker_reviews for select to authenticated
  using (status = 'approved' and broker_org_id in (select private.user_org_ids()))$p$);
select private.ensure_policy('broker_reviews', 'broker reviews: customer creates', $p$
  create policy "broker reviews: customer creates" on public.broker_reviews for insert to authenticated
  with check (customer_id = (select auth.uid()))$p$);
select private.ensure_policy('broker_reviews', 'broker reviews: staff moderate', $p$
  create policy "broker reviews: staff moderate" on public.broker_reviews for update to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);
select private.ensure_policy('broker_reviews', 'broker reviews: broker replies', $p$
  create policy "broker reviews: broker replies" on public.broker_reviews for update to authenticated
  using (status = 'approved' and private.has_org_role(broker_org_id, '{owner,admin,supervisor,adviser}'))
  with check (status = 'approved' and private.has_org_role(broker_org_id, '{owner,admin,supervisor,adviser}'))$p$);
-- Anonymous visitors read reviews only through broker_public_reviews() (masked).
revoke all on public.broker_reviews from anon;
revoke delete, truncate on public.broker_reviews from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Scorecard snapshots (written by the server from broker_scorecard_inputs)
-- ---------------------------------------------------------------------------
create table if not exists public.broker_scorecards (
  id uuid primary key default gen_random_uuid(),
  broker_org_id uuid not null references public.organizations (id) on delete cascade,
  window_days int not null check (window_days in (30, 90)),
  computed_at timestamptz not null default now(),
  requests_received int not null default 0,
  requests_completed int not null default 0,
  first_response_median_minutes numeric(10, 1),
  first_response_samples int not null default 0,
  quote_fulfilment_rate numeric(5, 4),
  quote_fulfilment_samples int not null default 0,
  quote_median_hours numeric(10, 1),
  issuance_median_hours numeric(10, 1),
  issuance_samples int not null default 0,
  claims_ack_median_hours numeric(10, 1),
  claims_settle_median_days numeric(10, 1),
  claims_samples int not null default 0,
  sla_measured int not null default 0,
  sla_breached int not null default 0,
  sla_breach_rate numeric(5, 4),
  rating_avg numeric(3, 2),
  rating_count int not null default 0,
  score numeric(5, 1) check (score is null or score between 0 and 100),
  score_band text not null default 'new' check (score_band in ('new', 'needs_attention', 'fair', 'good', 'excellent')),
  components jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (broker_org_id, window_days)
);
comment on table public.broker_scorecards is
  'Broker scorecard per rolling window (30 / 90 days): raw service measures from broker_scorecard_inputs() and the composite score (0–100) with its explainable components, computed by @im/core computeScorecard in the scorecard-refresh job. No customer data. Brokers read their own; insurers read brokers appointed to them; staff read all.';
comment on column public.broker_scorecards.score is 'Composite 0–100, null while there is not enough history (band "new"): a new broker is treated as neutral in routing, never penalised.';
create index if not exists broker_scorecards_window_idx on public.broker_scorecards (window_days, score desc nulls last);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.broker_scorecards'::regclass) then
    create trigger set_updated_at before update on public.broker_scorecards for each row execute function private.set_updated_at();
  end if;
end $$;

alter table public.broker_scorecards enable row level security;
select private.ensure_policy('broker_scorecards', 'broker scorecards: broker reads own', $p$
  create policy "broker scorecards: broker reads own" on public.broker_scorecards for select to authenticated
  using (broker_org_id in (select private.user_org_ids()))$p$);
select private.ensure_policy('broker_scorecards', 'broker scorecards: staff read', $p$
  create policy "broker scorecards: staff read" on public.broker_scorecards for select to authenticated
  using ((select private.is_platform_staff()))$p$);
select private.ensure_policy('broker_scorecards', 'broker scorecards: appointed insurers read', $p$
  create policy "broker scorecards: appointed insurers read" on public.broker_scorecards for select to authenticated
  using (exists (
    select 1 from public.insurer_broker_appointments a
    where a.broker_org_id = broker_scorecards.broker_org_id and a.active
      and a.insurer_org_id in (select private.user_org_ids())
  ))$p$);
-- Writes: service role only (the refresh job). Anonymous callers use broker_score_summary().
revoke all on public.broker_scorecards from anon;
revoke insert, update, delete, truncate on public.broker_scorecards from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Raw scorecard measures for one broker and window
-- ---------------------------------------------------------------------------
create or replace function private.broker_scorecard_inputs(p_broker uuid, p_days int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz := now() - make_interval(days => p_days);
  v_requests int; v_completed int;
  v_fr_median numeric; v_fr_n int;
  v_quote_rate numeric; v_quote_n int; v_quote_median_h numeric;
  v_iss_median_h numeric; v_iss_n int;
  v_ack_median_h numeric; v_settle_median_d numeric; v_claims_n int;
  v_sla_measured int; v_sla_breached int;
  v_rating_avg numeric; v_rating_n int;
begin
  -- Requests received / completed (submitted in the window, broker of record = p_broker).
  select count(*), count(*) filter (where r.status = 'completed')
    into v_requests, v_completed
  from public.requests r
  where r.broker_org_id = p_broker and r.status <> 'draft'
    and coalesce(r.submitted_at, r.created_at) >= v_since;

  -- First response: minutes from submission to the broker's first visible message, timeline
  -- action or quote on the request (customer's clock, not the assignment clock).
  with firsts as (
    select r.id, coalesce(r.submitted_at, r.created_at) as t0,
      least(
        (select min(m.created_at) from public.request_messages m where m.request_id = r.id and m.sender_party = 'broker' and not m.internal),
        (select min(e.created_at) from public.request_events e where e.request_id = r.id and e.actor_party = 'broker' and e.event not in ('offer_accepted', 'offer_declined')),
        (select min(q.created_at) from public.quotes q where q.request_id = r.id and q.broker_org_id = p_broker)
      ) as t1
    from public.requests r
    where r.broker_org_id = p_broker and r.status <> 'draft'
      and coalesce(r.submitted_at, r.created_at) >= v_since
  )
  select percentile_cont(0.5) within group (order by extract(epoch from (t1 - t0)) / 60), count(*)
    into v_fr_median, v_fr_n
  from firsts where t1 is not null and t1 >= t0;

  -- Quote fulfilment: share of quote-flow requests that reached a binding quote, and hours to it.
  with q as (
    select r.id, coalesce(r.submitted_at, r.created_at) as t0,
      (select min(x.created_at) from public.quotes x where x.request_id = r.id and x.status in ('ready_to_accept', 'accepted', 'expired')) as t_bind
    from public.requests r
    where r.broker_org_id = p_broker and r.status <> 'draft' and r.type in ('new_cover', 'renewal', 'switch')
      and coalesce(r.submitted_at, r.created_at) >= v_since
      and (r.status in ('quotes_ready', 'payment_confirmation', 'policy_documents', 'completed', 'closed_no_cover', 'cancelled')
           or coalesce(r.submitted_at, r.created_at) < now() - interval '3 days')
  )
  select count(*), case when count(*) > 0 then (count(*) filter (where t_bind is not null))::numeric / count(*) end,
         percentile_cont(0.5) within group (order by extract(epoch from (t_bind - t0)) / 3600) filter (where t_bind is not null and t_bind >= t0)
    into v_quote_n, v_quote_rate, v_quote_median_h
  from q;

  -- Issuance: hours from the confirmed payment to the insurer issuing the policy.
  with iss as (
    select p.id, p.issued_at,
      (select max(pay.paid_at) from public.payments pay where pay.request_id = p.request_id and pay.status = 'succeeded' and pay.paid_at <= p.issued_at) as paid_at
    from public.policies p
    where p.broker_org_id = p_broker and p.issued_at is not null and p.issued_at >= v_since and not p.external_source
  )
  select percentile_cont(0.5) within group (order by extract(epoch from (issued_at - paid_at)) / 3600), count(*)
    into v_iss_median_h, v_iss_n
  from iss where paid_at is not null;

  -- Claims support: hours to acknowledgement and days to settlement on claims the broker supports.
  select
    percentile_cont(0.5) within group (order by extract(epoch from (c.acknowledged_at - coalesce(c.reported_at, c.created_at))) / 3600) filter (where c.acknowledged_at is not null),
    percentile_cont(0.5) within group (order by extract(epoch from (c.paid_at - coalesce(c.reported_at, c.created_at))) / 86400) filter (where c.paid_at is not null),
    count(*)
    into v_ack_median_h, v_settle_median_d, v_claims_n
  from public.claims c
  where c.broker_org_id = p_broker and c.status <> 'draft' and coalesce(c.reported_at, c.created_at) >= v_since;

  -- SLA breach rate (same rule as partner_sla_performance: measured once completed or past due).
  select
    count(*) filter (where r.completed_at is not null or r.status in ('completed', 'cancelled', 'closed_no_cover') or r.due_at < now()),
    count(*) filter (where r.sla_breached_at is not null or (r.completed_at is not null and r.completed_at > r.due_at))
    into v_sla_measured, v_sla_breached
  from public.requests r
  where r.broker_org_id = p_broker and r.due_at is not null and r.status <> 'draft' and r.created_at >= v_since;

  -- Approved ratings in the window.
  select round(avg(b.rating), 2), count(*)
    into v_rating_avg, v_rating_n
  from public.broker_reviews b
  where b.broker_org_id = p_broker and b.status = 'approved' and b.created_at >= v_since;

  return jsonb_build_object(
    'broker_org_id', p_broker,
    'window_days', p_days,
    'requests_received', coalesce(v_requests, 0),
    'requests_completed', coalesce(v_completed, 0),
    'first_response_median_minutes', round(v_fr_median::numeric, 1),
    'first_response_samples', coalesce(v_fr_n, 0),
    'quote_fulfilment_rate', round(v_quote_rate::numeric, 4),
    'quote_fulfilment_samples', coalesce(v_quote_n, 0),
    'quote_median_hours', round(v_quote_median_h::numeric, 1),
    'issuance_median_hours', round(v_iss_median_h::numeric, 1),
    'issuance_samples', coalesce(v_iss_n, 0),
    'claims_ack_median_hours', round(v_ack_median_h::numeric, 1),
    'claims_settle_median_days', round(v_settle_median_d::numeric, 1),
    'claims_samples', coalesce(v_claims_n, 0),
    'sla_measured', coalesce(v_sla_measured, 0),
    'sla_breached', coalesce(v_sla_breached, 0),
    'rating_avg', v_rating_avg,
    'rating_count', coalesce(v_rating_n, 0),
    'computed_at', now()
  );
end $$;
revoke execute on function private.broker_scorecard_inputs(uuid, int) from public, anon, authenticated;

create or replace function public.broker_scorecard_inputs(p_broker_org_id uuid, p_days int default 90)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_type public.org_type;
begin
  select o.type into v_type from public.organizations o where o.id = p_broker_org_id;
  if v_type is null or v_type <> 'broker' then
    raise exception 'Scorecards exist for broker organisations only' using errcode = 'P0001';
  end if;
  if p_days not in (30, 90) then
    raise exception 'Choose a 30 or 90 day window' using errcode = 'P0001';
  end if;
  if not (private.is_service_role() or private.is_platform_staff() or private.is_org_member(p_broker_org_id)
          or exists (select 1 from public.insurer_broker_appointments a
                     where a.broker_org_id = p_broker_org_id and a.active and a.insurer_org_id in (select private.user_org_ids()))) then
    raise exception 'You are not a member of this organisation' using errcode = '42501';
  end if;
  return private.broker_scorecard_inputs(p_broker_org_id, p_days);
end $$;
comment on function public.broker_scorecard_inputs(uuid, int) is
  'Raw scorecard measures for a broker over a 30 or 90 day window (first response, quote fulfilment, issuance, claims support, SLA breaches, approved ratings). Broker members, insurers with an active appointment, staff.';

-- ---------------------------------------------------------------------------
-- 4. Public, anonymised summaries (anonymous callers: broker picker, partner directory)
-- ---------------------------------------------------------------------------
create or replace function public.broker_score_summary(p_broker_org_ids uuid[])
returns table (
  broker_org_id uuid,
  rating_avg numeric,
  review_count int,
  response_band text,
  score_band text,
  computed_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with ids as (select distinct unnest(p_broker_org_ids) as id),
  rv as (
    select b.broker_org_id, count(*)::int as n, round(avg(b.rating), 1) as avg
    from public.broker_reviews b
    where b.status = 'approved' and b.broker_org_id = any (p_broker_org_ids)
    group by b.broker_org_id
  )
  select ids.id,
         case when coalesce(rv.n, 0) >= 3 then rv.avg else null end,
         coalesce(rv.n, 0),
         private.response_band(sc.first_response_median_minutes, sc.first_response_samples),
         coalesce(sc.score_band, 'new'),
         sc.computed_at
  from ids
  join public.organizations o on o.id = ids.id and o.type = 'broker' and o.status = 'active'
  left join rv on rv.broker_org_id = ids.id
  left join public.broker_scorecards sc on sc.broker_org_id = ids.id and sc.window_days = 90;
$$;
comment on function public.broker_score_summary(uuid[]) is
  'Public scorecard summary for active brokers: average rating (only from 3 approved reviews), number of approved reviews, response-time band (90-day median first response, from 5 samples) and the score band. No customer data.';

create or replace function public.broker_public_reviews(p_broker_org_id uuid, p_limit int default 10)
returns table (
  id uuid,
  rating int,
  comment text,
  reply text,
  display_name text,
  subject_type text,
  created_at timestamptz,
  replied_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select b.id, b.rating, b.comment, b.reply,
         private.mask_reviewer_name(coalesce(pr.preferred_name, pr.full_name), pr.account_type),
         b.subject_type, b.created_at, b.replied_at
  from public.broker_reviews b
  left join public.profiles pr on pr.id = b.customer_id
  where b.broker_org_id = p_broker_org_id and b.status = 'approved'
  order by b.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;
comment on function public.broker_public_reviews(uuid, int) is
  'Approved reviews of a broker, newest first, with the reviewer shown as "Ama K." or "Verified customer". Anonymous callers allowed.';

-- ---------------------------------------------------------------------------
-- 5. Analytics layer
-- ---------------------------------------------------------------------------
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to service_role;

create table if not exists analytics.daily_facts (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  category_id uuid references public.product_categories (id) on delete cascade,
  region text,
  broker_org_id uuid references public.organizations (id) on delete cascade,
  insurer_org_id uuid references public.organizations (id) on delete cascade,
  requests int not null default 0,
  quotes int not null default 0,
  binding_quotes int not null default 0,
  conversions int not null default 0,
  policies_issued int not null default 0,
  premium_sum numeric(16, 2) not null default 0,
  premium_under_500 int not null default 0,
  premium_500_to_2k int not null default 0,
  premium_2k_to_10k int not null default 0,
  premium_over_10k int not null default 0,
  renewals_due int not null default 0,
  renewals_renewed int not null default 0,
  claims_opened int not null default 0,
  claims_settled int not null default 0,
  payments_succeeded int not null default 0,
  payments_failed int not null default 0,
  computed_at timestamptz not null default now(),
  unique nulls not distinct (day, category_id, region, broker_org_id, insurer_org_id)
);
comment on table analytics.daily_facts is
  'Daily rollup of platform facts by category × region × broker × insurer (null = not applicable). Rebuilt per day by analytics_rollup(); no PII (region is the Ghana region only). Read through analytics_facts() (staff) and insurer_insight_report() (insurer members, suppressed).';
create index if not exists daily_facts_day_idx on analytics.daily_facts (day);
create index if not exists daily_facts_insurer_idx on analytics.daily_facts (insurer_org_id, day) where insurer_org_id is not null;

create table if not exists analytics.rollup_runs (
  id uuid primary key default gen_random_uuid(),
  from_day date not null,
  to_day date not null,
  dry_run boolean not null default false,
  days int not null default 0,
  rows_written int not null default 0,
  duration_ms int,
  triggered_by uuid,
  actor_role text,
  created_at timestamptz not null default now()
);
comment on table analytics.rollup_runs is 'One row per analytics_rollup() call (including dry runs). Audited; daily_facts itself is derived data and not audited.';

alter table analytics.daily_facts enable row level security;
alter table analytics.rollup_runs enable row level security;
-- Staff may read the raw tables when a schema is exposed; everyone else goes through the functions.
select private.ensure_policy_in('analytics', 'daily_facts', 'analytics facts: staff read', $p$
  create policy "analytics facts: staff read" on analytics.daily_facts for select to authenticated
  using ((select private.is_platform_staff()))$p$);
select private.ensure_policy_in('analytics', 'rollup_runs', 'analytics runs: staff read', $p$
  create policy "analytics runs: staff read" on analytics.rollup_runs for select to authenticated
  using ((select private.is_platform_staff()))$p$);
revoke all on analytics.daily_facts from anon, authenticated;
revoke all on analytics.rollup_runs from anon, authenticated;
grant select on analytics.daily_facts, analytics.rollup_runs to authenticated;
grant all on analytics.daily_facts, analytics.rollup_runs to service_role;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_rollup_runs' and tgrelid = 'analytics.rollup_runs'::regclass) then
    create trigger audit_rollup_runs after insert on analytics.rollup_runs for each row execute function private.write_audit();
  end if;
end $$;

-- Rebuilds one day. Returns the number of fact rows for that day (written, or counted on a dry run).
create or replace function private.analytics_rollup_day(p_day date, p_dry_run boolean)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  if to_regclass('pg_temp._facts_day') is null then
    create temp table _facts_day (
      category_id uuid, region text, broker_org_id uuid, insurer_org_id uuid,
      requests int, quotes int, binding_quotes int, conversions int, policies_issued int, premium_sum numeric,
      premium_under_500 int, premium_500_to_2k int, premium_2k_to_10k int, premium_over_10k int,
      renewals_due int, renewals_renewed int, claims_opened int, claims_settled int, payments_succeeded int, payments_failed int
    ) on commit drop;
  end if;
  truncate _facts_day;

  insert into _facts_day
  with
  req as (
    select r.category_id, coalesce(nullif(btrim(r.risk_data ->> 'region'), ''), pr.region) as region, r.broker_org_id, null::uuid as insurer_org_id, count(*)::int as n
    from public.requests r left join public.profiles pr on pr.id = r.customer_id
    where r.status <> 'draft' and coalesce(r.submitted_at, r.created_at)::date = p_day
    group by 1, 2, 3
  ),
  quo as (
    select r.category_id, coalesce(nullif(btrim(r.risk_data ->> 'region'), ''), pr.region) as region, q.broker_org_id, q.insurer_org_id,
           count(*)::int as n, count(*) filter (where q.is_binding or q.status in ('ready_to_accept', 'accepted'))::int as binding
    from public.quotes q join public.requests r on r.id = q.request_id left join public.profiles pr on pr.id = r.customer_id
    where q.created_at::date = p_day
    group by 1, 2, 3, 4
  ),
  conv as (
    select r.category_id, coalesce(nullif(btrim(r.risk_data ->> 'region'), ''), pr.region) as region, q.broker_org_id, q.insurer_org_id, count(*)::int as n
    from public.applications a join public.quotes q on q.id = a.quote_id join public.requests r on r.id = a.request_id left join public.profiles pr on pr.id = r.customer_id
    where a.status = 'accepted' and coalesce(a.decided_at, a.updated_at)::date = p_day
    group by 1, 2, 3, 4
  ),
  pol as (
    select p.category_id, coalesce(nullif(btrim(r.risk_data ->> 'region'), ''), pr.region) as region, p.broker_org_id, p.insurer_org_id,
           count(*)::int as n, sum(coalesce(p.premium, 0)) as premium,
           count(*) filter (where private.premium_band(p.premium) = 'under_500')::int as b1,
           count(*) filter (where private.premium_band(p.premium) = 'from_500_to_2k')::int as b2,
           count(*) filter (where private.premium_band(p.premium) = 'from_2k_to_10k')::int as b3,
           count(*) filter (where private.premium_band(p.premium) = 'over_10k')::int as b4
    from public.policies p left join public.requests r on r.id = p.request_id left join public.profiles pr on pr.id = p.customer_id
    where p.issued_at::date = p_day and not p.external_source
    group by 1, 2, 3, 4
  ),
  ren as (
    select p.category_id, coalesce(nullif(btrim(r.risk_data ->> 'region'), ''), pr.region) as region, p.broker_org_id, p.insurer_org_id,
           count(*)::int as due,
           count(*) filter (where p.status = 'renewed' or exists (
             select 1 from public.requests x where x.related_policy_id = p.id and x.type = 'renewal' and x.status = 'completed'))::int as renewed
    from public.policies p left join public.requests r on r.id = p.request_id left join public.profiles pr on pr.id = p.customer_id
    where p.cover_end = p_day and not p.external_source and p.status <> 'pending_issuance'
    group by 1, 2, 3, 4
  ),
  clm as (
    select p.category_id, coalesce(nullif(btrim(r.risk_data ->> 'region'), ''), pr.region) as region, c.broker_org_id, c.insurer_org_id,
           count(*) filter (where coalesce(c.reported_at, c.created_at)::date = p_day)::int as opened,
           count(*) filter (where c.paid_at::date = p_day)::int as settled
    from public.claims c join public.policies p on p.id = c.policy_id left join public.requests r on r.id = p.request_id left join public.profiles pr on pr.id = c.customer_id
    where c.status <> 'draft' and (coalesce(c.reported_at, c.created_at)::date = p_day or c.paid_at::date = p_day)
    group by 1, 2, 3, 4
  ),
  pay as (
    select r.category_id, coalesce(nullif(btrim(r.risk_data ->> 'region'), ''), pr.region) as region, r.broker_org_id, pay.payee_org_id as insurer_org_id,
           count(*) filter (where pay.status = 'succeeded' and pay.paid_at::date = p_day)::int as ok,
           count(*) filter (where pay.status = 'failed' and pay.updated_at::date = p_day)::int as failed
    from public.payments pay join public.requests r on r.id = pay.request_id left join public.profiles pr on pr.id = pay.customer_id
    where (pay.status = 'succeeded' and pay.paid_at::date = p_day) or (pay.status = 'failed' and pay.updated_at::date = p_day)
    group by 1, 2, 3, 4
  ),
  u as (
    select category_id, region, broker_org_id, insurer_org_id, n as requests, 0 as quotes, 0 as binding_quotes, 0 as conversions, 0 as policies_issued, 0::numeric as premium_sum, 0 as b1, 0 as b2, 0 as b3, 0 as b4, 0 as renewals_due, 0 as renewals_renewed, 0 as claims_opened, 0 as claims_settled, 0 as payments_succeeded, 0 as payments_failed from req
    union all select category_id, region, broker_org_id, insurer_org_id, 0, n, binding, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 from quo
    union all select category_id, region, broker_org_id, insurer_org_id, 0, 0, 0, n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 from conv
    union all select category_id, region, broker_org_id, insurer_org_id, 0, 0, 0, 0, n, premium, b1, b2, b3, b4, 0, 0, 0, 0, 0, 0 from pol
    union all select category_id, region, broker_org_id, insurer_org_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, due, renewed, 0, 0, 0, 0 from ren
    union all select category_id, region, broker_org_id, insurer_org_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, opened, settled, 0, 0 from clm
    union all select category_id, region, broker_org_id, insurer_org_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ok, failed from pay
  )
  select category_id, region, broker_org_id, insurer_org_id,
         sum(requests)::int, sum(quotes)::int, sum(binding_quotes)::int, sum(conversions)::int, sum(policies_issued)::int, sum(premium_sum),
         sum(b1)::int, sum(b2)::int, sum(b3)::int, sum(b4)::int,
         sum(renewals_due)::int, sum(renewals_renewed)::int, sum(claims_opened)::int, sum(claims_settled)::int, sum(payments_succeeded)::int, sum(payments_failed)::int
  from u
  group by 1, 2, 3, 4;

  select count(*) into v_rows from _facts_day;
  if not p_dry_run then
    delete from analytics.daily_facts f where f.day = p_day;
    insert into analytics.daily_facts (day, category_id, region, broker_org_id, insurer_org_id, requests, quotes, binding_quotes, conversions, policies_issued, premium_sum,
      premium_under_500, premium_500_to_2k, premium_2k_to_10k, premium_over_10k, renewals_due, renewals_renewed, claims_opened, claims_settled, payments_succeeded, payments_failed, computed_at)
    select p_day, category_id, region, broker_org_id, insurer_org_id, requests, quotes, binding_quotes, conversions, policies_issued, premium_sum,
      premium_under_500, premium_500_to_2k, premium_2k_to_10k, premium_over_10k, renewals_due, renewals_renewed, claims_opened, claims_settled, payments_succeeded, payments_failed, now()
    from _facts_day;
  end if;
  return v_rows;
end $$;
revoke execute on function private.analytics_rollup_day(date, boolean) from public, anon, authenticated;

create or replace function public.analytics_rollup(p_from date default (current_date - 1), p_to date default current_date, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz := clock_timestamp();
  v_day date;
  v_rows int := 0;
  v_days int := 0;
begin
  if not (private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only platform staff can run the analytics rollup' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'The end of the range must not be before its start' using errcode = 'P0001';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Backfill at most 400 days per run' using errcode = 'P0001';
  end if;
  v_day := p_from;
  while v_day <= p_to loop
    v_rows := v_rows + private.analytics_rollup_day(v_day, coalesce(p_dry_run, false));
    v_days := v_days + 1;
    v_day := v_day + 1;
  end loop;
  insert into analytics.rollup_runs (from_day, to_day, dry_run, days, rows_written, duration_ms, triggered_by, actor_role)
  values (p_from, p_to, coalesce(p_dry_run, false), v_days, v_rows, (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int, (select auth.uid()),
          coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user));
  return jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days, 'rows', v_rows, 'dry_run', coalesce(p_dry_run, false),
                            'ms', (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int);
end $$;
comment on function public.analytics_rollup(date, date, boolean) is
  'Rebuilds analytics.daily_facts for every day in the range (idempotent: each day is replaced). Dry run counts without writing. Staff and the service role (cron analytics-rollup).';

create or replace function public.analytics_facts(
  p_from date, p_to date, p_group text default 'day',
  p_category_id uuid default null, p_region text default null, p_broker_org_id uuid default null, p_insurer_org_id uuid default null)
returns table (
  key text,
  requests bigint, quotes bigint, binding_quotes bigint, conversions bigint, policies_issued bigint, premium_sum numeric,
  premium_under_500 bigint, premium_500_to_2k bigint, premium_2k_to_10k bigint, premium_over_10k bigint,
  renewals_due bigint, renewals_renewed bigint, claims_opened bigint, claims_settled bigint, payments_succeeded bigint, payments_failed bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only platform staff can read the analytics facts' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a range of at most 400 days, end after start' using errcode = 'P0001';
  end if;
  if p_group not in ('day', 'category', 'region', 'broker', 'insurer', 'total') then
    raise exception 'Group by day, category, region, broker, insurer or total' using errcode = 'P0001';
  end if;
  return query
  select
    case p_group
      when 'day' then f.day::text
      when 'category' then f.category_id::text
      when 'region' then f.region
      when 'broker' then f.broker_org_id::text
      when 'insurer' then f.insurer_org_id::text
      else 'total' end as key,
    sum(f.requests), sum(f.quotes), sum(f.binding_quotes), sum(f.conversions), sum(f.policies_issued), sum(f.premium_sum),
    sum(f.premium_under_500), sum(f.premium_500_to_2k), sum(f.premium_2k_to_10k), sum(f.premium_over_10k),
    sum(f.renewals_due), sum(f.renewals_renewed), sum(f.claims_opened), sum(f.claims_settled), sum(f.payments_succeeded), sum(f.payments_failed)
  from analytics.daily_facts f
  where f.day between p_from and p_to
    and (p_category_id is null or f.category_id = p_category_id)
    and (p_region is null or f.region = p_region)
    and (p_broker_org_id is null or f.broker_org_id = p_broker_org_id)
    and (p_insurer_org_id is null or f.insurer_org_id = p_insurer_org_id)
  group by 1
  order by 1;
end $$;
comment on function public.analytics_facts(date, date, text, uuid, text, uuid, uuid) is
  'Aggregated daily facts for the admin dashboards (funnel, pricing bands, renewals, claims, payments), grouped by day / category / region / broker / insurer / total with optional filters. Staff only.';

-- Monthly anonymised insight report for an insurer. Every count under 5 is null (suppressed); shares
-- and averages built on suppressed counts are null too. No broker or customer identities.
create or replace function public.insurer_insight_report(p_insurer_org_id uuid, p_month text default to_char(current_date, 'YYYY-MM'))
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_type public.org_type;
  v_start date;
  v_end date;
  v_cats jsonb;
begin
  v_type := private.partner_org_gate(p_insurer_org_id);
  if v_type <> 'insurer' then
    raise exception 'Insight reports are produced for insurer organisations' using errcode = 'P0001';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must look like YYYY-MM' using errcode = 'P0001';
  end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month - 1 day')::date;

  with cats as (
    select c.id, c.name, c.slug from public.product_categories c
  ),
  facts as (
    select f.category_id,
           sum(f.quotes) as market_quotes, sum(f.quotes) filter (where f.insurer_org_id = p_insurer_org_id) as my_quotes,
           sum(f.policies_issued) as market_wins, sum(f.policies_issued) filter (where f.insurer_org_id = p_insurer_org_id) as my_wins,
           sum(f.renewals_due) as market_due, sum(f.renewals_renewed) as market_renewed,
           sum(f.renewals_due) filter (where f.insurer_org_id = p_insurer_org_id) as my_due,
           sum(f.renewals_renewed) filter (where f.insurer_org_id = p_insurer_org_id) as my_renewed,
           sum(f.claims_opened) filter (where f.insurer_org_id = p_insurer_org_id) as my_claims_opened,
           sum(f.claims_settled) filter (where f.insurer_org_id = p_insurer_org_id) as my_claims_settled,
           sum(f.claims_opened) as market_claims_opened
    from analytics.daily_facts f
    where f.day between v_start and v_end and f.category_id is not null
    group by f.category_id
  ),
  price as (
    select r.category_id,
           count(*) filter (where q.insurer_org_id = p_insurer_org_id) as my_n,
           count(*) as market_n,
           percentile_cont(0.5) within group (order by q.premium) filter (where q.insurer_org_id = p_insurer_org_id) as my_median,
           percentile_cont(0.5) within group (order by q.premium) as market_median
    from public.quotes q join public.requests r on r.id = q.request_id
    where q.created_at >= v_start::timestamptz and q.created_at < (v_end + 1)::timestamptz and q.status in ('ready_to_accept', 'accepted', 'expired')
    group by r.category_id
  ),
  claims as (
    select p.category_id,
           count(*) filter (where c.insurer_org_id = p_insurer_org_id and c.paid_at is not null) as my_settled_n,
           count(*) filter (where c.paid_at is not null) as market_settled_n,
           percentile_cont(0.5) within group (order by extract(epoch from (c.paid_at - coalesce(c.reported_at, c.created_at))) / 86400) filter (where c.insurer_org_id = p_insurer_org_id and c.paid_at is not null) as my_days,
           percentile_cont(0.5) within group (order by extract(epoch from (c.paid_at - coalesce(c.reported_at, c.created_at))) / 86400) filter (where c.paid_at is not null) as market_days
    from public.claims c join public.policies p on p.id = c.policy_id
    where c.paid_at >= v_start::timestamptz and c.paid_at < (v_end + 1)::timestamptz
    group by p.category_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', cats.id,
    'category_name', cats.name,
    'category_slug', cats.slug,
    'quotes', jsonb_build_object(
      'mine', private.suppress_small(f.my_quotes), 'market', private.suppress_small(f.market_quotes),
      'share', case when private.suppress_small(f.my_quotes) is not null and private.suppress_small(f.market_quotes) > 0 then round(f.my_quotes::numeric / f.market_quotes, 3) end),
    'wins', jsonb_build_object(
      'mine', private.suppress_small(f.my_wins), 'market', private.suppress_small(f.market_wins),
      'share', case when private.suppress_small(f.my_wins) is not null and private.suppress_small(f.market_wins) > 0 then round(f.my_wins::numeric / f.market_wins, 3) end),
    'price', jsonb_build_object(
      'my_median', case when private.suppress_small(pr.my_n) > 0 then round(pr.my_median::numeric, 2) end,
      'market_median', case when private.suppress_small(pr.market_n) > 0 then round(pr.market_median::numeric, 2) end,
      'position', case when private.suppress_small(pr.my_n) > 0 and private.suppress_small(pr.market_n) > 0 and pr.market_median > 0 then
                   case when pr.my_median < pr.market_median * 0.9 then 'below' when pr.my_median > pr.market_median * 1.1 then 'above' else 'in_line' end end),
    'renewals', jsonb_build_object(
      'due', private.suppress_small(f.my_due), 'renewed', private.suppress_small(f.my_renewed),
      'retention', case when private.suppress_small(f.my_due) > 0 then round(coalesce(f.my_renewed, 0)::numeric / f.my_due, 3) end,
      'market_retention', case when private.suppress_small(f.market_due) > 0 then round(coalesce(f.market_renewed, 0)::numeric / f.market_due, 3) end),
    'claims', jsonb_build_object(
      'opened', private.suppress_small(f.my_claims_opened), 'settled', private.suppress_small(f.my_claims_settled),
      'market_opened', private.suppress_small(f.market_claims_opened),
      'median_days_to_settle', case when private.suppress_small(cl.my_settled_n) > 0 then round(cl.my_days::numeric, 1) end,
      'market_median_days_to_settle', case when private.suppress_small(cl.market_settled_n) > 0 then round(cl.market_days::numeric, 1) end)
  ) order by cats.name), '[]'::jsonb)
  into v_cats
  from cats
  left join facts f on f.category_id = cats.id
  left join price pr on pr.category_id = cats.id
  left join claims cl on cl.category_id = cats.id
  where f.category_id is not null or pr.category_id is not null or cl.category_id is not null;

  return jsonb_build_object(
    'insurer_org_id', p_insurer_org_id,
    'month', p_month,
    'period_start', v_start,
    'period_end', v_end,
    'suppression_threshold', 5,
    'categories', v_cats,
    'generated_at', now()
  );
end $$;
comment on function public.insurer_insight_report(uuid, text) is
  'Anonymised monthly market insight for an insurer: per category, share of quotes and of policies won, price position vs the market median (±10 %), renewal retention vs market, claims timing. Counts under 5 are suppressed. Members of the insurer, staff.';

-- ---------------------------------------------------------------------------
-- 6. Settings
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, description) values
 ('routing.scorecard_weight', '10', 'Routing points (± at most this many) a broker''s 90-day scorecard adds to its pool ranking. 0 disables. New brokers without a score are neutral.'),
 ('scorecards.min_reviews', '3', 'Approved reviews needed before a broker''s average rating is shown to customers.'),
 ('scorecards.min_samples', '5', 'Measured requests / claims needed before a scorecard component counts.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
grant execute on function public.broker_scorecard_inputs(uuid, int) to authenticated, service_role;
revoke execute on function public.broker_scorecard_inputs(uuid, int) from public, anon;
grant execute on function public.broker_score_summary(uuid[]) to anon, authenticated, service_role;
grant execute on function public.broker_public_reviews(uuid, int) to anon, authenticated, service_role;
grant execute on function public.analytics_rollup(date, date, boolean) to authenticated, service_role;
revoke execute on function public.analytics_rollup(date, date, boolean) from public, anon;
grant execute on function public.analytics_facts(date, date, text, uuid, text, uuid, uuid) to authenticated, service_role;
revoke execute on function public.analytics_facts(date, date, text, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.insurer_insight_report(uuid, text) to authenticated, service_role;
revoke execute on function public.insurer_insight_report(uuid, text) from public, anon;
-- Private helpers are called only from the SECURITY DEFINER functions and triggers above.
revoke execute on function private.suppress_small(bigint, int) from public, anon, authenticated;
revoke execute on function private.premium_band(numeric) from public, anon, authenticated;
revoke execute on function private.mask_reviewer_name(text, public.account_type) from public, anon, authenticated;
revoke execute on function private.response_band(numeric, int) from public, anon, authenticated;
