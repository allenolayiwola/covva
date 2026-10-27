-- =============================================================================
-- Phase 3: local-language UI (translations), USSD sessions and voice notes.
--
-- Additive only (no drops, no deletes). Policies are created only when missing.
--
-- * translations   — human-supplied UI strings per locale (tw, gaa, ee, …) so translators can
--                    work in the admin app: draft → reviewed → approved. English lives in code
--                    (packages/core/src/i18n/en.ts) and is never stored here. Anyone may read
--                    APPROVED rows (the web app merges them into its catalogue); staff read and
--                    write everything. Editing an approved value sends it back to draft.
-- * ussd_sessions  — one row per aggregator session (Africa's Talking, Hubtel, Arkesel, the
--                    staff simulator). Written by the USSD route through the service role;
--                    staff read for the session log. Customers never read them.
-- * voice_notes    — voice recordings for quote help / claim descriptions / support with their
--                    automatic transcript. Audio lives in the private `documents` bucket under
--                    voice/<owner>/…; the owner, the parties servicing the linked request or claim
--                    and platform staff can read. Transcripts are written by the server.
-- * profiles.locale (already exists, default 'en-GH') stores the signed-in user's language.
-- =============================================================================

create or replace function private.ensure_policy(p_table text, p_name text, p_sql text) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_name) then
    execute p_sql;
  end if;
end $$;
revoke execute on function private.ensure_policy(text, text, text) from public, anon, authenticated;

comment on column public.profiles.locale is 'Preferred UI language (en, tw, gaa, ee; legacy en-GH = English). Set by the language switcher when signed in; the covva_lang cookie wins for the current browser.';

-- ---------------------------------------------------------------------------
-- 1. Translations
-- ---------------------------------------------------------------------------
create table if not exists public.translations (
  id uuid primary key default gen_random_uuid(),
  locale text not null check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$' and locale not in ('en', 'en-GH')),
  key text not null check (key ~ '^[A-Za-z0-9_.-]{1,200}$'),
  value text not null check (length(value) between 1 and 4000),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'approved')),
  note text check (note is null or length(note) <= 1000),
  translator_id uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, key)
);
comment on table public.translations is 'Human translations of UI strings (English source in code). Only status = approved rows are served to the app; nothing is machine-translated.';
comment on column public.translations.key is 'Catalogue key from packages/core/src/i18n/en.ts (unknown keys are ignored by the app).';
comment on column public.translations.status is 'draft (translator) → reviewed (second speaker checked it) → approved (served). Editing an approved value resets it to draft.';
create index if not exists translations_locale_status_idx on public.translations (locale, status);

create or replace function private.translations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.translator_id := coalesce(new.translator_id, (select auth.uid()));
    if new.status in ('reviewed', 'approved') then
      new.reviewed_by := coalesce(new.reviewed_by, (select auth.uid()));
      new.reviewed_at := coalesce(new.reviewed_at, now());
    end if;
    new.approved_at := case when new.status = 'approved' then coalesce(new.approved_at, now()) else null end;
    return new;
  end if;
  -- A changed value must be checked again (unless the same update also sets the status).
  if new.value is distinct from old.value and new.status = old.status and old.status <> 'draft' then
    new.status := 'draft';
  end if;
  if new.value is distinct from old.value then
    new.translator_id := coalesce((select auth.uid()), new.translator_id);
  end if;
  if new.status is distinct from old.status then
    if new.status in ('reviewed', 'approved') then
      new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
      new.reviewed_at := now();
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
  end if;
  new.approved_at := case when new.status = 'approved' then coalesce(case when old.status = 'approved' then old.approved_at end, now()) else null end;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. USSD sessions
