-- =============================================================================
-- Policy explainer (Addendum 6.3, roadmap Phase 4)
--
-- * policy_explainer_summaries — "Your cover in plain words", generated once per policy and wording
--                                version (wording_hash = @im/core buildGrounding().versionKey) so it is
--                                not regenerated on every view. Written by the server (service role).
-- * policy_explainer_logs      — minimal Q&A log for quality review: the redacted question, the answer
--                                statements, the clause ids cited / dropped, whether it was handed to the
--                                broker. Written by the server (service role). No prompts, no wording.
--
-- Who can read:
--   summaries: the policyholder side of the policy (customer, sponsor, linked beneficiary) and platform
--              staff. Brokers and insurers read none (they have the wording itself).
--   logs:      the user who asked (own rows only) and platform staff.
--
-- Retention: explainer logs are personal data (Act 843). They must join the data-subject request and
-- retention configuration being built separately (proposal: delete after 180 days; summaries follow the
-- policy). Nothing here deletes data.
--
-- Additive and idempotent: create if not exists / create or replace / guarded policies. No drops.
-- NOT applied by CI or by the PR author; apply it with the normal migration process.
-- =============================================================================

create or replace function private.ensure_policy(p_table text, p_name text, p_sql text) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.policy_explainer_summaries (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies (id) on delete cascade,
  product_version_id uuid references public.product_versions (id) on delete set null,
  wording_hash text not null check (wording_hash ~ '^[0-9a-f]{16}$'),
  summary jsonb not null check (jsonb_typeof(summary) = 'array'),
  model text check (model is null or length(model) <= 200),
  created_at timestamptz not null default now(),
  unique (policy_id, wording_hash)
);
comment on table public.policy_explainer_summaries is 'Cached "Your cover in plain words" per policy and wording version (wording_hash). Each point cites clause ids from the grounding set, validated server-side. Written by the server only.';
comment on column public.policy_explainer_summaries.wording_hash is '@im/core buildGrounding().versionKey: changes when the schedule or wording changes, which triggers a new summary.';
comment on column public.policy_explainer_summaries.summary is 'Array of { text, citations: [{ id, heading, group, text, quote }] } after citation validation.';

create table if not exists public.policy_explainer_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  policy_id uuid not null references public.policies (id) on delete cascade,
  wording_hash text not null check (wording_hash ~ '^[0-9a-f]{16}$'),
  question text not null check (length(question) between 1 and 1000),
  classification text not null check (classification in ('factual', 'advisory')),
  outcome text not null check (outcome in ('answered', 'not_in_wording', 'clauses_only', 'error')),
  answer_text text check (answer_text is null or length(answer_text) <= 4000),
  cited_ids text[] not null default '{}',
  dropped_ids text[] not null default '{}',
  ai_assisted boolean not null default false,
  model text check (model is null or length(model) <= 200),
  handoff_request_id uuid references public.requests (id) on delete set null,
  handoff_message_id uuid references public.request_messages (id) on delete set null,
  handed_off_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.policy_explainer_logs is 'Policy explainer Q&A log for quality review. Question is PII-redacted and truncated; no prompt or wording is stored. RETENTION: must join the Act 843 retention config (proposal 180 days) — not deleted by this migration.';
comment on column public.policy_explainer_logs.dropped_ids is 'Citation ids the model returned that were not in the grounding set (removed before display).';
comment on column public.policy_explainer_logs.outcome is 'answered | not_in_wording (no supported answer; broker hand-off offered) | clauses_only (no AI on this environment: keyword matches shown) | error.';
create index if not exists policy_explainer_logs_user_idx on public.policy_explainer_logs (user_id, created_at desc);
create index if not exists policy_explainer_logs_policy_idx on public.policy_explainer_logs (policy_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Access helper: the policyholder side of a policy (not brokers, insurers or business admins)
-- ---------------------------------------------------------------------------
create or replace function private.is_policy_holder_side(p_policy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.policies p
     where p.id = p_policy and (
       p.customer_id = (select auth.uid())
       or p.sponsor_user_id = (select auth.uid())
       or (p.beneficiary_id is not null and private.is_beneficiary_user(p.beneficiary_id))
     )
  );
$$;
comment on function private.is_policy_holder_side(uuid) is 'True when the caller is the policy''s customer, its sponsor or its linked beneficiary.';
revoke execute on function private.is_policy_holder_side(uuid) from public, anon;
grant execute on function private.is_policy_holder_side(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS (read-only for users; the server writes with the service role)
-- ---------------------------------------------------------------------------
alter table public.policy_explainer_summaries enable row level security;
alter table public.policy_explainer_logs enable row level security;

select private.ensure_policy('policy_explainer_summaries', 'explainer summaries: policyholder side read', $p$
  create policy "explainer summaries: policyholder side read" on public.policy_explainer_summaries for select to authenticated
  using ((select private.is_policy_holder_side(policy_id)))
$p$);
select private.ensure_policy('policy_explainer_summaries', 'explainer summaries: staff read', $p$
  create policy "explainer summaries: staff read" on public.policy_explainer_summaries for select to authenticated
  using ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('policy_explainer_logs', 'explainer logs: own read', $p$
  create policy "explainer logs: own read" on public.policy_explainer_logs for select to authenticated
  using (user_id = (select auth.uid()))
$p$);
select private.ensure_policy('policy_explainer_logs', 'explainer logs: staff read', $p$
  create policy "explainer logs: staff read" on public.policy_explainer_logs for select to authenticated
  using ((select private.is_platform_staff()))
$p$);

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
revoke all on public.policy_explainer_summaries from anon;
revoke all on public.policy_explainer_logs from anon;
revoke insert, update, delete, truncate on public.policy_explainer_summaries from authenticated;
revoke insert, update, delete, truncate on public.policy_explainer_logs from authenticated;
grant select on public.policy_explainer_summaries to authenticated;
grant select on public.policy_explainer_logs to authenticated;
grant all on public.policy_explainer_summaries to service_role;
grant all on public.policy_explainer_logs to service_role;
