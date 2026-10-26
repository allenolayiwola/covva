import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Avatar, Checkbox, DemoBadge, Notice, PageHeader, Pill, Table, THead, Th, Td, Tabs, Textarea, Field, Input, Select } from "@im/ui";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can, ROLE_LABEL, type StaffRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, isUuid, orgMap, personName, profileMap, sp, type SearchParams, type Supabase } from "@/lib/query";
import { formatDate, formatDateTime, formatGHS } from "@/lib/format";
import { DUE_DILIGENCE, NIC_VERIFY_URL, ROLES_BY_ORG_TYPE, STATUS_TONE } from "@/lib/org-meta";
import { Breadcrumb, KeyValues, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction, ToggleForm } from "@/components/ui/forms";
import { AuditTable } from "@/components/AuditTable";
import { OrgFields } from "../OrgForm";
import {
  addMember, changeMemberRole, saveDueDiligence, setDemoFlag, setMemberActive, setOrganisationStatus, updateOrganisation, verifyLicence,
} from "../actions";
import { toggleAppointment } from "../../appointments/actions";
import { toggleRoutingRule } from "../../routing/actions";
import { saveSubscription } from "../../subscriptions/actions";

const TABS = ["profile", "members", "appointments", "routing", "subscription", "diligence", "activity"] as const;
type Tab = (typeof TABS)[number];

