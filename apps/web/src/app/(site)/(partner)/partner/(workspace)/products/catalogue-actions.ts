"use server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ISSUANCE_TYPES, RATE_KINDS, RULE_OPS, RULE_OUTCOMES, TEMPLATE_KINDS, parseRateTableCsv, validateTemplate, type RuleCondition, type RuleOp } from "@im/core";
import type { Json } from "@im/db";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

/**
 * Catalogue extensions for the insurer workspace (Addendum 2 B, Addendum 3 B3):
 * rate tables, underwriting rules, document templates, issuance type/SLA,
 * scheduled price changes and compliance submission. Every action re-checks the
 * session and role; RLS (migration 20261027100100) remains the real boundary.
 */
const uuid = z.string().uuid();
const factorKey = z.string().trim().regex(/^[a-z0-9_]+$/i, "Factor keys use letters, numbers and _").max(60);

/** Loads a version the active insurer owns (or returns an error state). */
async function ownVersion(ctx: Awaited<ReturnType<typeof actionContext>>, versionId: string) {
  const { data: v } = await ctx.supabase.from("product_versions").select("*, product:products!inner(id, name, insurer_org_id, category_id, current_version_id)").eq("id", versionId).maybeSingle();
  const product = v?.product as unknown as { id: string; name: string; insurer_org_id: string; category_id: string; current_version_id: string | null } | null;
  if (!v || !product || product.insurer_org_id !== ctx.orgId) return null;
  return { version: v, product };
}

// ---------------------------------------------------------------------------
// Issuance type / SLA + compliance workflow
// ---------------------------------------------------------------------------
const Issuance = z.object({
  versionId: uuid,
  issuanceType: z.enum(ISSUANCE_TYPES as [string, ...string[]]),
  slaHours: z.coerce.number().int().min(0).max(720).optional(),
});

export async function setIssuance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = Issuance.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const own = await ownVersion(ctx, parsed.data.versionId);
    if (!own) return { ok: false, error: "Version not found." };
    const sla = parsed.data.issuanceType === "within_hours" ? (parsed.data.slaHours || 24) : parsed.data.slaHours || null;
    const { error } = await ctx.supabase.from("product_versions").update({ issuance_type: parsed.data.issuanceType, sla_hours: sla }).eq("id", own.version.id);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Issuance settings saved. Customers see this on every quote for this version." };
  });
}

/** Draft → Submitted: the insurer signs off and the version enters Covva compliance review. */
export async function submitForCompliance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = z.object({ versionId: uuid, changeSummary: z.string().trim().max(2000).optional() }).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "Check the form" };
    const own = await ownVersion(ctx, parsed.data.versionId);
    if (!own) return { ok: false, error: "Version not found." };
    if (!["draft", "returned"].includes(own.version.compliance_status) || own.version.status !== "draft") {
      return { ok: false, error: `Only draft or returned versions can be submitted (this one is ${own.version.compliance_status.replace("_", " ")}).` };
    }
    const now = new Date().toISOString();
    const { error } = await ctx.supabase
      .from("product_versions")
      .update({ status: "pending_approval", compliance_status: "submitted", change_summary: parsed.data.changeSummary || own.version.change_summary, submitted_by: ctx.userId, insurer_approved_at: now })
      .eq("id", own.version.id);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: `v${own.version.version} submitted for Covva compliance review.` };
  });
}

// ---------------------------------------------------------------------------
// Scheduled price change: a new draft version cloned from an existing one
// ---------------------------------------------------------------------------
const Schedule = z.object({
  versionId: uuid,
  effectiveAt: z.string().min(10, "Choose when the new price goes live"),
  changeSummary: z.string().trim().min(5, "Describe the change (at least 5 characters)").max(2000),
  rating: z.string().optional(),
});

