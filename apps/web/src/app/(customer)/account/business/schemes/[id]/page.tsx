import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AGE_BANDS, SCHEME_STATUS, businessCan, formatDate, formatGHS, humanize, type SchemeStatus } from "@im/core";
import { Card, DefinitionList, Field, Notice, PageHeader, Pill, Table, Td, Textarea, Th, THead, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { BusinessRuleError } from "@/server/requests";
import { schemeDetail } from "@/server/business";
import { requestGroupQuoteAction } from "../../actions";
import { BusinessNav, businessContext, withOrg } from "../../_lib";
import { UUID_RE, signUrls } from "../../../_lib/data";

export const metadata: Metadata = { title: "Group scheme" };

export default function SchemePage({ params, searchParams }: PageProps<"/account/business/schemes/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={5} />}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Counts({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).filter(([, n]) => n > 0);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {entries.length === 0 ? <p className="text-sm text-muted">—</p> : (
        <ul className="space-y-1 text-sm">
          {entries.map(([k, n]) => <li key={k} className="flex justify-between gap-3"><span className="text-muted">{humanize(k)}</span><span className="tabular-nums font-medium text-ink">{n}</span></li>)}
        </ul>
      )}
    </div>
  );
}

async function Body({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = await searchParams;
  const { ctx, supabase, accounts } = await businessContext(`/account/business/schemes/${id}`, sp);
  let detail;
  try {
    detail = await schemeDetail(ctx, id);
  } catch (err) {
    if (err instanceof BusinessRuleError) notFound();
    throw err;
  }
  const current = accounts.find((a) => a.orgId === detail.scheme.business_org_id);
  if (!current) notFound();
  const { scheme, census } = detail;
  const meta = SCHEME_STATUS[scheme.status as SchemeStatus] ?? SCHEME_STATUS.draft;
  const manage = businessCan(current.role, "manage");
  const openRequest = detail.request && !["completed", "cancelled", "closed_no_cover"].includes(detail.request.status);
  const urls = await signUrls(supabase, detail.documents.map((d) => d.storage_path ?? "").filter(Boolean), true);
  const ageBands = Object.fromEntries([...AGE_BANDS, "unknown"].map((b) => [b, census.byAgeBand[b as keyof typeof census.byAgeBand] ?? 0]));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`${detail.categoryName} · ${scheme.reference}`}
        title={scheme.name}
        description="Census, quotes, broker of record, insurer and documents for this scheme."
        actions={<><Pill tone={meta.tone}>{meta.label}</Pill><Link href={withOrg("/account/business/members", current.orgId) + `&scheme=${scheme.id}`} className={buttonClass("outline", "sm")}>Members</Link></>}
      />
      <BusinessNav current={current} accounts={accounts} active="scheme" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="space-y-5 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink">Census summary</h2>
            <p className="text-sm text-muted">As of {formatDate(census.asOf)} · shared with insurers as counts only</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-mist p-3"><p className="text-2xl font-bold text-ink">{census.lives}</p><p className="text-xs text-muted">Lives</p></div>
            <div className="rounded-xl bg-mist p-3"><p className="text-2xl font-bold text-ink">{census.employees}</p><p className="text-xs text-muted">Employees</p></div>
            <div className="rounded-xl bg-mist p-3"><p className="text-2xl font-bold text-ink">{census.dependants}</p><p className="text-xs text-muted">Dependants</p></div>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Counts title="Age bands" data={ageBands} />
            <Counts title="Cover tiers" data={census.byTier} />
            <Counts title="Relationship" data={census.byRelationship} />
          </div>
          <p className="text-xs text-muted">
            Average age {census.averageAge ?? "—"} (employees {census.averageEmployeeAge ?? "—"}) · oldest {census.oldestAge ?? "—"}
            {census.missingDateOfBirth ? ` · ${census.missingDateOfBirth} without a date of birth — insurers will ask for them` : ""}
          </p>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-lg font-semibold text-ink">Placement</h2>
            <DefinitionList
              items={[
                { label: "Broker of record", value: detail.broker ? `${detail.broker.name}${detail.broker.nic_licence_number ? ` · NIC ${detail.broker.nic_licence_number}` : ""}` : "Assigned when a licensed broker accepts your request" },
                { label: "Insurer", value: detail.insurer?.name ?? "Chosen when you accept a quote" },
                { label: "Master policy", value: detail.policy ? `${detail.policy.policy_number ?? detail.policy.internal_reference} · ${humanize(detail.policy.status)}` : "—" },
                { label: "Cover", value: detail.policy?.cover_start ? `${formatDate(detail.policy.cover_start)} – ${formatDate(detail.policy.cover_end)}` : "—" },
                { label: "Premium", value: detail.policy?.premium != null ? `${formatGHS(detail.policy.premium, { decimals: true })} per ${detail.policy.billing_period}` : "—" },
                { label: "Renewal", value: scheme.renewal_date ? formatDate(scheme.renewal_date) : "—" },
              ]}
            />
            {detail.request && (
              <p className="mt-3 text-sm">
                Request <Link href={`/account/requests/${detail.request.id}`} className="font-semibold text-brand hover:underline">{detail.request.reference}</Link> · {humanize(detail.request.status)}
                {detail.request.next_step ? <span className="block text-muted">{detail.request.next_step}</span> : null}
              </p>
            )}
          </Card>

          {manage && !openRequest && scheme.status !== "cancelled" && (
            <Card className="p-5">
              <h2 className="mb-1 text-lg font-semibold text-ink">{scheme.policy_id ? "Renewal quotes" : "Request quotes"}</h2>
              <p className="mb-3 text-sm text-muted">We send the census summary (never names or contact details) to a licensed broker, who approaches insurers for you.</p>
              {census.lives === 0 ? (
                <Notice tone="wait">Add members first.</Notice>
              ) : (
                <ActionForm action={requestGroupQuoteAction} submitLabel={`Request quotes for ${census.lives} lives`}>
                  <input type="hidden" name="schemeId" value={scheme.id} />
                  <Field label="Notes for the broker (optional)" htmlFor="gq-notes">
                    <Textarea id="gq-notes" name="notes" rows={2} maxLength={1000} placeholder="Current insurer, benefits you want, budget per member…" />
                  </Field>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>

      <section aria-labelledby="docs-title">
        <h2 id="docs-title" className="mb-3 text-lg font-semibold text-ink">Documents</h2>
        {detail.documents.length === 0 ? (
          <p className="text-sm text-muted">The policy schedule, certificate and member cards appear here once the insurer issues the policy.</p>
        ) : (
          <Table>
            <THead><tr><Th>Document</Th><Th>Kind</Th><Th>Added</Th></tr></THead>
            <tbody>
              {detail.documents.map((d) => (
                <tr key={d.id}>
                  <Td>{d.storage_path && urls[d.storage_path] ? <a href={urls[d.storage_path]} className="font-medium text-brand hover:underline">{d.file_name ?? "Download"}</a> : d.file_name ?? "Document"}</Td>
                  <Td>{humanize(d.kind)}</Td>
                  <Td>{formatDate(d.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
