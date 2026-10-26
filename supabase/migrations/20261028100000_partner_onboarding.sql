-- =============================================================================
-- Partner self-service onboarding (Addendum 3 B1/B4/C1/C2/C4/E, Addendum 2 C):
-- insurer/broker applications with e-signed agreement, admin verification RPCs,
-- broker→insurer appointment requests, licence status tracking + auto-suspend,
-- onboarding checklist, broker client import support. Additive only (no drops,
-- no deletes); policies/triggers are created only when missing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Partner applications
-- ---------------------------------------------------------------------------
create table if not exists public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  type public.org_type not null check (type in ('insurer', 'broker')),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'in_review', 'needs_changes', 'approved', 'rejected')),
  company_name text,
  legal_name text,
  registration_number text,
  nic_licence_number text,
  nic_licence_class text check (nic_licence_class is null or nic_licence_class in ('life', 'non_life', 'composite', 'broker')),
  nic_licence_expires_on date,
  address text,
  region text,
  website text,
  primary_contact jsonb not null default '{}'::jsonb,
  compliance_contact jsonb not null default '{}'::jsonb,
  principal_officer jsonb not null default '{}'::jsonb,
  -- {type:'bank'|'momo', bank_name, account_name, account_number, momo_network, momo_number}. Never card data.
  settlement_account jsonb not null default '{}'::jsonb,
  commercial_model text check (commercial_model is null or commercial_model in ('revenue_share', 'subscription')),
  -- insurers: [{category_slug, level:'L1'|'L2'|'L3'}]
  integration_levels jsonb not null default '[]'::jsonb,
  -- [{kind:'nic_licence'|'incorporation'|'partner_agreement'|'other', storage_path, name, uploaded_at}]
  documents jsonb not null default '[]'::jsonb,
  -- {version, signed_name, signed_title, signed_at, ip, user_agent, hash, provider}
  agreement jsonb not null default '{}'::jsonb,
  applicant_user_id uuid not null references auth.users (id) on delete cascade,
  created_org_id uuid references public.organizations (id),
  assisted_by uuid references auth.users (id),
  review_notes text,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_applications_no_card_data check (
    not (settlement_account ?| array['card_number', 'card', 'pan', 'cvv', 'cvc', 'expiry'])
    and (settlement_account ->> 'type' is null or settlement_account ->> 'type' in ('bank', 'momo'))
  )
);
comment on table public.partner_applications is
  'Self-service (or rep-assisted) registration of an insurer or broker: company, licence, contacts, settlement account, documents, e-signed partner agreement. Approved by platform staff, which creates the organisation.';
create index if not exists partner_applications_status_idx on public.partner_applications (status, submitted_at desc);
create index if not exists partner_applications_applicant_idx on public.partner_applications (applicant_user_id, created_at desc);
-- One open application per applicant and type.
create unique index if not exists partner_applications_one_open_per_applicant
  on public.partner_applications (applicant_user_id, type)
  where status in ('draft', 'submitted', 'in_review', 'needs_changes');

-- ---------------------------------------------------------------------------
-- 2. Appointment requests (broker → insurer, per product line)
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  broker_org_id uuid not null references public.organizations (id) on delete cascade,
  insurer_org_id uuid references public.organizations (id) on delete cascade,
  proposed_insurer_name text,
  category_id uuid not null references public.product_categories (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'revoked', 'admin_review')),
  appointment_letter_path text,
  requested_by uuid references auth.users (id),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_requests_target check (insurer_org_id is not null or nullif(trim(proposed_insurer_name), '') is not null)
);
comment on table public.appointment_requests is
  'A broker asks an insurer (on Covva: decided in the insurer portal; not on Covva: appointment letter reviewed by staff) to appoint it for a product line. Approval writes insurer_broker_appointments; revocation deactivates it immediately.';
create unique index if not exists appointment_requests_one_open_per_line
  on public.appointment_requests (broker_org_id, insurer_org_id, category_id)
  where insurer_org_id is not null and status in ('pending', 'admin_review', 'approved');
create index if not exists appointment_requests_insurer_idx on public.appointment_requests (insurer_org_id, status) where insurer_org_id is not null;
create index if not exists appointment_requests_broker_idx on public.appointment_requests (broker_org_id, created_at desc);
create index if not exists appointment_requests_review_idx on public.appointment_requests (status) where status = 'admin_review';

