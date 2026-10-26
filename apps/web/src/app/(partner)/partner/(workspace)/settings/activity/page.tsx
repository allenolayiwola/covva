import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice, PageHeader, Pill, Table, Tabs, Td, Th, THead } from "@im/ui";
import { formatDateTime, humanize } from "@im/core";
import { can, getPartnerContext, ROLES, type PartnerContext } from "../../../_lib/context";
import { getTeam } from "../../../_lib/data";
import { Empty, PageSkeleton } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Activity" };

/**
 * Read-only audit trail for the organisation (owners and admins): what each team member did,
 * from `audit_events` through the `partner_activity` view (security_invoker, so the audit RLS
 * — owner/admin/supervisor of the org — applies). Row payloads are never shown here.
 */
export default function ActivityPage({ searchParams }: PageProps<"/partner/settings/activity">) {
  return (
    <>
      <PageHeader title="Team settings" description="Your team, organisation profile, licence, billing and integrations." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Activity searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const ENTITY_LABEL: Record<string, string> = {
  requests: "Request",
  quotes: "Quote",
  policies: "Policy",
  claims: "Claim",
  memberships: "Team member",
  organizations: "Organisation",
  api_keys: "API key",
  webhook_endpoints: "Webhook",
  invitations: "Invitation",
  insurer_submissions: "Submission",
  products: "Product",
  product_versions: "Product version",
  complaints: "Complaint",
  documents: "Document",
};

const ACTION_TONE = { insert: "ok", update: "info", delete: "danger" } as const;

async function Activity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPartnerContext();
  const sp = await searchParams;
  const tabs = [
    { key: "team", label: "Team" },
    { key: "organisation", label: "Organisation" },
    { key: "licence", label: "NIC licence" },
    { key: "billing", label: "Billing" },
    { key: "terms", label: "Commercial terms" },
    { key: "developer", label: "Developer" },
    ...(ctx.kind === "insurer" ? [{ key: "connector", label: "Connector" }] : []),
    { key: "security", label: "Security" },
    { key: "activity", label: "Activity" },
  ];
  const tabsNav = <Tabs className="mb-6 w-fit max-w-full" active="activity" items={tabs.map((t) => ({ ...t, href: t.key === "security" ? "/partner/settings/security" : t.key === "activity" ? "/partner/settings/activity" : `/partner/settings?tab=${t.key}` }))} />;
  if (!can(ctx, ROLES.orgAdmin)) {
    return (
      <>
        {tabsNav}
        <Notice tone="info">The activity log is visible to organisation owners and admins.</Notice>
      </>
    );
  }
  const member = typeof sp.member === "string" ? sp.member : "";
  const entity = typeof sp.entity === "string" ? sp.entity : "";
  return (
    <>
      {tabsNav}
      <ActivityTable ctx={ctx} member={member} entity={entity} />
    </>
  );
}

async function ActivityTable({ ctx, member, entity }: { ctx: PartnerContext; member: string; entity: string }) {
  let q = ctx.supabase.from("partner_activity").select("id, actor_id, actor_role, action, entity_type, entity_id, occurred_at, changed_fields").eq("org_id", ctx.orgId).order("occurred_at", { ascending: false }).limit(150);
  if (member) q = q.eq("actor_id", member);
  if (entity) q = q.eq("entity_type", entity);
  const [{ data: rows }, team] = await Promise.all([q, getTeam(ctx, true)]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const entities = [...new Set((rows ?? []).map((r) => r.entity_type).filter((x): x is string => !!x))].sort();

  return (
    <section className="rounded-card border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Activity</h2>
          <p className="mt-0.5 text-sm text-muted">What each member of {ctx.orgName} changed, newest first. The audit chain is tamper-evident; nothing here can be edited.</p>
        </div>
        <form action="/partner/settings/activity" className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="activity-member">Team member</label>
          <select id="activity-member" name="member" defaultValue={member} className="h-9 rounded-[10px] border border-line bg-white px-3 pr-8 text-sm text-muted">
            <option value="">All members</option>
            {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="activity-entity">Record type</label>
          <select id="activity-entity" name="entity" defaultValue={entity} className="h-9 rounded-[10px] border border-line bg-white px-3 pr-8 text-sm text-muted">
            <option value="">All records</option>
            {entities.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e] ?? humanize(e)}</option>)}
          </select>
          <button className="h-9 rounded-[10px] bg-mint px-4 text-sm font-semibold text-brand-deep">Filter</button>
        </form>
      </div>
      <div className="px-5 pb-5 pt-3">
        {(rows ?? []).length === 0 ? (
          <Empty>No activity recorded yet.</Empty>
        ) : (
          <Table>
            <THead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Changed</Th></tr></THead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-mist/60">
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(r.occurred_at)}</Td>
                  <Td>{r.actor_id ? names.get(r.actor_id) ?? "Former member" : <span className="text-muted">{r.actor_role === "service_role" ? "Platform (automated)" : "System"}</span>}</Td>
                  <Td><Pill tone={ACTION_TONE[(r.action ?? "update") as keyof typeof ACTION_TONE] ?? "neutral"}>{humanize(r.action ?? "")}</Pill></Td>
                  <Td>
                    {ENTITY_LABEL[r.entity_type ?? ""] ?? humanize(r.entity_type ?? "")}
                    {r.entity_id && <span className="block font-mono text-[11px] text-subtle">{r.entity_id.slice(0, 8)}</span>}
                  </Td>
                  <Td className="text-xs text-muted">{(r.changed_fields ?? []).map((f) => humanize(f)).join(", ") || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </section>
  );
}
