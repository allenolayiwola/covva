-- =============================================================================
-- Catalogue extensions (Roadmap Phase 0, Addendum 2 B/G, Addendum 3 B3):
-- rate tables + rows, underwriting rules, document templates, issuance type/SLA,
-- scheduled price changes and the compliance workflow on product versions.
-- Additive only: no drops, no deletes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Ownership helpers (security definer, private schema)
-- ---------------------------------------------------------------------------
-- The insurer organisation that owns a product version (null when unknown).
create or replace function private.version_insurer_org(p_version uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.insurer_org_id from public.product_versions v
  join public.products p on p.id = v.product_id
  where v.id = p_version;
$$;

-- Insurer underwriters/admins of the owning org, or platform staff, may edit catalogue data.
create or replace function private.can_manage_version(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.is_platform_staff())
      or private.has_org_role(private.version_insurer_org(p_version), '{owner,admin,underwriter}');
$$;

-- Any member of the owning insurer, or platform staff, may read catalogue data of a version.
create or replace function private.can_view_version(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.is_platform_staff())
      or private.is_org_member(private.version_insurer_org(p_version));
$$;

-- Platform-approved product version (brokers may read its approved catalogue data).
create or replace function private.version_is_approved(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.product_versions v where v.id = p_version and v.status = 'approved');
$$;

-- Caller is an active member of at least one broker or insurer organisation.
create or replace function private.is_partner_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid()) and m.active and o.type in ('broker', 'insurer')
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. product_versions: issuance type / SLA, scheduled price changes, compliance
-- ---------------------------------------------------------------------------
alter table public.product_versions add column if not exists issuance_type text not null default 'manual';
alter table public.product_versions add column if not exists sla_hours int;
alter table public.product_versions add column if not exists scheduled_effective_from timestamptz;
alter table public.product_versions add column if not exists supersedes_version_id uuid references public.product_versions (id);
alter table public.product_versions add column if not exists change_summary text;
alter table public.product_versions add column if not exists compliance_status text not null default 'draft';
alter table public.product_versions add column if not exists compliance_notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_versions_issuance_type_check') then
    alter table public.product_versions add constraint product_versions_issuance_type_check
      check (issuance_type in ('instant', 'within_hours', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_versions_compliance_status_check') then
    alter table public.product_versions add constraint product_versions_compliance_status_check
      check (compliance_status in ('draft', 'submitted', 'in_review', 'returned', 'published'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_versions_sla_hours_check') then
    alter table public.product_versions add constraint product_versions_sla_hours_check
      check (sla_hours is null or sla_hours between 0 and 720);
  end if;
end $$;

comment on column public.product_versions.issuance_type is
  'How a policy on this version is issued: instant (delegated/API), within_hours (insurer issues within sla_hours), manual (broker/insurer handles). Shown to customers before payment (Addendum 2 G).';
comment on column public.product_versions.sla_hours is 'Expected issuance time in hours when issuance_type = within_hours.';
comment on column public.product_versions.scheduled_effective_from is
  'Scheduled price change: once approved, the version becomes current when this time passes (private.activate_scheduled_versions, hourly cron). Null = goes live on approval.';
comment on column public.product_versions.supersedes_version_id is 'The version this one replaces (change history for scheduled price changes).';
comment on column public.product_versions.compliance_status is
  'Insurer self-service workflow: draft → submitted → in_review → published, or returned with compliance_notes (Addendum 3 B3).';
comment on column public.quotes.product_version_id is
  'Pinned at quote time and never rewritten: when a newer version becomes current, existing quotes keep the version they were priced on.';
comment on column public.policies.product_version_id is
  'Pinned at issue time and never rewritten: existing policies keep their original version when prices change.';

create index if not exists product_versions_scheduled_idx on public.product_versions (scheduled_effective_from)
  where scheduled_effective_from is not null and status = 'approved';
create index if not exists product_versions_compliance_idx on public.product_versions (compliance_status)
  where compliance_status in ('submitted', 'in_review');

-- ---------------------------------------------------------------------------
-- 2. Rate tables + rows
-- ---------------------------------------------------------------------------
create table if not exists public.rate_tables (
  id uuid primary key default gen_random_uuid(),
  -- Null only for a broker proposal for an insurer not yet on the platform.
  product_version_id uuid references public.product_versions (id) on delete cascade,
  proposed_insurer_name text,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'approved', 'rejected')),
  factor_keys text[] not null default '{}',             -- e.g. {vehicle_use, vehicle_age_band, region}
  base_currency text not null default 'GHS',
  source text not null default 'manual' check (source in ('manual', 'csv', 'api')),
  submitted_by uuid references auth.users (id),
  submitted_by_org_id uuid references public.organizations (id),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  check (product_version_id is not null or proposed_insurer_name is not null)
);
create index if not exists rate_tables_version_idx on public.rate_tables (product_version_id);
create index if not exists rate_tables_status_idx on public.rate_tables (status) where status = 'pending_review';
comment on table public.rate_tables is
  'First-class rate tables per product version (Addendum 2 B). Brokers may submit a pending table for an insurer not yet on Covva (product_version_id null, proposed_insurer_name set); it stays pending until the insurer confirms and Covva activates it.';

create table if not exists public.rate_rows (
  id uuid primary key default gen_random_uuid(),
  rate_table_id uuid not null references public.rate_tables (id) on delete cascade,
  factors jsonb not null default '{}'::jsonb,           -- {vehicle_use: 'private', region: '*'}
  rate numeric not null check (rate >= 0),
  rate_kind text not null default 'rate_on_value' check (rate_kind in ('rate_on_value', 'flat', 'per_unit')),
  min_premium numeric check (min_premium is null or min_premium >= 0),
  loadings jsonb not null default '[]'::jsonb,          -- [{field, equals|lt|gt, factor, label}]
  created_at timestamptz not null default now()
);
create index if not exists rate_rows_table_idx on public.rate_rows (rate_table_id);

-- Who may edit the rows of a table: insurer underwriters of the owning org, platform
-- staff, or (for a pending proposal with no product) the broker who submitted it.
create or replace function private.can_edit_rate_table(p_table uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rate_tables t
    where t.id = p_table and (
      (select private.is_platform_staff())
      or (t.product_version_id is not null and private.can_manage_version(t.product_version_id))
      or (t.product_version_id is null and t.status = 'pending_review' and t.submitted_by = (select auth.uid()))
    )
  );
$$;

create or replace function private.can_view_rate_table(p_table uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rate_tables t
    where t.id = p_table and (
      (select private.is_platform_staff())
      or (t.product_version_id is not null and private.can_view_version(t.product_version_id))
      or t.submitted_by_org_id in (select private.user_org_ids())
      or (t.status = 'approved' and (select private.is_partner_user()))
    )
  );
$$;

alter table public.rate_tables enable row level security;
alter table public.rate_rows enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rate_tables' and policyname = 'rate_tables: read') then
    execute 'create policy "rate_tables: read" on public.rate_tables for select to authenticated
  using (private.can_view_rate_table(id))';
  end if;
end $$;

-- Insurers create/edit tables of their own versions but cannot self-approve (status stays draft/pending_review).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rate_tables' and policyname = 'rate_tables: insurer write') then
    execute 'create policy "rate_tables: insurer write" on public.rate_tables for all to authenticated
  using (product_version_id is not null and private.can_manage_version(product_version_id))
  with check (product_version_id is not null and private.can_manage_version(product_version_id) and status in (''draft'', ''pending_review''))';
  end if;
end $$;

-- Brokers propose a pending table for an insurer not on the platform (no product yet).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rate_tables' and policyname = 'rate_tables: broker proposal') then
    execute 'create policy "rate_tables: broker proposal" on public.rate_tables for insert to authenticated
  with check (
    product_version_id is null
    and proposed_insurer_name is not null
    and status = ''pending_review''
    and submitted_by = (select auth.uid())
    and submitted_by_org_id in (select private.user_org_ids())
    and exists (select 1 from public.organizations o where o.id = submitted_by_org_id and o.type = ''broker'')
  )';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rate_tables' and policyname = 'rate_tables: staff manage') then
    execute 'create policy "rate_tables: staff manage" on public.rate_tables for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rate_rows' and policyname = 'rate_rows: read') then
    execute 'create policy "rate_rows: read" on public.rate_rows for select to authenticated
  using (private.can_view_rate_table(rate_table_id))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rate_rows' and policyname = 'rate_rows: write') then
    execute 'create policy "rate_rows: write" on public.rate_rows for all to authenticated
  using (private.can_edit_rate_table(rate_table_id)) with check (private.can_edit_rate_table(rate_table_id))';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Underwriting rules
