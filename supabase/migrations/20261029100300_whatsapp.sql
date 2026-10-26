-- =============================================================================
-- WhatsApp Business channel (Phase 2): contacts, conversations, messages, the
-- template registry and handoffs to a human (support) or the customer's broker.
--
-- Additive only (no drops, no deletes). Policies are created only when missing.
--
-- Who sees what:
--   * Platform staff read everything and run the support console. Conversation
--     take-over, assignment, opt-out and handoff rows may be written by staff
--     (the console still routes sends through the server, which uses the service
--     role so every outbound message is logged in wa_messages).
--   * Brokers see only the conversations handed to their organisation
--     (assigned_org_id) with their messages, handoffs and the contact card; they
--     never see other brokers' conversations or the bot-only traffic.
--   * Customers and anonymous visitors never read wa_* rows. The WhatsApp
--     webhook and the bot write through the service role.
--   * Templates are the registry of Meta-approved message templates: staff only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.ensure_policy(p_table text, p_name text, p_sql text) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Contacts
-- ---------------------------------------------------------------------------
create table if not exists public.wa_contacts (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique,
  phone text not null unique,
  user_id uuid references auth.users (id) on delete set null,
  display_name text,
  opted_in boolean not null default false,
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  check (wa_id ~ '^[0-9]{7,15}$')
);
comment on table public.wa_contacts is 'One row per WhatsApp number that has messaged us or that we message. phone is E.164 (+233…); wa_id is the digits Meta uses.';
comment on column public.wa_contacts.user_id is 'Linked when the number matches a profile (or beneficiary) phone. Null for unknown numbers.';
comment on column public.wa_contacts.opted_out_at is 'Set when the contact sent STOP. Nothing is sent to an opted-out contact until they message again.';
comment on column public.wa_contacts.last_inbound_at is 'Drives the 24-hour customer-service window: free-form text is only allowed within 24h of this; otherwise templates only.';
create index if not exists wa_contacts_user_idx on public.wa_contacts (user_id) where user_id is not null;
create index if not exists wa_contacts_last_inbound_idx on public.wa_contacts (last_inbound_at desc);

-- ---------------------------------------------------------------------------
-- 2. Conversations and messages
-- ---------------------------------------------------------------------------
create table if not exists public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.wa_contacts (id) on delete cascade,
  status text not null default 'bot' check (status in ('bot', 'human', 'broker', 'closed')),
  assigned_org_id uuid references public.organizations (id),
  assigned_user_id uuid references auth.users (id),
  topic text,
  request_id uuid references public.requests (id) on delete set null,
  policy_id uuid references public.policies (id) on delete set null,
  claim_id uuid references public.claims (id) on delete set null,
  bot_turns int not null default 0,
  last_message_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.wa_conversations is 'A WhatsApp conversation thread. status: bot (AI FAQ assistant), human (support agent), broker (handed to the broker of record), closed.';
comment on column public.wa_conversations.assigned_org_id is 'Broker organisation the conversation was handed to (status = broker).';
comment on column public.wa_conversations.assigned_user_id is 'Support agent who took the conversation over (status = human).';
comment on column public.wa_conversations.bot_turns is 'Bot replies so far; after three the bot offers a human every turn.';
create index if not exists wa_conversations_contact_idx on public.wa_conversations (contact_id, created_at desc);
create index if not exists wa_conversations_status_idx on public.wa_conversations (status, last_message_at desc);
create index if not exists wa_conversations_org_idx on public.wa_conversations (assigned_org_id, last_message_at desc) where assigned_org_id is not null;
create index if not exists wa_conversations_user_idx on public.wa_conversations (assigned_user_id) where assigned_user_id is not null;

create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  wa_message_id text unique,
  kind text not null default 'text' check (kind in ('text', 'template', 'interactive', 'image', 'document', 'audio', 'location', 'unsupported')),
  body text,
  payload jsonb not null default '{}'::jsonb,
  template_name text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  error text,
  sender_user_id uuid references auth.users (id),
  sender_party text check (sender_party is null or sender_party in ('customer', 'bot', 'support', 'broker', 'system')),
  created_at timestamptz not null default now()
);
comment on table public.wa_messages is 'Every inbound and outbound WhatsApp message. wa_message_id (Meta id) is unique so webhook retries are idempotent; outbound delivery statuses are updated by the status webhook.';
comment on column public.wa_messages.payload is 'Raw Meta message object (inbound) or the request we sent (outbound). Media is referenced by id, never downloaded here.';
create index if not exists wa_messages_conversation_idx on public.wa_messages (conversation_id, created_at);
create index if not exists wa_messages_status_idx on public.wa_messages (status) where direction = 'out' and status in ('queued', 'sent');

