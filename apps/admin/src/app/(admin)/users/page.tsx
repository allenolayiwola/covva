import { Suspense } from "react";
import Link from "next/link";
import { Avatar, Field, Input, Pill, Select } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, orgMap, pageOf, sp, type SearchParams } from "@/lib/query";
import { formatDate } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, LoadingBlock, Pagination, Panel } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { inviteUser } from "./actions";

const KYC_TONE: Record<Enum<"kyc_status">, "ok" | "wait" | "danger" | "neutral"> = { verified: "ok", pending: "wait", rejected: "danger", unverified: "neutral" };

export default function UsersPage({ searchParams }: PageProps<"/users">) {
  return (
    <>
      <PageHeader title="Users" description="Customers and partner staff. Search by name, email or phone." />
      <Suspense fallback={<LoadingBlock label="Loading users…" />}>
        <UserList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function UserList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const { page, from, to } = pageOf(params);
  const q = sp(params, "q");
  const kyc = sp(params, "kyc");
  const kind = sp(params, "kind");

  let query = supabase
    .from("profiles")
    .select("id, full_name, email, phone, account_type, business_name, kyc_status, region, created_at, onboarded_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (q) query = query.or(`full_name.ilike.${ilikeTerm(q)},email.ilike.${ilikeTerm(q)},phone.ilike.${ilikeTerm(q)},business_name.ilike.${ilikeTerm(q)}`);
  if (kyc && ["verified", "pending", "rejected", "unverified"].includes(kyc)) query = query.eq("kyc_status", kyc as Enum<"kyc_status">);
  if (kind === "business" || kind === "individual") query = query.eq("account_type", kind);
  const [{ data, count, error }, orgs] = await Promise.all([query, orgMap(supabase)]);
  const ids = (data ?? []).map((p) => p.id);
  const { data: members } = ids.length ? await supabase.from("memberships").select("user_id, org_id, role, active").in("user_id", ids).eq("active", true) : { data: [] };
  const memByUser = new Map<string, { org_id: string; role: string }[]>();
  for (const m of members ?? []) memByUser.set(m.user_id, [...(memByUser.get(m.user_id) ?? []), m]);
  const canInvite = can(staff.roles, "network");

  return (
    <div className="space-y-6">
      <div>
        <FilterBar action="/users">
          <FilterInput name="q" label="Name, email or phone" value={q} />
          <FilterSelect name="kyc" label="KYC" value={kyc} options={["verified", "pending", "rejected", "unverified"].map((v) => ({ value: v, label: v }))} />
          <FilterSelect name="kind" label="Account" value={kind} options={[{ value: "individual", label: "Individual" }, { value: "business", label: "Business" }]} />
        </FilterBar>
        {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
        <Table>
          <THead><tr><Th>User</Th><Th>Phone</Th><Th>Account</Th><Th>KYC</Th><Th>Organisations</Th><Th>Joined</Th></tr></THead>
          <tbody>
            {(data ?? []).map((p) => (
              <tr key={p.id} className="hover:bg-mist/60">
                <Td>
                  <Link href={`/users/${p.id}`} className="flex items-center gap-2.5 hover:text-brand">
                    <Avatar name={p.full_name ?? p.email ?? "?"} size={30} />
                    <span><span className="block font-medium text-ink">{p.full_name ?? "Unnamed"}</span><span className="block text-xs text-muted">{p.email ?? "—"}</span></span>
                  </Link>
                </Td>
                <Td className="text-xs">{p.phone ?? "—"}</Td>
                <Td className="capitalize">{p.account_type}{p.business_name && <p className="text-xs text-muted">{p.business_name}</p>}</Td>
                <Td><Pill tone={KYC_TONE[p.kyc_status]}>{p.kyc_status}</Pill></Td>
                <Td className="text-xs">
                  {(memByUser.get(p.id) ?? []).map((m) => (
                    <span key={m.org_id} className="mb-0.5 mr-1 inline-block rounded bg-mist px-1.5 py-0.5">{orgs.get(m.org_id)?.name} · {m.role.replace("_", " ")}</span>
                  ))}
                  {!memByUser.get(p.id) && <span className="text-muted">Customer</span>}
                </Td>
                <Td className="text-muted">{formatDate(p.created_at)}</Td>
              </tr>
            ))}
            {!data?.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No users match.</Td></tr>}
          </tbody>
        </Table>
        <Pagination base="/users" params={params} page={page} total={count} />
      </div>

      <Panel title="Invite user" description="Sends a Supabase Auth invitation email. Requires SUPABASE_SECRET_KEY on the admin app. Optionally adds the person to an organisation.">
        <ActionForm action={inviteUser} submitLabel="Send invitation" readOnly={!canInvite}>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Full name" htmlFor="inv-name"><Input id="inv-name" name="full_name" required /></Field>
            <Field label="Email" htmlFor="inv-email"><Input id="inv-email" name="email" type="email" required /></Field>
            <Field label="Organisation (optional)" htmlFor="inv-org">
              <Select id="inv-org" name="orgId" defaultValue="">
                <option value="">None — customer</option>
                {[...orgs.values()].map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}
              </Select>
            </Field>
            <Field label="Role" htmlFor="inv-role" hint="Must suit the organisation type">
              <Select id="inv-role" name="role" defaultValue="">
                <option value="">—</option>
                {["owner", "admin", "supervisor", "adviser", "underwriter", "claims_officer", "finance", "viewer", "platform_admin", "platform_ops", "compliance", "support"].map((r) => (
                  <option key={r} value={r}>{r.replace("_", " ")}</option>
                ))}
              </Select>
            </Field>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
