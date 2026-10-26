-- =============================================================================
-- Insurance Marketplace — core schema
-- Platform = technology provider. Broker of record = advice/arranging.
-- Insurer = underwriting, issuance, claims decisions. Payments settle to insurer.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_type as enum ('platform', 'broker', 'insurer', 'enterprise');
create type public.org_status as enum ('pending', 'active', 'suspended', 'offboarded');
create type public.member_role as enum (
  'owner', 'admin', 'supervisor', 'adviser', 'underwriter', 'claims_officer', 'finance', 'viewer',
  'platform_admin', 'platform_ops', 'compliance', 'support'
);
create type public.account_type as enum ('individual', 'business');
create type public.kyc_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type public.consent_type as enum ('terms', 'privacy', 'marketing', 'data_sharing_broker', 'data_sharing_insurer', 'ai_assistance');
create type public.category_availability as enum ('integrated', 'broker_assisted', 'planned');
create type public.product_status as enum ('draft', 'pending_approval', 'approved', 'suspended', 'retired');
create type public.request_type as enum ('new_cover', 'renewal', 'switch', 'endorsement', 'service');
create type public.request_status as enum (
  'draft', 'submitted', 'awaiting_customer_info', 'adviser_action', 'insurer_response',
  'quotes_ready', 'payment_confirmation', 'policy_documents', 'completed', 'cancelled', 'closed_no_cover'
);
create type public.request_source as enum ('web', 'mobile', 'whatsapp', 'call_centre', 'admin', 'api');
create type public.task_kind as enum ('document', 'information', 'review', 'payment', 'signature');
create type public.task_status as enum ('open', 'done', 'cancelled');
create type public.party as enum ('customer', 'broker', 'insurer', 'platform', 'system', 'ai');
create type public.submission_status as enum ('pending', 'sent', 'acknowledged', 'quoted', 'declined', 'error', 'withdrawn');
create type public.integration_level as enum ('portal', 'quote_api', 'policy_api');
create type public.quote_status as enum ('estimate', 'awaiting_underwriting', 'ready_to_accept', 'accepted', 'expired', 'declined', 'withdrawn');
create type public.application_status as enum ('draft', 'submitted', 'accepted', 'rejected', 'withdrawn');
create type public.payment_status as enum ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'reversed', 'abandoned');
create type public.payment_channel as enum ('mobile_money', 'card', 'bank_transfer', 'ussd');
create type public.policy_status as enum ('pending_issuance', 'active', 'lapsed', 'cancelled', 'expired', 'renewed');
create type public.document_kind as enum (
  'id_document', 'vehicle_registration', 'drivers_licence', 'photo', 'proof_of_address', 'medical',
  'policy_schedule', 'certificate', 'policy_wording', 'receipt', 'endorsement', 'claim_evidence',
  'police_report', 'invoice', 'other'
);
create type public.claim_status as enum (
  'draft', 'reported', 'delivered_to_insurer', 'acknowledged', 'under_assessment', 'info_requested',
  'approved', 'partially_approved', 'rejected', 'paid', 'closed', 'withdrawn'
);
create type public.complaint_status as enum ('open', 'acknowledged', 'investigating', 'resolved', 'escalated_nic', 'closed');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled');
create type public.invoice_status as enum ('draft', 'issued', 'paid', 'void', 'overdue');
create type public.lead_kind as enum ('customer', 'broker', 'insurer', 'enterprise', 'press', 'other');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.is_service_role() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role'
      or current_user in ('postgres', 'supabase_admin', 'service_role');
$$;

