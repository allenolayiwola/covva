"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Json } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { monthRange, type InvoiceLine } from "@/lib/billing";

const round2 = (n: number) => Math.round(n * 100) / 100;

const Generate = z.object({
  orgId: z.string().uuid({ error: "Choose an organisation" }),
  period: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month"),
});

/**
 * Generate a DRAFT invoice for an organisation and month:
 *  - plan monthly fee (zero while trialing)
 *  - request overage: (requests processed − included) × per_request_fee
 *  - active policies × per_active_policy_fee (usage_events `policy_active`, or a
 *    live count of the org's active policies when no events were recorded)
 *  - tax at platform_settings.invoice_tax_rate (default 0)
 */
export async function generateInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = Generate.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { orgId, period } = parsed.data;
  const { supabase } = auth;
  const { start, end, endExclusive } = monthRange(period);

  const [{ data: org }, { data: sub }, { data: existing }, { data: usage }, { data: taxSetting }] = await Promise.all([
    supabase.from("organizations").select("id, slug, type, name").eq("id", orgId).single(),
    supabase
      .from("subscriptions")
      .select("status, plan:plans(name, code, currency, monthly_fee, included_requests, per_request_fee, per_active_policy_fee)")
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .maybeSingle(),
    supabase.from("invoices").select("id, number").eq("org_id", orgId).eq("period_start", start).neq("status", "void").maybeSingle(),
    supabase.from("usage_events").select("metric, quantity").eq("org_id", orgId).gte("occurred_at", `${start}T00:00:00Z`).lt("occurred_at", `${endExclusive}T00:00:00Z`).limit(50000),
    supabase.from("platform_settings").select("value").eq("key", "invoice_tax_rate").maybeSingle(),
  ]);
  if (!org) return fail("Organisation not found.");
  if (existing) return fail(`An invoice already exists for this period (${existing.number}). Void it first to regenerate.`);
  const plan = sub?.plan as unknown as { name: string; code: string; currency: string; monthly_fee: number; included_requests: number | null; per_request_fee: number; per_active_policy_fee: number } | null;
  if (!sub || !plan) return fail("This organisation has no live subscription. Add one from its Subscription tab.");

  const sum = (metric: string) => (usage ?? []).filter((u) => u.metric === metric).reduce((t, u) => t + Number(u.quantity), 0);
  const requests = sum("request_processed");
  let activePolicies = sum("policy_active");
  let policyNote = "usage events";
  if (!activePolicies && Number(plan.per_active_policy_fee) > 0) {
    const col = org.type === "insurer" ? "insurer_org_id" : "broker_org_id";
    const { count } = await supabase.from("policies").select("id", { count: "exact", head: true }).eq(col, org.id).eq("status", "active");
    activePolicies = count ?? 0;
    policyNote = "active policies at generation";
  }

  const lines: InvoiceLine[] = [];
  const trial = sub.status === "trialing";
  lines.push({ code: "subscription", description: `${plan.name} — monthly subscription${trial ? " (trial — no charge)" : ""}`, quantity: 1, unit_price: trial ? 0 : Number(plan.monthly_fee), amount: trial ? 0 : Number(plan.monthly_fee) });
  const included = plan.included_requests;
  const over = included === null ? 0 : Math.max(0, requests - included);
  lines.push({
    code: "requests",
    description: `Requests processed: ${requests}${included === null ? " (unlimited)" : ` (${included} included, ${over} over)`}`,
    quantity: over,
    unit_price: trial ? 0 : Number(plan.per_request_fee),
    amount: trial ? 0 : round2(over * Number(plan.per_request_fee)),
  });
  if (Number(plan.per_active_policy_fee) > 0) {
    lines.push({
      code: "active_policies",
      description: `Active policies serviced (${policyNote})`,
      quantity: activePolicies,
      unit_price: trial ? 0 : Number(plan.per_active_policy_fee),
      amount: trial ? 0 : round2(activePolicies * Number(plan.per_active_policy_fee)),
    });
  }

  const subtotal = round2(lines.reduce((t, l) => t + l.amount, 0));
  const rate = typeof taxSetting?.value === "number" ? taxSetting.value : 0;
  const tax = round2(subtotal * rate);
  const number = `INV-${period.replace("-", "")}-${org.slug.toUpperCase().slice(0, 12)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const { data: inv, error } = await supabase
    .from("invoices")
    .insert({ number, org_id: org.id, period_start: start, period_end: end, currency: plan.currency ?? "GHS", subtotal, tax, total: round2(subtotal + tax), lines: lines as unknown as Json, status: "draft" })
    .select("id")
    .single();
  if (error) return fail(dbMessage(error));
  redirect(`/invoices/${inv.id}`);
}

const Transition = z.object({
  invoiceId: z.string().uuid(),
  to: z.enum(["issued", "paid", "void", "overdue"]),
  reason: z.string().trim().max(1000).optional(),
  dueDays: z.coerce.number().int().min(0).max(120).optional(),
});

/** Invoice lifecycle: draft → issued → paid / overdue; draft or issued → void (with reason). Never deleted. */
export async function transitionInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = Transition.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { invoiceId, to, reason, dueDays } = parsed.data;
  const { data: inv } = await auth.supabase.from("invoices").select("status, lines").eq("id", invoiceId).single();
  if (!inv) return fail("Invoice not found.");

  const allowed: Record<string, string[]> = { issued: ["draft"], paid: ["issued", "overdue"], overdue: ["issued"], void: ["draft", "issued", "overdue"] };
  if (!allowed[to]!.includes(inv.status)) return fail(`Can't move an invoice from ${inv.status} to ${to}.`);
  if (to === "void" && (!reason || reason.length < 5)) return fail("Give a reason for voiding (at least 5 characters).");

  const now = new Date();
  const patch =
    to === "issued"
      ? { status: to, issued_at: now.toISOString(), due_on: new Date(now.getTime() + (dueDays ?? 14) * 86_400_000).toISOString().slice(0, 10) }
      : to === "paid"
        ? { status: to, paid_at: now.toISOString() }
        : to === "void"
          ? { status: to, lines: [...((inv.lines as unknown as InvoiceLine[]) ?? []), { code: "void_note", description: `Voided: ${reason}`, quantity: 0, unit_price: 0, amount: 0 }] as unknown as Json }
          : { status: to };
  const { error } = await auth.supabase.from("invoices").update(patch).eq("id", invoiceId);
  if (error) return fail(dbMessage(error));
  return done(`Invoice ${to === "issued" ? "issued" : to === "paid" ? "marked paid" : to === "void" ? "voided" : "marked overdue"}.`);
}