-- ---------------------------------------------------------------------------
create table if not exists public.underwriting_rules (
  id uuid primary key default gen_random_uuid(),
  product_version_id uuid not null references public.product_versions (id) on delete cascade,
  name text not null,
  condition jsonb not null default '{}'::jsonb,         -- {field, op, value} | {and:[...]} | {or:[...]} | {not:{...}}
  outcome text not null default 'refer' check (outcome in ('accept', 'refer', 'decline')),
  message text,
  priority int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists underwriting_rules_version_idx on public.underwriting_rules (product_version_id, priority);
comment on table public.underwriting_rules is
  'Rules editor (Addendum 3 B3): accept / refer (to insurer L1 review) / decline. A risk fits delegated issuance only when every active rule accepts.';

alter table public.underwriting_rules enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'underwriting_rules' and policyname = 'underwriting_rules: read') then
    execute 'create policy "underwriting_rules: read" on public.underwriting_rules for select to authenticated
  using (private.can_view_version(product_version_id) or ((select private.is_partner_user()) and private.version_is_approved(product_version_id)))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'underwriting_rules' and policyname = 'underwriting_rules: insurer and staff write') then
    execute 'create policy "underwriting_rules: insurer and staff write" on public.underwriting_rules for all to authenticated
  using (private.can_manage_version(product_version_id)) with check (private.can_manage_version(product_version_id))';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Document templates
