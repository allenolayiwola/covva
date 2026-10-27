-- =============================================================================
-- Phase 4 — Loyalty & rewards rules engine + motor telematics (additive; no drops, no deletes).
--
--   * loyalty_rule_sets     — one PUBLISHED rule set per insurer (insurer_org_id) or for the platform
--                             fallback (insurer_org_id null). Immutable versions: every change made by an
--                             insurer admin (partner workspace) or staff (admin console, fallback) is a new
--                             row through public.publish_loyalty_rule_set(); the previous one becomes
--                             `superseded`. Rules are explicit JSON definitions validated by
--                             private.validate_loyalty_rules (mirrors validateLoyaltyRuleSet in @im/core).
--   * quote_discounts       — the explicit discount LINE ITEMS the engine adds to a quote (never a change
--                             to the base premium). Written by the server (service role) only; read by the
--                             customer, the broker and the insurer of the quote, and staff. Discounts are
--                             the insurer's money — Covva only records them.
--   * consent_type gains `telematics`. Consent is captured in-app (consents table, append-only) before an
--                             enrolment; withdrawal is a `granted = false` row + enrolment status.
--   * telematics_enrolments — a motor policy + user + device + the consent row it relies on.
--   * telematics_trips      — trip SUMMARIES only (times, distance, speed band, harsh counts, night share,
--                             phone-use flag). No GPS trace is ever stored. Inserts are refused once the
--                             enrolment is withdrawn or the consent is no longer granted (guard trigger).
--   * telematics_scores     — monthly score 0–100 with the factor breakdown (final per month, provisional
--                             for the current month). The insurer of the policy reads scores only — never
--                             trips.
--   * Act 843: retention class `telematics_trips` (private.apply_retention) and the deletion workflow
--                             (private.anonymise_subject) cover the new tables. The two functions are
--                             renamed to *_base and wrapped so this migration stays additive.
--
-- The new enum value cannot be used as an enum literal inside the same transaction, so comparisons here
-- use `type::text = 'telematics'`; the literal is only used inside function bodies that run later.
-- =============================================================================

alter type public.consent_type add value if not exists 'telematics';

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
-- Member (any active role) of the insurer that holds the policy.
create or replace function private.is_policy_insurer_member(p_policy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.policies p
    where p.id = p_policy and p.insurer_org_id in (select private.user_org_ids())
  );
$$;

-- Latest telematics consent decision for a user (true only when the newest row is `granted`).
create or replace function private.telematics_consent_granted(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select c.granted from public.consents c
    where c.user_id = p_user and c.type::text = 'telematics'
    order by c.created_at desc, c.id desc
    limit 1
  ), false);
$$;

