-- Customers may only acknowledge the request's current broker of record,
-- or explicitly confirm a broker change (the change itself is made by broker/platform).
alter policy "disclosures: customer acknowledges" on public.broker_disclosures
  with check (
    shown_to = (select auth.uid())
    and private.is_request_customer(request_id)
    and (
      stage = 'broker_change'
      or exists (select 1 from public.requests r where r.id = request_id and r.broker_org_id = broker_disclosures.broker_org_id)
    )
  );