-- ---------------------------------------------------------------------------
-- Organisations & people
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  type public.org_type not null,
  status public.org_status not null default 'pending',
  name text not null,
  slug text not null unique,
  legal_name text,
  registration_number text,
  nic_licence_number text,
  nic_licence_class text,
  nic_licence_expires_on date,
  licence_verified_at timestamptz,
  licence_verified_by uuid,
  professional_indemnity_expires_on date,
  logo_url text,
  brand_color text,
  website text,
  contact_email extensions.citext,
  contact_phone text,
  address text,
  region text,
  description text,
  paystack_subaccount_code text,
  integration_level public.integration_level,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.organizations (type, status);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  preferred_name text,
  email extensions.citext,
  phone text,
  account_type public.account_type not null default 'individual',
  business_name text,
  date_of_birth date,
  ghana_card_number text,
  kyc_status public.kyc_status not null default 'unverified',
  kyc_verified_at timestamptz,
  region text,
  city text,
  locale text not null default 'en-GH',
  avatar_url text,
  notification_prefs jsonb not null default '{"email": true, "sms": true, "push": true, "whatsapp": false}'::jsonb,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  team text,
  title text,
  is_supervisor boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on public.memberships (user_id) where active;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  role public.member_role not null,
  team text,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users (id),
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.consent_type not null,
  version text not null,
  granted boolean not null,
  context text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index on public.consents (user_id, type, created_at desc);

create table public.kyc_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  method text not null default 'ghana_card',
  id_number text,
  status public.kyc_status not null default 'pending',
  provider text,
  provider_reference text,
  result jsonb,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access helpers (security definer, private schema)
-- ---------------------------------------------------------------------------
create or replace function private.user_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and m.active and o.status <> 'offboarded';
$$;

create or replace function private.is_platform_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid()) and m.active and o.type = 'platform'
  );
$$;

create or replace function private.has_org_role(p_org uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.org_id = p_org and m.active and m.role = any (p_roles)
  );
$$;

create or replace function private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org is not null and exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.org_id = p_org and m.active
  );
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_description text,
  description text,
  icon text,
  segment text not null default 'personal', -- personal | business | specialist
  availability public.category_availability not null default 'planned',
  sort_order int not null default 100,
  -- launch gate: insurer_panel, data_owner, approved_wording, quote_method, payment_route, issuance_process, claims_procedure
  launch_checklist jsonb not null default '{}'::jsonb,
  risk_schema jsonb not null default '[]'::jsonb,   -- form fields for quotation (shared with mobile)
  required_documents public.document_kind[] not null default '{}',
  regulatory_note text,
  default_sla_hours int not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  insurer_org_id uuid not null references public.organizations (id) on delete restrict,
  category_id uuid not null references public.product_categories (id) on delete restrict,
  name text not null,
  code text not null,
  tier text,
  summary text,
  status public.product_status not null default 'draft',
  current_version_id uuid,
  data_owner_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (insurer_org_id, code)
);
create index on public.products (category_id, status);

create table public.product_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  version int not null,
  status public.product_status not null default 'draft',
  coverage jsonb not null default '[]'::jsonb,          -- [{key,label,included,detail}]
  limits jsonb not null default '{}'::jsonb,            -- {sum_insured, third_party_property, ...}
  excesses jsonb not null default '{}'::jsonb,          -- {own_damage: 1000, ...}
  exclusions text[] not null default '{}',
  key_exclusion text,
  waiting_period_days int not null default 0,
  optional_benefits jsonb not null default '[]'::jsonb, -- [{key,label,premium}]
  conditions text,
  claims_process text,
  rating jsonb not null default '{}'::jsonb,            -- quoting engine rules (see packages/core)
  wording_url text,
  effective_from date not null default current_date,
  effective_to date,
  submitted_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  insurer_approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (product_id, version)
);
alter table public.products
  add constraint products_current_version_fk foreign key (current_version_id) references public.product_versions (id) on delete set null;

create table public.insurer_broker_appointments (
  id uuid primary key default gen_random_uuid(),
  insurer_org_id uuid not null references public.organizations (id) on delete cascade,
  broker_org_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid references public.product_categories (id) on delete cascade,
  active boolean not null default true,
  agreement_reference text,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  unique (insurer_org_id, broker_org_id, category_id)
);

create table public.broker_routing_rules (
  id uuid primary key default gen_random_uuid(),
  broker_org_id uuid not null references public.organizations (id) on delete cascade,
  category_id uuid not null references public.product_categories (id) on delete cascade,
  priority int not null default 100,
  is_secondary boolean not null default false,
  regions text[] not null default '{}',
  segments text[] not null default '{}',
  daily_capacity int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broker_org_id, category_id)
);

