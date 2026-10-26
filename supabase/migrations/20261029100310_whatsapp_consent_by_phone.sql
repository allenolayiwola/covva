-- WhatsApp inbound consent: a beneficiary replies with the 6-digit code from the number the code was
-- sent to. The WhatsApp router runs as the service role and only knows the phone, so this wrapper
-- resolves the beneficiary + pending consent kind and delegates to confirm_beneficiary_consent.
-- Service role only. No rows are deleted.
create or replace function public.confirm_beneficiary_consent_by_phone(p_phone text, p_code text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_rec record;
  v_result jsonb;
  v_last jsonb := jsonb_build_object('status', 'none', 'message', 'No consent code is pending for this number.');
begin
  if not private.is_service_role() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(v_digits) < 9 then
    return v_last;
  end if;
  for v_rec in
    select c.beneficiary_id, c.kind
      from public.beneficiary_consents c
      join public.beneficiaries b on b.id = c.beneficiary_id
     where regexp_replace(coalesce(b.phone, ''), '\D', '', 'g') like '%' || right(v_digits, 9)
       and c.code_hash is not null
       and not c.granted
       and c.locked_at is null
       and c.expires_at >= now()
     order by c.created_at desc
  loop
    v_result := public.confirm_beneficiary_consent(v_rec.beneficiary_id, v_rec.kind, p_code);
    if v_result ->> 'status' = 'granted' then
      return v_result || jsonb_build_object('kind', v_rec.kind, 'beneficiary_id', v_rec.beneficiary_id);
    end if;
    v_last := v_result;
  end loop;
  return v_last;
end $$;
revoke execute on function public.confirm_beneficiary_consent_by_phone(text, text) from public, anon, authenticated;
grant execute on function public.confirm_beneficiary_consent_by_phone(text, text) to service_role;
