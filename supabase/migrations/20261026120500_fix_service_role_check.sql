-- SECURITY FIX: inside SECURITY DEFINER functions current_user is the function owner
-- (postgres), so the previous check treated every caller as privileged. Decide from the
-- request JWT instead; treat only direct database sessions (no JWT, not via PostgREST)
-- such as migrations and the SQL console as trusted.
create or replace function private.is_service_role() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or (coalesce(current_setting('request.jwt.claims', true), '') = '' and session_user <> 'authenticator');
$$;
