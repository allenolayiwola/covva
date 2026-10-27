-- Applied directly to production on 20261026212250; backfilled from supabase_migrations.schema_migrations statements.
-- Partnerships CRM follow-up: the stage audit row must be written AFTER the account
-- row exists (FK), so the BEFORE trigger only validates/stamps and a new AFTER
-- trigger records crm_stage_events. Also attaches the partner_applications status
-- trigger now that the table exists. Idempotent; mirrors 20261028100100_partnerships_crm.sql.
create or replace function private.crm_accounts_stage_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;
  if new.stage = 'live' and new.org_id is null then
    raise exception 'An account can only go live once it is linked to an organisation' using errcode = 'P0001';
  end if;
  if new.stage = 'lost' and nullif(new.lost_reason, '') is null then
    raise exception 'Record a reason when marking an account as lost' using errcode = 'P0001';
  end if;
  if new.stage = 'agreement_signed' and new.agreement_signed_at is null then
    new.agreement_signed_at := now();
  end if;
  if new.stage = 'live' then
    if new.agreement_signed_at is null then new.agreement_signed_at := now(); end if;
    if new.live_at is null then new.live_at := now(); end if;
  end if;
  return new;
end $$;
create or replace function private.crm_accounts_stage_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(current_setting('crm.stage_note', true), '');
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;
  insert into public.crm_stage_events (account_id, from_stage, to_stage, by, note)
  values (new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage, (select auth.uid()), v_note);
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'crm_accounts_stage_guard' and tgrelid = 'public.crm_accounts'::regclass) then
    create trigger crm_accounts_stage_guard before insert or update on public.crm_accounts
      for each row execute function private.crm_accounts_stage_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crm_accounts_stage_audit' and tgrelid = 'public.crm_accounts'::regclass) then
    create trigger crm_accounts_stage_audit after insert or update on public.crm_accounts
      for each row execute function private.crm_accounts_stage_audit();
  end if;
  if to_regclass('public.partner_applications') is not null then
    if not exists (select 1 from pg_trigger where tgname = 'crm_application_status_notify' and tgrelid = to_regclass('public.partner_applications')) then
      execute 'create trigger crm_application_status_notify after update on public.partner_applications for each row execute function private.crm_application_status_notify()';
    end if;
  end if;
end $$;
grant execute on all functions in schema private to authenticated, service_role;