export async function schedulePriceChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = Schedule.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const own = await ownVersion(ctx, parsed.data.versionId);
    if (!own) return { ok: false, error: "Version not found." };
    const when = new Date(parsed.data.effectiveAt);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "The effective date is not valid." };
    if (when.getTime() < Date.now() + 3_600_000) return { ok: false, error: "Schedule the change at least an hour ahead so it can be reviewed." };
    let rating: Json = own.version.rating;
    if (parsed.data.rating?.trim()) {
      try {
        rating = JSON.parse(parsed.data.rating) as Json;
      } catch {
        return { ok: false, error: "The rating rule is not valid JSON." };
      }
    }
    const { data: latest } = await ctx.supabase.from("product_versions").select("version").eq("product_id", own.product.id).order("version", { ascending: false }).limit(1);
    const version = (latest?.[0]?.version ?? 0) + 1;
    const src = own.version;
    const { data: created, error } = await ctx.supabase
      .from("product_versions")
      .insert({
        product_id: own.product.id,
        version,
        status: "draft",
        compliance_status: "draft",
        coverage: src.coverage,
        limits: src.limits,
        excesses: src.excesses,
        exclusions: src.exclusions,
        key_exclusion: src.key_exclusion,
        waiting_period_days: src.waiting_period_days,
        optional_benefits: src.optional_benefits,
        conditions: src.conditions,
        claims_process: src.claims_process,
        rating,
        wording_url: src.wording_url,
        effective_from: when.toISOString().slice(0, 10),
        scheduled_effective_from: when.toISOString(),
        supersedes_version_id: src.id,
        change_summary: parsed.data.changeSummary,
        issuance_type: src.issuance_type,
        sla_hours: src.sla_hours,
        submitted_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: dbMessage(error) };
    // Carry the catalogue data forward so the scheduled version prices and underwrites like its parent.
    const [{ data: rules }, { data: templates }] = await Promise.all([
      ctx.supabase.from("underwriting_rules").select("name, condition, outcome, message, priority, active").eq("product_version_id", src.id),
      ctx.supabase.from("document_templates").select("kind, name, template, version").eq("product_version_id", src.id),
    ]);
    if (rules?.length) await ctx.supabase.from("underwriting_rules").insert(rules.map((r) => ({ ...r, product_version_id: created.id })));
    if (templates?.length) await ctx.supabase.from("document_templates").insert(templates.map((t) => ({ ...t, product_version_id: created.id, status: "draft" })));
    redirect(`/partner/products/${own.product.id}/versions/${created.id}`);
  });
}

// ---------------------------------------------------------------------------
// Rate tables
// ---------------------------------------------------------------------------
const NewTable = z.object({
  versionId: uuid,
  name: z.string().trim().min(2).max(120),
  factorKeys: z.string().trim().min(1, "List at least one factor key"),
  valueFields: z.string().trim().optional(),
});

function splitKeys(s: string | undefined): string[] {
  return [...new Set((s ?? "").split(/[,\s]+/).map((k) => k.trim()).filter(Boolean))];
}

export async function createRateTable(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = NewTable.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const own = await ownVersion(ctx, parsed.data.versionId);
    if (!own) return { ok: false, error: "Version not found." };
    const keys = splitKeys(parsed.data.factorKeys);
    for (const k of keys) {
      const r = factorKey.safeParse(k);
      if (!r.success) return { ok: false, error: `"${k}": ${r.error.issues[0]?.message}` };
    }
    const { data, error } = await ctx.supabase
      .from("rate_tables")
      .insert({ product_version_id: own.version.id, name: parsed.data.name, factor_keys: keys, status: "draft", source: "manual", submitted_by: ctx.userId, submitted_by_org_id: ctx.orgId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: `Rate table "${parsed.data.name}" created. Add rows manually or upload a CSV.`, data: { tableId: data.id } };
  });
}

const RowsPayload = z.object({
  tableId: uuid,
  rows: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        factors: z.record(z.string(), z.string()),
        rate: z.coerce.number().min(0),
        rate_kind: z.enum(RATE_KINDS as [string, ...string[]]),
        min_premium: z.union([z.coerce.number().min(0), z.literal(""), z.null()]).optional(),
      }),
    )
    .max(5000),
});

async function ownTable(ctx: Awaited<ReturnType<typeof actionContext>>, tableId: string) {
  const { data: t } = await ctx.supabase.from("rate_tables").select("*").eq("id", tableId).maybeSingle();
  if (!t || !t.product_version_id) return null;
  const own = await ownVersion(ctx, t.product_version_id);
  return own ? { table: t, ...own } : null;
}

