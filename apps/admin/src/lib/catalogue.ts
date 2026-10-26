import { z } from "zod";
import type { Enum } from "@im/db";

/** Launch gate (PLAN §0.1): a category goes live only when all seven are recorded. */
export const LAUNCH_CHECKLIST = [
  { key: "insurer_panel", label: "Insurer panel agreed", help: "At least one licensed insurer has appointed brokers for this category." },
  { key: "data_owner", label: "Product-data owner named", help: "Someone at each insurer owns rates, limits and exclusions." },
  { key: "approved_wording", label: "Approved policy wording", help: "Wordings approved by the insurer and filed with NIC." },
  { key: "quote_method", label: "Quote method", help: "Rating rules, quote API or broker-prepared quotes agreed." },
  { key: "payment_route", label: "Payment route", help: "Authorised provider settling directly to the insurer." },
  { key: "issuance_process", label: "Issuance process", help: "How and when the insurer issues policy documents." },
  { key: "claims_procedure", label: "Claims procedure", help: "How claims are notified, assessed and paid." },
] as const;
export type LaunchKey = (typeof LAUNCH_CHECKLIST)[number]["key"];

export const DOCUMENT_KINDS: Enum<"document_kind">[] = [
  "id_document", "vehicle_registration", "drivers_licence", "photo", "proof_of_address", "medical", "policy_schedule", "certificate",
  "policy_wording", "receipt", "endorsement", "claim_evidence", "police_report", "invoice", "other",
];

export const RISK_FIELD_TYPES = ["text", "number", "currency", "select", "multiselect", "boolean", "date", "region"] as const;

/** Validates product_categories.risk_schema (shared with web and mobile forms via @im/core RiskField). */
export const RiskFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "Field keys must be snake_case (a-z, 0-9, _), starting with a letter"),
    label: z.string().trim().min(1, "Every field needs a label").max(120),
    type: z.enum(RISK_FIELD_TYPES),
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    placeholder: z.string().max(120).optional(),
    help: z.string().max(300).optional(),
    options: z.array(z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(120) })).optional(),
  })
  .refine((f) => !(f.type === "select" || f.type === "multiselect") || (f.options?.length ?? 0) > 0, {
    message: "Select fields need at least one option",
  })
  .refine((f) => f.min === undefined || f.max === undefined || f.min <= f.max, { message: "min must be ≤ max" });

export const RiskSchemaSchema = z
  .array(RiskFieldSchema)
  .max(40, "Keep risk forms to 40 fields or fewer")
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, { message: "Field keys must be unique" });
