"use client";
import { useActionState, useMemo, useState } from "react";
import { Button, Checkbox, Field, Input, Notice, Pill, Select, Table, Td, Th, THead } from "@im/ui";
import { BULK_PRODUCT_ACTIONS, bulkPlanSummary, planBulkStatus, productStatusLabel, type BulkProductAction, type BulkStatusProduct } from "@im/core";
import { FormMessage, SubmitButton, type FormAction } from "./action-form";

export interface BulkProduct extends BulkStatusProduct {
  code: string;
  categoryName: string;
}

const STATUS_TONE: Record<string, "ok" | "wait" | "danger" | "neutral"> = { approved: "ok", pending_approval: "wait", suspended: "wait", retired: "danger", draft: "neutral" };

/**
 * Pick products → choose pause / republish / withdraw → preview (who changes, who is skipped and why,
 * mirrored from the database rules) → reason → confirm. The server action calls `bulk_set_product_status`.
 */
export function BulkStatusForm({ action, products }: { action: FormAction; products: BulkProduct[] }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkProductAction>("pause");
  const [filter, setFilter] = useState("");
  const [step, setStep] = useState<"pick" | "confirm">("pick");

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? products.filter((p) => `${p.name} ${p.code} ${p.categoryName}`.toLowerCase().includes(q)) : products;
  }, [products, filter]);
  const chosen = products.filter((p) => selected.has(p.id));
  const plan = useMemo(() => planBulkStatus(chosen, bulkAction), [chosen, bulkAction]);
  const meta = BULK_PRODUCT_ACTIONS.find((a) => a.value === bulkAction)!;

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAll = (ids: string[]) =>
    setSelected((s) => {
      const n = new Set(s);
      const all = ids.every((id) => n.has(id));
      for (const id of ids) {
        if (all) n.delete(id);
        else n.add(id);
      }
      return n;
    });

  if (state.ok) {
    return (
      <div className="space-y-3">
        <FormMessage state={state} />
        <Button type="button" variant="secondary" size="sm" onClick={() => { setSelected(new Set()); setStep("pick"); window.location.reload(); }}>Start another update</Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" onSubmit={(e) => { if (step !== "confirm") e.preventDefault(); }}>
      <input type="hidden" name="action" value={bulkAction} />
      {plan.eligible.map((p) => <input key={p.id} type="hidden" name="ids" value={p.id} />)}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What to do" htmlFor="bulk-action">
          <Select id="bulk-action" value={bulkAction} onChange={(e) => { setBulkAction(e.currentTarget.value as BulkProductAction); setStep("pick"); }} className="h-10 text-sm">
            {BULK_PRODUCT_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </Select>
        </Field>
        <Field label="Find products" htmlFor="bulk-filter" className="sm:col-span-2">
          <Input id="bulk-filter" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} placeholder="Name, code or category" className="h-10 text-sm" />
        </Field>
      </div>
      <p className="text-sm text-muted">{meta.description}</p>

      <div className="overflow-x-auto rounded-card border border-line">
        <Table className="rounded-none border-0">
          <THead>
            <tr>
              <Th>
                <label className="inline-flex min-h-10 items-center gap-2 text-xs font-medium">
                  <input type="checkbox" className="size-4" aria-label="Select all shown" checked={visible.length > 0 && visible.every((p) => selected.has(p.id))} onChange={() => selectAll(visible.map((p) => p.id))} />
                  All shown
                </label>
              </Th>
              <Th>Product</Th><Th>Category</Th><Th>Status</Th><Th>After</Th>
            </tr>
          </THead>
          <tbody>
            {visible.map((p) => {
              const skip = plan.skipped.find((s) => s.id === p.id);
              const picked = selected.has(p.id);
              return (
                <tr key={p.id} className={picked ? "bg-mint/40" : undefined}>
                  <Td>
                    <label className="flex min-h-10 cursor-pointer items-center">
                      <input type="checkbox" className="size-4" checked={picked} onChange={() => { toggle(p.id); setStep("pick"); }} aria-label={`Select ${p.name}`} />
                    </label>
                  </Td>
                  <Td><span className="font-medium text-ink">{p.name}</span><span className="block text-xs text-muted">{p.code}</span></Td>
                  <Td className="text-sm">{p.categoryName}</Td>
                  <Td><Pill tone={STATUS_TONE[p.status] ?? "neutral"}>{productStatusLabel(p.status)}</Pill></Td>
                  <Td className="text-sm">
                    {!picked ? <span className="text-subtle">—</span> : skip ? <span className="text-amber">Skipped: {skip.reason}</span> : <Pill tone={meta.tone === "ok" ? "ok" : meta.tone === "wait" ? "wait" : "danger"}>{productStatusLabel(plan.target)}</Pill>}
                  </Td>
                </tr>
              );
            })}
            {!visible.length && <tr><Td colSpan={5} className="py-6 text-center text-sm text-muted">No products match.</Td></tr>}
          </tbody>
        </Table>
      </div>

      {chosen.length > 0 && (
        <Notice tone={plan.eligible.length ? (meta.tone === "danger" ? "danger" : "info") : "wait"} title={bulkPlanSummary(plan)}>
          {plan.eligible.length ? (
            <p>{plan.eligible.map((p) => p.name).join(", ")} → <strong>{productStatusLabel(plan.target)}</strong>.</p>
          ) : (
            <p>None of the chosen products can be {meta.label.toLowerCase()}d right now.</p>
          )}
          {plan.skipped.length > 0 && <p className="mt-1">Skipped: {plan.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.</p>}
        </Notice>
      )}

      {step === "pick" ? (
        <Button type="button" size="sm" disabled={plan.eligible.length === 0} onClick={() => setStep("confirm")}>
          Review {plan.eligible.length ? `${plan.eligible.length} change${plan.eligible.length === 1 ? "" : "s"}` : "changes"}
        </Button>
      ) : (
        <div className="space-y-3 rounded-card border border-line bg-mist/50 p-4">
          <p className="text-sm font-semibold text-ink">Confirm: {bulkPlanSummary(plan)}</p>
          <p className="text-sm text-muted">{meta.description} The reason below is kept in each product&apos;s change history and the organisation&apos;s activity log.</p>
          <Field label="Reason" htmlFor="bulk-reason" hint="At least 5 characters, e.g. “Rates under review for Q1”.">
            <Input id="bulk-reason" name="reason" required minLength={5} maxLength={500} className="h-10 text-sm" />
          </Field>
          <Checkbox name="confirm" required label={`I understand ${plan.eligible.length} product${plan.eligible.length === 1 ? "" : "s"} will be ${productStatusLabel(plan.target).toLowerCase()}`} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton size="sm" variant={meta.tone === "danger" ? "danger" : "primary"} pendingLabel="Updating…">{bulkPlanSummary(plan)}</SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep("pick")}>Back</Button>
          </div>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}