-- ---------------------------------------------------------------------------
-- 3. Template registry
-- ---------------------------------------------------------------------------
create table if not exists public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z0-9_]{3,80}$'),
  language text not null default 'en',
  category text not null default 'utility' check (category in ('utility', 'marketing', 'authentication')),
  body text not null check (length(body) between 1 and 1024),
  variables text[] not null default '{}',
  buttons jsonb not null default '[]'::jsonb,
  description text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  meta_template_id text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.wa_templates is 'Registry of WhatsApp message templates. Body uses {{1}}, {{2}}… placeholders in the order of `variables`. Only `approved` templates (approved by Meta) are sent.';
comment on column public.wa_templates.buttons is 'Template buttons as Meta expects them, e.g. [{"type":"quick_reply","text":"Accept"}] (the payload carries the accept token at send time).';

-- ---------------------------------------------------------------------------
-- 4. Handoffs
-- ---------------------------------------------------------------------------
create table if not exists public.wa_handoffs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations (id) on delete cascade,
  reason text not null check (reason in ('advice', 'complaint', 'payment_issue', 'claim', 'unknown', 'requested')),
  to_party text not null check (to_party in ('support', 'broker')),
  org_id uuid references public.organizations (id),
  complaint_id uuid references public.complaints (id) on delete set null,
  request_id uuid references public.requests (id) on delete set null,
  lead_id uuid,
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id)
);
comment on table public.wa_handoffs is 'Why and to whom a conversation left the bot. lead_id is a soft link to a callback lead created for unknown numbers.';
create index if not exists wa_handoffs_conversation_idx on public.wa_handoffs (conversation_id, created_at desc);
create index if not exists wa_handoffs_open_idx on public.wa_handoffs (to_party, created_at desc) where resolved_at is null;
create index if not exists wa_handoffs_org_idx on public.wa_handoffs (org_id) where org_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Triggers: updated_at, conversation bump, audit
-- ---------------------------------------------------------------------------
create or replace function private.wa_messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.wa_conversations
     set last_message_at = greatest(last_message_at, new.created_at),
         bot_turns = case when new.direction = 'out' and new.sender_party = 'bot' then bot_turns + 1 else bot_turns end
   where id = new.conversation_id;
  update public.wa_contacts c
     set last_inbound_at = case when new.direction = 'in' then greatest(coalesce(c.last_inbound_at, new.created_at), new.created_at) else c.last_inbound_at end,
         last_outbound_at = case when new.direction = 'out' then greatest(coalesce(c.last_outbound_at, new.created_at), new.created_at) else c.last_outbound_at end
    from public.wa_conversations v
   where v.id = new.conversation_id and c.id = v.contact_id;
  return new;
end $$;

do $$
declare t text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'wa_messages_after_insert' and tgrelid = 'public.wa_messages'::regclass) then
    create trigger wa_messages_after_insert after insert on public.wa_messages
      for each row execute function private.wa_messages_after_insert();
  end if;
  foreach t in array array['wa_contacts', 'wa_conversations', 'wa_templates'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
  end loop;
  foreach t in array array['wa_contacts', 'wa_conversations', 'wa_messages', 'wa_templates', 'wa_handoffs'] loop
    if not exists (select 1 from pg_trigger where tgname = 'audit_' || t and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.write_audit()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
alter table public.wa_contacts enable row level security;
alter table public.wa_conversations enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_templates enable row level security;
alter table public.wa_handoffs enable row level security;

-- A broker member may see a conversation handed to one of their organisations.
create or replace function private.can_view_wa_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wa_conversations v
    where v.id = p_conversation
      and v.assigned_org_id is not null
      and v.assigned_org_id in (select private.user_org_ids())
  );
$$;
revoke execute on function private.can_view_wa_conversation(uuid) from public, anon;

-- Staff read everything.
do $$
declare t text;
begin
  foreach t in array array['wa_contacts', 'wa_conversations', 'wa_messages', 'wa_templates', 'wa_handoffs'] loop
    perform private.ensure_policy(t, t || ': staff read', format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_platform_staff()))', t || ': staff read', t));
  end loop;
end $$;

