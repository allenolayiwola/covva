-- =============================================================================
-- Flows: team invitations, broker hand-over, externally bought policies,
-- partner webhook deliveries. Additive only (no drops).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Team invitations
-- ---------------------------------------------------------------------------
-- The invitee cannot read `invitations` (org-admin RLS) nor insert their own
-- `memberships` row, so both steps run as SECURITY DEFINER functions keyed by
-- the invitation token (24 random bytes, sent by email).

-- Public preview of an invitation so the invite page can show the organisation
-- and role before the invitee signs in or signs up. Returns the invited email so
-- the sign-up form can be pre-filled; the token itself is the secret.
create or replace function public.invitation_preview(p_token text)
returns table (
  org_id uuid,
  org_name text,
  org_slug text,
  org_type public.org_type,
  email text,
  role public.member_role,
  team text,
  expires_at timestamptz,
  accepted_at timestamptz,
  invited_by_name text
)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.slug, o.type, i.email::text, i.role, i.team, i.expires_at, i.accepted_at,
         (select coalesce(p.preferred_name, p.full_name) from public.profiles p where p.id = i.invited_by)
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token and length(coalesce(p_token, '')) >= 16
  limit 1;
$$;
revoke execute on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- Accept an invitation as the signed-in user. Checks: token exists, not expired,
-- not already accepted, invited email = the caller's auth email (case-insensitive,
-- citext). Creates or reactivates the membership and marks the invitation accepted.
create or replace function public.accept_invitation(p_token text)
returns table (org_id uuid, org_slug text, org_type public.org_type, org_name text, role public.member_role)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_email extensions.citext;
  v_inv public.invitations;
  v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'Please sign in to accept this invitation' using errcode = 'P0001';
  end if;
  select u.email::extensions.citext into v_email from auth.users u where u.id = v_uid;

  select * into v_inv from public.invitations i where i.token = p_token for update;
  if v_inv.id is null then
    raise exception 'This invitation link is not valid' using errcode = 'P0001';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'This invitation has already been accepted' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'This invitation has expired. Ask your organisation admin to send a new one' using errcode = 'P0001';
  end if;
  if v_email is null or v_inv.email <> v_email then
    raise exception 'This invitation was sent to a different email address. Sign in with the address it was sent to' using errcode = 'P0001';
  end if;

  select * into v_org from public.organizations o where o.id = v_inv.org_id;
  if v_org.id is null or v_org.status = 'offboarded' then
    raise exception 'This organisation is no longer active on the platform' using errcode = 'P0001';
  end if;

  insert into public.memberships (org_id, user_id, role, team, active)
  values (v_inv.org_id, v_uid, v_inv.role, v_inv.team, true)
  on conflict (org_id, user_id) do update
    set active = true,
        role = excluded.role,
        team = coalesce(excluded.team, public.memberships.team);

  update public.invitations set accepted_at = now() where id = v_inv.id;

  return query select v_org.id, v_org.slug, v_org.type, v_org.name, v_inv.role;
