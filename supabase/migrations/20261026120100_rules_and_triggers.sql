-- =============================================================================
-- Business rules enforced in the database (spec invariants)
-- =============================================================================

-- updated_at triggers -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','memberships','product_categories','products','broker_routing_rules',
    'requests','insurer_submissions','quotes','applications','payments','policies','claims','complaints',
    'subscriptions','connector_configs','ai_threads'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

-- New auth user -> profile --------------------------------------------------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, phone, full_name, account_type, business_name)
  values (
    new.id,
    new.email,
    coalesce(new.phone, new.raw_user_meta_data ->> 'phone'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce((new.raw_user_meta_data ->> 'account_type')::public.account_type, 'individual'),
    new.raw_user_meta_data ->> 'business_name'
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Who is acting? -------------------------------------------------------------
create or replace function private.actor_party_for_org(p_broker uuid, p_insurer uuid) returns public.party
language sql stable security definer set search_path = '' as $$
  select case
    when private.is_service_role() then 'system'::public.party
    when private.is_platform_staff() then 'platform'::public.party
    when p_insurer is not null and private.is_org_member(p_insurer) then 'insurer'::public.party
    when p_broker is not null and private.is_org_member(p_broker) then 'broker'::public.party
    else 'customer'::public.party
  end;
$$;

-- Requests: status timeline, SLA, broker-change consent ---------------------
create or replace function private.requests_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_sla int;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'submitted' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    if new.status in ('submitted', 'adviser_action', 'insurer_response') and new.due_at is null then
      select default_sla_hours into v_sla from public.product_categories where id = new.category_id;
      new.due_at := now() + make_interval(hours => coalesce(v_sla, 24));
    end if;
    if new.status in ('completed', 'cancelled', 'closed_no_cover') then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  end if;

  -- Spec: one broker of record; do not switch broker without notice and consent.
  if tg_op = 'UPDATE' and old.broker_org_id is not null and new.broker_org_id is distinct from old.broker_org_id then
    if not exists (
      select 1 from public.broker_disclosures d
      where d.request_id = new.id and d.broker_org_id = new.broker_org_id and d.stage = 'broker_change'
    ) then
      raise exception 'Broker of record cannot change without a recorded broker_change disclosure to the customer'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger requests_before before insert or update on public.requests
  for each row execute function private.requests_before();

create or replace function private.requests_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.request_events (request_id, actor_id, actor_party, event, to_status)
    values (new.id, (select auth.uid()), private.actor_party_for_org(new.broker_org_id, null), 'created', new.status);
  elsif new.status is distinct from old.status then
    insert into public.request_events (request_id, actor_id, actor_party, event, from_status, to_status)
    values (new.id, (select auth.uid()), private.actor_party_for_org(new.broker_org_id, null), 'status_changed', old.status, new.status);
  end if;
  if tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to then
    insert into public.request_events (request_id, actor_id, actor_party, event, note, visible_to_customer, data)
    values (new.id, (select auth.uid()), private.actor_party_for_org(new.broker_org_id, null), 'assigned', null, false,
            jsonb_build_object('assigned_to', new.assigned_to));
  end if;
  if tg_op = 'UPDATE' and new.broker_org_id is distinct from old.broker_org_id and new.broker_org_id is not null then
    insert into public.request_events (request_id, actor_id, actor_party, event, data)
    values (new.id, (select auth.uid()), 'platform', 'broker_assigned', jsonb_build_object('broker_org_id', new.broker_org_id));
  end if;
  return null;
end $$;
create trigger requests_after after insert or update on public.requests
  for each row execute function private.requests_after();

-- Payments always settle to an insurer --------------------------------------
create or replace function private.payments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations where id = new.payee_org_id and type = 'insurer') then
    raise exception 'Premium payments must settle directly to a licensed insurer (payee_org_id must be an insurer)'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payments_guard before insert or update of payee_org_id on public.payments
  for each row execute function private.payments_guard();

-- Quotes: binding flag follows status; expiry --------------------------------
create or replace function private.quotes_before() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'ready_to_accept' then
    new.is_binding := true;
    if new.valid_until is null then
      new.valid_until := now() + interval '14 days';
    end if;
  elsif new.status in ('estimate', 'awaiting_underwriting') then
    new.is_binding := false;
  end if;
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    new.accepted_at := now();
  end if;
  return new;
end $$;
create trigger quotes_before before insert or update on public.quotes
  for each row execute function private.quotes_before();

-- Applications: broker disclosed before application; quote must be live ------
create or replace function private.applications_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_req public.requests; v_quote public.quotes;
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    select * into v_req from public.requests where id = new.request_id;
    select * into v_quote from public.quotes where id = new.quote_id;
    if v_req.broker_org_id is null then
      raise exception 'A broker of record must be assigned before an application is submitted' using errcode = 'P0001';
    end if;
    if not exists (
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
create trigger applications_guard before insert or update on public.applications
  for each row execute function private.applications_guard();

-- Policies: only insurer issuance makes cover active --------------------------
create or replace function private.policies_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_is_insurer boolean := private.is_org_member(new.insurer_org_id);
  v_is_broker boolean := private.is_org_member(new.broker_org_id);
  v_privileged boolean := private.is_service_role() or private.is_platform_staff();
begin
  -- Customers may only add their own externally-bought policies, or edit nickname.
  if not (v_is_insurer or v_is_broker or v_privileged) then
    if tg_op = 'INSERT' then
      if not new.external_source or new.customer_id <> (select auth.uid()) then
        raise exception 'Customers can only add policies bought elsewhere' using errcode = 'P0001';
      end if;
    else
      if (to_jsonb(new) - 'nickname' - 'updated_at') is distinct from (to_jsonb(old) - 'nickname' - 'updated_at') then
        raise exception 'Customers can only rename their policies' using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;

  if new.status = 'active' and not new.external_source and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if not (v_is_insurer or private.is_service_role()) then
      raise exception 'Only the issuing insurer can mark cover active. Payment confirmation alone never activates a policy.'
        using errcode = 'P0001';
    end if;
    if new.policy_number is null then
      raise exception 'An insurer-issued policy number is required before cover is active' using errcode = 'P0001';
    end if;
    new.issued_at := coalesce(new.issued_at, now());
    new.issued_by := coalesce(new.issued_by, (select auth.uid()));
  end if;
  return new;
end $$;
create trigger policies_guard before insert or update on public.policies
  for each row execute function private.policies_guard();

-- Claims: reporting != approval; only insurer decides --------------------------
create or replace function private.claims_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_insurer boolean := private.is_org_member(new.insurer_org_id) or private.is_service_role();
  v_broker boolean := private.is_org_member(new.broker_org_id);
  v_staff boolean := private.is_platform_staff();
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if new.status in ('approved', 'partially_approved', 'rejected', 'paid') and not v_insurer then
    raise exception 'Only the insurer can record a claim decision or payment' using errcode = 'P0001';
  end if;
  if new.status in ('acknowledged', 'under_assessment', 'info_requested') and not (v_insurer or v_broker or v_staff) then
    raise exception 'Claim assessment statuses are set by the insurer or broker' using errcode = 'P0001';
  end if;
  if new.status = 'delivered_to_insurer' and not (v_insurer or v_broker or v_staff) then
    raise exception 'Delivery to insurer is confirmed by the broker, insurer or platform' using errcode = 'P0001';
  end if;
  if not (v_insurer or v_broker or v_staff) and new.status not in ('draft', 'reported', 'withdrawn') then
    raise exception 'Customers can only draft, report or withdraw claims' using errcode = 'P0001';
  end if;
  case new.status
    when 'reported' then new.reported_at := coalesce(new.reported_at, now());
    when 'delivered_to_insurer' then new.delivered_to_insurer_at := coalesce(new.delivered_to_insurer_at, now());
    when 'acknowledged' then new.acknowledged_at := coalesce(new.acknowledged_at, now());
    when 'approved', 'partially_approved', 'rejected' then
      new.decision_at := coalesce(new.decision_at, now());
      new.decision_by := coalesce(new.decision_by, (select auth.uid()));
    when 'paid' then new.paid_at := coalesce(new.paid_at, now());
    else null;
  end case;
  return new;
end $$;
create trigger claims_guard before insert or update on public.claims
  for each row execute function private.claims_guard();

create or replace function private.claims_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.claim_events (claim_id, actor_id, actor_party, from_status, to_status)
    values (new.id, (select auth.uid()), private.actor_party_for_org(new.broker_org_id, new.insurer_org_id),
            case when tg_op = 'UPDATE' then old.status end, new.status);
  end if;
  return null;
end $$;
create trigger claims_after after insert or update on public.claims
  for each row execute function private.claims_after();

-- Complaints timeline --------------------------------------------------------
create or replace function private.complaints_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.complaint_events (complaint_id, actor_id, actor_party, from_status, to_status)
    values (new.id, (select auth.uid()), private.actor_party_for_org(new.owner_org_id, null),
            case when tg_op = 'UPDATE' then old.status end, new.status);
  end if;
  return null;
end $$;
create trigger complaints_after after insert or update on public.complaints
  for each row execute function private.complaints_after();

-- Audit triggers on regulated records ----------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','memberships','product_categories','products','product_versions','insurer_broker_appointments',
    'broker_routing_rules','requests','broker_disclosures','insurer_submissions','quotes','applications','payments',
    'policies','claims','complaints','consents','kyc_verifications','api_keys','subscriptions','feature_flags','platform_settings'
  ] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
  end loop;
end $$;