-- ---------------------------------------------------------------------------
-- 3. Columns on existing tables
-- ---------------------------------------------------------------------------
alter table public.organizations add column if not exists licence_status text not null default 'unverified';
alter table public.organizations add column if not exists suspended_reason text;
alter table public.organizations add column if not exists onboarding_checklist jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_licence_status_check') then
    alter table public.organizations add constraint organizations_licence_status_check
      check (licence_status in ('unverified', 'verified', 'expiring', 'lapsed'));
  end if;
end $$;
comment on column public.organizations.licence_status is 'NIC licence tracking: unverified → verified (staff check) → expiring (≤30 days) → lapsed (auto-suspended by the licence-status cron).';
comment on column public.organizations.suspended_reason is 'Why the organisation is suspended (e.g. licence_lapsed); cleared on reactivation.';
comment on column public.organizations.onboarding_checklist is 'Partner onboarding checklist {documents, verification, agreement, products, test_quote, go_live} each {done, at, by}.';

alter table public.leads add column if not exists tags text[] not null default '{}';
alter table public.leads add column if not exists metadata jsonb not null default '{}'::jsonb;
comment on column public.leads.tags is 'Campaign / source tags (renewal_reminder, broker_suggestion, …).';

alter table public.profiles add column if not exists assisted_service boolean not null default false;
comment on column public.profiles.assisted_service is 'Customer was brought on by a broker (bulk import / assisted onboarding) and is serviced through that broker.';

alter table public.customer_broker_assignments add column if not exists account_manager_id uuid references auth.users (id);
comment on column public.customer_broker_assignments.account_manager_id is 'Member of the broker organisation who looks after this customer.';

-- ---------------------------------------------------------------------------
-- 4. Housekeeping triggers (updated_at + audit)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['partner_applications', 'appointment_requests'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

-- Applicants may only write their own draft / needs_changes application, may not touch review
-- fields, and may only move it to 'submitted' once the essentials and the e-signature are present.
create or replace function private.partner_applications_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_privileged boolean := private.is_service_role() or private.is_platform_staff();
begin
  if tg_op = 'INSERT' then
    if not v_privileged then
      if new.applicant_user_id is distinct from (select auth.uid()) then
        raise exception 'An application can only be created for yourself' using errcode = 'P0001';
      end if;
      if new.status <> 'draft' then
        raise exception 'A new application starts as a draft' using errcode = 'P0001';
      end if;
      new.created_org_id := null; new.reviewed_by := null; new.reviewed_at := null; new.review_notes := null; new.submitted_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if not v_privileged then
    if old.applicant_user_id is distinct from (select auth.uid()) then
      raise exception 'You can only change your own application' using errcode = 'P0001';
    end if;
    if old.status not in ('draft', 'needs_changes') then
      raise exception 'This application is % and can no longer be edited', replace(old.status, '_', ' ') using errcode = 'P0001';
    end if;
    if (to_jsonb(old) -> 'applicant_user_id') is distinct from (to_jsonb(new) -> 'applicant_user_id')
       or (to_jsonb(old) -> 'created_org_id') is distinct from (to_jsonb(new) -> 'created_org_id')
       or (to_jsonb(old) -> 'reviewed_by') is distinct from (to_jsonb(new) -> 'reviewed_by')
       or (to_jsonb(old) -> 'reviewed_at') is distinct from (to_jsonb(new) -> 'reviewed_at')
       or (to_jsonb(old) -> 'review_notes') is distinct from (to_jsonb(new) -> 'review_notes')
       or (to_jsonb(old) -> 'assisted_by') is distinct from (to_jsonb(new) -> 'assisted_by')
       or (to_jsonb(old) -> 'type') is distinct from (to_jsonb(new) -> 'type')
       or (to_jsonb(old) -> 'submitted_at') is distinct from (to_jsonb(new) -> 'submitted_at') then
      raise exception 'Review fields are set by Covva staff' using errcode = 'P0001';
    end if;
    if new.status not in (old.status, 'submitted') then
      raise exception 'That status change is not allowed (% to %)', old.status, new.status using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    if nullif(trim(coalesce(new.company_name, '')), '') is null
       or nullif(trim(coalesce(new.nic_licence_number, '')), '') is null
       or nullif(trim(coalesce(new.primary_contact ->> 'email', '')), '') is null then
      raise exception 'Company name, NIC licence number and a primary contact email are required before submitting' using errcode = 'P0001';
    end if;
    if new.agreement ->> 'signed_at' is null or nullif(trim(coalesce(new.agreement ->> 'signed_name', '')), '') is null or new.agreement ->> 'hash' is null then
      raise exception 'The partner agreement must be signed before submitting' using errcode = 'P0001';
    end if;
    if new.type = 'broker' and new.commercial_model is null then
      raise exception 'Choose a commercial model (revenue share or subscription) before submitting' using errcode = 'P0001';
    end if;
    new.submitted_at := now();
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'partner_applications_guard' and tgrelid = 'public.partner_applications'::regclass) then
    create trigger partner_applications_guard before insert or update on public.partner_applications
      for each row execute function private.partner_applications_guard();
  end if;
