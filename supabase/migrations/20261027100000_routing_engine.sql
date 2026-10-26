-- =============================================================================
-- Routing engine (Addendum 2 D/E): insurer line integrations, routing decisions
-- per request, claimable broker offers with timeout + re-route, broker-sourced
-- customer assignments. Additive only (no drops, no deletes).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Insurer integration level per product line
-- ---------------------------------------------------------------------------
create table if not exists public.insurer_line_integrations (
  id uuid primary key default gen_random_uuid(),
  insurer_org_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid not null references public.product_categories (id) on delete cascade,
  level text not null default 'L1' check (level in ('L1', 'L2', 'L3')),
  direct_sales boolean not null default false,
  sla_hours int not null default 24 check (sla_hours > 0),
  issuance_type text not null default 'manual' check (issuance_type in ('instant', 'within_hours', 'manual')),
  nominated_broker_org_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (insurer_org_id, category_id)
);
comment on table public.insurer_line_integrations is
  'Integration level of an insurer per product line (Addendum 2 A/D). L2/L3, or L1 with direct_sales, route orders straight to the insurer; nominated brokers restrict the broker pool.';
create index if not exists insurer_line_integrations_category_idx on public.insurer_line_integrations (category_id) where active;

-- ---------------------------------------------------------------------------
-- 2. Routing decision per request
-- ---------------------------------------------------------------------------
create table if not exists public.order_routing (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.requests (id) on delete cascade,
  mode text not null check (mode in ('insurer_direct', 'broker_pool', 'broker_fixed', 'ops_hold')),
  insurer_org_id uuid references public.organizations (id),
  broker_org_id uuid references public.organizations (id),
  rule text,
  reason text not null default '',
  candidates jsonb not null default '[]'::jsonb,
  complexity_flags text[] not null default '{}',
  offer_timeout_minutes int not null default 30 check (offer_timeout_minutes > 0),
  offer_batch_size int not null default 3 check (offer_batch_size > 0),
  max_rounds int not null default 3 check (max_rounds > 0),
  current_round int not null default 0,
  expires_at timestamptz,
  decided_at timestamptz not null default now(),
  decided_by text not null default 'engine' check (decided_by in ('engine', 'ops')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.order_routing is
  'Routing decision for a request: who fulfils it (insurer directly, a fixed broker, a pool of offered brokers, or held for ops) with the considered candidates and reason. Every change is audited.';
create index if not exists order_routing_mode_idx on public.order_routing (mode, expires_at);
create index if not exists order_routing_insurer_idx on public.order_routing (insurer_org_id) where insurer_org_id is not null;
create index if not exists order_routing_broker_idx on public.order_routing (broker_org_id) where broker_org_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Claimable offers to brokers (first to accept wins)
-- ---------------------------------------------------------------------------
create table if not exists public.order_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  broker_org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'expired', 'withdrawn')),
  round int not null default 1,
  offered_at timestamptz not null default now(),
  responds_by timestamptz not null,
  responded_at timestamptz,
  responded_by uuid references auth.users (id),
  accept_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.order_offers is
  'An offer of a request to one broker. Only one offer per request can ever be accepted (partial unique index); accepting sets requests.broker_org_id and withdraws the other open offers.';
-- Invariant: one accepted offer per request.
create unique index if not exists order_offers_one_accepted_per_request on public.order_offers (request_id) where status = 'accepted';
-- One open offer per broker per request (a re-route never double-offers).
create unique index if not exists order_offers_one_open_per_broker on public.order_offers (request_id, broker_org_id) where status = 'offered';
create index if not exists order_offers_broker_idx on public.order_offers (broker_org_id, status, responds_by);
create index if not exists order_offers_due_idx on public.order_offers (responds_by) where status = 'offered';
create index if not exists order_offers_request_idx on public.order_offers (request_id, round);

-- ---------------------------------------------------------------------------
-- 4. Broker-sourced customers stay with their broker
-- ---------------------------------------------------------------------------
create table if not exists public.customer_broker_assignments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users (id) on delete cascade,
  broker_org_id uuid not null references public.organizations (id) on delete cascade,
  source text not null default 'platform' check (source in ('broker_import', 'customer_choice', 'platform')),
  active boolean not null default true,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
