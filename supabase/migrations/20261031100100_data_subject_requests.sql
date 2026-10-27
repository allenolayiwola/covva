-- =============================================================================
-- Act 843 — data-subject requests and retention jobs (cross-cutting roadmap item).
--
-- Ghana's Data Protection Act 2012 (Act 843) gives people the right to access their data, have it corrected, have it
-- deleted where lawful, object to processing and stop direct marketing. This migration adds:
--
--   * privacy_requests        — one row per request (access / correction / deletion / objection / marketing opt-out),
--                               with a configurable due date (platform_settings.privacy_request_due_days, default 30;
--                               the statutory deadline is still to be confirmed with counsel — see docs/PRIVACY_REQUESTS.md).
--   * privacy_request_events  — the request's timeline (customer-visible steps + internal staff notes).
--   * privacy_retention_runs  — log of every retention job run (dry run or enforced) and what it touched.
--   * profiles.anonymised_at  — set once a deletion request has been fulfilled.
--
-- Deletion is ANONYMISATION, not row deletion: insurance records that law or contract require to be kept (requests that
-- were submitted, quotes, applications, policies, claims, payments, documents, complaints, KYC checks, ledger entries,
-- request/claim correspondence, lawful-basis consents and the audit log) are retained untouched. Data that does not
-- need keeping is erased or scrubbed: profile contact details, optional consents' metadata, leads, AI / WhatsApp
-- transcripts, saved drafts, push tokens, notifications, saved cards, avatar and voice notes (see private.anonymise_subject).
--
-- Customers see only their own requests; platform staff see all; partners see nothing. Every write goes through a
-- SECURITY DEFINER RPC that validates input and raises P0001 with a message people can act on; status transitions are
-- enforced by a trigger for every caller (mirrors PRIVACY_TRANSITIONS in @im/core). Every change is audited through the
-- existing hash-chained audit_events (private.write_audit). While a scrub runs (app.privacy_scrub = '1'), write_audit
-- records WHICH columns changed but not their values, so erasing data never copies it into the append-only audit log.
--
-- Additive and idempotent: create … if not exists / create or replace / guarded triggers and policies. No drops, no
-- deletes of existing data. NOT applied by CI or by the author; apply it with the normal migration process.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Types, columns, settings
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'privacy_request_type' and typnamespace = 'public'::regnamespace) then
    create type public.privacy_request_type as enum ('access', 'correction', 'deletion', 'objection', 'marketing_opt_out');
  end if;
  if not exists (select 1 from pg_type where typname = 'privacy_request_status' and typnamespace = 'public'::regnamespace) then
    create type public.privacy_request_status as enum (
      'submitted', 'identity_verified', 'approved', 'export_ready', 'fulfilled', 'refused', 'closed', 'withdrawn'
    );
  end if;
end $$;

alter table public.profiles add column if not exists anonymised_at timestamptz;
comment on column public.profiles.anonymised_at is
  'Set when a data-subject deletion request was fulfilled (Act 843): contact details erased, retained insurance records kept.';

insert into public.platform_settings (key, value, description) values
  ('privacy_request_due_days', '30',
   'Days Covva gives itself to answer a data-subject request (Act 843). Default 30; the statutory deadline is to be confirmed with counsel.'),
  ('privacy_export_ttl_days', '7',
   'Days a generated personal-data export stays downloadable before the retention job removes it.'),
  ('privacy_retention', '{"mode": "dry_run", "periods": {}}',
   'Retention job: mode dry_run (report only) or enforce; periods = { data_class: days } overrides of the defaults in @im/core RETENTION_RULES.')
on conflict (key) do nothing;

create sequence if not exists public.privacy_request_ref_seq start 1001;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('DSR-' || nextval('public.privacy_request_ref_seq')::text),
  -- No cascade: the request record outlives the account (it is the evidence that the right was honoured).
  user_id uuid not null references auth.users (id),
  type public.privacy_request_type not null,
  status public.privacy_request_status not null default 'submitted',
  channel text not null default 'web',
  note text,
  due_at timestamptz not null default now() + interval '30 days',
  identity_verified_at timestamptz,
  identity_verified_by uuid references auth.users (id),
  identity_method text,
  decision text,
  decision_reason text,
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  export_path text,
  export_generated_at timestamptz,
  export_expires_at timestamptz,
  export_bytes bigint,
  export_sha256 text,
  export_downloaded_at timestamptz,
  export_download_count integer not null default 0,
  anonymised_at timestamptz,
  anonymisation_summary jsonb,
  retention_note text,
  fulfilled_at timestamptz,
  fulfilment_note text,
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_requests_channel_check check (channel in ('web', 'mobile', 'email', 'phone', 'whatsapp', 'admin')),
  constraint privacy_requests_note_check check (note is null or length(note) <= 2000),
  constraint privacy_requests_identity_method_check check (
    identity_method is null or identity_method in ('signed_in_session', 'ghana_card', 'video_call', 'in_person', 'other')),
  constraint privacy_requests_decision_check check (decision is null or decision in ('approved', 'refused')),
  constraint privacy_requests_reason_check check (decision_reason is null or length(decision_reason) <= 2000),
  constraint privacy_requests_export_path_check check (export_path is null or export_path ~ '^privacy-exports/[0-9a-f-]{36}/[^/]+\.json$'),
  constraint privacy_requests_export_sha_check check (export_sha256 is null or export_sha256 ~ '^[0-9a-f]{64}$'),
  constraint privacy_requests_export_bytes_check check (export_bytes is null or export_bytes >= 0)
);
comment on table public.privacy_requests is
  'Act 843 data-subject requests. Customers read their own; platform staff read all; partners none. Written only through the privacy RPCs. export_path points into the private documents bucket (privacy-exports/<user>/…), served through an authenticated route only.';
create index if not exists privacy_requests_user_idx on public.privacy_requests (user_id, created_at desc);
create index if not exists privacy_requests_status_idx on public.privacy_requests (status, due_at);
-- One open request of each type per person (a second one is pointed at the first).
create unique index if not exists privacy_requests_one_open_uidx on public.privacy_requests (user_id, type)
  where status in ('submitted', 'identity_verified', 'approved', 'export_ready');

create table if not exists public.privacy_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.privacy_requests (id),
  actor_id uuid references auth.users (id),
  actor_party public.party not null default 'system',
  event text not null,
  from_status public.privacy_request_status,
  to_status public.privacy_request_status,
  note text,
  visible_to_customer boolean not null default true,
  created_at timestamptz not null default now(),
  constraint privacy_request_events_note_check check (note is null or length(note) <= 4000)
);
comment on table public.privacy_request_events is
  'Timeline of a privacy request. visible_to_customer = false rows are internal staff notes.';
create index if not exists privacy_request_events_request_idx on public.privacy_request_events (request_id, created_at);