/** Saves the manual rows editor: existing rows are updated, new rows inserted (rows are never deleted). */
export async function saveRateRows(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    let raw: unknown;
    try {
      raw = JSON.parse(String(formData.get("payload") ?? "{}"));
    } catch {
      return { ok: false, error: "The form could not be read. Reload and try again." };
    }
    const parsed = RowsPayload.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ") };
    const own = await ownTable(ctx, parsed.data.tableId);
    if (!own) return { ok: false, error: "Rate table not found." };
    if (own.table.status === "approved") return { ok: false, error: "This table is approved. Create a new table (or upload a CSV) for changed rates." };
    const keys = own.table.factor_keys ?? [];
    let updated = 0;
    let inserted = 0;
    for (const r of parsed.data.rows) {
      const factors: Record<string, string> = {};
      for (const k of keys) factors[k] = (r.factors[k] ?? "*").trim() || "*";
      const row = { factors: factors as Json, rate: r.rate, rate_kind: r.rate_kind, min_premium: r.min_premium === "" || r.min_premium == null ? null : Number(r.min_premium) };
      if (r.id) {
        const { error } = await ctx.supabase.from("rate_rows").update(row).eq("id", r.id).eq("rate_table_id", own.table.id);
        if (error) return { ok: false, error: dbMessage(error) };
        updated++;
      } else {
        const { error } = await ctx.supabase.from("rate_rows").insert({ ...row, rate_table_id: own.table.id });
        if (error) return { ok: false, error: dbMessage(error) };
        inserted++;
      }
    }
    refresh();
    return { ok: true, message: `Saved: ${inserted} new row${inserted === 1 ? "" : "s"}, ${updated} updated.` };
  });
}

/** CSV upload: validates with the core parser and creates a NEW table with the rows (source = csv). */
export async function importRateTableCsv(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = z.object({ versionId: uuid, name: z.string().trim().min(2).max(120), factorKeys: z.string().trim().min(1), csv: z.string().min(1, "Choose a CSV file") }).safeParse({
      versionId: formData.get("versionId"),
      name: formData.get("name"),
      factorKeys: formData.get("factorKeys"),
      csv: formData.get("csv"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const own = await ownVersion(ctx, parsed.data.versionId);
    if (!own) return { ok: false, error: "Version not found." };
    const keys = splitKeys(parsed.data.factorKeys);
    const result = parseRateTableCsv(parsed.data.csv, keys);
    const blocking = result.errors.filter((e) => e.row > 1 || /Missing column|empty/.test(e.message));
    if (blocking.length) return { ok: false, error: `Fix the CSV first: ${blocking.slice(0, 5).map((e) => `row ${e.row}: ${e.message}`).join(" ")}${blocking.length > 5 ? ` (+${blocking.length - 5} more)` : ""}` };
    const { data: table, error } = await ctx.supabase
      .from("rate_tables")
      .insert({ product_version_id: own.version.id, name: parsed.data.name, factor_keys: keys, status: "draft", source: "csv", submitted_by: ctx.userId, submitted_by_org_id: ctx.orgId })
      .select("id")
      .single();
    if (error || !table) return { ok: false, error: dbMessage(error) };
    const { error: rowsErr } = await ctx.supabase.from("rate_rows").insert(
      result.rows.map((r) => ({ rate_table_id: table.id, factors: r.factors as Json, rate: r.rate, rate_kind: r.rate_kind, min_premium: r.min_premium ?? null })),
    );
    if (rowsErr) return { ok: false, error: dbMessage(rowsErr) };
    refresh();
    return { ok: true, message: `Imported ${result.rows.length} rows into "${parsed.data.name}".`, data: { tableId: table.id } };
  });
}

/** Insurer submits a draft table for Covva review (approval is reserved for platform staff). */
export async function submitRateTable(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = z.object({ tableId: uuid }).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "Check the form" };
    const own = await ownTable(ctx, parsed.data.tableId);
    if (!own) return { ok: false, error: "Rate table not found." };
    const { count } = await ctx.supabase.from("rate_rows").select("id", { count: "exact", head: true }).eq("rate_table_id", own.table.id);
    if (!count) return { ok: false, error: "Add at least one row before submitting." };
    const { error } = await ctx.supabase.from("rate_tables").update({ status: "pending_review", submitted_by: ctx.userId, submitted_by_org_id: ctx.orgId }).eq("id", own.table.id);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: "Rate table submitted for review." };
  });
}

