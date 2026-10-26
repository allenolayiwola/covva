-- =============================================================================
-- Partner analytics (roadmap Phase 1 "Insurer dashboard" / "Broker web dashboard";
-- Addendum 3 B5; Addendum 4 §2 broker mobile: renewal list, commission summary).
--
-- Aggregations run as SECURITY DEFINER functions in `private` (they join tables
-- whose RLS would otherwise hide the rows needed for a count — e.g. profiles of
-- customers the insurer may not identify) and are exposed through `public.*`
-- wrappers that first check the caller is an active member of the organisation
-- (or platform staff / the service role). Additive only: no drops, no deletes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Membership gate shared by every wrapper. Raises 42501 (insufficient
--    privilege → HTTP 403 through PostgREST) for non-members and unknown orgs
--    alike, so the existence of an organisation id is never leaked.
-- ---------------------------------------------------------------------------
create or replace function private.partner_org_gate(p_org uuid, p_roles public.member_role[] default null)
returns public.org_type
language plpgsql stable security definer set search_path = '' as $$
declare
  v_type public.org_type;
begin
  select o.type into v_type from public.organizations o where o.id = p_org;
  if v_type is null then
    raise exception 'You are not a member of this organisation' using errcode = '42501';
  end if;
  if private.is_service_role() or private.is_platform_staff() then
    return v_type;
  end if;
  if p_roles is null then
    if private.is_org_member(p_org) then return v_type; end if;
  elsif private.has_org_role(p_org, p_roles) then
    return v_type;
  end if;
  raise exception 'You are not a member of this organisation' using errcode = '42501';
end $$;
revoke execute on function private.partner_org_gate(uuid, public.member_role[]) from public, anon, authenticated;

-- "Ama Kumi" → "Ama K." (insurers never see a customer's full identity on analytics).
create or replace function private.mask_person_name(p_name text)
returns text
language sql immutable set search_path = '' as $$
  select case
    when p_name is null or btrim(p_name) = '' then null
    when array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) > 1 then
      (regexp_split_to_array(btrim(p_name), '\s+'))[1] || ' ' ||
      upper(left((regexp_split_to_array(btrim(p_name), '\s+'))[array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1)], 1)) || '.'
    else btrim(p_name)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Sales summary per day: requests, quotes, conversions (applications
--    accepted), policies issued, premium, platform fee, broker commission.
-- ---------------------------------------------------------------------------
create or replace function private.partner_sales_summary(p_org_id uuid, p_from date, p_to date)
returns table (
  day date,
  requests int,
  quotes int,
  conversions int,
  policies_issued int,
  premium numeric,
  platform_fee numeric,
  broker_commission numeric
)
language sql stable security definer set search_path = '' as $$
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') as d
  ),
  req as (
    select (coalesce(r.submitted_at, r.created_at))::date as day, count(*)::int as n
    from public.requests r
    where r.status <> 'draft'
      and coalesce(r.submitted_at, r.created_at) >= p_from::timestamptz
      and coalesce(r.submitted_at, r.created_at) < (p_to + 1)::timestamptz
      and (r.broker_org_id = p_org_id
           or exists (select 1 from public.insurer_submissions s where s.request_id = r.id and s.insurer_org_id = p_org_id))
    group by 1
  ),
  quo as (
    select q.created_at::date as day, count(*)::int as n
    from public.quotes q
    where q.created_at >= p_from::timestamptz and q.created_at < (p_to + 1)::timestamptz
      and (q.broker_org_id = p_org_id or q.insurer_org_id = p_org_id)
    group by 1
  ),
  conv as (
    select coalesce(a.decided_at, a.updated_at)::date as day, count(*)::int as n
    from public.applications a
    join public.quotes q on q.id = a.quote_id
    where a.status = 'accepted'
      and coalesce(a.decided_at, a.updated_at) >= p_from::timestamptz
      and coalesce(a.decided_at, a.updated_at) < (p_to + 1)::timestamptz
      and (q.broker_org_id = p_org_id or q.insurer_org_id = p_org_id)
    group by 1
  ),
  pol as (
    select p.issued_at::date as day, count(*)::int as n, sum(coalesce(p.premium, 0)) as premium
    from public.policies p
    where p.issued_at is not null
      and p.issued_at >= p_from::timestamptz and p.issued_at < (p_to + 1)::timestamptz
      and (p.broker_org_id = p_org_id or p.insurer_org_id = p_org_id)
    group by 1
  ),
  led as (
    select l.created_at::date as day,
           sum(case when l.entry_type = 'platform_fee' then abs(l.amount) else 0 end) as platform_fee,
           sum(case when l.entry_type = 'broker_commission' then abs(l.amount) else 0 end) as broker_commission
    from public.ledger_entries l
    where l.created_at >= p_from::timestamptz and l.created_at < (p_to + 1)::timestamptz
      and l.entry_type in ('platform_fee', 'broker_commission')
      and (l.org_id = p_org_id or l.counterparty_org_id = p_org_id)
    group by 1
  )
  select d.day,
         coalesce(req.n, 0),
         coalesce(quo.n, 0),
         coalesce(conv.n, 0),
         coalesce(pol.n, 0),
         coalesce(pol.premium, 0),
         coalesce(led.platform_fee, 0),
         coalesce(led.broker_commission, 0)
  from days d
  left join req on req.day = d.day
  left join quo on quo.day = d.day
  left join conv on conv.day = d.day
  left join pol on pol.day = d.day
  left join led on led.day = d.day
  order by d.day;
