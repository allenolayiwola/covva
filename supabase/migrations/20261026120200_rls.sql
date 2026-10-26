-- =============================================================================
-- Row Level Security. Every table is locked down; brokers and insurers only
-- see their own routed work (spec: isolate each broker's customers, quotes,
-- documents and commission data).
-- =============================================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Access helpers --------------------------------------------------------------
create or replace function private.can_access_request(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    where r.id = p_request and (
      r.customer_id = (select auth.uid())
      or r.broker_org_id in (select private.user_org_ids())
      or exists (select 1 from public.insurer_submissions s
                 where s.request_id = r.id and s.insurer_org_id in (select private.user_org_ids()))
      or private.is_platform_staff()
    )
  );
$$;

create or replace function private.is_request_customer(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.requests r where r.id = p_request and r.customer_id = (select auth.uid()));
$$;

create or replace function private.is_request_staff(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_staff() or exists (
    select 1 from public.requests r
    where r.id = p_request and (
      r.broker_org_id in (select private.user_org_ids())
      or exists (select 1 from public.insurer_submissions s
                 where s.request_id = r.id and s.insurer_org_id in (select private.user_org_ids()))
    )
  );
$$;

create or replace function private.can_view_customer(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = (select auth.uid()) or private.is_platform_staff() or exists (
    select 1 from public.requests r
    where r.customer_id = p_user and (
      r.broker_org_id in (select private.user_org_ids())
      or exists (select 1 from public.insurer_submissions s
                 where s.request_id = r.id and s.insurer_org_id in (select private.user_org_ids()))
    )
  ) or exists (
    select 1 from public.policies p
    where p.customer_id = p_user and (p.broker_org_id in (select private.user_org_ids()) or p.insurer_org_id in (select private.user_org_ids()))
  );
$$;

create or replace function private.can_access_policy(p_policy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.policies p where p.id = p_policy and (
      p.customer_id = (select auth.uid())
      or p.broker_org_id in (select private.user_org_ids())
      or p.insurer_org_id in (select private.user_org_ids())
      or private.is_platform_staff()
    )
  );
$$;

create or replace function private.can_access_claim(p_claim uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.claims c where c.id = p_claim and (
      c.customer_id = (select auth.uid())
      or c.broker_org_id in (select private.user_org_ids())
      or c.insurer_org_id in (select private.user_org_ids())
      or private.is_platform_staff()
    )
  );
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- Organisations ---------------------------------------------------------------
create policy "orgs: public directory of active brokers and insurers" on public.organizations
  for select to anon, authenticated using (status = 'active' and type in ('broker', 'insurer'));
create policy "orgs: members read own" on public.organizations
  for select to authenticated using (id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "orgs: owners update own" on public.organizations
  for update to authenticated using (private.has_org_role(id, '{owner,admin}') or (select private.is_platform_staff()));
create policy "orgs: staff create" on public.organizations
  for insert to authenticated with check ((select private.is_platform_staff()));

-- Profiles --------------------------------------------------------------------
create policy "profiles: read self, servicing staff" on public.profiles
  for select to authenticated using (private.can_view_customer(id));
create policy "profiles: update self" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: staff update" on public.profiles
  for update to authenticated using ((select private.is_platform_staff()));

-- Memberships & invitations ----------------------------------------------------
create policy "memberships: read own org" on public.memberships
  for select to authenticated using (user_id = (select auth.uid()) or org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "memberships: org admins manage" on public.memberships
  for all to authenticated
  using (private.has_org_role(org_id, '{owner,admin}') or (select private.is_platform_staff()))
  with check (private.has_org_role(org_id, '{owner,admin}') or (select private.is_platform_staff()));
create policy "invitations: org admins manage" on public.invitations
  for all to authenticated
  using (private.has_org_role(org_id, '{owner,admin}') or (select private.is_platform_staff()))
  with check (private.has_org_role(org_id, '{owner,admin}') or (select private.is_platform_staff()));

-- Consents & KYC ----------------------------------------------------------------
create policy "consents: own" on public.consents
  for select to authenticated using (user_id = (select auth.uid()) or (select private.is_platform_staff()));
create policy "consents: record own" on public.consents
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "kyc: own read" on public.kyc_verifications
  for select to authenticated using (user_id = (select auth.uid()) or (select private.is_platform_staff()));
create policy "kyc: own submit" on public.kyc_verifications
  for insert to authenticated with check (user_id = (select auth.uid()) and status = 'pending');
create policy "kyc: staff review" on public.kyc_verifications
  for update to authenticated using ((select private.is_platform_staff()));

-- Catalogue -------------------------------------------------------------------
create policy "categories: public read" on public.product_categories for select to anon, authenticated using (true);
create policy "categories: staff write" on public.product_categories for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));

create policy "products: public read approved" on public.products for select to anon, authenticated
  using (status = 'approved' or insurer_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "products: insurer and staff write" on public.products for all to authenticated
  using (private.has_org_role(insurer_org_id, '{owner,admin,underwriter}') or (select private.is_platform_staff()))
  with check (private.has_org_role(insurer_org_id, '{owner,admin,underwriter}') or (select private.is_platform_staff()));

create policy "versions: public read approved" on public.product_versions for select to anon, authenticated
  using (status = 'approved' or exists (select 1 from public.products p where p.id = product_id
         and (p.insurer_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))));
create policy "versions: insurer and staff write" on public.product_versions for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id
         and (private.has_org_role(p.insurer_org_id, '{owner,admin,underwriter}') or (select private.is_platform_staff()))))
  with check (exists (select 1 from public.products p where p.id = product_id
         and (private.has_org_role(p.insurer_org_id, '{owner,admin,underwriter}') or (select private.is_platform_staff()))));

