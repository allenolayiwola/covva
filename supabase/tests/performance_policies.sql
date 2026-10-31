-- Run on an isolated migrated database with psql -v ON_ERROR_STOP=1 -f this_file.
-- No production fixtures: the transaction is rolled back, including auth users.
begin;

do $$
begin
  if exists (
    select 1 from pg_policies p
    cross join lateral unnest(p.roles) r(role_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) a(action)
    where p.schemaname = 'public' and p.permissive = 'PERMISSIVE'
      and p.cmd in ('ALL', a.action)
    group by p.tablename, r.role_name, a.action having count(*) > 1
  ) then raise exception 'public still has overlapping permissive policies'; end if;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000b01', 'e2e-performance-owner@example.test', '{}'),
  ('00000000-0000-4000-8000-000000000b02', 'e2e-performance-other@example.test', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000b01","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b01', true);

do $$
declare affected integer;
begin
  if (select count(*) from public.profiles where id = '00000000-0000-4000-8000-000000000b01') <> 1 then
    raise exception 'merged profiles SELECT must retain self access';
  end if;
  if exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-000000000b02') then
    raise exception 'merged profiles SELECT exposed another user';
  end if;
  update public.profiles set preferred_name = 'E2E-PERFORMANCE own'
    where id = '00000000-0000-4000-8000-000000000b01';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'merged profiles UPDATE must retain self access'; end if;
  update public.profiles set preferred_name = 'E2E-PERFORMANCE forbidden'
    where id = '00000000-0000-4000-8000-000000000b02';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'merged profiles UPDATE changed another user'; end if;
  begin
    update public.profiles set id = '00000000-0000-4000-8000-000000000b03'
      where id = '00000000-0000-4000-8000-000000000b01';
    raise exception 'merged profiles WITH CHECK allowed ownership reassignment';
  exception when insufficient_privilege then
    -- RLS must reject the new owner before a foreign-key check can run.
    null;
  end;
end $$;

reset role;
do $$
begin
  if exists (select 1 from public.profiles
    where id = '00000000-0000-4000-8000-000000000b02'
      and preferred_name = 'E2E-PERFORMANCE forbidden') then
    raise exception 'another user was modified';
  end if;
end $$;
rollback;