comment on table public.customer_broker_assignments is
  'Standing broker relationship for a customer (Addendum 2 D5): clients a broker brings onto the platform stay with that broker for new requests, renewals and servicing.';
create unique index if not exists customer_broker_assignments_one_active on public.customer_broker_assignments (customer_id) where active;
create index if not exists customer_broker_assignments_broker_idx on public.customer_broker_assignments (broker_org_id) where active;

-- ---------------------------------------------------------------------------
-- 5. Request columns
-- ---------------------------------------------------------------------------
alter table public.requests add column if not exists routing_mode text
  check (routing_mode is null or routing_mode in ('insurer_direct', 'broker_pool', 'broker_fixed', 'ops_hold'));
alter table public.requests add column if not exists talk_to_expert boolean not null default false;
alter table public.requests add column if not exists complexity_flags text[] not null default '{}';
comment on column public.requests.routing_mode is 'Current routing mode (mirrors order_routing.mode for cheap reads).';
comment on column public.requests.talk_to_expert is 'Customer asked for advice: always routed to a broker regardless of insurer integration.';
comment on column public.requests.complexity_flags is 'Complexity thresholds hit at routing time (fleet, commercial_property, marine, group_scheme, high_sum_insured).';

-- Customers may set talk_to_expert on their own request (customer column guard).
create or replace function private.requests_customer_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_allowed text[] := array['status', 'risk_data', 'risk_fingerprint', 'title', 'cancelled_reason', 'next_step',
                            'updated_at', 'submitted_at', 'due_at', 'completed_at', 'talk_to_expert'];
begin
  if private.is_service_role() or private.is_platform_staff() or private.is_org_member(old.broker_org_id) then
    return new;
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'You can only change the details of your own request' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
    or (old.status = 'awaiting_customer_info' and new.status in ('adviser_action', 'cancelled'))
    or (old.status = 'quotes_ready' and new.status in ('adviser_action', 'cancelled'))
  ) then
    raise exception 'That status change is not allowed (% to %)', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Housekeeping triggers: updated_at + audit (same mechanism as core tables)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['insurer_line_integrations', 'order_routing', 'order_offers'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
  end loop;
  foreach t in array array['insurer_line_integrations', 'order_routing', 'order_offers', 'customer_broker_assignments'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

-- Insurer owners/admins may only change direct_sales and nominated brokers on their own
-- line integrations; the level, SLA and issuance type are set by platform staff.
create or replace function private.line_integrations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_allowed text[] := array['direct_sales', 'nominated_broker_org_ids', 'updated_at'];
  v_id uuid;
begin
  if private.is_service_role() or private.is_platform_staff() then
    return new;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'Insurers can only change direct sales and nominated brokers; the integration level is set by the platform' using errcode = 'P0001';
  end if;
  foreach v_id in array new.nominated_broker_org_ids loop
    if not exists (select 1 from public.organizations o where o.id = v_id and o.type = 'broker' and o.status = 'active') then
      raise exception 'Nominated brokers must be active broker organisations' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'line_integrations_guard' and tgrelid = 'public.insurer_line_integrations'::regclass) then
    create trigger line_integrations_guard before insert or update on public.insurer_line_integrations
      for each row execute function private.line_integrations_guard();
  end if;
end $$;

-- Offers are only ever written through the RPCs below or by trusted server code.
create or replace function private.order_offers_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_service_role() or private.is_platform_staff() then
    return new;
  end if;
  raise exception 'Offers are accepted or declined through accept_order_offer / decline_order_offer' using errcode = 'P0001';
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'order_offers_guard' and tgrelid = 'public.order_offers'::regclass) then
    create trigger order_offers_guard before insert or update or delete on public.order_offers
      for each row execute function private.order_offers_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.insurer_line_integrations enable row level security;
alter table public.order_routing enable row level security;
alter table public.order_offers enable row level security;
alter table public.customer_broker_assignments enable row level security;

-- Policies are created only when missing (no drops), using a small helper.
create or replace function private.ensure_policy(p_table text, p_name text, p_sql text) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;

