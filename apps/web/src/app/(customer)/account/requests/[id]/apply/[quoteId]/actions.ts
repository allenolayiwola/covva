"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { buildDisclosure } from "@im/core";
import type { Json } from "@im/db";
import { getSetting } from "@/lib/catalog";
import { notifyOrg } from "@/server/notify";
import { initiatePayment } from "@/server/payments";
import { BusinessRuleError } from "@/server/requests";
import { emitEvent } from "@/server/webhooks";
import { normaliseGhanaPhone, type ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext, dbError } from "../../../../_lib/action";
import { declarationsFor } from "./declarations";

const uuid = z.string().uuid();

async function load(requestId: string, quoteId: string) {
  const ctx = await actionContext();
  if (!ctx.user || !uuid.safeParse(requestId).success || !uuid.safeParse(quoteId).success) return { ...ctx, request: null, quote: null };
  const [{ data: request }, { data: quote }] = await Promise.all([
    ctx.supabase
      .from("requests")
      .select("id, status, broker_org_id, risk_data, category:product_categories(slug), broker:organizations!requests_broker_org_id_fkey(name, nic_licence_number)")
      .eq("id", requestId)
      .eq("customer_id", ctx.user.id)
      .maybeSingle(),
    ctx.supabase
      .from("quotes")
      .select("id, status, valid_until, key_exclusion, optional_benefits, insurer:organizations!quotes_insurer_org_id_fkey(name)")
      .eq("id", quoteId)
      .eq("request_id", requestId)
      .maybeSingle(),
  ]);
  return { ...ctx, request, quote };
}

