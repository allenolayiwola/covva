-- Select policies must work on rows inserted in the same statement (INSERT ... RETURNING).
-- Helper functions read a snapshot that doesn't include the new row, so check columns directly.
alter policy "requests: parties read" on public.requests
  using (customer_id = (select auth.uid())
      or broker_org_id in (select private.user_org_ids())
      or (select private.is_platform_staff())
      or private.can_access_request(id));

alter policy "policies: parties read" on public.policies
  using (customer_id = (select auth.uid())
      or broker_org_id in (select private.user_org_ids())
      or insurer_org_id in (select private.user_org_ids())
      or (select private.is_platform_staff()));

alter policy "claims: parties read" on public.claims
  using (customer_id = (select auth.uid())
      or broker_org_id in (select private.user_org_ids())
      or insurer_org_id in (select private.user_org_ids())
      or (select private.is_platform_staff()));
