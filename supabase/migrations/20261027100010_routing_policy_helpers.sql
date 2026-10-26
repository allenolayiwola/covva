-- =============================================================================
-- Routing engine: break the RLS cycle requests ⇄ order_routing / order_offers.
-- The "offered brokers and direct insurers read" policy on requests looked at
-- order_offers / order_routing, whose own policies look back at requests, which
-- Postgres reports as "infinite recursion detected in policy". SECURITY DEFINER
-- helpers read those tables without RLS, so the chain stops here. Additive only.
-- =============================================================================

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

/** Broker of record for a request (RLS-free read used by the order_routing policy). */
create or replace function private.request_broker_org(p_request uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.broker_org_id from public.requests r where r.id = p_request;
$$;

grant execute on function private.has_open_offer(uuid), private.is_direct_insurer(uuid), private.request_broker_org(uuid) to authenticated, service_role;

alter policy "requests: offered brokers and direct insurers read" on public.requests
  using (private.has_open_offer(id) or private.is_direct_insurer(id));

alter policy "order routing: parties read" on public.order_routing
  using (
    (select private.is_platform_staff())
    or broker_org_id in (select private.user_org_ids())
    or (mode = 'insurer_direct' and insurer_org_id in (select private.user_org_ids()))
    or private.request_broker_org(request_id) in (select private.user_org_ids())
    or private.has_open_offer(request_id)
  );
