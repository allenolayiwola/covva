import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, EmptyState, Field, Input, Notice, PageHeader, Pill, Select, Table, Td, Th, THead } from "@im/ui";
import { formatDateTime } from "@im/core";
import { can, requireKind, ROLES } from "../../../_lib/context";
import { getCategoryMap } from "../../../_lib/data";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton, Section } from "@/components/partner/ui";
import { createNumberBlock, deactivateNumberBlock } from "./actions";

export const metadata: Metadata = { title: "Policy number blocks" };

export default function NumberBlocksPage() {
  return (
    <>
      <PageHeader title="Policy number blocks" description="Ranges of policy numbers you allocate to Covva for delegated (Level 2) issuance. Numbers are issued sequentially and never reused; when a block runs out, new orders are referred to your queue until you add another." />
      <Suspense fallback={<PageSkeleton stats={0} rows={3} />}>
        <Blocks />
      </Suspense>
    </>
  );
}

async function Blocks() {
  const ctx = await requireKind("insurer");
  const [{ data: blocks }, cats] = await Promise.all([ctx.supabase.from("policy_number_blocks").select("*").eq("insurer_org_id", ctx.orgId).order("active", { ascending: false }).order("created_at", { ascending: false }), getCategoryMap()]);
  const canManage = can(ctx, ROLES.orgAdmin);
  const rows = blocks ?? [];
  const example = (prefix: string, n: number, pad: number) => `${prefix}${String(n).padStart(pad, "0")}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted"><Link href="/partner/issuance?tab=delegated" className="hover:text-brand">Issuance</Link> / Number blocks</nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Your blocks" description="One active block per line (plus an optional catch-all for every line).">
          {rows.length === 0 ? <EmptyState title="No number blocks yet" body="Add a block so Covva can issue instantly on your behalf for products that fit your rules." /> : (
            <Table>
              <THead><tr><Th>Line</Th><Th>Prefix</Th><Th>Next</Th><Th>Last</Th><Th>Remaining</Th><Th>Status</Th><Th>Added</Th>{canManage && <Th />}</tr></THead>
              <tbody>
                {rows.map((b) => {
                  const remaining = Math.max(0, Number(b.last_number) - Number(b.next_number) + 1);
                  return (
                    <tr key={b.id}>
                      <Td>{b.category_id ? cats.get(b.category_id)?.name ?? "Line" : <span className="text-muted">All lines</span>}</Td>
                      <Td className="font-mono text-xs">{b.prefix || "—"}</Td>
                      <Td className="font-mono text-xs">{example(b.prefix, Number(b.next_number), b.pad)}</Td>
                      <Td className="font-mono text-xs">{example(b.prefix, Number(b.last_number), b.pad)}</Td>
                      <Td className="tabular-nums">{remaining === 0 ? <Pill tone="danger">Exhausted</Pill> : remaining < 50 ? <Pill tone="wait">{remaining} left</Pill> : remaining}</Td>
                      <Td>{b.active ? <Pill tone="ok">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</Td>
                      <Td className="text-xs text-muted">{formatDateTime(b.created_at)}</Td>
                      {canManage && (
                        <Td>
                          {b.active && (
                            <ActionForm action={deactivateNumberBlock} submitLabel="Deactivate" variant="outline" confirm="Deactivate this block? Delegated issuance for this line stops until another active block exists.">
                              <input type="hidden" name="blockId" value={b.id} />
                            </ActionForm>
                          )}
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Section>
        <div className="space-y-4">
          <Section title="Add a block" description="Owners and admins only.">
            {!canManage ? <p className="text-sm text-muted">Ask an organisation owner or admin to add number blocks.</p> : (
              <ActionForm action={createNumberBlock} submitLabel="Add block" className="space-y-3">
                <Field label="Line" htmlFor="nb-cat">
                  <Select id="nb-cat" name="categoryId" defaultValue="">
                    <option value="">All lines (catch-all)</option>
                    {[...cats.values()].map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Prefix" htmlFor="nb-prefix" hint="e.g. CG/MTR/2026/">
                  <Input id="nb-prefix" name="prefix" maxLength={40} className="h-10 text-sm" placeholder="CG/MTR/2026/" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First number" htmlFor="nb-first"><Input id="nb-first" name="firstNumber" type="number" min={0} required defaultValue={1} className="h-10 text-sm" /></Field>
                  <Field label="Last number" htmlFor="nb-last"><Input id="nb-last" name="lastNumber" type="number" min={0} required defaultValue={1000} className="h-10 text-sm" /></Field>
                </div>
                <Field label="Zero padding (digits)" htmlFor="nb-pad"><Input id="nb-pad" name="pad" type="number" min={0} max={12} defaultValue={6} className="h-10 text-sm" /></Field>
              </ActionForm>
            )}
          </Section>
          <Notice tone="info" title="How numbers are used">Each delegated policy takes the next number from the block for its line (or the catch-all). Allocation is row-locked, so two orders never receive the same number. Numbers you issue manually in the insurer queue are not taken from a block.</Notice>
        </div>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
