"use server";

import type { Json } from "@im/db";
import { createClient } from "@/lib/supabase/server";
import { LeadSchema, RenewalLeadSchema } from "@/components/marketing/lead-schema";

/**
 * Public lead capture (partner enquiries, business enquiries, contact).
 * Anonymous inserts are allowed by RLS only with status = 'new'. Every Server Action is
 * a public endpoint, so input is validated here and the response is deliberately narrow.
 */
export type LeadField = "name" | "email" | "phone" | "organization" | "message" | "kind" | "category_slug" | "consent" | "expires_on";

export type { LeadTag } from "@/components/marketing/lead-tags";
export interface LeadState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<LeadField, string>>;
  /** Echo of submitted text so the form can keep what was typed after a validation error. */
  values?: Partial<Record<LeadField, string>>;
}

function parseUtm(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  try {
    const params = new URLSearchParams(raw);
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"]) {
      const v = params.get(key);
      if (v) out[key] = v.slice(0, 120);
    }
  } catch {
    /* ignore malformed */
  }
  return out;
}

function echo(raw: Record<string, unknown>): LeadState["values"] {
  const out: LeadState["values"] = {};
  for (const k of ["kind", "name", "email", "phone", "organization", "category_slug", "message", "consent", "expires_on"] as const) {
    const v = raw[k];
    if (typeof v === "string") out[k] = v.slice(0, 4000);
  }
  return out;
}

export async function submitLead(_prev: LeadState, formData: FormData): Promise<LeadState> {
  return saveLead(formData, LeadSchema);
}

export async function submitRenewalLead(_prev: LeadState, formData: FormData): Promise<LeadState> {
  formData.set("tag", "renewal_reminder");
  return saveLead(formData, RenewalLeadSchema);
}

async function saveLead(formData: FormData, schema: typeof LeadSchema): Promise<LeadState> {
  const raw = Object.fromEntries(
    ["kind", "name", "email", "phone", "organization", "category_slug", "message", "source_page", "utm", "consent", "tag", "expires_on"].map((k) => [
      k,
      formData.get(k) ?? undefined,
    ]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: LeadState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as LeadField | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: "error", message: "Please check the highlighted fields.", fieldErrors, values: echo(raw) };
  }

  // Spam guard 1: honeypot field that real people never see or fill.
  if (String(formData.get("company_website") ?? "").trim() !== "") {
    return { status: "success" };
  }
  // Spam guard 2: forms submitted implausibly fast (< 2.5s after render) are bots.
  const startedAt = Number(formData.get("started_at"));
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 2500) {
    return { status: "success" };
  }

  const v = parsed.data;
  const utm: Record<string, Json> = parseUtm(v.utm);
  const metadata: Record<string, string> = {};
  if (v.expires_on) metadata.expires_on = v.expires_on;
  if (v.tag) utm.tags = [v.tag];
  if (Object.keys(metadata).length) utm.metadata = metadata;
  const prefix = v.tag === "renewal_reminder" && v.expires_on ? `Renewal reminder — current policy expires on ${v.expires_on}.` : v.tag ? `[${v.tag}]` : "";
  const message = [prefix, v.message].filter(Boolean).join(" ") || null;

  const supabase = await createClient();
  const { error } = await supabase.from("leads").insert({
    kind: v.kind,
    name: v.name,
    email: v.email ?? null,
    phone: v.phone ?? null,
    organization: v.organization ?? null,
    category_slug: v.category_slug ?? null,
    message,
    source_page: v.source_page ?? null,
    utm, // kept for backwards compatibility (older admin views read utm.tags / utm.metadata)
    tags: v.tag ? [v.tag] : [],
    metadata,
    status: "new",
  });

  if (error) {
    console.error("[leads] insert failed", error.code, error.message);
    return { status: "error", message: "Sorry, we could not send your message just now. Please try again in a moment, or email us.", values: echo(raw) };
  }
  return { status: "success" };
}
