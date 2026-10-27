import { z } from "zod";

/**
 * Endorsements (Roadmap Phase 3): structured mid-term changes to a policy — change the vehicle,
 * add a driver, change the address, raise the sum insured, add a family member, cancel.
 *
 * The customer (or the broker of record) describes the change; the broker or the insurer quotes
 * the premium adjustment; ONLY THE INSURER accepts, rejects and applies it to the policy. Prices
 * computed here (pro rata) are indicative proposals until the insurer confirms them.
 */

export const ENDORSEMENT_KIND_VALUES = [
  "change_vehicle",
  "add_driver",
  "remove_driver",
  "change_address",
  "change_sum_insured",
  "add_member",
  "remove_member",
  "change_use",
  "cancel_policy",
  "other",
] as const;
export type EndorsementKind = (typeof ENDORSEMENT_KIND_VALUES)[number];

export const ENDORSEMENT_STATUS_VALUES = ["draft", "submitted", "quoted", "accepted", "rejected", "applied", "cancelled"] as const;
export type EndorsementStatus = (typeof ENDORSEMENT_STATUS_VALUES)[number];

export const ENDORSEMENT_STATUS: Record<EndorsementStatus, { label: string; tone: "neutral" | "info" | "wait" | "ok" | "danger"; hint: string }> = {
  draft: { label: "Draft", tone: "neutral", hint: "Not sent yet." },
  submitted: { label: "With your broker / insurer", tone: "wait", hint: "Your broker or insurer is reviewing the change and any change in premium." },
  quoted: { label: "Price confirmed — your answer needed", tone: "info", hint: "Check the change in premium and agree to it so the insurer can confirm the change." },
  accepted: { label: "Accepted by the insurer", tone: "wait", hint: "The insurer has accepted the change and will update your policy documents." },
  rejected: { label: "Not accepted", tone: "danger", hint: "The insurer could not accept this change. Your cover continues unchanged." },
  applied: { label: "Policy updated", tone: "ok", hint: "The insurer has updated your policy. Your new documents are in your wallet." },
  cancelled: { label: "Withdrawn", tone: "neutral", hint: "This change was withdrawn. Your cover continues unchanged." },
};

export type EndorsementFieldType = "text" | "number" | "date" | "select" | "textarea";
export interface EndorsementField {
  key: string;
  label: string;
  type: EndorsementFieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  /** Prefill from the policy's current risk under this key. */
  riskKey?: string;
}

export interface EndorsementKindDef {
  kind: EndorsementKind;
  label: string;
  description: string;
  /** Category slugs the change applies to; "all" = every category. */
  categories: readonly string[] | "all";
  fields: EndorsementField[];
  schema: z.ZodObject<z.ZodRawShape>;
}

