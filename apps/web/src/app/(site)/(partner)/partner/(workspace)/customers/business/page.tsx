import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SCHEME_STATUS, formatDate, formatGHS, humanize, type SchemeStatus } from "@im/core";
import { DemoBadge, EmptyState, PageHeader, Pill, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { requireKind } from "../../../_lib/context";
import { PageSkeleton, Section } from "@/components/partner/ui";
import { SchemeCensus, SchemeMemberTable } from "@/components/partner/scheme-members";
import { partnerBusinessClients } from "@/server/business";

export const metadata: Metadata = { title: "Business clients" };

export default function BusinessClientsPage() {
  return (
    <>
      <PageHeader
        title="Business clients"
        description="Businesses whose group schemes, fleets or commercial requests you service: census and member lists for underwriting, vehicles and open requests."
        actions={<Link href="/partner/customers" className={buttonClass("outline", "sm")}>All customers</Link>}
      />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Clients />
      </Suspense>
    </>
  );
}

async function Clients() {
  const ctx = await requireKind("broker");
  const clients = await partnerBusinessClients(ctx.supabase, ctx.orgId);
  if (!clients.length) {
    return <EmptyState title="No business clients yet" body="Group, fleet and commercial requests from business accounts appear here once you accept them." />;
  }
  return (
    <div className="space-y-6">
      {clients.map((c) => (
        <Section key={c.orgId} title={c.name} description={[c.industry, `${c.schemes.length} scheme${c.schemes.length === 1 ? "" : "s"}`, `${c.fleet.length} vehicle${c.fleet.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}>
          <div className="space-y-5">
            {c.schemes.map((s) => {
              const meta = SCHEME_STATUS[s.status as SchemeStatus] ?? SCHEME_STATUS.draft;
              return (
                <div key={s.id} className="rounded-xl border border-line p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{s.name} <span className="font-normal text-muted">· {s.categoryName} · {s.reference}{s.renewal_date ? ` · renews ${formatDate(s.renewal_date)}` : ""}</span></p>
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                  </div>
                  <SchemeCensus census={s.census} />
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-brand">Member list ({s.members.length})</summary>
                    <div className="mt-3"><SchemeMemberTable members={s.members} /></div>
                  </details>
                </div>
              );
            })}
            {c.fleet.length > 0 && (
              <details className="rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-semibold text-brand">Fleet ({c.fleet.length} vehicles · {formatGHS(c.fleet.reduce((n, v) => n + (Number(v.value) || 0), 0))})</summary>
                <div className="mt-3">
                  <Table>
                    <THead><tr><Th>Registration</Th><Th>Vehicle</Th><Th>Year</Th><Th>Value</Th><Th>Use</Th><Th>Driver</Th></tr></THead>
                    <tbody>
                      {c.fleet.map((v) => (
                        <tr key={v.id}>
                          <Td className="font-medium text-ink">{v.registration}</Td>
                          <Td>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</Td>
                          <Td>{v.year ?? "—"}</Td>
                          <Td>{v.value != null ? formatGHS(Number(v.value)) : "—"}</Td>
                          <Td>{humanize(v.use)}</Td>
                          <Td>{v.driver_name ?? "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </details>
            )}
            {c.requests.length > 0 && (
              <ul className="space-y-1 text-sm">
                {c.requests.map((r) => (
                  <li key={r.id}><Link href={`/partner/requests/${r.id}`} className="font-medium text-brand hover:underline">{r.reference}</Link> · {r.title ?? "Request"} · {humanize(r.status)} · {formatDate(r.created_at)}</li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      ))}
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </div>
  );
}