end $$;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Broker hand-over (change of broker of record)
-- ---------------------------------------------------------------------------
-- Flow: the current broker's supervisor proposes a new broker (request_events
-- `broker_change_proposed` + a customer `review` task) → the customer records a
-- `broker_change` disclosure for the NEW broker (RLS policy from
-- 20261026130100_disclosure_scope already allows customers to insert that stage)
-- → the current broker's supervisor/owner/admin or platform staff completes it.
--
-- RLS lets the current broker update the request, but the WITH CHECK clause of
-- "requests: broker and staff manage" (defaults to USING) rejects a row whose new
-- broker_org_id is outside the caller's organisations. This SECURITY DEFINER
-- function performs the change after its own authorisation and consent checks.
-- The requests_before trigger still requires the broker_change disclosure.
create or replace function public.complete_broker_change(p_request uuid, p_broker_org_id uuid default null)
returns table (request_id uuid, reference text, from_broker_org_id uuid, to_broker_org_id uuid, to_broker_name text, customer_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_req public.requests;
  v_target uuid := p_broker_org_id;
  v_target_org public.organizations;
  v_allowed boolean;
begin
  select * into v_req from public.requests r where r.id = p_request for update;
  if v_req.id is null then
    raise exception 'Request not found' using errcode = 'P0001';
  end if;
  if v_req.status in ('completed', 'cancelled', 'closed_no_cover') then
    raise exception 'A closed request cannot be handed over' using errcode = 'P0001';
  end if;

  -- Who may complete: platform staff, the service role, or a supervisor/owner/admin
  -- (or a member flagged is_supervisor) of the CURRENT broker of record.
  v_allowed := private.is_service_role() or private.is_platform_staff() or (
    v_req.broker_org_id is not null and exists (
      select 1 from public.memberships m
      where m.user_id = v_uid and m.org_id = v_req.broker_org_id and m.active
        and (m.is_supervisor or m.role in ('owner', 'admin', 'supervisor'))
    )
  );
  if not v_allowed then
    raise exception 'Only a supervisor of the current broker of record or platform staff can complete a hand-over' using errcode = 'P0001';
  end if;

  -- Proposed broker: explicit argument, else the latest proposal on the timeline.
  if v_target is null then
    select nullif(e.data ->> 'target_broker_org_id', '')::uuid into v_target
    from public.request_events e
    where e.request_id = v_req.id and e.event = 'broker_change_proposed'
    order by e.created_at desc limit 1;
  end if;
  if v_target is null then
    raise exception 'No change of broker has been proposed on this request' using errcode = 'P0001';
  end if;
  if v_target = v_req.broker_org_id then
    raise exception 'That broker is already the broker of record' using errcode = 'P0001';
  end if;

  select * into v_target_org from public.organizations o where o.id = v_target;
  if v_target_org.id is null or v_target_org.type <> 'broker' or v_target_org.status <> 'active' then
    raise exception 'The proposed broker is not an active, licensed broker' using errcode = 'P0001';
  end if;

  -- Consent: the customer must have acknowledged a broker_change disclosure naming the new broker.
  if not exists (
    select 1 from public.broker_disclosures d
    where d.request_id = v_req.id and d.broker_org_id = v_target and d.stage = 'broker_change'
  ) then
    raise exception 'The customer has not yet confirmed the change of broker' using errcode = 'P0001';
  end if;

  update public.requests
     set broker_org_id = v_target, assigned_to = null, team = null,
         next_step = v_target_org.name || ' is now your broker of record and will pick up your request.'
   where id = v_req.id;

  insert into public.request_events (request_id, actor_id, actor_party, event, note, visible_to_customer, data)
  values (
    v_req.id, v_uid,
    case when private.is_platform_staff() then 'platform'::public.party else 'broker'::public.party end,
    'broker_changed',
    'Broker of record changed to ' || v_target_org.name || ' with the customer''s consent.',
    true,
    jsonb_build_object('from_broker_org_id', v_req.broker_org_id, 'to_broker_org_id', v_target)
  );

  -- Close the customer's confirmation task if it is still open.
  update public.request_tasks t
     set status = 'done', completed_at = coalesce(t.completed_at, now())
   where t.request_id = v_req.id and t.kind = 'review' and t.assignee_party = 'customer' and t.status = 'open'
     and t.title ilike '%broker%';

  return query select v_req.id, v_req.reference, v_req.broker_org_id, v_target, v_target_org.name, v_req.customer_id;
end $$;
revoke execute on function public.complete_broker_change(uuid, uuid) from public, anon;
grant execute on function public.complete_broker_change(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Policies bought elsewhere: insurer not on the platform
-- ---------------------------------------------------------------------------
alter table public.policies add column if not exists external_insurer_name text;
alter table public.policies alter column insurer_org_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'policies_insurer_required_unless_external') then
    alter table public.policies add constraint policies_insurer_required_unless_external
      check (external_source or insurer_org_id is not null);
  end if;
end $$;
comment on column public.policies.external_insurer_name is
  'Name of the insurer as typed by the customer for a policy bought elsewhere when the insurer is not on the platform (insurer_org_id null).';

-- ---------------------------------------------------------------------------
-- 4. Partner webhook deliveries
-- ---------------------------------------------------------------------------
alter table public.webhook_deliveries add column if not exists last_error text;
alter table public.webhook_deliveries add column if not exists response_ms int;
create index if not exists webhook_deliveries_due_idx
  on public.webhook_deliveries (next_attempt_at)
  where delivered_at is null and next_attempt_at is not null;
create index if not exists webhook_deliveries_endpoint_idx on public.webhook_deliveries (endpoint_id, created_at desc);
-- Deliveries are written only by trusted server code (service role); org admins read them (existing policy).

grant execute on all functions in schema private to authenticated, service_role;
