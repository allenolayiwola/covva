-- Local only: supabase test db. All fixtures roll back; never run on production.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Exercise the optional Payload schema on a fresh local database too.
create schema if not exists cms;
create table cms.e2e_hardening_page (title text);
grant usage on schema cms to anon, authenticated;
\ir ../migrations/20261031120100_cms_schema_hardening.sql
select lives_ok($$insert into cms.e2e_hardening_page values ('E2E page')$$, 'CMS owner can create a test page');
select lives_ok($$update cms.e2e_hardening_page set title = 'E2E edited'$$, 'CMS owner can edit a test page');


select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'e2e-hardening-a@example.invalid');
insert into public.organizations (id, type, status, name, slug) values
  ('b1000000-0000-4000-8000-000000000001', 'broker', 'active', 'E2E-HARDENING A', 'e2e-hardening-a'),
  ('b1000000-0000-4000-8000-000000000002', 'broker', 'active', 'E2E-HARDENING B', 'e2e-hardening-b'),
  ('b1000000-0000-4000-8000-000000000003', 'insurer', 'active', 'E2E-HARDENING insurer', 'e2e-hardening-insurer');
insert into public.memberships (org_id, user_id, role) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner');
insert into public.product_categories (id, slug, name) values
  ('c1000000-0000-4000-8000-000000000001', 'e2e-hardening', 'E2E-HARDENING category');
insert into public.policies (customer_id, insurer_org_id, category_id, status, policy_number, verification_code, cover_start, cover_end)
values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003',
        'c1000000-0000-4000-8000-000000000001', 'active', 'E2E-HARDENING-1234', 'E2E0000001', current_date - 1, current_date + 30);

-- Effective privileges catch inherited PUBLIC grants as well as explicit grants.
select ok(not has_function_privilege('anon', p.oid, 'EXECUTE'), p.proname || ': anon denied')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'partner_sales_summary', 'partner_renewals', 'partner_claims_summary',
  'partner_sla_performance', 'partner_commission_summary', 'partner_lapses',
  'invitation_preview', 'broker_public_reviews', 'analytics_rollup',
  'activate_scheduled_versions', 'allocate_policy_number');
select ok(not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and has_function_privilege('service_role', p.oid, 'EXECUTE'), p.proname || ': service only')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('invitation_preview', 'broker_public_reviews',
  'analytics_rollup', 'activate_scheduled_versions', 'allocate_policy_number');

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(format('select public.%I(%L::uuid)', f, 'b1000000-0000-4000-8000-000000000001'),
  '42501', null, f || ': anonymous invocation rejected')
from unnest(array['partner_sales_summary','partner_renewals','partner_claims_summary',
  'partner_sla_performance','partner_commission_summary','partner_lapses']) f;
select is(public.verify_policy('E2E0000001')->>'valid', 'true', 'public verification finds active test policy');
select is(public.verify_policy(null, 'e2e-hardening-insurer', 'E2E-HARDENING-1234')->>'valid', 'true', 'public insurer/number verification works');
select is(public.verify_policy('bad')->>'status', 'invalid_input', 'malformed code rejected');
select is(public.verify_policy(repeat('A', 1000))->>'status', 'invalid_input', 'oversized code rejected');
select is(public.verify_policy('E2E0000001') - array['valid','status','insurer_name','category_name','cover_start','cover_end','policy_number_masked'], '{}'::jsonb, 'verification returns only the public field allowlist');
select is(public.verify_policy('E2E0000001')->>'policy_number_masked', '••••••••1234', 'policy number stays masked');
select is((select count(*)::int from public.embed_partner('bad')), 0, 'invalid embed code returns nothing');
select is((select count(*)::int from public.broker_score_summary(array_fill('b1000000-0000-4000-8000-000000000001'::uuid, array[101]))), 0, 'oversized score input returns nothing');

reset role;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}', true);
select lives_ok(format('select public.%I(%L::uuid)', f, 'b1000000-0000-4000-8000-000000000001'), f || ': member can read own partner')
from unnest(array['partner_sales_summary','partner_renewals','partner_claims_summary',
  'partner_sla_performance','partner_commission_summary','partner_lapses']) f;
select throws_ok(format('select public.%I(%L::uuid)', f, 'b1000000-0000-4000-8000-000000000002'),
  '42501', 'You are not a member of this organisation', f || ': partner A cannot read partner B')
from unnest(array['partner_sales_summary','partner_renewals','partner_claims_summary',
  'partner_sla_performance','partner_commission_summary','partner_lapses']) f;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.memberships set role='adviser' where user_id='a1000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select public.partner_commission_summary('b1000000-0000-4000-8000-000000000001')$$,
  '42501', 'You are not a member of this organisation', 'adviser cannot read commission');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.memberships set active=false where user_id='a1000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select public.partner_sales_summary('b1000000-0000-4000-8000-000000000001')$$,
  '42501', 'You are not a member of this organisation', 'inactive member cannot read own partner');
reset role;

select ok(not has_schema_privilege('anon', oid, 'USAGE') and not has_schema_privilege('authenticated', oid, 'USAGE'), 'cms inaccessible to Data API user roles')
from pg_namespace where nspname='cms';
select ok(c.relrowsecurity and not c.relforcerowsecurity, 'cms.' || c.relname || ': RLS on; owner bypass retained')
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cms' and c.relkind='r';
select * from finish();
rollback;
