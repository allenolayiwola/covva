import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Field, Pill, Select } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can, ROLE_LABEL } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap } from "@/lib/query";
import { formatDate, formatDateTime } from "@/lib/format";
import { ROLES_BY_ORG_TYPE } from "@/lib/org-meta";
import { Breadcrumb, Kpi, KeyValues, LoadingBlock, Panel } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { addUserToOrg } from "../actions";
import { changeMemberRole, setMemberActive } from "../../organisations/actions";

export default function UserDetailPage({ params }: PageProps<"/users/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading user…" />}>
      <UserDetail params={params} />
    </Suspense>
  );
}

function mask(v: string | null) {
  return v ? `${v.slice(0, 4)}••••${v.slice(-3)}` : "—";
}

async function UserDetail({ params }: Pick<PageProps<"/users/[id]">, "params">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: p } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();

  const head = { count: "exact" as const, head: true };
  const [orgs, { data: members }, { data: consents }, { data: kyc }, reqs, pols, clms, cmps] = await Promise.all([
    orgMap(supabase),
    supabase.from("memberships").select("*").eq("user_id", id).order("created_at"),
    supabase.from("consents").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("kyc_verifications").select("id, method, status, provider, created_at, reviewed_at").eq("user_id", id).order("created_at", { ascending: false }),
    supabase.from("requests").select("id", head).eq("customer_id", id),
    supabase.from("policies").select("id", head).eq("customer_id", id),
    supabase.from("claims").select("id", head).eq("customer_id", id),
    supabase.from("complaints").select("id", head).eq("customer_id", id),
  ]);
  const canAct = can(staff.roles, "network");
  const isAdmin = staff.roles.includes("platform_admin");
  const name = p.full_name ?? p.email ?? "Unnamed user";

  return (
    <>
      <Breadcrumb items={[{ label: "Users", href: "/users" }, { label: name }]} />
      <PageHeader
        title={<span className="flex items-center gap-3"><Avatar name={name} size={40} />{name}</span>}
        description={`${p.email ?? "No email"} · ${p.phone ?? "No phone"} · joined ${formatDate(p.created_at)}`}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi label="Requests" value={reqs.count ?? 0} href={`/requests?customer=${id}`} />
        <Kpi label="Policies" value={pols.count ?? 0} href={`/policies?customer=${id}`} />
        <Kpi label="Claims" value={clms.count ?? 0} />
        <Kpi label="Complaints" value={cmps.count ?? 0} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Profile">
            <KeyValues
              cols={3}
              items={[
                { label: "Preferred name", value: p.preferred_name ?? "—" },
                { label: "Account type", value: <span className="capitalize">{p.account_type}</span> },
                { label: "Business", value: p.business_name ?? "—" },
                { label: "Date of birth", value: formatDate(p.date_of_birth) },
                { label: "Ghana Card", value: <span className="font-mono">{mask(p.ghana_card_number)}</span> },
                { label: "KYC", value: <><Pill tone={p.kyc_status === "verified" ? "ok" : p.kyc_status === "pending" ? "wait" : p.kyc_status === "rejected" ? "danger" : "neutral"}>{p.kyc_status}</Pill>{p.kyc_verified_at && <span className="ml-2 text-xs text-muted">{formatDate(p.kyc_verified_at)}</span>}</> },
                { label: "Region / city", value: [p.region, p.city].filter(Boolean).join(", ") || "—" },
                { label: "Locale", value: p.locale },
                { label: "Onboarded", value: formatDateTime(p.onboarded_at) },
                { label: "Notifications", value: Object.entries((p.notification_prefs as Record<string, boolean>) ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ") || "None" },
              ]}
            />
          </Panel>

          <Panel title="Memberships" bodyClassName="p-0">
            <Table className="rounded-none border-0">
              <THead><tr><Th>Organisation</Th><Th>Role</Th><Th>Status</Th><Th /></tr></THead>
              <tbody>
                {(members ?? []).map((m) => {
                  const org = orgs.get(m.org_id);
                  const locked = org?.type === "platform" && !isAdmin;
                  const roles = org ? ROLES_BY_ORG_TYPE[org.type as keyof typeof ROLES_BY_ORG_TYPE] : [];
                  return (
                    <tr key={m.id}>
                      <Td><Link href={`/organisations/${m.org_id}`} className="hover:text-brand">{org?.name}</Link> <span className="text-xs text-muted">({org?.type})</span></Td>
                      <Td>
                        <ActionForm action={changeMemberRole} inline submitLabel="Change" submitVariant="ghost" readOnly={!canAct || locked}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <select name="role" defaultValue={m.role} className="h-9 rounded-md border border-line bg-white px-2 text-sm" aria-label="Role">
                            {roles.map((r) => <option key={r} value={r}>{(ROLE_LABEL as Record<string, string>)[r] ?? r.replace("_", " ")}</option>)}
                          </select>
                        </ActionForm>
                      </Td>
                      <Td>{m.active ? <Pill tone="ok">Active</Pill> : <Pill tone="neutral">Deactivated</Pill>}</Td>
                      <Td className="text-right">
                        {m.active ? (
                          <ConfirmAction action={setMemberActive} fields={{ membershipId: m.id, value: "false" }} label="Deactivate" title="Deactivate membership" confirmLabel="Deactivate" disabled={!canAct || locked} />
                        ) : (
                          <ActionForm action={setMemberActive} inline submitLabel="Reactivate" submitVariant="secondary" readOnly={!canAct || locked}>
                            <input type="hidden" name="membershipId" value={m.id} />
                            <input type="hidden" name="value" value="true" />
                          </ActionForm>
                        )}
                      </Td>
                    </tr>
                  );
                })}
                {!members?.length && <tr><Td colSpan={4} className="py-6 text-center text-muted">Customer — no organisation memberships.</Td></tr>}
              </tbody>
            </Table>
            <div className="border-t border-line p-5">
              <ActionForm action={addUserToOrg} submitLabel="Add to organisation" readOnly={!canAct}>
                <input type="hidden" name="userId" value={p.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Organisation" htmlFor="u-org">
                    <Select id="u-org" name="orgId" required defaultValue="">
                      <option value="">Choose…</option>
                      {[...orgs.values()].map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}
                    </Select>
                  </Field>
                  <Field label="Role" htmlFor="u-role" hint="Must suit the organisation type">
                    <Select id="u-role" name="role" defaultValue="viewer">
                      {["owner", "admin", "supervisor", "adviser", "underwriter", "claims_officer", "finance", "viewer", "platform_admin", "platform_ops", "compliance", "support"].map((r) => (
                        <option key={r} value={r}>{r.replace("_", " ")}</option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </ActionForm>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Consent history" description="Append-only record of what the customer agreed to.">
            <ul className="space-y-2 text-sm">
              {(consents ?? []).map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-medium text-ink">{c.type.replace(/_/g, " ")}</span> <span className="text-xs text-muted">v{c.version}</span>
                    <span className="block text-xs text-muted">{formatDateTime(c.created_at)}{c.context ? ` · ${c.context}` : ""}</span>
                  </span>
                  <Pill tone={c.granted ? "ok" : "neutral"}>{c.granted ? "granted" : "withdrawn"}</Pill>
                </li>
              ))}
              {!consents?.length && <li className="text-muted">No consents recorded.</li>}
            </ul>
          </Panel>
          <Panel title="KYC verifications" actions={<Link href="/kyc" className="text-sm text-brand hover:underline">Review queue →</Link>}>
            <ul className="space-y-2 text-sm">
              {(kyc ?? []).map((k) => (
                <li key={k.id} className="flex justify-between gap-2">
                  <span>{k.method.replace("_", " ")} <span className="block text-xs text-muted">{formatDateTime(k.created_at)}{k.provider ? ` · ${k.provider}` : ""}</span></span>
                  <Pill tone={k.status === "verified" ? "ok" : k.status === "pending" ? "wait" : k.status === "rejected" ? "danger" : "neutral"}>{k.status}</Pill>
                </li>
              ))}
              {!kyc?.length && <li className="text-muted">No verifications submitted.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