create policy "appointments: parties read" on public.insurer_broker_appointments for select to authenticated
  using (insurer_org_id in (select private.user_org_ids()) or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "appointments: staff write" on public.insurer_broker_appointments for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));

create policy "routing: broker reads own" on public.broker_routing_rules for select to authenticated
  using (broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "routing: staff write" on public.broker_routing_rules for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));

-- Needs assessments & recommendations -----------------------------------------
create policy "assessments: own" on public.needs_assessments for all to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_staff()))
  with check (user_id = (select auth.uid()));
create policy "recommendations: via request or assessment" on public.recommendation_runs for select to authenticated
  using ((request_id is not null and private.can_access_request(request_id))
      or exists (select 1 from public.needs_assessments a where a.id = needs_assessment_id and a.user_id = (select auth.uid()))
      or (select private.is_platform_staff()));

-- Requests ----------------------------------------------------------------------
create policy "requests: parties read" on public.requests for select to authenticated
  using (private.can_access_request(id));
create policy "requests: customer creates own" on public.requests for insert to authenticated
  with check (customer_id = (select auth.uid()) or private.is_org_member(broker_org_id) or (select private.is_platform_staff()));
create policy "requests: customer edits while waiting on them" on public.requests for update to authenticated
  using (customer_id = (select auth.uid()) and status in ('draft', 'awaiting_customer_info', 'quotes_ready'))
  with check (customer_id = (select auth.uid()));
create policy "requests: broker and staff manage" on public.requests for update to authenticated
  using (broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));

create policy "disclosures: parties read" on public.broker_disclosures for select to authenticated
  using (private.can_access_request(request_id));
create policy "disclosures: customer acknowledges" on public.broker_disclosures for insert to authenticated
  with check (shown_to = (select auth.uid()) and private.is_request_customer(request_id));

create policy "request events: read" on public.request_events for select to authenticated
  using (private.is_request_staff(request_id) or (visible_to_customer and private.is_request_customer(request_id)));
create policy "request events: add note" on public.request_events for insert to authenticated
  with check (actor_id = (select auth.uid()) and private.can_access_request(request_id));

create policy "tasks: read" on public.request_tasks for select to authenticated using (private.can_access_request(request_id));
create policy "tasks: staff manage" on public.request_tasks for all to authenticated
  using (private.is_request_staff(request_id)) with check (private.is_request_staff(request_id));
create policy "tasks: customer completes own" on public.request_tasks for update to authenticated
  using (assignee_party = 'customer' and private.is_request_customer(request_id))
  with check (assignee_party = 'customer' and private.is_request_customer(request_id));

create policy "messages: read" on public.request_messages for select to authenticated
  using (private.is_request_staff(request_id) or (not internal and private.is_request_customer(request_id)));
create policy "messages: send" on public.request_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and (
    (private.is_request_customer(request_id) and sender_party = 'customer' and not internal)
    or private.is_request_staff(request_id)));
create policy "messages: mark read" on public.request_messages for update to authenticated
  using (private.can_access_request(request_id));