end $$;

-- Appointment requests: brokers (owner/admin) raise them for their own organisation; the status
-- is derived from the target (insurer on Covva → pending; letter for an insurer not on Covva →
-- admin_review). Decisions go through decide_appointment_request().
create or replace function private.appointment_requests_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_privileged boolean := private.is_service_role() or private.is_platform_staff();
begin
  if tg_op = 'INSERT' then
    if not v_privileged then
      if not private.has_org_role(new.broker_org_id, '{owner,admin}') then
        raise exception 'Only an owner or admin of the broker can request an appointment' using errcode = 'P0001';
      end if;
      new.requested_by := (select auth.uid());
      new.decided_by := null; new.decided_at := null; new.decision_note := null;
      if new.insurer_org_id is not null then
        new.status := 'pending';
      else
        if new.appointment_letter_path is null then
          raise exception 'Upload the appointment letter for an insurer that is not yet on Covva' using errcode = 'P0001';
        end if;
        new.status := 'admin_review';
      end if;
    end if;
    if new.insurer_org_id is not null and not exists (
      select 1 from public.organizations o where o.id = new.insurer_org_id and o.type = 'insurer' and o.status <> 'offboarded'
    ) then
      raise exception 'The target organisation must be an insurer' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.organizations o where o.id = new.broker_org_id and o.type = 'broker') then
      raise exception 'Appointments are requested by broker organisations' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if not v_privileged then
    raise exception 'Appointment requests are decided through decide_appointment_request' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'appointment_requests_guard' and tgrelid = 'public.appointment_requests'::regclass) then
    create trigger appointment_requests_guard before insert or update or delete on public.appointment_requests
      for each row execute function private.appointment_requests_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.partner_applications enable row level security;
alter table public.appointment_requests enable row level security;