-- Line integrations: the insurer, brokers appointed to (or nominated by) it, and staff read;
-- staff write everything; insurer owners/admins update (column guard above).
select private.ensure_policy('insurer_line_integrations', 'line integrations: parties read', $p$
  create policy "line integrations: parties read" on public.insurer_line_integrations for select to authenticated
  using (
    insurer_org_id in (select private.user_org_ids())
    or (select private.is_platform_staff())
    or exists (select 1 from public.insurer_broker_appointments a
               where a.insurer_org_id = insurer_line_integrations.insurer_org_id and a.active
                 and a.broker_org_id in (select private.user_org_ids()))
    or nominated_broker_org_ids && array(select private.user_org_ids())
  )$p$);
select private.ensure_policy('insurer_line_integrations', 'line integrations: staff write', $p$
  create policy "line integrations: staff write" on public.insurer_line_integrations for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);
select private.ensure_policy('insurer_line_integrations', 'line integrations: insurer admins update', $p$
  create policy "line integrations: insurer admins update" on public.insurer_line_integrations for update to authenticated
  using (private.has_org_role(insurer_org_id, '{owner,admin}'))
  with check (private.has_org_role(insurer_org_id, '{owner,admin}'))$p$);

-- Routing decisions: the broker of record / fixed broker / any offered broker, the insurer of a
-- direct order, and staff. Customers read only the mode via request_routing_mode() below.
-- RLS-free helpers so the requests ⇄ order_routing/order_offers policies never recurse
-- (Postgres raises "infinite recursion detected in policy" otherwise).
create or replace function private.has_open_offer(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.order_offers o
    where o.request_id = p_request and o.status = 'offered'
      and o.broker_org_id in (select private.user_org_ids())
  );
$$;
create or replace function private.is_direct_insurer(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.order_routing x
    where x.request_id = p_request and x.mode = 'insurer_direct'
      and x.insurer_org_id in (select private.user_org_ids())
  );
