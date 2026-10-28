-- Roadmap partials (Phase 1): audit coverage of team role changes, insurer product bulk updates and
-- a per-product change history. Additive and idempotent: create or replace, guarded triggers, no drops,
-- no deletes. The household view needs no schema (it reads policies the customer may already see).
--
-- 1. Audit coverage of role changes
--    * `invitations` joins the audited tables (invite, revoke, acceptance). The audit snapshot never
--      carries the invitation token: `private.write_audit()` now strips `token` as it strips risk data.
--    * `record_mfa_change(p_org_id)` — called by the partner and staff apps after a successful
--      authenticator verification. It reads the caller's own verified TOTP factors in `auth.mfa_factors`
--      (so a client cannot claim an enrolment that did not happen), compares with the last recorded
--      state and writes `mfa.enrolled` / `mfa.removed` to the audit log (entity `mfa`, entity_id = user).
--      A factor removed by platform support shows as `mfa.removed` at the user's next verification.
--    * `partner_activity` gains `subject_user_id` (the team member a membership row is about) and a
--      `detail` column: a small whitelist (role / active / supervisor / team / email) so the partner
--      activity page can say "Role: underwriter → claims officer" without exposing row payloads.
-- 2. Insurer product management
--    * `products_status_guard` — insurer users may pause (approved → suspended), republish
--      (suspended → approved, needs an approved current version) and withdraw (→ retired) a product.
--      Publishing and bringing back a withdrawn product stay with Covva compliance (staff / service role).
--    * `bulk_set_product_status(ids, action, reason)` — pause / withdraw / republish several products at
--      once; per-product skips are reported, every status change is audited by the existing products
--      trigger, and one `products.bulk_<action>` audit row keeps the reason for the change history.
--    * `product_change_history(product_id, limit)` — the product's change history built from the
--      existing audit rows (product, its versions, rate tables, underwriting rules, document templates
--      and bulk actions), with a per-entity whitelist of fields. Readable by any active member of the
--      owning insurer and by platform staff. No new audit mechanism.

-- ---------------------------------------------------------------------------
-- 1a. write_audit: never snapshot invitation tokens
-- ---------------------------------------------------------------------------
create or replace function private.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb; v_old jsonb; v_changes jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    for k in select jsonb_object_keys(v_row) loop
      if k not in ('updated_at') and (v_row -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, case when k = 'token' then jsonb_build_object('changed', true) else jsonb_build_object('from', v_old -> k, 'to', v_row -> k) end);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, org_id, data)
  values (
    (select auth.uid()),
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'key'),
    coalesce(nullif(v_row ->> 'broker_org_id', '')::uuid, nullif(v_row ->> 'insurer_org_id', '')::uuid, nullif(v_row ->> 'org_id', '')::uuid),
    case when tg_op = 'UPDATE' then jsonb_build_object('changes', v_changes) else jsonb_build_object('row', v_row - 'risk_data' - 'declarations' - 'token') end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 1b. invitations are audited (invite, revoke, acceptance)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_invitations' and tgrelid = 'public.invitations'::regclass) then
    create trigger audit_invitations after insert or update or delete on public.invitations
      for each row execute function private.write_audit();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1c. MFA enrolment / removal recorded from the real factor state
-- ---------------------------------------------------------------------------
create or replace function public.record_mfa_change(p_org_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count int := 0;
  v_factors jsonb := '[]'::jsonb;
  v_prev int := 0;
  v_action text;
  v_org uuid := null;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = 'P0001';
  end if;
  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.friendly_name, 'created_at', f.created_at) order by f.created_at), '[]'::jsonb)
    into v_count, v_factors
    from auth.mfa_factors f
   where f.user_id = v_uid and f.factor_type::text = 'totp' and f.status::text = 'verified';

  select coalesce((a.data ->> 'verified_factors')::int, 0) into v_prev
    from public.audit_events a
   where a.entity_type = 'mfa' and a.entity_id = v_uid::text
   order by a.id desc limit 1;
  v_prev := coalesce(v_prev, 0);

  if v_count = v_prev then
    return jsonb_build_object('changed', false, 'verified_factors', v_count);
  end if;
  v_action := case when v_count > v_prev then 'mfa.enrolled' else 'mfa.removed' end;
  -- Attribute the event to the partner organisation only when the caller really belongs to it.
  if p_org_id is not null and private.is_org_member(p_org_id) then
    v_org := p_org_id;
  end if;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, org_id, data)
  values (
    v_uid,
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user),
    v_action,
    'mfa',
    v_uid::text,
    v_org,
    jsonb_build_object('verified_factors', v_count, 'previous_verified_factors', v_prev, 'factors', v_factors)
  );
  return jsonb_build_object('changed', true, 'action', v_action, 'verified_factors', v_count);
