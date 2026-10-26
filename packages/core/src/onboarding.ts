/**
 * Partner self-service onboarding rules (Addendum 3 B1 / C1 / C4, Addendum 2 C):
 * application schema, step completeness, licence status and the broker client-import CSV parser.
 * Pure functions: shared by the web registration flow, the admin review screens and tests.
 */
import { z } from "zod";

export type PartnerApplicationType = "insurer" | "broker";

export const APPLICATION_STEPS = ["company", "licence", "contacts", "settlement", "documents", "integration", "commercial", "agreement", "review"] as const;
export type ApplicationStep = (typeof APPLICATION_STEPS)[number];

export const STEP_LABELS: Record<ApplicationStep, string> = {
  company: "Company",
  licence: "NIC licence",
  contacts: "Contacts",
  settlement: "Settlement account",
  documents: "Documents",
  integration: "Integration levels",
  commercial: "Commercial model",
  agreement: "Partner agreement",
  review: "Review & submit",
};

/** Steps in order for one applicant type (insurers choose integration levels; brokers a commercial model). */
export function stepsFor(type: PartnerApplicationType): ApplicationStep[] {
  return APPLICATION_STEPS.filter((s) => (s === "integration" ? type === "insurer" : s === "commercial" ? type === "broker" : true));
}

export const NIC_LICENCE_CLASSES = ["life", "non_life", "composite", "broker"] as const;
export type NicLicenceClass = (typeof NIC_LICENCE_CLASSES)[number];
export const APPLICATION_DOCUMENT_KINDS = ["nic_licence", "incorporation", "partner_agreement", "other"] as const;
export type ApplicationDocumentKind = (typeof APPLICATION_DOCUMENT_KINDS)[number];
export const INTEGRATION_LEVELS = ["L1", "L2", "L3"] as const;
export const COMMERCIAL_MODELS = ["revenue_share", "subscription"] as const;
export const MOMO_NETWORKS = ["MTN", "Telecel", "AirtelTigo"] as const;

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined));

const email = z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid email address"));
const phone = z.string().trim().max(40).regex(/^[+()\d\s-]{7,20}$/, "Enter a valid phone number, for example 024 123 4567");

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(120),
  email,
  phone: phone.optional().or(z.literal("").transform(() => undefined)),
  title: optional(80),
});
export type ApplicationContact = z.infer<typeof contactSchema>;

export const settlementAccountSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bank"),
    bank_name: z.string().trim().min(2, "Enter the bank name").max(120),
    account_name: z.string().trim().min(2, "Enter the account name").max(160),
    account_number: z.string().trim().regex(/^[\d\s-]{6,24}$/, "Enter a valid account number"),
  }),
  z.object({
    type: z.literal("momo"),
    account_name: z.string().trim().min(2, "Enter the registered name").max(160),
    momo_network: z.enum(MOMO_NETWORKS, { error: "Choose a mobile money network" }),
    momo_number: phone,
  }),
]);
export type SettlementAccount = z.infer<typeof settlementAccountSchema>;

