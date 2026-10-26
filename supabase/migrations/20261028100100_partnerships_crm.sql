-- =============================================================================
-- Partnerships CRM (Addendum 3 D): accounts for insurers / brokers / embedded
-- partners / groups moving through a pipeline, with notes, tasks, meetings,
-- attachments and a stage audit. Leads from the website callback forms and
-- broker "suggest an insurer" requests land in the pipeline automatically.
-- Additive only (no drops, no deletes). Policies are created only when missing.
--
-- Roles. The partnerships team is platform staff: the `member_role` enum is not
-- extended. A *Partnerships Rep* is any active platform membership with
-- `team = 'partnerships'`; a *Partnerships Lead* additionally has
-- `is_supervisor = true`. Every staff role reads the CRM; writes are allowed for
-- platform_admin / platform_ops and for anyone on the partnerships team
-- (private.is_crm_writer). `support` therefore stays read-only unless they are
-- placed on the partnerships team.
--
-- `lead_id` and `application_id` are plain uuids (no foreign keys) so this
-- migration applies independently of the partner self-service migration that
-- owns `partner_applications`, and so a lead can never be blocked from deletion
-- by its CRM account.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Role helpers
-- ---------------------------------------------------------------------------
create or replace function private.is_partnerships_rep() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid()) and m.active and o.type = 'platform' and m.team = 'partnerships'
  );
$$;
comment on function private.is_partnerships_rep() is 'Partnerships Rep: active platform membership with team = partnerships.';

create or replace function private.is_partnerships_lead() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid()) and m.active and o.type = 'platform'
      and ((m.team = 'partnerships' and m.is_supervisor) or m.role = 'platform_admin')
  );
$$;
comment on function private.is_partnerships_lead() is 'Partnerships Lead: partnerships team member with is_supervisor, or a platform admin.';

create or replace function private.is_crm_writer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid()) and m.active and o.type = 'platform'
      and (m.role in ('platform_admin', 'platform_ops') or m.team = 'partnerships')
  );
$$;
comment on function private.is_crm_writer() is 'Who may write CRM rows: platform_admin, platform_ops, or any partnerships team member. Reads are open to all platform staff.';

-- ---------------------------------------------------------------------------
-- 1. Accounts
-- ---------------------------------------------------------------------------
create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('insurer', 'broker', 'embedded_partner', 'group')),
  name text not null,
  stage text not null default 'lead'
    check (stage in ('lead', 'contacted', 'meeting', 'proposal', 'agreement_signed', 'onboarding', 'live', 'lost')),
  owner_user_id uuid references auth.users (id),
  source text not null default 'rep' check (source in ('website_form', 'broker_suggestion', 'rep', 'referral', 'event', 'other')),
  lead_id uuid,
  application_id uuid,
  org_id uuid references public.organizations (id),
  contact jsonb not null default '{}'::jsonb,
  region text,
  estimated_value numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  expected_go_live date,
  lost_reason text,
  tags text[] not null default '{}',
  agreement_signed_at timestamptz,
  live_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.crm_accounts is
  'Partnerships CRM account (Addendum 3 D): an insurer, broker, embedded partner or group moving through the pipeline. lead_id / application_id are soft links (no FK).';
comment on column public.crm_accounts.contact is '{name, email, phone, title}';
comment on column public.crm_accounts.org_id is 'Set when the partner goes live (or earlier when the organisation already exists).';
comment on column public.crm_accounts.agreement_signed_at is 'Stamped by the stage trigger the first time the account reaches agreement_signed (time-to-live reporting).';
comment on column public.crm_accounts.live_at is 'Stamped by the stage trigger the first time the account reaches live.';
create unique index if not exists crm_accounts_lead_uidx on public.crm_accounts (lead_id) where lead_id is not null;
create index if not exists crm_accounts_stage_idx on public.crm_accounts (stage, updated_at desc);
create index if not exists crm_accounts_owner_idx on public.crm_accounts (owner_user_id) where owner_user_id is not null;
create index if not exists crm_accounts_org_idx on public.crm_accounts (org_id) where org_id is not null;
create index if not exists crm_accounts_application_idx on public.crm_accounts (application_id) where application_id is not null;

-- Stage audit (one row per stage change, written by the trigger below).
create table if not exists public.crm_stage_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  from_stage text,
  to_stage text not null,
  by uuid references auth.users (id),
  at timestamptz not null default now(),
  note text
);
comment on table public.crm_stage_events is 'Audit of pipeline stage changes per CRM account. The note comes from crm_move_stage().';
create index if not exists crm_stage_events_account_idx on public.crm_stage_events (account_id, at desc);