export default function OrganisationPage({ params, searchParams }: PageProps<"/organisations/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading organisation…" />}>
      <OrgDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function OrgDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sparams = await searchParams;
  const tabParam = sp(sparams, "tab") as Tab | undefined;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "profile";
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("*").eq("id", id).maybeSingle();
  if (!org) notFound();

  const settings = (org.settings as Record<string, unknown> | null) ?? {};
  const demo = settings.demo === true;
  const isPartner = org.type === "broker" || org.type === "insurer";
  const verifiedBy = org.licence_verified_by ? (await profileMap(supabase, [org.licence_verified_by])).get(org.licence_verified_by) : undefined;
  const canNetwork = can(staff.roles, "network");
  const canDD = can(staff.roles, "dueDiligence");

  const tabs = TABS.filter((t) => (t === "diligence" ? isPartner : t === "routing" ? org.type === "broker" : t === "appointments" ? isPartner : true)).map((t) => ({
    key: t,
    label: { profile: "Profile", members: "Members", appointments: "Appointments", routing: "Routing", subscription: "Subscription", diligence: "Due diligence", activity: "Activity" }[t],
    href: `/organisations/${id}${t === "profile" ? "" : `?tab=${t}`}`,
  }));

  return (
    <>
      <Breadcrumb items={[{ label: "Organisations", href: "/organisations" }, { label: org.name }]} />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {org.brand_color && <span className="size-4 rounded-full" style={{ background: org.brand_color }} aria-hidden />}
            {org.name}
            <Pill tone={STATUS_TONE[org.status]}>{org.status}</Pill>
            {demo && <DemoBadge text="Demo organisation" />}
          </span>
        }
        description={`${org.type[0]!.toUpperCase()}${org.type.slice(1)} · ${org.legal_name ?? "Legal name not recorded"}${org.region ? ` · ${org.region}` : ""}`}
        actions={
          org.type !== "platform" ? (
            <>
              {(["active", "suspended", "offboarded", "pending"] as Enum<"org_status">[])
                .filter((s) => s !== org.status)
                .map((s) => (
                  <ConfirmAction
                    key={s}
                    action={setOrganisationStatus}
                    fields={{ orgId: org.id, status: s }}
                    label={{ active: "Activate", suspended: "Suspend", offboarded: "Offboard", pending: "Return to pending" }[s]}
                    title={`${{ active: "Activate", suspended: "Suspend", offboarded: "Offboard", pending: "Return to pending" }[s]} ${org.name}`}
                    variant={s === "active" ? "primary" : "danger"}
                    triggerVariant={s === "active" ? "primary" : "outline"}
                    confirmWord={s === "offboarded" ? "OFFBOARD" : undefined}
                    disabled={!canNetwork}
                    body={
                      s === "active"
                        ? "Partners can be activated only with a verified, in-date NIC licence (and PI cover for brokers)."
                        : s === "suspended"
                          ? "Suspended partners stop receiving new routed requests. Members keep read access to existing work."
                          : s === "offboarded"
                            ? "Offboarded organisations lose access entirely (RLS excludes offboarded orgs). Existing regulated records are kept."
                            : "Move back to onboarding."
                    }
                  />
                ))}
            </>
          ) : null
        }
      />
      <Tabs items={tabs} active={tab} className="mb-6 w-fit max-w-full" />
      {!canNetwork && <ReadOnlyBanner show />}

      {tab === "profile" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel title="Details" className="xl:col-span-2">
            <ActionForm action={updateOrganisation} submitLabel="Save changes" readOnly={!canNetwork}>
              <input type="hidden" name="orgId" value={org.id} />
              <OrgFields org={org} />
            </ActionForm>
          </Panel>
          <div className="space-y-6">
            {org.type !== "enterprise" && org.type !== "platform" && (
              <Panel title="NIC licence verification">
                <KeyValues
                  items={[
                    { label: "Licence", value: org.nic_licence_number ? <span className="font-mono">{org.nic_licence_number}</span> : "Not recorded" },
                    { label: "Class", value: org.nic_licence_class ?? "—" },
                    { label: "Expires", value: formatDate(org.nic_licence_expires_on) },
                    { label: "Verified", value: org.licence_verified_at ? `${formatDateTime(org.licence_verified_at)} by ${personName(verifiedBy, "staff")}` : <Pill tone="wait">Not verified</Pill> },
                  ]}
                />
                <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-muted">
                  <li>
                    Open the{" "}
                    <a href={NIC_VERIFY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                      NIC register <ExternalLink className="size-3" />
                    </a>{" "}
                    and search for the licence number.
                  </li>
                  <li>Check the name, class and expiry match the record above (update them first if not).</li>
                  <li>Mark as verified. The check is recorded against your name.</li>
                </ol>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ConfirmAction
                    action={verifyLicence}
                    fields={{ orgId: org.id, value: org.licence_verified_at ? "false" : "true" }}
                    label={org.licence_verified_at ? "Remove verification" : "Verify licence"}
                    title={org.licence_verified_at ? "Remove licence verification" : "Mark licence verified"}
                    triggerVariant={org.licence_verified_at ? "outline" : "primary"}
                    variant={org.licence_verified_at ? "danger" : "primary"}
                    requireReason={!!org.licence_verified_at}
                    disabled={!canDD}
                    body={org.licence_verified_at ? "Removing verification will block activation until it is verified again." : `I have checked ${org.nic_licence_number ?? "the licence"} on the NIC register and the details match.`}
                  />
                </div>
              </Panel>
            )}
            <Panel title="Settings">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink">Demo organisation</p>
                  <p className="text-xs text-muted">Fictional partner shown with &ldquo;Illustrative only&rdquo; labels.</p>
                </div>
                <ToggleForm action={setDemoFlag} fields={{ orgId: org.id }} checked={demo} label="Demo organisation" disabled={!canNetwork} />
              </div>
              {typeof settings.status_reason === "string" && (
                <p className="mt-4 text-xs text-muted">Last status reason: <span className="text-ink-2">{settings.status_reason}</span></p>
              )}
              <details className="mt-4 text-xs">
                <summary className="cursor-pointer text-brand">Raw settings JSON</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-mist p-3">{JSON.stringify(settings, null, 2)}</pre>
              </details>
            </Panel>
          </div>
        </div>
      )}

      {tab === "members" && <MembersTab supabase={supabase} org={org} canAct={canNetwork} staffRoles={staff.roles} />}
      {tab === "appointments" && <AppointmentsTab supabase={supabase} org={org} canAct={canNetwork} />}
      {tab === "routing" && <RoutingTab supabase={supabase} orgId={org.id} canAct={canNetwork} />}
      {tab === "subscription" && <SubscriptionTab supabase={supabase} org={org} canAct={can(staff.roles, "commercial")} />}
      {tab === "diligence" && isPartner && (
        <Panel title={`${org.type === "broker" ? "Broker" : "Insurer"} due diligence`} description="Partner assessment checklist (strategy doc §15). Stored on the organisation and audited.">
          <ActionForm action={saveDueDiligence} submitLabel="Save checklist" readOnly={!canDD}>
            <input type="hidden" name="orgId" value={org.id} />
            {(() => {
              const dd = (settings.due_diligence as Record<string, unknown> | undefined) ?? {};
              const items = DUE_DILIGENCE[org.type as "broker" | "insurer"];
              const doneCount = items.filter((i) => dd[i.key] === true).length;
              return (
                <>
                  <p className="text-sm text-muted">
                    {doneCount} of {items.length} complete
                    {typeof dd.reviewed_at === "string" ? ` · last reviewed ${formatDateTime(dd.reviewed_at)}` : ""}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {items.map((i) => (
                      <Checkbox key={i.key} name={`dd_${i.key}`} defaultChecked={dd[i.key] === true} label={i.label} className="rounded-xl border border-line p-3" />
                    ))}
                  </div>
                  <Field label="Notes" htmlFor="dd-notes">
                    <Textarea id="dd-notes" name="notes" defaultValue={typeof dd.notes === "string" ? dd.notes : ""} className="min-h-24" />
                  </Field>
                </>
              );
            })()}
          </ActionForm>
        </Panel>
      )}
      {tab === "activity" && (
        <ActivityTab supabase={supabase} orgId={org.id} />
      )}
    </>
  );
}

