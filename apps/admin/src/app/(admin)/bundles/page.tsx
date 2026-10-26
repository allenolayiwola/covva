import { Suspense } from "react";
import { parseBundleItems } from "@im/core";
import { Field, Input, PageHeader, Pill, Select, Table, THead, Th, Td, Textarea } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, sp, type SearchParams } from "@/lib/query";
import { formatDate } from "@/lib/format";
import { LoadingBlock, Panel } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { saveBundle } from "./actions";

export default function BundlesPage({ searchParams }: PageProps<"/bundles">) {
  return (
    <>
      <PageHeader title="Product bundles" description="Curated packs such as the diaspora “Parents' Care Pack”. A bundle creates one request per item for the customer; each item is quoted by its insurer and the discount is confirmed on the binding quote. Published bundles get a marketing page at /bundles/<slug>." />
      <Suspense fallback={<LoadingBlock label="Loading bundles…" />}>
        <Bundles searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Bundles({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const canEdit = can(staff.roles, "catalogue");
  const editId = sp(params, "edit");
  const [{ data: bundles }, { data: categories }] = await Promise.all([
    supabase.from("product_bundles").select("*").order("name"),
    supabase.from("product_categories").select("slug, name").order("name"),
  ]);
  const editing = isUuid(editId) ? (bundles ?? []).find((b) => b.id === editId) : undefined;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title={editing ? `Edit “${editing.name}”` : "New bundle"} description={`Items are JSON: [{ "category_slug": "health", "required": true }]. Category slugs: ${(categories ?? []).map((c) => c.slug).join(", ")}.`}>
        <ActionForm key={editing?.id ?? "new"} action={saveBundle} submitLabel={editing ? "Save changes" : "Create bundle"} readOnly={!canEdit}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Slug" htmlFor="b-slug"><Input id="b-slug" name="slug" required defaultValue={editing?.slug ?? ""} placeholder="parents-care-pack" /></Field>
            <Field label="Name" htmlFor="b-name"><Input id="b-name" name="name" required defaultValue={editing?.name ?? ""} /></Field>
            <Field label="Audience" htmlFor="b-aud">
              <Select id="b-aud" name="audience" defaultValue={editing?.audience ?? "diaspora"}>
                <option value="diaspora">Diaspora</option>
                <option value="sme">SME</option>
                <option value="individual">Individual</option>
              </Select>
            </Field>
            <Field label="Status" htmlFor="b-status">
              <Select id="b-status" name="status" defaultValue={editing?.status ?? "draft"}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </Select>
            </Field>
            <Field label="Indicative discount %" htmlFor="b-disc" hint="Applied to the bundle estimate only; insurers confirm it on the binding quotes."><Input id="b-disc" name="discountPct" type="number" step="0.5" min={0} max={100} defaultValue={Number(editing?.discount_pct ?? 0)} /></Field>
            <Field label="Description" htmlFor="b-desc" className="sm:col-span-2"><Textarea id="b-desc" name="description" rows={3} defaultValue={editing?.description ?? ""} /></Field>
            <Field label="Items (JSON)" htmlFor="b-items" className="sm:col-span-2"><Textarea id="b-items" name="items" rows={5} required defaultValue={JSON.stringify(editing?.items ?? [{ category_slug: "life-funeral", required: true }, { category_slug: "health", required: false }], null, 2)} className="font-mono text-xs" /></Field>
          </div>
        </ActionForm>
      </Panel>
      <Panel title="Bundles" description={`${(bundles ?? []).length} bundle${(bundles ?? []).length === 1 ? "" : "s"}`}>
        <Table>
          <THead><tr><Th>Bundle</Th><Th>Items</Th><Th>Discount</Th><Th>Status</Th><Th>Updated</Th><Th /></tr></THead>
          <tbody>
            {(bundles ?? []).map((b) => (
              <tr key={b.id}>
                <Td>
                  <p className="font-medium text-ink">{b.name}</p>
                  <p className="text-xs text-muted">{b.audience} · <a href={`${siteUrl}/bundles/${b.slug}`} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">/bundles/{b.slug}</a></p>
                </Td>
                <Td className="text-xs">{parseBundleItems(b.items).map((i) => `${i.category_slug}${i.required ? "*" : ""}`).join(", ")}</Td>
                <Td className="tabular-nums">{Number(b.discount_pct)}%</Td>
                <Td><Pill tone={b.status === "published" ? "ok" : "wait"}>{b.status}</Pill></Td>
                <Td className="text-xs">{formatDate(b.updated_at)}</Td>
                <Td><a href={`/bundles?edit=${b.id}`} className="text-sm text-brand hover:underline">Edit</a></Td>
              </tr>
            ))}
            {!bundles?.length && <tr><Td colSpan={6} className="py-8 text-center text-muted">No bundles yet.</Td></tr>}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-subtle">* required item.</p>
      </Panel>
    </div>
  );
}
