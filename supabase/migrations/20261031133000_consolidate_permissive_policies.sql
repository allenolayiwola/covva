-- Consolidate only overlapping PERMISSIVE policies. Restrictive policies are untouched.
-- Expand ALL and role lists before merging; preserve each original WITH CHECK fallback.
-- Auth helpers already use scalar SELECT initplans (advisor count: zero).
-- Lock each table before inspecting its policies; source guards abort on policy drift.
begin;
set local search_path = public, extensions;

-- public.applications
lock table public."applications" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'applications'
      and policyname in ('applications: customer edits draft', 'applications: staff decide'))
    is distinct from '{"applications: customer edits draft": {"policyname": "applications: customer edits draft", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) AND (status = ''draft''::application_status))", "with_check": null}, "applications: staff decide": {"policyname": "applications: staff decide", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "private.is_request_staff(request_id)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.applications; review before consolidating';
  end if;
end $guard$;
drop policy "applications: customer edits draft" on public."applications";
drop policy "applications: staff decide" on public."applications";
-- Sources: applications: customer edits draft; applications: staff decide
create policy "perf_authenticated_update" on public."applications"
  as permissive for update to "authenticated"
  using ((((customer_id = ( SELECT auth.uid() AS uid)) AND (status = 'draft'::application_status)))
    OR (private.is_request_staff(request_id)))
  with check ((((customer_id = ( SELECT auth.uid() AS uid)) AND (status = 'draft'::application_status)))
    OR (private.is_request_staff(request_id)));

-- public.appointment_requests
lock table public."appointment_requests" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'appointment_requests'
      and policyname in ('appointment requests: broker admins create', 'appointment requests: parties read', 'appointment requests: staff write'))
    is distinct from '{"appointment requests: broker admins create": {"policyname": "appointment requests: broker admins create", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "private.has_org_role(broker_org_id, ''{owner,admin}''::member_role[])"}, "appointment requests: parties read": {"policyname": "appointment requests: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ((insurer_org_id IS NOT NULL) AND (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "appointment requests: staff write": {"policyname": "appointment requests: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.appointment_requests; review before consolidating';
  end if;
end $guard$;
drop policy "appointment requests: broker admins create" on public."appointment_requests";
drop policy "appointment requests: parties read" on public."appointment_requests";
drop policy "appointment requests: staff write" on public."appointment_requests";
-- Sources: appointment requests: staff write
create policy "perf_authenticated_delete" on public."appointment_requests"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: appointment requests: broker admins create; appointment requests: staff write
create policy "perf_authenticated_insert" on public."appointment_requests"
  as permissive for insert to "authenticated"
  with check ((private.has_org_role(broker_org_id, '{owner,admin}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: appointment requests: parties read; appointment requests: staff write
create policy "perf_authenticated_select" on public."appointment_requests"
  as permissive for select to "authenticated"
  using ((((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ((insurer_org_id IS NOT NULL) AND (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: appointment requests: staff write
create policy "perf_authenticated_update" on public."appointment_requests"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.broker_disclosures
lock table public."broker_disclosures" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'broker_disclosures'
      and policyname in ('disclosures: customer acknowledges', 'disclosures: staff record broker change'))
    is distinct from '{"disclosures: customer acknowledges": {"policyname": "disclosures: customer acknowledges", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "((shown_to = ( SELECT auth.uid() AS uid)) AND private.is_request_customer(request_id) AND ((stage = ''broker_change''::text) OR (EXISTS ( SELECT 1\n   FROM requests r\n  WHERE ((r.id = broker_disclosures.request_id) AND (r.broker_org_id = broker_disclosures.broker_org_id))))))"}, "disclosures: staff record broker change": {"policyname": "disclosures: staff record broker change", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "(( SELECT private.is_platform_staff() AS is_platform_staff) AND (stage = ''broker_change''::text))"}}'::jsonb then
    raise exception 'Policy drift on public.broker_disclosures; review before consolidating';
  end if;
end $guard$;
drop policy "disclosures: customer acknowledges" on public."broker_disclosures";
drop policy "disclosures: staff record broker change" on public."broker_disclosures";
-- Sources: disclosures: customer acknowledges; disclosures: staff record broker change
create policy "perf_authenticated_insert" on public."broker_disclosures"
  as permissive for insert to "authenticated"
  with check ((((shown_to = ( SELECT auth.uid() AS uid)) AND private.is_request_customer(request_id) AND ((stage = 'broker_change'::text) OR (EXISTS ( SELECT 1
   FROM requests r
  WHERE ((r.id = broker_disclosures.request_id) AND (r.broker_org_id = broker_disclosures.broker_org_id)))))))
    OR ((( SELECT private.is_platform_staff() AS is_platform_staff) AND (stage = 'broker_change'::text))));

-- public.broker_reviews
lock table public."broker_reviews" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'broker_reviews'
      and policyname in ('broker reviews: broker reads approved', 'broker reviews: broker replies', 'broker reviews: customer reads own', 'broker reviews: staff moderate', 'broker reviews: staff read'))
    is distinct from '{"broker reviews: broker reads approved": {"policyname": "broker reviews: broker reads approved", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((status = ''approved''::text) AND (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))", "with_check": null}, "broker reviews: broker replies": {"policyname": "broker reviews: broker replies", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "((status = ''approved''::text) AND private.has_org_role(broker_org_id, ''{owner,admin,supervisor,adviser}''::member_role[]))", "with_check": "((status = ''approved''::text) AND private.has_org_role(broker_org_id, ''{owner,admin,supervisor,adviser}''::member_role[]))"}, "broker reviews: customer reads own": {"policyname": "broker reviews: customer reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(customer_id = ( SELECT auth.uid() AS uid))", "with_check": null}, "broker reviews: staff moderate": {"policyname": "broker reviews: staff moderate", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}, "broker reviews: staff read": {"policyname": "broker reviews: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.broker_reviews; review before consolidating';
  end if;
end $guard$;
drop policy "broker reviews: broker reads approved" on public."broker_reviews";
drop policy "broker reviews: broker replies" on public."broker_reviews";
drop policy "broker reviews: customer reads own" on public."broker_reviews";
drop policy "broker reviews: staff moderate" on public."broker_reviews";
drop policy "broker reviews: staff read" on public."broker_reviews";
-- Sources: broker reviews: broker reads approved; broker reviews: customer reads own; broker reviews: staff read
create policy "perf_authenticated_select" on public."broker_reviews"
  as permissive for select to "authenticated"
  using ((((status = 'approved'::text) AND (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))
    OR ((customer_id = ( SELECT auth.uid() AS uid)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: broker reviews: broker replies; broker reviews: staff moderate
create policy "perf_authenticated_update" on public."broker_reviews"
  as permissive for update to "authenticated"
  using ((((status = 'approved'::text) AND private.has_org_role(broker_org_id, '{owner,admin,supervisor,adviser}'::member_role[])))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((((status = 'approved'::text) AND private.has_org_role(broker_org_id, '{owner,admin,supervisor,adviser}'::member_role[])))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.broker_routing_rules
lock table public."broker_routing_rules" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'broker_routing_rules'
      and policyname in ('routing: broker reads own', 'routing: staff write'))
    is distinct from '{"routing: broker reads own": {"policyname": "routing: broker reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "routing: staff write": {"policyname": "routing: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.broker_routing_rules; review before consolidating';
  end if;
end $guard$;
drop policy "routing: broker reads own" on public."broker_routing_rules";
drop policy "routing: staff write" on public."broker_routing_rules";
-- Sources: routing: staff write
create policy "perf_authenticated_delete" on public."broker_routing_rules"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: routing: staff write
create policy "perf_authenticated_insert" on public."broker_routing_rules"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: routing: broker reads own; routing: staff write
create policy "perf_authenticated_select" on public."broker_routing_rules"
  as permissive for select to "authenticated"
  using ((((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: routing: staff write
create policy "perf_authenticated_update" on public."broker_routing_rules"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.broker_scorecards
lock table public."broker_scorecards" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'broker_scorecards'
      and policyname in ('broker scorecards: appointed insurers read', 'broker scorecards: broker reads own', 'broker scorecards: staff read'))
    is distinct from '{"broker scorecards: appointed insurers read": {"policyname": "broker scorecards: appointed insurers read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(EXISTS ( SELECT 1\n   FROM insurer_broker_appointments a\n  WHERE ((a.broker_org_id = broker_scorecards.broker_org_id) AND a.active AND (a.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))))", "with_check": null}, "broker scorecards: broker reads own": {"policyname": "broker scorecards: broker reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))", "with_check": null}, "broker scorecards: staff read": {"policyname": "broker scorecards: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.broker_scorecards; review before consolidating';
  end if;
end $guard$;
drop policy "broker scorecards: appointed insurers read" on public."broker_scorecards";
drop policy "broker scorecards: broker reads own" on public."broker_scorecards";
drop policy "broker scorecards: staff read" on public."broker_scorecards";
-- Sources: broker scorecards: appointed insurers read; broker scorecards: broker reads own; broker scorecards: staff read
create policy "perf_authenticated_select" on public."broker_scorecards"
  as permissive for select to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM insurer_broker_appointments a
  WHERE ((a.broker_org_id = broker_scorecards.broker_org_id) AND a.active AND (a.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))))
    OR ((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.business_invoices
lock table public."business_invoices" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'business_invoices'
      and policyname in ('business invoices: business reads', 'business invoices: staff write'))
    is distinct from '{"business invoices: business reads": {"policyname": "business invoices: business reads", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(private.has_org_role(business_org_id, ''{owner,admin,finance,viewer}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "business invoices: staff write": {"policyname": "business invoices: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.business_invoices; review before consolidating';
  end if;
end $guard$;
drop policy "business invoices: business reads" on public."business_invoices";
drop policy "business invoices: staff write" on public."business_invoices";
-- Sources: business invoices: staff write
create policy "perf_authenticated_delete" on public."business_invoices"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: business invoices: staff write
create policy "perf_authenticated_insert" on public."business_invoices"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: business invoices: business reads; business invoices: staff write
create policy "perf_authenticated_select" on public."business_invoices"
  as permissive for select to "authenticated"
  using (((private.has_org_role(business_org_id, '{owner,admin,finance,viewer}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: business invoices: staff write
create policy "perf_authenticated_update" on public."business_invoices"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.claims
lock table public."claims" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'claims'
      and policyname in ('claims: parties read', 'claims: sponsor, reporter and beneficiary read', 'claims: welfare member and beneficiaries read'))
    is distinct from '{"claims: parties read": {"policyname": "claims: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "claims: sponsor, reporter and beneficiary read": {"policyname": "claims: sponsor, reporter and beneficiary read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((reported_by_user_id = ( SELECT auth.uid() AS uid)) OR private.is_policy_sponsor(policy_id) OR private.is_policy_beneficiary(policy_id))", "with_check": null}, "claims: welfare member and beneficiaries read": {"policyname": "claims: welfare member and beneficiaries read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((welfare_member_id IS NOT NULL) AND (private.is_welfare_member_self(welfare_member_id) OR private.is_welfare_beneficiary_user(welfare_member_id)))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.claims; review before consolidating';
  end if;
end $guard$;
drop policy "claims: parties read" on public."claims";
drop policy "claims: sponsor, reporter and beneficiary read" on public."claims";
drop policy "claims: welfare member and beneficiaries read" on public."claims";
-- Sources: claims: parties read; claims: sponsor, reporter and beneficiary read; claims: welfare member and beneficiaries read
create policy "perf_authenticated_select" on public."claims"
  as permissive for select to "authenticated"
  using ((((customer_id = ( SELECT auth.uid() AS uid)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (((reported_by_user_id = ( SELECT auth.uid() AS uid)) OR private.is_policy_sponsor(policy_id) OR private.is_policy_beneficiary(policy_id)))
    OR (((welfare_member_id IS NOT NULL) AND (private.is_welfare_member_self(welfare_member_id) OR private.is_welfare_beneficiary_user(welfare_member_id)))));

-- public.consents
lock table public."consents" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'consents'
      and policyname in ('consents: own', 'consents: servicing partners read'))
    is distinct from '{"consents: own": {"policyname": "consents: own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "consents: servicing partners read": {"policyname": "consents: servicing partners read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "private.can_view_customer(user_id)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.consents; review before consolidating';
  end if;
end $guard$;
drop policy "consents: own" on public."consents";
drop policy "consents: servicing partners read" on public."consents";
-- Sources: consents: own; consents: servicing partners read
create policy "perf_authenticated_select" on public."consents"
  as permissive for select to "authenticated"
  using ((((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (private.can_view_customer(user_id)));

-- public.crm_accounts
lock table public."crm_accounts" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'crm_accounts'
      and policyname in ('crm_accounts: partnerships write', 'crm_accounts: staff read'))
    is distinct from '{"crm_accounts: partnerships write": {"policyname": "crm_accounts: partnerships write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_crm_writer() AS is_crm_writer)", "with_check": "( SELECT private.is_crm_writer() AS is_crm_writer)"}, "crm_accounts: staff read": {"policyname": "crm_accounts: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.crm_accounts; review before consolidating';
  end if;
end $guard$;
drop policy "crm_accounts: partnerships write" on public."crm_accounts";
drop policy "crm_accounts: staff read" on public."crm_accounts";
-- Sources: crm_accounts: partnerships write
create policy "perf_authenticated_delete" on public."crm_accounts"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_accounts: partnerships write
create policy "perf_authenticated_insert" on public."crm_accounts"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_accounts: partnerships write; crm_accounts: staff read
create policy "perf_authenticated_select" on public."crm_accounts"
  as permissive for select to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: crm_accounts: partnerships write
create policy "perf_authenticated_update" on public."crm_accounts"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)))
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));

-- public.crm_attachments
lock table public."crm_attachments" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'crm_attachments'
      and policyname in ('crm_attachments: partnerships write', 'crm_attachments: staff read'))
    is distinct from '{"crm_attachments: partnerships write": {"policyname": "crm_attachments: partnerships write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_crm_writer() AS is_crm_writer)", "with_check": "( SELECT private.is_crm_writer() AS is_crm_writer)"}, "crm_attachments: staff read": {"policyname": "crm_attachments: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.crm_attachments; review before consolidating';
  end if;
end $guard$;
drop policy "crm_attachments: partnerships write" on public."crm_attachments";
drop policy "crm_attachments: staff read" on public."crm_attachments";
-- Sources: crm_attachments: partnerships write
create policy "perf_authenticated_delete" on public."crm_attachments"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_attachments: partnerships write
create policy "perf_authenticated_insert" on public."crm_attachments"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_attachments: partnerships write; crm_attachments: staff read
create policy "perf_authenticated_select" on public."crm_attachments"
  as permissive for select to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: crm_attachments: partnerships write
create policy "perf_authenticated_update" on public."crm_attachments"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)))
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));

-- public.crm_meetings
lock table public."crm_meetings" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'crm_meetings'
      and policyname in ('crm_meetings: partnerships write', 'crm_meetings: staff read'))
    is distinct from '{"crm_meetings: partnerships write": {"policyname": "crm_meetings: partnerships write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_crm_writer() AS is_crm_writer)", "with_check": "( SELECT private.is_crm_writer() AS is_crm_writer)"}, "crm_meetings: staff read": {"policyname": "crm_meetings: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.crm_meetings; review before consolidating';
  end if;
end $guard$;
drop policy "crm_meetings: partnerships write" on public."crm_meetings";
drop policy "crm_meetings: staff read" on public."crm_meetings";
-- Sources: crm_meetings: partnerships write
create policy "perf_authenticated_delete" on public."crm_meetings"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_meetings: partnerships write
create policy "perf_authenticated_insert" on public."crm_meetings"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_meetings: partnerships write; crm_meetings: staff read
create policy "perf_authenticated_select" on public."crm_meetings"
  as permissive for select to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: crm_meetings: partnerships write
create policy "perf_authenticated_update" on public."crm_meetings"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)))
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));

-- public.crm_notes
lock table public."crm_notes" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'crm_notes'
      and policyname in ('crm_notes: partnerships write', 'crm_notes: staff read'))
    is distinct from '{"crm_notes: partnerships write": {"policyname": "crm_notes: partnerships write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_crm_writer() AS is_crm_writer)", "with_check": "( SELECT private.is_crm_writer() AS is_crm_writer)"}, "crm_notes: staff read": {"policyname": "crm_notes: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.crm_notes; review before consolidating';
  end if;
end $guard$;
drop policy "crm_notes: partnerships write" on public."crm_notes";
drop policy "crm_notes: staff read" on public."crm_notes";
-- Sources: crm_notes: partnerships write
create policy "perf_authenticated_delete" on public."crm_notes"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_notes: partnerships write
create policy "perf_authenticated_insert" on public."crm_notes"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_notes: partnerships write; crm_notes: staff read
create policy "perf_authenticated_select" on public."crm_notes"
  as permissive for select to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: crm_notes: partnerships write
create policy "perf_authenticated_update" on public."crm_notes"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)))
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));