create or replace function private.latest_telematics_consent_id(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.consents c
  where c.user_id = p_user and c.type::text = 'telematics' and c.granted
  order by c.created_at desc, c.id desc
  limit 1;
$$;

revoke all on function private.is_policy_insurer_member(uuid), private.telematics_consent_granted(uuid), private.latest_telematics_consent_id(uuid) from public, anon;
grant execute on function private.is_policy_insurer_member(uuid), private.telematics_consent_granted(uuid), private.latest_telematics_consent_id(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Loyalty rule sets (versioned, immutable once published)
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_rule_sets (
  id uuid primary key default gen_random_uuid(),
  insurer_org_id uuid references public.organizations (id),
  version integer not null default 1,
  status text not null default 'published',
  max_combined_pct numeric(5, 2) not null default 25,
  stacking_order text[] not null default '{no_claims,loyalty_tier,bundle,early_renewal,safe_driver,referral_credit}',
  rules jsonb not null default '[]'::jsonb,
  effective_from date not null default current_date,
  effective_to date,
  note text,
  created_by uuid references auth.users (id),
  published_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_rule_sets_status_check check (status in ('published', 'superseded')),
  constraint loyalty_rule_sets_max_check check (max_combined_pct >= 0 and max_combined_pct <= 100),
  constraint loyalty_rule_sets_version_check check (version >= 1),
  constraint loyalty_rule_sets_dates_check check (effective_to is null or effective_to >= effective_from),
  constraint loyalty_rule_sets_note_check check (note is null or length(note) <= 500)
);
comment on table public.loyalty_rule_sets is
  'Per-insurer loyalty / reward rules (insurer_org_id null = platform fallback used when the insurer has none). Immutable versions published through publish_loyalty_rule_set(); rules = [{ key, type (no_claims | loyalty_tier | bundle | early_renewal | safe_driver | referral_credit), active, effective_from, effective_to, pct, max_pct, max_amount, tiers[], min_categories, days_before_expiry, min_months, categories[], renewal_only }]. Evaluated by @im/core evaluateLoyalty(): explicit discount lines, stacking order, per-rule caps and max_combined_pct. Discounts are the insurer''s.';
comment on column public.loyalty_rule_sets.stacking_order is 'Order in which rule types are applied; the rule that crosses max_combined_pct is cut to the cap and later percentage rules are skipped. Referral credits sit outside the cap.';
create unique index if not exists loyalty_rule_sets_scope_version_uidx on public.loyalty_rule_sets (coalesce(insurer_org_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
create unique index if not exists loyalty_rule_sets_one_published_uidx on public.loyalty_rule_sets (coalesce(insurer_org_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'published';
create index if not exists loyalty_rule_sets_insurer_idx on public.loyalty_rule_sets (insurer_org_id, version desc);

-- Validation shared by the guard and the RPC (mirrors validateLoyaltyRuleSet in @im/core).
create or replace function private.validate_loyalty_rules(p_rules jsonb, p_max_combined numeric, p_order text[]) returns void
language plpgsql immutable set search_path = '' as $$
declare
  r jsonb; t jsonb; k text; ty text; v numeric; n int := 0;
  keys text[] := '{}';
  allowed constant text[] := '{no_claims,loyalty_tier,bundle,early_renewal,safe_driver,referral_credit}';
  o text;
begin
  if p_max_combined is null or p_max_combined < 0 or p_max_combined > 100 then
    raise exception 'The maximum combined discount must be between 0 and 100%%' using errcode = 'P0001';
  end if;
  if p_order is not null then
    foreach o in array p_order loop
      if not (o = any (allowed)) then
        raise exception 'Unknown rule type % in the stacking order', o using errcode = 'P0001';
      end if;
    end loop;
    if (select count(distinct x) from unnest(p_order) x) <> coalesce(array_length(p_order, 1), 0) then
      raise exception 'The stacking order lists a rule type twice' using errcode = 'P0001';
    end if;
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    raise exception 'Rules must be a list' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rules) > 40 then
    raise exception 'At most 40 rules per set' using errcode = 'P0001';
  end if;
  for r in select * from jsonb_array_elements(p_rules) loop
    n := n + 1;
    if jsonb_typeof(r) <> 'object' then
      raise exception 'Rule % must be an object', n using errcode = 'P0001';
    end if;
    k := lower(btrim(coalesce(r ->> 'key', '')));
    if k !~ '^[a-z0-9_]{2,40}$' then
      raise exception 'Rule %: the key must be 2–40 lower-case letters, digits or underscores', n using errcode = 'P0001';
    end if;
    if k = any (keys) then
      raise exception 'Rule "%": duplicate key', k using errcode = 'P0001';
    end if;
    keys := keys || k;
    ty := r ->> 'type';
    if ty is null or not (ty = any (allowed)) then
      raise exception 'Rule "%": unknown rule type %', k, coalesce(ty, '(none)') using errcode = 'P0001';
    end if;
    if r ? 'pct' and ((r ->> 'pct')::numeric < 0 or (r ->> 'pct')::numeric > 100) then
      raise exception 'Rule "%": the percentage must be between 0 and 100', k using errcode = 'P0001';
    end if;
    if r ? 'max_pct' and ((r ->> 'max_pct')::numeric < 0 or (r ->> 'max_pct')::numeric > 100) then
      raise exception 'Rule "%": the maximum percentage must be between 0 and 100', k using errcode = 'P0001';
    end if;
    if r ? 'max_amount' and (r ->> 'max_amount')::numeric < 0 then
      raise exception 'Rule "%": the maximum amount cannot be negative', k using errcode = 'P0001';
    end if;
    if (r ->> 'effective_from') is not null and (r ->> 'effective_to') is not null and (r ->> 'effective_to')::date < (r ->> 'effective_from')::date then
      raise exception 'Rule "%": the end date is before the start date', k using errcode = 'P0001';
    end if;
    if r ? 'min_categories' and ((r ->> 'min_categories')::numeric < 2 or (r ->> 'min_categories')::numeric > 10) then
      raise exception 'Rule "%": a bundle needs between 2 and 10 cover types', k using errcode = 'P0001';
    end if;
    if r ? 'days_before_expiry' and ((r ->> 'days_before_expiry')::numeric < 1 or (r ->> 'days_before_expiry')::numeric > 120) then
      raise exception 'Rule "%": the early-renewal window must be 1–120 days', k using errcode = 'P0001';
    end if;
    if r ? 'min_months' and ((r ->> 'min_months')::numeric < 1 or (r ->> 'min_months')::numeric > 24) then
      raise exception 'Rule "%": months of data must be 1–24', k using errcode = 'P0001';
    end if;
    if r ? 'tiers' then
      if jsonb_typeof(r -> 'tiers') <> 'array' then
        raise exception 'Rule "%": tiers must be a list', k using errcode = 'P0001';
      end if;
      for t in select * from jsonb_array_elements(r -> 'tiers') loop
        v := (t ->> 'pct')::numeric;
        if v is null or v < 0 or v > 100 then
          raise exception 'Rule "%": a tier percentage is outside 0–100', k using errcode = 'P0001';
        end if;
        if t ? 'years' and ((t ->> 'years')::numeric < 0 or (t ->> 'years')::numeric > 50) then
          raise exception 'Rule "%": tier years must be 0–50', k using errcode = 'P0001';
        end if;
        if t ? 'score' and ((t ->> 'score')::numeric < 0 or (t ->> 'score')::numeric > 100) then
          raise exception 'Rule "%": tier score must be 0–100', k using errcode = 'P0001';
        end if;
      end loop;
    end if;
    if coalesce((r ->> 'active')::boolean, false) then
      if ty in ('no_claims', 'loyalty_tier', 'safe_driver')
         and not exists (select 1 from jsonb_array_elements(coalesce(r -> 'tiers', '[]'::jsonb)) x where (x ->> 'pct')::numeric > 0) then
        raise exception 'Rule "%": add at least one tier with a percentage above 0', k using errcode = 'P0001';
      end if;
      if ty in ('bundle', 'early_renewal') and coalesce((r ->> 'pct')::numeric, 0) <= 0 then
        raise exception 'Rule "%": set a percentage above 0', k using errcode = 'P0001';
      end if;
      if ty = 'referral_credit' and coalesce((r ->> 'max_pct')::numeric, 0) <= 0 and coalesce((r ->> 'max_amount')::numeric, 0) <= 0 then
        raise exception 'Rule "%": set a maximum percentage or amount for credit redemption', k using errcode = 'P0001';
      end if;
    end if;
  end loop;
end $$;
revoke all on function private.validate_loyalty_rules(jsonb, numeric, text[]) from public, anon;
grant execute on function private.validate_loyalty_rules(jsonb, numeric, text[]) to authenticated, service_role;

create or replace function private.loyalty_rule_sets_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_type text;
begin
  if tg_op = 'UPDATE' then
    -- Versions are immutable: only the published → superseded transition (and its timestamp) may change.
    if new.insurer_org_id is distinct from old.insurer_org_id or new.version <> old.version or new.rules <> old.rules
       or new.max_combined_pct <> old.max_combined_pct or new.stacking_order <> old.stacking_order
       or new.effective_from <> old.effective_from or new.effective_to is distinct from old.effective_to
       or new.note is distinct from old.note or new.created_by is distinct from old.created_by or new.published_at <> old.published_at then
      raise exception 'A published rule set cannot be edited: publish a new version instead' using errcode = 'P0001';
    end if;
    if old.status = 'superseded' and new.status = 'published' then
      raise exception 'A superseded rule set cannot be re-published: publish a new version instead' using errcode = 'P0001';
    end if;
    if new.status = 'superseded' then new.superseded_at := coalesce(new.superseded_at, now()); end if;
    return new;
  end if;
  if new.insurer_org_id is not null then
    select type::text into v_type from public.organizations where id = new.insurer_org_id;
    if v_type is distinct from 'insurer' then
      raise exception 'Loyalty rules belong to an insurer organisation (or the platform when none is given)' using errcode = 'P0001';
    end if;
  end if;
  perform private.validate_loyalty_rules(new.rules, new.max_combined_pct, new.stacking_order);
  new.status := 'published';
  new.superseded_at := null;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'loyalty_rule_sets_guard' and tgrelid = 'public.loyalty_rule_sets'::regclass) then
    create trigger loyalty_rule_sets_guard before insert or update on public.loyalty_rule_sets
      for each row execute function private.loyalty_rule_sets_guard();
  end if;
end $$;

-- Publish a new version: insurer owners/admins for their own insurer; platform staff for any insurer and
-- for the platform fallback (p_insurer_org_id null). Validates, bumps the version, supersedes the old one.
create or replace function public.publish_loyalty_rule_set(
  p_insurer_org_id uuid,
  p_rules jsonb,
  p_max_combined_pct numeric default 25,
  p_stacking_order text[] default null,
  p_effective_from date default null,
  p_effective_to date default null,
  p_note text default null
) returns public.loyalty_rule_sets
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.loyalty_rule_sets;
  v_version int;
  v_scope uuid := coalesce(p_insurer_org_id, '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if p_insurer_org_id is null then
    if not (private.is_service_role() or (select private.is_platform_staff())) then
      raise exception 'Only platform staff can change the platform fallback rules' using errcode = '42501';
    end if;
  elsif not (private.is_service_role() or (select private.is_platform_staff()) or private.has_org_role(p_insurer_org_id, '{owner,admin}')) then
    raise exception 'Only the insurer''s owners and admins can change its reward rules' using errcode = '42501';
  end if;
  perform private.validate_loyalty_rules(p_rules, p_max_combined_pct, p_stacking_order);
  select coalesce(max(version), 0) + 1 into v_version from public.loyalty_rule_sets
   where coalesce(insurer_org_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_scope;
  update public.loyalty_rule_sets set status = 'superseded', superseded_at = now()
   where coalesce(insurer_org_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_scope and status = 'published';
  insert into public.loyalty_rule_sets (insurer_org_id, version, max_combined_pct, stacking_order, rules, effective_from, effective_to, note, created_by)
  values (
    p_insurer_org_id, v_version, coalesce(p_max_combined_pct, 25),
    coalesce(p_stacking_order, '{no_claims,loyalty_tier,bundle,early_renewal,safe_driver,referral_credit}'),
    p_rules, coalesce(p_effective_from, current_date), p_effective_to, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  )
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.publish_loyalty_rule_set(uuid, jsonb, numeric, text[], date, date, text) from public, anon;
grant execute on function public.publish_loyalty_rule_set(uuid, jsonb, numeric, text[], date, date, text) to authenticated, service_role;

-- The rule set that applies to an insurer today: its own published, in-effect set, else the platform fallback.
create or replace function public.effective_loyalty_rule_set(p_insurer_org_id uuid)
returns public.loyalty_rule_sets
language sql stable security definer set search_path = '' as $$
  select s from public.loyalty_rule_sets s
  where s.status = 'published'
    and s.effective_from <= current_date and (s.effective_to is null or s.effective_to >= current_date)
    and (s.insurer_org_id = p_insurer_org_id or s.insurer_org_id is null)
  order by (s.insurer_org_id is not null) desc
  limit 1;
$$;
revoke all on function public.effective_loyalty_rule_set(uuid) from public, anon;
grant execute on function public.effective_loyalty_rule_set(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Quote discount lines
-- ---------------------------------------------------------------------------
create table if not exists public.quote_discounts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  request_id uuid references public.requests (id) on delete cascade,
  insurer_org_id uuid references public.organizations (id),
  broker_org_id uuid references public.organizations (id),
  rule_set_id uuid references public.loyalty_rule_sets (id),
  rule_set_version integer,
  rule_key text not null,
  rule_type text not null,
  label text not null,
  explanation text not null,
  basis text not null default 'premium',
  pct numeric(5, 2),
  amount numeric(14, 2) not null,
  currency char(3) not null default 'GHS',
  capped boolean not null default false,
  cap_note text,
  evaluation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint quote_discounts_type_check check (rule_type in ('no_claims', 'loyalty_tier', 'bundle', 'early_renewal', 'safe_driver', 'referral_credit')),
  constraint quote_discounts_basis_check check (basis in ('premium', 'credit')),
  constraint quote_discounts_amount_check check (amount > 0),
  constraint quote_discounts_pct_check check (pct is null or (pct >= 0 and pct <= 100)),
  unique (quote_id, rule_key)
);
comment on table public.quote_discounts is
  'Explicit discount line items added to a quote by the loyalty engine (@im/core evaluateLoyalty): the base premium is never changed. One row per applied rule with the plain-language reason; `evaluation` keeps the inputs (claim-free years, bundle, score…) for audit. Written by the server only. Discounts are the insurer''s money.';
create index if not exists quote_discounts_quote_idx on public.quote_discounts (quote_id);
create index if not exists quote_discounts_request_idx on public.quote_discounts (request_id) where request_id is not null;

create or replace function private.quote_discounts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_quote public.quotes;
begin
  select * into v_quote from public.quotes where id = new.quote_id;
  if v_quote.id is null then
    raise exception 'Quote not found' using errcode = 'P0001';
  end if;
  if new.amount > v_quote.premium then
    raise exception 'A discount cannot exceed the premium' using errcode = 'P0001';
  end if;
  new.request_id := v_quote.request_id;
  new.insurer_org_id := v_quote.insurer_org_id;
  new.broker_org_id := v_quote.broker_org_id;
  new.currency := v_quote.currency;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'quote_discounts_guard' and tgrelid = 'public.quote_discounts'::regclass) then
    create trigger quote_discounts_guard before insert on public.quote_discounts
      for each row execute function private.quote_discounts_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Telematics: enrolments, trip summaries, monthly scores
-- ---------------------------------------------------------------------------
create table if not exists public.telematics_enrolments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies (id),
  user_id uuid not null references auth.users (id),
  device_id text,
  device_label text,
  consent_id uuid references public.consents (id),
  consent_version text not null default 'telematics-2026-10',
  status text not null default 'active',
  enrolled_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_reason text,
  months_of_data integer not null default 0,
  latest_score integer,
  last_trip_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telematics_enrolments_status_check check (status in ('active', 'withdrawn')),
  constraint telematics_enrolments_device_check check (device_id is null or length(device_id) between 4 and 120),
  constraint telematics_enrolments_label_check check (device_label is null or length(device_label) <= 80),
  constraint telematics_enrolments_score_check check (latest_score is null or (latest_score between 0 and 100))
);
comment on table public.telematics_enrolments is
  'Consented phone-based driving scoring on one MOTOR policy. consent_id = the consents row (type telematics) the enrolment relies on; withdrawal sets status = withdrawn (+ a granted = false consent row) and stops trip ingestion. Customers see their own rows; staff see all; insurers never read enrolments (they read scores).';
create unique index if not exists telematics_enrolments_one_active_uidx on public.telematics_enrolments (policy_id) where status = 'active';
create index if not exists telematics_enrolments_user_idx on public.telematics_enrolments (user_id, status);
create index if not exists telematics_enrolments_policy_idx on public.telematics_enrolments (policy_id);

create table if not exists public.telematics_trips (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.telematics_enrolments (id) on delete cascade,
  policy_id uuid not null references public.policies (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  distance_km numeric(8, 2) not null,
  max_speed_band text not null,
  harsh_brake_count integer not null default 0,
  harsh_accel_count integer not null default 0,
  night_share numeric(4, 3) not null default 0,
  phone_use boolean not null default false,
  created_at timestamptz not null default now(),
  constraint telematics_trips_trip_id_check check (length(trip_id) between 6 and 80),
  constraint telematics_trips_times_check check (ended_at > started_at and ended_at - started_at <= interval '24 hours'),
  constraint telematics_trips_distance_check check (distance_km > 0 and distance_km <= 2000),
  constraint telematics_trips_band_check check (max_speed_band in ('under_50', '50_80', '80_100', '100_120', 'over_120')),
  constraint telematics_trips_counts_check check (harsh_brake_count between 0 and 500 and harsh_accel_count between 0 and 500),
  constraint telematics_trips_night_check check (night_share >= 0 and night_share <= 1),
  unique (enrolment_id, trip_id)
);
comment on table public.telematics_trips is
  'Trip SUMMARIES only (no GPS trace, no exact speed): start/end, distance, highest speed band, harsh brake / acceleration counts, night share, phone-use flag. Idempotent by (enrolment_id, trip_id). Inserted by the server after enrolment + consent checks; the guard refuses rows once the enrolment is withdrawn. Act 843 retention class telematics_trips (default 395 days; withdrawn enrolments 30 days).';
create index if not exists telematics_trips_enrolment_month_idx on public.telematics_trips (enrolment_id, started_at desc);
create index if not exists telematics_trips_user_idx on public.telematics_trips (user_id, started_at desc);

create table if not exists public.telematics_scores (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.telematics_enrolments (id) on delete cascade,
  policy_id uuid not null references public.policies (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  period date not null,
  score integer,
  factors jsonb not null default '{}'::jsonb,
  trips integer not null default 0,
  distance_km numeric(10, 2) not null default 0,
  final boolean not null default false,
  scoring_version integer not null default 1,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telematics_scores_score_check check (score is null or (score between 0 and 100)),
  constraint telematics_scores_period_check check (extract(day from period) = 1),
  unique (enrolment_id, period)
);
comment on table public.telematics_scores is
  'Monthly driving score (0–100, null when the month had too few trips) with the factor breakdown { speed, harsh, night, phone }. `final` once the month is over (the telematics-scoring cron); the current month is provisional. The insurer of the policy reads scores (never trips); customers read their own; staff all.';
create index if not exists telematics_scores_policy_idx on public.telematics_scores (policy_id, period desc);
create index if not exists telematics_scores_user_idx on public.telematics_scores (user_id, period desc);

-- Enrolment guard: motor policy of the user (not external, not ended), telematics consent granted.
create or replace function private.telematics_enrolments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_policy public.policies; v_slug text;
begin
  if tg_op = 'UPDATE' then
    if new.policy_id <> old.policy_id or new.user_id <> old.user_id or new.enrolled_at <> old.enrolled_at then
      raise exception 'An enrolment''s policy, person and start cannot change' using errcode = 'P0001';
    end if;
    if old.status = 'withdrawn' and new.status = 'active' then
      raise exception 'A withdrawn enrolment cannot be reactivated: enrol again with a fresh consent' using errcode = 'P0001';
    end if;
    if new.status = 'withdrawn' then
      new.withdrawn_at := coalesce(new.withdrawn_at, now());
      new.device_id := null;
    end if;
    return new;
  end if;
  select * into v_policy from public.policies where id = new.policy_id;
  if v_policy.id is null then
    raise exception 'Policy not found' using errcode = 'P0001';
  end if;
  if v_policy.customer_id <> new.user_id then
    raise exception 'Only the policyholder can enrol in driving scoring' using errcode = 'P0001';
  end if;
  select c.slug into v_slug from public.product_categories c where c.id = v_policy.category_id;
  if v_slug is distinct from 'motor' then
    raise exception 'Driving scoring is for motor policies only' using errcode = 'P0001';
  end if;
  if v_policy.external_source then
    raise exception 'Driving scoring needs a policy arranged through Covva (the insurer must support it)' using errcode = 'P0001';
  end if;
  if v_policy.status not in ('pending_issuance', 'active') then
    raise exception 'This policy is % — only current cover can be enrolled', replace(v_policy.status::text, '_', ' ') using errcode = 'P0001';
  end if;
  if not private.telematics_consent_granted(new.user_id) then
    raise exception 'Telematics consent is required before enrolling' using errcode = 'P0001';
  end if;
  new.consent_id := coalesce(new.consent_id, private.latest_telematics_consent_id(new.user_id));
  new.status := 'active';
  new.withdrawn_at := null;
  return new;
end $$;

-- Trip guard: the enrolment must be active and the consent still granted; identity columns come from it.
create or replace function private.telematics_trips_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_enr public.telematics_enrolments;
begin
  select * into v_enr from public.telematics_enrolments where id = new.enrolment_id;
  if v_enr.id is null then
    raise exception 'Enrolment not found' using errcode = 'P0001';
  end if;
  if v_enr.status <> 'active' then
    raise exception 'Driving-score collection has been withdrawn for this policy' using errcode = 'P0001';
  end if;
  if not private.telematics_consent_granted(v_enr.user_id) then
    raise exception 'Telematics consent has been withdrawn' using errcode = 'P0001';
  end if;
  if new.started_at > now() + interval '1 hour' then
    raise exception 'A trip cannot start in the future' using errcode = 'P0001';
  end if;
  new.policy_id := v_enr.policy_id;
  new.user_id := v_enr.user_id;
  return new;
end $$;

create or replace function private.telematics_scores_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_enr public.telematics_enrolments;
begin
  select * into v_enr from public.telematics_enrolments where id = new.enrolment_id;
  if v_enr.id is null then
    raise exception 'Enrolment not found' using errcode = 'P0001';
  end if;
  new.policy_id := v_enr.policy_id;
  new.user_id := v_enr.user_id;
  new.computed_at := now();
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'telematics_enrolments_guard' and tgrelid = 'public.telematics_enrolments'::regclass) then
    create trigger telematics_enrolments_guard before insert or update on public.telematics_enrolments
      for each row execute function private.telematics_enrolments_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'telematics_trips_guard' and tgrelid = 'public.telematics_trips'::regclass) then
    create trigger telematics_trips_guard before insert on public.telematics_trips
      for each row execute function private.telematics_trips_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'telematics_scores_guard' and tgrelid = 'public.telematics_scores'::regclass) then
    create trigger telematics_scores_guard before insert or update on public.telematics_scores
      for each row execute function private.telematics_scores_guard();
  end if;
end $$;

-- Enrol: the signed-in policyholder, after the telematics consent is on file.
create or replace function public.enrol_telematics(p_policy_id uuid, p_device_id text, p_device_label text default null)
returns public.telematics_enrolments
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_row public.telematics_enrolments;
begin
  if v_uid is null then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  -- Ownership first, so nobody learns whether somebody else's policy is enrolled.
  if not exists (select 1 from public.policies p where p.id = p_policy_id and p.customer_id = v_uid) then
    raise exception 'Only the policyholder can enrol in driving scoring' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.telematics_enrolments e where e.policy_id = p_policy_id and e.status = 'active') then
    raise exception 'This policy is already enrolled in driving scoring' using errcode = 'P0001';
  end if;
  insert into public.telematics_enrolments (policy_id, user_id, device_id, device_label)
  values (p_policy_id, v_uid, nullif(btrim(coalesce(p_device_id, '')), ''), nullif(btrim(coalesce(p_device_label, '')), ''))
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.enrol_telematics(uuid, text, text) from public, anon;
grant execute on function public.enrol_telematics(uuid, text, text) to authenticated;

-- Withdraw: the policyholder (or staff / the server). Records a granted = false consent row so the latest
-- decision is "withdrawn"; the enrolment stops accepting trips at once; trips are deleted by retention.
create or replace function public.withdraw_telematics(p_enrolment_id uuid, p_reason text default null)
returns public.telematics_enrolments
language plpgsql security definer set search_path = '' as $$
declare v_row public.telematics_enrolments;
begin
  select * into v_row from public.telematics_enrolments where id = p_enrolment_id;
  if v_row.id is null then
    raise exception 'Enrolment not found' using errcode = 'P0001';
  end if;
  if not (private.is_service_role() or (select private.is_platform_staff()) or v_row.user_id = (select auth.uid())) then
    raise exception 'You cannot change this enrolment' using errcode = '42501';
  end if;
  if v_row.status = 'withdrawn' then
    return v_row;
  end if;
  update public.telematics_enrolments
     set status = 'withdrawn', withdrawn_reason = nullif(left(btrim(coalesce(p_reason, '')), 200), '')
   where id = p_enrolment_id
  returning * into v_row;
  -- No other active enrolment → the person's telematics consent is withdrawn too.
  if not exists (select 1 from public.telematics_enrolments e where e.user_id = v_row.user_id and e.status = 'active') then
    insert into public.consents (user_id, type, version, granted, context)
    values (v_row.user_id, 'telematics'::public.consent_type, v_row.consent_version, false, 'telematics_withdrawal');
  end if;
  return v_row;
end $$;
revoke all on function public.withdraw_telematics(uuid, text) from public, anon;
grant execute on function public.withdraw_telematics(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Act 843: retention class + deletion workflow (wrapped, additive)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.apply_retention_base(text, timestamptz, boolean, int)') is null then
    alter function private.apply_retention(text, timestamptz, boolean, int) rename to apply_retention_base;
  end if;
  if to_regprocedure('private.anonymise_subject_base(uuid, boolean)') is null then
    alter function private.anonymise_subject(uuid, boolean) rename to anonymise_subject_base;
  end if;
end $$;

-- telematics_trips: trips older than the cutoff, plus every trip of an enrolment withdrawn > 30 days ago.
create or replace function private.apply_retention(p_class text, p_cutoff timestamptz, p_dry_run boolean, p_limit int default 5000)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int := 0;
  v_limit int := greatest(1, least(coalesce(p_limit, 5000), 20000));
begin
  if p_class <> 'telematics_trips' then
    return private.apply_retention_base(p_class, p_cutoff, p_dry_run, p_limit);
  end if;
  if p_cutoff is null or p_cutoff > now() - interval '30 days' then
    raise exception 'Retention cutoff for % is too recent (%); periods must be at least 30 days', p_class, p_cutoff using errcode = 'P0001';
  end if;
  if not p_dry_run then
    perform set_config('app.privacy_scrub', '1', true);
  end if;
  with t as (
    select x.id from public.telematics_trips x
      join public.telematics_enrolments e on e.id = x.enrolment_id
     where (x.ended_at < p_cutoff or (e.status = 'withdrawn' and e.withdrawn_at < now() - interval '30 days'))
       and not private.is_test_subject(x.user_id)
     limit v_limit
  ), d as (
    delete from public.telematics_trips x using t where x.id = t.id and not p_dry_run returning 1
  )
  select case when p_dry_run then (select count(*) from t) else (select count(*) from d) end into v_n;
  if not p_dry_run then
    perform set_config('app.privacy_scrub', '', true);
  end if;
  return coalesce(v_n, 0);
end $$;
revoke all on function private.apply_retention(text, timestamptz, boolean, int) from public, anon, authenticated;
grant execute on function private.apply_retention(text, timestamptz, boolean, int) to service_role;

-- Deletion: trips deleted, enrolments withdrawn (device cleared); monthly scores stay with the policy.
create or replace function private.anonymise_subject(p_user uuid, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_trips int; v_enrolments int; v_base jsonb;
begin
  select count(*) into v_trips from public.telematics_trips where user_id = p_user;
  select count(*) into v_enrolments from public.telematics_enrolments where user_id = p_user and (status = 'active' or device_id is not null);
  if not p_dry_run then
    perform set_config('app.privacy_scrub', '1', true);
    delete from public.telematics_trips where user_id = p_user;
    update public.telematics_enrolments set status = 'withdrawn', device_id = null, device_label = null, withdrawn_reason = 'privacy_deletion'
     where user_id = p_user and (status = 'active' or device_id is not null or device_label is not null);
  end if;
  v_base := private.anonymise_subject_base(p_user, p_dry_run);
  return jsonb_set(v_base, '{scrubbed}', coalesce(v_base -> 'scrubbed', '{}'::jsonb) || jsonb_build_object('telematics_trips', v_trips, 'telematics_enrolments', v_enrolments));
end $$;
revoke all on function private.anonymise_subject(uuid, boolean) from public, anon, authenticated;
grant execute on function private.anonymise_subject(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. updated_at + audit triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['loyalty_rule_sets', 'telematics_enrolments', 'telematics_scores'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
  -- Discount lines are replaced as a set when a quote is (re)priced: audit inserts and deletes.
  if not exists (select 1 from pg_trigger where tgname = 'audit_quote_discounts' and tgrelid = 'public.quote_discounts'::regclass) then
    create trigger audit_quote_discounts after insert or delete on public.quote_discounts for each row execute function private.write_audit();
  end if;
  -- telematics_trips: no audit trigger on purpose (volume, and the audit log must not hold a second copy of
  -- behavioural data that retention deletes).
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
alter table public.loyalty_rule_sets enable row level security;
alter table public.quote_discounts enable row level security;
alter table public.telematics_enrolments enable row level security;
alter table public.telematics_trips enable row level security;
alter table public.telematics_scores enable row level security;

do $$
declare t text;
begin
  foreach t in array array['loyalty_rule_sets', 'quote_discounts', 'telematics_enrolments', 'telematics_trips', 'telematics_scores'] loop
    perform private.ensure_policy(t, t || ': staff read', format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_platform_staff()))', t || ': staff read', t));
  end loop;
end $$;

-- Rule sets: published sets are honest copy for any signed-in user (customer loyalty page); insurer members
-- read every version of their own; writes only through publish_loyalty_rule_set().
select private.ensure_policy('loyalty_rule_sets', 'loyalty_rule_sets: signed-in read published', $p$
  create policy "loyalty_rule_sets: signed-in read published" on public.loyalty_rule_sets for select to authenticated
  using (status = 'published')
$p$);
select private.ensure_policy('loyalty_rule_sets', 'loyalty_rule_sets: insurer reads own', $p$
  create policy "loyalty_rule_sets: insurer reads own" on public.loyalty_rule_sets for select to authenticated
  using (insurer_org_id is not null and insurer_org_id in (select private.user_org_ids()))
$p$);

-- Discount lines follow the quote: the request's customer, the broker, the insurer. Service role writes.
select private.ensure_policy('quote_discounts', 'quote_discounts: parties read', $p$
  create policy "quote_discounts: parties read" on public.quote_discounts for select to authenticated
  using (insurer_org_id in (select private.user_org_ids())
      or broker_org_id in (select private.user_org_ids())
      or private.is_request_customer(request_id))
$p$);

-- Telematics: the person only (enrolments, trips); scores also to the insurer of the policy.
select private.ensure_policy('telematics_enrolments', 'telematics_enrolments: own read', $p$
  create policy "telematics_enrolments: own read" on public.telematics_enrolments for select to authenticated
  using (user_id = (select auth.uid()))
$p$);
select private.ensure_policy('telematics_trips', 'telematics_trips: own read', $p$
  create policy "telematics_trips: own read" on public.telematics_trips for select to authenticated
  using (user_id = (select auth.uid()))
$p$);
select private.ensure_policy('telematics_scores', 'telematics_scores: own read', $p$
  create policy "telematics_scores: own read" on public.telematics_scores for select to authenticated
  using (user_id = (select auth.uid()))
$p$);
select private.ensure_policy('telematics_scores', 'telematics_scores: insurer reads policy scores', $p$
  create policy "telematics_scores: insurer reads policy scores" on public.telematics_scores for select to authenticated
  using (private.is_policy_insurer_member(policy_id))
$p$);

revoke all on public.loyalty_rule_sets, public.quote_discounts, public.telematics_enrolments, public.telematics_trips, public.telematics_scores from anon;
revoke insert, update, delete, truncate on public.loyalty_rule_sets, public.quote_discounts, public.telematics_enrolments, public.telematics_trips, public.telematics_scores from authenticated;
grant select on public.loyalty_rule_sets, public.quote_discounts, public.telematics_enrolments, public.telematics_trips, public.telematics_scores to authenticated;
grant all on public.loyalty_rule_sets, public.quote_discounts, public.telematics_enrolments, public.telematics_trips, public.telematics_scores to service_role;

-- ---------------------------------------------------------------------------
-- 7. Seed: platform fallback with every rule type present and switched OFF.
--    Discounts are the insurer's money: nothing is given until an insurer (or the platform, for the fallback
--    with insurer sign-off) publishes active rules.
-- ---------------------------------------------------------------------------
insert into public.loyalty_rule_sets (insurer_org_id, version, max_combined_pct, rules, note)
select null, 1, 25,
  '[
    {"key": "no_claims", "type": "no_claims", "active": false, "tiers": [{"years": 1, "pct": 10}, {"years": 2, "pct": 15}, {"years": 3, "pct": 20}, {"years": 5, "pct": 25}], "max_pct": 25},
    {"key": "loyalty_tier", "type": "loyalty_tier", "active": false, "tiers": [{"years": 2, "pct": 2, "name": "Silver"}, {"years": 4, "pct": 4, "name": "Gold"}]},
    {"key": "bundle", "type": "bundle", "active": false, "pct": 5, "min_categories": 2},
    {"key": "early_renewal", "type": "early_renewal", "active": false, "pct": 3, "days_before_expiry": 14},
    {"key": "safe_driver", "type": "safe_driver", "active": false, "tiers": [{"score": 75, "pct": 5}, {"score": 90, "pct": 10}], "min_months": 3, "categories": ["motor"]},
    {"key": "referral_credit", "type": "referral_credit", "active": false, "max_pct": 10}
  ]'::jsonb,
  'Platform fallback. Every rule is OFF until insurers have signed off the defaults (discounts are funded by the insurer, never by Covva).'
where not exists (select 1 from public.loyalty_rule_sets where insurer_org_id is null);
