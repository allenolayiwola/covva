import type { Metadata } from "next";
import { Suspense } from "react";
import { Checkbox, DemoBadge, EmptyState, Notice, PageHeader, Pill } from "@im/ui";
import { formatDateTime, humanize } from "@im/core";
import { can, requireKind, ROLES } from "../../_lib/context";
import { getCategoryMap, getOrgNames } from "../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { KV, PageSkeleton, Section } from "@/components/partner/ui";
import { updateLineIntegration } from "./actions";

export const metadata: Metadata = { title: "Integrations" };

const LEVEL_LABEL: Record<string, string> = {
  L1: "Level 1 — referral / manual",
  L2: "Level 2 — delegated issuance",
  L3: "Level 3 — API connected",
};

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title="Integrations"
        description="How Covva routes orders for each of your product lines. The platform sets the integration level; you choose whether customers can buy directly and which brokers (if any) your Covva sales go through."
      />
      <Suspense fallback={<PageSkeleton stats={0} rows={3} />}>
        <Integrations />
      </Suspense>
    </>
  );
}

async function Integrations() {
  const ctx = await requireKind("insurer");
  const sb = ctx.supabase;
  const [{ data: lines }, { data: appts }, cats] = await Promise.all([
    sb.from("insurer_line_integrations").select("*").eq("insurer_org_id", ctx.orgId).order("created_at"),
    sb.from("insurer_broker_appointments").select("broker_org_id, category_id, active, ends_on").eq("insurer_org_id", ctx.orgId).eq("active", true),
    getCategoryMap(),
  ]);
  const brokerIds = [...new Set((appts ?? []).map((a) => a.broker_org_id))];
  const names = await getOrgNames(ctx, brokerIds);
  const canEdit = can(ctx, ROLES.orgAdmin);

  if (!lines?.length) {
    return <EmptyState title="No line integrations yet" body="Covva sets up an integration per product line when your products are approved. Until then your products are sold through appointed brokers." />;
  }

  return (
    <>
      {!canEdit && <Notice tone="wait" className="mb-4">Owners and admins change routing preferences. Your role can view them.</Notice>}
      <div className="space-y-6">
        {lines.map((l) => {
          const cat = cats.get(l.category_id);
          const appointed = brokerIds.filter((b) => (appts ?? []).some((a) => a.broker_org_id === b && (!a.category_id || a.category_id === l.category_id)));
          const direct = l.active && (l.level === "L2" || l.level === "L3" || (l.level === "L1" && l.direct_sales));
          return (
            <Section
              key={l.id}
              title={cat?.name ?? "Product line"}
              description={LEVEL_LABEL[l.level] ?? l.level}
              actions={
                <>
                  <Pill tone={l.active ? "ok" : "neutral"}>{l.active ? "Active" : "Inactive"}</Pill>
                  <Pill tone={direct ? "ok" : "wait"}>{direct ? "Orders go to you directly" : "Orders go through brokers"}</Pill>
                </>
              }
            >
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <KV label="Integration level">{l.level}</KV>
                  <KV label="Issuance">{humanize(l.issuance_type)}</KV>
                  <KV label="Service level">{l.sla_hours} h</KV>
                  <KV label="Nominated brokers">{l.nominated_broker_org_ids.length ? l.nominated_broker_org_ids.map((id) => names.get(id) ?? "Broker").join(", ") : "None — any appointed broker"}</KV>
                  <KV label="Updated">{formatDateTime(l.updated_at)}</KV>
                  <p className="mt-3 text-xs text-muted">
                    {l.level === "L1"
                      ? "At Level 1, orders reach you through a broker unless you switch on direct sales. Customers who ask to talk to an expert, and complex risks, always go to a broker."
                      : "At this level customers can buy your products directly on Covva; advice requests and complex risks still go to a broker with a verified appointment."}
                  </p>
                </div>
                <div>
                  {canEdit ? (
                    <ActionForm action={updateLineIntegration} submitLabel="Save routing preferences">
                      <input type="hidden" name="integrationId" value={l.id} />
                      {l.level === "L1" && <Checkbox name="direct_sales" defaultChecked={l.direct_sales} label="Allow direct sales (customers buy without a broker)" />}
                      <fieldset className="mt-2">
                        <legend className="text-sm font-medium text-ink">Nominated brokers for this line</legend>
                        <p className="mb-2 text-xs text-muted">Tick brokers to route all your Covva sales on this line through them. Leave empty to use every appointed broker.</p>
                        {appointed.length === 0 ? (
                          <p className="text-sm text-muted">No appointed brokers for this line yet.</p>
                        ) : (
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {appointed.map((id) => (
                              <Checkbox key={id} name="nominated" value={id} defaultChecked={l.nominated_broker_org_ids.includes(id)} label={names.get(id) ?? "Broker"} />
                            ))}
                          </div>
                        )}
                      </fieldset>
                    </ActionForm>
                  ) : (
                    <p className="text-sm text-muted">Direct sales: {l.direct_sales ? "on" : "off"}.</p>
                  )}
                </div>
              </div>
            </Section>
          );
        })}
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