-- public.crm_stage_events
lock table public."crm_stage_events" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'crm_stage_events'
      and policyname in ('crm_stage_events: partnerships write', 'crm_stage_events: staff read'))
    is distinct from '{"crm_stage_events: partnerships write": {"policyname": "crm_stage_events: partnerships write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_crm_writer() AS is_crm_writer)", "with_check": "( SELECT private.is_crm_writer() AS is_crm_writer)"}, "crm_stage_events: staff read": {"policyname": "crm_stage_events: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.crm_stage_events; review before consolidating';
  end if;
end $guard$;
drop policy "crm_stage_events: partnerships write" on public."crm_stage_events";
drop policy "crm_stage_events: staff read" on public."crm_stage_events";
-- Sources: crm_stage_events: partnerships write
create policy "perf_authenticated_delete" on public."crm_stage_events"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_stage_events: partnerships write
create policy "perf_authenticated_insert" on public."crm_stage_events"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_stage_events: partnerships write; crm_stage_events: staff read
create policy "perf_authenticated_select" on public."crm_stage_events"
  as permissive for select to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: crm_stage_events: partnerships write
create policy "perf_authenticated_update" on public."crm_stage_events"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)))
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));

-- public.crm_tasks
lock table public."crm_tasks" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'crm_tasks'
      and policyname in ('crm_tasks: partnerships write', 'crm_tasks: staff read'))
    is distinct from '{"crm_tasks: partnerships write": {"policyname": "crm_tasks: partnerships write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_crm_writer() AS is_crm_writer)", "with_check": "( SELECT private.is_crm_writer() AS is_crm_writer)"}, "crm_tasks: staff read": {"policyname": "crm_tasks: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.crm_tasks; review before consolidating';
  end if;
end $guard$;
drop policy "crm_tasks: partnerships write" on public."crm_tasks";
drop policy "crm_tasks: staff read" on public."crm_tasks";
-- Sources: crm_tasks: partnerships write
create policy "perf_authenticated_delete" on public."crm_tasks"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_tasks: partnerships write
create policy "perf_authenticated_insert" on public."crm_tasks"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));
-- Sources: crm_tasks: partnerships write; crm_tasks: staff read
create policy "perf_authenticated_select" on public."crm_tasks"
  as permissive for select to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: crm_tasks: partnerships write
create policy "perf_authenticated_update" on public."crm_tasks"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_crm_writer() AS is_crm_writer)))
  with check ((( SELECT private.is_crm_writer() AS is_crm_writer)));

-- public.customer_broker_assignments
lock table public."customer_broker_assignments" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'customer_broker_assignments'
      and policyname in ('broker assignments: broker ends own', 'broker assignments: broker imports own clients', 'broker assignments: parties read', 'broker assignments: staff write'))
    is distinct from '{"broker assignments: broker ends own": {"policyname": "broker assignments: broker ends own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "private.has_org_role(broker_org_id, ''{owner,admin,supervisor}''::member_role[])", "with_check": "private.has_org_role(broker_org_id, ''{owner,admin,supervisor}''::member_role[])"}, "broker assignments: broker imports own clients": {"policyname": "broker assignments: broker imports own clients", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "((source = ''broker_import''::text) AND private.has_org_role(broker_org_id, ''{owner,admin,supervisor}''::member_role[]))"}, "broker assignments: parties read": {"policyname": "broker assignments: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "broker assignments: staff write": {"policyname": "broker assignments: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.customer_broker_assignments; review before consolidating';
  end if;
