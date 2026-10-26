import type { Metadata } from "next";
import { Suspense } from "react";
import { Checkbox, DemoBadge, Field, Input, Notice, PageHeader, Pill, Select, Table, Tabs, Td, Textarea, Th, THead } from "@im/ui";
import { GHANA_REGIONS, formatDate, formatDateTime, formatGHS, humanize } from "@im/core";
import { can, getPartnerContext, ROLES, type PartnerContext } from "../../_lib/context";
import { nowMs, getTeam, teamsOf } from "../../_lib/data";
import { API_SCOPES, BROKER_ROLES, INSURER_ROLES, WEBHOOK_EVENTS } from "../../_lib/settings";
import { ActionForm } from "@/components/partner/action-form";
import { ApiKeyForm, InviteForm, LogoUpload } from "@/components/partner/settings-forms";
import { Bars, Empty, KV, PageSkeleton, Section } from "@/components/partner/ui";
import {
  createApiKey,
  createWebhook,
  inviteMember,
  revokeApiKey,
  revokeInvitation,
  saveConnector,
  setLogo,
  setMemberActive,
  updateMember,
  updateOrg,
  updateWebhook,
} from "./actions";

export const metadata: Metadata = { title: "Team settings" };

export default function SettingsPage({ searchParams }: PageProps<"/partner/settings">) {
  return (
    <>
      <PageHeader title="Team settings" description="Your team, organisation profile, licence, billing and integrations." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Settings searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPartnerContext();
  const sp = await searchParams;
  const tabs = [
    { key: "team", label: "Team" },
    { key: "organisation", label: "Organisation" },
    { key: "licence", label: "NIC licence" },
    { key: "billing", label: "Billing" },
    { key: "developer", label: "Developer" },
    ...(ctx.kind === "insurer" ? [{ key: "connector", label: "Connector" }] : []),
  ];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "team";

  return (
    <>
      <Tabs className="mb-6 w-fit max-w-full" active={tab} items={tabs.map((t) => ({ ...t, href: `/partner/settings?tab=${t.key}` }))} />
      {tab === "team" && <TeamTab ctx={ctx} />}
      {tab === "organisation" && <OrgTab ctx={ctx} />}
      {tab === "licence" && <LicenceTab ctx={ctx} />}
      {tab === "billing" && <BillingTab ctx={ctx} />}
      {tab === "developer" && <DeveloperTab ctx={ctx} />}
      {tab === "connector" && <ConnectorTab ctx={ctx} />}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}

const roleLabel = (r: string) => humanize(r);

async function TeamTab({ ctx }: { ctx: PartnerContext }) {
  const admin = can(ctx, ROLES.orgAdmin);
  const [team, invites] = await Promise.all([
    getTeam(ctx, true),
    admin ? ctx.supabase.from("invitations").select("id, email, role, team, expires_at, accepted_at, created_at").eq("org_id", ctx.orgId).is("accepted_at", null).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const roles = ctx.kind === "broker" ? BROKER_ROLES : INSURER_ROLES;
  return (
    <div className="space-y-6">
      {!admin && <Notice tone="info">Only owners and admins can invite or change members. You can see who is on the team.</Notice>}
      <Section title="Members" description={`${team.filter((m) => m.active).length} active`}>
        <Table>
          <THead><tr><Th>Member</Th><Th>Role</Th><Th>Team</Th><Th>Status</Th>{admin && <Th>Manage</Th>}</tr></THead>
          <tbody>
            {team.map((m) => (
              <tr key={m.membershipId} className={m.active ? undefined : "opacity-60"}>
                <Td><p className="font-medium text-ink">{m.name}{m.userId === ctx.userId && <span className="ml-1 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{m.email ?? m.title ?? ""}</p></Td>
                <Td>{roleLabel(m.role)}{m.isSupervisor && m.role !== "supervisor" && <Pill className="ml-1">Supervisor</Pill>}</Td>
                <Td>{m.team ?? "—"}</Td>
                <Td>{m.active ? <Pill tone="ok">Active</Pill> : <Pill>Deactivated</Pill>}</Td>
                {admin && (
                  <Td>
                    {m.role === "owner" || m.userId === ctx.userId ? <span className="text-xs text-subtle">—</span> : (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-brand">Edit</summary>
                        <div className="mt-2 w-72 space-y-3">
                          <ActionForm action={updateMember} submitLabel="Save" className="space-y-2">
                            <input type="hidden" name="membershipId" value={m.membershipId} />
                            <Field label="Role" htmlFor={`r-${m.membershipId}`}>
                              <Select id={`r-${m.membershipId}`} name="role" defaultValue={m.role} className="h-9 text-sm">
                                {[...new Set([m.role, ...roles])].map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                              </Select>
                            </Field>
                            <Field label="Team" htmlFor={`t-${m.membershipId}`}><Input id={`t-${m.membershipId}`} name="team" defaultValue={m.team ?? ""} className="h-9 text-sm" /></Field>
                            <Field label="Title" htmlFor={`ti-${m.membershipId}`}><Input id={`ti-${m.membershipId}`} name="title" defaultValue={m.title ?? ""} className="h-9 text-sm" /></Field>
                            <Checkbox name="supervisor" defaultChecked={m.isSupervisor} label="Supervisor (receives escalations)" />
                          </ActionForm>
                          <ActionForm action={setMemberActive} submitLabel={m.active ? "Deactivate" : "Reactivate"} variant={m.active ? "outline" : "secondary"} confirm={m.active ? "Deactivate this member? They lose access immediately." : undefined}>
                            <input type="hidden" name="membershipId" value={m.membershipId} />
                            <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                          </ActionForm>
                        </div>
                      </details>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      {admin && (
        <Section title="Invite member" description="They'll get access once they accept with this email address.">
          <InviteForm action={inviteMember} roles={roles} teams={teamsOf(team)} />
          {(invites.data ?? []).length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">Pending invitations</h3>
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {(invites.data ?? []).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span><span className="font-medium text-ink">{i.email}</span> · {roleLabel(i.role)}{i.team ? ` · ${i.team}` : ""} <span className="text-xs text-muted">· expires {formatDate(i.expires_at)}</span></span>
                    <ActionForm action={revokeInvitation} submitLabel="Revoke" variant="ghost" inline>
                      <input type="hidden" name="id" value={i.id} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

async function OrgTab({ ctx }: { ctx: PartnerContext }) {
  const { data: org } = await ctx.supabase.from("organizations").select("*").eq("id", ctx.orgId).single();
  const admin = can(ctx, ROLES.orgAdmin);
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  if (!org) return <Empty>Organisation not found.</Empty>;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Section title="Organisation profile" description="Shown to customers on disclosures and your broker profile.">
        {admin ? (
          <ActionForm action={updateOrg} submitLabel="Save profile" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contact email" htmlFor="o-email"><Input id="o-email" name="contact_email" type="email" defaultValue={org.contact_email ?? ""} className="h-10 text-sm" /></Field>
              <Field label="Contact phone" htmlFor="o-phone"><Input id="o-phone" name="contact_phone" defaultValue={org.contact_phone ?? ""} className="h-10 text-sm" /></Field>
              <Field label="Website" htmlFor="o-web"><Input id="o-web" name="website" type="url" defaultValue={org.website ?? ""} className="h-10 text-sm" /></Field>
              <Field label="Region" htmlFor="o-region">
                <Select id="o-region" name="region" defaultValue={org.region ?? ""} className="h-10 text-sm">
                  <option value="">—</option>
                  {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Address" htmlFor="o-addr" className="sm:col-span-2"><Input id="o-addr" name="address" defaultValue={org.address ?? ""} className="h-10 text-sm" /></Field>
              <Field label="Service hours" htmlFor="o-hours" className="sm:col-span-2" hint="e.g. Mon–Fri 08:00–17:00, Sat 09:00–13:00"><Input id="o-hours" name="service_hours" defaultValue={String(settings.service_hours ?? "")} className="h-10 text-sm" /></Field>
            </div>
            <Field label="Description" htmlFor="o-desc"><Textarea id="o-desc" name="description" defaultValue={org.description ?? ""} rows={3} className="text-sm" /></Field>
          </ActionForm>
        ) : (
          <>
            <KV label="Contact email">{org.contact_email ?? "—"}</KV>
            <KV label="Contact phone">{org.contact_phone ?? "—"}</KV>
            <KV label="Website">{org.website ?? "—"}</KV>
            <KV label="Address">{org.address ?? "—"}</KV>
            <KV label="Service hours">{String(settings.service_hours ?? "—")}</KV>
          </>
        )}
      </Section>
      <Section title="Logo">
        {admin ? <LogoUpload orgId={ctx.orgId} current={org.logo_url} action={setLogo} /> : org.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logo_url} alt={`${org.name} logo`} className="h-16 w-auto" />
        ) : <p className="text-sm text-muted">No logo.</p>}
      </Section>
    </div>
  );
}

async function LicenceTab({ ctx }: { ctx: PartnerContext }) {
  const { data: org } = await ctx.supabase.from("organizations").select("name, legal_name, registration_number, nic_licence_number, nic_licence_class, nic_licence_expires_on, licence_verified_at, professional_indemnity_expires_on, status").eq("id", ctx.orgId).single();
  if (!org) return <Empty>Organisation not found.</Empty>;
  const expires = org.nic_licence_expires_on ? Math.ceil((Date.parse(org.nic_licence_expires_on) - nowMs()) / 86_400_000) : null;
  return (
    <Section title="NIC licence" description="Verified by the platform against the National Insurance Commission register. Contact platform support to update.">
      <div className="max-w-xl">
        <KV label="Legal name">{org.legal_name ?? org.name}</KV>
        <KV label="Registration number">{org.registration_number ?? "—"}</KV>
        <KV label="Licence number">{org.nic_licence_number ?? "—"}</KV>
        <KV label="Licence class">{org.nic_licence_class ?? "—"}</KV>
        <KV label="Licence expires">{formatDate(org.nic_licence_expires_on)}{expires !== null && expires <= 60 && <Pill tone="wait" className="ml-2">{expires} days</Pill>}</KV>
        <KV label="Professional indemnity expires">{formatDate(org.professional_indemnity_expires_on)}</KV>
        <KV label="Verification">{org.licence_verified_at ? <Pill tone="ok">Verified {formatDate(org.licence_verified_at)}</Pill> : <Pill tone="wait">Awaiting platform verification</Pill>}</KV>
        <KV label="Organisation status">{humanize(org.status)}</KV>
      </div>
    </Section>
  );
}

async function BillingTab({ ctx }: { ctx: PartnerContext }) {
  if (!can(ctx, ROLES.billing)) return <Notice tone="info">Billing is visible to owners, admins and finance.</Notice>;
  const { data: sub } = await ctx.supabase
    .from("subscriptions")
    .select("id, status, current_period_start, current_period_end, trial_ends_on, cancel_at_period_end, plan:plans!subscriptions_plan_id_fkey(name, description, monthly_fee, currency, included_seats, included_requests, per_request_fee, per_active_policy_fee, features)")
    .eq("org_id", ctx.orgId)
    .in("status", ["trialing", "active", "past_due"])
    .maybeSingle();
  const periodStart = sub?.current_period_start ?? new Date(nowMs() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: usage }, { data: invoices }, { count: seats }] = await Promise.all([
    ctx.supabase.from("usage_events").select("metric, quantity").eq("org_id", ctx.orgId).gte("occurred_at", periodStart).limit(10000),
    ctx.supabase.from("invoices").select("id, number, period_start, period_end, total, currency, status, due_on, issued_at").eq("org_id", ctx.orgId).order("period_start", { ascending: false }).limit(24),
    ctx.supabase.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("active", true),
  ]);
  const plan = sub?.plan as unknown as { name: string; description: string | null; monthly_fee: number; included_seats: number | null; included_requests: number | null; per_request_fee: number; per_active_policy_fee: number; features: string[] } | null;
  const byMetric = new Map<string, number>();
  for (const u of usage ?? []) byMetric.set(u.metric, (byMetric.get(u.metric) ?? 0) + Number(u.quantity));
  const requests = byMetric.get("request_processed") ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Subscription">
        {!sub || !plan ? <Empty>No active subscription. Contact the partnerships team.</Empty> : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <p className="text-xl font-semibold text-ink">{plan.name}</p>
              <Pill tone={sub.status === "active" ? "ok" : sub.status === "past_due" ? "danger" : "info"}>{humanize(sub.status)}</Pill>
            </div>
            {plan.description && <p className="mb-3 text-sm text-muted">{plan.description}</p>}
            <KV label="Monthly fee">{formatGHS(Number(plan.monthly_fee))}</KV>
            <KV label="Seats">{seats ?? 0} of {plan.included_seats ?? "unlimited"}</KV>
            <KV label="Included requests">{plan.included_requests ?? "Unlimited"}</KV>
            <KV label="Per extra request">{formatGHS(Number(plan.per_request_fee), { decimals: true })}</KV>
            <KV label="Per active policy">{formatGHS(Number(plan.per_active_policy_fee), { decimals: true })}</KV>
            <KV label="Current period">{formatDate(sub.current_period_start)} – {formatDate(sub.current_period_end)}</KV>
            {sub.trial_ends_on && <KV label="Trial ends">{formatDate(sub.trial_ends_on)}</KV>}
            {Array.isArray(plan.features) && <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-ink-2">{plan.features.map((f) => <li key={f}>{f}</li>)}</ul>}
          </>
        )}
      </Section>
      <Section title="Usage this period" description={`Since ${formatDate(periodStart)}`}>
        {byMetric.size === 0 ? <Empty>No metered usage yet.</Empty> : <Bars items={[...byMetric.entries()].map(([k, v]) => ({ label: humanize(k), value: v }))} />}
        {plan?.included_requests != null && (
          <p className="mt-3 text-sm text-muted">{requests} of {plan.included_requests} included requests used{requests > plan.included_requests ? ` · ${requests - plan.included_requests} billable` : ""}.</p>
        )}
      </Section>
      <Section title="Invoices" className="lg:col-span-2">
        {(invoices ?? []).length === 0 ? <Empty>No invoices yet.</Empty> : (
          <Table>
            <THead><tr><Th>Invoice</Th><Th>Period</Th><Th>Total</Th><Th>Status</Th><Th>Due</Th></tr></THead>
            <tbody>
              {(invoices ?? []).map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium text-ink">{i.number}</Td>
                  <Td>{formatDate(i.period_start)} – {formatDate(i.period_end)}</Td>
                  <Td className="tabular-nums">{formatGHS(Number(i.total), { decimals: true })}</Td>
                  <Td><Pill tone={i.status === "paid" ? "ok" : i.status === "overdue" ? "danger" : "wait"}>{humanize(i.status)}</Pill></Td>
                  <Td>{formatDate(i.due_on)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}

async function DeveloperTab({ ctx }: { ctx: PartnerContext }) {
  if (!can(ctx, ROLES.orgAdmin)) return <Notice tone="info">API keys and webhooks are managed by owners and admins.</Notice>;
  const [{ data: keys }, { data: hooks }] = await Promise.all([
    ctx.supabase.from("api_keys").select("id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at").eq("org_id", ctx.orgId).order("created_at", { ascending: false }),
    ctx.supabase.from("webhook_endpoints").select("id, url, events, active, secret, last_delivery_at, last_status, created_at").eq("org_id", ctx.orgId).order("created_at", { ascending: false }),
  ]);
  return (
    <div className="space-y-6">
      <Section title="API keys" description="For your systems to call the /api/v1 endpoints. Keys act for your organisation; keep them secret.">
        {(keys ?? []).length > 0 && (
          <Table className="mb-5">
            <THead><tr><Th>Name</Th><Th>Key</Th><Th>Scopes</Th><Th>Last used</Th><Th>Status</Th><Th /></tr></THead>
            <tbody>
              {(keys ?? []).map((k) => {
                const expired = k.expires_at && Date.parse(k.expires_at) < nowMs();
                return (
                  <tr key={k.id}>
                    <Td className="font-medium text-ink">{k.name}<p className="text-xs text-muted">Created {formatDate(k.created_at)}</p></Td>
                    <Td><code className="text-xs">{k.prefix}_••••</code></Td>
                    <Td className="text-xs">{k.scopes.join(", ")}</Td>
                    <Td className="text-xs">{formatDateTime(k.last_used_at)}</Td>
                    <Td>{k.revoked_at ? <Pill tone="danger">Revoked</Pill> : expired ? <Pill>Expired</Pill> : <Pill tone="ok">Active{k.expires_at ? ` · until ${formatDate(k.expires_at)}` : ""}</Pill>}</Td>
                    <Td>
                      {!k.revoked_at && (
                        <ActionForm action={revokeApiKey} submitLabel="Revoke" variant="ghost" inline confirm="Revoke this key? Integrations using it stop working immediately.">
                          <input type="hidden" name="id" value={k.id} />
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <ApiKeyForm action={createApiKey} scopes={API_SCOPES} />
      </Section>

      <Section title="Webhooks" description="We POST signed JSON events to your HTTPS endpoint. Verify the signature with the endpoint's signing secret.">
        {(hooks ?? []).length > 0 && (
          <ul className="mb-5 divide-y divide-line rounded-xl border border-line">
            {(hooks ?? []).map((h) => (
              <li key={h.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="break-all font-medium text-ink">{h.url}</p>
                  <div className="flex items-center gap-2">
                    {h.active ? <Pill tone="ok">Active</Pill> : <Pill>Paused</Pill>}
                    {h.last_status != null && <Pill tone={h.last_status < 300 ? "ok" : "danger"}>Last {h.last_status}</Pill>}
                  </div>
                </div>
                <p className="text-xs text-muted">{h.events.join(", ")} · last delivery {formatDateTime(h.last_delivery_at)}</p>
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-brand">Show signing secret</summary>
                  <code className="mt-1 block break-all rounded bg-mist px-2 py-1 text-xs">{h.secret}</code>
                </details>
                <div className="flex gap-2">
                  <ActionForm action={updateWebhook} submitLabel={h.active ? "Pause" : "Enable"} variant="outline" inline>
                    <input type="hidden" name="id" value={h.id} /><input type="hidden" name="op" value={h.active ? "disable" : "enable"} />
                  </ActionForm>
                  <ActionForm action={updateWebhook} submitLabel="Delete" variant="ghost" inline confirm="Delete this webhook endpoint?">
                    <input type="hidden" name="id" value={h.id} /><input type="hidden" name="op" value="delete" />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={createWebhook} submitLabel="Add endpoint" resetOnSuccess className="space-y-3">
          <Field label="Endpoint URL" htmlFor="wh-url"><Input id="wh-url" name="url" type="url" required placeholder="https://example.com/webhooks/insurance-marketplace" className="h-10 text-sm" /></Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-2">Events</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((e) => <Checkbox key={e} name="events" value={e} label={<code className="text-xs">{e}</code>} />)}
            </div>
          </fieldset>
        </ActionForm>
      </Section>
    </div>
  );
}

async function ConnectorTab({ ctx }: { ctx: PartnerContext }) {
  if (!can(ctx, ROLES.orgAdmin)) return <Notice tone="info">Connector details are managed by owners and admins.</Notice>;
  const { data: conn } = await ctx.supabase.from("connector_configs").select("*").eq("insurer_org_id", ctx.orgId).maybeSingle();
  const config = (conn?.config ?? {}) as Record<string, unknown>;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Section title="Integration" description="Level 1 uses this portal. Quote and policy APIs let us request binding quotes and issue policies automatically.">
        <ActionForm action={saveConnector} submitLabel="Save connector details" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Integration level" htmlFor="c-level">
              <Select id="c-level" name="level" defaultValue={conn?.level ?? "portal"} className="h-10 text-sm">
                <option value="portal">Level 1 — Partner portal</option>
                <option value="quote_api">Level 2 — Quote API</option>
                <option value="policy_api">Level 3 — Quote + policy API</option>
              </Select>
            </Field>
            <Field label="Authentication" htmlFor="c-auth">
              <Select id="c-auth" name="auth_type" defaultValue={conn?.auth_type ?? "api_key"} className="h-10 text-sm">
                <option value="none">None (portal only)</option>
                <option value="api_key">API key</option>
                <option value="oauth2_client_credentials">OAuth 2.0 client credentials</option>
                <option value="mtls">Mutual TLS</option>
                <option value="basic">Basic auth</option>
              </Select>
            </Field>
            <Field label="API base URL" htmlFor="c-url" className="sm:col-span-2"><Input id="c-url" name="base_url" type="url" defaultValue={conn?.base_url ?? ""} placeholder="https://api.insurer.example/v1" className="h-10 text-sm" /></Field>
            <Field label="Technical contact" htmlFor="c-contact" className="sm:col-span-2"><Input id="c-contact" name="contact" defaultValue={String(config.technical_contact ?? "")} className="h-10 text-sm" /></Field>
          </div>
          <p className="text-xs text-muted">Credentials are exchanged securely with platform operations — never paste secrets here.</p>
        </ActionForm>
      </Section>
      <Section title="Status" tone="mist">
        <KV label="Status"><Pill tone={conn?.status === "active" ? "ok" : "wait"}>{humanize(conn?.status ?? "not configured")}</Pill></KV>
        <KV label="Last success">{formatDateTime(conn?.last_success_at)}</KV>
        {conn?.last_error && <p className="mt-2 text-xs text-danger">Last error: {conn.last_error}</p>}
        <p className="mt-3 text-xs text-muted">The platform tests and enables connectors. Until then, submissions arrive in this portal.</p>
      </Section>
    </div>
  );
}