$$;
create or replace function private.request_broker_org(p_request uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.broker_org_id from public.requests r where r.id = p_request;
$$;

select private.ensure_policy('order_routing', 'order routing: parties read', $p$
  create policy "order routing: parties read" on public.order_routing for select to authenticated
  using (
    (select private.is_platform_staff())
    or broker_org_id in (select private.user_org_ids())
    or (mode = 'insurer_direct' and insurer_org_id in (select private.user_org_ids()))
    or private.request_broker_org(request_id) in (select private.user_org_ids())
    or private.has_open_offer(request_id)
  )$p$);
select private.ensure_policy('order_routing', 'order routing: staff write', $p$
  create policy "order routing: staff write" on public.order_routing for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- Offers: brokers see their own organisation's offers; staff see all. Writes go through the RPCs.
select private.ensure_policy('order_offers', 'order offers: broker reads own', $p$
  create policy "order offers: broker reads own" on public.order_offers for select to authenticated
  using (broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('order_offers', 'order offers: staff write', $p$
  create policy "order offers: staff write" on public.order_offers for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- Customer ↔ broker assignments: the customer, the broker and staff read; staff write; broker
-- owners/admins/supervisors record their own imported clients and may end them.
select private.ensure_policy('customer_broker_assignments', 'broker assignments: parties read', $p$
  create policy "broker assignments: parties read" on public.customer_broker_assignments for select to authenticated
  using (customer_id = (select auth.uid()) or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))$p$);
select private.ensure_policy('customer_broker_assignments', 'broker assignments: staff write', $p$
  create policy "broker assignments: staff write" on public.customer_broker_assignments for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);
select private.ensure_policy('customer_broker_assignments', 'broker assignments: broker imports own clients', $p$
  create policy "broker assignments: broker imports own clients" on public.customer_broker_assignments for insert to authenticated
  with check (source = 'broker_import' and private.has_org_role(broker_org_id, '{owner,admin,supervisor}'))$p$);
select private.ensure_policy('customer_broker_assignments', 'broker assignments: broker ends own', $p$
  create policy "broker assignments: broker ends own" on public.customer_broker_assignments for update to authenticated
  using (private.has_org_role(broker_org_id, '{owner,admin,supervisor}'))
  with check (private.has_org_role(broker_org_id, '{owner,admin,supervisor}'))$p$);

-- A broker with an open offer may read the request (risk only; the customer's identity stays
-- hidden because can_view_customer still requires broker of record). The insurer of a direct
-- order reads it too (there is no broker and no submission to go through).
select private.ensure_policy('requests', 'requests: offered brokers and direct insurers read', $p$
  create policy "requests: offered brokers and direct insurers read" on public.requests for select to authenticated
  using (private.has_open_offer(id) or private.is_direct_insurer(id))$p$);

-- ---------------------------------------------------------------------------
-- 8. RPCs
-- ---------------------------------------------------------------------------
-- Customers (and anyone who can access the request) read the routing mode only.
create or replace function public.request_routing_mode(p_request uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select x.mode from public.order_routing x
  where x.request_id = p_request and private.can_access_request(p_request)
  limit 1;
$$;
revoke execute on function public.request_routing_mode(uuid) from public, anon;
grant execute on function public.request_routing_mode(uuid) to authenticated, service_role;

-- Accept an offer: by id as a member of the offered broker (owner/admin/supervisor/adviser),
-- or by one-tap token through the service role (the token is the credential; the server
-- verifies the signed-in member first). First accept wins; other open offers are withdrawn.
create or replace function public.accept_order_offer(p_offer_id uuid default null, p_token text default null)
returns table (offer_id uuid, request_id uuid, broker_org_id uuid, reference text, customer_id uuid, round int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_offer public.order_offers;
  v_req public.requests;
  v_org public.organizations;
  v_privileged boolean := private.is_service_role() or private.is_platform_staff();
begin
  if p_offer_id is null and (p_token is null or length(p_token) < 16) then
    raise exception 'An offer id or accept token is required' using errcode = 'P0001';
  end if;
  if p_token is not null and not v_privileged then
    raise exception 'Accept links are redeemed by the platform on your behalf. Open the link in the app or workspace' using errcode = 'P0001';
  end if;

  select * into v_offer from public.order_offers o
  where (p_offer_id is not null and o.id = p_offer_id) or (p_token is not null and o.accept_token = p_token)
  for update;
  if v_offer.id is null then
    raise exception 'This offer is not valid' using errcode = 'P0001';
  end if;

  if not v_privileged and not exists (
    select 1 from public.memberships m
    where m.user_id = v_uid and m.org_id = v_offer.broker_org_id and m.active
      and m.role in ('owner', 'admin', 'supervisor', 'adviser')
  ) then
    raise exception 'Only an adviser or supervisor of the offered broker can accept this request' using errcode = 'P0001';
  end if;

  if v_offer.status = 'accepted' then
    raise exception 'This offer has already been accepted' using errcode = 'P0001';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer open (%)', v_offer.status using errcode = 'P0001';
  end if;
  if v_offer.responds_by < now() then
    update public.order_offers set status = 'expired', responded_at = now() where id = v_offer.id;
    raise exception 'This offer has expired and the request has been re-routed' using errcode = 'P0001';
  end if;

  select * into v_req from public.requests r where r.id = v_offer.request_id for update;
  if v_req.id is null then
    raise exception 'Request not found' using errcode = 'P0001';
  end if;
  if v_req.status in ('completed', 'cancelled', 'closed_no_cover') then
    raise exception 'This request is closed' using errcode = 'P0001';
  end if;
  if v_req.broker_org_id is not null and v_req.broker_org_id <> v_offer.broker_org_id then
    raise exception 'Another broker has already taken this request' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_offers o where o.request_id = v_req.id and o.status = 'accepted') then
    raise exception 'Another broker has already taken this request' using errcode = 'P0001';
  end if;

  select * into v_org from public.organizations o where o.id = v_offer.broker_org_id;
  if v_org.id is null or v_org.status <> 'active' then
    raise exception 'This broker organisation is not active on the platform' using errcode = 'P0001';
  end if;

  update public.order_offers
     set status = 'accepted', responded_at = now(), responded_by = v_uid
   where id = v_offer.id;
  update public.order_offers
     set status = 'withdrawn', responded_at = now()
   where request_id = v_req.id and id <> v_offer.id and status = 'offered';

  update public.requests
     set broker_org_id = v_offer.broker_org_id,
         routing_mode = 'broker_pool',
         next_step = v_org.name || ' is now your broker of record and is reviewing your request.'
   where id = v_req.id;
  update public.order_routing
     set expires_at = null
   where request_id = v_req.id;

  insert into public.request_events (request_id, actor_id, actor_party, event, note, visible_to_customer, data)
  values (
    v_req.id, v_uid,
    case when private.is_platform_staff() then 'platform'::public.party when v_uid is null then 'system'::public.party else 'broker'::public.party end,
    'offer_accepted',
    v_org.name || ' accepted your request and is now your broker of record.',
    true,
    jsonb_build_object('offer_id', v_offer.id, 'broker_org_id', v_offer.broker_org_id, 'round', v_offer.round, 'via', case when p_token is not null then 'token' else 'workspace' end)
  );

  return query select v_offer.id, v_req.id, v_offer.broker_org_id, v_req.reference, v_req.customer_id, v_offer.round;
end $$;
revoke execute on function public.accept_order_offer(uuid, text) from public, anon;
grant execute on function public.accept_order_offer(uuid, text) to authenticated, service_role;

-- Decline an offer (member of the offered broker, or the service role). Re-routing when a
-- whole round is closed is done by the server (expireAndRerouteOffers / rerouteIfRoundClosed).
create or replace function public.decline_order_offer(p_offer_id uuid, p_reason text default null)
returns table (offer_id uuid, request_id uuid, broker_org_id uuid, round int, open_offers int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_offer public.order_offers;
  v_open int;
begin
  select * into v_offer from public.order_offers o where o.id = p_offer_id for update;
  if v_offer.id is null then
    raise exception 'This offer is not valid' using errcode = 'P0001';
  end if;
  if not (private.is_service_role() or private.is_platform_staff()) and not exists (
    select 1 from public.memberships m
    where m.user_id = v_uid and m.org_id = v_offer.broker_org_id and m.active
      and m.role in ('owner', 'admin', 'supervisor', 'adviser')
  ) then
    raise exception 'Only an adviser or supervisor of the offered broker can decline this request' using errcode = 'P0001';
  end if;
  if v_offer.status <> 'offered' then
    raise exception 'This offer is no longer open (%)', v_offer.status using errcode = 'P0001';
  end if;

  update public.order_offers
     set status = 'declined', responded_at = now(), responded_by = v_uid, decline_reason = left(p_reason, 500)
   where id = v_offer.id;

  insert into public.request_events (request_id, actor_id, actor_party, event, note, visible_to_customer, data)
  values (v_offer.request_id, v_uid,
          case when private.is_platform_staff() then 'platform'::public.party when v_uid is null then 'system'::public.party else 'broker'::public.party end,
          'offer_declined', null, false,
          jsonb_build_object('offer_id', v_offer.id, 'broker_org_id', v_offer.broker_org_id, 'round', v_offer.round, 'reason', left(p_reason, 500)));

  select count(*) into v_open from public.order_offers o where o.request_id = v_offer.request_id and o.status = 'offered';
  return query select v_offer.id, v_offer.request_id, v_offer.broker_org_id, v_offer.round, v_open;
end $$;
revoke execute on function public.decline_order_offer(uuid, text) from public, anon;
grant execute on function public.decline_order_offer(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Settings (defaults the engine reads; staff edit them in Settings)
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, description) values
 ('routing.offer_timeout_minutes', '30', 'Minutes a broker has to accept an offered request before it is re-routed'),
 ('routing.offer_batch_size', '3', 'How many brokers receive an offer at once'),
 ('routing.max_rounds', '3', 'Offer rounds before a request is held for platform operations'),
 ('routing.sum_insured_threshold', '2000000', 'Sum insured (GHS) above which a request is treated as complex and routed to a broker')
on conflict (key) do nothing;

grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;