// ---------------------------------------------------------------------------
// Step 1 — broker disclosure (must exist before an application; DB trigger enforces)
// ---------------------------------------------------------------------------
export async function acknowledgeDisclosure(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  if (formData.get("ack") !== "on") return { ok: false, error: "Please confirm you understand who provides what." };
  const { supabase, user, request, quote } = await load(requestId, quoteId);
  if (!user) return SIGNED_OUT;
  if (!request || !quote) return { ok: false, error: "We couldn't find this quote." };
  if (!request.broker_org_id) return { ok: false, error: "A broker of record hasn't been assigned yet. We'll notify you when they are." };

  const broker = request.broker as unknown as { name: string; nic_licence_number: string | null } | null;
  const insurer = quote.insurer as unknown as { name: string } | null;
  const text = buildDisclosure({ broker: { name: broker?.name ?? "Your broker", licence: broker?.nic_licence_number }, insurer: insurer ? { name: insurer.name } : null });

  const { data: existing } = await supabase
    .from("broker_disclosures")
    .select("id")
    .eq("request_id", request.id)
    .eq("broker_org_id", request.broker_org_id)
    .eq("stage", "before_application")
    .limit(1);
  if (!existing?.length) {
    const { error } = await supabase.from("broker_disclosures").insert({
      request_id: request.id,
      broker_org_id: request.broker_org_id,
      shown_to: user.id,
      method: "in_app",
      stage: "before_application",
      disclosure_text: text,
    });
    if (error) return { ok: false, error: dbError(error, "We couldn't record your confirmation. Please try again.") };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Step 2 — declarations & terms → application (DB trigger re-validates quote & disclosure)
// ---------------------------------------------------------------------------
export async function submitApplication(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const quoteId = String(formData.get("quoteId") ?? "");
  const { supabase, user, request, quote } = await load(requestId, quoteId);
  if (!user) return SIGNED_OUT;
  if (!request || !quote) return { ok: false, error: "We couldn't find this quote." };

  const category = (request.category as unknown as { slug: string } | null)?.slug;
  const insurer = (quote.insurer as unknown as { name: string } | null)?.name ?? "the insurer";
  const decls = declarationsFor(category, { insurer, keyExclusion: quote.key_exclusion, risk: (request.risk_data ?? {}) as Record<string, unknown> });
  const fieldErrors: Record<string, string> = {};
  const declarations: Record<string, boolean | string> = {};
  for (const d of decls) {
    const on = formData.get(`decl_${d.key}`) === "on";
    if (!on) fieldErrors[`decl_${d.key}`] = "Please confirm this to continue";
    declarations[d.key] = on;
  }
  if (formData.get("accept_terms") !== "on") fieldErrors.accept_terms = "Please accept the terms to continue";
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please confirm each declaration. If one isn't true, message your broker before applying.", fieldErrors };

  const offered = new Set(((Array.isArray(quote.optional_benefits) ? quote.optional_benefits : []) as { key: string }[]).map((b) => b.key));
  const benefits = formData.getAll("benefits").map(String).filter((b) => offered.has(b));

  const { data: disclosure } = await supabase
    .from("broker_disclosures")
    .select("id")
    .eq("request_id", request.id)
    .order("acknowledged_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("quote_id", quote.id)
    .eq("customer_id", user.id)
    .in("status", ["submitted", "accepted"])
    .limit(1);
  if (!existing?.length) {
    const termsVersion = (await getSetting<string>("terms_version")) ?? "unversioned";
    declarations.declared_at = new Date().toISOString();
    const { data: created, error } = await supabase
      .from("applications")
      .insert({
        request_id: request.id,
        quote_id: quote.id,
        customer_id: user.id,
        status: "submitted",
        declarations: declarations as Json,
        selected_benefits: benefits as Json,
        terms_accepted_at: new Date().toISOString(),
        terms_version: termsVersion,
        disclosure_id: disclosure?.id ?? null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: dbError(error, "We couldn't submit your application. Please try again.") };
    const { data: ref } = await supabase.from("requests").select("reference").eq("id", request.id).maybeSingle();
    if (request.broker_org_id) {
      await notifyOrg(request.broker_org_id, { kind: "application.submitted", title: `Application submitted for ${ref?.reference ?? "a request"}`, link: `/partner/requests/${request.id}`, data: { request_id: request.id, application_id: created.id }, channels: ["in_app", "email"] }).catch(() => {});
      await emitEvent(request.broker_org_id, "application.submitted", { request_id: request.id, reference: ref?.reference ?? null, application_id: created.id, quote_id: quote.id, status: "submitted" });
    }
  }
  revalidatePath(`/account/requests/${request.id}`);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Step 3 — payment (Backend's payment service; premiums settle to the insurer)
// ---------------------------------------------------------------------------
const PayInput = z
  .object({
    requestId: uuid,
    quoteId: uuid,
    applicationId: uuid,
    method: z.enum(["mtn", "vod", "atl", "card", "bank_transfer"], { error: "Choose how you'd like to pay" }),
    phone: z.string().optional(),
    /** Diaspora: display currency (indicative; the insurer is paid in GHS) and the sponsor plan. */
    currency: z.enum(["GHS", "GBP", "USD", "EUR", "CAD"]).optional(),
    sponsor: z.enum(["", "monthly", "annual"]).optional(),
    save_card: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.method !== "card" && v.method !== "bank_transfer" && !normaliseGhanaPhone(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter the mobile money number to charge, e.g. 024 123 4567" });
  });

async function origin() {
  const h = await headers();
  const o = h.get("origin");
  if (o && /^https?:\/\//.test(o)) return o;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function startPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = PayInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { ok: false, error: parsed.error.issues[0]?.message, fieldErrors: fe };
  }
  const v = parsed.data;
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const { data: app } = await supabase
    .from("applications")
    .select("id, status, request_id, quote_id")
    .eq("id", v.applicationId)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!app || app.request_id !== v.requestId || app.quote_id !== v.quoteId) return { ok: false, error: "We couldn't find your application." };
  if (!["submitted", "accepted"].includes(app.status)) return { ok: false, error: "This application can no longer be paid. Please message your broker." };

  let result: Awaited<ReturnType<typeof initiatePayment>>;
  try {
    result = await initiatePayment({
      applicationId: app.id,
      channel: v.method === "card" ? "card" : v.method === "bank_transfer" ? "bank_transfer" : "mobile_money",
      momo: v.method === "card" || v.method === "bank_transfer" ? undefined : { phone: normaliseGhanaPhone(v.phone)!, provider: v.method },
      callbackUrl: `${await origin()}/account/requests/${v.requestId}/confirmation`,
      displayCurrency: v.currency ?? "GHS",
      saveMethod: v.save_card === "on",
      sponsorSubscription: v.sponsor ? { cadence: v.sponsor } : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("initiatePayment failed", err);
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    if (/not implemented/i.test(msg)) {
      return {
        ok: false,
        error: "Online payment isn't switched on yet. Your application is saved — your broker will contact you with a secure way to pay the insurer directly.",
      };
    }
    if (/P0001|insurer|expired|revalidat/i.test(msg)) return { ok: false, error: msg };
    return { ok: false, error: "We couldn't start the payment. No money has been taken. Please try again in a moment." };
  }

  if (result.authorizationUrl && /^https:\/\//.test(result.authorizationUrl)) redirect(result.authorizationUrl);
  if (result.status === "succeeded") redirect(`/account/requests/${v.requestId}/confirmation`);
  redirect(`/account/requests/${v.requestId}/apply/${v.quoteId}?payment=${encodeURIComponent(result.paymentId)}`);
}
