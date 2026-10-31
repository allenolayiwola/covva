import { z } from "zod";
import { LEAD_TAGS } from "./lead-tags";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const BaseLeadSchema = z
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
    tag: z.enum(LEAD_TAGS).optional(),
    expires_on: optionalText(20).pipe(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Please enter the date your current policy expires.")
        .optional(),
    ),
    // A refinement keeps consent mandatory while allowing cross-field contact errors
    // to be reported in the same response when the checkbox is unchecked.
    consent: z.preprocess((value) => value ?? "", z.string().refine((value) => value === "on", "Please confirm we may contact you about this enquiry.")),
  })
  .superRefine((v, ctx) => {
    if (["broker", "insurer", "enterprise"].includes(v.kind) && !v.organization)
      ctx.addIssue({ code: "custom", path: ["organization"], message: "Please tell us your organisation." });
    if (v.tag === "renewal_reminder") {
      if (!v.expires_on) ctx.addIssue({ code: "custom", path: ["expires_on"], message: "Please tell us when your current policy expires." });
      else if (Number.isNaN(Date.parse(v.expires_on))) ctx.addIssue({ code: "custom", path: ["expires_on"], message: "Please enter a valid date." });
    }
  });

// General enquiries require email; the dedicated renewal reminder retains SMS contact.
export const LeadSchema = BaseLeadSchema.refine((v) => !!v.email, {
  path: ["email"], message: "Please enter a valid email address.",
});

export const RenewalLeadSchema = BaseLeadSchema.refine((v) => !!(v.email || v.phone), {
  path: ["email"], message: "Please give an email address or a phone number.",
});