create table if not exists public.privacy_retention_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  dry_run boolean not null,
  triggered_by text not null default 'cron',
  actor_id uuid references auth.users (id),
  plan jsonb not null default '[]'::jsonb,
  results jsonb not null default '{}'::jsonb,
  ok boolean not null default true,
  error text,
  constraint privacy_retention_runs_trigger_check check (triggered_by in ('cron', 'staff', 'manual'))
);
comment on table public.privacy_retention_runs is
  'One row per retention job run: the plan (data class + cutoff), whether it was a dry run, and counts per class. Staff read only.';
create index if not exists privacy_retention_runs_started_idx on public.privacy_retention_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- 3. Helpers (security definer → no policy recursion)
-- ---------------------------------------------------------------------------
-- Staff who may act on privacy requests (support is read-only, as everywhere else in the console).
create or replace function private.is_privacy_officer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid()) and m.active and o.type = 'platform'
      and m.role in ('platform_admin', 'platform_ops', 'compliance')
  );
$$;

create or replace function private.is_privacy_request_owner(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.privacy_requests r where r.id = p_request and r.user_id = (select auth.uid()));
$$;

-- Integer platform setting with bounds (settings are jsonb: 30 or "30").
create or replace function private.int_setting(p_key text, p_default int, p_min int, p_max int) returns int
language sql stable security definer set search_path = '' as $$
  select greatest(p_min, least(p_max, coalesce(
    (select case when (s.value #>> '{}') ~ '^[0-9]{1,6}$' then (s.value #>> '{}')::int end
       from public.platform_settings s where s.key = p_key),
    p_default)));
$$;

-- Allowed status transitions. Keep in sync with PRIVACY_TRANSITIONS in packages/core/src/privacy.ts.
create or replace function private.privacy_transition_allowed(
  p_type public.privacy_request_type, p_from public.privacy_request_status, p_to public.privacy_request_status
) returns boolean
language sql immutable set search_path = '' as $$
  select case p_from
    when 'submitted' then p_to in ('identity_verified', 'refused', 'withdrawn')
                          or (p_to = 'fulfilled' and p_type = 'marketing_opt_out')
    when 'identity_verified' then p_to in ('refused', 'withdrawn')
                          or (p_to = 'approved' and p_type <> 'marketing_opt_out')
                          or (p_to = 'export_ready' and p_type = 'access')
    when 'approved' then p_to = 'withdrawn'
                          or (p_to = 'export_ready' and p_type = 'access')
                          or (p_to = 'fulfilled' and p_type in ('correction', 'deletion', 'objection'))
    when 'export_ready' then p_to = 'closed'
    when 'fulfilled' then p_to = 'closed'
    when 'refused' then p_to = 'closed'
    else false
  end;
$$;

-- Demo / automated-test people are never touched by retention runs (they are purged by tests/purge-e2e-data.mjs).
create or replace function private.is_test_subject(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.profiles p
    where p.id = p_user and (coalesce(p.email::text, '') ilike '%.example' or coalesce(p.full_name, '') like 'E2E-%')
  );
$$;

create or replace function private.phone_tail(p text) returns text
language sql immutable set search_path = '' as $$
  select case when length(d) >= 9 then right(d, 9) end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

revoke all on function private.int_setting(text, int, int, int), private.privacy_transition_allowed(public.privacy_request_type, public.privacy_request_status, public.privacy_request_status),
  private.is_test_subject(uuid), private.phone_tail(text) from public, anon, authenticated;
grant execute on function private.is_privacy_officer(), private.is_privacy_request_owner(uuid) to authenticated, service_role;
grant execute on function private.int_setting(text, int, int, int), private.privacy_transition_allowed(public.privacy_request_type, public.privacy_request_status, public.privacy_request_status),
  private.is_test_subject(uuid), private.phone_tail(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Audit: redact values while a privacy scrub runs (otherwise the core write_audit, plus a nullif guard on the
--    claims setting). Same hash-chain insert, so verify_audit_chain() is unaffected.
-- ---------------------------------------------------------------------------
create or replace function private.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb; v_old jsonb; v_changes jsonb := '{}'::jsonb; k text; v_data jsonb;
  -- Set (transaction-local) by private.anonymise_subject / private.apply_retention: record which columns changed but
  -- never the erased values, so the append-only audit log does not keep a copy of what was just deleted.
  v_scrub boolean := coalesce(current_setting('app.privacy_scrub', true), '') = '1';
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    for k in select jsonb_object_keys(v_row) loop
      if k not in ('updated_at') and (v_row -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k,
          case when v_scrub then jsonb_build_object('redacted', true)
               else jsonb_build_object('from', v_old -> k, 'to', v_row -> k) end);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
  end if;
  v_data := case
    when tg_op = 'UPDATE' then jsonb_build_object('changes', v_changes)
    when v_scrub and tg_op = 'DELETE' then jsonb_build_object('row', jsonb_build_object('id', v_row -> 'id', 'redacted', true))
    else jsonb_build_object('row', v_row - 'risk_data' - 'declarations')
  end;
  if v_scrub then v_data := v_data || jsonb_build_object('privacy_scrub', true); end if;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, org_id, data)
  values (
    (select auth.uid()),
    -- nullif: an empty claims setting (direct SQL session after a request-scoped one) must not break auditing.
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'key'),
    coalesce(nullif(v_row ->> 'broker_org_id', '')::uuid, nullif(v_row ->> 'insurer_org_id', '')::uuid, nullif(v_row ->> 'org_id', '')::uuid),
    v_data
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Guard: immutable identity, enforced transitions, timestamps
-- ---------------------------------------------------------------------------
create or replace function private.privacy_requests_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.privacy_rpc', true), '') <> '1' then
      -- Direct inserts (service role / SQL console) always start at the beginning of the workflow.
      new.status := 'submitted';
      new.decision := null; new.decided_at := null; new.decided_by := null;
      new.identity_verified_at := null; new.identity_verified_by := null;
      new.export_path := null; new.anonymised_at := null; new.fulfilled_at := null; new.closed_at := null;
    end if;
    if new.due_at is null or new.due_at <= now() then
      new.due_at := now() + make_interval(days => private.int_setting('privacy_request_due_days', 30, 1, 90));
    end if;
    return new;
  end if;

  if new.user_id <> old.user_id or new.type <> old.type or new.reference <> old.reference or new.created_at <> old.created_at then
    raise exception 'The person, type and reference of a privacy request cannot change' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not private.privacy_transition_allowed(old.type, old.status, new.status) then
      raise exception 'A % request cannot move from % to %', replace(old.type::text, '_', ' '),
        replace(old.status::text, '_', ' '), replace(new.status::text, '_', ' ') using errcode = 'P0001';
    end if;
    case new.status
      when 'identity_verified' then
        new.identity_verified_at := coalesce(new.identity_verified_at, now());
      when 'approved' then
        new.decision := 'approved'; new.decided_at := coalesce(new.decided_at, now());
      when 'refused' then
        if length(btrim(coalesce(new.decision_reason, ''))) < 5 then
          raise exception 'Give the reason for refusing (at least 5 characters); the customer is told it' using errcode = 'P0001';
        end if;
        new.decision := 'refused'; new.decided_at := coalesce(new.decided_at, now());
      when 'export_ready' then
        if new.export_path is null then
          raise exception 'Generate the export before marking it ready' using errcode = 'P0001';
        end if;
      when 'fulfilled' then
        if old.type = 'deletion' and new.anonymised_at is null then
          raise exception 'Deletion requests are fulfilled by running the anonymisation' using errcode = 'P0001';
        end if;
        new.fulfilled_at := coalesce(new.fulfilled_at, now());
      when 'closed' then
        new.closed_at := coalesce(new.closed_at, now());
      when 'withdrawn' then
        new.withdrawn_at := coalesce(new.withdrawn_at, now());
      else null;
    end case;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'privacy_requests_guard' and tgrelid = 'public.privacy_requests'::regclass) then
    create trigger privacy_requests_guard before insert or update on public.privacy_requests
      for each row execute function private.privacy_requests_guard();
  end if;