export const integrationLevelSchema = z.object({ category_slug: z.string().trim().min(1).max(60), level: z.enum(INTEGRATION_LEVELS) });
export const applicationDocumentSchema = z.object({
  kind: z.enum(APPLICATION_DOCUMENT_KINDS),
  storage_path: z.string().min(1).max(500),
  name: z.string().min(1).max(200),
  uploaded_at: z.string().min(1),
});
export const agreementSignatureSchema = z.object({
  version: z.string().min(1),
  signed_name: z.string().trim().min(2).max(120),
  signed_title: z.string().trim().max(80).optional(),
  signed_at: z.string().min(1),
  ip: z.string().max(64).optional(),
  user_agent: z.string().max(400).optional(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  provider: z.string().max(40).optional(),
});

export const companySchema = z.object({
  company_name: z.string().trim().min(2, "Enter the trading name").max(160),
  legal_name: optional(200),
  registration_number: optional(60),
  address: z.string().trim().min(4, "Enter the registered address").max(400),
  region: z.string().trim().min(2, "Choose a region").max(60),
  website: optional(200).pipe(z.string().url("Enter a full web address, e.g. https://example.com").optional()),
});

export const licenceSchema = z.object({
  nic_licence_number: z.string().trim().min(3, "Enter the NIC licence number").max(60),
  nic_licence_class: z.enum(NIC_LICENCE_CLASSES, { error: "Choose the licence class" }),
  nic_licence_expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the expiry date shown on the licence"),
});

/** Whole application as stored (jsonb columns parsed). Used by `applicationCompleteness` and the admin view. */
export const applicationSchema = z
  .object({
    type: z.enum(["insurer", "broker"]),
    company_name: companySchema.shape.company_name.nullable().optional(),
    legal_name: z.string().nullable().optional(),
    registration_number: z.string().nullable().optional(),
    nic_licence_number: z.string().nullable().optional(),
    nic_licence_class: z.enum(NIC_LICENCE_CLASSES).nullable().optional(),
    nic_licence_expires_on: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    primary_contact: contactSchema.partial().nullable().optional(),
    compliance_contact: contactSchema.partial().nullable().optional(),
    principal_officer: contactSchema.partial().nullable().optional(),
    settlement_account: z.union([settlementAccountSchema, z.object({}).passthrough()]).nullable().optional(),
    commercial_model: z.enum(COMMERCIAL_MODELS).nullable().optional(),
    integration_levels: z.array(integrationLevelSchema).nullable().optional(),
    documents: z.array(applicationDocumentSchema).nullable().optional(),
    agreement: z.union([agreementSignatureSchema, z.object({}).passthrough()]).nullable().optional(),
  })
  .passthrough();
export type PartnerApplicationInput = z.input<typeof applicationSchema>;

export interface MissingStep {
  step: ApplicationStep;
  label: string;
  reason: string;
}

const isSigned = (a: unknown): boolean => agreementSignatureSchema.safeParse(a).success;
const hasKind = (docs: unknown, kind: ApplicationDocumentKind) =>
  Array.isArray(docs) && docs.some((d) => d && typeof d === "object" && (d as { kind?: string }).kind === kind && (d as { storage_path?: string }).storage_path);

/** What still has to be done before an application can be submitted (in step order). */
export function applicationCompleteness(app: PartnerApplicationInput): { complete: boolean; missing: MissingStep[] } {
  const missing: MissingStep[] = [];
  const add = (step: ApplicationStep, reason: string) => missing.push({ step, label: STEP_LABELS[step], reason });

  const company = companySchema.safeParse({
    company_name: app.company_name ?? "",
    legal_name: app.legal_name ?? undefined,
    registration_number: app.registration_number ?? undefined,
    address: app.address ?? "",
    region: app.region ?? "",
    website: app.website ?? undefined,
  });
  if (!company.success) add("company", company.error.issues[0]?.message ?? "Company details are incomplete");

  const licence = licenceSchema.safeParse({
    nic_licence_number: app.nic_licence_number ?? "",
    nic_licence_class: app.nic_licence_class ?? undefined,
    nic_licence_expires_on: app.nic_licence_expires_on ?? "",
  });
  if (!licence.success) add("licence", licence.error.issues[0]?.message ?? "Licence details are incomplete");
  else if (app.type === "broker" && licence.data.nic_licence_class !== "broker") add("licence", "A broker registers with a broker-class licence");
  else if (app.type === "insurer" && licence.data.nic_licence_class === "broker") add("licence", "An insurer registers with a life, non-life or composite licence");
  else if (licence.data.nic_licence_expires_on < new Date().toISOString().slice(0, 10)) add("licence", "The licence on record has already expired");

  const primary = contactSchema.safeParse(app.primary_contact ?? {});
  if (!primary.success) add("contacts", "Primary contact: " + (primary.error.issues[0]?.message ?? "incomplete"));
  if (app.type === "insurer") {
    const compliance = contactSchema.safeParse(app.compliance_contact ?? {});
    if (!compliance.success) add("contacts", "Compliance contact: " + (compliance.error.issues[0]?.message ?? "incomplete"));
  } else {
    const officer = contactSchema.safeParse(app.principal_officer ?? {});
    if (!officer.success) add("contacts", "Principal officer: " + (officer.error.issues[0]?.message ?? "incomplete"));
  }

  const settlement = settlementAccountSchema.safeParse(app.settlement_account ?? {});
  if (!settlement.success) add("settlement", "Add the bank or mobile money account that receives settlements");

  if (!hasKind(app.documents, "nic_licence")) add("documents", "Upload a copy of the NIC licence");
  if (!hasKind(app.documents, "incorporation")) add("documents", "Upload the certificate of incorporation");

  if (app.type === "insurer") {
    const levels = Array.isArray(app.integration_levels) ? app.integration_levels : [];
    if (!levels.length) add("integration", "Choose at least one product line and its integration level");
  } else if (!app.commercial_model) {
    add("commercial", "Choose revenue share or a subscription plan");
  }

  if (!isSigned(app.agreement)) add("agreement", "Sign the partner agreement");

  return { complete: missing.length === 0, missing };
}

/** The step to open next: the first incomplete one, or review when everything is done. */
export function nextStep(app: PartnerApplicationInput, after?: ApplicationStep): ApplicationStep {
  const order = stepsFor(app.type);
  const { missing } = applicationCompleteness(app);
  const start = after ? order.indexOf(after) + 1 : 0;
  for (let i = start; i < order.length; i++) {
    const s = order[i]!;
    if (s === "review") return "review";
    if (missing.some((m) => m.step === s)) return s;
  }
  return "review";
}

export type LicenceStatus = "unverified" | "verified" | "expiring" | "lapsed";

/**
 * Licence status from the expiry date alone (the DB adds the "verified by staff" dimension):
 * null → unverified; past → lapsed; within `warnDays` → expiring; otherwise verified.
 */
export function licenceStatusFor(expiresOn: string | Date | null | undefined, today: string | Date = new Date(), warnDays = 30): LicenceStatus {
  if (!expiresOn) return "unverified";
  const exp = typeof expiresOn === "string" ? Date.parse(`${expiresOn.slice(0, 10)}T00:00:00Z`) : Date.UTC(expiresOn.getUTCFullYear(), expiresOn.getUTCMonth(), expiresOn.getUTCDate());
  const t = typeof today === "string" ? Date.parse(`${today.slice(0, 10)}T00:00:00Z`) : Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (Number.isNaN(exp) || Number.isNaN(t)) return "unverified";
  if (exp < t) return "lapsed";
  if (exp <= t + warnDays * 86_400_000) return "expiring";
  return "verified";
}

// ---------------------------------------------------------------------------
// Broker client import (CSV)
// ---------------------------------------------------------------------------
export interface ClientImportRow {
  /** 1-based line number in the file (the header is line 1). */
  row: number;
  name: string;
  phone?: string;
  email?: string;
  policy_number?: string;
  insurer_name?: string;
  category_slug?: string;
  cover_end?: string;
}
export interface ClientImportError {
  row: number;
  message: string;
}
export interface ClientImportResult {
  rows: ClientImportRow[];
  errors: ClientImportError[];
  /** Columns found in the header, after normalisation. */
  columns: string[];
}

export const CLIENT_IMPORT_COLUMNS = ["name", "phone", "email", "policy_number", "insurer_name", "category", "cover_end"] as const;
export const CLIENT_IMPORT_TEMPLATE = `${CLIENT_IMPORT_COLUMNS.join(",")}\nAma Mensah,0241234567,ama@example.com,POL-12345,Star Assurance,motor,2027-03-31\n`;

const HEADER_ALIASES: Record<string, (typeof CLIENT_IMPORT_COLUMNS)[number]> = {
  name: "name", "full name": "name", "customer name": "name", client: "name", "client name": "name", customer: "name",
  phone: "phone", mobile: "phone", "phone number": "phone", telephone: "phone", msisdn: "phone",
  email: "email", "email address": "email", "e-mail": "email",
  policy_number: "policy_number", "policy number": "policy_number", policy: "policy_number", "policy no": "policy_number", "policy no.": "policy_number",
  insurer_name: "insurer_name", insurer: "insurer_name", "insurer name": "insurer_name", company: "insurer_name", underwriter: "insurer_name",
  category: "category", line: "category", "product line": "category", product: "category", class: "category", category_slug: "category",
  cover_end: "cover_end", "cover end": "cover_end", expiry: "cover_end", "expiry date": "cover_end", "end date": "cover_end", expires: "cover_end", "renewal date": "cover_end",
};

/**
 * RFC 4180-ish CSV splitting: quotes, escaped quotes, commas/newlines inside quotes, CRLF.
 * Unlike `parseCsv` (rate tables) blank lines are kept so error row numbers match the file.
 */
export function parseCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, " ");
export const normalisePhone = (p: string) => {
  const digits = p.replace(/[^\d+]/g, "");
  if (/^\+233\d{9}$/.test(digits)) return digits;
  if (/^233\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+233${digits.slice(1)}`;
  return digits;
};
export const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}
const validDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/**
 * Parse a broker's client list. Returns valid rows and row-numbered errors (invalid rows are
 * skipped, never partially imported). Duplicates inside the file (same email or phone) are errors.
 */
export function parseClientImportCsv(text: string, opts: { maxRows?: number } = {}): ClientImportResult {
  const max = opts.maxRows ?? 2000;
  const table = parseCsvLines(text);
  const errors: ClientImportError[] = [];
  const rows: ClientImportRow[] = [];
  if (!table.some((r) => r.some((c) => c.trim() !== ""))) return { rows, errors: [{ row: 1, message: "The file is empty" }], columns: [] };

  const header = table[0]!.map(normaliseHeader);
  const map: (string | null)[] = header.map((h) => HEADER_ALIASES[h] ?? null);
  const columns = map.filter((c): c is string => !!c);
  if (!columns.includes("name")) return { rows, errors: [{ row: 1, message: `A "name" column is required (found: ${table[0]!.join(", ") || "nothing"})` }], columns };
  if (!columns.includes("phone") && !columns.includes("email")) return { rows, errors: [{ row: 1, message: 'A "phone" or "email" column is required' }], columns };

  const seen = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const rowNo = i + 1;
    if (rows.length + errors.length >= max) {
      errors.push({ row: rowNo, message: `Only the first ${max} rows are processed per file` });
      break;
    }
    const cells = table[i]!;
    if (!cells.some((c) => c.trim() !== "")) continue;
    const get = (col: string) => {
      const idx = map.indexOf(col);
      return idx === -1 ? "" : (cells[idx] ?? "").trim();
    };
    const name = get("name").replace(/\s+/g, " ");
    const email = get("email").toLowerCase();
    const phoneRaw = get("phone");
    const problems: string[] = [];
    if (name.length < 2) problems.push("name is missing");
    if (!email && !phoneRaw) problems.push("phone or email is required");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`email "${email}" is not valid`);
    const phone = phoneRaw ? normalisePhone(phoneRaw) : "";
    if (phoneRaw && !/^\+?\d{9,15}$/.test(phone)) problems.push(`phone "${phoneRaw}" is not valid`);
    const policy = get("policy_number");
    const insurer = get("insurer_name");
    if (policy && !insurer) problems.push("insurer_name is required when a policy number is given");
    const category = get("category") ? slugify(get("category")) : "";
    if (policy && !category) problems.push("category is required when a policy number is given");
    const coverRaw = get("cover_end");
    let cover: string | undefined;
    if (coverRaw) {
      const iso = normaliseDate(coverRaw);
      if (!iso || !validDate(iso)) problems.push(`cover_end "${coverRaw}" is not a date (use YYYY-MM-DD)`);
      else cover = iso;
    }
    for (const key of [email && `e:${email}`, phone && `p:${phone}`].filter(Boolean) as string[]) {
      const first = seen.get(key);
      if (first !== undefined) problems.push(`duplicate of row ${first}`);
      else seen.set(key, rowNo);
    }
    if (problems.length) {
      errors.push({ row: rowNo, message: problems.join("; ") });
      continue;
    }
    rows.push({
      row: rowNo,
      name,
      phone: phone || undefined,
      email: email || undefined,
      policy_number: policy || undefined,
      insurer_name: insurer || undefined,
      category_slug: category || undefined,
      cover_end: cover,
    });
  }
  return { rows, errors, columns };
}