-- ---------------------------------------------------------------------------
-- 2. Notes, tasks, meetings, attachments
-- ---------------------------------------------------------------------------
create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  body text not null check (length(body) between 1 and 8000),
  author_id uuid references auth.users (id),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_notes_account_idx on public.crm_notes (account_id, pinned desc, created_at desc);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  due_at timestamptz,
  done_at timestamptz,
  assignee_id uuid references auth.users (id),
  reminder_sent_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
comment on column public.crm_tasks.reminder_sent_at is 'Set by the crm-reminders cron once a due/overdue reminder has gone out (one reminder per task).';
create index if not exists crm_tasks_account_idx on public.crm_tasks (account_id, done_at, due_at);
create index if not exists crm_tasks_assignee_idx on public.crm_tasks (assignee_id, due_at) where done_at is null;
create index if not exists crm_tasks_due_idx on public.crm_tasks (due_at) where done_at is null and reminder_sent_at is null;

create table if not exists public.crm_meetings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  attendees jsonb not null default '[]'::jsonb,
  summary text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists crm_meetings_account_idx on public.crm_meetings (account_id, starts_at desc);

create table if not exists public.crm_attachments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  storage_path text not null unique,
  name text not null,
  size_bytes bigint,
  content_type text,
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (storage_path like 'crm/' || account_id::text || '/%')
);
comment on table public.crm_attachments is 'Files in the private documents bucket under crm/<account_id>/<uuid>-<name>.';
create index if not exists crm_attachments_account_idx on public.crm_attachments (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Stage trigger: audit every change, stamp agreement_signed_at / live_at,
--    require an organisation before 'live'. The note is passed through the
--    transaction setting crm.stage_note (set by crm_move_stage).
-- ---------------------------------------------------------------------------
create or replace function private.crm_accounts_stage_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(current_setting('crm.stage_note', true), '');
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;
  if new.stage = 'live' and new.org_id is null then
    raise exception 'An account can only go live once it is linked to an organisation' using errcode = 'P0001';
  end if;
  if new.stage = 'lost' and nullif(new.lost_reason, '') is null then
    raise exception 'Record a reason when marking an account as lost' using errcode = 'P0001';
  end if;
  if new.stage = 'agreement_signed' and new.agreement_signed_at is null then
    new.agreement_signed_at := now();
  end if;
  if new.stage = 'live' then
    if new.agreement_signed_at is null then new.agreement_signed_at := now(); end if;
    if new.live_at is null then new.live_at := now(); end if;
  end if;
  return new;
end $$;
-- The stage event is written AFTER the row exists (FK to crm_accounts).
create or replace function private.crm_accounts_stage_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(current_setting('crm.stage_note', true), '');
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;
  insert into public.crm_stage_events (account_id, from_stage, to_stage, by, note)
  values (new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage, (select auth.uid()), v_note);
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'crm_accounts_stage_guard' and tgrelid = 'public.crm_accounts'::regclass) then
    create trigger crm_accounts_stage_guard before insert or update on public.crm_accounts
      for each row execute function private.crm_accounts_stage_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crm_accounts_stage_audit' and tgrelid = 'public.crm_accounts'::regclass) then
    create trigger crm_accounts_stage_audit after insert or update on public.crm_accounts
      for each row execute function private.crm_accounts_stage_audit();
  end if;
end $$;