end $$;
revoke execute on function public.record_mfa_change(uuid) from public, anon;
grant execute on function public.record_mfa_change(uuid) to authenticated, service_role;
comment on function public.record_mfa_change(uuid) is
  'Records mfa.enrolled / mfa.removed in the audit log from the caller''s verified TOTP factors (auth.mfa_factors). Called after every successful verification; no-op when nothing changed.';

-- ---------------------------------------------------------------------------
-- 1d. partner_activity: who the row is about and a safe detail whitelist
-- ---------------------------------------------------------------------------
create or replace view public.partner_activity
with (security_invoker = on) as
  select a.id, a.org_id, a.actor_id, a.actor_role, a.action, a.entity_type, a.entity_id, a.occurred_at,
         case when a.action = 'update' then (select array_agg(k) from jsonb_object_keys(coalesce(a.data -> 'changes', '{}'::jsonb)) k) else null end as changed_fields,
         case
           when a.entity_type = 'memberships' then coalesce(m.user_id, nullif(a.data -> 'row' ->> 'user_id', '')::uuid)
           when a.entity_type = 'mfa' then nullif(a.entity_id, '')::uuid
           else null
         end as subject_user_id,
         case
           when a.entity_type = 'memberships' and a.action = 'update' then
             (select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
                from jsonb_each(coalesce(a.data -> 'changes', '{}'::jsonb)) c
               where c.key in ('role', 'active', 'is_supervisor', 'team', 'title'))
           when a.entity_type = 'memberships' then
             jsonb_strip_nulls(jsonb_build_object('role', a.data -> 'row' -> 'role', 'active', a.data -> 'row' -> 'active', 'team', a.data -> 'row' -> 'team'))
           when a.entity_type = 'invitations' and a.action = 'update' then
             (select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb)
                from jsonb_each(coalesce(a.data -> 'changes', '{}'::jsonb)) c
               where c.key in ('accepted_at', 'role', 'expires_at'))
           when a.entity_type = 'invitations' then
             jsonb_strip_nulls(jsonb_build_object('email', a.data -> 'row' -> 'email', 'role', a.data -> 'row' -> 'role', 'accepted_at', a.data -> 'row' -> 'accepted_at'))
           when a.entity_type = 'mfa' then
             jsonb_build_object('verified_factors', a.data -> 'verified_factors')
           when a.action like 'products.bulk_%' then
             jsonb_build_object('count', a.data -> 'count', 'reason', a.data -> 'reason')
           else null
         end as detail
  from public.audit_events a
  left join public.memberships m on a.entity_type = 'memberships' and m.id::text = a.entity_id
  where a.org_id is not null;
comment on view public.partner_activity is
  'Audit trail per organisation without row payloads (RLS of audit_events applies: owner/admin/supervisor). detail is a whitelist: role/active/supervisor/team changes, invitation email/role, MFA factor count, bulk product action reason.';
grant select on public.partner_activity to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2a. Product status guard for insurer users
-- ---------------------------------------------------------------------------
create or replace function private.products_status_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cv_status public.product_status;
begin
  if new.status is not distinct from old.status then return new; end if;
  if (select private.is_service_role()) or (select private.is_platform_staff()) then return new; end if;
  if old.status = 'approved' and new.status in ('suspended', 'retired') then return new; end if;
  if old.status = 'suspended' and new.status = 'retired' then return new; end if;
  if old.status = 'suspended' and new.status = 'approved' then
    select v.status into v_cv_status from public.product_versions v where v.id = new.current_version_id;
    if v_cv_status is distinct from 'approved'::public.product_status then
      raise exception 'This product has no approved version, so it cannot be republished. Submit a version for compliance review first.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.status = 'retired' then
    raise exception 'A withdrawn product can only be brought back by Covva compliance. Contact support.' using errcode = 'P0001';
  end if;
  raise exception 'Products are published through version approval by Covva compliance. You can pause, republish or withdraw a published product.' using errcode = 'P0001';
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'products_status_guard' and tgrelid = 'public.products'::regclass) then
    create trigger products_status_guard before update of status on public.products
      for each row execute function private.products_status_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2b. Bulk pause / withdraw / republish
