"use server";
import { z } from "zod";
import { ACCOUNTING_EXPORT_KINDS, monthPeriod } from "@im/core";
import { runAdminExport } from "@/lib/accounting";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const TaxRule = z.object({
  ruleId: z.string().uuid(),
  rate: z.string().trim().optional(),
  inclusive: z.string().optional(),
  applies_to: z.enum(["platform_fee", "broker_commission", "premium", "subscription"]),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  status: z.enum(["needs_confirmation", "active", "retired"]),
  description: z.string().trim().max(2000).optional(),
});

/** Edit or activate a tax rule. A rule can only be active with a confirmed rate (DB check). Never deleted — retire instead. */
export async function saveTaxRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = TaxRule.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const v = parsed.data;
  const rate = v.rate ? Number(v.rate) : null;
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) return fail("The rate is a percentage between 0 and 100.");
  if (v.status === "active" && rate === null) return fail("Enter the confirmed rate before activating the rule.");
  const { error } = await auth.supabase
    .from("tax_rules")
    .update({ rate, inclusive: v.inclusive === "on" || v.inclusive === "true", applies_to: v.applies_to, effective_from: v.effective_from, effective_to: v.effective_to || null, status: v.status, ...(v.description ? { description: v.description } : {}) })
    .eq("id", v.ruleId);
  if (error) return fail(dbMessage(error));
  return done(v.status === "active" ? "Tax rule activated. New tax reports apply it from its effective date." : "Tax rule saved.");
}

const Export = z.object({ kind: z.enum(ACCOUNTING_EXPORT_KINDS), orgId: z.string().uuid().optional().or(z.literal("")), month: z.string().regex(/^\d{4}-\d{2}$/) });

/** Generate an export for an organisation (or the platform) for a month. */
export async function generateExport(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("commercial");
  if (!auth.ok) return fail(auth.error);
  const parsed = Export.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const period = monthPeriod(parsed.data.month);
  if (!period) return fail("Choose a month.");
  const orgId = parsed.data.orgId || null;
  if (parsed.data.kind === "insurer_statement" && !orgId) return fail("Choose the insurer for an insurer statement.");
  const r = await runAdminExport(parsed.data.kind, orgId, period, auth.staff.userId);
  if (r.status !== "ready") return fail(`The export failed: ${r.error ?? "unknown error"}`);
  return done(`Export ready (${r.rows} rows). Download it from the list below.`);
}