-- updated_at + audit (same mechanism as the core tables)
do $$
declare t text;
begin
  foreach t in array array['crm_accounts'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
  end loop;
  foreach t in array array['crm_accounts', 'crm_notes', 'crm_tasks', 'crm_meetings', 'crm_attachments'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. In-app notifications for the partnerships team
-- ---------------------------------------------------------------------------
-- Recipients for an account: its owner, otherwise the partnerships team (reps + lead),
-- otherwise platform admins.
create or replace function private.crm_recipients(p_owner uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p_owner where p_owner is not null
  union
  select m.user_id from public.memberships m join public.organizations o on o.id = m.org_id
  where p_owner is null and m.active and o.type = 'platform' and m.team = 'partnerships'
  union
  select m.user_id from public.memberships m join public.organizations o on o.id = m.org_id
  where p_owner is null and m.active and o.type = 'platform' and m.role = 'platform_admin'
    and not exists (select 1 from public.memberships x join public.organizations y on y.id = x.org_id
                    where x.active and y.type = 'platform' and x.team = 'partnerships');
$$;

create or replace function private.crm_notify(p_users uuid[], p_kind text, p_title text, p_body text, p_link text, p_data jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  insert into public.notifications (user_id, kind, title, body, link, data, channels)
  select distinct u, p_kind, left(p_title, 200), left(p_body, 2000), p_link, coalesce(p_data, '{}'::jsonb), '{in_app}'::text[]
  from unnest(coalesce(p_users, '{}'::uuid[])) as u
  where u is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Lead → account (idempotent; one account per lead)
-- ---------------------------------------------------------------------------
create or replace function private.crm_account_from_lead(p_lead_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_json jsonb;
  v_tags text[];
  v_kind text;
  v_source text;
  v_id uuid;
  v_region text;
begin
  select id into v_id from public.crm_accounts where lead_id = p_lead_id;
  if v_id is not null then return v_id; end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'P0001';
  end if;
  v_json := to_jsonb(v_lead);
  -- Tags: leads.tags (if that column exists) plus utm.tags from the marketing forms.
  select coalesce(array_agg(t), '{}') into v_tags from (
    select jsonb_array_elements_text(case when jsonb_typeof(v_json -> 'tags') = 'array' then v_json -> 'tags' else '[]'::jsonb end) as t
    union all
    select jsonb_array_elements_text(case when jsonb_typeof(v_json -> 'utm' -> 'tags') = 'array' then v_json -> 'utm' -> 'tags' else '[]'::jsonb end)
  ) s;

  v_kind := case v_lead.kind::text
    when 'insurer' then 'insurer'
    when 'broker' then 'broker'
    when 'enterprise' then case when 'group' = any (v_tags) or v_lead.message ilike '%group scheme%' then 'group' else 'embedded_partner' end
    else null end;
  if v_kind is null then
    return null; -- customer / press / other leads are not partnership prospects
  end if;

  v_source := case
    when v_lead.source_page = 'broker_suggestion' or (v_lead.utm ->> 'source') = 'broker_suggestion' then 'broker_suggestion'
    else 'website_form' end;
  v_region := nullif(v_json ->> 'region', '');

  insert into public.crm_accounts (kind, name, stage, source, lead_id, contact, region, tags, created_by)
  values (
    v_kind,
    coalesce(nullif(v_lead.organization, ''), v_lead.name),
    'lead',
    v_source,
    v_lead.id,
    jsonb_strip_nulls(jsonb_build_object('name', v_lead.name, 'email', v_lead.email::text, 'phone', v_lead.phone, 'title', null)),
    v_region,
    v_tags,
    (select auth.uid())
  )
  on conflict (lead_id) where lead_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.crm_accounts where lead_id = p_lead_id;
    return v_id;
  end if;

  if v_lead.message is not null and length(v_lead.message) > 0 then
    insert into public.crm_notes (account_id, body, author_id, pinned)
    values (v_id, left(v_lead.message, 8000), null, true);
  end if;

  perform private.crm_notify(
    array(select private.crm_recipients(null)),
    'crm.account.created',
    'New partnership lead: ' || coalesce(nullif(v_lead.organization, ''), v_lead.name),
    case v_source when 'broker_suggestion' then 'A broker suggested this insurer. ' else 'From the website. ' end || 'The account is in the pipeline at "Lead" and has no owner yet.',
    '/partners/crm/' || v_id::text,
    jsonb_build_object('account_id', v_id, 'lead_id', v_lead.id, 'kind', v_kind, 'source', v_source));
  return v_id;
end $$;

create or replace function public.crm_lead_to_account(p_lead_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_service_role() or private.is_platform_staff()) then
    raise exception 'Only platform staff can convert leads' using errcode = 'P0001';
  end if;
  return private.crm_account_from_lead(p_lead_id);
end $$;
comment on function public.crm_lead_to_account(uuid) is
  'Create (or return the existing) CRM account for a lead. Insurer/broker/enterprise leads only; returns null for other kinds. Idempotent.';
revoke execute on function public.crm_lead_to_account(uuid) from public, anon;
grant execute on function public.crm_lead_to_account(uuid) to authenticated, service_role;

-- Website callback forms and broker suggestions land in the pipeline without a rep.
-- Never fails the lead insert: the CRM step is best-effort.
create or replace function private.leads_to_crm() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('insurer', 'broker', 'enterprise') then
    begin
      perform private.crm_account_from_lead(new.id);
    exception when others then
      raise warning 'crm: could not create account for lead %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'leads_to_crm' and tgrelid = 'public.leads'::regclass) then
    create trigger leads_to_crm after insert on public.leads for each row execute function private.leads_to_crm();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Stage move with a note (staff)
-- ---------------------------------------------------------------------------
create or replace function public.crm_move_stage(p_account_id uuid, p_to_stage text, p_note text default null, p_lost_reason text default null)
returns public.crm_accounts
language plpgsql security definer set search_path = '' as $$
declare v_row public.crm_accounts;
begin
  if not (private.is_service_role() or private.is_crm_writer()) then
    raise exception 'Only the partnerships team can move accounts between stages' using errcode = 'P0001';
  end if;
  perform set_config('crm.stage_note', coalesce(p_note, ''), true);
  update public.crm_accounts
     set stage = p_to_stage,
         lost_reason = case when p_to_stage = 'lost' then coalesce(nullif(p_lost_reason, ''), nullif(p_note, ''), lost_reason) else lost_reason end
   where id = p_account_id
   returning * into v_row;
  perform set_config('crm.stage_note', '', true);
  if v_row.id is null then
    raise exception 'Account not found' using errcode = 'P0001';
  end if;
  return v_row;
end $$;
revoke execute on function public.crm_move_stage(uuid, text, text, text) from public, anon;
grant execute on function public.crm_move_stage(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Linked application status → notify the owner (only if partner_applications
--    exists when this migration runs; the function is created regardless so a
--    later migration can attach the trigger).
-- ---------------------------------------------------------------------------
create or replace function private.crm_application_status_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_acc public.crm_accounts;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  for v_acc in select * from public.crm_accounts a where a.application_id = new.id loop
    perform private.crm_notify(
      array(select private.crm_recipients(v_acc.owner_user_id)),
      'crm.application.status',
      v_acc.name || ': application ' || replace(new.status::text, '_', ' '),
      'The linked partner application changed status to "' || new.status::text || '".',
      '/partners/crm/' || v_acc.id::text,
      jsonb_build_object('account_id', v_acc.id, 'application_id', new.id, 'status', new.status::text));
  end loop;
  return new;
end $$;
do $$
begin
  if to_regclass('public.partner_applications') is not null then
    if not exists (select 1 from pg_trigger where tgname = 'crm_application_status_notify' and tgrelid = to_regclass('public.partner_applications')) then
      execute 'create trigger crm_application_status_notify after update on public.partner_applications for each row execute function private.crm_application_status_notify()';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. RLS: platform staff read; writers (admin/ops/partnerships team) write
-- ---------------------------------------------------------------------------
alter table public.crm_accounts enable row level security;
alter table public.crm_stage_events enable row level security;
alter table public.crm_notes enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_meetings enable row level security;
alter table public.crm_attachments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_accounts', 'crm_stage_events', 'crm_notes', 'crm_tasks', 'crm_meetings', 'crm_attachments'] loop
    perform private.ensure_policy(t, t || ': staff read', format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_platform_staff()))', t || ': staff read', t));
    perform private.ensure_policy(t, t || ': partnerships write', format(
      'create policy %I on public.%I for all to authenticated using ((select private.is_crm_writer())) with check ((select private.is_crm_writer()))', t || ': partnerships write', t));
  end loop;
end $$;

-- Storage: CRM attachments live in the private documents bucket under crm/<account_id>/…
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents bucket: crm staff read') then
    create policy "documents bucket: crm staff read" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'crm' and (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents bucket: crm partnerships upload') then
    create policy "documents bucket: crm partnerships upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and (storage.foldername(name))[1] = 'crm' and (select private.is_crm_writer()));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Dashboard view (security invoker → staff-only through the table policies)
--    metric = 'stage'        key = stage            count, estimated_value
--    metric = 'owner'        key = owner_user_id    count, estimated_value (open accounts)
--    metric = 'time_to_live' key = 'all'            count = accounts live, avg_days = agreement_signed → live
-- ---------------------------------------------------------------------------
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
  from public.crm_accounts a where a.live_at is not null and a.agreement_signed_at is not null;
comment on view public.crm_pipeline_summary is 'Pipeline counts/value per stage, open accounts per owner, and average days from agreement signed to live.';
grant select on public.crm_pipeline_summary to authenticated, service_role;

grant execute on all functions in schema private to authenticated, service_role;