const text = (max = 200) => z.string().trim().min(1, "Required").max(max);
const optText = (max = 500) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const money = z.coerce.number({ message: "Enter an amount" }).positive("Enter an amount above zero").max(1_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const thisYear = new Date().getUTCFullYear();

const MOTOR_USE = [
  { value: "private", label: "Private use" },
  { value: "commercial", label: "Commercial / business use" },
  { value: "ride_hailing", label: "Taxi or ride-hailing" },
];

/** Where a category keeps the value the sum insured applies to (the rating engine reads these keys). */
export const SUM_INSURED_FIELD: Record<string, string> = {
  motor: "vehicle_value",
  home: "building_value",
  "sme-property": "premises_value",
  "personal-accident": "sum_insured",
  "life-funeral": "sum_insured",
  "marine-cargo": "cargo_value",
};

const MEMBER_FIELD: Record<string, string> = { health: "members", "life-funeral": "family_members" };

export const ENDORSEMENT_KINDS: Record<EndorsementKind, EndorsementKindDef> = {
  change_vehicle: {
    kind: "change_vehicle",
    label: "Change vehicle",
    description: "You have replaced the car this policy covers.",
    categories: ["motor"],
    fields: [
      { key: "registration_number", label: "Registration number", type: "text", required: true, riskKey: "registration_number", hint: "e.g. GR 1234-24" },
      { key: "vehicle_make", label: "Make", type: "text", required: true, riskKey: "vehicle_make" },
      { key: "vehicle_model", label: "Model", type: "text", required: true, riskKey: "vehicle_model" },
      { key: "vehicle_year", label: "Year of manufacture", type: "number", required: true, riskKey: "vehicle_year" },
      { key: "vehicle_value", label: "Value (GHS)", type: "number", required: true, riskKey: "vehicle_value" },
    ],
    schema: z.object({
      registration_number: text(20),
      vehicle_make: text(60),
      vehicle_model: text(60),
      vehicle_year: z.coerce.number().int().min(1950, "Check the year").max(thisYear + 1, "Check the year"),
      vehicle_value: money,
    }),
  },
  add_driver: {
    kind: "add_driver",
    label: "Add a driver",
    description: "Someone else will drive the car regularly.",
    categories: ["motor"],
    fields: [
      { key: "driver_name", label: "Full name", type: "text", required: true },
      { key: "date_of_birth", label: "Date of birth", type: "date", required: true },
      { key: "licence_number", label: "Driving licence number", type: "text", required: true },
      { key: "years_licensed", label: "Years licensed", type: "number", required: true },
    ],
    schema: z.object({
      driver_name: text(120),
      date_of_birth: isoDate,
      licence_number: text(40),
      years_licensed: z.coerce.number().int().min(0).max(80),
    }),
  },
  remove_driver: {
    kind: "remove_driver",
    label: "Remove a driver",
    description: "A named driver no longer drives the car.",
    categories: ["motor"],
    fields: [
      { key: "driver_name", label: "Driver to remove", type: "text", required: true },
      { key: "reason", label: "Reason (optional)", type: "textarea" },
    ],
    schema: z.object({ driver_name: text(120), reason: optText() }),
  },
  change_address: {
    kind: "change_address",
    label: "Change address",
    description: "You have moved, or the insured property's address was wrong.",
    categories: "all",
    fields: [
      { key: "address", label: "New address", type: "textarea", required: true },
      { key: "city", label: "Town or city", type: "text", required: true },
      { key: "region", label: "Region", type: "text", required: true, riskKey: "region" },
    ],
    schema: z.object({ address: text(400), city: text(80), region: text(80) }),
  },
  change_sum_insured: {
    kind: "change_sum_insured",
    label: "Change sum insured",
    description: "What you're insured for no longer matches the value.",
    categories: Object.keys(SUM_INSURED_FIELD),
    fields: [
      { key: "sum_insured", label: "New sum insured (GHS)", type: "number", required: true },
      { key: "reason", label: "Why it changed (optional)", type: "textarea", hint: "e.g. renovation, new valuation" },
    ],
    schema: z.object({ sum_insured: money, reason: optText() }),
  },
  add_member: {
    kind: "add_member",
    label: "Add a member",
    description: "Add a family member or employee to group or family cover.",
    categories: Object.keys(MEMBER_FIELD),
    fields: [
      { key: "member_name", label: "Full name", type: "text", required: true },
      { key: "date_of_birth", label: "Date of birth", type: "date", required: true },
      {
        key: "relationship",
        label: "Relationship",
        type: "select",
        required: true,
        options: [
          { value: "spouse", label: "Spouse" },
          { value: "child", label: "Child" },
          { value: "parent", label: "Parent" },
          { value: "employee", label: "Employee" },
          { value: "other", label: "Other" },
        ],
      },
    ],
    schema: z.object({ member_name: text(120), date_of_birth: isoDate, relationship: z.enum(["spouse", "child", "parent", "employee", "other"]) }),
  },
  remove_member: {
    kind: "remove_member",
    label: "Remove a member",
    description: "Someone no longer needs to be covered.",
    categories: Object.keys(MEMBER_FIELD),
    fields: [
      { key: "member_name", label: "Member to remove", type: "text", required: true },
      { key: "reason", label: "Reason (optional)", type: "textarea" },
    ],
    schema: z.object({ member_name: text(120), reason: optText() }),
  },
  change_use: {
    kind: "change_use",
    label: "Change how the car is used",
    description: "For example, you now use the car for business or ride-hailing.",
    categories: ["motor"],
    fields: [{ key: "use", label: "New use", type: "select", required: true, options: MOTOR_USE, riskKey: "use" }],
    schema: z.object({ use: z.enum(["private", "commercial", "ride_hailing"]) }),
  },
  cancel_policy: {
    kind: "cancel_policy",
    label: "Cancel the policy",
    description: "Ask the insurer to end cover early. Any refund is decided by the insurer.",
    categories: "all",
    fields: [{ key: "reason", label: "Why you want to cancel", type: "textarea", required: true }],
    schema: z.object({ reason: text(1000) }),
  },
  other: {
    kind: "other",
    label: "Something else",
    description: "Describe the change and your broker will take it from there.",
    categories: "all",
    fields: [{ key: "description", label: "What needs to change", type: "textarea", required: true }],
    schema: z.object({ description: text(2000) }),
  },
};

export function isEndorsementKind(v: unknown): v is EndorsementKind {
  return typeof v === "string" && (ENDORSEMENT_KIND_VALUES as readonly string[]).includes(v);
}

/** Kinds available for a category, in display order. */
export function endorsementKindsFor(categorySlug: string | null | undefined): EndorsementKindDef[] {
  return ENDORSEMENT_KIND_VALUES.map((k) => ENDORSEMENT_KINDS[k]).filter((d) => d.categories === "all" || (!!categorySlug && d.categories.includes(categorySlug)));
}

/** The zod schema for the `after` values of a change, or null when the kind doesn't apply to the category. */
export function endorsementSchemaFor(categorySlug: string | null | undefined, kind: string): z.ZodObject<z.ZodRawShape> | null {
  if (!isEndorsementKind(kind)) return null;
  const def = ENDORSEMENT_KINDS[kind];
  if (def.categories !== "all" && (!categorySlug || !def.categories.includes(categorySlug))) return null;
  return def.schema;
}

const ageOn = (dob: string, on: string): number | null => {
  const b = Date.parse(`${dob}T00:00:00Z`);
  const d = Date.parse(`${on}T00:00:00Z`);
  if (Number.isNaN(b) || Number.isNaN(d)) return null;
  const birth = new Date(b);
  const at = new Date(d);
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  if (at.getUTCMonth() < birth.getUTCMonth() || (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate())) age--;
  return age;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * The risk as it will be after the change, for re-running underwriting rules and the rating engine.
 * Only keys the rating rules and underwriting conditions read are touched.
 */
export function riskAfterEndorsement(categorySlug: string | null | undefined, kind: EndorsementKind, risk: Record<string, unknown>, after: Record<string, unknown>, effectiveFrom?: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...risk };
  switch (kind) {
    case "change_vehicle":
      for (const k of ["registration_number", "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_value"]) if (after[k] !== undefined) next[k] = after[k];
      break;
    case "add_driver": {
      const age = typeof after.date_of_birth === "string" ? ageOn(after.date_of_birth, effectiveFrom ?? new Date().toISOString().slice(0, 10)) : null;
      const current = num(risk.driver_age);
      // Rating and rules look at the youngest regular driver.
      if (age !== null) next.driver_age = current === null ? age : Math.min(current, age);
      next.additional_drivers = (num(risk.additional_drivers) ?? 0) + 1;
      break;
    }
    case "remove_driver":
      next.additional_drivers = Math.max(0, (num(risk.additional_drivers) ?? 1) - 1);
      break;
    case "change_address":
      if (after.region !== undefined) next.region = after.region;
      break;
    case "change_sum_insured": {
      const field = categorySlug ? SUM_INSURED_FIELD[categorySlug] : undefined;
      if (field && after.sum_insured !== undefined) next[field] = num(after.sum_insured);
      break;
    }
    case "add_member":
    case "remove_member": {
      const field = categorySlug ? MEMBER_FIELD[categorySlug] : undefined;
      if (field) next[field] = Math.max(1, (num(risk[field]) ?? 1) + (kind === "add_member" ? 1 : -1));
      if (kind === "add_member" && typeof after.date_of_birth === "string" && categorySlug === "health") {
        const age = ageOn(after.date_of_birth, effectiveFrom ?? new Date().toISOString().slice(0, 10));
        const oldest = num(risk.oldest_member_age);
        if (age !== null) next.oldest_member_age = oldest === null ? age : Math.max(oldest, age);
      }
      break;
    }
    case "change_use":
      if (after.use !== undefined) next.use = after.use;
      break;
    default:
      break;
  }
  return next;
}

/** The current values of the fields a change touches (the "before" side), taken from the policy's risk. */
export function beforeValues(kind: EndorsementKind, categorySlug: string | null | undefined, risk: Record<string, unknown>, policy: { sum_insured?: number | string | null } = {}): Record<string, unknown> {
  const def = ENDORSEMENT_KINDS[kind];
  const out: Record<string, unknown> = {};
  for (const f of def.fields) if (f.riskKey && risk[f.riskKey] !== undefined) out[f.key] = risk[f.riskKey];
  if (kind === "change_sum_insured") {
    const field = categorySlug ? SUM_INSURED_FIELD[categorySlug] : undefined;
    out.sum_insured = policy.sum_insured != null ? Number(policy.sum_insured) : field ? risk[field] ?? null : null;
  }
  return out;
}

export interface ProRata {
  /** Pro-rata premium adjustment in GHS: positive = additional premium, negative = refund. */
  amount: number;
  /** Days from the effective date to the end of cover (both inclusive). */
  daysRemaining: number;
  /** Days in the policy year used as the denominator. */
  daysInTerm: number;
  factor: number;
}

const DAY = 86_400_000;

/**
 * Pro-rata adjustment for a mid-term change: (new annual − old annual) × days remaining / term days,
 * computed in pesewas so the result is exact to the pesewa (half away from zero). A change effective
 * after cover ends is 0; one effective before cover starts is treated as the full term.
 */
export function proRataAdjustment(annualPremiumOld: number, annualPremiumNew: number, effectiveFrom: string, coverEnd: string, opts: { coverStart?: string | null; daysInTerm?: number } = {}): ProRata {
  const from = Date.parse(`${effectiveFrom.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${coverEnd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(end)) throw new Error("Invalid effective or cover end date");
  const start = opts.coverStart ? Date.parse(`${opts.coverStart.slice(0, 10)}T00:00:00Z`) : NaN;
  const term = opts.daysInTerm ?? (Number.isNaN(start) ? 365 : Math.max(1, Math.round((end - start) / DAY) + 1));
  const effective = Number.isNaN(start) ? from : Math.max(from, start);
  const daysRemaining = Math.max(0, Math.min(term, Math.round((end - effective) / DAY) + 1));
  const diffMinor = Math.round(annualPremiumNew * 100) - Math.round(annualPremiumOld * 100);
  const raw = (diffMinor * daysRemaining) / term;
  const minor = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  const amount = minor / 100;
  return { amount: Object.is(amount, -0) ? 0 : amount, daysRemaining, daysInTerm: term, factor: Math.round((daysRemaining / term) * 10_000) / 10_000 };
}

const FIELD_LABEL: Record<string, string> = {};
for (const def of Object.values(ENDORSEMENT_KINDS)) for (const f of def.fields) FIELD_LABEL[f.key] ??= f.label;

const label = (key: string) => FIELD_LABEL[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export interface ChangeLine { key: string; label: string; before: string; after: string }

/** Plain before → after lines for the fields that differ (keys present in `after`, in its order). */
export function describeChanges(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined): ChangeLine[] {
  const b = before ?? {};
  const a = after ?? {};
  const out: ChangeLine[] = [];
  for (const key of Object.keys(a)) {
    const from = show(b[key]);
    const to = show(a[key]);
    if (from === to) continue;
    out.push({ key, label: label(key), before: from, after: to });
  }
  return out;
}

/** "Additional premium GHS 120.00" / "Refund GHS 40.00" / "No change in premium". */
export function adjustmentLabel(amount: number | string | null | undefined, currency = "GHS"): string {
  if (amount === null || amount === undefined || amount === "") return "Your insurer will confirm any change in premium";
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return "No change in premium";
  return `${n > 0 ? "Additional premium" : "Refund"} ${currency} ${Math.abs(n).toFixed(2)}`;
}