-- Staff write: conversation triage, opt-outs, handoffs and the template registry.
select private.ensure_policy('wa_conversations', 'wa_conversations: staff update', $p$
  create policy "wa_conversations: staff update" on public.wa_conversations for update to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('wa_contacts', 'wa_contacts: staff update', $p$
  create policy "wa_contacts: staff update" on public.wa_contacts for update to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('wa_handoffs', 'wa_handoffs: staff write', $p$
  create policy "wa_handoffs: staff write" on public.wa_handoffs for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('wa_templates', 'wa_templates: admin write', $p$
  create policy "wa_templates: admin write" on public.wa_templates for all to authenticated
  using (exists (select 1 from public.memberships m join public.organizations o on o.id = m.org_id
                 where m.user_id = (select auth.uid()) and m.active and o.type = 'platform' and m.role in ('platform_admin', 'platform_ops')))
  with check (exists (select 1 from public.memberships m join public.organizations o on o.id = m.org_id
                      where m.user_id = (select auth.uid()) and m.active and o.type = 'platform' and m.role in ('platform_admin', 'platform_ops')))
$p$);

-- Brokers: the conversations handed to them (read only; replies go through the server).
select private.ensure_policy('wa_conversations', 'wa_conversations: assigned broker read', $p$
  create policy "wa_conversations: assigned broker read" on public.wa_conversations for select to authenticated
  using (assigned_org_id is not null and assigned_org_id in (select private.user_org_ids()))
$p$);
select private.ensure_policy('wa_messages', 'wa_messages: assigned broker read', $p$
  create policy "wa_messages: assigned broker read" on public.wa_messages for select to authenticated
  using ((select private.can_view_wa_conversation(conversation_id)))
$p$);
select private.ensure_policy('wa_handoffs', 'wa_handoffs: assigned broker read', $p$
  create policy "wa_handoffs: assigned broker read" on public.wa_handoffs for select to authenticated
  using (org_id is not null and org_id in (select private.user_org_ids()))
$p$);
select private.ensure_policy('wa_contacts', 'wa_contacts: assigned broker read', $p$
  create policy "wa_contacts: assigned broker read" on public.wa_contacts for select to authenticated
  using (exists (select 1 from public.wa_conversations v
                 where v.contact_id = wa_contacts.id and v.assigned_org_id is not null
                   and v.assigned_org_id in (select private.user_org_ids())))
$p$);

-- ---------------------------------------------------------------------------
-- 7. Seed the templates the platform needs (draft until Meta approves them).
-- ---------------------------------------------------------------------------
insert into public.wa_templates (name, language, category, body, variables, buttons, description) values
  ('renewal_reminder', 'en', 'utility',
   'Hello {{1}}, your {{2}} policy {{3}} expires on {{4}}. Renew in a few taps: {{5}}',
   '{name,category,reference,expiry_date,link}', '[]'::jsonb,
   'Renewal reminder sent 30/14/7/1 days before the cover ends.'),
  ('policy_documents_ready', 'en', 'utility',
   'Hello {{1}}, the documents for your policy {{2}} from {{3}} are ready in your Covva wallet: {{4}}',
   '{name,reference,insurer,link}', '[]'::jsonb,
   'Policy schedule / certificate uploaded by the insurer.'),
  ('claim_status_update', 'en', 'utility',
   'Hello {{1}}, claim {{2}} is now "{{3}}". {{4}} Track it here: {{5}}',
   '{name,reference,status,note,link}', '[]'::jsonb,
   'Claim status change. The insurer decides claims; the note is theirs.'),
  ('quote_ready', 'en', 'utility',
   'Hello {{1}}, your {{2}} quotes are ready to compare ({{3}}). See them here: {{4}}',
   '{name,category,reference,link}', '[]'::jsonb,
   'Quotes ready for comparison on a request.'),
  ('payment_link', 'en', 'utility',
   'Hello {{1}}, to complete your {{2}} application ({{3}}) pay {{4}} to the insurer here: {{5}}',
   '{name,category,reference,amount,link}', '[]'::jsonb,
   'Secure checkout link. The premium goes to the insurer through the payment provider.'),
  ('broker_new_offer', 'en', 'utility',
   'New {{1}} request {{2}} on Covva. First broker to accept becomes broker of record. Accept within {{3}} minutes or open: {{4}}',
   '{category,reference,minutes,link}',
   '[{"type":"quick_reply","text":"Accept"},{"type":"quick_reply","text":"Decline"}]'::jsonb,
   'One-tap offer for brokers. The Accept button carries the offer accept token in its payload.'),
  ('consent_request', 'en', 'authentication',
   '{{1}} wants to arrange insurance for you on Covva. Reply with the code {{2}} to confirm you agree. If you did not expect this, ignore this message.',
   '{sponsor_name,code}', '[]'::jsonb,
   'Beneficiary consent for diaspora-sponsored cover (the beneficiary replies with the 6-digit code).'),
  ('otp_code', 'en', 'authentication',
   'Your Covva verification code is {{1}}. It expires in 10 minutes. Never share this code.',
   '{code}', '[]'::jsonb,
   'One-time passcode.'),
  ('info_request', 'en', 'utility',
   'Hello {{1}}, {{2}} needs something from you for {{3}}: {{4}}. Reply here or open: {{5}}',
   '{name,broker,reference,what,link}', '[]'::jsonb,
   'Broker or insurer needs information/documents from the customer.')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Grants (RLS still applies for authenticated; anon has nothing).
-- ---------------------------------------------------------------------------
grant select, insert, update on public.wa_contacts, public.wa_conversations, public.wa_messages, public.wa_templates, public.wa_handoffs to authenticated;
revoke all on public.wa_contacts, public.wa_conversations, public.wa_messages, public.wa_templates, public.wa_handoffs from anon;