/** Points a DRAFT version's rating rule at a rate table ({ model: 'rate_table', rate_table_id }). */
export async function useRateTableForPricing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = z.object({ tableId: uuid, valueFields: z.string().trim().optional(), unitsField: z.string().trim().optional(), minPremium: z.coerce.number().min(0).optional() }).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const own = await ownTable(ctx, parsed.data.tableId);
    if (!own) return { ok: false, error: "Rate table not found." };
    if (own.version.status !== "draft") return { ok: false, error: "Only a draft version's pricing can be changed. Schedule a price change to create a new draft." };
    const rating = {
      model: "rate_table",
      rate_table_id: own.table.id,
      factor_keys: own.table.factor_keys,
      value_fields: splitKeys(parsed.data.valueFields).length ? splitKeys(parsed.data.valueFields) : ["sum_insured"],
      ...(parsed.data.unitsField ? { units_field: parsed.data.unitsField } : {}),
      ...(parsed.data.minPremium ? { min_premium: parsed.data.minPremium } : {}),
    };
    const { error } = await ctx.supabase.from("product_versions").update({ rating: rating as Json }).eq("id", own.version.id);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: `v${own.version.version} now prices from "${own.table.name}". The table must be approved before the version goes live.` };
  });
}

// ---------------------------------------------------------------------------
// Underwriting rules
// ---------------------------------------------------------------------------
const Rule = z.object({
  versionId: uuid,
  ruleId: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(2).max(120),
  field: z.string().trim().min(1, "Choose a field").max(80),
  op: z.enum(RULE_OPS.map((o) => o.value) as [RuleOp, ...RuleOp[]]),
  value: z.string().trim().max(500).optional(),
  outcome: z.enum(RULE_OUTCOMES as [string, ...string[]]),
  message: z.string().trim().max(500).optional(),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  active: z.string().optional(),
});

function ruleValue(op: RuleOp, raw: string | undefined): unknown {
  if (op === "exists" || op === "missing") return undefined;
  const v = raw ?? "";
  if (op === "in" || op === "not_in") return v.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (v === "true" || v === "false") return v === "true";
  return v;
}

export async function saveRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = Rule.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const own = await ownVersion(ctx, parsed.data.versionId);
    if (!own) return { ok: false, error: "Version not found." };
    const p = parsed.data;
    const condition: RuleCondition = { field: p.field, op: p.op, value: ruleValue(p.op, p.value) };
    const row = { product_version_id: own.version.id, name: p.name, condition: condition as unknown as Json, outcome: p.outcome, message: p.message || null, priority: p.priority, active: p.active === "on" || p.active === "true" };
    const { error } = p.ruleId
      ? await ctx.supabase.from("underwriting_rules").update(row).eq("id", p.ruleId).eq("product_version_id", own.version.id)
      : await ctx.supabase.from("underwriting_rules").insert(row);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: p.ruleId ? "Rule updated." : "Rule added." };
  });
}

export async function toggleRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = z.object({ ruleId: uuid, active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "Check the form" };
    const { error } = await ctx.supabase.from("underwriting_rules").update({ active: parsed.data.active === "true" }).eq("id", parsed.data.ruleId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: parsed.data.active === "true" ? "Rule enabled." : "Rule disabled." };
  });
}

// ---------------------------------------------------------------------------
// Document templates
// ---------------------------------------------------------------------------
const Template = z.object({
  versionId: uuid,
  templateId: z.string().uuid().optional().or(z.literal("")),
  kind: z.enum(TEMPLATE_KINDS as [string, ...string[]]),
  name: z.string().trim().min(2).max(120),
  template: z.string().min(2),
});