-- ---------------------------------------------------------------------------
-- Needs assessment & recommendations
-- ---------------------------------------------------------------------------
create table public.needs_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  anonymous_id text,
  answers jsonb not null default '{}'::jsonb,
  suggested_categories jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Requests: the core operational object
-- ---------------------------------------------------------------------------
create sequence public.request_ref_seq start 1001;
create sequence public.claim_ref_seq start 501;
create sequence public.complaint_ref_seq start 101;
create sequence public.policy_ref_seq start 10001;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('REQ-' || nextval('public.request_ref_seq')::text),
  customer_id uuid not null references auth.users (id) on delete restrict,
  business_org_id uuid references public.organizations (id),
  category_id uuid not null references public.product_categories (id),
  type public.request_type not null default 'new_cover',
  status public.request_status not null default 'draft',
  source public.request_source not null default 'web',
  title text,
  broker_org_id uuid references public.organizations (id),
  assigned_to uuid references auth.users (id),
  team text,
  risk_data jsonb not null default '{}'::jsonb,
  risk_fingerprint text,
  needs_assessment_id uuid references public.needs_assessments (id),
  related_policy_id uuid,
  needs_adviser_review boolean not null default false,
  priority int not null default 3,
  due_at timestamptz,
  sla_breached_at timestamptz,
  next_step text,
  submitted_at timestamptz,
  completed_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.requests (customer_id, created_at desc);
create index on public.requests (broker_org_id, status, due_at);
create index on public.requests (category_id);

create table public.broker_disclosures (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  broker_org_id uuid not null references public.organizations (id),
  shown_to uuid not null references auth.users (id),
  method text not null default 'in_app',   -- in_app | sms | email | call
  disclosure_text text not null,
  stage text not null default 'before_application', -- before_advice | before_application | broker_change
  acknowledged_at timestamptz not null default now()
);
create index on public.broker_disclosures (request_id);

create table public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests (id) on delete cascade,
  actor_id uuid references auth.users (id),
  actor_party public.party not null default 'system',
  event text not null,                 -- status_changed | assigned | note | document_uploaded | ...
  from_status public.request_status,
  to_status public.request_status,
  note text,
  visible_to_customer boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.request_events (request_id, created_at);

create table public.request_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  kind public.task_kind not null,
  title text not null,
  detail text,
  document_kind public.document_kind,
  assignee_party public.party not null default 'customer',
  assigned_to uuid references auth.users (id),
  status public.task_status not null default 'open',
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index on public.request_tasks (request_id, status);

create table public.request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  sender_id uuid references auth.users (id),
  sender_party public.party not null,
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  internal boolean not null default false,  -- broker-internal notes never shown to customers
  read_by_customer_at timestamptz,
  read_by_broker_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.request_messages (request_id, created_at);

create table public.recommendation_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests (id) on delete cascade,
  needs_assessment_id uuid references public.needs_assessments (id) on delete cascade,
  inputs jsonb not null,
  products_considered jsonb not null,
  insurers_compared int not null default 0,
  criteria jsonb not null,
  scores jsonb not null,
  labels jsonb not null default '{}'::jsonb,
  explanation text,
  material_exclusions jsonb not null default '[]'::jsonb,
  engine_version text not null,
  ai_model text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Insurer submissions (dedupe registry) and quotes
-- ---------------------------------------------------------------------------
create table public.insurer_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  insurer_org_id uuid not null references public.organizations (id),
  broker_org_id uuid not null references public.organizations (id),
  risk_fingerprint text not null,
  channel public.integration_level not null default 'portal',
  status public.submission_status not null default 'pending',
  sent_at timestamptz,
  response_due_at timestamptz,
  responded_at timestamptz,
  external_reference text,
  decline_reason text,
  idempotency_key text unique,
  submitted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Spec: prevent duplicate submissions of the same risk to the same insurer.