$$;
revoke execute on function private.partner_sales_summary(uuid, date, date) from public, anon, authenticated;

create or replace function public.partner_sales_summary(p_org_id uuid, p_from date default (current_date - 29), p_to date default current_date)
returns table (
  day date,
  requests int,
  quotes int,
  conversions int,
  policies_issued int,
  premium numeric,
  platform_fee numeric,
  broker_commission numeric
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.partner_org_gate(p_org_id);
  if p_to < p_from then
    raise exception 'The end of the range must not be before its start' using errcode = 'P0001';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Choose a range of at most one year' using errcode = 'P0001';
  end if;
  return query select * from private.partner_sales_summary(p_org_id, p_from, p_to);
end $$;
comment on function public.partner_sales_summary(uuid, date, date) is
  'Per-day sales funnel for a broker or insurer organisation (requests, quotes, conversions, policies issued, premium, platform fee, broker commission). Members only.';

-- ---------------------------------------------------------------------------
-- 2. Renewals due within N days, with masked customer names for insurers,
--    contact-permission flags and whether a renewal request already exists.
-- ---------------------------------------------------------------------------
create or replace function private.partner_renewals(p_org_id uuid, p_days int, p_org_type public.org_type)
returns table (
  policy_id uuid,
  internal_reference text,
  policy_number text,
  category_id uuid,
  category_name text,
  cover_end date,
  days_left int,
  premium numeric,
  currency text,
  status public.policy_status,
  customer_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  contact_allowed boolean,
  marketing_allowed boolean,
  renewal_request_id uuid,
  renewal_status public.request_status,
  reminders_sent int
)
language sql stable security definer set search_path = '' as $$
  with latest_consent as (
    select distinct on (c.user_id, c.type) c.user_id, c.type, c.granted
    from public.consents c
    order by c.user_id, c.type, c.created_at desc
  )
  select p.id,
         p.internal_reference,
         p.policy_number,
         p.category_id,
         cat.name,
         p.cover_end::date,
         (p.cover_end::date - current_date)::int,
         p.premium,
         p.currency::text,
         p.status,
         p.customer_id,
         case
           when p_org_type = 'insurer' then coalesce(pr.business_name, private.mask_person_name(coalesce(pr.preferred_name, pr.full_name)), 'Customer')
           else coalesce(pr.business_name, nullif(btrim(pr.full_name), ''), pr.preferred_name, pr.email, 'Customer')
         end,
         case when p_org_type = 'insurer' then null else pr.email end,
         case when p_org_type = 'insurer' then null else pr.phone end,
         coalesce((select lc.granted from latest_consent lc where lc.user_id = p.customer_id
                     and lc.type = case when p_org_type = 'insurer' then 'data_sharing_insurer'::public.consent_type else 'data_sharing_broker'::public.consent_type end), false),
         coalesce((select lc.granted from latest_consent lc where lc.user_id = p.customer_id and lc.type = 'marketing'), false),
         rr.id,
         rr.status,
         coalesce(jsonb_array_length(case when jsonb_typeof(p.renewal_reminders_sent) = 'array' then p.renewal_reminders_sent else '[]'::jsonb end), 0)::int
  from public.policies p
  join public.product_categories cat on cat.id = p.category_id
  left join public.profiles pr on pr.id = p.customer_id
  left join lateral (
    select r.id, r.status
    from public.requests r
    where r.related_policy_id = p.id and r.type = 'renewal' and r.status not in ('cancelled', 'closed_no_cover')
    order by r.created_at desc
    limit 1
  ) rr on true
  where p.status = 'active'
    and p.cover_end is not null
    and p.cover_end::date >= current_date
    and p.cover_end::date <= current_date + greatest(p_days, 0)
    and (p.broker_org_id = p_org_id or p.insurer_org_id = p_org_id)
  order by p.cover_end asc, p.internal_reference;
$$;
revoke execute on function private.partner_renewals(uuid, int, public.org_type) from public, anon, authenticated;

create or replace function public.partner_renewals(p_org_id uuid, p_days int default 30)
returns table (
  policy_id uuid,
  internal_reference text,
  policy_number text,
  category_id uuid,
  category_name text,
  cover_end date,
  days_left int,
  premium numeric,
  currency text,
  status public.policy_status,
  customer_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  contact_allowed boolean,
  marketing_allowed boolean,
  renewal_request_id uuid,
  renewal_status public.request_status,
  reminders_sent int
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_type public.org_type;
begin
  v_type := private.partner_org_gate(p_org_id);
  return query select * from private.partner_renewals(p_org_id, least(coalesce(p_days, 30), 365), v_type);
end $$;
comment on function public.partner_renewals(uuid, int) is
  'Active policies of the organisation expiring within N days. Insurers see first name + initial only and no contact details; brokers (broker of record) see the full name and contact details. contact_allowed = latest data-sharing consent for the caller''s organisation type.';

-- ---------------------------------------------------------------------------
-- 3. Claims summary and SLA performance.
-- ---------------------------------------------------------------------------
create or replace function private.partner_claims_summary(p_org_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_by_status jsonb;
  v_open int;
  v_total int;
  v_avg_days numeric;
  v_decided int;
  v_stale int;
  v_sla int;
begin
  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb), coalesce(sum(s.n), 0)::int
    into v_by_status, v_total
  from (
    select c.status::text as status, count(*)::int as n
    from public.claims c
    where c.broker_org_id = p_org_id or c.insurer_org_id = p_org_id
    group by c.status
  ) s;

  select count(*)::int into v_open
  from public.claims c
  where (c.broker_org_id = p_org_id or c.insurer_org_id = p_org_id)
    and c.status not in ('draft', 'paid', 'closed', 'withdrawn', 'rejected');

  select round(avg(extract(epoch from (c.decision_at - coalesce(c.delivered_to_insurer_at, c.reported_at, c.created_at))) / 86400)::numeric, 1), count(*)::int
    into v_avg_days, v_decided
  from public.claims c
  where (c.broker_org_id = p_org_id or c.insurer_org_id = p_org_id)
    and c.decision_at is not null;

  -- Open claims the insurer has not decided within 14 days of delivery.
  select count(*)::int into v_stale
  from public.claims c
  where (c.broker_org_id = p_org_id or c.insurer_org_id = p_org_id)
    and c.status in ('delivered_to_insurer', 'acknowledged', 'under_assessment', 'info_requested')
    and coalesce(c.delivered_to_insurer_at, c.reported_at, c.created_at) < now() - interval '14 days';

  -- Claim SLA timers only exist once the SLA stream lands (table `sla_timers`); read them if present.
  v_sla := null;
  if to_regclass('public.sla_timers') is not null then
    begin
      execute 'select count(*)::int from public.sla_timers t where t.entity_type = ''claim'' and t.breached_at is not null and t.completed_at is null '
           || 'and exists (select 1 from public.claims c where c.id = t.entity_id and (c.broker_org_id = $1 or c.insurer_org_id = $1))'
        into v_sla using p_org_id;
    exception when others then
      v_sla := null;
    end;
  end if;

  return jsonb_build_object(
    'by_status', v_by_status,
    'total', v_total,
    'open', v_open,
    'decided', v_decided,
    'avg_days_to_decision', v_avg_days,
    'stale_open', v_stale,
    'open_sla_breaches', v_sla
  );
end $$;
revoke execute on function private.partner_claims_summary(uuid) from public, anon, authenticated;

create or replace function public.partner_claims_summary(p_org_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.partner_org_gate(p_org_id);
  return private.partner_claims_summary(p_org_id);
end $$;
comment on function public.partner_claims_summary(uuid) is
  'Claims by status, open count, average days to decision, stale open claims (>14 days) and open SLA breaches (null until sla_timers exists). Members only.';

create or replace function private.partner_sla_performance(p_org_id uuid, p_days int)
returns table (
  requests_measured int,
  requests_on_time int,
  requests_breached int,
  requests_open_overdue int,
  submissions_measured int,
  submissions_on_time int,
  submissions_late int,
  submissions_open_overdue int,
  on_time_rate numeric
)
language sql stable security definer set search_path = '' as $$
  with req as (
    select
      count(*) filter (where r.completed_at is not null or r.status in ('completed', 'cancelled', 'closed_no_cover') or r.due_at < now()) as measured,
      count(*) filter (where (r.completed_at is not null or r.status in ('completed', 'cancelled', 'closed_no_cover')) and r.sla_breached_at is null
                        and (r.completed_at is null or r.completed_at <= r.due_at)) as on_time,
      count(*) filter (where r.sla_breached_at is not null or (r.completed_at is not null and r.completed_at > r.due_at)) as breached,
      count(*) filter (where r.completed_at is null and r.status not in ('completed', 'cancelled', 'closed_no_cover') and r.due_at < now()) as open_overdue
    from public.requests r
    where r.broker_org_id = p_org_id
      and r.due_at is not null
      and r.status <> 'draft'
      and r.created_at >= now() - make_interval(days => p_days)
  ),
  sub as (
    select
      count(*) filter (where s.responded_at is not null or s.response_due_at < now()) as measured,
      count(*) filter (where s.responded_at is not null and s.responded_at <= s.response_due_at) as on_time,
      count(*) filter (where s.responded_at is not null and s.responded_at > s.response_due_at) as late,
      count(*) filter (where s.responded_at is null and s.response_due_at < now()) as open_overdue
    from public.insurer_submissions s
    where (s.insurer_org_id = p_org_id or s.broker_org_id = p_org_id)
      and s.response_due_at is not null
      and s.created_at >= now() - make_interval(days => p_days)
  )
  select req.measured::int, req.on_time::int, req.breached::int, req.open_overdue::int,
         sub.measured::int, sub.on_time::int, sub.late::int, sub.open_overdue::int,
         case when (req.measured + sub.measured) > 0
              then round(((req.on_time + sub.on_time)::numeric / (req.measured + sub.measured)) * 100, 1)
              else null end
  from req, sub;
$$;
revoke execute on function private.partner_sla_performance(uuid, int) from public, anon, authenticated;

create or replace function public.partner_sla_performance(p_org_id uuid, p_days int default 90)
returns table (
  requests_measured int,
  requests_on_time int,
  requests_breached int,
  requests_open_overdue int,
  submissions_measured int,
  submissions_on_time int,
  submissions_late int,
  submissions_open_overdue int,
  on_time_rate numeric
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.partner_org_gate(p_org_id);
  return query select * from private.partner_sla_performance(p_org_id, least(greatest(coalesce(p_days, 90), 1), 366));
end $$;
comment on function public.partner_sla_performance(uuid, int) is
  'Response-target performance: broker requests (due_at / sla_breached_at / completed_at) and insurer submissions (response_due_at / responded_at) over the last N days. on_time_rate is a percentage.';

-- ---------------------------------------------------------------------------
-- 4. Commission summary for a month (brokers: earned; insurers: payable).
-- ---------------------------------------------------------------------------
create or replace function private.partner_commission_summary(p_org_id uuid, p_start date, p_end date, p_org_type public.org_type)
returns table (
  period text,
  period_start date,
  period_end date,
  currency text,
  earned numeric,
  paid numeric,
  outstanding numeric,
  revenue_share numeric,
  platform_fee numeric,
  entries int,
  statement_id uuid,
  statement_status text,
  statement_net_due numeric
)
language sql stable security definer set search_path = '' as $$
  with led as (
    select
      coalesce(sum(case when l.entry_type = 'broker_commission'
                          and ((p_org_type = 'broker' and l.org_id = p_org_id) or (p_org_type <> 'broker' and l.counterparty_org_id = p_org_id))
                        then abs(l.amount) else 0 end), 0) as earned,
      coalesce(sum(case when l.entry_type = 'revenue_share' then abs(l.amount) else 0 end), 0) as revenue_share,
      coalesce(sum(case when l.entry_type = 'platform_fee' then abs(l.amount) else 0 end), 0) as platform_fee,
      count(*)::int as entries,
      max(l.currency) as currency
    from public.ledger_entries l
    where l.created_at >= p_start::timestamptz and l.created_at < (p_end + 1)::timestamptz
      and l.entry_type in ('broker_commission', 'revenue_share', 'platform_fee')
      and (l.org_id = p_org_id or l.counterparty_org_id = p_org_id)
  ),
  st as (
    select s.id, s.status, s.net_due, s.commission, s.currency
    from public.settlement_statements s
    where s.org_id = p_org_id and s.period_start = p_start and s.period_end = p_end
    limit 1
  )
  select to_char(p_start, 'YYYY-MM'),
         p_start,
         p_end,
         coalesce(st.currency::text, led.currency::text, 'GHS'),
         led.earned,
         case when st.status = 'paid' then abs(st.commission) else 0 end,
         greatest(led.earned - case when st.status = 'paid' then abs(st.commission) else 0 end, 0),
         led.revenue_share,
         led.platform_fee,
         led.entries,
         st.id,
         st.status,
         st.net_due
  from led left join st on true;
$$;
revoke execute on function private.partner_commission_summary(uuid, date, date, public.org_type) from public, anon, authenticated;

create or replace function public.partner_commission_summary(p_org_id uuid, p_period text default to_char(current_date, 'YYYY-MM'))
returns table (
  period text,
  period_start date,
  period_end date,
  currency text,
  earned numeric,
  paid numeric,
  outstanding numeric,
  revenue_share numeric,
  platform_fee numeric,
  entries int,
  statement_id uuid,
  statement_status text,
  statement_net_due numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_type public.org_type;
  v_start date;
begin
  -- Same roles as the ledger / statement RLS policies.
  v_type := private.partner_org_gate(p_org_id, '{owner,admin,finance}');
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Period must look like YYYY-MM' using errcode = 'P0001';
  end if;
  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  return query select * from private.partner_commission_summary(p_org_id, v_start, (v_start + interval '1 month - 1 day')::date, v_type);
end $$;
comment on function public.partner_commission_summary(uuid, text) is
  'Commission for a calendar month from the ledger (earned) and settlement statements (paid / outstanding). Brokers: commission earned; insurers: commission payable. Owners, admins and finance only.';

-- ---------------------------------------------------------------------------
-- 5. Lapses, cancellations, expiries and renewals in the last 90 days.
-- ---------------------------------------------------------------------------
create or replace function private.partner_lapses(p_org_id uuid, p_days int)
returns table (lapsed int, cancelled int, expired int, renewed int, active int, ended int, lapse_rate numeric)
language sql stable security definer set search_path = '' as $$
  with base as (
    select p.status, p.updated_at, p.cancelled_at, p.cover_end
    from public.policies p
    where p.broker_org_id = p_org_id or p.insurer_org_id = p_org_id
  ),
  agg as (
    select
      count(*) filter (where status = 'lapsed' and updated_at >= now() - make_interval(days => p_days)) as lapsed,
      count(*) filter (where status = 'cancelled' and coalesce(cancelled_at, updated_at) >= now() - make_interval(days => p_days)) as cancelled,
      count(*) filter (where status = 'expired' and cover_end >= current_date - p_days) as expired,
      count(*) filter (where status = 'renewed' and updated_at >= now() - make_interval(days => p_days)) as renewed,
      count(*) filter (where status = 'active') as active
    from base
  )
  select lapsed::int, cancelled::int, expired::int, renewed::int, active::int,
         (lapsed + cancelled + expired + renewed)::int,
         case when (lapsed + cancelled + expired + renewed) > 0
              then round(((lapsed + cancelled + expired)::numeric / (lapsed + cancelled + expired + renewed)) * 100, 1)
              else null end
  from agg;
$$;
revoke execute on function private.partner_lapses(uuid, int) from public, anon, authenticated;

create or replace function public.partner_lapses(p_org_id uuid, p_days int default 90)
returns table (lapsed int, cancelled int, expired int, renewed int, active int, ended int, lapse_rate numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.partner_org_gate(p_org_id);
  return query select * from private.partner_lapses(p_org_id, least(greatest(coalesce(p_days, 90), 1), 366));
end $$;
comment on function public.partner_lapses(uuid, int) is
  'Policies lapsed, cancelled, expired and renewed in the last N days (default 90) plus the current active count and a lapse rate (%). Members only.';

-- ---------------------------------------------------------------------------
-- 6. Convenience views (security_invoker: the caller''s RLS applies).
-- ---------------------------------------------------------------------------
create or replace view public.partner_renewal_pipeline
with (security_invoker = on) as
  select p.id as policy_id,
         p.internal_reference,
         p.policy_number,
         p.broker_org_id,
         p.insurer_org_id,
         p.customer_id,
         p.category_id,
         p.status,
         p.premium,
         p.currency,
         p.cover_end::date as cover_end,
         (p.cover_end::date - current_date)::int as days_left,
         exists (
           select 1 from public.requests r
           where r.related_policy_id = p.id and r.type = 'renewal' and r.status not in ('cancelled', 'closed_no_cover')
         ) as has_renewal_request
  from public.policies p
  where p.status = 'active'
    and p.cover_end is not null
    and p.cover_end::date between current_date and current_date + 120;
comment on view public.partner_renewal_pipeline is 'Active policies ending in the next 120 days (RLS of policies applies through security_invoker).';

create or replace view public.partner_activity
with (security_invoker = on) as
  select a.id, a.org_id, a.actor_id, a.actor_role, a.action, a.entity_type, a.entity_id, a.occurred_at,
         case when a.action = 'update' then (select array_agg(k) from jsonb_object_keys(coalesce(a.data -> 'changes', '{}'::jsonb)) k) else null end as changed_fields
  from public.audit_events a
  where a.org_id is not null;
comment on view public.partner_activity is 'Audit trail per organisation without row payloads (RLS of audit_events applies: owner/admin/supervisor).';

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
grant execute on function public.partner_sales_summary(uuid, date, date) to authenticated, service_role;
grant execute on function public.partner_renewals(uuid, int) to authenticated, service_role;
grant execute on function public.partner_claims_summary(uuid) to authenticated, service_role;
grant execute on function public.partner_sla_performance(uuid, int) to authenticated, service_role;
grant execute on function public.partner_commission_summary(uuid, text) to authenticated, service_role;
grant execute on function public.partner_lapses(uuid, int) to authenticated, service_role;
revoke execute on function public.partner_sales_summary(uuid, date, date) from anon;
revoke execute on function public.partner_renewals(uuid, int) from anon;
revoke execute on function public.partner_claims_summary(uuid) from anon;
revoke execute on function public.partner_sla_performance(uuid, int) from anon;
revoke execute on function public.partner_commission_summary(uuid, text) from anon;
revoke execute on function public.partner_lapses(uuid, int) from anon;
grant select on public.partner_renewal_pipeline to authenticated, service_role;
grant select on public.partner_activity to authenticated, service_role;
