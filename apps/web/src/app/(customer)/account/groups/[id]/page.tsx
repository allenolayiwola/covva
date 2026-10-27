import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BellRing, Camera, ClipboardList, Link2, Plus, Users, Wallet } from "lucide-react";
import {
  CLAIM_STATUS,
  WELFARE_GROUP_STATUS,
  WELFARE_MEMBER_STATUS,
  WELFARE_RELATIONSHIPS,
  contributionPlanLabel,
  formatDate,
  formatGHS,
  formatMoney,
  humanize,
  welfareDisclaimer,
  welfareKindLabel,
  welfareMemberCsvTemplate,
  type ClaimStatus,
  type WelfareGroupStatus,
  type WelfareMemberStatus,
} from "@im/core";
import { Card, Checkbox, DefinitionList, EmptyState, Field, Input, Notice, PageHeader, Pill, Select, StatCard, Table, Tabs, Td, Textarea, Th, THead, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { MomoPayForm } from "@/components/customer/momo-pay-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { formatGhanaPhone } from "@/components/customer/utils";
import { BusinessRuleError } from "@/server/requests";
import { quoteFx } from "@/server/fx";
import { contributionStatusMeta, welfareGroupDetail, type WelfareContribution, type WelfareGroupDetail, type WelfareMember } from "@/server/welfare";
import { UUID_RE, account } from "../../_lib/data";
import {
  addBeneficiaryAction,
  addMemberAction,
  cancelGroupAction,
  changeMemberAction,
  generateContributionsAction,
  importMembersAction,
  inviteSponsorAction,
  leaveGroupAction,
  payContributionsAction,
  remindMemberAction,
  removeBeneficiaryAction,
  requestCoverAction,
  updatePlanAction,
  waiveContributionAction,
} from "../actions";

export const metadata: Metadata = { title: "Group" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "members", label: "Members" },
  { key: "contributions", label: "Contributions" },
  { key: "claims", label: "Claims" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function GroupPage({ params, searchParams }: PageProps<"/account/groups/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={5} />}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const groupMeta = (s: string) => WELFARE_GROUP_STATUS[s as WelfareGroupStatus] ?? WELFARE_GROUP_STATUS.draft;
const memberMeta = (s: string) => WELFARE_MEMBER_STATUS[s as WelfareMemberStatus] ?? WELFARE_MEMBER_STATUS.invited;
const unpaidOf = (d: WelfareGroupDetail, memberId: string) => d.contributions.filter((c) => c.member_id === memberId && (c.status === "due" || c.status === "failed"));
const sum = (rows: WelfareContribution[]) => Math.round(rows.reduce((s, c) => s + Number(c.amount), 0) * 100) / 100;

async function Body({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: TabKey = (TABS.find((t) => t.key === tabRaw)?.key ?? "overview") as TabKey;
  const { user, supabase } = await account(`/account/groups/${id}`);
  let d: WelfareGroupDetail;
  try {
    d = await welfareGroupDetail({ supabase, userId: user.id }, id);
  } catch (err) {
    if (err instanceof BusinessRuleError) notFound();
    throw err;
  }
  const { group } = d;
  const meta = groupMeta(group.status);
  const mySponsorship = d.sponsors.find((s) => s.sponsor_user_id === user.id && s.status === "active") ?? null;
  const displayCurrency = mySponsorship?.display_currency && mySponsorship.display_currency !== "GHS" ? mySponsorship.display_currency : null;
  const openClaims = d.claims.filter((c) => !["paid", "closed", "withdrawn", "rejected"].includes(c.status)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${welfareKindLabel(group.kind)} · ${group.reference}`}
        title={group.name}
        description={meta.hint}
        actions={
          <>
            <Pill tone={meta.tone}>{meta.label}</Pill>
            {(d.isAdmin || d.me) && group.policy_id && group.status !== "cancelled" && (
              <Link href={`/account/groups/${group.id}/claims/new`} className={buttonClass("outline", "sm")}><Camera aria-hidden className="size-4" /> Raise a claim</Link>
            )}
          </>
        }
      />
      <Tabs
        active={tab}
        items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/account/groups/${group.id}?tab=${t.key}`, count: t.key === "members" ? d.members.filter((m) => m.status !== "left").length : t.key === "claims" ? openClaims : t.key === "contributions" && d.summary.inArrears ? d.summary.inArrears : undefined }))}
      />
      {tab === "overview" && <Overview d={d} userId={user.id} displayCurrency={displayCurrency} />}
      {tab === "members" && <Members d={d} userId={user.id} />}
      {tab === "contributions" && <Contributions d={d} userId={user.id} displayCurrency={displayCurrency} />}
      {tab === "claims" && <Claims d={d} />}
      <Notice tone="neutral">{welfareDisclaimer(d.insurer?.name, d.broker?.name)}</Notice>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
async function Overview({ d, userId, displayCurrency }: { d: WelfareGroupDetail; userId: string; displayCurrency: string | null }) {
  const { group, summary } = d;
  const openRequest = d.request && !["completed", "cancelled", "closed_no_cover"].includes(d.request.status);
  const myUnpaid = d.me ? unpaidOf(d, d.me.id) : [];
  return (
    <div className="space-y-6">
      {d.isAdmin && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Active members" value={summary.members} hint={`${d.members.filter((m) => m.status === "invited" || m.status === "pending").length} waiting`} />
          <StatCard label="Paid up" value={summary.paidUp} hint={summary.dueSoon ? `${summary.dueSoon} due soon` : undefined} />
          <StatCard label="In arrears" value={summary.inArrears} tone={summary.inArrears ? "warn" : "default"} hint={summary.arrears ? `${formatGHS(summary.arrears, { decimals: true })} overdue` : undefined} />
          <StatCard label="Collected this month" value={formatGHS(summary.collectedThisPeriod, { decimals: true })} hint={summary.upcoming.count ? `${summary.upcoming.count} due in 14 days` : undefined} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {d.me && !d.isAdmin && (
            <Card className="p-5">
              <h2 className="text-lg font-semibold text-ink">Your membership</h2>
              <DefinitionList
                className="mt-3"
                items={[
                  { label: "Status", value: <Pill tone={memberMeta(d.me.status).tone}>{memberMeta(d.me.status).label}</Pill> },
                  { label: "Contributions", value: d.standings[d.me.id] ? <Pill tone={d.standings[d.me.id]!.tone}>{d.standings[d.me.id]!.label}</Pill> : "—" },
                  { label: "Plan", value: contributionPlanLabel({ amount: Number(group.contribution_amount), cadence: group.contribution_cadence }) },
                  { label: "Joined", value: formatDate(d.me.joined_at) },
                ]}
              />
              {myUnpaid.length > 0 && group.policy_id && (
                <div className="mt-4 rounded-xl bg-mist p-4">
                  <p className="text-sm font-semibold text-ink">You owe {formatGHS(sum(myUnpaid), { decimals: true })} ({myUnpaid.length} contribution{myUnpaid.length === 1 ? "" : "s"})</p>
                  <MomoPayForm className="mt-2" compact label="Pay now" action={payContributionsAction.bind(null, { contributionIds: myUnpaid.map((c) => c.id), groupId: group.id, displayCurrency: null })} />
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/account/groups/${group.id}?tab=members`} className={buttonClass("secondary", "sm")}>My beneficiaries & sponsors</Link>
                <ActionForm action={leaveGroupAction} submitLabel="Leave the group" variant="ghost" confirm="Leave this group? Your cover under the group policy ends per the insurer's rules.">
                  <input type="hidden" name="memberId" value={d.me.id} />
                </ActionForm>
              </div>
            </Card>
          )}

          {d.roles.includes("sponsor") && <SponsoredMembers d={d} userId={userId} displayCurrency={displayCurrency} />}

          <Card className="p-5">
            <h2 className="text-lg font-semibold text-ink">Cover</h2>
            <DefinitionList
              className="mt-3"
              items={[
                { label: "Broker of record", value: d.broker ? `${d.broker.name}${d.broker.nic_licence_number ? ` · NIC ${d.broker.nic_licence_number}` : ""}` : "Assigned when a licensed broker accepts the group's request" },
                { label: "Insurer", value: d.insurer?.name ?? "Chosen when the admin accepts a quote" },
                { label: "Master policy", value: d.policy ? `${d.policy.policy_number ?? d.policy.internal_reference} · ${humanize(d.policy.status)}` : "—" },
                { label: "Cover period", value: d.policy?.cover_start ? `${formatDate(d.policy.cover_start)} – ${formatDate(d.policy.cover_end)}` : "—" },
                { label: "Group premium", value: d.policy?.premium != null ? `${formatGHS(Number(d.policy.premium), { decimals: true })} per ${d.policy.billing_period ?? "year"}` : "—" },
                { label: "Contribution plan", value: `${contributionPlanLabel({ amount: Number(group.contribution_amount), cadence: group.contribution_cadence })}, due on day ${group.contribution_day}` },
                { label: "Renewal", value: group.renewal_date ? formatDate(group.renewal_date) : "—" },
              ]}
            />
            {d.request && (
              <p className="mt-3 text-sm">
                Request <Link href={`/account/requests/${d.request.id}`} className="font-semibold text-brand hover:underline">{d.request.reference}</Link> · {humanize(d.request.status)}
                {d.request.next_step ? <span className="block text-muted">{d.request.next_step}</span> : null}
              </p>
            )}
            {group.rules && <p className="mt-3 whitespace-pre-line text-sm text-ink-2"><span className="font-semibold">Group rules: </span>{group.rules}</p>}
          </Card>

          {d.isAdmin && !openRequest && group.status !== "cancelled" && (
            <Card className="p-5">
              <h2 className="mb-1 text-lg font-semibold text-ink">{group.policy_id ? "Renewal quotes" : "Ask a licensed broker for quotes"}</h2>
              <p className="mb-3 text-sm text-muted">We send the group’s size and age profile (never names, phones or Ghana Card numbers) to a licensed broker, who approaches insurers for you. You accept a quote under Requests; the insurer then issues one master policy for the group.</p>
              {summary.members < 2 ? (
                <Notice tone="wait">Enrol at least two active members first.</Notice>
              ) : (
                <ActionForm action={requestCoverAction} submitLabel={`Request quotes for ${summary.members} members`}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <Field label="Notes for the broker (optional)" htmlFor="rq-notes"><Textarea id="rq-notes" name="notes" rows={2} maxLength={1000} placeholder="Benefits you want (funeral grant, hospital cash), budget per member, current insurer…" /></Field>
                </ActionForm>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {d.isAdmin && d.joinUrl && (
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-mist text-brand"><Link2 aria-hidden className="size-5" /></span>
                <div>
                  <p className="font-semibold text-ink">Invitation link</p>
                  <p className="text-xs text-muted">Share on WhatsApp or at a meeting. Members join with their own consent; you approve anyone you did not add yourself.</p>
                </div>
              </div>
              <Input readOnly value={d.joinUrl} className="mt-3 text-xs" aria-label="Invitation link" />
            </Card>
          )}
          {d.isAdmin && (
            <Card className="p-5">
              <h2 className="text-lg font-semibold text-ink">Plan and settings</h2>
              <ActionForm action={updatePlanAction} submitLabel="Save" className="mt-3">
                <input type="hidden" name="groupId" value={group.id} />
                <Field label="Group name" htmlFor="pl-name"><Input id="pl-name" name="name" defaultValue={group.name} required minLength={2} maxLength={160} /></Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Per member (GH₵)" htmlFor="pl-amount"><Input id="pl-amount" name="contribution_amount" inputMode="decimal" defaultValue={Number(group.contribution_amount).toFixed(2)} required /></Field>
                  <Field label="How often" htmlFor="pl-cadence">
                    <Select id="pl-cadence" name="cadence" defaultValue={group.contribution_cadence}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Every 3 months</option>
                      <option value="annual">Yearly</option>
                    </Select>
                  </Field>
                  <Field label="Due on day" htmlFor="pl-day"><Input id="pl-day" name="contribution_day" type="number" min={1} max={28} defaultValue={group.contribution_day} required /></Field>
                </div>
                <Field label="About the group" htmlFor="pl-desc"><Textarea id="pl-desc" name="description" rows={2} maxLength={2000} defaultValue={group.description ?? ""} /></Field>
                <Field label="Group rules shown to members" htmlFor="pl-rules" hint="Benefits, waiting periods, what happens in arrears — in plain language."><Textarea id="pl-rules" name="rules" rows={3} maxLength={4000} defaultValue={group.rules ?? ""} /></Field>
                <Checkbox name="invite_enabled" defaultChecked={group.invite_enabled} label="Invitation link is open" />
              </ActionForm>
              {group.status !== "cancelled" && (
                <ActionForm action={cancelGroupAction} submitLabel="Close this group" variant="ghost" className="mt-3" confirm="Close the group? Members keep any cover the insurer has issued until it ends; no new contributions are collected.">
                  <input type="hidden" name="groupId" value={group.id} />
                </ActionForm>
              )}
            </Card>
          )}
          {d.roles.includes("partner") && !d.isAdmin && (
            <Notice tone="info" title="Partner view">You see this group as its {d.broker && d.roles.includes("partner") ? "broker of record / insurer" : "insurer"}. Member details are shared for placement and claims only.</Notice>
          )}
        </div>
      </div>
    </div>
  );
}

async function SponsoredMembers({ d, userId, displayCurrency }: { d: WelfareGroupDetail; userId: string; displayCurrency: string | null }) {
  const mine = d.sponsors.filter((s) => s.sponsor_user_id === userId && s.status === "active");
  const members = mine.map((s) => d.members.find((m) => m.id === s.member_id)).filter((m): m is WelfareMember => !!m);
  const allUnpaid = members.flatMap((m) => unpaidOf(d, m.id));
  const fx = displayCurrency && allUnpaid.length ? await quoteFx(sum(allUnpaid), displayCurrency) : null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-ink">Members you pay for</h2>
      <ul className="mt-3 divide-y divide-line">
        {members.map((m) => {
          const unpaid = unpaidOf(d, m.id);
          const st = d.standings[m.id];
          return (
            <li key={m.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{m.full_name}</p>
                  <p className="text-xs text-muted">{memberMeta(m.status).label}{unpaid.length ? ` · ${formatGHS(sum(unpaid), { decimals: true })} outstanding` : " · nothing outstanding"}</p>
                </div>
                {st && <Pill tone={st.tone}>{st.label}</Pill>}
              </div>
            </li>
          );
        })}
      </ul>
      {allUnpaid.length > 0 && d.group.policy_id ? (
        <div className="mt-3 rounded-xl bg-mist p-4">
          <p className="text-sm font-semibold text-ink">
            Pay {formatGHS(sum(allUnpaid), { decimals: true })} for {members.length === 1 ? members[0]!.full_name : `${members.length} members`}
            {fx && fx.displayCurrency !== "GHS" ? <span className="font-normal text-muted"> (≈ {formatMoney(fx.displayAmount, fx.displayCurrency)})</span> : null}
          </p>
          {fx && fx.displayCurrency !== "GHS" && <p className="mt-1 text-xs text-muted">{fx.disclosure}</p>}
          <MomoPayForm className="mt-2" compact allowCard label="Pay now" action={payContributionsAction.bind(null, { contributionIds: allUnpaid.map((c) => c.id), groupId: d.group.id, displayCurrency })} />
          <p className="mt-2 text-xs text-muted">Paying by card from abroad? Choose “Saved card” or pay once by card and keep it for next time. The amount settles in cedis to the insurer.</p>
        </div>
      ) : allUnpaid.length > 0 ? (
        <Notice tone="wait" className="mt-3">Contributions can be paid once the broker has placed the group’s cover with an insurer. Covva never collects money into its own account.</Notice>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
function Members({ d, userId }: { d: WelfareGroupDetail; userId: string }) {
  const { group } = d;
  const visible = d.members.filter((m) => m.status !== "left" || d.isAdmin);
  const canEditMember = (m: WelfareMember) => d.isAdmin || m.user_id === userId;
  return (
    <div className="space-y-6">
      {d.isAdmin && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Plus aria-hidden className="size-4 text-brand" /> Add a member</h2>
            <ActionForm action={addMemberAction} submitLabel="Add member" resetOnSuccess className="mt-3">
              <input type="hidden" name="groupId" value={group.id} />
              <Field label="Full name" htmlFor="am-name"><Input id="am-name" name="full_name" required minLength={2} maxLength={160} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone" htmlFor="am-phone" hint="They link their account by signing in with it."><Input id="am-phone" name="phone" type="tel" inputMode="tel" placeholder="024 123 4567" /></Field>
                <Field label="Date of birth" htmlFor="am-dob"><Input id="am-dob" name="date_of_birth" type="date" /></Field>
                <Field label="Gender" htmlFor="am-gender">
                  <Select id="am-gender" name="gender" defaultValue=""><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select>
                </Field>
                <Field label="Ghana Card (last 4 kept)" htmlFor="am-card"><Input id="am-card" name="ghana_card" placeholder="GHA-123456789-0" /></Field>
              </div>
              <details className="rounded-xl border border-line p-3 text-sm">
                <summary className="cursor-pointer font-medium text-ink">Beneficiary (optional)</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Name" htmlFor="am-bname"><Input id="am-bname" name="beneficiary_name" /></Field>
                  <Field label="Relationship" htmlFor="am-brel">
                    <Select id="am-brel" name="beneficiary_relationship" defaultValue=""><option value="">—</option>{WELFARE_RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
                  </Field>
                  <Field label="Phone" htmlFor="am-bphone"><Input id="am-bphone" name="beneficiary_phone" type="tel" inputMode="tel" /></Field>
                </div>
              </details>
              <Checkbox name="consent_attested" label="This member has agreed (on paper or at a meeting) to be enrolled and to their details being shared with the broker and insurer — enrol them as active now. Otherwise they are invited and confirm themselves." />
            </ActionForm>
          </Card>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><ClipboardList aria-hidden className="size-4 text-brand" /> Upload a member list (CSV)</h2>
            <p className="mt-1 text-xs text-muted">Columns: {welfareMemberCsvTemplate.split("\n")[0]!.replace(/,/g, ", ")}. Phone numbers must be Ghana numbers; only the last 4 digits of a Ghana Card are kept.</p>
            <ActionForm action={importMembersAction} submitLabel="Import members" className="mt-3">
              <input type="hidden" name="groupId" value={group.id} />
              <Field label="CSV file" htmlFor="im-file"><Input id="im-file" name="file" type="file" accept=".csv,text/csv" /></Field>
              <Field label="…or paste rows" htmlFor="im-csv"><Textarea id="im-csv" name="csv" rows={4} placeholder={welfareMemberCsvTemplate} className="font-mono text-xs" /></Field>
              <Checkbox name="consent_attested" label="These members have agreed to be enrolled — add them as active." />
            </ActionForm>
          </Card>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title="No members yet" body="Add members above or share the invitation link from the overview." />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Member</Th>
              <Th>Status</Th>
              <Th>Contributions</Th>
              <Th>Beneficiaries</Th>
              {(d.isAdmin || d.roles.includes("partner")) && <Th>Actions</Th>}
            </tr>
          </THead>
          <tbody>
            {visible.map((m) => {
              const st = d.standings[m.id];
              const bens = d.beneficiaries.filter((b) => b.member_id === m.id);
              const sponsors = d.sponsors.filter((s) => s.member_id === m.id);
              const mm = memberMeta(m.status);
              return (
                <tr key={m.id} className="align-top">
                  <Td>
                    <p className="font-medium text-ink">{m.full_name}{m.role === "admin" ? <span className="ml-1 text-xs text-brand">admin</span> : null}{m.user_id === userId ? <span className="ml-1 text-xs text-muted">(you)</span> : null}</p>
                    <p className="text-xs text-muted">{m.phone ? formatGhanaPhone(m.phone) : "no phone"}{m.date_of_birth ? ` · born ${formatDate(m.date_of_birth)}` : ""}{m.user_id ? " · has account" : ""}</p>
                    {sponsors.length > 0 && <p className="text-xs text-muted">Sponsor: {sponsors.map((s) => `${s.sponsor_name ?? s.sponsor_email ?? "invited"} (${s.status})`).join(", ")}</p>}
                  </Td>
                  <Td><Pill tone={mm.tone}>{mm.label}</Pill>{m.consent_at ? <p className="mt-1 text-[11px] text-muted">consented {formatDate(m.consent_at)}</p> : m.consent_attested_by ? <p className="mt-1 text-[11px] text-muted">consent attested by admin</p> : null}</Td>
                  <Td>{st ? <><Pill tone={st.tone}>{st.label}</Pill>{st.arrears > 0 && <p className="mt-1 text-xs text-danger">{formatGHS(st.arrears, { decimals: true })} overdue</p>}</> : "—"}</Td>
                  <Td>
                    {bens.length === 0 ? <span className="text-xs text-muted">none recorded</span> : (
                      <ul className="space-y-1 text-xs text-ink-2">
                        {bens.map((b) => (
                          <li key={b.id} className="flex items-center gap-2">
                            <span>{b.full_name} · {humanize(b.relationship)}{Number(b.share_pct) < 100 ? ` · ${Number(b.share_pct)}%` : ""}</span>
                            {canEditMember(m) && (
                              <ActionForm action={removeBeneficiaryAction} submitLabel="remove" variant="ghost" inline confirm={`Remove ${b.full_name} as a beneficiary?`}>
                                <input type="hidden" name="beneficiaryId" value={b.id} />
                                <input type="hidden" name="groupId" value={group.id} />
                              </ActionForm>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {canEditMember(m) && m.status !== "left" && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer font-medium text-brand">Add beneficiary</summary>
                        <ActionForm action={addBeneficiaryAction} submitLabel="Save" resetOnSuccess className="mt-2">
                          <input type="hidden" name="memberId" value={m.id} />
                          <input type="hidden" name="groupId" value={group.id} />
                          <Field label="Full name" htmlFor={`b-${m.id}-n`}><Input id={`b-${m.id}-n`} name="full_name" required minLength={2} /></Field>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="Relationship" htmlFor={`b-${m.id}-r`}><Select id={`b-${m.id}-r`} name="relationship" defaultValue="spouse">{WELFARE_RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
                            <Field label="Phone" htmlFor={`b-${m.id}-p`}><Input id={`b-${m.id}-p`} name="phone" type="tel" inputMode="tel" /></Field>
                          </div>
                        </ActionForm>
                      </details>
                    )}
                    {canEditMember(m) && m.status !== "left" && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer font-medium text-brand">Invite a sponsor abroad</summary>
                        <ActionForm action={inviteSponsorAction} submitLabel="Create invitation" className="mt-2">
                          <input type="hidden" name="memberId" value={m.id} />
                          <input type="hidden" name="groupId" value={group.id} />
                          <Field label="Sponsor's name" htmlFor={`s-${m.id}-n`}><Input id={`s-${m.id}-n`} name="name" /></Field>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="E-mail" htmlFor={`s-${m.id}-e`}><Input id={`s-${m.id}-e`} name="email" type="email" /></Field>
                            <Field label="Currency" htmlFor={`s-${m.id}-c`}><Select id={`s-${m.id}-c`} name="currency" defaultValue="GBP"><option>GBP</option><option>USD</option><option>EUR</option><option>CAD</option><option>GHS</option></Select></Field>
                          </div>
                        </ActionForm>
                      </details>
                    )}
                  </Td>
                  {(d.isAdmin || d.roles.includes("partner")) && (
                    <Td>
                      {d.isAdmin && m.status !== "left" && (
                        <div className="flex flex-col gap-1">
                          {(m.status === "invited" || m.status === "pending" || m.status === "suspended") && (
                            <ActionForm action={changeMemberAction} submitLabel={m.status === "pending" ? "Approve" : "Activate"} size="sm" inline confirm={m.user_id ? undefined : `Confirm ${m.full_name} agreed to be enrolled?`}>
                              <input type="hidden" name="memberId" value={m.id} /><input type="hidden" name="groupId" value={group.id} /><input type="hidden" name="change" value="activate" />
                            </ActionForm>
                          )}
                          {m.status === "active" && m.user_id !== userId && (
                            <ActionForm action={changeMemberAction} submitLabel="Suspend" variant="outline" size="sm" inline>
                              <input type="hidden" name="memberId" value={m.id} /><input type="hidden" name="groupId" value={group.id} /><input type="hidden" name="change" value="suspend" />
                            </ActionForm>
                          )}
                          {st && st.state === "arrears" && (
                            <ActionForm action={remindMemberAction} submitLabel="Remind" variant="outline" size="sm" inline>
                              <input type="hidden" name="memberId" value={m.id} />
                            </ActionForm>
                          )}
                          {m.user_id && m.user_id !== userId && m.status === "active" && (
                            <ActionForm action={changeMemberAction} submitLabel={m.role === "admin" ? "Remove admin" : "Make admin"} variant="ghost" size="sm" inline>
                              <input type="hidden" name="memberId" value={m.id} /><input type="hidden" name="groupId" value={group.id} /><input type="hidden" name="change" value={m.role === "admin" ? "make_member" : "make_admin"} />
                            </ActionForm>
                          )}
                          {m.user_id !== userId && (
                            <ActionForm action={changeMemberAction} submitLabel="Remove" variant="ghost" size="sm" inline confirm={`Remove ${m.full_name} from the group?`}>
                              <input type="hidden" name="memberId" value={m.id} /><input type="hidden" name="groupId" value={group.id} /><input type="hidden" name="change" value="remove" />
                            </ActionForm>
                          )}
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------
async function Contributions({ d, userId, displayCurrency }: { d: WelfareGroupDetail; userId: string; displayCurrency: string | null }) {
  const { group } = d;
  const byMember = new Map(d.members.map((m) => [m.id, m]));
  const unpaid = d.contributions.filter((c) => c.status === "due" || c.status === "failed").sort((a, b) => a.due_at.localeCompare(b.due_at));
  const paid = d.contributions.filter((c) => c.status === "paid").sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? "")).slice(0, 50);
  const canPayFor = (memberId: string) => d.isAdmin || byMember.get(memberId)?.user_id === userId || d.sponsors.some((s) => s.member_id === memberId && s.sponsor_user_id === userId && s.status === "active");
  const payable = unpaid.filter((c) => canPayFor(c.member_id));
  const payers = await Promise.all([...new Set(paid.map((c) => c.paid_by_user_id).filter((x): x is string => !!x))].map(async (id) => [id, id === userId ? "you" : d.members.find((m) => m.user_id === id)?.full_name ?? d.sponsors.find((s) => s.sponsor_user_id === id)?.sponsor_name ?? "a sponsor"] as const));
  const payerName = new Map(payers);
  const fx = displayCurrency && payable.length ? await quoteFx(sum(payable), displayCurrency) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Outstanding" value={formatGHS(sum(unpaid), { decimals: true })} hint={`${unpaid.length} contribution${unpaid.length === 1 ? "" : "s"}`} tone={d.summary.arrears ? "warn" : "default"} />
        <StatCard label="Overdue" value={formatGHS(d.summary.arrears, { decimals: true })} hint={`${d.summary.inArrears} member${d.summary.inArrears === 1 ? "" : "s"}`} tone={d.summary.arrears ? "warn" : "default"} />
        <StatCard label="Due in 14 days" value={formatGHS(d.summary.upcoming.amount, { decimals: true })} hint={d.summary.upcoming.dueBy ? `by ${formatDate(d.summary.upcoming.dueBy)}` : undefined} />
        <StatCard label="Collected this month" value={formatGHS(d.summary.collectedThisPeriod, { decimals: true })} />
      </div>

      {d.isAdmin && group.status !== "cancelled" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Schedule</h2>
              <p className="text-sm text-muted">{contributionPlanLabel({ amount: Number(group.contribution_amount), cadence: group.contribution_cadence })}, due on day {group.contribution_day}. Reminders go out 3 days before and 3 days after the due date by app, SMS, WhatsApp or e-mail.</p>
            </div>
            <ActionForm action={generateContributionsAction} submitLabel="Add this period's contributions" variant="secondary" inline>
              <input type="hidden" name="groupId" value={group.id} />
              <Checkbox name="ahead" label="also the next 3 months" />
            </ActionForm>
          </div>
        </Card>
      )}

      {!group.policy_id && unpaid.length > 0 && (
        <Notice tone="wait" title="Not collectable yet">Contributions can be paid through Covva once a licensed broker has placed the group’s cover with an insurer; they then settle straight to that insurer. Covva never collects money into its own account.</Notice>
      )}

      {payable.length > 0 && group.policy_id && (
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-ink">{d.isAdmin ? "Pay what is owed" : "Pay now"}</h2>
          <p className="text-sm text-muted">
            {formatGHS(sum(payable), { decimals: true })} for {[...new Set(payable.map((c) => byMember.get(c.member_id)?.full_name ?? "member"))].slice(0, 4).join(", ")}
            {fx && fx.displayCurrency !== "GHS" ? ` (≈ ${formatMoney(fx.displayAmount, fx.displayCurrency)})` : ""}. Oldest contributions are settled first; the payment goes to {d.insurer?.name ?? "the insurer"}.
          </p>
          {fx && fx.displayCurrency !== "GHS" && <p className="mt-1 text-xs text-muted">{fx.disclosure}</p>}
          <MomoPayForm className="mt-3" compact allowCard label={`Pay ${formatGHS(sum(payable), { decimals: true })}`} action={payContributionsAction.bind(null, { contributionIds: payable.map((c) => c.id), groupId: group.id, displayCurrency })} />
        </Card>
      )}

      <section aria-labelledby="unpaid-h">
        <h2 id="unpaid-h" className="mb-3 text-lg font-semibold text-ink">Outstanding</h2>
        {unpaid.length === 0 ? <p className="text-sm text-muted">Nothing outstanding.</p> : (
          <Table>
            <THead><tr><Th>Member</Th><Th>Period</Th><Th>Due</Th><Th>Amount</Th><Th>Status</Th>{d.isAdmin && <Th>Actions</Th>}</tr></THead>
            <tbody>
              {unpaid.slice(0, 200).map((c) => {
                const m = byMember.get(c.member_id);
                const overdue = c.due_at < new Date().toISOString().slice(0, 10);
                const cs = contributionStatusMeta(c.status);
                return (
                  <tr key={c.id}>
                    <Td>{m?.full_name ?? "Member"}</Td>
                    <Td>{formatDate(c.period_start)}</Td>
                    <Td className={overdue ? "text-danger" : ""}>{formatDate(c.due_at)}</Td>
                    <Td>{formatGHS(Number(c.amount), { decimals: true })}</Td>
                    <Td><Pill tone={overdue ? "danger" : cs.tone}>{overdue ? "Overdue" : cs.label}</Pill></Td>
                    {d.isAdmin && (
                      <Td>
                        <ActionForm action={waiveContributionAction} submitLabel="Waive" variant="ghost" size="sm" inline confirm={`Waive ${formatGHS(Number(c.amount), { decimals: true })} for ${m?.full_name ?? "this member"}? The insurer's cover rules still apply.`}>
                          <input type="hidden" name="contributionId" value={c.id} /><input type="hidden" name="groupId" value={group.id} />
                        </ActionForm>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="paid-h">
        <h2 id="paid-h" className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink"><Wallet aria-hidden className="size-4 text-brand" /> Paid — who paid for whom</h2>
        {paid.length === 0 ? <p className="text-sm text-muted">No contributions paid yet.</p> : (
          <Table>
            <THead><tr><Th>Member</Th><Th>Period</Th><Th>Paid</Th><Th>Amount</Th><Th>Paid by</Th></tr></THead>
            <tbody>
              {paid.map((c) => {
                const m = byMember.get(c.member_id);
                return (
                  <tr key={c.id}>
                    <Td>{m?.full_name ?? "Member"}</Td>
                    <Td>{formatDate(c.period_start)}</Td>
                    <Td>{c.paid_at ? formatDate(c.paid_at) : "—"}</Td>
                    <Td>{formatGHS(Number(c.amount), { decimals: true })}{c.display_currency && c.display_currency !== "GHS" && c.display_amount != null ? <span className="block text-[11px] text-muted">≈ {formatMoney(Number(c.display_amount), c.display_currency)}</span> : null}</Td>
                    <Td>{c.paid_by_user_id ? `${payerName.get(c.paid_by_user_id) ?? "—"}${c.paid_via === "sponsor" ? " (sponsor abroad)" : c.paid_via === "admin" ? " (admin)" : ""}` : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
function Claims({ d }: { d: WelfareGroupDetail }) {
  const byMember = new Map(d.members.map((m) => [m.id, m]));
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Claims support</h2>
            <p className="text-sm text-muted">A death or welfare claim is reported on the group’s master policy with the documents the insurer needs. The broker checks and delivers it; only {d.insurer?.name ?? "the insurer"} decides.</p>
          </div>
          {d.group.policy_id && d.group.status !== "cancelled" ? (
            <Link href={`/account/groups/${d.group.id}/claims/new`} className={buttonClass("primary", "sm")}><Camera aria-hidden className="size-4" /> Raise a claim</Link>
          ) : (
            <Pill tone="neutral">No policy in force yet</Pill>
          )}
        </div>
      </Card>
      {d.claims.length === 0 ? (
        <EmptyState icon={<BellRing className="size-5" />} title="No claims" body="Claims raised by the admin, a member or a recorded beneficiary appear here with their status." />
      ) : (
        <Table>
          <THead><tr><Th>Reference</Th><Th>Member</Th><Th>What</Th><Th>Status</Th><Th>Reported</Th></tr></THead>
          <tbody>
            {d.claims.map((c) => {
              const cs = CLAIM_STATUS[c.status as ClaimStatus] ?? { label: humanize(c.status), tone: "neutral" as const };
              return (
                <tr key={c.id}>
                  <Td><Link href={`/account/claims/${c.id}`} className="font-semibold text-brand hover:underline">{c.reference}</Link></Td>
                  <Td>{c.welfare_member_id ? byMember.get(c.welfare_member_id)?.full_name ?? "Member" : "—"}</Td>
                  <Td>{humanize(c.incident_type)}</Td>
                  <Td><Pill tone={cs.tone}>{cs.label}</Pill></Td>
                  <Td>{formatDate(c.created_at)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
