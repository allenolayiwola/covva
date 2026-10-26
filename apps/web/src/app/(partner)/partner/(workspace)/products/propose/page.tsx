import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, Field, Input, Notice, PageHeader, Pill, Select, Table, Td, Th, THead, Textarea } from "@im/ui";
import { formatDateTime, humanize } from "@im/core";
import { requireKind } from "../../../_lib/context";
import { getCategoryMap } from "../../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { CsvTextarea } from "@/components/partner/csv-textarea";
import { PageSkeleton, Section } from "@/components/partner/ui";
import { proposeRateTable } from "../catalogue-actions";

export const metadata: Metadata = { title: "Propose a rate table" };

export default function ProposePage() {
  return (
    <>
      <PageHeader
        title="Submit a rate table for an insurer not on Covva"
        description="Know an insurer's rates that customers should be able to compare? Submit them here. The table stays pending until the insurer confirms and Covva activates it, and our partnerships team follows up with the insurer."
      />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Propose />
      </Suspense>
    </>
  );
}

const tone = (s: string) => (s === "approved" ? "ok" : s === "pending_review" ? "wait" : s === "rejected" ? "danger" : "neutral") as "ok" | "wait" | "danger" | "neutral";

async function Propose() {
  const ctx = await requireKind("broker");
  const [{ data: mine }, cats] = await Promise.all([
    ctx.supabase.from("rate_tables").select("id, name, proposed_insurer_name, status, factor_keys, created_at, review_notes").eq("submitted_by_org_id", ctx.orgId).is("product_version_id", null).order("created_at", { ascending: false }),
    getCategoryMap(),
  ]);

  return (
    <>
      <Section title="Your proposals">
        {(mine ?? []).length === 0 ? <p className="text-sm text-muted">Nothing submitted yet.</p> : (
          <Table>
            <THead><tr><Th>Insurer</Th><Th>Table</Th><Th>Factors</Th><Th>Status</Th><Th>Submitted</Th></tr></THead>
            <tbody>
              {(mine ?? []).map((t) => (
                <tr key={t.id}>
                  <Td className="font-semibold text-ink">{t.proposed_insurer_name}</Td>
                  <Td>{t.name}</Td>
                  <Td className="text-xs text-muted">{(t.factor_keys ?? []).join(", ")}</Td>
                  <Td><Pill tone={tone(t.status)}>{humanize(t.status)}</Pill></Td>
                  <Td className="text-xs text-muted">{formatDateTime(t.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section className="mt-6" title="New proposal" description="Products always belong to insurers: your table is a suggestion that the insurer confirms before it is used for quotes.">
        <Notice tone="info" className="mb-4">Only submit rates you are authorised to share. Covva will contact the insurer named below.</Notice>
        <ActionForm action={proposeRateTable} submitLabel="Submit proposal" className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
          <Field label="Insurer name" htmlFor="pr-ins"><Input id="pr-ins" name="insurerName" required placeholder="e.g. Savannah Assurance" className="h-10 text-sm" /></Field>
          <Field label="Product / table name" htmlFor="pr-name"><Input id="pr-name" name="name" required placeholder="Private motor comprehensive 2027" className="h-10 text-sm" /></Field>
          <Field label="Category" htmlFor="pr-cat">
            <Select id="pr-cat" name="categorySlug" className="h-10 text-sm">
              <option value="">Choose…</option>
              {[...cats.values()].map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Factor keys" htmlFor="pr-keys" hint="Comma-separated, e.g. vehicle_use, vehicle_age_band, region"><Input id="pr-keys" name="factorKeys" required defaultValue="vehicle_use, vehicle_age_band, region" className="h-10 text-sm" /></Field>
          <Field label="Insurer contact name" htmlFor="pr-cn"><Input id="pr-cn" name="contactName" className="h-10 text-sm" /></Field>
          <Field label="Insurer contact email" htmlFor="pr-ce"><Input id="pr-ce" name="contactEmail" type="email" className="h-10 text-sm" /></Field>
          <Field label="Insurer contact phone" htmlFor="pr-cp"><Input id="pr-cp" name="contactPhone" className="h-10 text-sm" /></Field>
          <Field label="Notes for the partnerships team" htmlFor="pr-notes" className="sm:col-span-2"><Textarea id="pr-notes" name="notes" rows={3} placeholder="Where the rates come from, effective dates, who to speak to." /></Field>
          <div className="sm:col-span-2">
            <CsvTextarea />
          </div>
        </ActionForm>
      </Section>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
