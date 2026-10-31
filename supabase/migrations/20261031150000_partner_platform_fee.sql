-- Reuse the existing fee catalogue, subscriptions and invoices; no parallel billing tables.
-- Historical migrations/seeds are immutable. New fees must be entered by an admin.
begin;
insert into public.feature_flags (key, enabled, description)
values ('partner_platform_fee', false, 'Partner platform-fee plans, subscriptions and manual invoices. Enable after billing UI review.')
on conflict (key) do nothing;

-- Compose the existing role helpers, matching apps/admin/lib/roles.ts commercial permission.
create function private.is_partner_billing_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_staff() and exists (
    select 1 from public.organizations o where o.type = 'platform' and o.status <> 'offboarded'
      and private.has_org_role(o.id, '{platform_admin}')
  );
$$;
revoke all on function private.is_partner_billing_admin() from public, anon;
grant execute on function private.is_partner_billing_admin() to authenticated, service_role;

-- Restrictive policies narrow the existing permissive policies without replacing them.
-- No DELETE: financial history is retained. Every write requires the default-off flag.
do $$
declare t text;
begin
  foreach t in array array['plans', 'subscriptions', 'invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "partner billing: admin insert" on public.%I as restrictive for insert to authenticated with check ((select private.is_partner_billing_admin()) and exists (select 1 from public.feature_flags where key = ''partner_platform_fee'' and enabled))', t);
    execute format('create policy "partner billing: admin update" on public.%I as restrictive for update to authenticated using ((select private.is_partner_billing_admin()) and exists (select 1 from public.feature_flags where key = ''partner_platform_fee'' and enabled)) with check ((select private.is_partner_billing_admin()) and exists (select 1 from public.feature_flags where key = ''partner_platform_fee'' and enabled))', t);
    execute format('create policy "partner billing: retain history" on public.%I as restrictive for delete to authenticated using (false)', t);
  end loop;
end $$;

-- Partner fee agreements are private: a partner can read only its subscribed plans.
-- Preserve the unrelated public enterprise catalogue.
create policy "partner billing: private plans" on public.plans as restrictive for select to authenticated
using (audience = 'enterprise' or (select private.is_platform_staff()) or id in (
  select plan_id from public.subscriptions where org_id in (select private.user_org_ids())
));
create policy "partner billing: no anonymous plans" on public.plans as restrictive for select to anon using (audience = 'enterprise');

alter table public.plans alter column monthly_fee drop default;
alter table public.plans alter column per_request_fee drop default;
alter table public.plans alter column per_active_policy_fee drop default;
alter table public.plans add constraint partner_plan_nonnegative_fees
  check (monthly_fee >= 0 and per_request_fee >= 0 and per_active_policy_fee >= 0) not valid;
alter table public.subscriptions add constraint partner_subscription_dates
  check (current_period_end >= current_period_start) not valid;

create function private.partner_subscription_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organizations o join public.plans p on p.id = new.plan_id
    where o.id = new.org_id and o.type in ('broker', 'insurer', 'enterprise') and p.audience = o.type
      and (p.active or (TG_OP = 'UPDATE' and old.plan_id = new.plan_id))
  ) then
    raise exception 'Choose an active plan matching the partner organisation' using errcode = 'P0001';
  end if;
  if TG_OP = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'Subscription partner cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger partner_subscription_guard before insert or update on public.subscriptions
for each row execute function private.partner_subscription_guard();

-- Paid/void rows are immutable, including through direct SQL/API updates.
-- Legacy overdue rows are retained but must be reviewed before any migration to this lifecycle.
create function private.partner_invoice_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'Invoices are retained; void an unpaid invoice instead' using errcode = 'P0001';
  end if;
  if TG_OP = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Invoices must start as drafts' using errcode = 'P0001';
    end if;
  else
    if old.status in ('paid', 'void', 'overdue') then
      raise exception 'Invoice is terminal or requires legacy review' using errcode = 'P0001';
    end if;
    if new.status <> old.status and not (
      (old.status = 'draft' and new.status in ('issued', 'paid', 'void')) or
      (old.status = 'issued' and new.status in ('paid', 'void'))
    ) then
      raise exception 'Invalid invoice transition' using errcode = 'P0001';
    end if;
    if row(new.org_id, new.number, new.period_start, new.period_end, new.currency, new.subtotal, new.tax, new.total)
      is distinct from row(old.org_id, old.number, old.period_start, old.period_end, old.currency, old.subtotal, old.tax, old.total) then
      raise exception 'Invoice financial snapshot cannot change; void and regenerate' using errcode = 'P0001';
    end if;
    if new.lines is distinct from old.lines and not (new.status = 'void' and jsonb_array_length(new.lines) = jsonb_array_length(old.lines) + 1 and new.lines -> -1 ->> 'code' = 'void_note' and new.lines - (jsonb_array_length(new.lines) - 1) = old.lines) then
      raise exception 'Invoice lines cannot change except for an appended void note' using errcode = 'P0001';
    end if;
  end if;
  if not exists (select 1 from public.organizations where id = new.org_id and type in ('broker', 'insurer', 'enterprise')) then
    raise exception 'Invoices are for partner organisations' using errcode = 'P0001';
  end if;
  if new.period_end < new.period_start or new.total < 0 or new.subtotal < 0 or new.tax < 0 or new.total <> new.subtotal + new.tax then
    raise exception 'Invalid invoice dates or totals' using errcode = 'P0001';
  end if;
  if new.status = 'issued' then new.issued_at := coalesce(old.issued_at, now()); end if;
  if new.status = 'paid' then new.paid_at := now(); else new.paid_at := null; end if;
  return new;
end $$;
create trigger partner_invoice_guard before insert or update or delete on public.invoices
for each row execute function private.partner_invoice_guard();
revoke all on function private.partner_invoice_guard(), private.partner_subscription_guard() from public, anon, authenticated;
commit;