type OrgRow = { id: string; type: Enum<"org_type">; name: string };

async function MembersTab({ supabase, org, canAct, staffRoles }: { supabase: Supabase; org: OrgRow; canAct: boolean; staffRoles: StaffRole[] }) {
  const { data: members } = await supabase.from("memberships").select("*").eq("org_id", org.id).order("active", { ascending: false }).order("created_at");
  const people = await profileMap(supabase, (members ?? []).map((m) => m.user_id));
  const roles = ROLES_BY_ORG_TYPE[org.type];
  const platformLocked = org.type === "platform" && !staffRoles.includes("platform_admin");
  const sel = "h-9 rounded-[10px] border border-line bg-white px-2 text-sm";

  return (
    <div className="space-y-6">
      {platformLocked && <Notice tone="info">Only platform admins can change platform staff memberships.</Notice>}
      <Table>
        <THead><tr><Th>Person</Th><Th>Role</Th><Th>Team / title</Th><Th>Status</Th><Th>Since</Th><Th /></tr></THead>
        <tbody>
          {(members ?? []).map((m) => {
            const p = people.get(m.user_id);
            return (
              <tr key={m.id}>
                <Td>
                  <Link href={`/users/${m.user_id}`} className="flex items-center gap-2.5 hover:text-brand">
                    <Avatar name={personName(p)} size={30} />
                    <span><span className="block font-medium text-ink">{personName(p)}</span><span className="block text-xs text-muted">{p?.email ?? ""}</span></span>
                  </Link>
                </Td>
                <Td>
                  <ActionForm action={changeMemberRole} inline submitLabel="Change" submitVariant="ghost" readOnly={!canAct || platformLocked}>
                    <input type="hidden" name="membershipId" value={m.id} />
                    <select name="role" defaultValue={m.role} className={sel} aria-label="Role">
                      {roles.map((r) => <option key={r} value={r}>{(ROLE_LABEL as Record<string, string>)[r] ?? r.replace("_", " ")}</option>)}
                    </select>
                  </ActionForm>
                </Td>
                <Td className="text-xs">{[m.team, m.title].filter(Boolean).join(" · ") || "—"}{m.is_supervisor && <Pill tone="info" className="ml-1">Supervisor</Pill>}</Td>
                <Td>{m.active ? <Pill tone="ok">Active</Pill> : <Pill tone="neutral">Deactivated</Pill>}</Td>
                <Td className="text-muted">{formatDate(m.created_at)}</Td>
                <Td className="text-right">
                  {m.active ? (
                    <ConfirmAction
                      action={setMemberActive}
                      fields={{ membershipId: m.id, value: "false" }}
                      label="Deactivate"
                      title={`Deactivate ${personName(p)}`}
                      confirmLabel="Deactivate"
                      disabled={!canAct || platformLocked}
                      body="They lose access to this organisation's data immediately. The membership is kept for the audit trail."
                    />
                  ) : (
                    <ActionForm action={setMemberActive} inline submitLabel="Reactivate" submitVariant="secondary" readOnly={!canAct || platformLocked}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <input type="hidden" name="value" value="true" />
                    </ActionForm>
                  )}
                </Td>
              </tr>
            );
          })}
          {!members?.length && <tr><Td colSpan={6} className="py-8 text-center text-muted">No members yet.</Td></tr>}
        </tbody>
      </Table>
      <Panel title="Add member" description="The person must already have an account. To create one, use Users → Invite user.">
        <ActionForm action={addMember} submitLabel="Add member" readOnly={!canAct || platformLocked}>
          <input type="hidden" name="orgId" value={org.id} />
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Email" htmlFor="m-email" className="md:col-span-2"><Input id="m-email" name="email" type="email" required /></Field>
            <Field label="Role" htmlFor="m-role">
              <Select id="m-role" name="role" defaultValue={roles[roles.length - 1]}>
                {roles.map((r) => <option key={r} value={r}>{(ROLE_LABEL as Record<string, string>)[r] ?? r.replace("_", " ")}</option>)}
              </Select>
            </Field>
            <Field label="Team" htmlFor="m-team"><Input id="m-team" name="team" placeholder="Team A" /></Field>
            <Field label="Title" htmlFor="m-title" className="md:col-span-2"><Input id="m-title" name="title" /></Field>
            <div className="flex items-end pb-2 md:col-span-2"><Checkbox name="is_supervisor" label="Supervisor (receives escalations for overdue requests)" /></div>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}

async function AppointmentsTab({ supabase, org, canAct }: { supabase: Supabase; org: OrgRow; canAct: boolean }) {
  const col = org.type === "insurer" ? "insurer_org_id" : "broker_org_id";
  const [{ data: appts }, orgs, cats] = await Promise.all([
    supabase.from("insurer_broker_appointments").select("*").eq(col, org.id).order("created_at"),
    orgMap(supabase),
    categoryMap(supabase),
  ]);
  return (
    <Panel
      title="Appointments"
      description={org.type === "insurer" ? "Brokers appointed to place this insurer's products." : "Insurers that have appointed this broker."}
      actions={<Link href="/appointments" className="text-sm text-brand hover:underline">Open matrix →</Link>}
      bodyClassName="p-0"
    >
      <Table className="rounded-none border-0">
        <THead><tr><Th>{org.type === "insurer" ? "Broker" : "Insurer"}</Th><Th>Category</Th><Th>Agreement</Th><Th>Period</Th><Th>Active</Th></tr></THead>
        <tbody>
          {(appts ?? []).map((a) => {
            const other = org.type === "insurer" ? a.broker_org_id : a.insurer_org_id;
            return (
              <tr key={a.id}>
                <Td><Link href={`/organisations/${other}`} className="hover:text-brand">{orgs.get(other)?.name}</Link></Td>
                <Td>{a.category_id ? cats.get(a.category_id)?.name : "All categories"}</Td>
                <Td className="font-mono text-xs">{a.agreement_reference ?? "—"}</Td>
                <Td className="text-xs">{formatDate(a.starts_on)} – {a.ends_on ? formatDate(a.ends_on) : "open"}</Td>
                <Td>
                  {a.category_id ? (
                    <ToggleForm
                      action={toggleAppointment}
                      fields={{ insurerOrgId: a.insurer_org_id, brokerOrgId: a.broker_org_id, categoryId: a.category_id }}
                      checked={a.active}
                      label="Appointment active"
                      disabled={!canAct}
                    />
                  ) : (
                    <Pill tone={a.active ? "ok" : "neutral"}>{a.active ? "Active" : "Inactive"}</Pill>
                  )}
                </Td>
              </tr>
            );
          })}
          {!appts?.length && <tr><Td colSpan={5} className="py-8 text-center text-muted">No appointments.</Td></tr>}
        </tbody>
      </Table>
    </Panel>
  );
}

async function RoutingTab({ supabase, orgId, canAct }: { supabase: Supabase; orgId: string; canAct: boolean }) {
  const [{ data: rules }, cats] = await Promise.all([
    supabase.from("broker_routing_rules").select("*").eq("broker_org_id", orgId).order("priority"),
    categoryMap(supabase),
  ]);
  return (
    <Panel title="Routing rules" description="How new requests reach this broker." actions={<Link href="/routing" className="text-sm text-brand hover:underline">Edit in Routing →</Link>} bodyClassName="p-0">
      <Table className="rounded-none border-0">
        <THead><tr><Th>Category</Th><Th>Priority</Th><Th>Role</Th><Th>Regions</Th><Th>Segments</Th><Th>Daily capacity</Th><Th>Active</Th></tr></THead>
        <tbody>
          {(rules ?? []).map((r) => (
            <tr key={r.id}>
              <Td>{cats.get(r.category_id)?.name}</Td>
              <Td className="tabular-nums">{r.priority}</Td>
              <Td>{r.is_secondary ? <Pill tone="neutral">Secondary</Pill> : <Pill tone="ok">Primary</Pill>}</Td>
              <Td className="text-xs">{r.regions.length ? r.regions.join(", ") : "Nationwide"}</Td>
              <Td className="text-xs">{r.segments.length ? r.segments.join(", ") : "All"}</Td>
              <Td>{r.daily_capacity ?? "Unlimited"}</Td>
              <Td><ToggleForm action={toggleRoutingRule} fields={{ ruleId: r.id }} checked={r.active} label="Rule active" disabled={!canAct} /></Td>
            </tr>
          ))}
          {!rules?.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No routing rules — this broker won&apos;t receive routed requests.</Td></tr>}
        </tbody>
      </Table>
    </Panel>
  );
}

async function SubscriptionTab({ supabase, org, canAct }: { supabase: Supabase; org: OrgRow; canAct: boolean }) {
  const [{ data: subs }, { data: plans }, { data: invoices }] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("org_id", org.id).order("created_at", { ascending: false }),
    supabase.from("plans").select("id, name, audience, monthly_fee, active").eq("audience", org.type).order("sort_order"),
    supabase.from("invoices").select("id, number, total, status, period_start, period_end").eq("org_id", org.id).order("period_start", { ascending: false }).limit(12),
  ]);
  const live = (subs ?? []).find((s) => ["trialing", "active", "past_due"].includes(s.status));
  const planName = (pid: string) => (plans ?? []).find((p) => p.id === pid)?.name ?? "Plan";
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title={live ? "Current subscription" : "No live subscription"}>
        <ActionForm action={saveSubscription} submitLabel={live ? "Update subscription" : "Create subscription"} readOnly={!canAct}>
          <input type="hidden" name="orgId" value={org.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan" htmlFor="s-plan">
              <Select id="s-plan" name="planId" defaultValue={live?.plan_id ?? ""} required>
                <option value="">Choose…</option>
                {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {formatGHS(Number(p.monthly_fee))}/mo{p.active ? "" : " (inactive)"}</option>)}
              </Select>
            </Field>
            <Field label="Status" htmlFor="s-status">
              <Select id="s-status" name="status" defaultValue={live?.status ?? "trialing"}>
                <option value="trialing">Trialing</option>
                <option value="active">Active</option>
                <option value="past_due">Past due</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </Field>
            <Field label="Trial ends" htmlFor="s-trial"><Input id="s-trial" name="trial_ends_on" type="date" defaultValue={live?.trial_ends_on ?? ""} /></Field>
            <Field label="Period start" htmlFor="s-ps"><Input id="s-ps" name="current_period_start" type="date" defaultValue={live?.current_period_start ?? ""} /></Field>
            <Field label="Period end" htmlFor="s-pe"><Input id="s-pe" name="current_period_end" type="date" defaultValue={live?.current_period_end ?? ""} /></Field>
            <div className="flex items-end pb-2"><Checkbox name="cancel_at_period_end" defaultChecked={live?.cancel_at_period_end ?? false} label="Cancel at period end" /></div>
          </div>
        </ActionForm>
      </Panel>
      <div className="space-y-6">
        <Panel title="Subscription history">
          <ul className="space-y-2 text-sm">
            {(subs ?? []).map((s) => (
              <li key={s.id} className="flex justify-between gap-2">
                <span>{planName(s.plan_id)} <span className="text-xs text-muted">{formatDate(s.current_period_start)} – {formatDate(s.current_period_end)}</span></span>
                <Pill tone={s.status === "active" ? "ok" : s.status === "past_due" ? "danger" : s.status === "trialing" ? "info" : "neutral"}>{s.status}</Pill>
              </li>
            ))}
            {!subs?.length && <li className="text-muted">None.</li>}
          </ul>
        </Panel>
        <Panel title="Invoices" actions={<Link href={`/invoices?org=${org.id}`} className="text-sm text-brand hover:underline">All invoices →</Link>}>
          <ul className="space-y-2 text-sm">
            {(invoices ?? []).map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <Link href={`/invoices/${i.id}`} className="text-brand hover:underline">{i.number}</Link>
                <span className="text-xs text-muted">{formatDate(i.period_start)}</span>
                <span className="tabular-nums">{formatGHS(Number(i.total), { decimals: true })}</span>
                <Pill tone={i.status === "paid" ? "ok" : i.status === "void" ? "neutral" : "wait"}>{i.status}</Pill>
              </li>
            ))}
            {!invoices?.length && <li className="text-muted">No invoices.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

async function ActivityTab({ supabase, orgId }: { supabase: Supabase; orgId: string }) {
  const { data } = await supabase
    .from("audit_events")
    .select("*")
    .or(`org_id.eq.${orgId},and(entity_type.eq.organizations,entity_id.eq.${orgId})`)
    .order("id", { ascending: false })
    .limit(100);
  return (
    <Panel title="Activity" description="Last 100 audit events for this organisation." actions={<Link href={`/audit?org=${orgId}`} className="text-sm text-brand hover:underline">Open in audit log →</Link>} bodyClassName="p-0">
      <AuditTable rows={data ?? []} compact />
    </Panel>
  );
}
