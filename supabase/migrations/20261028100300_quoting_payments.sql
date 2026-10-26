-- Phase 1 — fast quoting, sharing, more payment channels, renewals (additive; no drops, no deletes).
--
-- * vehicle_lookups          — cached registration lookups (DVLA / manual) used to prefill motor quotes.
-- * kyc_verifications        — provider hook: provider ('manual' | 'nia'), checked_at.
-- * quote_shares             — "save & share" tokens for a read-only public comparison page (/q/<token>).
-- * payments.channel_detail  — bank-transfer instructions / reference; provider check constraint
--                              ('paystack' | 'hubtel' | 'simulator' | 'bank_transfer').
-- * payment_accounts         — Paystack dedicated virtual accounts (one per customer and provider).
-- * policies.underinsurance_flag — { reason, suggested_sum_insured, at } set by the policy-lifecycle cron.
-- * profiles.whatsapp_opt_in — WhatsApp notifications opt-in (renewal reminders, quote links).
-- * notifications.channels   — text[] without a check constraint; 'whatsapp' is now a valid value (documented).
-- * requests.talk_to_expert  — already settable by customers on their own requests (routing_engine migration
--                              added it to private.requests_customer_guard's allowed columns).

-- ---------------------------------------------------------------------------
-- 1. Vehicle lookups
-- ---------------------------------------------------------------------------
create table if not exists public.vehicle_lookups (
  id uuid primary key default gen_random_uuid(),
  registration text not null unique,
  source text not null default 'manual',
  data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.vehicle_lookups is 'Vehicle data by normalised registration (no owner PII): { make, model, year, body, colour, chassis_last4, engine_cc, seats, use }. Written by the server only.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_lookups_source_check') then
    alter table public.vehicle_lookups add constraint vehicle_lookups_source_check check (source in ('dvla', 'manual', 'cache'));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.vehicle_lookups'::regclass) then
    create trigger set_updated_at before update on public.vehicle_lookups for each row execute function private.set_updated_at();
  end if;
end $$;
create index if not exists vehicle_lookups_expires_idx on public.vehicle_lookups (expires_at);

alter table public.vehicle_lookups enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'vehicle lookups: authenticated read') then
    create policy "vehicle lookups: authenticated read" on public.vehicle_lookups for select to authenticated using (true);
  end if;
end $$;
-- No insert/update/delete policies: only the service role writes lookups.

-- ---------------------------------------------------------------------------
-- 2. KYC provider hook
-- ---------------------------------------------------------------------------
alter table public.kyc_verifications add column if not exists checked_at timestamptz;
comment on column public.kyc_verifications.checked_at is 'When the identity provider (NIA) returned a result; null for manual review.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kyc_verifications_provider_check') then
    alter table public.kyc_verifications add constraint kyc_verifications_provider_check
      check (provider is null or provider in ('manual', 'nia'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Quote shares (save & share, resume later)
-- ---------------------------------------------------------------------------
create table if not exists public.quote_shares (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests (id) on delete cascade,
  quote_id uuid references public.quotes (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  channel text not null default 'link',
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days',
  viewed_at timestamptz,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint quote_shares_target_check check (request_id is not null or quote_id is not null)
);
comment on table public.quote_shares is 'Signed share tokens for a saved comparison. The public page (/q/<token>) exposes quote summaries only — never the customer''s identity.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_shares_channel_check') then
    alter table public.quote_shares add constraint quote_shares_channel_check check (channel in ('link', 'whatsapp', 'email'));
  end if;
end $$;
create index if not exists quote_shares_request_idx on public.quote_shares (request_id, created_at desc);
create index if not exists quote_shares_owner_idx on public.quote_shares (created_by, created_at desc);

alter table public.quote_shares enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'quote shares: owner read') then
    create policy "quote shares: owner read" on public.quote_shares for select to authenticated
      using (created_by = (select auth.uid()) or (select private.is_platform_staff()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'quote shares: owner creates for own request') then
    create policy "quote shares: owner creates for own request" on public.quote_shares for insert to authenticated
      with check (
        created_by = (select auth.uid())
        and (request_id is null or exists (select 1 from public.requests r where r.id = request_id and r.customer_id = (select auth.uid())))
        and (quote_id is null or exists (select 1 from public.quotes q join public.requests r on r.id = q.request_id where q.id = quote_id and r.customer_id = (select auth.uid())))
      );
  end if;
end $$;
-- Anonymous visitors never read quote_shares directly: the public page resolves the token with the service client.

-- ---------------------------------------------------------------------------
-- 4. Payments: bank transfer detail, provider check
-- ---------------------------------------------------------------------------
alter table public.payments add column if not exists channel_detail jsonb;
comment on column public.payments.channel_detail is 'Channel-specific instructions, e.g. bank transfer { bank, account_name, account_number, reference, kind: insurer_account | paystack_dva }.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_provider_check') then
    alter table public.payments add constraint payments_provider_check
      check (provider in ('paystack', 'hubtel', 'simulator', 'bank_transfer'));
  end if;
end $$;

-- Dedicated virtual accounts (Paystack DVA) — one per customer and provider; the account belongs to the
-- platform's Paystack business only as a collection endpoint and transactions still settle to the insurer.
create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'paystack',
  provider_customer_code text,
  account_number text not null,
  account_name text,
  bank_name text,
  currency char(3) not null default 'GHS',
  active boolean not null default true,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, provider)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_accounts_provider_check') then
    alter table public.payment_accounts add constraint payment_accounts_provider_check check (provider in ('paystack', 'hubtel'));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'public.payment_accounts'::regclass) then
    create trigger set_updated_at before update on public.payment_accounts for each row execute function private.set_updated_at();
  end if;
end $$;
alter table public.payment_accounts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'payment accounts: own read') then
    create policy "payment accounts: own read" on public.payment_accounts for select to authenticated
      using (customer_id = (select auth.uid()) or (select private.is_platform_staff()));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Policies: underinsurance nudge
-- ---------------------------------------------------------------------------
alter table public.policies add column if not exists underinsurance_flag jsonb;
comment on column public.policies.underinsurance_flag is 'Set by the policy-lifecycle cron when sum_insured is well below the declared/current value: { reason, suggested_sum_insured, current_value, at }. Null when fine.';

-- ---------------------------------------------------------------------------
-- 6. WhatsApp opt-in
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists whatsapp_opt_in boolean not null default false;
comment on column public.profiles.whatsapp_opt_in is 'Customer agreed to receive WhatsApp messages (renewal reminders, quote links) on their profile phone number.';
comment on column public.notifications.channels is 'Delivery channels requested: in_app | push | email | sms | whatsapp.';