-- ---------------------------------------------------------------------------
create table if not exists public.ussd_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique check (length(session_id) between 1 and 200),
  provider text not null check (provider in ('africastalking', 'hubtel', 'arkesel', 'simulator')),
  msisdn text not null check (msisdn ~ '^\+[1-9][0-9]{6,14}$'),
  network text,
  service_code text,
  customer_id uuid references auth.users (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  locale text not null default 'en',
  step text not null default 'main',
  state jsonb not null default '{}'::jsonb,
  last_input text check (last_input is null or length(last_input) <= 200),
  hops int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text
);
comment on table public.ussd_sessions is 'USSD menu sessions. state holds the input history and a small snapshot of the customer context (policy/instalment ids and labels) so each hop is cheap. Written through the service role only.';
comment on column public.ussd_sessions.customer_id is 'Profile matched by MSISDN (profiles.phone). Null for unknown numbers (a lead is created when they ask for a callback).';
comment on column public.ussd_sessions.step is 'Menu node shown last (main, quote.motor.reg, …) or the terminal action (action:quote.sms …).';
create index if not exists ussd_sessions_msisdn_idx on public.ussd_sessions (msisdn, created_at desc);
create index if not exists ussd_sessions_customer_idx on public.ussd_sessions (customer_id) where customer_id is not null;
create index if not exists ussd_sessions_created_idx on public.ussd_sessions (created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Voice notes
-- ---------------------------------------------------------------------------
create table if not exists public.voice_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('quote_help', 'claim_description', 'support')),
  request_id uuid references public.requests (id) on delete set null,
  claim_id uuid references public.claims (id) on delete set null,
  storage_path text not null unique check (storage_path ~ '^voice/[0-9a-f-]{36}/[^/]+$'),
  mime_type text,
  size_bytes bigint check (size_bytes is null or (size_bytes > 0 and size_bytes <= 10485760)),
  duration_seconds integer check (duration_seconds is null or (duration_seconds >= 0 and duration_seconds <= 125)),
  language_hint text check (language_hint is null or language_hint ~ '^[a-z]{2,3}(-[A-Za-z]{2})?$'),
  transcript text check (transcript is null or length(transcript) <= 10000),
  transcript_language text,
  transcript_status text not null default 'pending' check (transcript_status in ('pending', 'done', 'failed')),
  transcript_edited_at timestamptz,
  failure_reason text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 2) = owner_id::text)
);
comment on table public.voice_notes is 'Customer voice notes (≤ 120 s) with an automatic transcript the owner checks and edits. Never auto-submitted: the owner copies the text into their claim/request.';
comment on column public.voice_notes.transcript is 'Automatic transcript ("Automatic transcript — please check"). Twi/Ga/Ewe accuracy is limited. The owner may edit it.';
comment on column public.voice_notes.transcript_status is 'pending → done | failed (failure_reason: provider error, transcription disabled, …). Set by the server.';
create index if not exists voice_notes_owner_idx on public.voice_notes (owner_id, created_at desc);
create index if not exists voice_notes_request_idx on public.voice_notes (request_id) where request_id is not null;
create index if not exists voice_notes_claim_idx on public.voice_notes (claim_id) where claim_id is not null;
create index if not exists voice_notes_pending_idx on public.voice_notes (created_at) where transcript_status = 'pending';

-- Owners may edit the transcript and link the note to their own request / claim; everything
-- else (status, model, detected language, path) is written by the server (service role).
create or replace function private.voice_notes_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_allowed text[] := array['transcript', 'transcript_edited_at', 'request_id', 'claim_id', 'updated_at'];
begin
  if private.is_service_role() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from (select auth.uid()) then
      raise exception 'Voice notes belong to the person who recorded them' using errcode = 'P0001';
    end if;
    new.transcript := null;
    new.transcript_status := 'pending';
    new.transcript_language := null;
    new.transcript_edited_at := null;
    new.model := null;
    new.failure_reason := null;
  else
    if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
      raise exception 'Only the transcript and the linked request or claim can be changed' using errcode = 'P0001';
    end if;
    if new.transcript is distinct from old.transcript then
      new.transcript_edited_at := now();
    end if;
  end if;
  if new.request_id is not null and (tg_op = 'INSERT' or new.request_id is distinct from old.request_id)
     and not private.is_request_customer(new.request_id) then
    raise exception 'You can only attach a voice note to your own request' using errcode = 'P0001';
  end if;
  if new.claim_id is not null and (tg_op = 'INSERT' or new.claim_id is distinct from old.claim_id)
     and not exists (select 1 from public.claims c where c.id = new.claim_id
                     and (c.customer_id = (select auth.uid()) or c.reported_by_user_id = (select auth.uid()))) then
    raise exception 'You can only attach a voice note to your own claim' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.can_view_voice_note(p_request uuid, p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_request is not null and private.can_access_request(p_request))
      or (p_claim is not null and private.can_access_claim(p_claim));
