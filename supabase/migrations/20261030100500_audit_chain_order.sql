-- Audit chain: verify by following the hash links, and number rows inside the chain lock.
--
-- The identity value of audit_events.id is drawn when the row is built, before the BEFORE INSERT
-- trigger takes the chain lock. Two concurrent transactions could therefore get ids N and N+1 but
-- take the lock in the opposite order: the hash chain stays intact, but in id order the two links
-- look swapped (seen once, events #2029/#2030). Nothing was altered — every row's content hash
-- still recomputes.
--
-- The old trigger also took "the highest id" as the predecessor, so the late row (#2029) became a
-- one-row side branch off #2030 while the main chain continued through #2031.
--
-- 1. verify_audit_chain now walks the chain from GENESIS through prev_hash -> hash and reports a
--    break if a link is missing, a content hash does not recompute, a row is not on the chain, or
--    the chain forks. The only fork tolerated is a single-row side branch that staff recorded in
--    the append-only audit_chain_exceptions table and whose own content hash still recomputes.
-- 2. audit_hash_chain re-numbers the row from the sequence after taking the lock, so id order and
--    chain order agree from now on.
-- Additive only: no drops, no deletes, no revokes.

create index if not exists audit_events_prev_hash_idx on public.audit_events (prev_hash);

create table if not exists public.audit_chain_exceptions (
  event_id bigint primary key references public.audit_events (id),
  reason text not null,
  recorded_at timestamptz not null default now()
);
comment on table public.audit_chain_exceptions is 'Explained, single-row side branches of the audit hash chain (append-only). The verifier still checks each listed row''s content hash.';
alter table public.audit_chain_exceptions enable row level security;
select private.ensure_policy('audit_chain_exceptions', 'audit chain exceptions: staff read', $p$
  create policy "audit chain exceptions: staff read" on public.audit_chain_exceptions for select to authenticated
  using ((select private.is_platform_staff()))$p$);
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_chain_exceptions_no_update' and tgrelid = 'public.audit_chain_exceptions'::regclass) then
    create trigger audit_chain_exceptions_no_update before update or delete on public.audit_chain_exceptions
      for each row execute function private.audit_immutable();
  end if;
end $$;
insert into public.audit_chain_exceptions (event_id, reason)
select 2029, 'Concurrent insert numbered before the chain lock (2026-10-27 01:47:04). Content hash intact; chained to #2030 as a one-row side branch while the main chain continued through #2031. Fixed by numbering inside the lock.'
where exists (select 1 from public.audit_events where id = 2029)
on conflict (event_id) do nothing;

create or replace function private.audit_hash_chain()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_prev text;
begin
  perform pg_advisory_xact_lock(hashtext('audit_events_chain'));
  -- Number the row only once the lock is held, so ids follow chain order.
  new.id := nextval('public.audit_events_id_seq');
  select hash into v_prev from public.audit_events order by id desc limit 1;
  new.prev_hash := coalesce(v_prev, 'GENESIS');
  new.hash := encode(extensions.digest(
    new.prev_hash || '|' || new.occurred_at::text || '|' || coalesce(new.actor_id::text, '') || '|' ||
    new.action || '|' || new.entity_type || '|' || coalesce(new.entity_id, '') || '|' || new.data::text,
    'sha256'), 'hex');
  return new;
end $$;

create or replace function public.verify_audit_chain(p_limit integer default 10000)
returns table (ok boolean, checked bigint, first_bad_id bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.audit_events;
  v_prev text := 'GENESIS';
  v_n bigint := 0;
  v_links int;
  v_total bigint;
  v_orphan bigint;
begin
  if not (private.is_platform_staff() or private.is_service_role()) then
    raise exception 'not authorised';
  end if;
  loop
    exit when v_n >= p_limit;
    select count(*) into v_links from public.audit_events where prev_hash = v_prev;
    exit when v_links = 0;
    if v_links > 1 then
      -- Fork: every branch except one must be a recorded, single-row side branch with an intact hash.
      for r in select a.* from public.audit_events a where a.prev_hash = v_prev
                 and exists (select 1 from public.audit_chain_exceptions e where e.event_id = a.id) loop
        if exists (select 1 from public.audit_events c where c.prev_hash = r.hash)
           or r.hash <> encode(extensions.digest(
                r.prev_hash || '|' || r.occurred_at::text || '|' || coalesce(r.actor_id::text, '') || '|' ||
                r.action || '|' || r.entity_type || '|' || coalesce(r.entity_id, '') || '|' || r.data::text,
                'sha256'), 'hex') then
          return query select false, v_n, r.id; return;
        end if;
        v_n := v_n + 1;
      end loop;
      select count(*) into v_links from public.audit_events a where a.prev_hash = v_prev
        and not exists (select 1 from public.audit_chain_exceptions e where e.event_id = a.id);
      if v_links <> 1 then
        return query select false, v_n, (select max(id) from public.audit_events where prev_hash = v_prev); return;
      end if;
    end if;
    select a.* into r from public.audit_events a where a.prev_hash = v_prev
      and not exists (select 1 from public.audit_chain_exceptions e where e.event_id = a.id);
    v_n := v_n + 1;
    if r.hash <> encode(extensions.digest(
         r.prev_hash || '|' || r.occurred_at::text || '|' || coalesce(r.actor_id::text, '') || '|' ||
         r.action || '|' || r.entity_type || '|' || coalesce(r.entity_id, '') || '|' || r.data::text,
         'sha256'), 'hex') then
      return query select false, v_n, r.id; return;
    end if;
    v_prev := r.hash;
  end loop;
  if v_n < p_limit then
    select count(*) into v_total from public.audit_events;
    if v_total <> v_n then
      -- A row that is not reachable from GENESIS (its predecessor is missing or was altered).
      select a.id into v_orphan from public.audit_events a
       where a.prev_hash <> 'GENESIS' and not exists (select 1 from public.audit_events b where b.hash = a.prev_hash)
       order by a.id limit 1;
      return query select false, v_n, coalesce(v_orphan, (select min(id) from public.audit_events)); return;
    end if;
  end if;
  return query select true, v_n, null::bigint;
end $$;
