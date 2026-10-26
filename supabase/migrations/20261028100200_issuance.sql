-- =============================================================================
-- Issuance (Roadmap Phase 1 "Insurer Level 1 and Level 2", Addendum 2 A/G):
-- policy-number blocks, issuance jobs (delegated / portal / API), SLA timers with
-- escalation, QR-verifiable policies (verification_code), insurer-direct submissions
-- (broker_org_id nullable) and the public verify_policy RPC.
-- Additive only: no drops, no deletes. The single ALTER COLUMN … DROP NOT NULL on
-- insurer_submissions.broker_org_id is the agreed exception.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Enum value for generated motor stickers (not used inside this transaction)
-- ---------------------------------------------------------------------------
alter type public.document_kind add value if not exists 'sticker';

-- ---------------------------------------------------------------------------
-- 1. Policy number blocks (Addendum 2 A, Level 2)
-- ---------------------------------------------------------------------------
create table if not exists public.policy_number_blocks (
  id uuid primary key default gen_random_uuid(),
  insurer_org_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid references public.product_categories (id) on delete cascade,   -- null = any line
  prefix text not null default '',
  next_number bigint not null check (next_number >= 0),
  last_number bigint not null check (last_number >= 0),
  pad int not null default 6 check (pad between 0 and 12),
  active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (next_number <= last_number + 1)
);
comment on table public.policy_number_blocks is
  'Policy-number ranges an insurer allocates to Covva for delegated issuance (Addendum 2 A, L2). next_number is the next unused number; the block is exhausted when next_number > last_number.';
-- One active block per insurer × category (and one active catch-all per insurer).
create unique index if not exists policy_number_blocks_one_active_per_line on public.policy_number_blocks (insurer_org_id, category_id) where active and category_id is not null;
create unique index if not exists policy_number_blocks_one_active_catch_all on public.policy_number_blocks (insurer_org_id) where active and category_id is null;
create index if not exists policy_number_blocks_insurer_idx on public.policy_number_blocks (insurer_org_id, active);