-- ---------------------------------------------------------------------------
create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  product_version_id uuid not null references public.product_versions (id) on delete cascade,
  kind text not null check (kind in ('schedule', 'certificate', 'sticker', 'receipt')),
  name text not null,
  template jsonb not null default '{}'::jsonb,          -- {fields:[{key,label,path}], blocks:[...]} or {html: '...'}
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists document_templates_version_idx on public.document_templates (product_version_id, kind);
comment on table public.document_templates is
  'Schedule / certificate / sticker / receipt templates per product version (Addendum 3 B3). Only platform staff approve a template.';

alter table public.document_templates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_templates' and policyname = 'document_templates: read') then
    execute 'create policy "document_templates: read" on public.document_templates for select to authenticated
  using (private.can_view_version(product_version_id) or ((select private.is_partner_user()) and status = ''approved'' and private.version_is_approved(product_version_id)))';
  end if;
end $$;
-- Insurers edit drafts; approval (status = approved) is reserved for platform staff.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_templates' and policyname = 'document_templates: insurer write') then
    execute 'create policy "document_templates: insurer write" on public.document_templates for all to authenticated
  using (private.can_manage_version(product_version_id))
  with check (private.can_manage_version(product_version_id) and (status = ''draft'' or (select private.is_platform_staff())))';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Scheduled price changes
-- ---------------------------------------------------------------------------
-- Promotes platform-approved versions whose scheduled_effective_from has passed to
-- the product's current version. Existing quotes/policies keep their
-- product_version_id (pinned at creation; nothing here touches them). Idempotent:
-- a version that is already current, or is older than the current one, is skipped.
create or replace function private.activate_scheduled_versions() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v record;
  n int := 0;
begin
  for v in
    select pv.id, pv.product_id, pv.version, pv.scheduled_effective_from, p.current_version_id, cur.version as current_version
    from public.product_versions pv
    join public.products p on p.id = pv.product_id
    left join public.product_versions cur on cur.id = p.current_version_id
    where pv.status = 'approved'
      and pv.scheduled_effective_from is not null
      and pv.scheduled_effective_from <= now()
      and (p.current_version_id is null or p.current_version_id <> pv.id)
      and (cur.version is null or pv.version > cur.version)
      and p.status not in ('retired')
    order by pv.product_id, pv.version
  loop
    if v.current_version_id is not null then
      update public.product_versions set effective_to = current_date where id = v.current_version_id and effective_to is null;
    end if;
    update public.product_versions
       set effective_from = least(effective_from, (v.scheduled_effective_from at time zone 'UTC')::date),
           supersedes_version_id = coalesce(supersedes_version_id, v.current_version_id)
     where id = v.id;
    update public.products
       set current_version_id = v.id,
           status = case when status = 'suspended' then status else 'approved' end
     where id = v.product_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- PostgREST only exposes `public`: this wrapper lets the cron job (service role) and
-- platform staff run the promotion through rpc('activate_scheduled_versions').
create or replace function public.activate_scheduled_versions() returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not ((select private.is_service_role()) or (select private.is_platform_staff())) then
    raise exception 'Only platform staff or the system can activate scheduled versions' using errcode = 'P0001';
  end if;
  return private.activate_scheduled_versions();
end $$;
revoke execute on function public.activate_scheduled_versions() from public, anon;
grant execute on function public.activate_scheduled_versions() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Audit the regulated catalogue data
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rate_tables', 'underwriting_rules', 'document_templates'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

grant execute on all functions in schema private to authenticated, service_role;
