-- =============================================================================
-- Diaspora consent: count failed attempts correctly. A PL/pgSQL `raise exception`
-- rolls back the function's own writes, so the attempt counter (and the "expired"
-- status) never persisted. Wrong / expired codes now return a status object
-- instead of raising; the server maps it to a business-rule error. Missing or
-- locked codes still raise (nothing to persist).
-- =============================================================================
create or replace function public.confirm_beneficiary_consent(p_beneficiary_id uuid, p_kind text, p_code text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.beneficiary_consents;
  v_hash text;
  v_left int;
begin
  if not (private.is_service_role() or private.is_platform_staff()
          or exists (select 1 from public.beneficiaries b where b.id = p_beneficiary_id and (b.sponsor_user_id = v_uid or b.linked_user_id = v_uid))) then
    raise exception 'Beneficiary not found' using errcode = 'P0001';
  end if;
  perform set_config('app.consent_rpc', '1', true);
  select * into v_row from public.beneficiary_consents where beneficiary_id = p_beneficiary_id and kind = p_kind for update;
  if v_row.id is null or v_row.code_hash is null then
    raise exception 'No consent code is pending. Send a new code first.' using errcode = 'P0001';
  end if;
  if v_row.granted then
    return jsonb_build_object('status', 'granted', 'granted_at', v_row.granted_at);
  end if;
  if v_row.locked_at is not null then
    raise exception 'Too many incorrect codes. Send a new code to try again.' using errcode = 'P0001';
  end if;
  if v_row.expires_at < now() then
    if p_kind = 'data_sharing' then
      update public.beneficiaries set consent_status = 'expired' where id = p_beneficiary_id and consent_status = 'pending';
    end if;
    return jsonb_build_object('status', 'expired', 'message', 'That code has expired. Send a new one.');
  end if;
  v_hash := encode(extensions.digest(p_beneficiary_id::text || ':' || p_kind || ':' || regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'), 'hex');
  if v_hash <> v_row.code_hash then
    v_left := 5 - (v_row.attempts + 1);
    update public.beneficiary_consents
       set attempts = attempts + 1, locked_at = case when attempts + 1 >= 5 then now() else null end
     where id = v_row.id;
    if v_left <= 0 then
      return jsonb_build_object('status', 'locked', 'attempts_left', 0, 'message', 'Too many incorrect codes. Send a new code to try again.');
    end if;
    return jsonb_build_object('status', 'invalid', 'attempts_left', v_left, 'message', format('That code is not right. %s attempt(s) left.', v_left));
  end if;
  perform private.grant_beneficiary_consent(p_beneficiary_id, p_kind, v_row.channel);
  return jsonb_build_object('status', 'granted', 'granted_at', now());
end $$;
revoke execute on function public.confirm_beneficiary_consent(uuid, text, text) from public, anon;
grant execute on function public.confirm_beneficiary_consent(uuid, text, text) to authenticated, service_role;
