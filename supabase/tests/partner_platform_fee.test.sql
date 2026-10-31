-- Local/disposable Postgres only. Fixtures and all mutations roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
 ('a2000000-0000-4000-8000-000000000001', 'billing-partner@example.invalid'),
 ('a2000000-0000-4000-8000-000000000002', 'billing-admin@example.invalid'),
 ('a2000000-0000-4000-8000-000000000003', 'billing-support@example.invalid');
insert into public.organizations (id, type, status, name, slug) values
 ('b2000000-0000-4000-8000-000000000001', 'broker', 'active', 'E2E billing broker', 'e2e-billing-broker'),
 ('b2000000-0000-4000-8000-000000000002', 'insurer', 'active', 'E2E billing insurer', 'e2e-billing-insurer'),
 ('b2000000-0000-4000-8000-000000000003', 'platform', 'active', 'E2E billing platform', 'e2e-billing-platform');
insert into public.memberships (org_id, user_id, role) values
 ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'owner'),
 ('b2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'platform_admin'),
 ('b2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000003', 'support');
insert into public.plans (id, code, name, audience, monthly_fee, per_request_fee, per_active_policy_fee) values
 ('c2000000-0000-4000-8000-000000000001', 'e2e_billing_broker', 'E2E billing broker', 'broker', 123, 0, 0),
 ('c2000000-0000-4000-8000-000000000002', 'e2e_billing_insurer', 'E2E billing insurer', 'insurer', 234, 0, 0);
insert into public.subscriptions (id, org_id, plan_id, status) values
 ('d2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'active'),
 ('d2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'active');
insert into public.invoices (id, number, org_id, period_start, period_end, subtotal, total) values
 ('e2000000-0000-4000-8000-000000000001', 'E2E-BILLING-1', 'b2000000-0000-4000-8000-000000000001', current_date, current_date, 123, 123),
 ('e2000000-0000-4000-8000-000000000002', 'E2E-BILLING-2', 'b2000000-0000-4000-8000-000000000002', current_date, current_date, 234, 234);

select ok(relrowsecurity, relname || ': RLS enabled') from pg_class
where oid in ('public.plans'::regclass, 'public.subscriptions'::regclass, 'public.invoices'::regclass);
select is((select enabled from public.feature_flags where key='partner_platform_fee'), false, 'billing defaults off');
update public.feature_flags set enabled=true where key='partner_platform_fee';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.plans where audience in ('broker','insurer')), 0, 'anonymous cannot read fee agreements');
select is((select count(*)::int from public.subscriptions), 0, 'anonymous cannot read subscriptions');
select is((select count(*)::int from public.invoices), 0, 'anonymous cannot read invoices');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a2000000-0000-4000-8000-000000000001"}', true);
select is((select count(*)::int from public.plans where audience in ('broker','insurer')), 1, 'partner sees only assigned plan');
select is((select count(*)::int from public.subscriptions), 1, 'partner sees only own subscription');
select is((select count(*)::int from public.invoices), 1, 'partner sees only own invoice');
with changed as (update public.invoices set status='paid' returning id) select is((select count(*)::int from changed), 0, 'partner cannot mark invoices paid');
with changed as (update public.subscriptions set status='cancelled' returning id) select is((select count(*)::int from changed), 0, 'partner cannot update subscriptions');
with changed as (update public.plans set monthly_fee=999 returning id) select is((select count(*)::int from changed), 0, 'partner cannot change fees');
select throws_ok($$insert into public.invoices (number,org_id,period_start,period_end) values ('E2E-forged', 'b2000000-0000-4000-8000-000000000001',current_date,current_date)$$, '42501', null, 'partner cannot insert invoices');
select throws_ok($$insert into public.subscriptions (org_id,plan_id,status) values ('b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','cancelled')$$, '42501', null, 'partner cannot insert subscriptions');
select throws_ok($$insert into public.plans (code,name,audience,monthly_fee,per_request_fee,per_active_policy_fee) values ('forged','Forged','broker',1,0,0)$$, '42501', null, 'partner cannot insert plans');
with changed as (delete from public.invoices returning id) select is((select count(*)::int from changed), 0, 'partner cannot delete invoices');

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a2000000-0000-4000-8000-000000000003"}', true);
with changed as (update public.invoices set status='paid' returning id) select is((select count(*)::int from changed), 0, 'support cannot write invoices despite legacy staff policy');
with changed as (update public.subscriptions set status='cancelled' returning id) select is((select count(*)::int from changed), 0, 'support cannot write subscriptions');
with changed as (update public.plans set monthly_fee=999 returning id) select is((select count(*)::int from changed), 0, 'support cannot write plans');

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a2000000-0000-4000-8000-000000000002"}', true);
select lives_ok($$insert into public.plans (code,name,audience,monthly_fee,per_request_fee,per_active_policy_fee) values ('e2e_admin_plan','E2E admin plan','broker',321,0,0)$$, 'admin creates a configured fee plan');
select throws_ok($$insert into public.plans (code,name,audience) values ('e2e_missing_fee','Missing fee','broker')$$, '23502', null, 'fee amounts have no implicit default');
select lives_ok($$insert into public.subscriptions (org_id,plan_id,status,current_period_start,current_period_end) values ('b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','cancelled',current_date,current_date+30)$$, 'admin creates a subscription');
select lives_ok($$insert into public.invoices (number,org_id,period_start,period_end) values ('E2E-BILLING-3','b2000000-0000-4000-8000-000000000001',current_date,current_date)$$, 'admin creates a draft');
select lives_ok($$update public.invoices set status='paid' where number='E2E-BILLING-3'$$, 'draft can be marked paid directly');
select lives_ok($$insert into public.invoices (number,org_id,period_start,period_end) values ('E2E-BILLING-4','b2000000-0000-4000-8000-000000000001',current_date,current_date)$$, 'admin creates another draft');
select lives_ok($$update public.invoices set status='issued' where number='E2E-BILLING-4'$$, 'second draft issued');
select lives_ok($$update public.invoices set status='void' where number='E2E-BILLING-4'$$, 'issued can be voided');
select lives_ok($$update public.plans set monthly_fee=321 where code='e2e_billing_broker'$$, 'admin configures fee');
select lives_ok($$update public.subscriptions set current_period_end=current_date+60 where id='d2000000-0000-4000-8000-000000000001'$$, 'admin edits renewal date');
select throws_ok($$update public.subscriptions set current_period_end=current_period_start-1 where id='d2000000-0000-4000-8000-000000000001'$$, '23514', null, 'invalid dates rejected');
select throws_ok($$update public.subscriptions set plan_id='c2000000-0000-4000-8000-000000000002' where id='d2000000-0000-4000-8000-000000000001'$$, 'P0001', null, 'mismatched partner plan rejected');
select throws_ok($$update public.invoices set status='overdue' where number='E2E-BILLING-1'$$, 'P0001', null, 'overdue is not a new lifecycle state');
select lives_ok($$update public.invoices set status='issued' where number='E2E-BILLING-1'$$, 'draft can be issued');
select throws_ok($$update public.invoices set status='draft' where number='E2E-BILLING-1'$$, 'P0001', null, 'issued cannot revert to draft');
select lives_ok($$update public.invoices set status='paid' where number='E2E-BILLING-1'$$, 'issued can be paid');
select throws_ok($$update public.invoices set status='void' where number='E2E-BILLING-1'$$, 'P0001', null, 'paid cannot be voided');
select throws_ok($$update public.invoices set total=999 where number='E2E-BILLING-1'$$, 'P0001', null, 'paid snapshot immutable');
select lives_ok($$update public.invoices set status='void' where number='E2E-BILLING-2'$$, 'draft can be voided');
select throws_ok($$update public.invoices set status='paid' where number='E2E-BILLING-2'$$, 'P0001', null, 'void cannot be paid');
with changed as (delete from public.invoices returning id) select is((select count(*)::int from changed), 0, 'admin cannot delete invoice history');
reset role;
update public.feature_flags set enabled=false where key='partner_platform_fee';
set local role authenticated;
with changed as (update public.plans set monthly_fee=999 returning id) select is((select count(*)::int from changed), 0, 'flag off blocks direct API updates even for admin');
reset role;
select * from finish();
rollback;
