"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Public lead capture (partner enquiries, business enquiries, contact).
 * Anonymous inserts are allowed by RLS only with status = 'new'. Every Server Action is
 * a public endpoint, so input is validated here and the response is deliberately narrow.
 */
export type LeadField = "name" | "email" | "phone" | "organization" | "message" | "kind" | "category_slug" | "consent";
export interface LeadState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<LeadField, string>>;
  /** Echo of submitted text so the form can keep what was typed after a validation error. */
  values?: Partial<Record<LeadField, string>>;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const LeadSchema = z
  .object({
    kind: z.enum(["customer", "broker", "insurer", "enterprise", "press", "other"]),
    name: z.string().trim().min(2, "Please tell us your name.").max(120),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.email("Please enter a valid email address.").optional()),
    phone: optionalText(40).pipe(
      z
        .string()
        .regex(/^[+()\d\s-]{7,20}$/, "Please enter a valid phone number, for example 024 123 4567.")
        .optional(),
    ),
    organization: optionalText(160),
    category_slug: optionalText(60),
    message: optionalText(4000),
    source_page: optionalText(300),
    utm: optionalText(1000),
    consent: z.literal("on", { error: "Please confirm we may contact you about this enquiry." }),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) ctx.addIssue({ code: "custom", path: ["email"], message: "Please give an email address or a phone number." });
    if (["broker", "insurer", "enterprise"].includes(v.kind) && !v.organization)
      ctx.addIssue({ code: "custom", path: ["organization"], message: "Please tell us your organisation." });
  });

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
  for (const k of ["kind", "name", "email", "phone", "organization", "category_slug", "message", "consent"] as const) {
    const v = raw[k];
    if (typeof v === "string") out[k] = v.slice(0, 4000);
  }
  return out;
}

export async function submitLead(_prev: LeadState, formData: FormData): Promise<LeadState> {
  // Spam guard 1: honeypot field that real people never see or fill.
  if (String(formData.get("company_website") ?? "").trim() !== "") {
    return { status: "success" };
  }
  // Spam guard 2: forms submitted implausibly fast (< 2.5s after render) are bots.
  const startedAt = Number(formData.get("started_at"));
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 2500) {
    return { status: "success" };
  }

  const raw = Object.fromEntries(
    ["kind", "name", "email", "phone", "organization", "category_slug", "message", "source_page", "utm", "consent"].map((k) => [
      k,
      formData.get(k) ?? undefined,
    ]),
  );
  const parsed = LeadSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: LeadState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as LeadField | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: "error", message: "Please check the highlighted fields.", fieldErrors, values: echo(raw) };
  }

  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("leads").insert({
    kind: v.kind,
    name: v.name,
    email: v.email ?? null,
    phone: v.phone ?? null,
    organization: v.organization ?? null,
    category_slug: v.category_slug ?? null,
    message: v.message ?? null,
    source_page: v.source_page ?? null,
    utm: parseUtm(v.utm),
    status: "new",
  });

  if (error) {
    console.error("[leads] insert failed", error.code, error.message);
    return { status: "error", message: "Sorry, we could not send your message just now. Please try again in a moment, or email us.", values: echo(raw) };
  }
  return { status: "success" };
}
