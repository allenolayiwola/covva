-- Applied directly to production on 20261026213652; backfilled from supabase_migrations.schema_migrations statements.
-- Partnerships CRM follow-up: the pipeline view must not leak a zero "time_to_live" row to
-- non-staff (aggregate without GROUP BY always returns one row) and is not readable by anon.
-- Mirrors 20261028100100_partnerships_crm.sql.
create or replace view public.crm_pipeline_summary with (security_invoker = true) as
  select 'stage'::text as metric, a.stage as key, count(*)::bigint as count,
         coalesce(sum(a.estimated_value), 0)::numeric as estimated_value, null::numeric as avg_days
  from public.crm_accounts a group by a.stage
  union all
  select 'owner', coalesce(a.owner_user_id::text, 'unassigned'), count(*)::bigint,
         coalesce(sum(a.estimated_value), 0)::numeric, null::numeric
  from public.crm_accounts a where a.stage not in ('live', 'lost') group by a.owner_user_id
  union all
  select 'time_to_live', 'all', count(*)::bigint, coalesce(sum(a.estimated_value), 0)::numeric,
         avg(extract(epoch from (a.live_at - a.agreement_signed_at)) / 86400.0)::numeric
  from public.crm_accounts a where a.live_at is not null and a.agreement_signed_at is not null
  having count(*) > 0;
comment on view public.crm_pipeline_summary is 'Pipeline counts/value per stage, open accounts per owner, and average days from agreement signed to live.';
revoke select on public.crm_pipeline_summary from anon;
grant select on public.crm_pipeline_summary to authenticated, service_role;