end $$;

-- Timeline row for every status change, whoever made it.
create or replace function private.privacy_requests_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_party public.party := case
    when private.is_platform_staff() then 'platform'::public.party
    when (select auth.uid()) is not null and (select auth.uid()) = new.user_id then 'customer'::public.party
    else 'system'::public.party end;
begin
  if tg_op = 'INSERT' then
    insert into public.privacy_request_events (request_id, actor_id, actor_party, event, to_status, note)
    values (new.id, (select auth.uid()), v_party, 'submitted', new.status, 'We received your request.');
  elsif new.status is distinct from old.status then
    insert into public.privacy_request_events (request_id, actor_id, actor_party, event, from_status, to_status, note)
    values (new.id, (select auth.uid()), v_party, 'status_changed', old.status, new.status,
      case new.status
        when 'identity_verified' then 'We confirmed it''s you.'
        when 'approved' then 'Your request was approved.'
        when 'export_ready' then 'Your data export is ready to download.'
        when 'fulfilled' then coalesce(new.fulfilment_note, 'Your request has been completed.')
        when 'refused' then 'We could not carry out this request: ' || coalesce(new.decision_reason, '')
        when 'closed' then 'This request is closed.'
        when 'withdrawn' then 'You withdrew this request.'
        else null end);
  end if;
  return null;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'privacy_requests_after' and tgrelid = 'public.privacy_requests'::regclass) then
    create trigger privacy_requests_after after insert or update of status on public.privacy_requests
      for each row execute function private.privacy_requests_after();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Marketing opt-out (immediate) and anonymisation
