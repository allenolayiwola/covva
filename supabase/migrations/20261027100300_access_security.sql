-- Addendum 4 — platform access, partner security (additive; no drops).
--
-- * organizations.require_mfa      — partner orgs can be exempted from the TOTP gate by platform staff.
-- * profiles.active_workspace      — the workspace a dual-role user last chose ({ type, orgId }).
-- * profiles.last_seen_platform    — 'mobile' | 'web' | 'partner-web' (from the X-Covva-Client header).
-- * list_my_sessions()             — the caller's own auth.sessions (session/device management).
-- * revoke_my_session(uuid)        — remote sign-out of ONE of the caller's own sessions by setting
--                                    auth.sessions.not_after to now() (GoTrue rejects the session and its
--                                    refresh tokens once not_after has passed). No rows are deleted.
-- * platform_settings.complaints   — complaints contacts shown on every quote/policy (Addendum 2 G).

alter table public.organizations add column if not exists require_mfa boolean not null default true;
comment on column public.organizations.require_mfa is 'Broker/insurer users must verify a TOTP factor (AAL2) before using the partner workspace. Platform staff may exempt an organisation.';

alter table public.profiles add column if not exists active_workspace jsonb;
comment on column public.profiles.active_workspace is 'Last chosen workspace for dual-role users: { "type": "customer" | "broker" | "insurer", "orgId"?: uuid }.';

alter table public.profiles add column if not exists last_seen_platform text;
comment on column public.profiles.last_seen_platform is 'Client that last called the API as this user: mobile | web | partner-web.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_last_seen_platform_check') then
    alter table public.profiles add constraint profiles_last_seen_platform_check
      check (last_seen_platform is null or last_seen_platform in ('mobile', 'web', 'partner-web'));
  end if;
end $$;

-- Sessions ---------------------------------------------------------------------
-- auth.sessions is owned by supabase_auth_admin; these SECURITY DEFINER functions are the
-- only way an authenticated user can see or end their own sessions.
create or replace function private.list_my_sessions()
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text, aal text, not_after timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.created_at, s.updated_at, s.user_agent, host(s.ip)::text, s.aal::text, s.not_after
  from auth.sessions s
  where s.user_id = (select auth.uid())
  order by s.updated_at desc nulls last, s.created_at desc;
$$;
revoke execute on function private.list_my_sessions() from public, anon;
grant execute on function private.list_my_sessions() to authenticated;

create or replace function public.list_my_sessions()
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text, aal text, not_after timestamptz)
language sql stable security definer set search_path = '' as $$
  select * from private.list_my_sessions();
$$;
revoke execute on function public.list_my_sessions() from public, anon;
grant execute on function public.list_my_sessions() to authenticated;

-- Ends one of the caller's own sessions by expiring it (not_after = now()). Returns true when a row was affected.
create or replace function public.revoke_my_session(p_session_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  update auth.sessions s set not_after = now() where s.id = p_session_id and s.user_id = v_uid and (s.not_after is null or s.not_after > now());
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
revoke execute on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.revoke_my_session(uuid) to authenticated;

-- Complaints contacts (platform + regulator) -----------------------------------
insert into public.platform_settings (key, value, description) values
  ('complaints', '{"email":"complaints@covva.com.gh","phone":null,"nic_name":"NIC Complaints Bureau","nic_phone":null,"nic_url":"https://nic.gov.gh"}', 'Complaints contacts shown on every quote and policy: platform complaints email/phone and the National Insurance Commission complaints line (nic_phone must be confirmed with the NIC before launch).')
on conflict (key) do nothing;