export async function saveTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = Template.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const own = await ownVersion(ctx, parsed.data.versionId);
    if (!own) return { ok: false, error: "Version not found." };
    let template: unknown;
    try {
      template = JSON.parse(parsed.data.template);
    } catch {
      return { ok: false, error: "The template is not valid JSON." };
    }
    const check = validateTemplate(template);
    if (!check.ok) return { ok: false, error: check.errors.slice(0, 4).join(" ") };
    const p = parsed.data;
    if (p.templateId) {
      const { data: existing } = await ctx.supabase.from("document_templates").select("status, version").eq("id", p.templateId).maybeSingle();
      if (existing?.status === "approved") {
        // Approved templates are immutable: save the edit as a new draft version of the template.
        const { error } = await ctx.supabase.from("document_templates").insert({ product_version_id: own.version.id, kind: p.kind, name: p.name, template: template as Json, status: "draft", version: (existing.version ?? 1) + 1 });
        if (error) return { ok: false, error: dbMessage(error) };
        refresh();
        return { ok: true, message: `Saved as draft v${(existing.version ?? 1) + 1} (the approved template stays in use until this one is approved).` };
      }
      const { error } = await ctx.supabase.from("document_templates").update({ kind: p.kind, name: p.name, template: template as Json }).eq("id", p.templateId).eq("product_version_id", own.version.id);
      if (error) return { ok: false, error: dbMessage(error) };
    } else {
      const { error } = await ctx.supabase.from("document_templates").insert({ product_version_id: own.version.id, kind: p.kind, name: p.name, template: template as Json, status: "draft" });
      if (error) return { ok: false, error: dbMessage(error) };
    }
    refresh();
    return { ok: true, message: "Template saved as a draft. Covva approves templates before they are used for issued documents." };
  });
}

// ---------------------------------------------------------------------------
// Broker: propose a rate table for an insurer not yet on Covva
// ---------------------------------------------------------------------------
const Proposal = z.object({
  insurerName: z.string().trim().min(2, "Name the insurer").max(160),
  name: z.string().trim().min(2, "Name the product or table").max(160),
  factorKeys: z.string().trim().min(1, "List at least one factor key"),
  categorySlug: z.string().trim().max(60).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  csv: z.string().optional(),
});

export async function proposeRateTable(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.brokerWork });
    const parsed = Proposal.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const p = parsed.data;
    const keys = splitKeys(p.factorKeys);
    for (const k of keys) {
      const r = factorKey.safeParse(k);
      if (!r.success) return { ok: false, error: `"${k}": ${r.error.issues[0]?.message}` };
    }
    let rows = p.csv?.trim() ? parseRateTableCsv(p.csv, keys) : null;
    if (rows) {
      const blocking = rows.errors.filter((e) => e.row > 1 || /Missing column|empty/.test(e.message));
      if (blocking.length) return { ok: false, error: `Fix the CSV first: ${blocking.slice(0, 5).map((e) => `row ${e.row}: ${e.message}`).join(" ")}` };
      if (!rows.rows.length) rows = null;
    }
    const { data: table, error } = await ctx.supabase
      .from("rate_tables")
      .insert({
        product_version_id: null,
        proposed_insurer_name: p.insurerName,
        name: p.name,
        factor_keys: keys,
        status: "pending_review",
        source: rows ? "csv" : "manual",
        submitted_by: ctx.userId,
        submitted_by_org_id: ctx.orgId,
        review_notes: p.notes || null,
      })
      .select("id")
      .single();
    if (error || !table) return { ok: false, error: dbMessage(error) };
    if (rows) {
      const { error: rowsErr } = await ctx.supabase.from("rate_rows").insert(rows.rows.map((r) => ({ rate_table_id: table.id, factors: r.factors as Json, rate: r.rate, rate_kind: r.rate_kind, min_premium: r.min_premium ?? null })));
      if (rowsErr) return { ok: false, error: dbMessage(rowsErr) };
    }
    // A lead for the partnerships team (Addendum 3 D): the broker is suggesting an insurer to onboard.
    const { error: leadErr } = await ctx.supabase.from("leads").insert({
      kind: "insurer",
      name: p.contactName || p.insurerName,
      organization: p.insurerName,
      email: p.contactEmail || null,
      phone: p.contactPhone || null,
      category_slug: p.categorySlug || null,
      message: `Broker ${ctx.orgName} submitted a pending rate table "${p.name}" for ${p.insurerName} (not yet on Covva).${p.notes ? ` Notes: ${p.notes}` : ""}`,
      source_page: "broker_suggestion",
      utm: { source: "broker_suggestion", broker_org_id: ctx.orgId, rate_table_id: table.id } as unknown as Json,
      status: "new",
    });
    if (leadErr) return { ok: false, error: `Rate table saved, but the partnerships lead could not be recorded: ${dbMessage(leadErr)}` };
    refresh();
    return { ok: true, message: `Thanks — "${p.name}" for ${p.insurerName} is pending. Our partnerships team will contact the insurer; the table activates once they confirm.` };
  });
}