$$;
revoke execute on function private.can_view_voice_note(uuid, uuid) from public, anon;
grant execute on function private.can_view_voice_note(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'translations_guard' and tgrelid = 'public.translations'::regclass) then
    create trigger translations_guard before insert or update on public.translations
      for each row execute function private.translations_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'voice_notes_guard' and tgrelid = 'public.voice_notes'::regclass) then
    create trigger voice_notes_guard before insert or update on public.voice_notes
      for each row execute function private.voice_notes_guard();
  end if;
  foreach t in array array['translations', 'ussd_sessions', 'voice_notes'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    end if;
  end loop;
  -- Translation approvals are audited. USSD sessions and voice notes are not copied into the
  -- audit log (high volume, and transcripts are personal data).
  if not exists (select 1 from pg_trigger where tgname = 'audit_translations' and tgrelid = 'public.translations'::regclass) then
    create trigger audit_translations after insert or update or delete on public.translations
      for each row execute function private.write_audit();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.translations enable row level security;
alter table public.ussd_sessions enable row level security;
alter table public.voice_notes enable row level security;

-- translations: approved rows are public (the catalogue is not secret); staff read/write all.
select private.ensure_policy('translations', 'translations: public read approved', $p$
  create policy "translations: public read approved" on public.translations for select to anon, authenticated
  using (status = 'approved')
$p$);
select private.ensure_policy('translations', 'translations: staff read', $p$
  create policy "translations: staff read" on public.translations for select to authenticated
  using ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('translations', 'translations: staff insert', $p$
  create policy "translations: staff insert" on public.translations for insert to authenticated
  with check ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('translations', 'translations: staff update', $p$
  create policy "translations: staff update" on public.translations for update to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()))
$p$);

-- ussd_sessions: staff read only (the route writes through the service role).
select private.ensure_policy('ussd_sessions', 'ussd_sessions: staff read', $p$
  create policy "ussd_sessions: staff read" on public.ussd_sessions for select to authenticated
  using ((select private.is_platform_staff()))
$p$);

-- voice_notes: owner, parties of the linked request/claim, staff.
select private.ensure_policy('voice_notes', 'voice_notes: owner read', $p$
  create policy "voice_notes: owner read" on public.voice_notes for select to authenticated
  using (owner_id = (select auth.uid()))
$p$);
select private.ensure_policy('voice_notes', 'voice_notes: linked parties read', $p$
  create policy "voice_notes: linked parties read" on public.voice_notes for select to authenticated
  using ((request_id is not null or claim_id is not null) and (select private.can_view_voice_note(request_id, claim_id)))
$p$);
select private.ensure_policy('voice_notes', 'voice_notes: staff read', $p$
  create policy "voice_notes: staff read" on public.voice_notes for select to authenticated
  using ((select private.is_platform_staff()))
$p$);
select private.ensure_policy('voice_notes', 'voice_notes: owner insert', $p$
  create policy "voice_notes: owner insert" on public.voice_notes for insert to authenticated
  with check (owner_id = (select auth.uid()) and split_part(storage_path, '/', 2) = (select auth.uid())::text)
$p$);
select private.ensure_policy('voice_notes', 'voice_notes: owner update', $p$
  create policy "voice_notes: owner update" on public.voice_notes for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))
$p$);

-- ---------------------------------------------------------------------------
-- 6. Storage: voice notes in the private documents bucket under voice/<owner>/…
-- ---------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct m) from unnest(coalesce(allowed_mime_types, '{}'::text[])
           || array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/x-m4a']) as m
       )
 where id = 'documents';

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents bucket: voice notes owner') then
    create policy "documents bucket: voice notes owner" on storage.objects for all to authenticated
      using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'voice' and (storage.foldername(name))[2] = (select auth.uid())::text)
      with check (bucket_id = 'documents' and (storage.foldername(name))[1] = 'voice' and (storage.foldername(name))[2] = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents bucket: voice notes parties read') then
    create policy "documents bucket: voice notes parties read" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'voice' and exists (
        select 1 from public.voice_notes v where v.storage_path = name and (
          (select private.is_platform_staff()) or private.can_view_voice_note(v.request_id, v.claim_id))));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants (RLS applies; anon reads approved translations only).
-- ---------------------------------------------------------------------------
grant select on public.translations to anon, authenticated;
grant insert, update on public.translations to authenticated;
grant select on public.ussd_sessions to authenticated;
revoke all on public.ussd_sessions from anon;
grant select, insert, update on public.voice_notes to authenticated;
revoke all on public.voice_notes from anon;