-- ---------------------------------------------------------------------------
create or replace function public.bulk_set_product_status(p_product_ids uuid[], p_action text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_staff boolean := (select private.is_platform_staff());
  v_orgs int;
  v_org uuid;
  v_target public.product_status;
  v_updated uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_reason text;
  p record;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = 'P0001';
  end if;
  if p_action not in ('pause', 'withdraw', 'republish') then
    raise exception 'Choose pause, withdraw or republish' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_product_ids, 1), 0) = 0 then
    raise exception 'Choose at least one product' using errcode = 'P0001';
  end if;
  if array_length(p_product_ids, 1) > 200 then
    raise exception 'Update at most 200 products at a time' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters; it is kept in the change history' using errcode = 'P0001';
  end if;
  select count(distinct pr.insurer_org_id), min(pr.insurer_org_id::text)::uuid into v_orgs, v_org
    from public.products pr where pr.id = any (p_product_ids);
  if v_orgs = 0 then
    raise exception 'None of the chosen products exist' using errcode = 'P0001';
  end if;
  if v_orgs > 1 then
    raise exception 'Choose products of one insurer at a time' using errcode = 'P0001';
  end if;
  if not v_staff and not private.has_org_role(v_org, '{owner,admin,underwriter}') then
    raise exception 'Only the insurer''s owners, admins and underwriters can change product status' using errcode = 'P0001';
  end if;
  v_target := case p_action when 'pause' then 'suspended' when 'withdraw' then 'retired' else 'approved' end;

  for p in
    select pr.id, pr.name, pr.status, pr.current_version_id
      from public.products pr where pr.id = any (p_product_ids) order by pr.name
  loop
    v_reason := null;
    if p.status = v_target then
      v_reason := case v_target when 'suspended' then 'already paused' when 'retired' then 'already withdrawn' else 'already published' end;
    elsif p_action = 'pause' and p.status <> 'approved' then
      v_reason := 'only published products can be paused';
    elsif p_action = 'withdraw' and p.status not in ('approved', 'suspended') then
      v_reason := 'only published or paused products can be withdrawn';
    elsif p_action = 'republish' and p.status = 'retired' and not v_staff then
      v_reason := 'withdrawn products are brought back by Covva compliance';
    elsif p_action = 'republish' and p.status not in ('suspended', 'retired') then
      v_reason := 'only paused products can be republished';
    elsif p_action = 'republish' and not exists (select 1 from public.product_versions v where v.id = p.current_version_id and v.status = 'approved') then
      v_reason := 'no approved version to republish';
    end if;
    if v_reason is null then
      update public.products set status = v_target where id = p.id;
      v_updated := v_updated || p.id;
    else
      v_skipped := v_skipped || jsonb_build_object('id', p.id, 'name', p.name, 'reason', v_reason);
    end if;
  end loop;

  if coalesce(array_length(v_updated, 1), 0) > 0 then
    insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, org_id, data)
    values (
      v_uid,
      coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user),
      'products.bulk_' || p_action,
      'products',
      null,
      v_org,
      jsonb_build_object('action', p_action, 'status', v_target, 'reason', trim(p_reason), 'count', array_length(v_updated, 1),
                         'product_ids', to_jsonb(v_updated), 'skipped', v_skipped)
    );
  end if;
  return jsonb_build_object('updated', coalesce(array_length(v_updated, 1), 0), 'updated_ids', to_jsonb(v_updated), 'skipped', v_skipped, 'status', v_target);
end $$;
revoke execute on function public.bulk_set_product_status(uuid[], text, text) from public, anon;
grant execute on function public.bulk_set_product_status(uuid[], text, text) to authenticated, service_role;
comment on function public.bulk_set_product_status(uuid[], text, text) is
  'Pause (approved → suspended), withdraw (→ retired) or republish (suspended → approved) several products of one insurer. Skips are reported, not raised. The reason is kept in one products.bulk_<action> audit row.';

create index if not exists audit_events_bulk_products_idx on public.audit_events (id desc) where action like 'products.bulk_%';