create unique index insurer_submissions_no_duplicates
  on public.insurer_submissions (risk_fingerprint, insurer_org_id)
  where status not in ('declined', 'error', 'withdrawn');

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  submission_id uuid references public.insurer_submissions (id) on delete set null,
  insurer_org_id uuid not null references public.organizations (id),
  broker_org_id uuid references public.organizations (id),
  product_id uuid references public.products (id),
  product_version_id uuid references public.product_versions (id),
  status public.quote_status not null default 'estimate',
  is_binding boolean not null default false,
  currency char(3) not null default 'GHS',
  premium numeric(14, 2) not null check (premium >= 0),
  taxes numeric(14, 2) not null default 0,
  fees numeric(14, 2) not null default 0,
  billing_period text not null default 'year',
  sum_insured numeric(14, 2),
  excess numeric(14, 2),
  limits jsonb not null default '{}'::jsonb,
  excesses jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '[]'::jsonb,
  exclusions text[] not null default '{}',
  key_exclusion text,
  waiting_period_days int not null default 0,
  optional_benefits jsonb not null default '[]'::jsonb,
  conditions text,
  assumptions jsonb not null default '{}'::jsonb,
  valid_until timestamptz,
  paid_placement boolean not null default false,
  commission_disclosure text,
  broker_note text,
  prepared_by uuid references auth.users (id),
  revalidated_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.quotes (request_id, status);

-- ---------------------------------------------------------------------------
-- Applications, payments, policies
-- ---------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  quote_id uuid not null references public.quotes (id),
  customer_id uuid not null references auth.users (id),
  status public.application_status not null default 'draft',
  declarations jsonb not null default '{}'::jsonb,
  selected_benefits jsonb not null default '[]'::jsonb,
  terms_accepted_at timestamptz,
  terms_version text,
  disclosure_id uuid references public.broker_disclosures (id),
  submitted_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications (id) on delete set null,
  request_id uuid not null references public.requests (id),
  quote_id uuid references public.quotes (id),
  policy_id uuid,
  customer_id uuid not null references auth.users (id),
  payee_org_id uuid not null references public.organizations (id), -- insurer: premiums never settle to platform
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null default 'GHS',
  provider text not null default 'paystack',
  provider_reference text unique,
  idempotency_key text not null unique,
  channel public.payment_channel,
  status public.payment_status not null default 'pending',
  settlement_subaccount text,
  authorization_url text,
  paid_at timestamptz,
  failure_reason text,
  reconciled boolean not null default false,
  reconciled_at timestamptz,
  reconciled_by uuid references auth.users (id),
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.payments (status, created_at desc);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  policy_number text,
  internal_reference text not null unique default ('POL-' || nextval('public.policy_ref_seq')::text),
  request_id uuid references public.requests (id),
  quote_id uuid references public.quotes (id),
  customer_id uuid not null references auth.users (id),
  insurer_org_id uuid not null references public.organizations (id),
  broker_org_id uuid references public.organizations (id),
  category_id uuid not null references public.product_categories (id),
  product_version_id uuid references public.product_versions (id),
  status public.policy_status not null default 'pending_issuance',
  nickname text,
  summary text,
  cover_start date,
  cover_end date,
  premium numeric(14, 2),
  currency char(3) not null default 'GHS',
  billing_period text not null default 'year',
  sum_insured numeric(14, 2),
  excess numeric(14, 2),
  insured_items jsonb not null default '{}'::jsonb,
  issued_at timestamptz,
  issued_by uuid references auth.users (id),
  cancelled_at timestamptz,
  cancellation_reason text,
  renewal_reminders_sent jsonb not null default '[]'::jsonb,
  external_source boolean not null default false, -- customer-uploaded policy bought elsewhere
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (insurer_org_id, policy_number)
);
create index on public.policies (customer_id, status);
create index on public.policies (broker_org_id, cover_end);
alter table public.requests add constraint requests_related_policy_fk foreign key (related_policy_id) references public.policies (id) on delete set null;
alter table public.payments add constraint payments_policy_fk foreign key (policy_id) references public.policies (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Documents (storage objects metadata)
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade, -- customer the document relates to
  uploaded_by uuid references auth.users (id),
  uploaded_by_party public.party not null default 'customer',
  request_id uuid references public.requests (id) on delete cascade,
  policy_id uuid references public.policies (id) on delete cascade,
  claim_id uuid,
  task_id uuid references public.request_tasks (id) on delete set null,
  kind public.document_kind not null default 'other',
  bucket text not null default 'documents',
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  checksum text,
  ai_extraction jsonb,
  verified boolean not null default false,
  verified_by uuid references auth.users (id),
  delivered_to_insurer_at timestamptz,  -- upload != insurer notification until delivery confirmed
  created_at timestamptz not null default now()
);
create index on public.documents (request_id);
create index on public.documents (policy_id);