-- Row-locked, sequential allocation. Prefers a block for the category, else the catch-all.
create or replace function private.next_policy_number(p_insurer uuid, p_category uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_block public.policy_number_blocks;
  v_number bigint;
begin
  select * into v_block from public.policy_number_blocks b
  where b.insurer_org_id = p_insurer and b.active
    and (b.category_id = p_category or b.category_id is null)
  order by (b.category_id is null), b.created_at
  limit 1
  for update;
  if v_block.id is null then
    raise exception 'No active policy number block for this insurer and line' using errcode = 'P0001';
  end if;
  if v_block.next_number > v_block.last_number then
    raise exception 'Policy number block % is exhausted (last number % used)', v_block.id, v_block.last_number using errcode = 'P0001';
  end if;
  v_number := v_block.next_number;
  update public.policy_number_blocks set next_number = v_number + 1 where id = v_block.id;
  return v_block.prefix || lpad(v_number::text, greatest(v_block.pad, length(v_number::text)), '0');
end $$;

-- PostgREST wrapper: the service role (issuance engine), platform staff, and the insurer's own
-- owners/admins/underwriters may allocate.
create or replace function public.allocate_policy_number(p_insurer uuid, p_category uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not ((select private.is_service_role()) or (select private.is_platform_staff()) or private.has_org_role(p_insurer, '{owner,admin,underwriter}')) then
    raise exception 'Only the insurer or the platform can allocate policy numbers' using errcode = 'P0001';
  end if;
  return private.next_policy_number(p_insurer, p_category);
end $$;
revoke execute on function public.allocate_policy_number(uuid, uuid) from public, anon;
grant execute on function public.allocate_policy_number(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Issuance jobs
-- ---------------------------------------------------------------------------
create table if not exists public.issuance_jobs (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null unique references public.policies (id) on delete cascade,
  request_id uuid references public.requests (id) on delete set null,
  insurer_org_id uuid not null references public.organizations (id),
  mode text not null default 'insurer_portal' check (mode in ('delegated', 'insurer_portal', 'api')),
  status text not null default 'queued' check (status in ('queued', 'generating', 'issued', 'referred', 'review_window', 'endorsed', 'cancelled', 'failed')),
  underwriting_outcome jsonb not null default '{}'::jsonb,   -- {outcome, fits, reason, matched:[…]}
  review_until timestamptz,
  documents jsonb not null default '[]'::jsonb,              -- [{kind, storage_path, sha256, generated_at}]
  nic_registration jsonb not null default '{"status":"not_required"}'::jsonb, -- {status, reference, submitted_at, provider}
  notes text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.issuance_jobs is
  'One per policy created after payment: how it is issued (delegated by Covva, insurer portal, API adapter), the rule outcome, generated documents (with sha256), the L2 review window and NIC motor-database registration status.';
create index if not exists issuance_jobs_insurer_idx on public.issuance_jobs (insurer_org_id, status);
create index if not exists issuance_jobs_review_idx on public.issuance_jobs (review_until) where status = 'review_window';
create index if not exists issuance_jobs_status_idx on public.issuance_jobs (status) where status in ('queued', 'generating', 'failed');

-- ---------------------------------------------------------------------------
-- 3. SLA timers with escalation
-- ---------------------------------------------------------------------------
create table if not exists public.sla_timers (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('request', 'submission', 'issuance', 'claim')),
  subject_id uuid not null,
  insurer_org_id uuid references public.organizations (id),
  broker_org_id uuid references public.organizations (id),
  started_at timestamptz not null default now(),
  due_at timestamptz not null,
  escalated_at timestamptz,
  breached_at timestamptz,
  resolved_at timestamptz,
  escalation_level int not null default 0 check (escalation_level between 0 and 3),
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.sla_timers is
  'Per-insurer/product SLA timers (Addendum 2 A). Level 1 at due (insurer contacts), 2 at due + 50% (Covva ops), 3 = final breach at 2× due (customer chooses refund or re-route). One open timer per subject.';
create unique index if not exists sla_timers_one_open_per_subject on public.sla_timers (subject_type, subject_id) where resolved_at is null;
create index if not exists sla_timers_due_idx on public.sla_timers (due_at) where resolved_at is null;
create index if not exists sla_timers_insurer_idx on public.sla_timers (insurer_org_id) where insurer_org_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Policies: verification code (QR) and sticker number; requests: SLA choice
-- ---------------------------------------------------------------------------
alter table public.policies add column if not exists verification_code text;
alter table public.policies add column if not exists sticker_number text;
create unique index if not exists policies_verification_code_key on public.policies (verification_code);
comment on column public.policies.verification_code is 'Random 10-char Crockford base32 code printed as a QR on generated documents; verify_policy(p_code) looks it up without exposing customer data.';
comment on column public.policies.sticker_number is 'Motor insurance sticker number (NIC motor database) when registered.';

alter table public.requests add column if not exists sla_choice text check (sla_choice is null or sla_choice in ('refund', 'reroute'));
alter table public.requests add column if not exists sla_choice_at timestamptz;
comment on column public.requests.sla_choice is 'Customer''s choice after a final SLA breach: automatic refund or re-route to another insurer/broker (Addendum 2 A).';

-- Crockford base32 (no I, L, O, U) from gen_random_bytes.
create or replace function private.random_base32(p_len int default 10) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(greatest(p_len, 1));
  v_out text := '';
  i int;
begin
  for i in 0 .. greatest(p_len, 1) - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_out;
end $$;

create or replace function private.policies_verification_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_try int := 0;
begin
  if new.verification_code is null then
    loop
      new.verification_code := private.random_base32(10);
      exit when not exists (select 1 from public.policies p where p.verification_code = new.verification_code);
      v_try := v_try + 1;
      exit when v_try > 5;
    end loop;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'policies_verification_code' and tgrelid = 'public.policies'::regclass) then
    create trigger policies_verification_code before insert on public.policies
      for each row execute function private.policies_verification_code();
  end if;
end $$;
-- Existing policies get a code too (the migration runs as a privileged role, so the guard allows it).
update public.policies set verification_code = private.random_base32(10) where verification_code is null;

-- ---------------------------------------------------------------------------
-- 5. Insurer-direct submissions: no broker of record
-- ---------------------------------------------------------------------------
alter table public.insurer_submissions alter column broker_org_id drop not null;
comment on column public.insurer_submissions.broker_org_id is 'Broker of record; null only for an insurer-direct order (order_routing.mode = insurer_direct), where the insurer quotes and issues directly.';

create or replace function private.request_is_insurer_direct(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.order_routing x where x.request_id = p_request and x.mode = 'insurer_direct');
$$;

create or replace function private.insurer_submissions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.broker_org_id is null and not private.request_is_insurer_direct(new.request_id) then
    raise exception 'A submission needs a broker of record unless the order is routed directly to the insurer' using errcode = 'P0001';
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'insurer_submissions_guard' and tgrelid = 'public.insurer_submissions'::regclass) then
    create trigger insurer_submissions_guard before insert or update on public.insurer_submissions
      for each row execute function private.insurer_submissions_guard();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Housekeeping: updated_at + audit on the new tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['issuance_jobs', 'sla_timers'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
  end loop;
  foreach t in array array['policy_number_blocks', 'issuance_jobs', 'sla_timers'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.policy_number_blocks enable row level security;
alter table public.issuance_jobs enable row level security;
alter table public.sla_timers enable row level security;

-- Number blocks: the insurer (owners/admins/underwriters) and staff read; owners/admins manage
-- their own blocks; staff manage all. Customers and brokers see nothing.
select private.ensure_policy('policy_number_blocks', 'number blocks: insurer reads own', $p$
  create policy "number blocks: insurer reads own" on public.policy_number_blocks for select to authenticated
  using ((select private.is_platform_staff()) or private.has_org_role(insurer_org_id, '{owner,admin,underwriter,finance}'))$p$);
select private.ensure_policy('policy_number_blocks', 'number blocks: insurer admins manage own', $p$
  create policy "number blocks: insurer admins manage own" on public.policy_number_blocks for all to authenticated
  using (private.has_org_role(insurer_org_id, '{owner,admin}'))
  with check (private.has_org_role(insurer_org_id, '{owner,admin}'))$p$);
select private.ensure_policy('policy_number_blocks', 'number blocks: staff manage', $p$
  create policy "number blocks: staff manage" on public.policy_number_blocks for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- Issuance jobs: the insurer reads its own; staff read and write all; everything else is
-- written by trusted server code (service role). Customers never read jobs (they see documents).
select private.ensure_policy('issuance_jobs', 'issuance jobs: insurer reads own', $p$
  create policy "issuance jobs: insurer reads own" on public.issuance_jobs for select to authenticated
  using ((select private.is_platform_staff()) or insurer_org_id in (select private.user_org_ids()))$p$);
select private.ensure_policy('issuance_jobs', 'issuance jobs: insurer underwriters update own', $p$
  create policy "issuance jobs: insurer underwriters update own" on public.issuance_jobs for update to authenticated
  using (private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'))
  with check (private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'))$p$);
select private.ensure_policy('issuance_jobs', 'issuance jobs: staff manage', $p$
  create policy "issuance jobs: staff manage" on public.issuance_jobs for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- SLA timers: the insurer / broker named on the timer and staff read; the customer reads the
-- timers of their own request or policy (to show "Expected by …"); writes are server-side.
select private.ensure_policy('sla_timers', 'sla timers: parties read', $p$
  create policy "sla timers: parties read" on public.sla_timers for select to authenticated
  using (
    (select private.is_platform_staff())
    or insurer_org_id in (select private.user_org_ids())
    or broker_org_id in (select private.user_org_ids())
    or (subject_type = 'request' and private.can_access_request(subject_id))
    or (subject_type = 'issuance' and private.can_access_policy(subject_id))
  )$p$);
select private.ensure_policy('sla_timers', 'sla timers: staff manage', $p$
  create policy "sla timers: staff manage" on public.sla_timers for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))$p$);

-- ---------------------------------------------------------------------------
-- 8. Public verification RPC (anon-callable; returns only non-personal fields)
-- ---------------------------------------------------------------------------
create or replace function public.verify_policy(p_code text default null, p_insurer text default null, p_policy_number text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy record;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_valid boolean;
  v_today date := current_date;
begin
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
comment on function public.verify_policy(text, text, text) is
  'Public policy check (QR code or insurer slug + policy number). Returns only {valid, status, insurer_name, category_name, cover_start, cover_end, policy_number_masked}; never customer data. Rate-limited by the API layer.';
grant execute on function public.verify_policy(text, text, text) to anon, authenticated, service_role;

grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;