-- Submissions & quotes ---------------------------------------------------------------
create policy "submissions: broker and insurer read" on public.insurer_submissions for select to authenticated
  using (broker_org_id in (select private.user_org_ids()) or insurer_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "submissions: broker creates" on public.insurer_submissions for insert to authenticated
  with check (broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "submissions: parties update" on public.insurer_submissions for update to authenticated
  using (broker_org_id in (select private.user_org_ids()) or insurer_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));

create policy "quotes: parties read" on public.quotes for select to authenticated
  using (insurer_org_id in (select private.user_org_ids())
      or broker_org_id in (select private.user_org_ids())
      or (private.is_request_customer(request_id) and status <> 'withdrawn')
      or (select private.is_platform_staff()));
create policy "quotes: broker and insurer write" on public.quotes for insert to authenticated
  with check (insurer_org_id in (select private.user_org_ids()) or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "quotes: broker and insurer update" on public.quotes for update to authenticated
  using (insurer_org_id in (select private.user_org_ids()) or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));

-- Applications, payments, policies -------------------------------------------------
create policy "applications: parties read" on public.applications for select to authenticated
  using (customer_id = (select auth.uid()) or private.is_request_staff(request_id));
create policy "applications: customer creates" on public.applications for insert to authenticated
  with check (customer_id = (select auth.uid()) and private.is_request_customer(request_id));
create policy "applications: customer edits draft" on public.applications for update to authenticated
  using (customer_id = (select auth.uid()) and status = 'draft');
create policy "applications: staff decide" on public.applications for update to authenticated
  using (private.is_request_staff(request_id));

create policy "payments: parties read" on public.payments for select to authenticated
  using (customer_id = (select auth.uid()) or payee_org_id in (select private.user_org_ids()) or private.is_request_staff(request_id));
-- payments are written only by the server (service role) after provider confirmation.
create policy "payments: staff reconcile" on public.payments for update to authenticated
  using ((select private.is_platform_staff()) or payee_org_id in (select private.user_org_ids()));

create policy "policies: parties read" on public.policies for select to authenticated using (private.can_access_policy(id));
create policy "policies: insert" on public.policies for insert to authenticated
  with check (customer_id = (select auth.uid()) or insurer_org_id in (select private.user_org_ids())
              or broker_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "policies: update" on public.policies for update to authenticated using (private.can_access_policy(id));

-- Documents --------------------------------------------------------------------------
create policy "documents: read" on public.documents for select to authenticated
  using (owner_id = (select auth.uid())
      or (request_id is not null and private.is_request_staff(request_id))
      or (policy_id is not null and private.can_access_policy(policy_id) and owner_id <> (select auth.uid()))
      or (claim_id is not null and private.can_access_claim(claim_id))
      or (select private.is_platform_staff()));
create policy "documents: upload" on public.documents for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and (
    owner_id = (select auth.uid())
    or (request_id is not null and private.is_request_staff(request_id))
    or (policy_id is not null and private.can_access_policy(policy_id))
    or (claim_id is not null and private.can_access_claim(claim_id))));
create policy "documents: update by staff" on public.documents for update to authenticated
  using ((request_id is not null and private.is_request_staff(request_id))
      or (claim_id is not null and private.can_access_claim(claim_id) and owner_id <> (select auth.uid()))
      or (select private.is_platform_staff()));
create policy "documents: delete own unverified" on public.documents for delete to authenticated
  using (uploaded_by = (select auth.uid()) and not verified and delivered_to_insurer_at is null);

-- Claims & complaints ------------------------------------------------------------
create policy "claims: parties read" on public.claims for select to authenticated using (private.can_access_claim(id));
create policy "claims: customer reports" on public.claims for insert to authenticated
  with check (customer_id = (select auth.uid()) and exists (
    select 1 from public.policies p where p.id = policy_id and p.customer_id = (select auth.uid())));
create policy "claims: parties update" on public.claims for update to authenticated using (private.can_access_claim(id));

create policy "claim events: read" on public.claim_events for select to authenticated
  using (private.can_access_claim(claim_id) and (visible_to_customer or exists (
    select 1 from public.claims c where c.id = claim_id and c.customer_id <> (select auth.uid()))));
create policy "claim events: note" on public.claim_events for insert to authenticated
  with check (actor_id = (select auth.uid()) and private.can_access_claim(claim_id));

create policy "complaints: parties read" on public.complaints for select to authenticated
  using (customer_id = (select auth.uid()) or owner_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "complaints: customer files" on public.complaints for insert to authenticated
  with check (customer_id = (select auth.uid()));
create policy "complaints: owner manages" on public.complaints for update to authenticated
  using (owner_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()));
create policy "complaint events: read" on public.complaint_events for select to authenticated
  using (exists (select 1 from public.complaints c where c.id = complaint_id and (
    c.customer_id = (select auth.uid()) or c.owner_org_id in (select private.user_org_ids()) or (select private.is_platform_staff()))));

-- Notifications & devices -----------------------------------------------------------
create policy "notifications: own" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: mark read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "devices: own" on public.device_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- SaaS -----------------------------------------------------------------------------------
create policy "plans: public read" on public.plans for select to anon, authenticated using (active or (select private.is_platform_staff()));
create policy "plans: staff write" on public.plans for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));
create policy "subscriptions: org read" on public.subscriptions for select to authenticated
  using (private.has_org_role(org_id, '{owner,admin,finance}') or (select private.is_platform_staff()));