-- ---------------------------------------------------------------------------
-- Claims & complaints
-- ---------------------------------------------------------------------------
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('CLM-' || nextval('public.claim_ref_seq')::text),
  policy_id uuid not null references public.policies (id),
  customer_id uuid not null references auth.users (id),
  insurer_org_id uuid not null references public.organizations (id),
  broker_org_id uuid references public.organizations (id),
  status public.claim_status not null default 'draft',
  incident_type text not null,
  incident_at timestamptz,
  location text,
  description text,
  amount_claimed numeric(14, 2),
  third_parties jsonb not null default '[]'::jsonb,
  required_evidence jsonb not null default '[]'::jsonb,
  completeness jsonb,
  insurer_reference text,
  reported_at timestamptz,
  delivered_to_insurer_at timestamptz,
  acknowledged_at timestamptz,
  decision_at timestamptz,
  decision_by uuid references auth.users (id),
  decision_amount numeric(14, 2),
  decision_note text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.claims (customer_id, created_at desc);
create index on public.claims (insurer_org_id, status);
alter table public.documents add constraint documents_claim_fk foreign key (claim_id) references public.claims (id) on delete cascade;

create table public.claim_events (
  id bigint generated always as identity primary key,
  claim_id uuid not null references public.claims (id) on delete cascade,
  actor_id uuid references auth.users (id),
  actor_party public.party not null default 'system',
  from_status public.claim_status,
  to_status public.claim_status,
  note text,
  visible_to_customer boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('CMP-' || nextval('public.complaint_ref_seq')::text),
  customer_id uuid not null references auth.users (id),
  request_id uuid references public.requests (id),
  policy_id uuid references public.policies (id),
  claim_id uuid references public.claims (id),
  against_party public.party not null default 'broker',
  owner_org_id uuid references public.organizations (id),
  assigned_to uuid references auth.users (id),
  category text not null,
  subject text not null,
  description text not null,
  desired_outcome text,
  status public.complaint_status not null default 'open',
  acknowledged_at timestamptz,
  due_at timestamptz not null default now() + interval '14 days',
  resolved_at timestamptz,
  outcome text,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.complaint_events (
  id bigint generated always as identity primary key,
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  actor_id uuid references auth.users (id),
  actor_party public.party not null default 'system',
  from_status public.complaint_status,
  to_status public.complaint_status,
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications & devices (mobile push)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  data jsonb not null default '{}'::jsonb,
  channels text[] not null default '{in_app}',
  delivered jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  provider text not null default 'expo' check (provider in ('expo', 'fcm', 'apns', 'webpush')),
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- SaaS: plans, subscriptions, usage, invoices, API keys, webhooks, connectors
-- ---------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  audience public.org_type not null,
  description text,
  currency char(3) not null default 'GHS',
  monthly_fee numeric(12, 2) not null default 0,
  included_seats int,
  included_requests int,
  per_request_fee numeric(12, 2) not null default 0,
  per_active_policy_fee numeric(12, 2) not null default 0,
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status public.subscription_status not null default 'trialing',
  current_period_start date not null default current_date,
  current_period_end date not null default (current_date + interval '1 month')::date,
  trial_ends_on date,
  provider_reference text,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subscriptions_one_live_per_org on public.subscriptions (org_id) where status in ('trialing', 'active', 'past_due');

create table public.usage_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  metric text not null,     -- request_processed | policy_active | ai_tokens | sms_sent | api_call
  quantity numeric not null default 1,
  reference_id uuid,
  occurred_at timestamptz not null default now(),
  unique (org_id, metric, reference_id)
);
create index on public.usage_events (org_id, metric, occurred_at);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  org_id uuid not null references public.organizations (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  currency char(3) not null default 'GHS',
  subtotal numeric(14, 2) not null default 0,
  tax numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  lines jsonb not null default '[]'::jsonb,
  status public.invoice_status not null default 'draft',
  issued_at timestamptz,
  due_on date,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  prefix text not null unique,
  key_hash text not null,
  scopes text[] not null default '{}',
  created_by uuid references auth.users (id),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  url text not null,
  secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  events text[] not null default '{}',
  active boolean not null default true,
  last_delivery_at timestamptz,
  last_status int,
  created_at timestamptz not null default now()
);

create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status int,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.connector_configs (
  id uuid primary key default gen_random_uuid(),
  insurer_org_id uuid not null references public.organizations (id) on delete cascade,
  level public.integration_level not null default 'portal',
  base_url text,
  auth_type text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'inactive',
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (insurer_org_id)
);

-- ---------------------------------------------------------------------------
-- AI
-- ---------------------------------------------------------------------------
create table public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,
  request_id uuid references public.requests (id) on delete cascade,
  surface text not null default 'customer_assistant',
  title text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  org_id uuid references public.organizations (id) on delete set null,
  feature text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6),
  latency_ms int,
  success boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.ai_usage (created_at desc);

