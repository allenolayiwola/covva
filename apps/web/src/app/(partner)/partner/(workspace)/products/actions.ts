"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { RATING_MODELS } from "@im/core";
import type { Json } from "@im/db";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

const Payload = z.object({
  productId: z.string().uuid(),
  coverage: z.array(z.object({ key: z.string().min(1).max(80), label: z.string().min(1).max(200), included: z.boolean(), detail: z.string().max(500).optional() })).min(1, "Add at least one coverage item"),
  limits: z.record(z.string(), z.union([z.number(), z.string()])),
  excesses: z.record(z.string(), z.union([z.number(), z.string()])),
  exclusions: z.array(z.string().max(300)).max(50),
  keyExclusion: z.string().max(300),
  waitingPeriodDays: z.number().int().min(0).max(3650),
  optionalBenefits: z.array(z.object({ key: z.string().min(1), label: z.string().min(1).max(200), premium: z.number().nonnegative().optional() })),
  conditions: z.string().max(10000),
  claimsProcess: z.string().max(10000),
  rating: z.string().min(2),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an effective date"),
  wordingUrl: z.string().url().or(z.literal("")),
});

/** Insurer submits a new product version → pending_approval (platform approves in admin). */
export async function submitVersion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    let raw: unknown;
    try {
      raw = JSON.parse(String(formData.get("payload") ?? "{}"));
    } catch {
      return { ok: false, error: "The form could not be read. Reload and try again." };
    }
    const parsed = Payload.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(" ") };
    const p = parsed.data;
    let rating: Record<string, unknown>;
    try {
      rating = JSON.parse(p.rating);
    } catch {
      return { ok: false, error: "The rating rule is not valid JSON." };
    }
    if (!RATING_MODELS.includes(rating.model as never)) return { ok: false, error: `Rating model must be one of: ${RATING_MODELS.join(", ")}.` };

    const { data: product } = await ctx.supabase.from("products").select("id, insurer_org_id, name").eq("id", p.productId).maybeSingle();
    if (!product || product.insurer_org_id !== ctx.orgId) return { ok: false, error: "Product not found." };
    const { data: latest } = await ctx.supabase.from("product_versions").select("version").eq("product_id", product.id).order("version", { ascending: false }).limit(1);
    const version = (latest?.[0]?.version ?? 0) + 1;
    const now = new Date().toISOString();

    const { error } = await ctx.supabase.from("product_versions").insert({
      product_id: product.id,
      version,
      status: "pending_approval",
      compliance_status: "submitted",
      coverage: p.coverage as unknown as Json,
      limits: p.limits as Json,
      excesses: p.excesses as Json,
      exclusions: p.exclusions,
      key_exclusion: p.keyExclusion || p.exclusions[0] || null,
      waiting_period_days: p.waitingPeriodDays,
      optional_benefits: p.optionalBenefits as unknown as Json,
      conditions: p.conditions || null,
      claims_process: p.claimsProcess || null,
      rating: rating as Json,
      wording_url: p.wordingUrl || null,
      effective_from: p.effectiveFrom,
      submitted_by: ctx.userId,
      insurer_approved_at: now,
    });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't save the version.") };
    refresh();
    return { ok: true, message: `Version ${version} of ${product.name} submitted for platform approval.` };
  });
}

const NewProduct = z.object({
  name: z.string().trim().min(3).max(120),
  categoryId: z.string().uuid("Choose a category"),
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _"),
  tier: z.string().trim().max(40).optional(),
  summary: z.string().trim().max(500).optional(),
});

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = NewProduct.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const p = parsed.data;
    const { data, error } = await ctx.supabase
      .from("products")
      .insert({ insurer_org_id: ctx.orgId, category_id: p.categoryId, name: p.name, code: p.code.toUpperCase(), tier: p.tier || null, summary: p.summary || null, status: "draft", data_owner_id: ctx.userId })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.code === "23505" ? "You already have a product with that code." : dbMessage(error) };
    redirect(`/partner/products/${data.id}`);
  });
}
