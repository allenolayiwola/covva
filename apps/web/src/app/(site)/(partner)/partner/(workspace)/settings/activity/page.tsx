import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice, PageHeader, Pill, Table, Tabs, Td, Th, THead } from "@im/ui";
import { ACTIVITY_ENTITY_LABEL, TEAM_ACTIVITY_ENTITIES, describeActivity, formatDateTime, humanize } from "@im/core";
import { can, getPartnerContext, ROLES, type PartnerContext } from "../../../_lib/context";
import { getTeam } from "../../../_lib/data";
import { Chip, Empty, PageSkeleton } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Activity" };

/**
 * Read-only audit trail for the organisation (owners and admins): what each team member did,
 * from `audit_events` through the `partner_activity` view (security_invoker, so the audit RLS
 * — owner/admin/supervisor of the org — applies). Row payloads are never shown here: the view
 * exposes a whitelisted `detail` (role / active / supervisor / team changes, invitation email and
 * role, authenticator count), which `describeActivity` turns into one plain sentence per row —
 * "Changed Ama's role: Underwriter → Claims", "Invited x@y as Finance", "Set up two-step verification".
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

const ENTITY_LABEL = ACTIVITY_ENTITY_LABEL;

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
  const scope = sp.scope === "team" ? "team" : "all";
  return (
    <>
      {tabsNav}
      <ActivityTable ctx={ctx} member={member} entity={entity} scope={scope} />
    </>
  );
}

async function ActivityTable({ ctx, member, entity, scope }: { ctx: PartnerContext; member: string; entity: string; scope: "all" | "team" }) {
  let q = ctx.supabase.from("partner_activity").select("id, actor_id, actor_role, action, entity_type, entity_id, occurred_at, changed_fields, subject_user_id, detail").eq("org_id", ctx.orgId).order("occurred_at", { ascending: false }).limit(150);
  if (member) q = q.eq("actor_id", member);
  if (entity) q = q.eq("entity_type", entity);
  if (scope === "team") q = q.in("entity_type", [...TEAM_ACTIVITY_ENTITIES]);
  const [{ data: rows }, team] = await Promise.all([q, getTeam(ctx, true)]);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const entities = [...new Set((rows ?? []).map((r) => r.entity_type).filter((x): x is string => !!x))].sort();
  const lines = (rows ?? []).map((r) => ({ row: r, line: describeActivity(r, { kind: ctx.kind, names: (id) => (id ? names.get(id) : null) }) }));
  const filterQuery = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(member ? { member } : {}), ...(entity ? { entity } : {}), ...(scope === "team" ? { scope } : {}), ...over });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const qs = p.toString();
    return `/partner/settings/activity${qs ? `?${qs}` : ""}`;
  };

  return (
    <section className="rounded-card border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Activity</h2>
          <p className="mt-0.5 text-sm text-muted">What each member of {ctx.orgName} changed, newest first. The audit chain is tamper-evident; nothing here can be edited.</p>
        </div>
        <form action="/partner/settings/activity" className="flex flex-wrap gap-2">
          {scope === "team" && <input type="hidden" name="scope" value="team" />}
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
      <div className="flex flex-wrap gap-2 px-5 pt-3">
        <Chip href={filterQuery({ scope: "" })} active={scope === "all"}>Everything</Chip>
        <Chip href={filterQuery({ scope: "team", entity: "" })} active={scope === "team"}>Team changes</Chip>
      </div>
      <div className="px-5 pb-5 pt-3">
        {lines.length === 0 ? (
          <Empty>{scope === "team" ? "No team changes recorded yet. Role changes, invitations, deactivations and two-step verification set-ups show here." : "No activity recorded yet."}</Empty>
        ) : (
          <Table>
            <THead><tr><Th>When</Th><Th>Who</Th><Th>What happened</Th><Th>Record</Th></tr></THead>
            <tbody>
              {lines.map(({ row: r, line }) => (
                <tr key={r.id} className="hover:bg-mist/60">
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(r.occurred_at)}</Td>
                  <Td className={r.actor_id ? undefined : "text-muted"}>{line.actor}</Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-2">
                      <Pill tone={line.tone}>{line.entityLabel}</Pill>
                      <span className="text-ink">{line.summary}</span>
                    </span>
                  </Td>
                  <Td className="text-xs text-muted">
                    {ENTITY_LABEL[r.entity_type ?? ""] ?? humanize(r.entity_type ?? "")}
                    {r.entity_id && <span className="block font-mono text-[11px] text-subtle">{r.entity_id.slice(0, 8)}</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </section>
  );
}
