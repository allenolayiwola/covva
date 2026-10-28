import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { WELFARE_GROUP_STATUS, WELFARE_MEMBER_STATUS, contributionPlanLabel, formatDate, formatGHS, humanize, welfareKindLabel, type WelfareGroupStatus, type WelfareMemberStatus } from "@im/core";
import { Card, DefinitionList, EmptyState, PageHeader, Pill, StatCard, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { getPartnerContext } from "../../_lib/context";
import { PageSkeleton } from "@/components/partner/ui";
import { formatGhanaPhone } from "@/components/customer/utils";
import { partnerWelfareGroups, welfareGroupDetail } from "@/server/welfare";
import { BusinessRuleError } from "@/server/requests";

export const metadata: Metadata = { title: "Welfare groups" };

/**
 * Welfare groups where this organisation is the broker of record or the insurer (RLS scopes the reads). The
 * broker sees enrolment, who is paid up and the group's claims; it never collects contributions itself — every
 * contribution is a premium payment on the master policy, settled by the PSP with the broker's commission split.
 */
export default function PartnerGroupsPage({ searchParams }: PageProps<"/partner/groups">) {
  return (
    <>
      <PageHeader title="Welfare groups" description="Associations, churches, alumni and family groups whose funeral / welfare cover you arrange or underwrite: members, contribution standing and claims." />
      <Suspense fallback={<PageSkeleton stats={3} />}>
        <Groups searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const groupMeta = (s: string) => WELFARE_GROUP_STATUS[s as WelfareGroupStatus] ?? WELFARE_GROUP_STATUS.draft;
const memberMeta = (s: string) => WELFARE_MEMBER_STATUS[s as WelfareMemberStatus] ?? WELFARE_MEMBER_STATUS.invited;

async function Groups({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPartnerContext();
  const sp = await searchParams;
  const selected = Array.isArray(sp.id) ? sp.id[0] : sp.id;
  const rows = await partnerWelfareGroups({ supabase: ctx.supabase, userId: ctx.userId }, ctx.orgId);
  if (!rows.length) {
    return <EmptyState title="No welfare groups yet" body="Groups appear here once a group's cover request is routed to your organisation (broker of record) or placed with you (insurer)." />;
  }
  const arrearsTotal = rows.reduce((s, r) => s + r.summary.arrears, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Groups" value={rows.length} hint={`${rows.filter((r) => r.group.status === "active").length} with cover in force`} />
        <StatCard label="Members in arrears" value={rows.reduce((s, r) => s + r.summary.inArrears, 0)} tone={arrearsTotal ? "warn" : "default"} hint={arrearsTotal ? `${formatGHS(arrearsTotal, { decimals: true })} overdue` : undefined} />
        <StatCard label="Open claims" value={rows.reduce((s, r) => s + r.openClaims, 0)} />
      </div>
      <Table>
        <THead><tr><Th>Group</Th><Th>Status</Th><Th>Members</Th><Th>Paid up / arrears</Th><Th>Plan</Th><Th>Claims</Th><Th></Th></tr></THead>
        <tbody>
          {rows.map(({ group: g, summary, activeMembers, openClaims }) => {
            const m = groupMeta(g.status);
            return (
              <tr key={g.id}>
                <Td><p className="font-medium text-ink">{g.name}</p><p className="text-xs text-muted">{welfareKindLabel(g.kind)} · {g.reference}{g.region ? ` · ${g.region}` : ""}</p></Td>
                <Td><Pill tone={m.tone}>{m.label}</Pill></Td>
                <Td>{activeMembers}</Td>
                <Td>{summary.paidUp} / <span className={summary.inArrears ? "text-danger" : ""}>{summary.inArrears}</span></Td>
                <Td>{contributionPlanLabel({ amount: Number(g.contribution_amount), cadence: g.contribution_cadence })}</Td>
                <Td>{openClaims}</Td>
                <Td><Link href={`/partner/groups?id=${g.id}`} className={buttonClass(selected === g.id ? "primary" : "outline", "sm")}>Open</Link></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {selected && <GroupDetail id={selected} />}
    </div>
  );
}

async function GroupDetail({ id }: { id: string }) {
  const ctx = await getPartnerContext();
  let d;
  try {
    d = await welfareGroupDetail({ supabase: ctx.supabase, userId: ctx.userId }, id);
  } catch (err) {
    if (err instanceof BusinessRuleError) return <EmptyState title="Group not found" body="It may not be placed with your organisation." />;
    throw err;
  }
  const { group } = d;
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{group.name}</h2>
          <p className="text-sm text-muted">{welfareKindLabel(group.kind)} · {group.reference} · admin contact via the request thread</p>
        </div>
        <Pill tone={groupMeta(group.status).tone}>{groupMeta(group.status).label}</Pill>
      </div>
      <DefinitionList
        items={[
          { label: "Broker of record", value: d.broker?.name ?? "—" },
          { label: "Insurer", value: d.insurer?.name ?? "—" },
          { label: "Master policy", value: d.policy ? <Link href={`/partner/policies/${d.policy.id}`} className="font-semibold text-brand hover:underline">{d.policy.policy_number ?? d.policy.internal_reference}</Link> : "—" },
          { label: "Request", value: d.request ? <Link href={`/partner/requests/${d.request.id}`} className="font-semibold text-brand hover:underline">{d.request.reference} · {humanize(d.request.status)}</Link> : "—" },
          { label: "Contribution plan", value: `${contributionPlanLabel({ amount: Number(group.contribution_amount), cadence: group.contribution_cadence })}, due day ${group.contribution_day}` },
          { label: "Collected this month", value: formatGHS(d.summary.collectedThisPeriod, { decimals: true }) },
          { label: "Overdue", value: `${formatGHS(d.summary.arrears, { decimals: true })} across ${d.summary.inArrears} member${d.summary.inArrears === 1 ? "" : "s"}` },
          { label: "Renewal", value: group.renewal_date ? formatDate(group.renewal_date) : "—" },
        ]}
      />
      <section aria-labelledby="pm-h">
        <h3 id="pm-h" className="mb-2 text-sm font-semibold text-ink">Members ({d.members.filter((m) => m.status !== "left").length})</h3>
        <Table>
          <THead><tr><Th>Member</Th><Th>Status</Th><Th>Consent</Th><Th>Contributions</Th><Th>Beneficiaries</Th></tr></THead>
          <tbody>
            {d.members.filter((m) => m.status !== "left").map((m) => {
              const st = d.standings[m.id];
              const bens = d.beneficiaries.filter((b) => b.member_id === m.id);
              return (
                <tr key={m.id}>
                  <Td><p className="font-medium text-ink">{m.full_name}</p><p className="text-xs text-muted">{m.phone ? formatGhanaPhone(m.phone) : "—"}{m.date_of_birth ? ` · born ${formatDate(m.date_of_birth)}` : ""}</p></Td>
                  <Td><Pill tone={memberMeta(m.status).tone}>{memberMeta(m.status).label}</Pill></Td>
                  <Td className="text-xs">{m.consent_at ? `By the member, ${formatDate(m.consent_at)}` : m.consent_attested_by ? "Attested by the admin" : "Not yet"}</Td>
                  <Td>{st ? <Pill tone={st.tone}>{st.label}</Pill> : "—"}</Td>
                  <Td className="text-xs">{bens.length ? bens.map((b) => `${b.full_name} (${humanize(b.relationship)})`).join(", ") : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </section>
      <section aria-labelledby="pc-h">
        <h3 id="pc-h" className="mb-2 text-sm font-semibold text-ink">Claims ({d.claims.length})</h3>
        {d.claims.length === 0 ? <p className="text-sm text-muted">No claims on this group.</p> : (
          <ul className="divide-y divide-line text-sm">
            {d.claims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Link href={`/partner/claims/${c.id}`} className="font-semibold text-brand hover:underline">{c.reference}</Link> · {humanize(c.incident_type)} · {c.welfare_member_id ? d.members.find((m) => m.id === c.welfare_member_id)?.full_name ?? "member" : ""}</span>
                <span className="text-xs text-muted">{humanize(c.status)} · {formatDate(c.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
