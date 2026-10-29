import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap, pageOf, sp, type SearchParams } from "@/lib/query";
import { FilterBar, FilterInput, FilterSelect, LoadingBlock, Pagination, Panel } from "@/components/ui/layout";
import { AuditTable } from "@/components/AuditTable";
import { VerifyChain } from "./VerifyChain";
import { verifyChain } from "./actions";

const ENTITY_TYPES = [
  "organizations", "memberships", "invitations", "mfa", "product_categories", "products", "product_versions", "rate_tables", "underwriting_rules",
  "document_templates", "insurer_broker_appointments", "broker_routing_rules", "requests", "broker_disclosures", "insurer_submissions", "quotes",
  "applications", "payments", "policies", "claims", "complaints", "consents", "kyc_verifications", "api_keys", "subscriptions", "feature_flags",
  "platform_settings",
];

/** Trigger actions plus the named events written by RPCs (two-step verification, bulk product updates). */
const ACTIONS = ["insert", "update", "delete", "mfa.enrolled", "mfa.removed", "products.bulk_pause", "products.bulk_withdraw", "products.bulk_republish"];

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only, hash-chained record of every change to regulated records, written by database triggers — it cannot be edited or deleted, including by staff. Team changes (roles, invitations, deactivations, two-step verification) and bulk product updates are shown as plain sentences."
      />
      <Suspense fallback={<LoadingBlock label="Loading audit events…" />}>
        <Audit searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Audit({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const orgs = await orgMap(supabase);
  const { page, from, to } = pageOf(params);
  const entity = sp(params, "entity");
  const entityId = sp(params, "entity_id");
  const action = sp(params, "action");
  const actor = sp(params, "actor");
  const org = sp(params, "org");
  const dateFrom = sp(params, "from");
  const dateTo = sp(params, "to");
  const fromId = sp(params, "from_id");

  // Actor may be a user id or an email.
  let actorId: string | null | undefined;
  if (actor) {
    const raw: string = actor;
    if (/^[0-9a-f-]{36}$/i.test(raw)) actorId = raw;
    else {
      const { data } = await supabase.from("profiles").select("id").ilike("email", raw.trim()).maybeSingle();
      actorId = data?.id ?? null;
    }
  }

  let query = supabase.from("audit_events").select("*", { count: "estimated" }).order("id", { ascending: !!fromId }).range(from, to);
  if (entity) query = query.eq("entity_type", entity);
  if (entityId) query = query.eq("entity_id", entityId);
  if (action && ACTIONS.includes(action)) query = query.eq("action", action);
  if (actorId) query = query.eq("actor_id", actorId);
  if (isUuid(org)) query = query.eq("org_id", org);
  if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) query = query.gte("occurred_at", `${dateFrom}T00:00:00Z`);
  if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) query = query.lt("occurred_at", new Date(new Date(`${dateTo}T00:00:00Z`).getTime() + 86_400_000).toISOString());
  if (fromId && /^\d+$/.test(fromId)) query = query.gte("id", Number(fromId) - 1);
  const { data, count, error } = actor && actorId === null ? { data: [], count: 0, error: null } : await query;

  return (
    <div className="space-y-6">
      <Panel title="Verify integrity" description="Recomputes every event's SHA-256 hash from its content and the previous hash. Any edit or deletion breaks the chain at that point.">
        <VerifyChain action={verifyChain} disabled={!can(staff.roles, "audit")} />
      </Panel>
      <div>
        <FilterBar action="/audit">
          <FilterSelect name="entity" label="Entity type" value={entity} options={ENTITY_TYPES.map((e) => ({ value: e, label: e }))} />
          <FilterInput name="entity_id" label="Entity id" value={entityId} />
          <FilterSelect name="action" label="Action" value={action} options={ACTIONS.map((a) => ({ value: a, label: a }))} />
          <FilterInput name="actor" label="Actor (email or id)" value={actor} />
          <FilterSelect name="org" label="Organisation" value={org} options={[...orgs.values()].map((o) => ({ value: o.id, label: o.name }))} />
          <FilterInput name="from" label="From" type="date" value={dateFrom} />
          <FilterInput name="to" label="To" type="date" value={dateTo} />
        </FilterBar>
        {actor && actorId === null && <p className="mb-3 text-sm text-amber">No user found with email “{actor}”.</p>}
        {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
        <AuditTable rows={data ?? []} />
        <Pagination base="/audit" params={params} page={page} total={count} />
      </div>
    </div>
  );
}
