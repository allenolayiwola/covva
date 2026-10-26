-- =============================================================================
-- Backend stream support: usage metering details, idempotency for post-payment
-- policy creation, column guards that close gaps in customer UPDATE policies,
-- supporting indexes and AI model settings.
-- =============================================================================

-- Usage metering: policy_active is recorded once per policy per month with a
-- derived reference_id; keep the policy id and period alongside for billing.
alter table public.usage_events add column if not exists details jsonb not null default '{}'::jsonb;

-- At most one live policy per accepted quote (payment webhook + verify can race).
create unique index if not exists policies_one_per_quote
  on public.policies (quote_id)
  where quote_id is not null and status <> 'cancelled';

-- Supporting indexes ---------------------------------------------------------------
create index if not exists device_tokens_user_idx on public.device_tokens (user_id);
create index if not exists documents_claim_idx on public.documents (claim_id);
create index if not exists payments_application_idx on public.payments (application_id);
create index if not exists payments_request_idx on public.payments (request_id);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists quotes_ready_expiry_idx on public.quotes (valid_until) where status = 'ready_to_accept';
create index if not exists policies_active_end_idx on public.policies (cover_end) where status = 'active';
create index if not exists requests_sla_idx on public.requests (due_at) where sla_breached_at is null;

-- Profiles: KYC status is set only by platform staff / trusted server code ---------
-- ("profiles: update self" allows any column, including kyc_status.)
create or replace function private.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_service_role() or private.is_platform_staff() then
    return new;
  end if;
  if new.kyc_status is distinct from old.kyc_status or new.kyc_verified_at is distinct from old.kyc_verified_at then
    raise exception 'Identity verification status is set by the platform after review' using errcode = 'P0001';
  end if;
  if old.kyc_status = 'verified' and new.ghana_card_number is distinct from old.ghana_card_number then
    raise exception 'Your Ghana Card has been verified. Contact support to change it.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function private.profiles_guard();

-- Requests: customers may only edit their own risk details and make the status
-- moves the status machine allows them ("requests: customer edits while waiting on
-- them" allows any column). Fires after requests_before (alphabetical order).
create or replace function private.requests_customer_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_allowed text[] := array['status', 'risk_data', 'risk_fingerprint', 'title', 'cancelled_reason', 'next_step',
                            'updated_at', 'submitted_at', 'due_at', 'completed_at'];
begin
  if private.is_service_role() or private.is_platform_staff() or private.is_org_member(old.broker_org_id) then
    return new;
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'You can only change the details of your own request' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
    or (old.status = 'awaiting_customer_info' and new.status in ('adviser_action', 'cancelled'))
    or (old.status = 'quotes_ready' and new.status in ('adviser_action', 'cancelled'))
  ) then
    raise exception 'That status change is not allowed (% to %)', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger requests_customer_guard before update on public.requests
  for each row execute function private.requests_customer_guard();

-- Claims: customers may edit reporting details only while draft/reported, and may
-- not touch decision fields ("claims: parties update" allows any column and
-- claims_guard returns early when status is unchanged). Fires before claims_guard.
create or replace function private.claims_customer_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_details text[] := array['description', 'location', 'incident_type', 'incident_at', 'amount_claimed', 'third_parties'];
  v_allowed text[] := v_details || array['status', 'updated_at', 'reported_at'];
begin
  if private.is_service_role() or private.is_platform_staff()
     or private.is_org_member(new.insurer_org_id) or private.is_org_member(new.broker_org_id) then
    return new;
  end if;
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'Customers can only update the details of a claim they reported' using errcode = 'P0001';
  end if;
  if old.status not in ('draft', 'reported')
     and (to_jsonb(new) - (array['status', 'updated_at', 'reported_at'])) is distinct from (to_jsonb(old) - (array['status', 'updated_at', 'reported_at'])) then
    raise exception 'Claim details can no longer be changed here. Send updates to your broker.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger claims_customer_columns before update on public.claims
  for each row execute function private.claims_customer_columns();

grant execute on all functions in schema private to authenticated, service_role;

-- AI model routing (Vercel AI Gateway ids), admin-overridable --------------------
insert into public.platform_settings (key, value, description) values
  ('ai_models', '{"default":"anthropic/claude-sonnet-5.5","fast":"anthropic/claude-haiku-5.5","vision":"anthropic/claude-sonnet-5.5"}',
   'AI Gateway model ids per tier (default, fast, vision). Env AI_DEFAULT_MODEL / AI_FAST_MODEL apply when unset.')
on conflict (key) do nothing;