end $guard$;
drop policy "broker assignments: broker ends own" on public."customer_broker_assignments";
drop policy "broker assignments: broker imports own clients" on public."customer_broker_assignments";
drop policy "broker assignments: parties read" on public."customer_broker_assignments";
drop policy "broker assignments: staff write" on public."customer_broker_assignments";
-- Sources: broker assignments: staff write
create policy "perf_authenticated_delete" on public."customer_broker_assignments"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: broker assignments: broker imports own clients; broker assignments: staff write
create policy "perf_authenticated_insert" on public."customer_broker_assignments"
  as permissive for insert to "authenticated"
  with check ((((source = 'broker_import'::text) AND private.has_org_role(broker_org_id, '{owner,admin,supervisor}'::member_role[])))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: broker assignments: parties read; broker assignments: staff write
create policy "perf_authenticated_select" on public."customer_broker_assignments"
  as permissive for select to "authenticated"
  using ((((customer_id = ( SELECT auth.uid() AS uid)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: broker assignments: broker ends own; broker assignments: staff write
create policy "perf_authenticated_update" on public."customer_broker_assignments"
  as permissive for update to "authenticated"
  using ((private.has_org_role(broker_org_id, '{owner,admin,supervisor}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((private.has_org_role(broker_org_id, '{owner,admin,supervisor}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.distribution_partners
lock table public."distribution_partners" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'distribution_partners'
      and policyname in ('distribution_partners: members read own', 'distribution_partners: staff read', 'distribution_partners: staff write'))
    is distinct from '{"distribution_partners: members read own": {"policyname": "distribution_partners: members read own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(org_id IN ( SELECT private.user_org_ids() AS user_org_ids))", "with_check": null}, "distribution_partners: staff read": {"policyname": "distribution_partners: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}, "distribution_partners: staff write": {"policyname": "distribution_partners: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.distribution_partners; review before consolidating';
  end if;
end $guard$;
drop policy "distribution_partners: members read own" on public."distribution_partners";
drop policy "distribution_partners: staff read" on public."distribution_partners";
drop policy "distribution_partners: staff write" on public."distribution_partners";
-- Sources: distribution_partners: staff write
create policy "perf_authenticated_delete" on public."distribution_partners"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: distribution_partners: staff write
create policy "perf_authenticated_insert" on public."distribution_partners"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: distribution_partners: members read own; distribution_partners: staff read; distribution_partners: staff write
create policy "perf_authenticated_select" on public."distribution_partners"
  as permissive for select to "authenticated"
  using (((org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: distribution_partners: staff write
create policy "perf_authenticated_update" on public."distribution_partners"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.document_templates
lock table public."document_templates" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'document_templates'
      and policyname in ('document_templates: insurer write', 'document_templates: read'))
    is distinct from '{"document_templates: insurer write": {"policyname": "document_templates: insurer write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "private.can_manage_version(product_version_id)", "with_check": "(private.can_manage_version(product_version_id) AND ((status = ''draft''::text) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))"}, "document_templates: read": {"policyname": "document_templates: read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(private.can_view_version(product_version_id) OR (( SELECT private.is_partner_user() AS is_partner_user) AND (status = ''approved''::text) AND private.version_is_approved(product_version_id)))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.document_templates; review before consolidating';
  end if;
end $guard$;
drop policy "document_templates: insurer write" on public."document_templates";
drop policy "document_templates: read" on public."document_templates";
-- Sources: document_templates: insurer write
create policy "perf_authenticated_delete" on public."document_templates"
  as permissive for delete to "authenticated"
  using ((private.can_manage_version(product_version_id)));
-- Sources: document_templates: insurer write
create policy "perf_authenticated_insert" on public."document_templates"
  as permissive for insert to "authenticated"
  with check (((private.can_manage_version(product_version_id) AND ((status = 'draft'::text) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))));
-- Sources: document_templates: insurer write; document_templates: read
create policy "perf_authenticated_select" on public."document_templates"
  as permissive for select to "authenticated"
  using ((private.can_manage_version(product_version_id))
    OR ((private.can_view_version(product_version_id) OR (( SELECT private.is_partner_user() AS is_partner_user) AND (status = 'approved'::text) AND private.version_is_approved(product_version_id)))));
-- Sources: document_templates: insurer write
create policy "perf_authenticated_update" on public."document_templates"
  as permissive for update to "authenticated"
  using ((private.can_manage_version(product_version_id)))
  with check (((private.can_manage_version(product_version_id) AND ((status = 'draft'::text) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))));

-- public.feature_flags
lock table public."feature_flags" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'feature_flags'
      and policyname in ('flags: read', 'flags: staff write'))
    is distinct from '{"flags: read": {"policyname": "flags: read", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "true", "with_check": null}, "flags: staff write": {"policyname": "flags: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.feature_flags; review before consolidating';
  end if;
end $guard$;
drop policy "flags: read" on public."feature_flags";
drop policy "flags: staff write" on public."feature_flags";
-- Sources: flags: read
create policy "perf_anon_select" on public."feature_flags"
  as permissive for select to "anon"
  using ((true));
-- Sources: flags: staff write
create policy "perf_authenticated_delete" on public."feature_flags"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: flags: staff write
create policy "perf_authenticated_insert" on public."feature_flags"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: flags: read; flags: staff write
create policy "perf_authenticated_select" on public."feature_flags"
  as permissive for select to "authenticated"
  using ((true)
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: flags: staff write
create policy "perf_authenticated_update" on public."feature_flags"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.household_members
lock table public."household_members" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'household_members'
      and policyname in ('household members: household can read', 'household members: owner writes'))
    is distinct from '{"household members: household can read": {"policyname": "household members: household can read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(private.is_household_owner(household_id) OR (user_id = ( SELECT auth.uid() AS uid)) OR ((beneficiary_id IS NOT NULL) AND private.is_beneficiary_user(beneficiary_id)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "household members: owner writes": {"policyname": "household members: owner writes", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "(private.is_household_owner(household_id) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": "(private.is_household_owner(household_id) OR ( SELECT private.is_platform_staff() AS is_platform_staff))"}}'::jsonb then
    raise exception 'Policy drift on public.household_members; review before consolidating';
  end if;
end $guard$;
drop policy "household members: household can read" on public."household_members";
drop policy "household members: owner writes" on public."household_members";
-- Sources: household members: owner writes
create policy "perf_authenticated_delete" on public."household_members"
  as permissive for delete to "authenticated"
  using (((private.is_household_owner(household_id) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: household members: owner writes
create policy "perf_authenticated_insert" on public."household_members"
  as permissive for insert to "authenticated"
  with check (((private.is_household_owner(household_id) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: household members: household can read; household members: owner writes
create policy "perf_authenticated_select" on public."household_members"
  as permissive for select to "authenticated"
  using (((private.is_household_owner(household_id) OR (user_id = ( SELECT auth.uid() AS uid)) OR ((beneficiary_id IS NOT NULL) AND private.is_beneficiary_user(beneficiary_id)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR ((private.is_household_owner(household_id) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: household members: owner writes
create policy "perf_authenticated_update" on public."household_members"
  as permissive for update to "authenticated"
  using (((private.is_household_owner(household_id) OR ( SELECT private.is_platform_staff() AS is_platform_staff))))
  with check (((private.is_household_owner(household_id) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));

-- public.households
lock table public."households" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'households'
      and policyname in ('households: owner and members read', 'households: owner writes'))
    is distinct from '{"households: owner and members read": {"policyname": "households: owner and members read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff) OR private.is_household_member(id))", "with_check": null}, "households: owner writes": {"policyname": "households: owner writes", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": "((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))"}}'::jsonb then
    raise exception 'Policy drift on public.households; review before consolidating';
  end if;
end $guard$;
drop policy "households: owner and members read" on public."households";
drop policy "households: owner writes" on public."households";
-- Sources: households: owner writes
create policy "perf_authenticated_delete" on public."households"
  as permissive for delete to "authenticated"
  using ((((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: households: owner writes
create policy "perf_authenticated_insert" on public."households"
  as permissive for insert to "authenticated"
  with check ((((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: households: owner and members read; households: owner writes
create policy "perf_authenticated_select" on public."households"
  as permissive for select to "authenticated"
  using ((((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff) OR private.is_household_member(id)))
    OR (((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: households: owner writes
create policy "perf_authenticated_update" on public."households"
  as permissive for update to "authenticated"
  using ((((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))))
  with check ((((owner_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));

-- public.instalment_schedules
lock table public."instalment_schedules" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'instalment_schedules'
      and policyname in ('instalment schedules: parties read', 'instalment schedules: staff manage'))
    is distinct from '{"instalment schedules: parties read": {"policyname": "instalment schedules: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) OR (payer_user_id = ( SELECT auth.uid() AS uid)) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "instalment schedules: staff manage": {"policyname": "instalment schedules: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.instalment_schedules; review before consolidating';
  end if;
end $guard$;
drop policy "instalment schedules: parties read" on public."instalment_schedules";
drop policy "instalment schedules: staff manage" on public."instalment_schedules";
-- Sources: instalment schedules: staff manage
create policy "perf_authenticated_delete" on public."instalment_schedules"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: instalment schedules: staff manage
create policy "perf_authenticated_insert" on public."instalment_schedules"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: instalment schedules: parties read; instalment schedules: staff manage
create policy "perf_authenticated_select" on public."instalment_schedules"
  as permissive for select to "authenticated"
  using ((((customer_id = ( SELECT auth.uid() AS uid)) OR (payer_user_id = ( SELECT auth.uid() AS uid)) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: instalment schedules: staff manage
create policy "perf_authenticated_update" on public."instalment_schedules"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.instalments
lock table public."instalments" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'instalments'
      and policyname in ('instalments: parties read', 'instalments: staff manage'))
    is distinct from '{"instalments: parties read": {"policyname": "instalments: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(( SELECT private.is_platform_staff() AS is_platform_staff) OR (EXISTS ( SELECT 1\n   FROM instalment_schedules s\n  WHERE ((s.id = instalments.schedule_id) AND ((s.customer_id = ( SELECT auth.uid() AS uid)) OR (s.payer_user_id = ( SELECT auth.uid() AS uid)) OR (s.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))))))", "with_check": null}, "instalments: staff manage": {"policyname": "instalments: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.instalments; review before consolidating';
  end if;
end $guard$;
drop policy "instalments: parties read" on public."instalments";
drop policy "instalments: staff manage" on public."instalments";
-- Sources: instalments: staff manage
create policy "perf_authenticated_delete" on public."instalments"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: instalments: staff manage
create policy "perf_authenticated_insert" on public."instalments"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: instalments: parties read; instalments: staff manage
create policy "perf_authenticated_select" on public."instalments"
  as permissive for select to "authenticated"
  using (((( SELECT private.is_platform_staff() AS is_platform_staff) OR (EXISTS ( SELECT 1
   FROM instalment_schedules s
  WHERE ((s.id = instalments.schedule_id) AND ((s.customer_id = ( SELECT auth.uid() AS uid)) OR (s.payer_user_id = ( SELECT auth.uid() AS uid)) OR (s.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: instalments: staff manage
create policy "perf_authenticated_update" on public."instalments"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.insurer_broker_appointments
lock table public."insurer_broker_appointments" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'insurer_broker_appointments'
      and policyname in ('appointments: parties read', 'appointments: staff write'))
    is distinct from '{"appointments: parties read": {"policyname": "appointments: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "appointments: staff write": {"policyname": "appointments: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.insurer_broker_appointments; review before consolidating';
  end if;
end $guard$;
drop policy "appointments: parties read" on public."insurer_broker_appointments";
drop policy "appointments: staff write" on public."insurer_broker_appointments";
-- Sources: appointments: staff write
create policy "perf_authenticated_delete" on public."insurer_broker_appointments"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: appointments: staff write
create policy "perf_authenticated_insert" on public."insurer_broker_appointments"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: appointments: parties read; appointments: staff write
create policy "perf_authenticated_select" on public."insurer_broker_appointments"
  as permissive for select to "authenticated"
  using ((((insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: appointments: staff write
create policy "perf_authenticated_update" on public."insurer_broker_appointments"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.insurer_line_integrations
lock table public."insurer_line_integrations" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'insurer_line_integrations'
      and policyname in ('line integrations: insurer admins update', 'line integrations: parties read', 'line integrations: staff write'))
    is distinct from '{"line integrations: insurer admins update": {"policyname": "line integrations: insurer admins update", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "private.has_org_role(insurer_org_id, ''{owner,admin}''::member_role[])", "with_check": "private.has_org_role(insurer_org_id, ''{owner,admin}''::member_role[])"}, "line integrations: parties read": {"policyname": "line integrations: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff) OR (EXISTS ( SELECT 1\n   FROM insurer_broker_appointments a\n  WHERE ((a.insurer_org_id = insurer_line_integrations.insurer_org_id) AND a.active AND (a.broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))) OR (nominated_broker_org_ids && ARRAY( SELECT private.user_org_ids() AS user_org_ids)))", "with_check": null}, "line integrations: staff write": {"policyname": "line integrations: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.insurer_line_integrations; review before consolidating';
  end if;
end $guard$;
drop policy "line integrations: insurer admins update" on public."insurer_line_integrations";
drop policy "line integrations: parties read" on public."insurer_line_integrations";
drop policy "line integrations: staff write" on public."insurer_line_integrations";
-- Sources: line integrations: staff write
create policy "perf_authenticated_delete" on public."insurer_line_integrations"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: line integrations: staff write
create policy "perf_authenticated_insert" on public."insurer_line_integrations"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: line integrations: parties read; line integrations: staff write
create policy "perf_authenticated_select" on public."insurer_line_integrations"
  as permissive for select to "authenticated"
  using ((((insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff) OR (EXISTS ( SELECT 1
   FROM insurer_broker_appointments a
  WHERE ((a.insurer_org_id = insurer_line_integrations.insurer_org_id) AND a.active AND (a.broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))) OR (nominated_broker_org_ids && ARRAY( SELECT private.user_org_ids() AS user_org_ids))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: line integrations: insurer admins update; line integrations: staff write
create policy "perf_authenticated_update" on public."insurer_line_integrations"
  as permissive for update to "authenticated"
  using ((private.has_org_role(insurer_org_id, '{owner,admin}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((private.has_org_role(insurer_org_id, '{owner,admin}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.invoices
lock table public."invoices" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'invoices'
      and policyname in ('invoices: org read', 'invoices: staff write'))
    is distinct from '{"invoices: org read": {"policyname": "invoices: org read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(private.has_org_role(org_id, ''{owner,admin,finance}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "invoices: staff write": {"policyname": "invoices: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.invoices; review before consolidating';
  end if;
end $guard$;
drop policy "invoices: org read" on public."invoices";
drop policy "invoices: staff write" on public."invoices";
-- Sources: invoices: staff write
create policy "perf_authenticated_delete" on public."invoices"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: invoices: staff write
create policy "perf_authenticated_insert" on public."invoices"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: invoices: org read; invoices: staff write
create policy "perf_authenticated_select" on public."invoices"
  as permissive for select to "authenticated"
  using (((private.has_org_role(org_id, '{owner,admin,finance}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: invoices: staff write
create policy "perf_authenticated_update" on public."invoices"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.issuance_jobs
lock table public."issuance_jobs" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'issuance_jobs'
      and policyname in ('issuance jobs: insurer reads own', 'issuance jobs: insurer underwriters update own', 'issuance jobs: staff manage'))
    is distinct from '{"issuance jobs: insurer reads own": {"policyname": "issuance jobs: insurer reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(( SELECT private.is_platform_staff() AS is_platform_staff) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))", "with_check": null}, "issuance jobs: insurer underwriters update own": {"policyname": "issuance jobs: insurer underwriters update own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "private.has_org_role(insurer_org_id, ''{owner,admin,underwriter}''::member_role[])", "with_check": "private.has_org_role(insurer_org_id, ''{owner,admin,underwriter}''::member_role[])"}, "issuance jobs: staff manage": {"policyname": "issuance jobs: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.issuance_jobs; review before consolidating';
  end if;
end $guard$;
drop policy "issuance jobs: insurer reads own" on public."issuance_jobs";
drop policy "issuance jobs: insurer underwriters update own" on public."issuance_jobs";
drop policy "issuance jobs: staff manage" on public."issuance_jobs";
-- Sources: issuance jobs: staff manage
create policy "perf_authenticated_delete" on public."issuance_jobs"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: issuance jobs: staff manage
create policy "perf_authenticated_insert" on public."issuance_jobs"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: issuance jobs: insurer reads own; issuance jobs: staff manage
create policy "perf_authenticated_select" on public."issuance_jobs"
  as permissive for select to "authenticated"
  using (((( SELECT private.is_platform_staff() AS is_platform_staff) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: issuance jobs: insurer underwriters update own; issuance jobs: staff manage
create policy "perf_authenticated_update" on public."issuance_jobs"
  as permissive for update to "authenticated"
  using ((private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.leads
lock table public."leads" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'leads'
      and policyname in ('leads: anyone submits', 'leads: staff manage'))
    is distinct from '{"leads: anyone submits": {"policyname": "leads: anyone submits", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "INSERT", "qual": null, "with_check": "(status = ''new''::text)"}, "leads: staff manage": {"policyname": "leads: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.leads; review before consolidating';
  end if;
end $guard$;
drop policy "leads: anyone submits" on public."leads";
drop policy "leads: staff manage" on public."leads";
-- Sources: leads: anyone submits
create policy "perf_anon_insert" on public."leads"
  as permissive for insert to "anon"
  with check (((status = 'new'::text)));
-- Sources: leads: staff manage
create policy "perf_authenticated_delete" on public."leads"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: leads: anyone submits; leads: staff manage
create policy "perf_authenticated_insert" on public."leads"
  as permissive for insert to "authenticated"
  with check (((status = 'new'::text))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: leads: staff manage
create policy "perf_authenticated_select" on public."leads"
  as permissive for select to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: leads: staff manage
create policy "perf_authenticated_update" on public."leads"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.loyalty_rule_sets
lock table public."loyalty_rule_sets" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'loyalty_rule_sets'
      and policyname in ('loyalty_rule_sets: insurer reads own', 'loyalty_rule_sets: signed-in read published', 'loyalty_rule_sets: staff read'))
    is distinct from '{"loyalty_rule_sets: insurer reads own": {"policyname": "loyalty_rule_sets: insurer reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((insurer_org_id IS NOT NULL) AND (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))", "with_check": null}, "loyalty_rule_sets: signed-in read published": {"policyname": "loyalty_rule_sets: signed-in read published", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(status = ''published''::text)", "with_check": null}, "loyalty_rule_sets: staff read": {"policyname": "loyalty_rule_sets: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.loyalty_rule_sets; review before consolidating';
  end if;
end $guard$;
drop policy "loyalty_rule_sets: insurer reads own" on public."loyalty_rule_sets";
drop policy "loyalty_rule_sets: signed-in read published" on public."loyalty_rule_sets";
drop policy "loyalty_rule_sets: staff read" on public."loyalty_rule_sets";
-- Sources: loyalty_rule_sets: insurer reads own; loyalty_rule_sets: signed-in read published; loyalty_rule_sets: staff read
create policy "perf_authenticated_select" on public."loyalty_rule_sets"
  as permissive for select to "authenticated"
  using ((((insurer_org_id IS NOT NULL) AND (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))
    OR ((status = 'published'::text))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.memberships
lock table public."memberships" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'memberships'
      and policyname in ('memberships: org admins manage', 'memberships: read own org'))
    is distinct from '{"memberships: org admins manage": {"policyname": "memberships: org admins manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "(private.has_org_role(org_id, ''{owner,admin}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": "(private.has_org_role(org_id, ''{owner,admin}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))"}, "memberships: read own org": {"policyname": "memberships: read own org", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(((user_id = ( SELECT auth.uid() AS uid)) AND active) OR (org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.memberships; review before consolidating';
  end if;
end $guard$;
drop policy "memberships: org admins manage" on public."memberships";
drop policy "memberships: read own org" on public."memberships";
-- Sources: memberships: org admins manage
create policy "perf_authenticated_delete" on public."memberships"
  as permissive for delete to "authenticated"
  using (((private.has_org_role(org_id, '{owner,admin}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: memberships: org admins manage
create policy "perf_authenticated_insert" on public."memberships"
  as permissive for insert to "authenticated"
  with check (((private.has_org_role(org_id, '{owner,admin}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: memberships: org admins manage; memberships: read own org
create policy "perf_authenticated_select" on public."memberships"
  as permissive for select to "authenticated"
  using (((private.has_org_role(org_id, '{owner,admin}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR ((((user_id = ( SELECT auth.uid() AS uid)) AND active) OR (org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: memberships: org admins manage
create policy "perf_authenticated_update" on public."memberships"
  as permissive for update to "authenticated"
  using (((private.has_org_role(org_id, '{owner,admin}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))))
  with check (((private.has_org_role(org_id, '{owner,admin}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));

-- public.micro_sessions
lock table public."micro_sessions" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'micro_sessions'
      and policyname in ('micro sessions: parties read', 'micro sessions: staff manage'))
    is distinct from '{"micro sessions: parties read": {"policyname": "micro sessions: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff) OR (EXISTS ( SELECT 1\n   FROM policies p\n  WHERE ((p.id = micro_sessions.policy_id) AND (p.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))))", "with_check": null}, "micro sessions: staff manage": {"policyname": "micro sessions: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.micro_sessions; review before consolidating';
  end if;
end $guard$;
drop policy "micro sessions: parties read" on public."micro_sessions";
drop policy "micro sessions: staff manage" on public."micro_sessions";
-- Sources: micro sessions: staff manage
create policy "perf_authenticated_delete" on public."micro_sessions"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: micro sessions: staff manage
create policy "perf_authenticated_insert" on public."micro_sessions"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: micro sessions: parties read; micro sessions: staff manage
create policy "perf_authenticated_select" on public."micro_sessions"
  as permissive for select to "authenticated"
  using ((((customer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff) OR (EXISTS ( SELECT 1
   FROM policies p
  WHERE ((p.id = micro_sessions.policy_id) AND (p.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: micro sessions: staff manage
create policy "perf_authenticated_update" on public."micro_sessions"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.order_offers
lock table public."order_offers" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'order_offers'
      and policyname in ('order offers: broker reads own', 'order offers: staff write'))
    is distinct from '{"order offers: broker reads own": {"policyname": "order offers: broker reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "order offers: staff write": {"policyname": "order offers: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.order_offers; review before consolidating';
  end if;
end $guard$;
drop policy "order offers: broker reads own" on public."order_offers";
drop policy "order offers: staff write" on public."order_offers";
-- Sources: order offers: staff write
create policy "perf_authenticated_delete" on public."order_offers"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: order offers: staff write
create policy "perf_authenticated_insert" on public."order_offers"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: order offers: broker reads own; order offers: staff write
create policy "perf_authenticated_select" on public."order_offers"
  as permissive for select to "authenticated"
  using ((((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: order offers: staff write
create policy "perf_authenticated_update" on public."order_offers"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.order_routing
lock table public."order_routing" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'order_routing'
      and policyname in ('order routing: parties read', 'order routing: staff write'))
    is distinct from '{"order routing: parties read": {"policyname": "order routing: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(( SELECT private.is_platform_staff() AS is_platform_staff) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ((mode = ''insurer_direct''::text) AND (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))) OR (private.request_broker_org(request_id) IN ( SELECT private.user_org_ids() AS user_org_ids)) OR private.has_open_offer(request_id))", "with_check": null}, "order routing: staff write": {"policyname": "order routing: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.order_routing; review before consolidating';
  end if;
end $guard$;
drop policy "order routing: parties read" on public."order_routing";
drop policy "order routing: staff write" on public."order_routing";
-- Sources: order routing: staff write
create policy "perf_authenticated_delete" on public."order_routing"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: order routing: staff write
create policy "perf_authenticated_insert" on public."order_routing"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: order routing: parties read; order routing: staff write
create policy "perf_authenticated_select" on public."order_routing"
  as permissive for select to "authenticated"
  using (((( SELECT private.is_platform_staff() AS is_platform_staff) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ((mode = 'insurer_direct'::text) AND (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))) OR (private.request_broker_org(request_id) IN ( SELECT private.user_org_ids() AS user_org_ids)) OR private.has_open_offer(request_id)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: order routing: staff write
create policy "perf_authenticated_update" on public."order_routing"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.organizations
lock table public."organizations" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'organizations'
      and policyname in ('orgs: members read own', 'orgs: public directory of active brokers and insurers'))
    is distinct from '{"orgs: members read own": {"policyname": "orgs: members read own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "orgs: public directory of active brokers and insurers": {"policyname": "orgs: public directory of active brokers and insurers", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "((status = ''active''::org_status) AND (type = ANY (ARRAY[''broker''::org_type, ''insurer''::org_type])))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.organizations; review before consolidating';
  end if;
end $guard$;
drop policy "orgs: members read own" on public."organizations";
drop policy "orgs: public directory of active brokers and insurers" on public."organizations";
-- Sources: orgs: public directory of active brokers and insurers
create policy "perf_anon_select" on public."organizations"
  as permissive for select to "anon"
  using ((((status = 'active'::org_status) AND (type = ANY (ARRAY['broker'::org_type, 'insurer'::org_type])))));
-- Sources: orgs: members read own; orgs: public directory of active brokers and insurers
create policy "perf_authenticated_select" on public."organizations"
  as permissive for select to "authenticated"
  using ((((id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (((status = 'active'::org_status) AND (type = ANY (ARRAY['broker'::org_type, 'insurer'::org_type])))));

-- public.partner_applications
lock table public."partner_applications" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'partner_applications'
      and policyname in ('applications: applicant creates draft', 'applications: applicant edits open', 'applications: applicant reads own', 'applications: staff write'))
    is distinct from '{"applications: applicant creates draft": {"policyname": "applications: applicant creates draft", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "((applicant_user_id = ( SELECT auth.uid() AS uid)) AND (status = ''draft''::text))"}, "applications: applicant edits open": {"policyname": "applications: applicant edits open", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "((applicant_user_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY[''draft''::text, ''needs_changes''::text])))", "with_check": "((applicant_user_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY[''draft''::text, ''needs_changes''::text, ''submitted''::text])))"}, "applications: applicant reads own": {"policyname": "applications: applicant reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((applicant_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "applications: staff write": {"policyname": "applications: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.partner_applications; review before consolidating';
  end if;
end $guard$;
drop policy "applications: applicant creates draft" on public."partner_applications";
drop policy "applications: applicant edits open" on public."partner_applications";
drop policy "applications: applicant reads own" on public."partner_applications";
drop policy "applications: staff write" on public."partner_applications";
-- Sources: applications: staff write
create policy "perf_authenticated_delete" on public."partner_applications"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: applications: applicant creates draft; applications: staff write
create policy "perf_authenticated_insert" on public."partner_applications"
  as permissive for insert to "authenticated"
  with check ((((applicant_user_id = ( SELECT auth.uid() AS uid)) AND (status = 'draft'::text)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: applications: applicant reads own; applications: staff write
create policy "perf_authenticated_select" on public."partner_applications"
  as permissive for select to "authenticated"
  using ((((applicant_user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: applications: applicant edits open; applications: staff write
create policy "perf_authenticated_update" on public."partner_applications"
  as permissive for update to "authenticated"
  using ((((applicant_user_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['draft'::text, 'needs_changes'::text]))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((((applicant_user_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['draft'::text, 'needs_changes'::text, 'submitted'::text]))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.plans
lock table public."plans" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'plans'
      and policyname in ('plans: public read', 'plans: staff write'))
    is distinct from '{"plans: public read": {"policyname": "plans: public read", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "(active OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "plans: staff write": {"policyname": "plans: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.plans; review before consolidating';
  end if;
end $guard$;
drop policy "plans: public read" on public."plans";
drop policy "plans: staff write" on public."plans";
-- Sources: plans: public read
create policy "perf_anon_select" on public."plans"
  as permissive for select to "anon"
  using (((active OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: plans: staff write
create policy "perf_authenticated_delete" on public."plans"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: plans: staff write
create policy "perf_authenticated_insert" on public."plans"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: plans: public read; plans: staff write
create policy "perf_authenticated_select" on public."plans"
  as permissive for select to "authenticated"
  using (((active OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: plans: staff write
create policy "perf_authenticated_update" on public."plans"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.platform_settings
lock table public."platform_settings" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'platform_settings'
      and policyname in ('settings: read', 'settings: staff write'))
    is distinct from '{"settings: read": {"policyname": "settings: read", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "true", "with_check": null}, "settings: staff write": {"policyname": "settings: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.platform_settings; review before consolidating';
  end if;
end $guard$;
drop policy "settings: read" on public."platform_settings";
drop policy "settings: staff write" on public."platform_settings";
-- Sources: settings: read
create policy "perf_anon_select" on public."platform_settings"
  as permissive for select to "anon"
  using ((true));
-- Sources: settings: staff write
create policy "perf_authenticated_delete" on public."platform_settings"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: settings: staff write
create policy "perf_authenticated_insert" on public."platform_settings"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: settings: read; settings: staff write
create policy "perf_authenticated_select" on public."platform_settings"
  as permissive for select to "authenticated"
  using ((true)
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: settings: staff write
create policy "perf_authenticated_update" on public."platform_settings"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.policies
lock table public."policies" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'policies'
      and policyname in ('policies: business account reads', 'policies: parties read', 'policies: sponsor and beneficiary read'))
    is distinct from '{"policies: business account reads": {"policyname": "policies: business account reads", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((request_id IS NOT NULL) AND private.has_org_role(private.request_business_org(request_id), ''{owner,admin,finance}''::member_role[]))", "with_check": null}, "policies: parties read": {"policyname": "policies: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "policies: sponsor and beneficiary read": {"policyname": "policies: sponsor and beneficiary read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((sponsor_user_id = ( SELECT auth.uid() AS uid)) OR ((beneficiary_id IS NOT NULL) AND private.is_beneficiary_user(beneficiary_id)))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.policies; review before consolidating';
  end if;
end $guard$;
drop policy "policies: business account reads" on public."policies";
drop policy "policies: parties read" on public."policies";
drop policy "policies: sponsor and beneficiary read" on public."policies";
-- Sources: policies: business account reads; policies: parties read; policies: sponsor and beneficiary read
create policy "perf_authenticated_select" on public."policies"
  as permissive for select to "authenticated"
  using ((((request_id IS NOT NULL) AND private.has_org_role(private.request_business_org(request_id), '{owner,admin,finance}'::member_role[])))
    OR (((customer_id = ( SELECT auth.uid() AS uid)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (((sponsor_user_id = ( SELECT auth.uid() AS uid)) OR ((beneficiary_id IS NOT NULL) AND private.is_beneficiary_user(beneficiary_id)))));

-- public.policy_explainer_logs
lock table public."policy_explainer_logs" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'policy_explainer_logs'
      and policyname in ('explainer logs: own read', 'explainer logs: staff read'))
    is distinct from '{"explainer logs: own read": {"policyname": "explainer logs: own read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(user_id = ( SELECT auth.uid() AS uid))", "with_check": null}, "explainer logs: staff read": {"policyname": "explainer logs: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.policy_explainer_logs; review before consolidating';
  end if;
end $guard$;
drop policy "explainer logs: own read" on public."policy_explainer_logs";
drop policy "explainer logs: staff read" on public."policy_explainer_logs";
-- Sources: explainer logs: own read; explainer logs: staff read
create policy "perf_authenticated_select" on public."policy_explainer_logs"
  as permissive for select to "authenticated"
  using (((user_id = ( SELECT auth.uid() AS uid)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.policy_explainer_summaries
lock table public."policy_explainer_summaries" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'policy_explainer_summaries'
      and policyname in ('explainer summaries: policyholder side read', 'explainer summaries: staff read'))
    is distinct from '{"explainer summaries: policyholder side read": {"policyname": "explainer summaries: policyholder side read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_policy_holder_side(policy_explainer_summaries.policy_id) AS is_policy_holder_side)", "with_check": null}, "explainer summaries: staff read": {"policyname": "explainer summaries: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.policy_explainer_summaries; review before consolidating';
  end if;
end $guard$;
drop policy "explainer summaries: policyholder side read" on public."policy_explainer_summaries";
drop policy "explainer summaries: staff read" on public."policy_explainer_summaries";
-- Sources: explainer summaries: policyholder side read; explainer summaries: staff read
create policy "perf_authenticated_select" on public."policy_explainer_summaries"
  as permissive for select to "authenticated"
  using ((( SELECT private.is_policy_holder_side(policy_explainer_summaries.policy_id) AS is_policy_holder_side))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.policy_number_blocks
lock table public."policy_number_blocks" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'policy_number_blocks'
      and policyname in ('number blocks: insurer admins manage own', 'number blocks: insurer reads own', 'number blocks: staff manage'))
    is distinct from '{"number blocks: insurer admins manage own": {"policyname": "number blocks: insurer admins manage own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "private.has_org_role(insurer_org_id, ''{owner,admin}''::member_role[])", "with_check": "private.has_org_role(insurer_org_id, ''{owner,admin}''::member_role[])"}, "number blocks: insurer reads own": {"policyname": "number blocks: insurer reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(( SELECT private.is_platform_staff() AS is_platform_staff) OR private.has_org_role(insurer_org_id, ''{owner,admin,underwriter,finance}''::member_role[]))", "with_check": null}, "number blocks: staff manage": {"policyname": "number blocks: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.policy_number_blocks; review before consolidating';
  end if;
end $guard$;
drop policy "number blocks: insurer admins manage own" on public."policy_number_blocks";
drop policy "number blocks: insurer reads own" on public."policy_number_blocks";
drop policy "number blocks: staff manage" on public."policy_number_blocks";
-- Sources: number blocks: insurer admins manage own; number blocks: staff manage
create policy "perf_authenticated_delete" on public."policy_number_blocks"
  as permissive for delete to "authenticated"
  using ((private.has_org_role(insurer_org_id, '{owner,admin}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: number blocks: insurer admins manage own; number blocks: staff manage
create policy "perf_authenticated_insert" on public."policy_number_blocks"
  as permissive for insert to "authenticated"
  with check ((private.has_org_role(insurer_org_id, '{owner,admin}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: number blocks: insurer admins manage own; number blocks: insurer reads own; number blocks: staff manage
create policy "perf_authenticated_select" on public."policy_number_blocks"
  as permissive for select to "authenticated"
  using ((private.has_org_role(insurer_org_id, '{owner,admin}'::member_role[]))
    OR ((( SELECT private.is_platform_staff() AS is_platform_staff) OR private.has_org_role(insurer_org_id, '{owner,admin,underwriter,finance}'::member_role[])))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: number blocks: insurer admins manage own; number blocks: staff manage
create policy "perf_authenticated_update" on public."policy_number_blocks"
  as permissive for update to "authenticated"
  using ((private.has_org_role(insurer_org_id, '{owner,admin}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((private.has_org_role(insurer_org_id, '{owner,admin}'::member_role[]))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.product_bundles
lock table public."product_bundles" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'product_bundles'
      and policyname in ('bundles: public read published', 'bundles: staff write'))
    is distinct from '{"bundles: public read published": {"policyname": "bundles: public read published", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "((status = ''published''::text) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "bundles: staff write": {"policyname": "bundles: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.product_bundles; review before consolidating';
  end if;
end $guard$;
drop policy "bundles: public read published" on public."product_bundles";
drop policy "bundles: staff write" on public."product_bundles";
-- Sources: bundles: public read published
create policy "perf_anon_select" on public."product_bundles"
  as permissive for select to "anon"
  using ((((status = 'published'::text) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: bundles: staff write
create policy "perf_authenticated_delete" on public."product_bundles"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: bundles: staff write
create policy "perf_authenticated_insert" on public."product_bundles"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: bundles: public read published; bundles: staff write
create policy "perf_authenticated_select" on public."product_bundles"
  as permissive for select to "authenticated"
  using ((((status = 'published'::text) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: bundles: staff write
create policy "perf_authenticated_update" on public."product_bundles"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.product_categories
lock table public."product_categories" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'product_categories'
      and policyname in ('categories: public read', 'categories: staff write'))
    is distinct from '{"categories: public read": {"policyname": "categories: public read", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "true", "with_check": null}, "categories: staff write": {"policyname": "categories: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.product_categories; review before consolidating';
  end if;
end $guard$;
drop policy "categories: public read" on public."product_categories";
drop policy "categories: staff write" on public."product_categories";
-- Sources: categories: public read
create policy "perf_anon_select" on public."product_categories"
  as permissive for select to "anon"
  using ((true));
-- Sources: categories: staff write
create policy "perf_authenticated_delete" on public."product_categories"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: categories: staff write
create policy "perf_authenticated_insert" on public."product_categories"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: categories: public read; categories: staff write
create policy "perf_authenticated_select" on public."product_categories"
  as permissive for select to "authenticated"
  using ((true)
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: categories: staff write
create policy "perf_authenticated_update" on public."product_categories"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.product_versions
lock table public."product_versions" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'product_versions'
      and policyname in ('versions: insurer and staff write', 'versions: public read approved'))
    is distinct from '{"versions: insurer and staff write": {"policyname": "versions: insurer and staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "(EXISTS ( SELECT 1\n   FROM products p\n  WHERE ((p.id = product_versions.product_id) AND (private.has_org_role(p.insurer_org_id, ''{owner,admin,underwriter}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))))", "with_check": "(EXISTS ( SELECT 1\n   FROM products p\n  WHERE ((p.id = product_versions.product_id) AND (private.has_org_role(p.insurer_org_id, ''{owner,admin,underwriter}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))))"}, "versions: public read approved": {"policyname": "versions: public read approved", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "((status = ''approved''::product_status) OR (EXISTS ( SELECT 1\n   FROM products p\n  WHERE ((p.id = product_versions.product_id) AND ((p.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))))))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.product_versions; review before consolidating';
  end if;
end $guard$;
drop policy "versions: insurer and staff write" on public."product_versions";
drop policy "versions: public read approved" on public."product_versions";
-- Sources: versions: public read approved
create policy "perf_anon_select" on public."product_versions"
  as permissive for select to "anon"
  using ((((status = 'approved'::product_status) OR (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_versions.product_id) AND ((p.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))))))));
-- Sources: versions: insurer and staff write
create policy "perf_authenticated_delete" on public."product_versions"
  as permissive for delete to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_versions.product_id) AND (private.has_org_role(p.insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))))));
-- Sources: versions: insurer and staff write
create policy "perf_authenticated_insert" on public."product_versions"
  as permissive for insert to "authenticated"
  with check (((EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_versions.product_id) AND (private.has_org_role(p.insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))))));
-- Sources: versions: insurer and staff write; versions: public read approved
create policy "perf_authenticated_select" on public."product_versions"
  as permissive for select to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_versions.product_id) AND (private.has_org_role(p.insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))))))
    OR (((status = 'approved'::product_status) OR (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_versions.product_id) AND ((p.insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))))))));
-- Sources: versions: insurer and staff write
create policy "perf_authenticated_update" on public."product_versions"
  as permissive for update to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_versions.product_id) AND (private.has_org_role(p.insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))))))
  with check (((EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_versions.product_id) AND (private.has_org_role(p.insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))))));

-- public.products
lock table public."products" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'products'
      and policyname in ('products: insurer and staff write', 'products: public read approved'))
    is distinct from '{"products: insurer and staff write": {"policyname": "products: insurer and staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "(private.has_org_role(insurer_org_id, ''{owner,admin,underwriter}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": "(private.has_org_role(insurer_org_id, ''{owner,admin,underwriter}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))"}, "products: public read approved": {"policyname": "products: public read approved", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "((status = ''approved''::product_status) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.products; review before consolidating';
  end if;
end $guard$;
drop policy "products: insurer and staff write" on public."products";
drop policy "products: public read approved" on public."products";
-- Sources: products: public read approved
create policy "perf_anon_select" on public."products"
  as permissive for select to "anon"
  using ((((status = 'approved'::product_status) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: products: insurer and staff write
create policy "perf_authenticated_delete" on public."products"
  as permissive for delete to "authenticated"
  using (((private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: products: insurer and staff write
create policy "perf_authenticated_insert" on public."products"
  as permissive for insert to "authenticated"
  with check (((private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: products: insurer and staff write; products: public read approved
create policy "perf_authenticated_select" on public."products"
  as permissive for select to "authenticated"
  using (((private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (((status = 'approved'::product_status) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));
-- Sources: products: insurer and staff write
create policy "perf_authenticated_update" on public."products"
  as permissive for update to "authenticated"
  using (((private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))))
  with check (((private.has_org_role(insurer_org_id, '{owner,admin,underwriter}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))));

-- public.profiles
lock table public."profiles" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'profiles'
      and policyname in ('profiles: colleagues read', 'profiles: read self, servicing staff', 'profiles: staff update', 'profiles: update self'))
    is distinct from '{"profiles: colleagues read": {"policyname": "profiles: colleagues read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "private.shares_org_with(id)", "with_check": null}, "profiles: read self, servicing staff": {"policyname": "profiles: read self, servicing staff", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "private.can_view_customer(id)", "with_check": null}, "profiles: staff update": {"policyname": "profiles: staff update", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}, "profiles: update self": {"policyname": "profiles: update self", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "(id = ( SELECT auth.uid() AS uid))", "with_check": "(id = ( SELECT auth.uid() AS uid))"}}'::jsonb then
    raise exception 'Policy drift on public.profiles; review before consolidating';
  end if;
end $guard$;
drop policy "profiles: colleagues read" on public."profiles";
drop policy "profiles: read self, servicing staff" on public."profiles";
drop policy "profiles: staff update" on public."profiles";
drop policy "profiles: update self" on public."profiles";
-- Sources: profiles: colleagues read; profiles: read self, servicing staff
create policy "perf_authenticated_select" on public."profiles"
  as permissive for select to "authenticated"
  using ((private.shares_org_with(id))
    OR (private.can_view_customer(id)));
-- Sources: profiles: staff update; profiles: update self
create policy "perf_authenticated_update" on public."profiles"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff))
    OR ((id = ( SELECT auth.uid() AS uid))))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff))
    OR ((id = ( SELECT auth.uid() AS uid))));

-- public.quote_discounts
lock table public."quote_discounts" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'quote_discounts'
      and policyname in ('quote_discounts: parties read', 'quote_discounts: staff read'))
    is distinct from '{"quote_discounts: parties read": {"policyname": "quote_discounts: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR private.is_request_customer(request_id))", "with_check": null}, "quote_discounts: staff read": {"policyname": "quote_discounts: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.quote_discounts; review before consolidating';
  end if;
end $guard$;
drop policy "quote_discounts: parties read" on public."quote_discounts";
drop policy "quote_discounts: staff read" on public."quote_discounts";
-- Sources: quote_discounts: parties read; quote_discounts: staff read
create policy "perf_authenticated_select" on public."quote_discounts"
  as permissive for select to "authenticated"
  using ((((insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR private.is_request_customer(request_id)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.rate_rows
lock table public."rate_rows" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'rate_rows'
      and policyname in ('rate_rows: read', 'rate_rows: write'))
    is distinct from '{"rate_rows: read": {"policyname": "rate_rows: read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "private.can_view_rate_table(rate_table_id)", "with_check": null}, "rate_rows: write": {"policyname": "rate_rows: write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "private.can_edit_rate_table(rate_table_id)", "with_check": "private.can_edit_rate_table(rate_table_id)"}}'::jsonb then
    raise exception 'Policy drift on public.rate_rows; review before consolidating';
  end if;
end $guard$;
drop policy "rate_rows: read" on public."rate_rows";
drop policy "rate_rows: write" on public."rate_rows";
-- Sources: rate_rows: write
create policy "perf_authenticated_delete" on public."rate_rows"
  as permissive for delete to "authenticated"
  using ((private.can_edit_rate_table(rate_table_id)));
-- Sources: rate_rows: write
create policy "perf_authenticated_insert" on public."rate_rows"
  as permissive for insert to "authenticated"
  with check ((private.can_edit_rate_table(rate_table_id)));
-- Sources: rate_rows: read; rate_rows: write
create policy "perf_authenticated_select" on public."rate_rows"
  as permissive for select to "authenticated"
  using ((private.can_view_rate_table(rate_table_id))
    OR (private.can_edit_rate_table(rate_table_id)));
-- Sources: rate_rows: write
create policy "perf_authenticated_update" on public."rate_rows"
  as permissive for update to "authenticated"
  using ((private.can_edit_rate_table(rate_table_id)))
  with check ((private.can_edit_rate_table(rate_table_id)));

-- public.rate_tables
lock table public."rate_tables" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'rate_tables'
      and policyname in ('rate_tables: broker proposal', 'rate_tables: insurer write', 'rate_tables: read', 'rate_tables: staff manage'))
    is distinct from '{"rate_tables: broker proposal": {"policyname": "rate_tables: broker proposal", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "INSERT", "qual": null, "with_check": "((product_version_id IS NULL) AND (proposed_insurer_name IS NOT NULL) AND (status = ''pending_review''::text) AND (submitted_by = ( SELECT auth.uid() AS uid)) AND (submitted_by_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (EXISTS ( SELECT 1\n   FROM organizations o\n  WHERE ((o.id = rate_tables.submitted_by_org_id) AND (o.type = ''broker''::org_type)))))"}, "rate_tables: insurer write": {"policyname": "rate_tables: insurer write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "((product_version_id IS NOT NULL) AND private.can_manage_version(product_version_id))", "with_check": "((product_version_id IS NOT NULL) AND private.can_manage_version(product_version_id) AND (status = ANY (ARRAY[''draft''::text, ''pending_review''::text])))"}, "rate_tables: read": {"policyname": "rate_tables: read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(( SELECT private.is_platform_staff() AS is_platform_staff) OR ((product_version_id IS NOT NULL) AND private.can_view_version(product_version_id)) OR (submitted_by_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ((status = ''approved''::text) AND ( SELECT private.is_partner_user() AS is_partner_user)))", "with_check": null}, "rate_tables: staff manage": {"policyname": "rate_tables: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.rate_tables; review before consolidating';
  end if;
end $guard$;
drop policy "rate_tables: broker proposal" on public."rate_tables";
drop policy "rate_tables: insurer write" on public."rate_tables";
drop policy "rate_tables: read" on public."rate_tables";
drop policy "rate_tables: staff manage" on public."rate_tables";
-- Sources: rate_tables: insurer write; rate_tables: staff manage
create policy "perf_authenticated_delete" on public."rate_tables"
  as permissive for delete to "authenticated"
  using ((((product_version_id IS NOT NULL) AND private.can_manage_version(product_version_id)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: rate_tables: broker proposal; rate_tables: insurer write; rate_tables: staff manage
create policy "perf_authenticated_insert" on public."rate_tables"
  as permissive for insert to "authenticated"
  with check ((((product_version_id IS NULL) AND (proposed_insurer_name IS NOT NULL) AND (status = 'pending_review'::text) AND (submitted_by = ( SELECT auth.uid() AS uid)) AND (submitted_by_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (EXISTS ( SELECT 1
   FROM organizations o
  WHERE ((o.id = rate_tables.submitted_by_org_id) AND (o.type = 'broker'::org_type))))))
    OR (((product_version_id IS NOT NULL) AND private.can_manage_version(product_version_id) AND (status = ANY (ARRAY['draft'::text, 'pending_review'::text]))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: rate_tables: insurer write; rate_tables: read; rate_tables: staff manage
create policy "perf_authenticated_select" on public."rate_tables"
  as permissive for select to "authenticated"
  using ((((product_version_id IS NOT NULL) AND private.can_manage_version(product_version_id)))
    OR ((( SELECT private.is_platform_staff() AS is_platform_staff) OR ((product_version_id IS NOT NULL) AND private.can_view_version(product_version_id)) OR (submitted_by_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ((status = 'approved'::text) AND ( SELECT private.is_partner_user() AS is_partner_user))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: rate_tables: insurer write; rate_tables: staff manage
create policy "perf_authenticated_update" on public."rate_tables"
  as permissive for update to "authenticated"
  using ((((product_version_id IS NOT NULL) AND private.can_manage_version(product_version_id)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((((product_version_id IS NOT NULL) AND private.can_manage_version(product_version_id) AND (status = ANY (ARRAY['draft'::text, 'pending_review'::text]))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.referral_attributions
lock table public."referral_attributions" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'referral_attributions'
      and policyname in ('referral_attributions: customer reads own', 'referral_attributions: partner reads own', 'referral_attributions: staff read'))
    is distinct from '{"referral_attributions: customer reads own": {"policyname": "referral_attributions: customer reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(customer_id = ( SELECT auth.uid() AS uid))", "with_check": null}, "referral_attributions: partner reads own": {"policyname": "referral_attributions: partner reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((partner_org_id IS NOT NULL) AND (partner_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))", "with_check": null}, "referral_attributions: staff read": {"policyname": "referral_attributions: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.referral_attributions; review before consolidating';
  end if;
end $guard$;
drop policy "referral_attributions: customer reads own" on public."referral_attributions";
drop policy "referral_attributions: partner reads own" on public."referral_attributions";
drop policy "referral_attributions: staff read" on public."referral_attributions";
-- Sources: referral_attributions: customer reads own; referral_attributions: partner reads own; referral_attributions: staff read
create policy "perf_authenticated_select" on public."referral_attributions"
  as permissive for select to "authenticated"
  using (((customer_id = ( SELECT auth.uid() AS uid)))
    OR (((partner_org_id IS NOT NULL) AND (partner_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.referral_links
lock table public."referral_links" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'referral_links'
      and policyname in ('referral_links: owners read own', 'referral_links: staff read', 'referral_links: staff write'))
    is distinct from '{"referral_links: owners read own": {"policyname": "referral_links: owners read own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((owner_org_id IS NOT NULL) AND (owner_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))", "with_check": null}, "referral_links: staff read": {"policyname": "referral_links: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}, "referral_links: staff write": {"policyname": "referral_links: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.referral_links; review before consolidating';
  end if;
end $guard$;
drop policy "referral_links: owners read own" on public."referral_links";
drop policy "referral_links: staff read" on public."referral_links";
drop policy "referral_links: staff write" on public."referral_links";
-- Sources: referral_links: staff write
create policy "perf_authenticated_delete" on public."referral_links"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: referral_links: staff write
create policy "perf_authenticated_insert" on public."referral_links"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: referral_links: owners read own; referral_links: staff read; referral_links: staff write
create policy "perf_authenticated_select" on public."referral_links"
  as permissive for select to "authenticated"
  using ((((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((owner_org_id IS NOT NULL) AND (owner_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: referral_links: staff write
create policy "perf_authenticated_update" on public."referral_links"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.request_tasks
lock table public."request_tasks" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'request_tasks'
      and policyname in ('tasks: customer completes own', 'tasks: read', 'tasks: staff manage'))
    is distinct from '{"tasks: customer completes own": {"policyname": "tasks: customer completes own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "((assignee_party = ''customer''::party) AND private.is_request_customer(request_id))", "with_check": "((assignee_party = ''customer''::party) AND private.is_request_customer(request_id))"}, "tasks: read": {"policyname": "tasks: read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "private.can_access_request(request_id)", "with_check": null}, "tasks: staff manage": {"policyname": "tasks: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "private.is_request_staff(request_id)", "with_check": "private.is_request_staff(request_id)"}}'::jsonb then
    raise exception 'Policy drift on public.request_tasks; review before consolidating';
  end if;
end $guard$;
drop policy "tasks: customer completes own" on public."request_tasks";
drop policy "tasks: read" on public."request_tasks";
drop policy "tasks: staff manage" on public."request_tasks";
-- Sources: tasks: staff manage
create policy "perf_authenticated_delete" on public."request_tasks"
  as permissive for delete to "authenticated"
  using ((private.is_request_staff(request_id)));
-- Sources: tasks: staff manage
create policy "perf_authenticated_insert" on public."request_tasks"
  as permissive for insert to "authenticated"
  with check ((private.is_request_staff(request_id)));
-- Sources: tasks: read; tasks: staff manage
create policy "perf_authenticated_select" on public."request_tasks"
  as permissive for select to "authenticated"
  using ((private.can_access_request(request_id))
    OR (private.is_request_staff(request_id)));
-- Sources: tasks: customer completes own; tasks: staff manage
create policy "perf_authenticated_update" on public."request_tasks"
  as permissive for update to "authenticated"
  using ((((assignee_party = 'customer'::party) AND private.is_request_customer(request_id)))
    OR (private.is_request_staff(request_id)))
  with check ((((assignee_party = 'customer'::party) AND private.is_request_customer(request_id)))
    OR (private.is_request_staff(request_id)));

-- public.requests
lock table public."requests" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'requests'
      and policyname in ('requests: broker and staff manage', 'requests: business account reads', 'requests: customer edits while waiting on them', 'requests: offered brokers and direct insurers read', 'requests: parties read', 'requests: sponsor reads'))
    is distinct from '{"requests: broker and staff manage": {"policyname": "requests: broker and staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "requests: business account reads": {"policyname": "requests: business account reads", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((business_org_id IS NOT NULL) AND private.has_org_role(business_org_id, ''{owner,admin,finance}''::member_role[]))", "with_check": null}, "requests: customer edits while waiting on them": {"policyname": "requests: customer edits while waiting on them", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "UPDATE", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY[''draft''::request_status, ''awaiting_customer_info''::request_status, ''quotes_ready''::request_status])))", "with_check": "(customer_id = ( SELECT auth.uid() AS uid))"}, "requests: offered brokers and direct insurers read": {"policyname": "requests: offered brokers and direct insurers read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(private.has_open_offer(id) OR private.is_direct_insurer(id))", "with_check": null}, "requests: parties read": {"policyname": "requests: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff) OR private.can_access_request(id))", "with_check": null}, "requests: sponsor reads": {"policyname": "requests: sponsor reads", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(sponsor_user_id = ( SELECT auth.uid() AS uid))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.requests; review before consolidating';
  end if;
end $guard$;
drop policy "requests: broker and staff manage" on public."requests";
drop policy "requests: business account reads" on public."requests";
drop policy "requests: customer edits while waiting on them" on public."requests";
drop policy "requests: offered brokers and direct insurers read" on public."requests";
drop policy "requests: parties read" on public."requests";
drop policy "requests: sponsor reads" on public."requests";
-- Sources: requests: business account reads; requests: offered brokers and direct insurers read; requests: parties read; requests: sponsor reads
create policy "perf_authenticated_select" on public."requests"
  as permissive for select to "authenticated"
  using ((((business_org_id IS NOT NULL) AND private.has_org_role(business_org_id, '{owner,admin,finance}'::member_role[])))
    OR ((private.has_open_offer(id) OR private.is_direct_insurer(id)))
    OR (((customer_id = ( SELECT auth.uid() AS uid)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff) OR private.can_access_request(id)))
    OR ((sponsor_user_id = ( SELECT auth.uid() AS uid))));
-- Sources: requests: broker and staff manage; requests: customer edits while waiting on them
create policy "perf_authenticated_update" on public."requests"
  as permissive for update to "authenticated"
  using ((((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (((customer_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['draft'::request_status, 'awaiting_customer_info'::request_status, 'quotes_ready'::request_status])))))
  with check ((((broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR ((customer_id = ( SELECT auth.uid() AS uid))));

-- public.reward_ledger
lock table public."reward_ledger" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'reward_ledger'
      and policyname in ('reward_ledger: org finance reads own', 'reward_ledger: staff read', 'reward_ledger: user reads own'))
    is distinct from '{"reward_ledger: org finance reads own": {"policyname": "reward_ledger: org finance reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((org_id IS NOT NULL) AND private.has_org_role(org_id, ''{owner,admin,finance}''::member_role[]))", "with_check": null}, "reward_ledger: staff read": {"policyname": "reward_ledger: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}, "reward_ledger: user reads own": {"policyname": "reward_ledger: user reads own", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(user_id = ( SELECT auth.uid() AS uid))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.reward_ledger; review before consolidating';
  end if;
end $guard$;
drop policy "reward_ledger: org finance reads own" on public."reward_ledger";
drop policy "reward_ledger: staff read" on public."reward_ledger";
drop policy "reward_ledger: user reads own" on public."reward_ledger";
-- Sources: reward_ledger: org finance reads own; reward_ledger: staff read; reward_ledger: user reads own
create policy "perf_authenticated_select" on public."reward_ledger"
  as permissive for select to "authenticated"
  using ((((org_id IS NOT NULL) AND private.has_org_role(org_id, '{owner,admin,finance}'::member_role[])))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff))
    OR ((user_id = ( SELECT auth.uid() AS uid))));

-- public.reward_rules
lock table public."reward_rules" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'reward_rules'
      and policyname in ('reward_rules: signed-in read active', 'reward_rules: staff read'))
    is distinct from '{"reward_rules: signed-in read active": {"policyname": "reward_rules: signed-in read active", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "active", "with_check": null}, "reward_rules: staff read": {"policyname": "reward_rules: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.reward_rules; review before consolidating';
  end if;
end $guard$;
drop policy "reward_rules: signed-in read active" on public."reward_rules";
drop policy "reward_rules: staff read" on public."reward_rules";
-- Sources: reward_rules: signed-in read active; reward_rules: staff read
create policy "perf_authenticated_select" on public."reward_rules"
  as permissive for select to "authenticated"
  using ((active)
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.service_partner_reviews
lock table public."service_partner_reviews" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'service_partner_reviews'
      and policyname in ('partner reviews: own and staff read', 'partner reviews: public read published'))
    is distinct from '{"partner reviews: own and staff read": {"policyname": "partner reviews: own and staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((customer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "partner reviews: public read published": {"policyname": "partner reviews: public read published", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "(status = ''published''::text)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.service_partner_reviews; review before consolidating';
  end if;
end $guard$;
drop policy "partner reviews: own and staff read" on public."service_partner_reviews";
drop policy "partner reviews: public read published" on public."service_partner_reviews";
-- Sources: partner reviews: public read published
create policy "perf_anon_select" on public."service_partner_reviews"
  as permissive for select to "anon"
  using (((status = 'published'::text)));
-- Sources: partner reviews: own and staff read; partner reviews: public read published
create policy "perf_authenticated_select" on public."service_partner_reviews"
  as permissive for select to "authenticated"
  using ((((customer_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR ((status = 'published'::text)));

-- public.service_partners
lock table public."service_partners" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'service_partners'
      and policyname in ('service partners: public directory', 'service partners: staff read all'))
    is distinct from '{"service partners: public directory": {"policyname": "service partners: public directory", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "(status = ''approved''::text)", "with_check": null}, "service partners: staff read all": {"policyname": "service partners: staff read all", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.service_partners; review before consolidating';
  end if;
end $guard$;
drop policy "service partners: public directory" on public."service_partners";
drop policy "service partners: staff read all" on public."service_partners";
-- Sources: service partners: public directory
create policy "perf_anon_select" on public."service_partners"
  as permissive for select to "anon"
  using (((status = 'approved'::text)));
-- Sources: service partners: public directory; service partners: staff read all
create policy "perf_authenticated_select" on public."service_partners"
  as permissive for select to "authenticated"
  using (((status = 'approved'::text))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.sla_timers
lock table public."sla_timers" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'sla_timers'
      and policyname in ('sla timers: parties read', 'sla timers: staff manage'))
    is distinct from '{"sla timers: parties read": {"policyname": "sla timers: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(( SELECT private.is_platform_staff() AS is_platform_staff) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ((subject_type = ''request''::text) AND private.can_access_request(subject_id)) OR ((subject_type = ''issuance''::text) AND private.can_access_policy(subject_id)))", "with_check": null}, "sla timers: staff manage": {"policyname": "sla timers: staff manage", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.sla_timers; review before consolidating';
  end if;
end $guard$;
drop policy "sla timers: parties read" on public."sla_timers";
drop policy "sla timers: staff manage" on public."sla_timers";
-- Sources: sla timers: staff manage
create policy "perf_authenticated_delete" on public."sla_timers"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: sla timers: staff manage
create policy "perf_authenticated_insert" on public."sla_timers"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: sla timers: parties read; sla timers: staff manage
create policy "perf_authenticated_select" on public."sla_timers"
  as permissive for select to "authenticated"
  using (((( SELECT private.is_platform_staff() AS is_platform_staff) OR (insurer_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR (broker_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)) OR ((subject_type = 'request'::text) AND private.can_access_request(subject_id)) OR ((subject_type = 'issuance'::text) AND private.can_access_policy(subject_id))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: sla timers: staff manage
create policy "perf_authenticated_update" on public."sla_timers"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.subscriptions
lock table public."subscriptions" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'subscriptions'
      and policyname in ('subscriptions: org read', 'subscriptions: staff write'))
    is distinct from '{"subscriptions: org read": {"policyname": "subscriptions: org read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(private.has_org_role(org_id, ''{owner,admin,finance}''::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff))", "with_check": null}, "subscriptions: staff write": {"policyname": "subscriptions: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.subscriptions; review before consolidating';
  end if;
end $guard$;
drop policy "subscriptions: org read" on public."subscriptions";
drop policy "subscriptions: staff write" on public."subscriptions";
-- Sources: subscriptions: staff write
create policy "perf_authenticated_delete" on public."subscriptions"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: subscriptions: staff write
create policy "perf_authenticated_insert" on public."subscriptions"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: subscriptions: org read; subscriptions: staff write
create policy "perf_authenticated_select" on public."subscriptions"
  as permissive for select to "authenticated"
  using (((private.has_org_role(org_id, '{owner,admin,finance}'::member_role[]) OR ( SELECT private.is_platform_staff() AS is_platform_staff)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: subscriptions: staff write
create policy "perf_authenticated_update" on public."subscriptions"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.telematics_enrolments
lock table public."telematics_enrolments" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'telematics_enrolments'
      and policyname in ('telematics_enrolments: own read', 'telematics_enrolments: staff read'))
    is distinct from '{"telematics_enrolments: own read": {"policyname": "telematics_enrolments: own read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(user_id = ( SELECT auth.uid() AS uid))", "with_check": null}, "telematics_enrolments: staff read": {"policyname": "telematics_enrolments: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.telematics_enrolments; review before consolidating';
  end if;
end $guard$;
drop policy "telematics_enrolments: own read" on public."telematics_enrolments";
drop policy "telematics_enrolments: staff read" on public."telematics_enrolments";
-- Sources: telematics_enrolments: own read; telematics_enrolments: staff read
create policy "perf_authenticated_select" on public."telematics_enrolments"
  as permissive for select to "authenticated"
  using (((user_id = ( SELECT auth.uid() AS uid)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.telematics_scores
lock table public."telematics_scores" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'telematics_scores'
      and policyname in ('telematics_scores: insurer reads policy scores', 'telematics_scores: own read', 'telematics_scores: staff read'))
    is distinct from '{"telematics_scores: insurer reads policy scores": {"policyname": "telematics_scores: insurer reads policy scores", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "private.is_policy_insurer_member(policy_id)", "with_check": null}, "telematics_scores: own read": {"policyname": "telematics_scores: own read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(user_id = ( SELECT auth.uid() AS uid))", "with_check": null}, "telematics_scores: staff read": {"policyname": "telematics_scores: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.telematics_scores; review before consolidating';
  end if;
end $guard$;
drop policy "telematics_scores: insurer reads policy scores" on public."telematics_scores";
drop policy "telematics_scores: own read" on public."telematics_scores";
drop policy "telematics_scores: staff read" on public."telematics_scores";
-- Sources: telematics_scores: insurer reads policy scores; telematics_scores: own read; telematics_scores: staff read
create policy "perf_authenticated_select" on public."telematics_scores"
  as permissive for select to "authenticated"
  using ((private.is_policy_insurer_member(policy_id))
    OR ((user_id = ( SELECT auth.uid() AS uid)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.telematics_trips
lock table public."telematics_trips" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'telematics_trips'
      and policyname in ('telematics_trips: own read', 'telematics_trips: staff read'))
    is distinct from '{"telematics_trips: own read": {"policyname": "telematics_trips: own read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(user_id = ( SELECT auth.uid() AS uid))", "with_check": null}, "telematics_trips: staff read": {"policyname": "telematics_trips: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.telematics_trips; review before consolidating';
  end if;
end $guard$;
drop policy "telematics_trips: own read" on public."telematics_trips";
drop policy "telematics_trips: staff read" on public."telematics_trips";
-- Sources: telematics_trips: own read; telematics_trips: staff read
create policy "perf_authenticated_select" on public."telematics_trips"
  as permissive for select to "authenticated"
  using (((user_id = ( SELECT auth.uid() AS uid)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.translations
lock table public."translations" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'translations'
      and policyname in ('translations: public read approved', 'translations: staff read'))
    is distinct from '{"translations: public read approved": {"policyname": "translations: public read approved", "permissive": "PERMISSIVE", "roles": "{anon,authenticated}", "cmd": "SELECT", "qual": "(status = ''approved''::text)", "with_check": null}, "translations: staff read": {"policyname": "translations: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.translations; review before consolidating';
  end if;
end $guard$;
drop policy "translations: public read approved" on public."translations";
drop policy "translations: staff read" on public."translations";
-- Sources: translations: public read approved
create policy "perf_anon_select" on public."translations"
  as permissive for select to "anon"
  using (((status = 'approved'::text)));
-- Sources: translations: public read approved; translations: staff read
create policy "perf_authenticated_select" on public."translations"
  as permissive for select to "authenticated"
  using (((status = 'approved'::text))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.underwriting_rules
lock table public."underwriting_rules" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'underwriting_rules'
      and policyname in ('underwriting_rules: insurer and staff write', 'underwriting_rules: read'))
    is distinct from '{"underwriting_rules: insurer and staff write": {"policyname": "underwriting_rules: insurer and staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "private.can_manage_version(product_version_id)", "with_check": "private.can_manage_version(product_version_id)"}, "underwriting_rules: read": {"policyname": "underwriting_rules: read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(private.can_view_version(product_version_id) OR (( SELECT private.is_partner_user() AS is_partner_user) AND private.version_is_approved(product_version_id)))", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.underwriting_rules; review before consolidating';
  end if;
end $guard$;
drop policy "underwriting_rules: insurer and staff write" on public."underwriting_rules";
drop policy "underwriting_rules: read" on public."underwriting_rules";
-- Sources: underwriting_rules: insurer and staff write
create policy "perf_authenticated_delete" on public."underwriting_rules"
  as permissive for delete to "authenticated"
  using ((private.can_manage_version(product_version_id)));
-- Sources: underwriting_rules: insurer and staff write
create policy "perf_authenticated_insert" on public."underwriting_rules"
  as permissive for insert to "authenticated"
  with check ((private.can_manage_version(product_version_id)));
-- Sources: underwriting_rules: insurer and staff write; underwriting_rules: read
create policy "perf_authenticated_select" on public."underwriting_rules"
  as permissive for select to "authenticated"
  using ((private.can_manage_version(product_version_id))
    OR ((private.can_view_version(product_version_id) OR (( SELECT private.is_partner_user() AS is_partner_user) AND private.version_is_approved(product_version_id)))));
-- Sources: underwriting_rules: insurer and staff write
create policy "perf_authenticated_update" on public."underwriting_rules"
  as permissive for update to "authenticated"
  using ((private.can_manage_version(product_version_id)))
  with check ((private.can_manage_version(product_version_id)));

-- public.voice_notes
lock table public."voice_notes" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'voice_notes'
      and policyname in ('voice_notes: linked parties read', 'voice_notes: owner read', 'voice_notes: staff read'))
    is distinct from '{"voice_notes: linked parties read": {"policyname": "voice_notes: linked parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(((request_id IS NOT NULL) OR (claim_id IS NOT NULL)) AND ( SELECT private.can_view_voice_note(voice_notes.request_id, voice_notes.claim_id) AS can_view_voice_note))", "with_check": null}, "voice_notes: owner read": {"policyname": "voice_notes: owner read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(owner_id = ( SELECT auth.uid() AS uid))", "with_check": null}, "voice_notes: staff read": {"policyname": "voice_notes: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.voice_notes; review before consolidating';
  end if;
end $guard$;
drop policy "voice_notes: linked parties read" on public."voice_notes";
drop policy "voice_notes: owner read" on public."voice_notes";
drop policy "voice_notes: staff read" on public."voice_notes";
-- Sources: voice_notes: linked parties read; voice_notes: owner read; voice_notes: staff read
create policy "perf_authenticated_select" on public."voice_notes"
  as permissive for select to "authenticated"
  using (((((request_id IS NOT NULL) OR (claim_id IS NOT NULL)) AND ( SELECT private.can_view_voice_note(voice_notes.request_id, voice_notes.claim_id) AS can_view_voice_note)))
    OR ((owner_id = ( SELECT auth.uid() AS uid)))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.wa_contacts
lock table public."wa_contacts" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'wa_contacts'
      and policyname in ('wa_contacts: assigned broker read', 'wa_contacts: staff read'))
    is distinct from '{"wa_contacts: assigned broker read": {"policyname": "wa_contacts: assigned broker read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "(EXISTS ( SELECT 1\n   FROM wa_conversations v\n  WHERE ((v.contact_id = wa_contacts.id) AND (v.assigned_org_id IS NOT NULL) AND (v.assigned_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))))", "with_check": null}, "wa_contacts: staff read": {"policyname": "wa_contacts: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.wa_contacts; review before consolidating';
  end if;
end $guard$;
drop policy "wa_contacts: assigned broker read" on public."wa_contacts";
drop policy "wa_contacts: staff read" on public."wa_contacts";
-- Sources: wa_contacts: assigned broker read; wa_contacts: staff read
create policy "perf_authenticated_select" on public."wa_contacts"
  as permissive for select to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM wa_conversations v
  WHERE ((v.contact_id = wa_contacts.id) AND (v.assigned_org_id IS NOT NULL) AND (v.assigned_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.wa_conversations
lock table public."wa_conversations" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'wa_conversations'
      and policyname in ('wa_conversations: assigned broker read', 'wa_conversations: staff read'))
    is distinct from '{"wa_conversations: assigned broker read": {"policyname": "wa_conversations: assigned broker read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((assigned_org_id IS NOT NULL) AND (assigned_org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))", "with_check": null}, "wa_conversations: staff read": {"policyname": "wa_conversations: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.wa_conversations; review before consolidating';
  end if;
end $guard$;
drop policy "wa_conversations: assigned broker read" on public."wa_conversations";
drop policy "wa_conversations: staff read" on public."wa_conversations";
-- Sources: wa_conversations: assigned broker read; wa_conversations: staff read
create policy "perf_authenticated_select" on public."wa_conversations"
  as permissive for select to "authenticated"
  using ((((assigned_org_id IS NOT NULL) AND (assigned_org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.wa_handoffs
lock table public."wa_handoffs" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'wa_handoffs'
      and policyname in ('wa_handoffs: assigned broker read', 'wa_handoffs: staff read', 'wa_handoffs: staff write'))
    is distinct from '{"wa_handoffs: assigned broker read": {"policyname": "wa_handoffs: assigned broker read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "((org_id IS NOT NULL) AND (org_id IN ( SELECT private.user_org_ids() AS user_org_ids)))", "with_check": null}, "wa_handoffs: staff read": {"policyname": "wa_handoffs: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}, "wa_handoffs: staff write": {"policyname": "wa_handoffs: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.wa_handoffs; review before consolidating';
  end if;
end $guard$;
drop policy "wa_handoffs: assigned broker read" on public."wa_handoffs";
drop policy "wa_handoffs: staff read" on public."wa_handoffs";
drop policy "wa_handoffs: staff write" on public."wa_handoffs";
-- Sources: wa_handoffs: staff write
create policy "perf_authenticated_delete" on public."wa_handoffs"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: wa_handoffs: staff write
create policy "perf_authenticated_insert" on public."wa_handoffs"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: wa_handoffs: assigned broker read; wa_handoffs: staff read; wa_handoffs: staff write
create policy "perf_authenticated_select" on public."wa_handoffs"
  as permissive for select to "authenticated"
  using ((((org_id IS NOT NULL) AND (org_id IN ( SELECT private.user_org_ids() AS user_org_ids))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: wa_handoffs: staff write
create policy "perf_authenticated_update" on public."wa_handoffs"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.wa_messages
lock table public."wa_messages" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'wa_messages'
      and policyname in ('wa_messages: assigned broker read', 'wa_messages: staff read'))
    is distinct from '{"wa_messages: assigned broker read": {"policyname": "wa_messages: assigned broker read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.can_view_wa_conversation(wa_messages.conversation_id) AS can_view_wa_conversation)", "with_check": null}, "wa_messages: staff read": {"policyname": "wa_messages: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.wa_messages; review before consolidating';
  end if;
end $guard$;
drop policy "wa_messages: assigned broker read" on public."wa_messages";
drop policy "wa_messages: staff read" on public."wa_messages";
-- Sources: wa_messages: assigned broker read; wa_messages: staff read
create policy "perf_authenticated_select" on public."wa_messages"
  as permissive for select to "authenticated"
  using ((( SELECT private.can_view_wa_conversation(wa_messages.conversation_id) AS can_view_wa_conversation))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));

-- public.wa_templates
lock table public."wa_templates" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'wa_templates'
      and policyname in ('wa_templates: admin write', 'wa_templates: staff read'))
    is distinct from '{"wa_templates: admin write": {"policyname": "wa_templates: admin write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "(EXISTS ( SELECT 1\n   FROM (memberships m\n     JOIN organizations o ON ((o.id = m.org_id)))\n  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (o.type = ''platform''::org_type) AND (m.role = ANY (ARRAY[''platform_admin''::member_role, ''platform_ops''::member_role])))))", "with_check": "(EXISTS ( SELECT 1\n   FROM (memberships m\n     JOIN organizations o ON ((o.id = m.org_id)))\n  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (o.type = ''platform''::org_type) AND (m.role = ANY (ARRAY[''platform_admin''::member_role, ''platform_ops''::member_role])))))"}, "wa_templates: staff read": {"policyname": "wa_templates: staff read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": null}}'::jsonb then
    raise exception 'Policy drift on public.wa_templates; review before consolidating';
  end if;
end $guard$;
drop policy "wa_templates: admin write" on public."wa_templates";
drop policy "wa_templates: staff read" on public."wa_templates";
-- Sources: wa_templates: admin write
create policy "perf_authenticated_delete" on public."wa_templates"
  as permissive for delete to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM (memberships m
     JOIN organizations o ON ((o.id = m.org_id)))
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (o.type = 'platform'::org_type) AND (m.role = ANY (ARRAY['platform_admin'::member_role, 'platform_ops'::member_role])))))));
-- Sources: wa_templates: admin write
create policy "perf_authenticated_insert" on public."wa_templates"
  as permissive for insert to "authenticated"
  with check (((EXISTS ( SELECT 1
   FROM (memberships m
     JOIN organizations o ON ((o.id = m.org_id)))
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (o.type = 'platform'::org_type) AND (m.role = ANY (ARRAY['platform_admin'::member_role, 'platform_ops'::member_role])))))));
-- Sources: wa_templates: admin write; wa_templates: staff read
create policy "perf_authenticated_select" on public."wa_templates"
  as permissive for select to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM (memberships m
     JOIN organizations o ON ((o.id = m.org_id)))
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (o.type = 'platform'::org_type) AND (m.role = ANY (ARRAY['platform_admin'::member_role, 'platform_ops'::member_role]))))))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: wa_templates: admin write
create policy "perf_authenticated_update" on public."wa_templates"
  as permissive for update to "authenticated"
  using (((EXISTS ( SELECT 1
   FROM (memberships m
     JOIN organizations o ON ((o.id = m.org_id)))
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (o.type = 'platform'::org_type) AND (m.role = ANY (ARRAY['platform_admin'::member_role, 'platform_ops'::member_role])))))))
  with check (((EXISTS ( SELECT 1
   FROM (memberships m
     JOIN organizations o ON ((o.id = m.org_id)))
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (o.type = 'platform'::org_type) AND (m.role = ANY (ARRAY['platform_admin'::member_role, 'platform_ops'::member_role])))))));

-- public.welfare_contributions
lock table public."welfare_contributions" in access exclusive mode;
do $guard$ begin
  if (select jsonb_object_agg(policyname, jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles::text,
    'cmd', cmd, 'qual', qual, 'with_check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'welfare_contributions'
      and policyname in ('welfare contributions: parties read', 'welfare contributions: staff write'))
    is distinct from '{"welfare contributions: parties read": {"policyname": "welfare contributions: parties read", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "SELECT", "qual": "private.can_read_welfare_member(group_id, member_id)", "with_check": null}, "welfare contributions: staff write": {"policyname": "welfare contributions: staff write", "permissive": "PERMISSIVE", "roles": "{authenticated}", "cmd": "ALL", "qual": "( SELECT private.is_platform_staff() AS is_platform_staff)", "with_check": "( SELECT private.is_platform_staff() AS is_platform_staff)"}}'::jsonb then
    raise exception 'Policy drift on public.welfare_contributions; review before consolidating';
  end if;
end $guard$;
drop policy "welfare contributions: parties read" on public."welfare_contributions";
drop policy "welfare contributions: staff write" on public."welfare_contributions";
-- Sources: welfare contributions: staff write
create policy "perf_authenticated_delete" on public."welfare_contributions"
  as permissive for delete to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: welfare contributions: staff write
create policy "perf_authenticated_insert" on public."welfare_contributions"
  as permissive for insert to "authenticated"
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: welfare contributions: parties read; welfare contributions: staff write
create policy "perf_authenticated_select" on public."welfare_contributions"
  as permissive for select to "authenticated"
  using ((private.can_read_welfare_member(group_id, member_id))
    OR (( SELECT private.is_platform_staff() AS is_platform_staff)));
-- Sources: welfare contributions: staff write
create policy "perf_authenticated_update" on public."welfare_contributions"
  as permissive for update to "authenticated"
  using ((( SELECT private.is_platform_staff() AS is_platform_staff)))
  with check ((( SELECT private.is_platform_staff() AS is_platform_staff)));
commit;
