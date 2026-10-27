import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GHANA_REGIONS, businessCan, formatGHS, humanize } from "@im/core";
import { Checkbox, EmptyState, Field, Input, Notice, PageHeader, Select, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { listAssets } from "@/server/business";
import { addAssetAction, removeAssetAction, requestPropertyQuoteAction } from "../actions";
import { BusinessNav, businessContext } from "../_lib";

export const metadata: Metadata = { title: "Business property & liability" };

export default function AssetsPage({ searchParams }: PageProps<"/account/business/assets">) {
  return (
    <div className="space-y-8">
      <PageHeader title="Property & liability" description="Premises, stock, equipment and liability exposures. Your broker uses these to arrange property, business interruption and liability cover." />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { property: "Premises / building", stock: "Stock", equipment: "Equipment", liability_exposure: "Liability exposure" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { ctx, accounts, current } = await businessContext("/account/business/assets", sp);
  if (!current) return <EmptyState title="No business account" body="Create a business account first." action={<Link href="/account/business/new" className={buttonClass("primary")}>Create a business account</Link>} />;
  const assets = await listAssets(ctx, current.orgId);
  const manage = businessCan(current.role, "manage");
  const sum = (k: string) => assets.filter((a) => a.kind === k).reduce((s, a) => s + (Number(a.value) || 0), 0);
  return (
    <>
      <BusinessNav current={current} accounts={accounts} active="assets" />
      {assets.length === 0 ? (
        <EmptyState title="No assets yet" body={manage ? "Add your premises, stock and equipment, and the activities that expose you to liability." : "Owners and admins add assets."} />
      ) : (
        <Table>
          <THead><tr><Th>Kind</Th><Th>Description</Th><Th>Address</Th><Th>Value</Th><Th>Cover</Th>{manage && <Th><span className="sr-only">Actions</span></Th>}</tr></THead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <Td>{KIND_LABEL[a.kind] ?? humanize(a.kind)}</Td>
                <Td className="font-medium text-ink">{a.description}</Td>
                <Td className="text-sm text-muted">{a.address ?? "—"}</Td>
                <Td>{a.value != null ? formatGHS(Number(a.value)) : "—"}</Td>
                <Td>{a.policy_id ? "Insured" : "—"}</Td>
                {manage && (
                  <Td>
                    <ActionForm action={removeAssetAction} submitLabel="Remove" variant="ghost" size="sm" inline confirm="Remove this asset?">
                      <input type="hidden" name="assetId" value={a.id} />
                    </ActionForm>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {manage ? (
        <>
          <section aria-labelledby="add-asset" className="rounded-xl border border-line p-5">
            <h2 id="add-asset" className="mb-3 text-lg font-semibold text-ink">Add an asset</h2>
            <ActionForm action={addAssetAction} submitLabel="Add asset" resetOnSuccess>
              <input type="hidden" name="orgId" value={current.orgId} />
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Kind" htmlFor="a-kind">
                  <Select id="a-kind" name="kind" defaultValue="property">
                    {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="Description" htmlFor="a-desc"><Input id="a-desc" name="description" required placeholder="Warehouse, Tema" /></Field>
                <Field label="Address" htmlFor="a-addr"><Input id="a-addr" name="address" /></Field>
                <Field label="Value (GH₵)" htmlFor="a-value"><Input id="a-value" name="value" inputMode="decimal" /></Field>
              </div>
            </ActionForm>
          </section>
          <section aria-labelledby="prop-quote" className="rounded-xl border border-line p-5">
            <h2 id="prop-quote" className="mb-1 text-lg font-semibold text-ink">Get property & stock quotes</h2>
            <p className="mb-4 text-sm text-muted">Prefilled from your assets: premises {formatGHS(sum("property"))}, stock {formatGHS(sum("stock"))}, equipment {formatGHS(sum("equipment"))}.</p>
            <ActionForm action={requestPropertyQuoteAction} submitLabel="Request property quotes">
              <input type="hidden" name="orgId" value={current.orgId} />
              <input type="hidden" name="categorySlug" value="sme-property" />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Region" htmlFor="pq-region">
                  <Select id="pq-region" name="region" defaultValue={current.region ?? ""} required>
                    <option value="">Choose…</option>
                    {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </Field>
                <Field label="Type of business" htmlFor="pq-type"><Input id="pq-type" name="business_type" defaultValue={current.profile.industry ?? ""} required /></Field>
                <Field label="Employees" htmlFor="pq-emp"><Input id="pq-emp" name="employees" inputMode="numeric" defaultValue={current.profile.employees ?? ""} /></Field>
              </div>
              <Checkbox name="business_interruption" label="Include business interruption (lost income after damage)" />
            </ActionForm>
          </section>
          <section aria-labelledby="liab-quote" className="rounded-xl border border-line p-5">
            <h2 id="liab-quote" className="mb-3 text-lg font-semibold text-ink">Get liability quotes</h2>
            <ActionForm action={requestPropertyQuoteAction} submitLabel="Request liability quotes">
              <input type="hidden" name="orgId" value={current.orgId} />
              <input type="hidden" name="categorySlug" value="liability" />
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Cover needed" htmlFor="lq-type">
                  <Select id="lq-type" name="liability_type" defaultValue="public_liability">
                    <option value="public_liability">Public liability</option>
                    <option value="professional_indemnity">Professional indemnity</option>
                    <option value="both">Both</option>
                  </Select>
                </Field>
                <Field label="Profession or trade" htmlFor="lq-prof"><Input id="lq-prof" name="profession" defaultValue={current.profile.industry ?? ""} required /></Field>
                <Field label="Annual turnover (GH₵)" htmlFor="lq-turn"><Input id="lq-turn" name="annual_turnover" inputMode="decimal" required /></Field>
                <Field label="Limit of indemnity (GH₵)" htmlFor="lq-limit"><Input id="lq-limit" name="limit_of_indemnity" inputMode="decimal" required placeholder="500000" /></Field>
              </div>
              <Checkbox name="prior_claims" label="We've had liability claims in the last 5 years" />
            </ActionForm>
          </section>
        </>
      ) : (
        <Notice tone="info">Your role ({current.role}) can view assets. Owners and admins add assets and request quotes.</Notice>
      )}
    </>
  );
}