select private.ensure_policy('partner_applications', 'applications: applicant reads own', $p$
  create policy "applications: applicant reads own" on public.partner_applications for select to authenticated
  using (applicant_user_id = (select auth.uid()) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('partner_applications', 'applications: applicant creates draft', $p$
  create policy "applications: applicant creates draft" on public.partner_applications for insert to authenticated
  with check (applicant_user_id = (select auth.uid()) and status = 'draft')$p$);
select private.ensure_policy('partner_applications', 'applications: applicant edits open', $p$
  create policy "applications: applicant edits open" on public.partner_applications for update to authenticated
  using (applicant_user_id = (select auth.uid()) and status in ('draft', 'needs_changes'))
  with check (applicant_user_id = (select auth.uid()) and status in ('draft', 'needs_changes', 'submitted'))$p$);
select private.ensure_policy('partner_applications', 'applications: staff write', $p$
  create policy "applications: staff write" on public.partner_applications for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

select private.ensure_policy('appointment_requests', 'appointment requests: parties read', $p$
  create policy "appointment requests: parties read" on public.appointment_requests for select to authenticated
  using (broker_org_id in (select private.user_org_ids())
      or (insurer_org_id is not null and insurer_org_id in (select private.user_org_ids()))
      or (select private.is_platform_staff()))$p$);
select private.ensure_policy('appointment_requests', 'appointment requests: broker admins create', $p$
  create policy "appointment requests: broker admins create" on public.appointment_requests for insert to authenticated
  with check (private.has_org_role(broker_org_id, '{owner,admin}'))$p$);
select private.ensure_policy('appointment_requests', 'appointment requests: staff write', $p$
  create policy "appointment requests: staff write" on public.appointment_requests for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- Storage: applicants upload under documents/partner-applications/<application id>/…;
-- brokers upload appointment letters under documents/appointment-letters/<broker org id>/…;
-- staff read both. (Partner org members can already upload anywhere in the bucket.)
create or replace function private.can_write_application_folder(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_id uuid;
begin
  if coalesce(v_parts[1], '') <> 'partner-applications' or coalesce(v_parts[2], '') !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  v_id := v_parts[2]::uuid;
  return exists (
    select 1 from public.partner_applications a
    where a.id = v_id and a.applicant_user_id = (select auth.uid()) and a.status in ('draft', 'needs_changes')
  );
end $$;
create or replace function private.can_read_onboarding_folder(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := storage.foldername(p_name);
begin
  if coalesce(v_parts[2], '') !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
  if private.is_platform_staff() then
    return coalesce(v_parts[1], '') in ('partner-applications', 'appointment-letters');
  end if;
  if v_parts[1] = 'partner-applications' then
    return exists (select 1 from public.partner_applications a where a.id = v_parts[2]::uuid and a.applicant_user_id = (select auth.uid()));
  end if;
  if v_parts[1] = 'appointment-letters' then
    return v_parts[2]::uuid in (select private.user_org_ids());
  end if;
  return false;
end $$;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents bucket: partner applicant folder') then
    create policy "documents bucket: partner applicant folder" on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and private.can_write_application_folder(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents bucket: onboarding folders read') then
    create policy "documents bucket: onboarding folders read" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and private.can_read_onboarding_folder(name));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.unique_org_slug(p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_base text := trim(both '-' from regexp_replace(lower(coalesce(p_name, 'partner')), '[^a-z0-9]+', '-', 'g'));
  v_slug text;
  v_n int := 1;
begin
  if v_base = '' then v_base := 'partner'; end if;
  v_base := left(v_base, 60);
  v_slug := v_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;
  return v_slug;
end $$;

create or replace function private.notify_users(p_user_ids uuid[], p_kind text, p_title text, p_body text, p_link text, p_data jsonb default '{}'::jsonb, p_channels text[] default '{in_app,email}') returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v_uid uuid;
begin
  foreach v_uid in array coalesce(p_user_ids, '{}'::uuid[]) loop
    if v_uid is null then continue; end if;
    insert into public.notifications (user_id, kind, title, body, link, data, channels)
    values (v_uid, p_kind, left(p_title, 200), left(p_body, 2000), p_link, coalesce(p_data, '{}'::jsonb), p_channels);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function private.org_admin_user_ids(p_org uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct m.user_id), '{}'::uuid[]) from public.memberships m
  where m.org_id = p_org and m.active and m.role in ('owner', 'admin');
$$;

create or replace function private.platform_staff_user_ids(p_roles public.member_role[] default '{platform_admin,platform_ops,compliance}') returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct m.user_id), '{}'::uuid[]) from public.memberships m
  join public.organizations o on o.id = m.org_id
  where o.type = 'platform' and m.active and m.role = any (p_roles);
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC: decide an appointment request (approve / decline / revoke)
-- ---------------------------------------------------------------------------
create or replace function public.decide_appointment_request(p_id uuid, p_decision text, p_note text default null)
returns table (request_id uuid, status text, broker_org_id uuid, insurer_org_id uuid, category_id uuid, appointment_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_req public.appointment_requests;
  v_privileged boolean := private.is_service_role() or private.is_platform_staff();
  v_appt uuid;
  v_insurer_name text;
  v_cat text;
  v_title text;
begin
  if p_decision not in ('approve', 'decline', 'revoke') then
    raise exception 'Decision must be approve, decline or revoke' using errcode = 'P0001';
  end if;
  select * into v_req from public.appointment_requests r where r.id = p_id for update;
  if v_req.id is null then
    raise exception 'This appointment request is not valid' using errcode = 'P0001';
  end if;
  if not v_privileged then
    if v_req.insurer_org_id is null then
      raise exception 'Requests with an appointment letter are reviewed by Covva staff' using errcode = 'P0001';
    end if;
    if not private.has_org_role(v_req.insurer_org_id, '{owner,admin}') then
      raise exception 'Only an owner or admin of the insurer can decide this request' using errcode = 'P0001';
    end if;
  end if;

  if p_decision = 'approve' then
    if v_req.status not in ('pending', 'admin_review') then
      raise exception 'This request is % and cannot be approved', v_req.status using errcode = 'P0001';
    end if;
    if v_req.insurer_org_id is not null then
      insert into public.insurer_broker_appointments as a (insurer_org_id, broker_org_id, category_id, active, starts_on, ends_on, agreement_reference)
      values (v_req.insurer_org_id, v_req.broker_org_id, v_req.category_id, true, current_date, null, 'appointment request ' || v_req.id::text)
      on conflict (insurer_org_id, broker_org_id, category_id) do update
        set active = true, starts_on = coalesce(a.starts_on, excluded.starts_on), ends_on = null
      returning id into v_appt;
    end if;
    update public.appointment_requests set status = 'approved', decided_by = v_uid, decided_at = now(), decision_note = left(p_note, 1000) where id = v_req.id;
  elsif p_decision = 'decline' then
    if v_req.status not in ('pending', 'admin_review') then
      raise exception 'This request is % and cannot be declined', v_req.status using errcode = 'P0001';
    end if;
    update public.appointment_requests set status = 'declined', decided_by = v_uid, decided_at = now(), decision_note = left(p_note, 1000) where id = v_req.id;
  else
    if v_req.status <> 'approved' then
      raise exception 'Only an approved appointment can be revoked' using errcode = 'P0001';
    end if;
    if v_req.insurer_org_id is not null then
      -- Eligibility for new orders ends immediately (routing reads insurer_broker_appointments.active).
      update public.insurer_broker_appointments
         set active = false, ends_on = current_date
       where insurer_org_id = v_req.insurer_org_id and broker_org_id = v_req.broker_org_id and category_id = v_req.category_id
      returning id into v_appt;
    end if;
    update public.appointment_requests set status = 'revoked', decided_by = v_uid, decided_at = now(), decision_note = left(p_note, 1000) where id = v_req.id;
  end if;

  select coalesce((select o.name from public.organizations o where o.id = v_req.insurer_org_id), v_req.proposed_insurer_name) into v_insurer_name;
  select c.name into v_cat from public.product_categories c where c.id = v_req.category_id;
  v_title := case p_decision
    when 'approve' then v_insurer_name || ' approved your appointment for ' || coalesce(v_cat, 'a product line')
    when 'decline' then v_insurer_name || ' declined your appointment request for ' || coalesce(v_cat, 'a product line')
    else v_insurer_name || ' revoked your appointment for ' || coalesce(v_cat, 'a product line') end;
  perform private.notify_users(
    private.org_admin_user_ids(v_req.broker_org_id),
    'appointment.decided', v_title,
    case when p_decision = 'approve' then 'You are now eligible to receive orders for this insurer and line.'
         when p_decision = 'revoke' then 'You are no longer eligible for new orders for this insurer and line, effective immediately.'
         else coalesce(nullif(p_note, ''), 'Contact the insurer if you believe this is a mistake.') end,
    '/partner/appointments',
    jsonb_build_object('request_id', v_req.id, 'decision', p_decision, 'insurer_org_id', v_req.insurer_org_id, 'category_id', v_req.category_id));

  return query select r.id, r.status, r.broker_org_id, r.insurer_org_id, r.category_id, v_appt
    from public.appointment_requests r where r.id = v_req.id;
end $$;
revoke execute on function public.decide_appointment_request(uuid, text, text) from public, anon;
grant execute on function public.decide_appointment_request(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. RPCs: application review (staff only)
-- ---------------------------------------------------------------------------
create or replace function public.approve_partner_application(p_id uuid, p_note text default null)
returns table (application_id uuid, org_id uuid, slug text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_app public.partner_applications;
  v_org_id uuid;
  v_slug text;
  v_share numeric := 20;
  v_fee numeric := 0;
  v_plan uuid;
  v_plan_code text;
  v_item jsonb;
  v_cat uuid;
  v_check jsonb;
  v_now timestamptz := now();
begin
  if not (private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only Covva staff can approve applications' using errcode = 'P0001';
  end if;
  select * into v_app from public.partner_applications a where a.id = p_id for update;
  if v_app.id is null then
    raise exception 'Application not found' using errcode = 'P0001';
  end if;
  if v_app.status not in ('submitted', 'in_review') then
    raise exception 'Only a submitted application can be approved (this one is %)', v_app.status using errcode = 'P0001';
  end if;
  if v_app.agreement ->> 'signed_at' is null then
    raise exception 'The partner agreement has not been signed' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(v_app.nic_licence_number, '')), '') is null then
    raise exception 'Record the NIC licence number before approving' using errcode = 'P0001';
  end if;

  v_slug := private.unique_org_slug(v_app.company_name);
  v_check := jsonb_build_object('done', true, 'at', v_now, 'by', v_uid);
  insert into public.organizations (type, status, name, slug, legal_name, registration_number, nic_licence_number, nic_licence_class, nic_licence_expires_on,
    licence_verified_at, licence_verified_by, licence_status, website, contact_email, contact_phone, address, region, settings, onboarding_checklist)
  values (v_app.type, 'active', v_app.company_name, v_slug, v_app.legal_name, v_app.registration_number, v_app.nic_licence_number, v_app.nic_licence_class, v_app.nic_licence_expires_on,
    v_now, v_uid, case when v_app.nic_licence_expires_on is not null and v_app.nic_licence_expires_on < current_date then 'lapsed'
                       when v_app.nic_licence_expires_on is not null and v_app.nic_licence_expires_on <= current_date + 30 then 'expiring' else 'verified' end,
    v_app.website, nullif(v_app.primary_contact ->> 'email', '')::extensions.citext, nullif(v_app.primary_contact ->> 'phone', ''), v_app.address, v_app.region,
    jsonb_build_object(
      'application_id', v_app.id,
      'settlement_account', v_app.settlement_account,
      'primary_contact', v_app.primary_contact,
      'compliance_contact', v_app.compliance_contact,
      'principal_officer', v_app.principal_officer,
      'commercial_model', v_app.commercial_model,
      'agreement', v_app.agreement,
      'onboarding_documents', v_app.documents),
    jsonb_build_object('documents', v_check, 'verification', v_check, 'agreement', v_check,
      'products', jsonb_build_object('done', false), 'test_quote', jsonb_build_object('done', false), 'go_live', jsonb_build_object('done', false)))
  returning id into v_org_id;

  insert into public.memberships (org_id, user_id, role, title, active)
  values (v_org_id, v_app.applicant_user_id, 'owner', nullif(v_app.primary_contact ->> 'title', ''), true)
  on conflict (org_id, user_id) do update set role = 'owner', active = true;

  -- Commercial terms (Addendum 2 F): brokers choose revenue share or subscription; insurers are on the insurer fee.
  select coalesce((ps.value #>> '{}')::numeric, 20) into v_share from public.platform_settings ps where ps.key = 'commercial.default_revenue_share_pct';
  select coalesce((ps.value #>> '{}')::numeric, 0) into v_fee from public.platform_settings ps where ps.key = 'commercial.default_platform_fee_pct';
  if v_app.type = 'broker' then
    if coalesce(v_app.commercial_model, 'revenue_share') = 'subscription' then
      select ps.value #>> '{}' into v_plan_code from public.platform_settings ps where ps.key = 'commercial.default_broker_plan_code';
      select p.id into v_plan from public.plans p where p.audience = 'broker' and p.active and (v_plan_code is null or p.code = v_plan_code) order by (p.code = v_plan_code) desc, p.sort_order limit 1;
      if v_plan is null then
        raise exception 'No active broker subscription plan is configured' using errcode = 'P0001';
      end if;
      insert into public.org_commercial_terms (org_id, model, subscription_plan_id, approved_by, approved_at, created_by, notes)
      values (v_org_id, 'subscription', v_plan, v_uid, v_now, v_uid, 'Chosen at registration');
    else
      insert into public.org_commercial_terms (org_id, model, revenue_share_pct, approved_by, approved_at, created_by, notes)
      values (v_org_id, 'revenue_share', coalesce(v_share, 20), v_uid, v_now, v_uid, 'Chosen at registration; platform default share');
    end if;
  else
    insert into public.org_commercial_terms (org_id, model, platform_fee_pct, approved_by, approved_at, created_by, notes)
    values (v_org_id, 'insurer_fee', coalesce(v_fee, 0), v_uid, v_now, v_uid, 'Platform default at registration');
    -- Integration level per product line (Addendum 2 A).
    for v_item in select * from jsonb_array_elements(case when jsonb_typeof(v_app.integration_levels) = 'array' then v_app.integration_levels else '[]'::jsonb end) loop
      select c.id into v_cat from public.product_categories c where c.slug = v_item ->> 'category_slug';
      if v_cat is null or coalesce(v_item ->> 'level', '') not in ('L1', 'L2', 'L3') then continue; end if;
      insert into public.insurer_line_integrations (insurer_org_id, category_id, level)
      values (v_org_id, v_cat, v_item ->> 'level')
      on conflict (insurer_org_id, category_id) do nothing;
    end loop;
  end if;

  update public.partner_applications
     set status = 'approved', created_org_id = v_org_id, reviewed_by = v_uid, reviewed_at = v_now, review_notes = coalesce(left(p_note, 4000), review_notes)
   where id = v_app.id;

  perform private.notify_users(array[v_app.applicant_user_id], 'partner.application.approved',
    'Welcome to Covva — ' || v_app.company_name || ' is live',
    'Your ' || v_app.type::text || ' registration has been verified and approved. Sign in to open your partner workspace, invite your team and finish the onboarding checklist.',
    '/partner', jsonb_build_object('application_id', v_app.id, 'org_id', v_org_id));

  return query select v_app.id, v_org_id, v_slug;
end $$;
revoke execute on function public.approve_partner_application(uuid, text) from public, anon;
grant execute on function public.approve_partner_application(uuid, text) to authenticated, service_role;

create or replace function public.return_partner_application(p_id uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_app public.partner_applications;
begin
  if not (private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only Covva staff can return applications' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Tell the applicant what needs to change' using errcode = 'P0001';
  end if;
  select * into v_app from public.partner_applications a where a.id = p_id for update;
  if v_app.id is null then raise exception 'Application not found' using errcode = 'P0001'; end if;
  if v_app.status not in ('submitted', 'in_review') then
    raise exception 'Only a submitted application can be returned (this one is %)', v_app.status using errcode = 'P0001';
  end if;
  update public.partner_applications
     set status = 'needs_changes', reviewed_by = v_uid, reviewed_at = now(), review_notes = left(p_note, 4000)
   where id = v_app.id;
  perform private.notify_users(array[v_app.applicant_user_id], 'partner.application.needs_changes',
    'Your Covva partner application needs changes',
    left(p_note, 2000), '/partner/register/status', jsonb_build_object('application_id', v_app.id));
  return v_app.id;
end $$;
revoke execute on function public.return_partner_application(uuid, text) from public, anon;
grant execute on function public.return_partner_application(uuid, text) to authenticated, service_role;

create or replace function public.reject_partner_application(p_id uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_app public.partner_applications;
begin
  if not (private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only Covva staff can reject applications' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'A reason is required to reject an application' using errcode = 'P0001';
  end if;
  select * into v_app from public.partner_applications a where a.id = p_id for update;
  if v_app.id is null then raise exception 'Application not found' using errcode = 'P0001'; end if;
  if v_app.status not in ('submitted', 'in_review', 'needs_changes') then
    raise exception 'This application is % and cannot be rejected', v_app.status using errcode = 'P0001';
  end if;
  update public.partner_applications
     set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_notes = left(p_note, 4000)
   where id = v_app.id;
  perform private.notify_users(array[v_app.applicant_user_id], 'partner.application.rejected',
    'Your Covva partner application was not approved',
    left(p_note, 2000), '/partner/register/status', jsonb_build_object('application_id', v_app.id));
  return v_app.id;
end $$;
revoke execute on function public.reject_partner_application(uuid, text) from public, anon;
grant execute on function public.reject_partner_application(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Licence status refresh (daily cron)
-- ---------------------------------------------------------------------------
create or replace function private.refresh_licence_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lapsed int := 0; v_expiring int := 0; v_verified int := 0;
  r record;
  v_staff uuid[] := private.platform_staff_user_ids();
begin
  -- Lapsed: expiry passed → licence lapsed, organisation suspended (active ones only).
  for r in
    select o.id, o.name, o.nic_licence_expires_on from public.organizations o
    where o.type in ('broker', 'insurer') and o.status = 'active'
      and o.nic_licence_expires_on is not null and o.nic_licence_expires_on < current_date
  loop
    update public.organizations
       set licence_status = 'lapsed', status = 'suspended', suspended_reason = 'licence_lapsed',
           settings = settings || jsonb_build_object('status_reason', 'NIC licence expired on ' || r.nic_licence_expires_on::text || ' (auto-suspended)')
     where id = r.id;
    v_lapsed := v_lapsed + 1;
    perform private.notify_users(private.org_admin_user_ids(r.id), 'licence.lapsed',
      'Your NIC licence has lapsed — ' || r.name || ' is suspended',
      'The licence on record expired on ' || r.nic_licence_expires_on::text || '. New orders stop until Covva verifies a renewed licence. Upload the renewed licence in Team settings → NIC licence.',
      '/partner/settings?tab=licence', jsonb_build_object('org_id', r.id, 'expires_on', r.nic_licence_expires_on));
    perform private.notify_users(v_staff, 'licence.lapsed',
      'Auto-suspended: ' || r.name || ' (licence expired ' || r.nic_licence_expires_on::text || ')',
      'The organisation was suspended by the licence-status job. Reactivate once a renewed licence is verified.',
      '/organisations/' || r.id::text, jsonb_build_object('org_id', r.id), '{in_app}');
  end loop;

  -- Expiring: within 30 days, flagged once.
  for r in
    select o.id, o.name, o.nic_licence_expires_on from public.organizations o
    where o.type in ('broker', 'insurer') and o.status = 'active' and o.licence_status <> 'expiring'
      and o.nic_licence_expires_on is not null and o.nic_licence_expires_on >= current_date and o.nic_licence_expires_on <= current_date + 30
  loop
    update public.organizations set licence_status = 'expiring' where id = r.id;
    v_expiring := v_expiring + 1;
    perform private.notify_users(private.org_admin_user_ids(r.id), 'licence.expiring',
      'NIC licence expires on ' || r.nic_licence_expires_on::text,
      'Renew your licence and upload the new certificate before it expires; organisations with a lapsed licence are suspended automatically.',
      '/partner/settings?tab=licence', jsonb_build_object('org_id', r.id, 'expires_on', r.nic_licence_expires_on));
    perform private.notify_users(v_staff, 'licence.expiring',
      r.name || ': NIC licence expires on ' || r.nic_licence_expires_on::text, null,
      '/organisations/' || r.id::text, jsonb_build_object('org_id', r.id), '{in_app}');
  end loop;

  -- Verified again: a renewed licence (new expiry beyond 30 days, verified by staff) clears expiring/lapsed.
  update public.organizations o
     set licence_status = 'verified'
   where o.type in ('broker', 'insurer') and o.licence_verified_at is not null and o.licence_status in ('expiring', 'lapsed')
     and o.nic_licence_expires_on is not null and o.nic_licence_expires_on > current_date + 30;
  get diagnostics v_verified = row_count;

  return jsonb_build_object('lapsed', v_lapsed, 'expiring', v_expiring, 'verified', v_verified);
end $$;

create or replace function public.refresh_licence_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only the platform can refresh licence status' using errcode = 'P0001';
  end if;
  return private.refresh_licence_status();
end $$;
revoke execute on function public.refresh_licence_status() from public, anon;
grant execute on function public.refresh_licence_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Seeds: feature flags + commercial defaults
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, enabled, description) values
  ('partner_self_service_insurer', true, 'Open self-service insurer registration (/partner/register?type=insurer). Off → notice page (Addendum 3 E).'),
  ('partner_self_service_broker', true, 'Open self-service broker registration (/partner/register?type=broker). Off → notice page (Addendum 3 E).')
on conflict (key) do nothing;

insert into public.platform_settings (key, value, description) values
  ('commercial.default_revenue_share_pct', '20', 'Default Covva share (%) of broker commission on Covva-sourced business for brokers approved on the revenue-share model'),
  ('commercial.default_platform_fee_pct', '0', 'Default insurer-side platform fee (% of net premium) written when an insurer is approved; agree per insurer afterwards'),
  ('commercial.default_broker_plan_code', '"broker_pilot"', 'Plan code assigned to brokers approved on the subscription model'),
  ('onboarding.licence_expiry_warning_days', '30', 'Days before NIC licence expiry at which partners are flagged as expiring')
on conflict (key) do nothing;

grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;
