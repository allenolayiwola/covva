-- Admin portal support (additive).
alter table public.leads add column if not exists notes text;
alter table public.payments add column if not exists reconciliation_note text;
alter table public.product_versions add column if not exists review_note text;
alter table public.product_versions add column if not exists reviewed_by uuid references auth.users (id);
alter table public.product_versions add column if not exists reviewed_at timestamptz;

-- Platform staff may record a broker_change disclosure (e.g. after confirming with the
-- customer by phone) so a supervised hand-over can complete. Audited by trigger.
create policy "disclosures: staff record broker change" on public.broker_disclosures
  for insert to authenticated
  with check ((select private.is_platform_staff()) and stage = 'broker_change');
