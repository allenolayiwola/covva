-- Phase 2 — Claims completion (additive; no drops, no deletes).
--
-- * claim_messages        — in-claim thread (customer, broker, insurer, staff; `internal` notes are partner/staff only).
-- * claim_info_requests   — "we need X from you" requests (document / information / inspection) with fulfilment.
-- * document_kind         — + claim_video, medical_report, repair_estimate (police_report, invoice already exist).
-- * documents             — + duration_seconds (videos); mime_type / size_bytes guarded (already exist).
-- * storage.buckets       — documents bucket accepts short videos (mp4/webm/quicktime), 50 MB.
-- * claim_fraud_flags     — duplicate / identity / inactive policy / late report / repeat claimant / document reuse,
--                           written by private.run_claim_fraud_checks() (SECURITY DEFINER) after every claim insert and
--                           on demand (public.run_claim_fraud_checks: staff, service role or the claim's insurer).
--                           Visible to the insurer and platform staff only — never to customers.
-- * claims                — + fraud_score, fraud_status ('clear' | 'review' | 'confirmed'), location_gps jsonb.
-- * service_partners      — post-claim partner directory (garages, towing, hospitals, clinics, pharmacies, assessors);
--                           approved partners are public (marketing /claims/network).
-- * claim_jobs            — repair / towing / treatment jobs on a claim, optionally direct-billed to the insurer.
-- * platform_settings     — claims.late_report_days (default 30).
--
-- The diaspora stream adds `claims.reported_by_user_id` (sponsor reporting on behalf of a beneficiary). Whether that
-- column exists is checked at *call time* (information_schema) inside private.claim_thread_party(), so the sponsor is
-- a thread party whichever migration lands first.

-- ---------------------------------------------------------------------------
-- 1. Enum values, document columns, bucket
-- ---------------------------------------------------------------------------
alter type public.document_kind add value if not exists 'claim_video';
alter type public.document_kind add value if not exists 'police_report';
alter type public.document_kind add value if not exists 'medical_report';
alter type public.document_kind add value if not exists 'repair_estimate';
alter type public.document_kind add value if not exists 'invoice';

alter table public.documents add column if not exists duration_seconds integer;
alter table public.documents add column if not exists mime_type text;
alter table public.documents add column if not exists size_bytes bigint;
comment on column public.documents.duration_seconds is 'Length of a claim video in seconds (max 90 — enforced by the app, MAX_VIDEO_SECONDS in @im/core).';
create index if not exists documents_claim_idx on public.documents (claim_id);
create index if not exists documents_checksum_idx on public.documents (checksum) where checksum is not null;

update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct m) from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['video/mp4', 'video/webm', 'video/quicktime']) as m
       ),
       file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800)
 where id = 'documents';

-- ---------------------------------------------------------------------------
-- 2. Claims: fraud summary + incident coordinates
-- ---------------------------------------------------------------------------
alter table public.claims add column if not exists fraud_score numeric(5, 2);
alter table public.claims add column if not exists fraud_status text not null default 'clear';
alter table public.claims add column if not exists location_gps jsonb;
comment on column public.claims.fraud_status is 'clear | review | confirmed — summary of claim_fraud_flags; insurer/staff use only, never shown to customers.';
comment on column public.claims.location_gps is '{ lat, lng, accuracy? } captured on the phone when the claim was reported.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claims_fraud_status_check') then
    alter table public.claims add constraint claims_fraud_status_check check (fraud_status in ('clear', 'review', 'confirmed'));
  end if;
end $$;
create index if not exists claims_fraud_status_idx on public.claims (fraud_status) where fraud_status <> 'clear';
create index if not exists claims_policy_incident_idx on public.claims (policy_id, incident_at);