-- ---------------------------------------------------------------------------
-- Records a marketing withdrawal (append-only consent history) and switches off the marketing preference.
create or replace function private.apply_marketing_opt_out(p_user uuid, p_context text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_version text := coalesce((select s.value #>> '{}' from public.platform_settings s where s.key = 'privacy_version'), 'unversioned');
begin
  if coalesce((select c.granted from public.consents c where c.user_id = p_user and c.type = 'marketing'
                order by c.created_at desc, c.id desc limit 1), true) then
    insert into public.consents (user_id, type, version, granted, context)
    values (p_user, 'marketing', v_version, false, left(p_context, 60));
  end if;
  update public.profiles
     set notification_prefs = coalesce(notification_prefs, '{}'::jsonb) || jsonb_build_object('marketing', false)
   where id = p_user and coalesce(notification_prefs ->> 'marketing', 'true') <> 'false';
end $$;

-- Erase or scrub everything Covva does not need to keep about a person; count what is retained. With p_dry_run the
-- counts are returned and nothing changes. Returns { dry_run, has_retained_records, scrubbed{}, retained{}, storage_paths[] }.
-- storage_paths are objects the caller (server) removes from Storage (avatar, voice notes, old exports).
create or replace function private.anonymise_subject(p_user uuid, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text; v_tail text; v_avatar text; v_retained boolean;
  v_scrubbed jsonb := '{}'::jsonb; v_kept jsonb := '{}'::jsonb; v_paths text[] := '{}';
  v_contacts uuid[]; v_bens uuid[]; v_n int;
  v_version text := coalesce((select s.value #>> '{}' from public.platform_settings s where s.key = 'privacy_version'), 'unversioned');
begin
  select lower(p.email::text), private.phone_tail(p.phone), p.avatar_url into v_email, v_tail, v_avatar
    from public.profiles p where p.id = p_user;
  if not found then
    raise exception 'There is no profile for this person' using errcode = 'P0001';
  end if;
  if not p_dry_run then
    perform set_config('app.privacy_scrub', '1', true);
  end if;

  -- What is retained (counted, never changed) ---------------------------------------------------------------
  v_kept := jsonb_build_object(
    'policies', (select count(*) from public.policies where customer_id = p_user),
    'claims', (select count(*) from public.claims where customer_id = p_user),
    'payments', (select count(*) from public.payments where customer_id = p_user),
    'requests', (select count(*) from public.requests where customer_id = p_user and status <> 'draft'),
    'applications', (select count(*) from public.applications where customer_id = p_user),
    'documents', (select count(*) from public.documents where owner_id = p_user),
    'complaints', (select count(*) from public.complaints where customer_id = p_user),
    'kyc_verifications', (select count(*) from public.kyc_verifications where user_id = p_user),
    'messages', (select count(*) from public.request_messages m join public.requests r on r.id = m.request_id where r.customer_id = p_user)
              + (select count(*) from public.claim_messages m join public.claims c on c.id = m.claim_id where c.customer_id = p_user),
    'consents', (select count(*) from public.consents where user_id = p_user and type not in ('marketing', 'ai_assistance')),
    'beneficiaries_on_policies', (select count(*) from public.beneficiaries b where b.sponsor_user_id = p_user
                                   and (exists (select 1 from public.policies p where p.beneficiary_id = b.id)
                                        or exists (select 1 from public.sponsorships s where s.beneficiary_id = b.id)
                                        or exists (select 1 from public.requests r where r.beneficiary_id = b.id)))
  );
  v_retained := (v_kept ->> 'policies')::int + (v_kept ->> 'claims')::int + (v_kept ->> 'payments')::int > 0;

  -- Profile: contact details, address, identity numbers, avatar, preferences. The name is kept only when insurance
  -- records are retained (it identifies the policyholder on those records); otherwise it is erased too.
  v_scrubbed := v_scrubbed || jsonb_build_object('profile', 1);
  if v_avatar is not null and v_avatar !~* '^https?://' then v_paths := v_paths || v_avatar; end if;
  if not p_dry_run then
    update public.profiles set
      full_name = case when v_retained then full_name else 'Deleted customer' end,
      business_name = case when v_retained and account_type = 'business' then business_name end,
      preferred_name = null, email = null, phone = null, date_of_birth = null, ghana_card_number = null,
      region = null, city = null, avatar_url = null, timezone = null,
      notification_prefs = '{"email": false, "sms": false, "push": false, "whatsapp": false, "marketing": false}'::jsonb,
      whatsapp_opt_in = false, active_workspace = null,
      anonymised_at = coalesce(anonymised_at, now())
    where id = p_user;
  end if;

  -- Optional consents: drop the device metadata and record a final withdrawal (lawful-basis consents are retained).
  select count(*) into v_n from public.consents
   where user_id = p_user and type in ('marketing', 'ai_assistance') and (ip_address is not null or user_agent is not null);
  v_scrubbed := v_scrubbed || jsonb_build_object('optional_consents', v_n);
  if not p_dry_run then
    update public.consents set ip_address = null, user_agent = null
     where user_id = p_user and type in ('marketing', 'ai_assistance') and (ip_address is not null or user_agent is not null);
    insert into public.consents (user_id, type, version, granted, context)
    select p_user, t.type, v_version, false, 'privacy_deletion'
      from (values ('marketing'::public.consent_type), ('ai_assistance'::public.consent_type)) as t(type)
     where coalesce((select c.granted from public.consents c where c.user_id = p_user and c.type = t.type
                      order by c.created_at desc, c.id desc limit 1), true);
  end if;

  -- Leads (enquiry forms, callbacks, renewal reminders) matching the person's email or phone.
  select count(*) into v_n from public.leads l
   where coalesce(l.metadata ->> 'erased_at', '') = ''
     and ((v_email is not null and lower(l.email::text) = v_email) or (v_tail is not null and private.phone_tail(l.phone) = v_tail));
  v_scrubbed := v_scrubbed || jsonb_build_object('leads', v_n);
  if not p_dry_run then
    update public.leads l set name = 'Erased', email = null, phone = null, organization = null, message = null, notes = null,
           utm = '{}'::jsonb, metadata = jsonb_build_object('erased_at', now(), 'reason', 'privacy_request')
     where coalesce(l.metadata ->> 'erased_at', '') = ''
       and ((v_email is not null and lower(l.email::text) = v_email) or (v_tail is not null and private.phone_tail(l.phone) = v_tail));
  end if;

  -- AI assistant transcripts (deleted) and AI usage rows (detached from the person; costs only).
  select count(*) into v_n from public.ai_threads where user_id = p_user;
  v_scrubbed := v_scrubbed || jsonb_build_object('ai_threads', v_n);
  select count(*) into v_n from public.ai_usage where user_id = p_user;
  v_scrubbed := v_scrubbed || jsonb_build_object('ai_usage_detached', v_n);
  if not p_dry_run then
    delete from public.ai_threads where user_id = p_user;
    update public.ai_usage set user_id = null where user_id = p_user;
  end if;

  -- Needs-assessment answers.
  select count(*) into v_n from public.needs_assessments where user_id = p_user and answers <> '{}'::jsonb;
  v_scrubbed := v_scrubbed || jsonb_build_object('needs_assessments', v_n);
  if not p_dry_run then
    update public.needs_assessments set answers = '{}'::jsonb where user_id = p_user and answers <> '{}'::jsonb;
  end if;

  -- WhatsApp: transcripts scrubbed; the contact stays opted OUT (phone kept only as a suppression entry).
  select coalesce(array_agg(c.id), '{}') into v_contacts from public.wa_contacts c
   where c.user_id = p_user or (v_tail is not null and private.phone_tail(c.phone) = v_tail);
  select count(*) into v_n from public.wa_messages m
   where m.conversation_id in (select v.id from public.wa_conversations v where v.contact_id = any (v_contacts))
     and (m.body is not null or m.payload <> '{}'::jsonb);
  v_scrubbed := v_scrubbed || jsonb_build_object('whatsapp_messages', v_n, 'whatsapp_contacts', coalesce(array_length(v_contacts, 1), 0));
  if not p_dry_run and coalesce(array_length(v_contacts, 1), 0) > 0 then
    update public.wa_messages m set body = null, payload = '{}'::jsonb
     where m.conversation_id in (select v.id from public.wa_conversations v where v.contact_id = any (v_contacts))
       and (m.body is not null or m.payload <> '{}'::jsonb);
    update public.wa_contacts c set display_name = null, user_id = null, opted_in = false,
           opted_out_at = coalesce(c.opted_out_at, now())
     where c.id = any (v_contacts);
  end if;

  -- USSD sessions (phone number and menu state).
  select count(*) into v_n from public.ussd_sessions s
   where s.customer_id = p_user or (v_tail is not null and private.phone_tail(s.msisdn) = v_tail);
  v_scrubbed := v_scrubbed || jsonb_build_object('ussd_sessions', v_n);
  if not p_dry_run then
    delete from public.ussd_sessions s where s.customer_id = p_user or (v_tail is not null and private.phone_tail(s.msisdn) = v_tail);
  end if;

  -- Voice notes not attached to a claim (claim evidence is retained with the claim).
  select count(*) into v_n from public.voice_notes where owner_id = p_user and claim_id is null;
  v_scrubbed := v_scrubbed || jsonb_build_object('voice_notes', v_n);
  v_paths := v_paths || coalesce((select array_agg(storage_path) from public.voice_notes where owner_id = p_user and claim_id is null), '{}');
  if not p_dry_run then
    delete from public.voice_notes where owner_id = p_user and claim_id is null;
  end if;

  -- Push tokens and in-app notifications.
  select count(*) into v_n from public.device_tokens where user_id = p_user;
  v_scrubbed := v_scrubbed || jsonb_build_object('device_tokens', v_n);
  select count(*) into v_n from public.notifications where user_id = p_user;
  v_scrubbed := v_scrubbed || jsonb_build_object('notifications', v_n);
  if not p_dry_run then
    delete from public.device_tokens where user_id = p_user;
    delete from public.notifications where user_id = p_user;
  end if;

  -- Shared quote links (revoked), referral links (disabled), saved cards (revoked) and recurring sponsor payments (cancelled).
  select count(*) into v_n from public.quote_shares where created_by = p_user and expires_at > now();
  v_scrubbed := v_scrubbed || jsonb_build_object('quote_shares', v_n);
  select count(*) into v_n from public.referral_links where owner_user_id = p_user and disabled_at is null;
  v_scrubbed := v_scrubbed || jsonb_build_object('referral_links', v_n);
  select count(*) into v_n from public.payment_methods where user_id = p_user and (status <> 'revoked' or provider_token_ref is not null);
  v_scrubbed := v_scrubbed || jsonb_build_object('payment_methods', v_n);
  select count(*) into v_n from public.sponsor_subscriptions where sponsor_user_id = p_user and status <> 'cancelled';
  v_scrubbed := v_scrubbed || jsonb_build_object('sponsor_subscriptions_cancelled', v_n);
  if not p_dry_run then
    update public.quote_shares set expires_at = now() where created_by = p_user and expires_at > now();
    update public.referral_links set disabled_at = now() where owner_user_id = p_user and disabled_at is null;
    update public.payment_methods set status = 'revoked', is_default = false, provider_token_ref = null, provider_customer_ref = null
     where user_id = p_user and (status <> 'revoked' or provider_token_ref is not null);
    update public.sponsor_subscriptions set status = 'cancelled' where sponsor_user_id = p_user and status <> 'cancelled';
  end if;

  -- Family: beneficiaries who are not on any policy, request or sponsorship are deleted (cascades their consents and
  -- household memberships); household names are cleared. Beneficiaries on retained records are kept.
  select coalesce(array_agg(b.id), '{}') into v_bens from public.beneficiaries b
   where b.sponsor_user_id = p_user
     and not exists (select 1 from public.policies p where p.beneficiary_id = b.id)
     and not exists (select 1 from public.sponsorships s where s.beneficiary_id = b.id)
     and not exists (select 1 from public.requests r where r.beneficiary_id = b.id);
  select count(*) into v_n from public.households where owner_user_id = p_user and name is distinct from 'Household';
  v_scrubbed := v_scrubbed || jsonb_build_object('beneficiaries', coalesce(array_length(v_bens, 1), 0), 'households', v_n);
  if not p_dry_run then
    delete from public.beneficiaries where id = any (v_bens);
    update public.households set name = 'Household' where owner_user_id = p_user and name is distinct from 'Household';
  end if;

  -- Saved drafts: quote-request drafts and draft claims never sent to anyone.
  select count(*) into v_n from public.requests where customer_id = p_user and status = 'draft';
  v_scrubbed := v_scrubbed || jsonb_build_object('request_drafts', v_n);
  select count(*) into v_n from public.claims where customer_id = p_user and status = 'draft';
  v_scrubbed := v_scrubbed || jsonb_build_object('claim_drafts', v_n);
  if not p_dry_run then
    update public.requests set risk_data = '{}'::jsonb, title = null, status = 'cancelled',
           cancelled_reason = 'Draft erased at the customer''s request'
     where customer_id = p_user and status = 'draft';
    update public.claims set description = null, location = null, third_parties = '[]'::jsonb, status = 'withdrawn'
     where customer_id = p_user and status = 'draft';
  end if;

  -- Earlier data exports of this person (files removed by the caller).
  v_paths := v_paths || coalesce((select array_agg(export_path) from public.privacy_requests where user_id = p_user and export_path is not null), '{}');
  if not p_dry_run then
    update public.privacy_requests set export_path = null where user_id = p_user and export_path is not null;
    perform set_config('app.privacy_scrub', '', true);
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'has_retained_records', v_retained,
    'scrubbed', v_scrubbed,
    'retained', v_kept,
    'storage_paths', to_jsonb(v_paths)
  );
end $$;
revoke all on function private.apply_marketing_opt_out(uuid, text), private.anonymise_subject(uuid, boolean) from public, anon, authenticated;
grant execute on function private.apply_marketing_opt_out(uuid, text), private.anonymise_subject(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7. RPCs — customer
-- ---------------------------------------------------------------------------
create or replace function public.submit_privacy_request(p_type public.privacy_request_type, p_note text default null, p_channel text default 'web')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_channel text := coalesce(nullif(btrim(coalesce(p_channel, '')), ''), 'web');
  v_open text;
  v_row public.privacy_requests;
begin
  if v_uid is null then
    raise exception 'Please sign in to make a privacy request' using errcode = 'P0001';
  end if;
  if p_type is null then
    raise exception 'Choose what you would like us to do' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.anonymised_at is not null) then
    raise exception 'This account has already been deleted' using errcode = 'P0001';
  end if;
  if v_channel not in ('web', 'mobile') then
    raise exception 'Requests made here come from the website or the app' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'Please keep your note under 2,000 characters' using errcode = 'P0001';
  end if;
  if p_type = 'correction' and length(coalesce(v_note, '')) < 10 then
    raise exception 'Tell us what is wrong and what it should say (at least 10 characters)' using errcode = 'P0001';
  end if;
  if p_type = 'objection' and length(coalesce(v_note, '')) < 10 then
    raise exception 'Tell us which use of your data you object to (at least 10 characters)' using errcode = 'P0001';
  end if;
  select r.reference into v_open from public.privacy_requests r
   where r.user_id = v_uid and r.type = p_type and r.status in ('submitted', 'identity_verified', 'approved', 'export_ready')
   limit 1;
  if v_open is not null then
    raise exception 'You already have an open request like this (%). We''ll keep you updated there.', v_open using errcode = 'P0001';
  end if;
  -- Abuse guard (demo / E2E accounts are exempt so the automated suites can run repeatedly).
  if not private.is_test_subject(v_uid)
     and (select count(*) from public.privacy_requests r where r.user_id = v_uid and r.created_at > now() - interval '30 days') >= 10 then
    raise exception 'You have made several requests recently. Please contact support and we''ll help.' using errcode = 'P0001';
  end if;

  perform set_config('app.privacy_rpc', '1', true);
  insert into public.privacy_requests (user_id, type, channel, note, due_at)
  values (v_uid, p_type, v_channel, v_note,
          now() + make_interval(days => private.int_setting('privacy_request_due_days', 30, 1, 90)))
  returning * into v_row;

  -- Marketing opt-out takes effect straight away; no identity check is needed to stop marketing.
  if p_type = 'marketing_opt_out' then
    perform private.apply_marketing_opt_out(v_uid, 'privacy_request');
    update public.privacy_requests
       set status = 'fulfilled',
           fulfilment_note = 'Marketing is switched off. You will still get service messages about your cover, quotes and claims.'
     where id = v_row.id
     returning * into v_row;
  end if;
  perform set_config('app.privacy_rpc', '', true);

  return jsonb_build_object('id', v_row.id, 'reference', v_row.reference, 'status', v_row.status, 'due_at', v_row.due_at);
end $$;
comment on function public.submit_privacy_request(public.privacy_request_type, text, text) is
  'Customer: make an Act 843 request (access, correction, deletion, objection, marketing opt-out). Marketing opt-out is applied immediately.';

create or replace function public.withdraw_privacy_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.privacy_requests;
begin
  select * into v_row from public.privacy_requests where id = p_id;
  if not found or v_row.user_id is distinct from auth.uid() then
    raise exception 'We could not find that request' using errcode = 'P0001';
  end if;
  if v_row.status not in ('submitted', 'identity_verified', 'approved') then
    raise exception 'This request can no longer be withdrawn' using errcode = 'P0001';
  end if;
  update public.privacy_requests set status = 'withdrawn' where id = p_id;
end $$;

-- Called by the download route (as the customer) just before the file is streamed. Validates and counts the download.
create or replace function public.record_privacy_export_download(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.privacy_requests;
begin
  select * into v_row from public.privacy_requests where id = p_id;
  if not found or v_row.user_id is distinct from auth.uid() then
    raise exception 'We could not find that request' using errcode = 'P0001';
  end if;
  if v_row.status <> 'export_ready' or v_row.export_path is null then
    raise exception 'There is no export ready to download for this request' using errcode = 'P0001';
  end if;
  if v_row.export_expires_at is not null and v_row.export_expires_at < now() then
    raise exception 'This download has expired. Make a new request and we''ll prepare a fresh copy.' using errcode = 'P0001';
  end if;
  update public.privacy_requests
     set export_downloaded_at = now(), export_download_count = export_download_count + 1
   where id = p_id;
  insert into public.privacy_request_events (request_id, actor_id, actor_party, event, note)
  values (p_id, auth.uid(), 'customer', 'export_downloaded', 'You downloaded your data.');
  return jsonb_build_object('path', v_row.export_path, 'reference', v_row.reference);
end $$;

-- ---------------------------------------------------------------------------
-- 8. RPCs — staff (privacy officers: platform_admin, platform_ops, compliance) and the system
-- ---------------------------------------------------------------------------
-- p_action: verify_identity (p_method), approve, refuse (p_reason), fulfil (correction / objection; p_reason = what was
-- done, shown to the customer), close, expire_export (system / staff: the download window ended), note (internal).
create or replace function public.privacy_request_action(p_id uuid, p_action text, p_reason text default null, p_method text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.privacy_requests;
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_party public.party := case when private.is_service_role() then 'system'::public.party else 'platform'::public.party end;
begin
  if not (private.is_privacy_officer() or private.is_service_role()) then
    raise exception 'Only privacy officers (platform admin, operations or compliance) can act on privacy requests' using errcode = 'P0001';
  end if;
  select * into v_row from public.privacy_requests where id = p_id for update;
  if not found then
    raise exception 'Privacy request not found' using errcode = 'P0001';
  end if;
  if v_reason is not null and length(v_reason) > 2000 then
    raise exception 'Keep the note under 2,000 characters' using errcode = 'P0001';
  end if;
  -- Repeating a step is not a transition (the trigger only sees status changes), so refuse it here.
  if (p_action = 'verify_identity' and v_row.status <> 'submitted')
     or (p_action = 'approve' and v_row.status = 'approved')
     or (p_action = 'refuse' and v_row.status = 'refused')
     or (p_action = 'fulfil' and v_row.status = 'fulfilled')
     or (p_action = 'close' and v_row.status = 'closed') then
    raise exception 'This request is % — that step is not available now', replace(v_row.status::text, '_', ' ') using errcode = 'P0001';
  end if;

  case p_action
    when 'verify_identity' then
      if p_method is null or p_method not in ('signed_in_session', 'ghana_card', 'video_call', 'in_person', 'other') then
        raise exception 'Choose how identity was verified' using errcode = 'P0001';
      end if;
      update public.privacy_requests
         set status = 'identity_verified', identity_method = p_method, identity_verified_by = v_uid, identity_verified_at = now()
       where id = p_id returning * into v_row;
    when 'approve' then
      update public.privacy_requests set status = 'approved', decided_by = v_uid, decision_reason = v_reason
       where id = p_id returning * into v_row;
    when 'refuse' then
      if length(coalesce(v_reason, '')) < 5 then
        raise exception 'Give the reason for refusing (at least 5 characters); the customer is told it' using errcode = 'P0001';
      end if;
      update public.privacy_requests set status = 'refused', decided_by = v_uid, decision_reason = v_reason
       where id = p_id returning * into v_row;
    when 'fulfil' then
      if v_row.type not in ('correction', 'objection') then
        raise exception 'Only correction and objection requests are completed by hand. Deletion runs the anonymisation; access sends an export.' using errcode = 'P0001';
      end if;
      if length(coalesce(v_reason, '')) < 5 then
        raise exception 'Describe what was done (at least 5 characters); the customer is told it' using errcode = 'P0001';
      end if;
      update public.privacy_requests set status = 'fulfilled', fulfilment_note = v_reason
       where id = p_id returning * into v_row;
    when 'close' then
      update public.privacy_requests set status = 'closed', closed_by = v_uid where id = p_id returning * into v_row;
    when 'expire_export' then
      if v_row.export_path is null and v_row.status <> 'export_ready' then
        return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'changed', false);
      end if;
      update public.privacy_requests
         set export_path = null,
             status = case when status = 'export_ready' then 'closed'::public.privacy_request_status else status end
       where id = p_id returning * into v_row;
      insert into public.privacy_request_events (request_id, actor_id, actor_party, event, note)
      values (p_id, v_uid, v_party, 'export_expired', 'Your download link expired and the file was deleted.');
    when 'note' then
      if v_reason is null then
        raise exception 'Write the note' using errcode = 'P0001';
      end if;
    else
      raise exception 'Unknown action %', p_action using errcode = 'P0001';
  end case;

  if v_reason is not null and p_action in ('verify_identity', 'approve', 'note', 'close') then
    insert into public.privacy_request_events (request_id, actor_id, actor_party, event, note, visible_to_customer)
    values (p_id, v_uid, v_party, 'staff_note', v_reason, false);
  end if;
  return jsonb_build_object('id', v_row.id, 'reference', v_row.reference, 'status', v_row.status, 'user_id', v_row.user_id, 'changed', true);
end $$;

-- The server uploads the JSON (private bucket, privacy-exports/<user>/…) and then records it here as the staff member.
create or replace function public.record_privacy_export(p_id uuid, p_path text, p_bytes bigint, p_sha256 text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.privacy_requests;
  v_previous text;
begin
  if not (private.is_privacy_officer() or private.is_service_role()) then
    raise exception 'Only privacy officers can generate exports' using errcode = 'P0001';
  end if;
  select * into v_row from public.privacy_requests where id = p_id for update;
  if not found then
    raise exception 'Privacy request not found' using errcode = 'P0001';
  end if;
  if v_row.type <> 'access' then
    raise exception 'Exports are generated for access requests only' using errcode = 'P0001';
  end if;
  if v_row.status not in ('identity_verified', 'approved', 'export_ready') then
    raise exception 'Verify the person''s identity before generating their export' using errcode = 'P0001';
  end if;
  if p_path is null or p_path !~ ('^privacy-exports/' || v_row.user_id::text || '/[^/]+\.json$') then
    raise exception 'The export must be stored under privacy-exports/<customer id>/' using errcode = 'P0001';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_bytes is null or p_bytes < 2 then
    raise exception 'The export checksum or size is missing' using errcode = 'P0001';
  end if;
  v_previous := v_row.export_path;
  update public.privacy_requests
     set export_path = p_path, export_bytes = p_bytes, export_sha256 = p_sha256, export_generated_at = now(),
         export_expires_at = now() + make_interval(days => private.int_setting('privacy_export_ttl_days', 7, 1, 30)),
         export_downloaded_at = null,
         status = 'export_ready'
   where id = p_id returning * into v_row;
  if v_previous is not null then
    insert into public.privacy_request_events (request_id, actor_id, actor_party, event, note)
    values (p_id, auth.uid(), case when private.is_service_role() then 'system'::public.party else 'platform'::public.party end,
            'export_regenerated', 'We prepared a fresh copy of your data.');
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'expires_at', v_row.export_expires_at, 'previous_path', v_previous, 'user_id', v_row.user_id);
end $$;

-- Deletion: anonymise (or preview with p_dry_run), then mark fulfilled with what was retained and why.
create or replace function public.fulfil_privacy_deletion(p_id uuid, p_dry_run boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.privacy_requests;
  v_summary jsonb;
  v_kept jsonb;
  v_note text;
begin
  if not (private.is_privacy_officer() or private.is_service_role()) then
    raise exception 'Only privacy officers can fulfil deletion requests' using errcode = 'P0001';
  end if;
  select * into v_row from public.privacy_requests where id = p_id for update;
  if not found then
    raise exception 'Privacy request not found' using errcode = 'P0001';
  end if;
  if v_row.type <> 'deletion' then
    raise exception 'This is not a deletion request' using errcode = 'P0001';
  end if;
  if not p_dry_run and v_row.status <> 'approved' then
    raise exception 'Verify identity and approve the request before deleting data' using errcode = 'P0001';
  end if;
  if p_dry_run and v_row.status not in ('submitted', 'identity_verified', 'approved') then
    raise exception 'This request is no longer open' using errcode = 'P0001';
  end if;

  v_summary := private.anonymise_subject(v_row.user_id, p_dry_run);
  if p_dry_run then
    return v_summary;
  end if;

  v_kept := v_summary -> 'retained';
  v_note := case when (v_summary ->> 'has_retained_records')::boolean
    then 'We erased your contact details, marketing choices, chats, drafts and saved cards. We have to keep your insurance records ('
         || (v_kept ->> 'policies') || ' policies, ' || (v_kept ->> 'claims') || ' claims, ' || (v_kept ->> 'payments')
         || ' payments and their documents) because insurance, tax and anti-money-laundering rules require it. They are kept securely and deleted when the retention period ends.'
    else 'We erased your account details, contact details, marketing choices, chats and drafts. You had no policies, claims or payments to keep.'
  end;
  update public.privacy_requests
     set anonymised_at = now(), anonymisation_summary = v_summary - 'storage_paths', retention_note = v_note,
         fulfilment_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_note),
         status = 'fulfilled'
   where id = p_id returning * into v_row;
  return v_summary || jsonb_build_object('retention_note', v_note);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Retention job: one data class per call, idempotent, E2E / demo data excluded
-- ---------------------------------------------------------------------------
-- Applies (or counts, when p_dry_run) one retention rule. Rows already erased no longer match, so re-running is
-- harmless. Cutoffs newer than 30 days ago are refused as a guard against a mistyped period.
create or replace function private.apply_retention(p_class text, p_cutoff timestamptz, p_dry_run boolean, p_limit int default 5000)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int := 0;
  v_limit int := greatest(1, least(coalesce(p_limit, 5000), 20000));
begin
  if p_cutoff is null or p_cutoff > now() - interval '30 days' then
    raise exception 'Retention cutoff for % is too recent (%); periods must be at least 30 days', p_class, p_cutoff using errcode = 'P0001';
  end if;
  if not p_dry_run then
    perform set_config('app.privacy_scrub', '1', true);
  end if;

  case p_class
    -- Customer enquiries that never became an account (no profile with that email), not qualified, older than cutoff.
    when 'unconverted_leads' then
      with t as (
        select l.id from public.leads l
         where l.created_at < p_cutoff
           and l.kind in ('customer', 'other', 'press')
           and l.status <> 'qualified'
           and coalesce(l.metadata ->> 'erased_at', '') = ''
           and coalesce(l.name, '') not like 'E2E-%' and coalesce(l.message, '') not like 'E2E-%'
           and coalesce(l.email::text, '') not ilike '%.example'
           and not (l.email is not null and exists (select 1 from public.profiles p where lower(p.email::text) = lower(l.email::text)))
         limit v_limit
      ), u as (
        update public.leads l set name = 'Erased', email = null, phone = null, organization = null, message = null, notes = null,
               utm = '{}'::jsonb, metadata = jsonb_build_object('erased_at', now(), 'reason', 'retention')
          from t where l.id = t.id and not p_dry_run
        returning 1
      )
      select case when p_dry_run then (select count(*) from t) else (select count(*) from u) end into v_n;

    -- AI assistant threads untouched since the cutoff.
    when 'ai_chat_logs' then
      with t as (
        select a.id from public.ai_threads a
         where a.updated_at < p_cutoff and coalesce(a.title, '') not like 'E2E-%' and not private.is_test_subject(a.user_id)
         limit v_limit
      ), d as (
        delete from public.ai_threads a using t where a.id = t.id and not p_dry_run returning 1
      )
      select case when p_dry_run then (select count(*) from t) else (select count(*) from d) end into v_n;

    -- WhatsApp message bodies in conversations with no activity since the cutoff (contacts and opt-outs are kept).
    when 'whatsapp_transcripts' then
      with t as (
        select m.id from public.wa_messages m
          join public.wa_conversations c on c.id = m.conversation_id
          join public.wa_contacts k on k.id = c.contact_id
         where m.created_at < p_cutoff and coalesce(c.last_message_at, c.created_at) < p_cutoff
           and (m.body is not null or m.payload <> '{}'::jsonb)
           and coalesce(m.body, '') not like 'E2E-%' and not private.is_test_subject(k.user_id)
         limit v_limit
      ), u as (
        update public.wa_messages m set body = null, payload = '{}'::jsonb from t where m.id = t.id and not p_dry_run returning 1
      )
      select case when p_dry_run then (select count(*) from t) else (select count(*) from u) end into v_n;

    -- Quote-request drafts nobody touched since the cutoff: details erased, request cancelled.
    when 'abandoned_drafts' then
      with t as (
        select r.id from public.requests r
         where r.status = 'draft' and r.updated_at < p_cutoff
           and coalesce(r.title, '') not like 'E2E-%' and not private.is_test_subject(r.customer_id)
         limit v_limit
      ), u as (
        update public.requests r set risk_data = '{}'::jsonb, title = null, status = 'cancelled',
               cancelled_reason = 'Draft expired (retention)'
          from t where r.id = t.id and not p_dry_run
        returning 1
      )
      select case when p_dry_run then (select count(*) from t) else (select count(*) from u) end into v_n;

    -- Needs assessments made without signing in.
    when 'anonymous_needs_assessments' then
      with t as (
        select n.id from public.needs_assessments n
         where n.user_id is null and n.created_at < p_cutoff and n.answers <> '{}'::jsonb
         limit v_limit
      ), u as (
        update public.needs_assessments n set answers = '{}'::jsonb from t where n.id = t.id and not p_dry_run returning 1
      )
      select case when p_dry_run then (select count(*) from t) else (select count(*) from u) end into v_n;

    -- USSD sessions (phone number + menu state).
    when 'ussd_sessions' then
      with t as (
        select s.id from public.ussd_sessions s
         where coalesce(s.ended_at, s.updated_at) < p_cutoff and not private.is_test_subject(s.customer_id)
         limit v_limit
      ), d as (
        delete from public.ussd_sessions s using t where s.id = t.id and not p_dry_run returning 1
      )
      select case when p_dry_run then (select count(*) from t) else (select count(*) from d) end into v_n;

    -- Push tokens of devices not seen since the cutoff.
    when 'stale_device_tokens' then
      with t as (
        select d.id from public.device_tokens d
         where d.last_seen_at < p_cutoff and not private.is_test_subject(d.user_id)
         limit v_limit
      ), d as (
        delete from public.device_tokens x using t where x.id = t.id and not p_dry_run returning 1
      )
      select case when p_dry_run then (select count(*) from t) else (select count(*) from d) end into v_n;

    else
      raise exception 'Unknown retention data class %', p_class using errcode = 'P0001';
  end case;

  if not p_dry_run then
    perform set_config('app.privacy_scrub', '', true);
  end if;
  return coalesce(v_n, 0);
end $$;
revoke all on function private.apply_retention(text, timestamptz, boolean, int) from public, anon, authenticated;
grant execute on function private.apply_retention(text, timestamptz, boolean, int) to service_role;

-- Runs a retention plan ([{ "class": "...", "cutoff": "<timestamptz>" }, …]) and logs it in privacy_retention_runs.
-- Each class runs in its own sub-transaction: one failing class is reported and the others still run.
create or replace function public.run_privacy_retention(p_plan jsonb, p_dry_run boolean default true, p_triggered_by text default 'cron')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb; v_class text; v_cutoff timestamptz; v_n int;
  v_results jsonb := '{}'::jsonb; v_ok boolean := true; v_run uuid;
begin
  if not (private.is_service_role() or private.is_privacy_officer()) then
    raise exception 'Only the platform can run retention jobs' using errcode = 'P0001';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' then
    raise exception 'The retention plan must be a list of { class, cutoff }' using errcode = 'P0001';
  end if;
  -- Staff may preview; enforcing needs the scheduled job (service role).
  if not p_dry_run and not private.is_service_role() then
    raise exception 'Retention is enforced by the scheduled job only; staff can run a dry run' using errcode = 'P0001';
  end if;
  insert into public.privacy_retention_runs (dry_run, triggered_by, actor_id, plan)
  values (p_dry_run, case when p_triggered_by in ('cron', 'staff', 'manual') then p_triggered_by else 'manual' end, auth.uid(), p_plan)
  returning id into v_run;

  for v_item in select * from jsonb_array_elements(p_plan) loop
    v_class := v_item ->> 'class';
    if v_class is not null and v_results ? v_class then
      continue; -- a class listed twice runs once (first entry wins)
    end if;
    begin
      v_cutoff := (v_item ->> 'cutoff')::timestamptz;
      v_n := private.apply_retention(v_class, v_cutoff, p_dry_run, coalesce((v_item ->> 'limit')::int, 5000));
      v_results := v_results || jsonb_build_object(v_class, jsonb_build_object('count', v_n, 'cutoff', v_cutoff));
    exception when others then
      v_ok := false;
      v_results := v_results || jsonb_build_object(coalesce(v_class, '?'), jsonb_build_object('error', sqlerrm));
    end;
  end loop;

  update public.privacy_retention_runs set results = v_results, ok = v_ok, finished_at = now() where id = v_run;
  return jsonb_build_object('run_id', v_run, 'dry_run', p_dry_run, 'ok', v_ok, 'results', v_results);
end $$;

revoke all on function public.submit_privacy_request(public.privacy_request_type, text, text),
  public.withdraw_privacy_request(uuid), public.record_privacy_export_download(uuid),
  public.privacy_request_action(uuid, text, text, text), public.record_privacy_export(uuid, text, bigint, text),
  public.fulfil_privacy_deletion(uuid, boolean, text), public.run_privacy_retention(jsonb, boolean, text)
  from public, anon;
grant execute on function public.submit_privacy_request(public.privacy_request_type, text, text),
  public.withdraw_privacy_request(uuid), public.record_privacy_export_download(uuid),
  public.privacy_request_action(uuid, text, text, text), public.record_privacy_export(uuid, text, bigint, text),
  public.fulfil_privacy_deletion(uuid, boolean, text), public.run_privacy_retention(jsonb, boolean, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. RLS
-- ---------------------------------------------------------------------------
alter table public.privacy_requests enable row level security;
alter table public.privacy_request_events enable row level security;
alter table public.privacy_retention_runs enable row level security;

-- Own requests, or platform staff. No insert / update / delete policies: writes go through the RPCs above.
select private.ensure_policy('privacy_requests', 'privacy requests: own or staff read', $p$
  create policy "privacy requests: own or staff read" on public.privacy_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);

select private.ensure_policy('privacy_request_events', 'privacy request events: own visible or staff read', $p$
  create policy "privacy request events: own visible or staff read" on public.privacy_request_events for select to authenticated
  using ((visible_to_customer and private.is_privacy_request_owner(request_id)) or (select private.is_platform_staff()))$p$);

select private.ensure_policy('privacy_retention_runs', 'privacy retention runs: staff read', $p$
  create policy "privacy retention runs: staff read" on public.privacy_retention_runs for select to authenticated
  using ((select private.is_platform_staff()))$p$);

-- ---------------------------------------------------------------------------
-- 11. Housekeeping: updated_at + audit, grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.privacy_requests'::regclass) then
    create trigger set_updated_at before update on public.privacy_requests for each row execute function private.set_updated_at();
  end if;
  foreach t in array array['privacy_requests', 'privacy_request_events', 'privacy_retention_runs'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

revoke all on public.privacy_requests, public.privacy_request_events, public.privacy_retention_runs from anon;
revoke insert, update, delete, truncate on public.privacy_requests, public.privacy_request_events, public.privacy_retention_runs from authenticated;
grant select on public.privacy_requests, public.privacy_request_events, public.privacy_retention_runs to authenticated;
grant select, insert, update on public.privacy_requests, public.privacy_request_events, public.privacy_retention_runs to service_role;
-- Requests and their history are evidence that a right was honoured: never deleted.
revoke delete, truncate on public.privacy_requests, public.privacy_request_events, public.privacy_retention_runs from service_role;
grant usage, select on sequence public.privacy_request_ref_seq to authenticated, service_role;

revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;