create policy "subscriptions: staff write" on public.subscriptions for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));
create policy "usage: org read" on public.usage_events for select to authenticated
  using (private.has_org_role(org_id, '{owner,admin,finance}') or (select private.is_platform_staff()));
create policy "invoices: org read" on public.invoices for select to authenticated
  using (private.has_org_role(org_id, '{owner,admin,finance}') or (select private.is_platform_staff()));
create policy "invoices: staff write" on public.invoices for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));
create policy "api keys: org admins" on public.api_keys for all to authenticated
  using (private.has_org_role(org_id, '{owner,admin}') or (select private.is_platform_staff()))
  with check (private.has_org_role(org_id, '{owner,admin}') or (select private.is_platform_staff()));
create policy "webhooks: org admins" on public.webhook_endpoints for all to authenticated
  using (private.has_org_role(org_id, '{owner,admin}') or (select private.is_platform_staff()))
  with check (private.has_org_role(org_id, '{owner,admin}') or (select private.is_platform_staff()));
create policy "webhook deliveries: org admins read" on public.webhook_deliveries for select to authenticated
  using (exists (select 1 from public.webhook_endpoints w where w.id = endpoint_id
    and (private.has_org_role(w.org_id, '{owner,admin}') or (select private.is_platform_staff()))));
create policy "connectors: insurer admins and staff" on public.connector_configs for all to authenticated
  using (private.has_org_role(insurer_org_id, '{owner,admin}') or (select private.is_platform_staff()))
  with check (private.has_org_role(insurer_org_id, '{owner,admin}') or (select private.is_platform_staff()));

-- AI ----------------------------------------------------------------------------------------
create policy "ai threads: own" on public.ai_threads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "ai usage: staff and org admins" on public.ai_usage for select to authenticated
  using ((select private.is_platform_staff()) or private.has_org_role(org_id, '{owner,admin}'));

-- Marketing & config -------------------------------------------------------------------
create policy "leads: anyone submits" on public.leads for insert to anon, authenticated with check (status = 'new');
create policy "leads: staff manage" on public.leads for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));
create policy "flags: read" on public.feature_flags for select to anon, authenticated using (true);
create policy "flags: staff write" on public.feature_flags for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));
create policy "settings: read" on public.platform_settings for select to anon, authenticated using (true);
create policy "settings: staff write" on public.platform_settings for all to authenticated
  using ((select private.is_platform_staff())) with check ((select private.is_platform_staff()));

create policy "audit: staff and org leads read" on public.audit_events for select to authenticated
  using ((select private.is_platform_staff()) or (org_id is not null and private.has_org_role(org_id, '{owner,admin,supervisor}')));

-- Storage -------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 20971520,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('org-assets', 'org-assets', true, 5242880, array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
on conflict (id) do nothing;

-- documents bucket layout: {customer_user_id}/{request|policy|claim}/{uuid}-{file}
create policy "documents bucket: customer own folder" on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "documents bucket: servicing staff read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and exists (
    select 1 from public.documents d where d.storage_path = name and (
      (d.request_id is not null and private.is_request_staff(d.request_id))
      or (d.policy_id is not null and private.can_access_policy(d.policy_id))
      or (d.claim_id is not null and private.can_access_claim(d.claim_id))
      or (select private.is_platform_staff()))));
create policy "documents bucket: servicing staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and exists (
    select 1 from public.memberships m where m.user_id = (select auth.uid()) and m.active));
create policy "org assets: public read" on storage.objects for select to anon, authenticated using (bucket_id = 'org-assets');
create policy "org assets: org admins write" on storage.objects for insert to authenticated
  with check (bucket_id = 'org-assets' and ((storage.foldername(name))[1])::uuid in (select private.user_org_ids()));

-- Realtime for live status (web + mobile) --------------------------------------------------------
alter publication supabase_realtime add table public.requests, public.request_messages, public.request_tasks,
  public.quotes, public.policies, public.claims, public.notifications;
