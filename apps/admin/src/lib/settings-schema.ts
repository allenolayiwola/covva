import { z } from "zod";

const modelId = z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._:-]+$/, "Model ids look like provider/model, e.g. anthropic/claude-sonnet-5.5");

/** Validation for platform_settings keys the apps rely on. Unknown keys accept any JSON. */
export const KNOWN_SETTINGS: Record<string, { schema: z.ZodType; hint: string; example: unknown }> = {
  brand: {
    schema: z
      .object({
        name: z.string().min(1),
        tagline: z.string().optional(),
        working_name: z.boolean().optional(),
        support_email: z.string().email().optional(),
        support_phone: z.string().optional(),
      })
      .passthrough(),
    hint: "Platform name and support contacts shown across the apps.",
    example: { name: "Covva", tagline: "…", support_email: "support@example.com", support_phone: "+233…" },
  },
  disclosure_template: {
    schema: z
      .object({ text: z.string().min(20) })
      .passthrough()
      .refine((v) => ["{platform}", "{broker}", "{insurer}"].every((t) => v.text.includes(t)), "The disclosure must include {platform}, {broker} and {insurer}"),
    hint: "Mandatory transaction disclosure. Must name the platform, broker (with licence) and insurer.",
    example: { text: "Technology provided by {platform}. Insurance broking services provided by {broker}, NIC licence {broker_licence}. This policy is underwritten and issued by {insurer}." },
  },
  complaints: {
    schema: z
      .object({
        email: z.string().email().nullable().optional(),
        phone: z.string().nullable().optional(),
        nic_name: z.string().optional(),
        nic_phone: z.string().nullable().optional(),
        nic_email: z.string().email().nullable().optional(),
        nic_url: z.string().url().optional(),
      })
      .passthrough(),
    hint: "Complaints contacts shown on every quote and policy (Addendum 2 G): platform complaints email/phone and the NIC complaints line. Confirm nic_phone with the NIC before launch.",
    example: { email: "complaints@covva.com.gh", phone: "+233…", nic_name: "NIC Complaints Bureau", nic_phone: "+233…", nic_url: "https://nic.gov.gh" },
  },
  terms_version: { schema: z.string().min(1).max(40), hint: "Current customer terms version. Changing it asks customers to accept again.", example: "2026-10-v1" },
  privacy_version: { schema: z.string().min(1).max(40), hint: "Current privacy notice version.", example: "2026-10-v1" },
  privacy_request_due_days: {
    schema: z.number().int().min(1).max(90),
    hint: "Days Covva gives itself to answer an Act 843 privacy request (default 30). The statutory deadline is to be confirmed with counsel.",
    example: 30,
  },
  privacy_export_ttl_days: {
    schema: z.number().int().min(1).max(30),
    hint: "Days a generated personal-data export stays downloadable before the retention job deletes it.",
    example: 7,
  },
  privacy_retention: {
    schema: z
      .object({
        mode: z.enum(["dry_run", "enforce"]),
        periods: z.record(z.string(), z.number().int().min(30).max(3650)).optional(),
      })
      .passthrough(),
    hint: "Retention job (docs/PRIVACY_REQUESTS.md). mode dry_run only reports; enforce erases. periods override the default days per data class (min 30). Switch to enforce once the periods are confirmed with counsel.",
    example: { mode: "dry_run", periods: { ai_chat_logs: 365, unconverted_leads: 730 } },
  },
  complaint_sla_days: { schema: z.number().int().min(1).max(90), hint: "Days to resolve a complaint before escalation.", example: 14 },
  renewal_reminder_days: {
    schema: z
      .array(z.number().int().min(1).max(365))
      .min(1)
      .refine((a) => new Set(a).size === a.length, "Days must be unique"),
    hint: "Days before expiry when renewal reminders are sent.",
    example: [45, 30, 14, 7, 1],
  },
  quote_validity_days: { schema: z.number().int().min(1).max(90), hint: "Default validity of binding quotes.", example: 14 },
  ai_models: { schema: z.object({ default: modelId, fast: modelId, vision: modelId.optional() }).passthrough(), hint: "AI Gateway model ids per tier (default, fast, vision).", example: { default: "anthropic/claude-sonnet-5.5", fast: "anthropic/claude-haiku-5.5", vision: "anthropic/claude-sonnet-5.5" } },
  invoice_tax_rate: { schema: z.number().min(0).max(1), hint: "Tax rate applied to new invoices (0–1, e.g. 0.219).", example: 0 },
};

export const READ_ONLY_PREFIXES = ["cron_last_run:"];