-- ---------------------------------------------------------------------------
-- Marketing & platform config
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  kind public.lead_kind not null default 'customer',
  name text not null,
  email extensions.citext,
  phone text,
  organization text,
  category_slug text,
  message text,
  source_page text,
  utm jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  rules jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tamper-evident audit trail (hash chained, append-only)
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  org_id uuid,
  data jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text not null
);
create index on public.audit_events (entity_type, entity_id);
create index on public.audit_events (occurred_at desc);

create or replace function private.audit_hash_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev text;
begin
  perform pg_advisory_xact_lock(hashtext('audit_events_chain'));
  select hash into v_prev from public.audit_events order by id desc limit 1;
  new.prev_hash := coalesce(v_prev, 'GENESIS');
  new.hash := encode(extensions.digest(
    new.prev_hash || '|' || new.occurred_at::text || '|' || coalesce(new.actor_id::text, '') || '|' ||
    new.action || '|' || new.entity_type || '|' || coalesce(new.entity_id, '') || '|' || new.data::text,
    'sha256'), 'hex');
  return new;
end $$;
create trigger audit_events_chain before insert on public.audit_events
  for each row execute function private.audit_hash_chain();

create or replace function private.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_events is append-only';
end $$;
create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function private.audit_immutable();

create or replace function public.verify_audit_chain(p_limit int default 10000)
returns table (ok boolean, checked bigint, first_bad_id bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r record; v_prev text := 'GENESIS'; v_n bigint := 0; v_hash text;
begin
  if not (private.is_platform_staff() or private.is_service_role()) then
    raise exception 'not authorised';
  end if;
  for r in select * from public.audit_events order by id limit p_limit loop
    v_n := v_n + 1;
    v_hash := encode(extensions.digest(
      v_prev || '|' || r.occurred_at::text || '|' || coalesce(r.actor_id::text, '') || '|' ||
      r.action || '|' || r.entity_type || '|' || coalesce(r.entity_id, '') || '|' || r.data::text,
      'sha256'), 'hex');
    if r.prev_hash <> v_prev or r.hash <> v_hash then
      return query select false, v_n, r.id; return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select true, v_n, null::bigint;
end $$;

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
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_row -> k));
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
    case when tg_op = 'UPDATE' then jsonb_build_object('changes', v_changes) else jsonb_build_object('row', v_row - 'risk_data' - 'declarations') end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
