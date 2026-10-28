import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar, DemoBadge, Pill, StatusPill, Table, Td, Th, THead } from "@im/ui";
import { CLAIM_STATUS, COMPLAINT_STATUS, POLICY_STATUS, REQUEST_STATUS, formatDate, formatDateTime, formatGHS, humanize } from "@im/core";
import { requireKind } from "../../../_lib/context";
import { fullName, getCategoryMap, getCustomers, getOrgNames, requestKind } from "../../../_lib/data";
import { customerConsents } from "../../../_lib/privileged";
import { Empty, KV, PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Customer" };

export default function CustomerPage({ params }: PageProps<"/partner/customers/[id]">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} /></>}>
      <Customer params={params} />
    </Suspense>
  );
}

async function Customer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKind("broker");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = ctx.supabase;

  const [profiles, { data: requests }, { data: policies }, { data: claims }, { data: complaints }] = await Promise.all([
    getCustomers(ctx, [id]),
    sb.from("requests").select("id, reference, status, type, category_id, created_at").eq("broker_org_id", ctx.orgId).eq("customer_id", id).order("created_at", { ascending: false }),
    sb.from("policies").select("id, policy_number, internal_reference, status, category_id, insurer_org_id, cover_start, cover_end, premium").eq("broker_org_id", ctx.orgId).eq("customer_id", id).order("created_at", { ascending: false }),
    sb.from("claims").select("id, reference, status, incident_type, created_at, amount_claimed").eq("broker_org_id", ctx.orgId).eq("customer_id", id).order("created_at", { ascending: false }),
    sb.from("complaints").select("id, reference, status, subject, due_at, created_at").eq("owner_org_id", ctx.orgId).eq("customer_id", id).order("created_at", { ascending: false }),
  ]);
  const profile = profiles.get(id);
  if (!profile || ((requests ?? []).length === 0 && (policies ?? []).length === 0)) notFound();

  const reqIds = (requests ?? []).map((r) => r.id);
  const [cats, insurers, consents, { data: messages }] = await Promise.all([
    getCategoryMap(),
    getOrgNames(ctx, (policies ?? []).map((p) => p.insurer_org_id)),
    customerConsents(id),
    reqIds.length
      ? sb.from("request_messages").select("id, request_id, body, sender_party, internal, created_at").in("request_id", reqIds).order("created_at", { ascending: false }).limit(15)
      : Promise.resolve({ data: [] as { id: string; request_id: string; body: string; sender_party: string; internal: boolean; created_at: string }[] }),
  ]);
  const refOf = new Map((requests ?? []).map((r) => [r.id, r.reference]));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/partner/customers" className="hover:text-brand">Customers</Link> <span aria-hidden>›</span> {fullName(profile)}
      </nav>
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={fullName(profile)} size={56} />
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{fullName(profile)}</h1>
          <p className="text-sm text-muted">Customer since {formatDate(profile.created_at, "long")} · {humanize(profile.account_type)}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Section title="Requests">
            {(requests ?? []).length === 0 ? <Empty>No requests.</Empty> : (
              <Table>
                <THead><tr><Th>Reference</Th><Th>Type</Th><Th>Status</Th><Th>Opened</Th></tr></THead>
                <tbody>
                  {(requests ?? []).map((r) => (
                    <tr key={r.id}>
                      <Td><Link href={`/partner/requests/${r.id}`} className="font-semibold text-ink hover:text-brand">{r.reference}</Link></Td>
                      <Td>{requestKind(cats.get(r.category_id)?.name, r.type)}</Td>
                      <Td><StatusPill meta={REQUEST_STATUS[r.status]} /></Td>
                      <Td>{formatDate(r.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
          <Section title="Policies">
            {(policies ?? []).length === 0 ? <Empty>No policies with your organisation.</Empty> : (
              <Table>
                <THead><tr><Th>Policy</Th><Th>Insurer</Th><Th>Status</Th><Th>Cover</Th><Th>Premium</Th></tr></THead>
                <tbody>
                  {(policies ?? []).map((p) => (
                    <tr key={p.id}>
                      <Td className="font-medium text-ink">{p.policy_number ?? p.internal_reference}<p className="text-xs text-muted">{cats.get(p.category_id)?.name}</p></Td>
                      <Td>{(p.insurer_org_id ? insurers.get(p.insurer_org_id) : null) ?? "Insurer"}</Td>
                      <Td><StatusPill meta={POLICY_STATUS[p.status]} /></Td>
                      <Td>{formatDate(p.cover_start)} – {formatDate(p.cover_end)}</Td>
                      <Td className="tabular-nums">{formatGHS(p.premium != null ? Number(p.premium) : null)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Claims">
              {(claims ?? []).length === 0 ? <Empty>No claims.</Empty> : (
                <ul className="divide-y divide-line text-sm">
                  {(claims ?? []).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                      <span><Link href="/partner/service#claims" className="font-medium text-ink hover:text-brand">{c.reference}</Link> <span className="text-muted">· {c.incident_type}</span></span>
                      <StatusPill meta={CLAIM_STATUS[c.status]} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Complaints">
              {(complaints ?? []).length === 0 ? <Empty>No complaints.</Empty> : (
                <ul className="divide-y divide-line text-sm">
                  {(complaints ?? []).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                      <span><Link href="/partner/service#complaints" className="font-medium text-ink hover:text-brand">{c.reference}</Link> <span className="text-muted">· {c.subject}</span></span>
                      <StatusPill meta={COMPLAINT_STATUS[c.status]} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          <Section title="Recent messages">
            {(messages ?? []).length === 0 ? <Empty>No messages.</Empty> : (
              <ul className="space-y-3 text-sm">
                {(messages ?? []).map((m) => (
                  <li key={m.id} className="rounded-xl bg-mist px-4 py-2.5">
                    <p className="text-xs text-muted">
                      <Link href={`/partner/requests/${m.request_id}#messages`} className="font-medium text-brand">{refOf.get(m.request_id)}</Link> · {humanize(m.sender_party)}{m.internal ? " · internal note" : ""} · {formatDateTime(m.created_at)}
                    </p>
                    <p className="mt-0.5 line-clamp-3 text-ink">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <aside className="space-y-6">
          <Section title="Profile">
            <KV label="Email">{profile.email ?? "—"}</KV>
            <KV label="Phone">{profile.phone ?? "—"}</KV>
            {profile.business_name && <KV label="Business">{profile.business_name}</KV>}
            <KV label="Region">{profile.region ?? "—"}{profile.city ? `, ${profile.city}` : ""}</KV>
            <KV label="KYC"><Pill tone={profile.kyc_status === "verified" ? "ok" : "wait"}>{humanize(profile.kyc_status)}</Pill></KV>
          </Section>
          <Section title="Consents">
            {consents === null ? <p className="text-sm text-muted">Consent records are held by the platform and aren’t available here right now.</p> : consents.length === 0 ? <p className="text-sm text-amber">No consent records found.</p> : (
              <ul className="space-y-1.5 text-sm">
                {consents.map((c) => <li key={c.type} className="flex justify-between"><span>{humanize(c.type)}</span><Pill tone={c.granted ? "ok" : "danger"}>{c.granted ? "Granted" : "Refused"} · {formatDate(c.at)}</Pill></li>)}
              </ul>
            )}
          </Section>
        </aside>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
