-- rate_tables read policy inlined: a STABLE security-definer function cannot see the row an
-- INSERT ... RETURNING just added, which made broker proposals fail on return. Idempotent
-- (ALTER POLICY, no drops); 20261027100100 now creates the policy in this form on fresh installs.
alter policy "rate_tables: read" on public.rate_tables using (
  (select private.is_platform_staff())
  or (product_version_id is not null and private.can_view_version(product_version_id))
  or submitted_by_org_id in (select private.user_org_ids())
  or (status = 'approved' and (select private.is_partner_user()))
);