-- ---------------------------------------------------------------------------
-- 2c. Per-product change history from the existing audit rows
-- ---------------------------------------------------------------------------
-- Whitelists what the partner workspace may show from an audit payload. Scalars keep from → to;
-- large documents (rating, coverage, limits, templates …) are reported as "changed".
create or replace function private.product_history_changes(p_entity text, p_action text, p_data jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_keys text[];
  v_big text[] := array['rating', 'coverage', 'limits', 'excesses', 'optional_benefits', 'exclusions', 'conditions', 'claims_process', 'template', 'condition', 'plans', 'settings'];
  v_out jsonb := '{}'::jsonb;
  c record;
  v_row jsonb;
begin
  v_keys := case p_entity
    when 'products' then array['name', 'code', 'tier', 'summary', 'status', 'current_version_id']
    when 'product_versions' then array['version', 'status', 'compliance_status', 'compliance_notes', 'change_summary', 'effective_from', 'effective_to', 'scheduled_effective_from', 'issuance_type', 'sla_hours', 'wording_url', 'approved_at', 'insurer_approved_at', 'rating', 'coverage', 'limits', 'excesses', 'optional_benefits', 'exclusions', 'conditions', 'claims_process', 'micro', 'periods', 'plans']
    when 'rate_tables' then array['name', 'status', 'source', 'factor_keys', 'review_notes', 'reviewed_at']
    when 'underwriting_rules' then array['name', 'outcome', 'active', 'priority', 'message', 'condition']
    when 'document_templates' then array['name', 'kind', 'status', 'version', 'template']
    else array[]::text[]
  end;
  if p_action = 'update' then
    for c in select key, value from jsonb_each(coalesce(p_data -> 'changes', '{}'::jsonb)) loop
      if c.key = any (v_keys) then
        v_out := v_out || jsonb_build_object(c.key, case when c.key = any (v_big) then jsonb_build_object('changed', true) else c.value end);
      end if;
    end loop;
  elsif p_action in ('insert', 'delete') then
    v_row := coalesce(p_data -> 'row', '{}'::jsonb);
    for c in select key, value from jsonb_each(v_row) loop
      if c.key = any (v_keys) and not (c.key = any (v_big)) then
        v_out := v_out || jsonb_build_object(c.key, c.value);
      end if;
    end loop;
  end if;
  return v_out;
end $$;
revoke execute on function private.product_history_changes(text, text, jsonb) from public, anon;

create or replace function public.product_change_history(p_product_id uuid, p_limit int default 200)
returns table (
  event_id bigint,
  occurred_at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text,
  entity_type text,
  entity_id text,
  version_no int,
  entity_label text,
  changes jsonb,
  note text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_name text;
begin
  select pr.insurer_org_id, pr.name into v_org, v_name from public.products pr where pr.id = p_product_id;
  if v_org is null then
    raise exception 'Product not found' using errcode = 'P0001';
  end if;
  if not ((select private.is_platform_staff()) or private.is_org_member(v_org)) then
    raise exception 'You can only view the change history of your own organisation''s products' using errcode = 'P0001';
  end if;
  return query
  with versions as (
    select v.id, v.version from public.product_versions v where v.product_id = p_product_id
  ), tables as (
    select t.id, t.name, v.version from public.rate_tables t join versions v on v.id = t.product_version_id
  ), rules as (
    select r.id, r.name, v.version from public.underwriting_rules r join versions v on v.id = r.product_version_id
  ), templates as (
    select d.id, d.name, v.version from public.document_templates d join versions v on v.id = d.product_version_id
  ), ev as (
    select a.id, a.occurred_at, a.actor_id, a.actor_role, a.action, a.entity_type, a.entity_id, a.data
      from public.audit_events a
     where (a.entity_type = 'products' and a.entity_id = p_product_id::text)
        or (a.entity_type = 'product_versions' and a.entity_id in (select id::text from versions))
        or (a.entity_type = 'rate_tables' and a.entity_id in (select id::text from tables))
        or (a.entity_type = 'underwriting_rules' and a.entity_id in (select id::text from rules))
        or (a.entity_type = 'document_templates' and a.entity_id in (select id::text from templates))
        or (a.action like 'products.bulk_%' and a.data -> 'product_ids' ? p_product_id::text)
     order by a.id desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  )
  select e.id,
         e.occurred_at,
         e.actor_id,
         (select coalesce(p.preferred_name, p.full_name) from public.profiles p
           where p.id = e.actor_id and exists (select 1 from public.memberships m where m.user_id = e.actor_id and m.org_id = v_org)),
         e.actor_role,
         e.action,
         e.entity_type,
         e.entity_id,
         case e.entity_type
           when 'product_versions' then (select v.version from versions v where v.id::text = e.entity_id)
           when 'rate_tables' then (select t.version from tables t where t.id::text = e.entity_id)
           when 'underwriting_rules' then (select r.version from rules r where r.id::text = e.entity_id)
           when 'document_templates' then (select d.version from templates d where d.id::text = e.entity_id)
           else null
         end,
         case e.entity_type
           when 'products' then v_name
           when 'rate_tables' then coalesce((select t.name from tables t where t.id::text = e.entity_id), e.data -> 'row' ->> 'name')
           when 'underwriting_rules' then coalesce((select r.name from rules r where r.id::text = e.entity_id), e.data -> 'row' ->> 'name')
           when 'document_templates' then coalesce((select d.name from templates d where d.id::text = e.entity_id), e.data -> 'row' ->> 'name')
           else null
         end,
         private.product_history_changes(e.entity_type, e.action, e.data),
         case when e.action like 'products.bulk_%' then e.data ->> 'reason' else null end
    from ev e
   order by e.id desc;
end $$;
revoke execute on function public.product_change_history(uuid, int) from public, anon;
grant execute on function public.product_change_history(uuid, int) to authenticated, service_role;
comment on function public.product_change_history(uuid, int) is
  'Change history of one product from the audit log: the product, its versions, rate tables, underwriting rules, document templates and bulk status actions. Members of the owning insurer and platform staff only; payloads are whitelisted per entity.';