insert into public.platform_settings (key, value, description) values
  ('claims.late_report_days', '30', 'Days after the incident beyond which a claim report is flagged as late (fraud check late_report).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Access helpers
-- ---------------------------------------------------------------------------
-- Broker / insurer member of the claim, or platform staff (never the customer).
create or replace function private.is_claim_partner(p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.claims c where c.id = p_claim and (
      c.broker_org_id in (select private.user_org_ids())
      or c.insurer_org_id in (select private.user_org_ids())
      or private.is_platform_staff()
    )
  );
$$;

-- Insurer member of the claim or platform staff (fraud flags).
create or replace function private.is_claim_insurer(p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.claims c where c.id = p_claim and (
      c.insurer_org_id in (select private.user_org_ids())
      or private.is_platform_staff()
    )
  );
$$;

-- Anyone in the claim thread: the claim parties plus the sponsor who reported it on the beneficiary's behalf
-- (`claims.reported_by_user_id`, added by the diaspora migration — checked at call time so order does not matter).
create or replace function private.claim_thread_party(p_claim uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sponsor boolean := false;
begin
  if private.can_access_claim(p_claim) then
    return true;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'claims' and column_name = 'reported_by_user_id'
  ) then
    execute 'select exists (select 1 from public.claims c where c.id = $1 and c.reported_by_user_id = (select auth.uid()))'
      into v_sponsor using p_claim;
  end if;
  return coalesce(v_sponsor, false);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Claim messages
-- ---------------------------------------------------------------------------
create table if not exists public.claim_messages (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  author_id uuid references auth.users (id),
  author_party public.party not null default 'customer',
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.claim_messages is 'In-claim thread. attachments: [{ storage_path, name, document_id? }]. internal = broker/insurer/staff note the customer never sees.';
create index if not exists claim_messages_claim_idx on public.claim_messages (claim_id, created_at);

create or replace function private.claim_messages_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_broker uuid; v_insurer uuid;
begin
  select broker_org_id, insurer_org_id into v_broker, v_insurer from public.claims where id = new.claim_id;
  if not private.is_service_role() then
    new.author_id := coalesce((select auth.uid()), new.author_id);
    new.author_party := private.actor_party_for_org(v_broker, v_insurer);
    if new.author_party = 'customer' and new.internal then
      raise exception 'Only the broker, insurer or platform staff can write internal notes' using errcode = 'P0001';
    end if;
  end if;
  if length(btrim(new.body)) = 0 then
    raise exception 'Message body is required' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'claim_messages_before' and tgrelid = 'public.claim_messages'::regclass) then
    create trigger claim_messages_before before insert on public.claim_messages for each row execute function private.claim_messages_before();
  end if;
end $$;

alter table public.claim_messages enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'claim messages: thread parties read') then
    create policy "claim messages: thread parties read" on public.claim_messages for select to authenticated
      using (private.claim_thread_party(claim_id) and (not internal or private.is_claim_partner(claim_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'claim messages: thread parties write') then
    create policy "claim messages: thread parties write" on public.claim_messages for insert to authenticated
      with check (private.claim_thread_party(claim_id) and (not internal or private.is_claim_partner(claim_id)));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Information requests
-- ---------------------------------------------------------------------------
create table if not exists public.claim_info_requests (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  requested_by uuid references auth.users (id),
  requested_by_party public.party not null default 'insurer',
  requested_party public.party not null default 'customer',
  kind text not null default 'document',
  message text not null,
  due_at timestamptz,
  fulfilled_at timestamptz,
  fulfilled_by uuid references auth.users (id),
  document_id uuid references public.documents (id) on delete set null,
  response text,
  created_at timestamptz not null default now()
);
comment on table public.claim_info_requests is 'A party asks another party on the claim for a document, information or an inspection slot. Fulfilled by linking a document and/or a written response.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_info_requests_kind_check') then
    alter table public.claim_info_requests add constraint claim_info_requests_kind_check check (kind in ('document', 'information', 'inspection'));
  end if;
end $$;
create index if not exists claim_info_requests_claim_idx on public.claim_info_requests (claim_id, created_at);
create index if not exists claim_info_requests_open_idx on public.claim_info_requests (claim_id) where fulfilled_at is null;

-- Requesters stamp themselves; customers (and sponsors) may only fulfil (fulfilled_at, fulfilled_by, document_id, response).
create or replace function private.claim_info_requests_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_broker uuid; v_insurer uuid; v_party public.party;
  v_allowed text[] := array['fulfilled_at', 'fulfilled_by', 'document_id', 'response'];
begin
  select broker_org_id, insurer_org_id into v_broker, v_insurer from public.claims where id = new.claim_id;
  v_party := private.actor_party_for_org(v_broker, v_insurer);
  if tg_op = 'INSERT' then
    if not private.is_service_role() then
      new.requested_by := coalesce((select auth.uid()), new.requested_by);
      new.requested_by_party := v_party;
    end if;
    if new.requested_by_party = 'customer' then
      raise exception 'Information requests are raised by the broker, insurer or platform staff' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if v_party = 'customer' and (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'You can only fulfil an information request' using errcode = 'P0001';
  end if;
  if new.fulfilled_at is not null and old.fulfilled_at is null then
    new.fulfilled_by := coalesce(new.fulfilled_by, (select auth.uid()));
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'claim_info_requests_guard' and tgrelid = 'public.claim_info_requests'::regclass) then
    create trigger claim_info_requests_guard before insert or update on public.claim_info_requests for each row execute function private.claim_info_requests_guard();
  end if;
end $$;

alter table public.claim_info_requests enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'claim info requests: thread parties read') then
    create policy "claim info requests: thread parties read" on public.claim_info_requests for select to authenticated
      using (private.claim_thread_party(claim_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'claim info requests: partners raise') then
    create policy "claim info requests: partners raise" on public.claim_info_requests for insert to authenticated
      with check (private.is_claim_partner(claim_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'claim info requests: thread parties update') then
    create policy "claim info requests: thread parties update" on public.claim_info_requests for update to authenticated
      using (private.claim_thread_party(claim_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Fraud flags
-- ---------------------------------------------------------------------------
create table if not exists public.claim_fraud_flags (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  kind text not null,
  score numeric(5, 2) not null default 0,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
comment on table public.claim_fraud_flags is 'Automated fraud indicators per claim. Insurer claims team and platform staff clear or confirm them; customers never see them.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_fraud_flags_kind_check') then
    alter table public.claim_fraud_flags add constraint claim_fraud_flags_kind_check
      check (kind in ('duplicate_claim', 'identity_mismatch', 'policy_inactive_at_incident', 'late_report', 'repeat_claimant', 'document_reuse'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'claim_fraud_flags_status_check') then
    alter table public.claim_fraud_flags add constraint claim_fraud_flags_status_check check (status in ('open', 'cleared', 'confirmed'));
  end if;
end $$;
create index if not exists claim_fraud_flags_claim_idx on public.claim_fraud_flags (claim_id, created_at);
create index if not exists claim_fraud_flags_open_idx on public.claim_fraud_flags (status) where status = 'open';

alter table public.claim_fraud_flags enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'fraud flags: insurer and staff read') then
    create policy "fraud flags: insurer and staff read" on public.claim_fraud_flags for select to authenticated
      using (private.is_claim_insurer(claim_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'fraud flags: insurer and staff review') then
    create policy "fraud flags: insurer and staff review" on public.claim_fraud_flags for update to authenticated
      using (private.is_claim_insurer(claim_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'fraud flags: staff raise') then
    create policy "fraud flags: staff raise" on public.claim_fraud_flags for insert to authenticated
      with check ((select private.is_platform_staff()));
  end if;
end $$;

-- Reviewing a flag stamps the reviewer and refreshes the claim summary (below).
create or replace function private.claim_fraud_flags_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'claim_fraud_flags_before' and tgrelid = 'public.claim_fraud_flags'::regclass) then
    create trigger claim_fraud_flags_before before update on public.claim_fraud_flags for each row execute function private.claim_fraud_flags_before();
  end if;
end $$;

-- Customers may only edit reporting details. The fraud engine writes fraud_score / fraud_status from inside a
-- SECURITY DEFINER function that runs as part of the customer's own insert, so it announces itself with a
-- transaction-local setting (covva.fraud_run) the guard honours. Clients cannot set arbitrary GUCs through PostgREST.
create or replace function private.claims_customer_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_details text[] := array['description', 'location', 'location_gps', 'incident_type', 'incident_at', 'amount_claimed', 'third_parties'];
  v_allowed text[] := v_details || array['status', 'updated_at', 'reported_at'];
  v_fraud text[] := array['fraud_score', 'fraud_status', 'updated_at'];
begin
  if private.is_service_role() or private.is_platform_staff()
     or private.is_org_member(new.insurer_org_id) or private.is_org_member(new.broker_org_id) then
    return new;
  end if;
  if coalesce(current_setting('covva.fraud_run', true), '') = '1'
     and (to_jsonb(new) - v_fraud) is not distinct from (to_jsonb(old) - v_fraud) then
    return new;
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'Customers can only update the details of a claim they reported' using errcode = 'P0001';
  end if;
  if old.status not in ('draft', 'reported')
     and (to_jsonb(new) - (array['status', 'updated_at', 'reported_at'])) is distinct from (to_jsonb(old) - (array['status', 'updated_at', 'reported_at'])) then
    raise exception 'Claim details can no longer be changed here. Send updates to your broker.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Weights mirror packages/core/src/claims-fraud.ts (scoreFraudFlags): review at 40+, confirmed when a flag is confirmed.
create or replace function private.fraud_flag_weight(p_kind text) returns numeric
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'duplicate_claim' then 40
    when 'document_reuse' then 35
    when 'identity_mismatch' then 30
    when 'policy_inactive_at_incident' then 30
    when 'late_report' then 15
    when 'repeat_claimant' then 15
    else 10 end::numeric;
$$;

create or replace function private.refresh_claim_fraud_summary(p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_score numeric := 0; v_status text := 'clear'; v_confirmed boolean := false; v_open int := 0;
begin
  select coalesce(sum(private.fraud_flag_weight(kind)) filter (where status <> 'cleared'), 0),
         bool_or(status = 'confirmed'),
         count(*) filter (where status = 'open')
    into v_score, v_confirmed, v_open
    from public.claim_fraud_flags where claim_id = p_claim_id;
  v_score := least(v_score, 100);
  v_status := case when coalesce(v_confirmed, false) then 'confirmed' when v_score >= 40 then 'review' else 'clear' end;
  perform set_config('covva.fraud_run', '1', true);
  update public.claims set fraud_score = v_score, fraud_status = v_status
   where id = p_claim_id and (fraud_score is distinct from v_score or fraud_status is distinct from v_status);
  perform set_config('covva.fraud_run', '', true);
  return jsonb_build_object('claim_id', p_claim_id, 'score', v_score, 'status', v_status, 'open_flags', coalesce(v_open, 0));
end $$;

create or replace function private.run_claim_fraud_checks(p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c record; p record; pr record;
  v_late_days int := 30;
  v_other uuid; v_cnt int;
  v_insured_name text; v_insured_card text; v_claimant_name text; v_claimant_card text;
  v_reasons text[] := '{}';
  v_doc record;
begin
  select * into c from public.claims where id = p_claim_id;
  if not found then
    return jsonb_build_object('claim_id', p_claim_id, 'score', null, 'status', null, 'error', 'not_found');
  end if;
  select * into p from public.policies where id = c.policy_id;
  select full_name, ghana_card_number into pr from public.profiles where id = c.customer_id;
  select coalesce((ps.value #>> '{}')::int, 30) into v_late_days from public.platform_settings ps where ps.key = 'claims.late_report_days';
  v_late_days := coalesce(v_late_days, 30);

  -- duplicate_claim: same policy, incident within 7 days, not withdrawn
  select o.id into v_other from public.claims o
   where o.policy_id = c.policy_id and o.id <> c.id and o.status <> 'withdrawn'
     and o.incident_at is not null and c.incident_at is not null
     and abs(extract(epoch from (o.incident_at - c.incident_at))) <= 7 * 86400
   order by o.created_at limit 1;
  if v_other is not null then
    insert into public.claim_fraud_flags (claim_id, kind, score, details)
    select c.id, 'duplicate_claim', private.fraud_flag_weight('duplicate_claim'),
           jsonb_build_object('other_claim_id', v_other, 'policy_id', c.policy_id, 'window_days', 7)
    where not exists (select 1 from public.claim_fraud_flags f where f.claim_id = c.id and f.kind = 'duplicate_claim');
  end if;

  -- document_reuse: a document with the same checksum sits on another claim
  select d2.claim_id as other_claim_id, d1.checksum into v_doc
    from public.documents d1 join public.documents d2 on d2.checksum = d1.checksum and d2.claim_id is not null and d2.claim_id <> d1.claim_id
   where d1.claim_id = c.id and d1.checksum is not null limit 1;
  if found and v_doc.other_claim_id is not null then
    insert into public.claim_fraud_flags (claim_id, kind, score, details)
    select c.id, 'document_reuse', private.fraud_flag_weight('document_reuse'),
           jsonb_build_object('other_claim_id', v_doc.other_claim_id, 'checksum', v_doc.checksum)
    where not exists (select 1 from public.claim_fraud_flags f where f.claim_id = c.id and f.kind = 'document_reuse');
  end if;

  -- identity_mismatch: claimant profile vs the policy's insured name / Ghana Card (when both sides are known)
  if p.id is not null then
    v_insured_name := coalesce(p.insured_items ->> 'insured_name', p.insured_items ->> 'policyholder_name', p.insured_items ->> 'owner_name', p.insured_items ->> 'full_name', p.insured_items ->> 'name');
    v_insured_card := coalesce(p.insured_items ->> 'ghana_card_number', p.insured_items ->> 'ghana_card', p.insured_items ->> 'id_number');
    v_claimant_name := pr.full_name;
    v_claimant_card := pr.ghana_card_number;
    if v_insured_card is not null and v_claimant_card is not null
       and regexp_replace(upper(v_insured_card), '[^A-Z0-9]', '', 'g') <> regexp_replace(upper(v_claimant_card), '[^A-Z0-9]', '', 'g') then
      v_reasons := v_reasons || 'ghana_card';
    end if;
    if v_insured_name is not null and v_claimant_name is not null then
      v_insured_name := regexp_replace(lower(v_insured_name), '[^a-z ]', '', 'g');
      v_claimant_name := regexp_replace(lower(v_claimant_name), '[^a-z ]', '', 'g');
      if btrim(v_insured_name) <> '' and btrim(v_claimant_name) <> ''
         and position(btrim(v_insured_name) in v_claimant_name) = 0 and position(btrim(v_claimant_name) in v_insured_name) = 0 then
        v_reasons := v_reasons || 'name';
      end if;
    end if;
    if array_length(v_reasons, 1) > 0 then
      insert into public.claim_fraud_flags (claim_id, kind, score, details)
      select c.id, 'identity_mismatch', private.fraud_flag_weight('identity_mismatch'),
             jsonb_build_object('fields', to_jsonb(v_reasons))
      where not exists (select 1 from public.claim_fraud_flags f where f.claim_id = c.id and f.kind = 'identity_mismatch');
    end if;

    -- policy_inactive_at_incident: incident outside the cover period, or after cancellation
    if c.incident_at is not null and (
         (p.cover_start is not null and c.incident_at::date < p.cover_start)
      or (p.cover_end is not null and c.incident_at::date > p.cover_end)
      or (p.status = 'cancelled' and p.cancelled_at is not null and c.incident_at > p.cancelled_at)
      or p.status = 'pending_issuance'
    ) then
      insert into public.claim_fraud_flags (claim_id, kind, score, details)
      select c.id, 'policy_inactive_at_incident', private.fraud_flag_weight('policy_inactive_at_incident'),
             jsonb_build_object('incident_at', c.incident_at, 'cover_start', p.cover_start, 'cover_end', p.cover_end, 'policy_status', p.status)
      where not exists (select 1 from public.claim_fraud_flags f where f.claim_id = c.id and f.kind = 'policy_inactive_at_incident');
    end if;
  end if;

  -- late_report: reported more than N days after the incident
  if c.incident_at is not null and coalesce(c.reported_at, c.created_at) - c.incident_at > make_interval(days => v_late_days) then
    insert into public.claim_fraud_flags (claim_id, kind, score, details)
    select c.id, 'late_report', private.fraud_flag_weight('late_report'),
           jsonb_build_object('incident_at', c.incident_at, 'reported_at', coalesce(c.reported_at, c.created_at), 'threshold_days', v_late_days,
                              'days_late', floor(extract(epoch from (coalesce(c.reported_at, c.created_at) - c.incident_at)) / 86400))
    where not exists (select 1 from public.claim_fraud_flags f where f.claim_id = c.id and f.kind = 'late_report');
  end if;

  -- repeat_claimant: three or more claims in 12 months (this one included)
  select count(*) into v_cnt from public.claims o
   where o.customer_id = c.customer_id and o.status <> 'withdrawn' and o.created_at > now() - interval '12 months';
  if v_cnt >= 3 then
    insert into public.claim_fraud_flags (claim_id, kind, score, details)
    select c.id, 'repeat_claimant', private.fraud_flag_weight('repeat_claimant'), jsonb_build_object('claims_12_months', v_cnt)
    where not exists (select 1 from public.claim_fraud_flags f where f.claim_id = c.id and f.kind = 'repeat_claimant');
  end if;

  return private.refresh_claim_fraud_summary(c.id);
end $$;

-- Staff, the service role, or the claim's insurer may run the checks on demand (e.g. after new evidence).
create or replace function public.run_claim_fraud_checks(p_claim_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_service_role() or private.is_claim_insurer(p_claim_id)) then
    raise exception 'Only the insurer or platform staff can run fraud checks' using errcode = '42501';
  end if;
  return private.run_claim_fraud_checks(p_claim_id);
end $$;
revoke all on function public.run_claim_fraud_checks(uuid) from public, anon;
grant execute on function public.run_claim_fraud_checks(uuid) to authenticated, service_role;

-- Automatic run after every report; a failure here must never block reporting a claim.
create or replace function private.claims_fraud_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.run_claim_fraud_checks(new.id);
  exception when others then
    raise warning 'claim fraud checks failed for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'claims_fraud_after' and tgrelid = 'public.claims'::regclass) then
    create trigger claims_fraud_after after insert on public.claims for each row execute function private.claims_fraud_after();
  end if;
end $$;

-- Reviewing a flag refreshes the claim summary.
create or replace function private.claim_fraud_flags_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_claim_fraud_summary(new.claim_id);
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'claim_fraud_flags_after' and tgrelid = 'public.claim_fraud_flags'::regclass) then
    create trigger claim_fraud_flags_after after update on public.claim_fraud_flags for each row execute function private.claim_fraud_flags_after();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Service partners (post-claim network) and jobs
-- ---------------------------------------------------------------------------
create table if not exists public.service_partners (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  name text not null,
  phone text,
  email extensions.citext,
  address text,
  region text,
  gps jsonb,
  services text[] not null default '{}',
  direct_billing_insurer_ids uuid[] not null default '{}',
  status text not null default 'pending',
  rating numeric(3, 2),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.service_partners is 'Approved garages, towing, hospitals, clinics, pharmacies and assessors. direct_billing_insurer_ids: insurers that settle this partner''s invoices directly so the customer does not pay upfront. Ratings come later.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_partners_kind_check') then
    alter table public.service_partners add constraint service_partners_kind_check check (kind in ('garage', 'towing', 'hospital', 'clinic', 'pharmacy', 'assessor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_partners_status_check') then
    alter table public.service_partners add constraint service_partners_status_check check (status in ('pending', 'approved', 'suspended'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'service_partners_rating_check') then
    alter table public.service_partners add constraint service_partners_rating_check check (rating is null or (rating >= 0 and rating <= 5));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.service_partners'::regclass) then
    create trigger set_updated_at before update on public.service_partners for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists service_partners_directory_idx on public.service_partners (status, kind, region);

alter table public.service_partners enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'service partners: public directory') then
    create policy "service partners: public directory" on public.service_partners for select to anon, authenticated
      using (status = 'approved');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'service partners: staff read all') then
    create policy "service partners: staff read all" on public.service_partners for select to authenticated
      using ((select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'service partners: staff write') then
    create policy "service partners: staff write" on public.service_partners for insert to authenticated
      with check ((select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'service partners: staff update') then
    create policy "service partners: staff update" on public.service_partners for update to authenticated
      using ((select private.is_platform_staff()));
  end if;
end $$;

create table if not exists public.claim_jobs (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  service_partner_id uuid not null references public.service_partners (id),
  kind text not null,
  status text not null default 'requested',
  direct_billing boolean not null default false,
  estimate numeric(14, 2),
  invoice_document_id uuid references public.documents (id) on delete set null,
  scheduled_for timestamptz,
  completed_at timestamptz,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.claim_jobs is 'A repair, tow, treatment or assessment arranged with a service partner for a claim. direct_billing = the insurer settles the partner''s invoice; the customer does not pay upfront.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_jobs_kind_check') then
    alter table public.claim_jobs add constraint claim_jobs_kind_check check (kind in ('repair', 'towing', 'treatment', 'assessment', 'replacement', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'claim_jobs_status_check') then
    alter table public.claim_jobs add constraint claim_jobs_status_check check (status in ('requested', 'accepted', 'in_progress', 'completed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.claim_jobs'::regclass) then
    create trigger set_updated_at before update on public.claim_jobs for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists claim_jobs_claim_idx on public.claim_jobs (claim_id, created_at);
create index if not exists claim_jobs_partner_idx on public.claim_jobs (service_partner_id, status);

create or replace function private.claim_jobs_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  end if;
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'claim_jobs_before' and tgrelid = 'public.claim_jobs'::regclass) then
    create trigger claim_jobs_before before insert or update on public.claim_jobs for each row execute function private.claim_jobs_before();
  end if;
end $$;

alter table public.claim_jobs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'claim jobs: thread parties read') then
    create policy "claim jobs: thread parties read" on public.claim_jobs for select to authenticated
      using (private.claim_thread_party(claim_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'claim jobs: partners write') then
    create policy "claim jobs: partners write" on public.claim_jobs for insert to authenticated
      with check (private.is_claim_partner(claim_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'claim jobs: partners update') then
    create policy "claim jobs: partners update" on public.claim_jobs for update to authenticated
      using (private.is_claim_partner(claim_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Audit, realtime, grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['claim_fraud_flags', 'service_partners', 'claim_jobs', 'claim_info_requests'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'claim_messages') then
    alter publication supabase_realtime add table public.claim_messages;
  end if;
end $$;

grant execute on all functions in schema private to authenticated, service_role;
