-- Explicit grants: revoking anon alone does not remove inherited PUBLIC EXECUTE.
-- Partner wrappers retain private.partner_org_gate (auth.uid / active membership;
-- commission additionally requires owner/admin/finance; staff/service exceptions).
revoke execute on function public.partner_sales_summary(uuid, date, date) from public, anon;
grant execute on function public.partner_sales_summary(uuid, date, date) to authenticated, service_role;
revoke execute on function public.partner_renewals(uuid, int) from public, anon;
grant execute on function public.partner_renewals(uuid, int) to authenticated, service_role;
revoke execute on function public.partner_claims_summary(uuid) from public, anon;
grant execute on function public.partner_claims_summary(uuid) to authenticated, service_role;
revoke execute on function public.partner_sla_performance(uuid, int) from public, anon;
grant execute on function public.partner_sla_performance(uuid, int) to authenticated, service_role;
revoke execute on function public.partner_commission_summary(uuid, text) from public, anon;
grant execute on function public.partner_commission_summary(uuid, text) to authenticated, service_role;
revoke execute on function public.partner_lapses(uuid, int) from public, anon;
grant execute on function public.partner_lapses(uuid, int) to authenticated, service_role;

-- Invitation metadata and moderated review text are read only by trusted servers.
-- Rollup/scheduler/number allocation callers use service clients, including the
-- admin rollup action after its staff/MFA/platform-permission check.
revoke execute on function public.invitation_preview(text) from public, anon, authenticated;
grant execute on function public.invitation_preview(text) to service_role;
revoke execute on function public.broker_public_reviews(uuid, int) from public, anon, authenticated;
grant execute on function public.broker_public_reviews(uuid, int) to service_role;
revoke execute on function public.analytics_rollup(date, date, boolean) from public, anon, authenticated;
grant execute on function public.analytics_rollup(date, date, boolean) to service_role;
revoke execute on function public.activate_scheduled_versions() from public, anon, authenticated;
grant execute on function public.activate_scheduled_versions() to service_role;
revoke execute on function public.allocate_policy_number(uuid, uuid) from public, anon, authenticated;
grant execute on function public.allocate_policy_number(uuid, uuid) to service_role;

-- Intentional public RPCs: bounded inputs, empty search_path, no customer identity.
create or replace function public.verify_policy(p_code text default null, p_insurer text default null, p_policy_number text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy record;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_valid boolean;
  v_today date := current_date;
begin
  if length(coalesce(p_code, '')) > 20
     or length(coalesce(p_insurer, '')) > 80
     or length(coalesce(p_policy_number, '')) > 60
     or (coalesce(p_code, '') <> '' and upper(p_code) !~ '^[0-9A-HJKMNP-TV-Z]{10}$')
     or (coalesce(p_code, '') = '' and
         (coalesce(btrim(p_insurer), '') = '' or length(btrim(coalesce(p_policy_number, ''))) < 3)) then
    return jsonb_build_object('valid', false, 'status', 'invalid_input');
  end if;
  if v_code <> '' then
    select p.status, p.cover_start, p.cover_end, p.policy_number, p.external_source, o.name as insurer_name, c.name as category_name
      into v_policy
    from public.policies p
    join public.product_categories c on c.id = p.category_id
    left join public.organizations o on o.id = p.insurer_org_id
    where p.verification_code = v_code
    limit 1;
  elsif coalesce(p_policy_number, '') <> '' and coalesce(p_insurer, '') <> '' then
    select p.status, p.cover_start, p.cover_end, p.policy_number, p.external_source, o.name as insurer_name, c.name as category_name
      into v_policy
    from public.policies p
    join public.organizations o on o.id = p.insurer_org_id and o.type = 'insurer'
    join public.product_categories c on c.id = p.category_id
    where lower(o.slug) = lower(trim(p_insurer))
      and upper(p.policy_number) = upper(trim(p_policy_number))
      and not p.external_source
    order by p.created_at desc
    limit 1;
  else
    return jsonb_build_object('valid', false, 'status', 'invalid_input');
  end if;

  if v_policy is null or v_policy.external_source then
    return jsonb_build_object('valid', false, 'status', 'not_found');
  end if;

  v_valid := v_policy.status in ('active', 'renewed')
    and (v_policy.cover_start is null or v_policy.cover_start <= v_today)
    and (v_policy.cover_end is null or v_policy.cover_end >= v_today);

  return jsonb_build_object(
    'valid', v_valid,
    'status', case
      when v_valid then 'active'
      when v_policy.status = 'active' then 'outside_cover_dates'
      else v_policy.status::text end,
    'insurer_name', regexp_replace(coalesce(v_policy.insurer_name, ''), '\s*\(demo\)\s*$', '', 'i'),
    'category_name', v_policy.category_name,
    'cover_start', v_policy.cover_start,
    'cover_end', v_policy.cover_end,
    'policy_number_masked', case
      when v_policy.policy_number is null then null
      when length(v_policy.policy_number) <= 4 then v_policy.policy_number
      else repeat('•', least(length(v_policy.policy_number) - 4, 8)) || right(v_policy.policy_number, 4) end
  );
end $$;

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
  with ids as (select distinct unnest(p_broker_org_ids) as id where cardinality(p_broker_org_ids) between 1 and 100),
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

create or replace function public.embed_partner(p_code text)
returns table (org_id uuid, org_name text, code text, segment text, allowed_categories text[], widget_domains text[], primary_colour text, logo_url text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, l.code, p.segment, p.allowed_categories, p.widget_domains,
         p.brand ->> 'primary_colour', coalesce(p.brand ->> 'logo_url', o.logo_url)
  from public.referral_links l
  join public.distribution_partners p on p.org_id = l.owner_org_id
  join public.organizations o on o.id = p.org_id
  where length(p_code) <= 32 and upper(btrim(p_code)) ~ '^[A-Z2-7]{8}$'
    and l.code = upper(btrim(p_code))
    and l.owner_kind = 'distributor'
    and l.disabled_at is null
    and p.status = 'active'
    and o.status = 'active'
  limit 1;
$$;

revoke execute on function public.verify_policy(text, text, text) from public, anon;
grant execute on function public.verify_policy(text, text, text) to anon, authenticated, service_role;
revoke execute on function public.broker_score_summary(uuid[]) from public, anon;
grant execute on function public.broker_score_summary(uuid[]) to anon, authenticated, service_role;
revoke execute on function public.embed_partner(text) from public, anon;
grant execute on function public.embed_partner(text) to anon, authenticated, service_role;
