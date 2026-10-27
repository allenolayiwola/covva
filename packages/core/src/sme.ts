/**
 * SME & group (Roadmap Phase 3): business accounts, group scheme census, fleet lists and consolidated billing.
 *
 * Pure helpers shared by the web app, the mobile API and the admin console:
 * - `parseMemberCsv` / `parseFleetCsv` — bulk upload with row-numbered errors and duplicate detection
 *   (Ghana phone and registration normalisation reuse `normalisePhone` / `normaliseRegistration`).
 * - `groupComplexity` — the risk keys the routing engine reads (`lives`, `fleet_size`) plus the flags it will raise.
 * - `censusSummary` — counts by age band / tier / relationship / gender for insurer quoting (no PII).
 * - `consolidateInvoice` — one statement, one line per policy, grouped by insurer. Each insurer is paid separately
 *   (its own `payments` row, settling to its own subaccount): Covva never holds or pools client funds.
 */
import { parseCsvLines, normalisePhone } from "./onboarding";
import { normaliseRegistration } from "./vehicle";
import { DEFAULT_COMPLEXITY_THRESHOLDS, type ComplexityFlag, type ComplexityThresholds } from "./routing-engine";

// ---------------------------------------------------------------------------
// Business roles
// ---------------------------------------------------------------------------
export const BUSINESS_ROLES = ["owner", "admin", "finance", "viewer"] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const BUSINESS_ROLE_OPTIONS: readonly { value: BusinessRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything an admin can do; owns the business account." },
  { value: "admin", label: "Admin", description: "Manages schemes, members, fleet, assets, quotes and the team." },
  { value: "finance", label: "Finance", description: "Sees statements and pays invoices. No access to member details." },
  { value: "viewer", label: "Viewer", description: "Read-only dashboard: counts, renewals and statements." },
];

export type BusinessAction = "manage" | "members" | "billing" | "view";
const BUSINESS_PERMISSIONS: Record<BusinessRole, readonly BusinessAction[]> = {
  owner: ["manage", "members", "billing", "view"],
  admin: ["manage", "members", "billing", "view"],
  finance: ["billing", "view"],
  viewer: ["view"],
};

/** What a business role may do. `members` = see and edit member PII; `billing` = pay statements. */
export function businessCan(role: string | null | undefined, action: BusinessAction): boolean {
  if (!role || !(BUSINESS_ROLES as readonly string[]).includes(role)) return false;
  return BUSINESS_PERMISSIONS[role as BusinessRole].includes(action);
}

export function businessRoleLabel(role: string): string {
  return BUSINESS_ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role.replace(/_/g, " ");
}

/** Categories a group scheme can be for (group health / life / funeral / personal accident). */
export const GROUP_SCHEME_CATEGORIES = ["health", "life-funeral", "personal-accident"] as const;
export const SCHEME_STATUSES = ["draft", "quoting", "active", "lapsed", "cancelled"] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];
export const SCHEME_STATUS: Record<SchemeStatus, { label: string; tone: "ok" | "wait" | "neutral" | "danger" | "info" }> = {
  draft: { label: "Draft", tone: "neutral" },
  quoting: { label: "Quoting", tone: "wait" },
  active: { label: "Active", tone: "ok" },
  lapsed: { label: "Lapsed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
export const INVOICE_STATUS: Record<"draft" | "issued" | "paid" | "overdue", { label: string; tone: "ok" | "wait" | "neutral" | "danger" | "info" }> = {
  draft: { label: "Draft", tone: "neutral" },
  issued: { label: "Due", tone: "wait" },
  paid: { label: "Paid", tone: "ok" },
  overdue: { label: "Overdue", tone: "danger" },
};

export const MEMBER_RELATIONSHIPS = ["employee", "spouse", "child", "parent"] as const;
export type MemberRelationship = (typeof MEMBER_RELATIONSHIPS)[number];
export const FLEET_USES = ["private", "commercial", "hire"] as const;
export type FleetUse = (typeof FLEET_USES)[number];
export const ASSET_KINDS = ["property", "stock", "equipment", "liability_exposure"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface BusinessProfile {
  industry?: string;
  employees?: number;
  tin?: string;
  registration_number?: string;
  billing_email?: string;
  billing_contact?: string;
}

// ---------------------------------------------------------------------------
// CSV plumbing
// ---------------------------------------------------------------------------
export interface CsvRowError {
  /** 1-based line number in the file (the header is line 1). */
  row: number;
  message: string;
}

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[_\s-]+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();

function headerMap(header: string[], aliases: Record<string, string>): (string | null)[] {
  return header.map((h) => aliases[normHeader(h)] ?? null);
}

function normDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!iso && m) iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

function isBlank(cells: string[]) {
  return !cells.some((c) => c.trim() !== "");
}

// ---------------------------------------------------------------------------
// Members (group scheme census)
// ---------------------------------------------------------------------------
export interface MemberImportRow {
  row: number;
  employee_ref?: string;
  full_name: string;
  date_of_birth?: string;
  gender?: "female" | "male" | "other";
  phone?: string;
  email?: string;
  /** Only the last 4 digits of the Ghana Card are kept. */
  ghana_card_last4?: string;
  relationship: MemberRelationship;
  /** employee_ref of the principal member (dependants only). */
  principal_ref?: string;
  cover_tier?: string;
  salary_band?: string;
}
export interface MemberImportResult {
  rows: MemberImportRow[];
  errors: CsvRowError[];
  columns: string[];
}

export const MEMBER_CSV_COLUMNS = [
  "employee_ref", "full_name", "date_of_birth", "gender", "phone", "email", "ghana_card", "relationship", "principal_ref", "cover_tier", "salary_band",
] as const;

export const memberCsvTemplate =
  `${MEMBER_CSV_COLUMNS.join(",")}\n` +
  "EMP001,Ama Mensah,1988-04-12,female,0241234567,ama@example.com,GHA-123456789-0,employee,,standard,band_b\n" +
  "EMP001-S,Kojo Mensah,1986-01-30,male,,,,spouse,EMP001,standard,\n" +
  "EMP001-C1,Esi Mensah,2015-09-02,female,,,,child,EMP001,standard,\n" +
  "EMP002,Yaw Boateng,1979-11-23,male,0201234567,,,employee,,premium,band_c\n";

const MEMBER_ALIASES: Record<string, string> = {
  "employee ref": "employee_ref", "employee id": "employee_ref", "staff id": "employee_ref", "staff no": "employee_ref", "employee no": "employee_ref", ref: "employee_ref", "member id": "employee_ref",
  "full name": "full_name", name: "full_name", "member name": "full_name", "employee name": "full_name",
  "date of birth": "date_of_birth", dob: "date_of_birth", birthday: "date_of_birth", "birth date": "date_of_birth",
  gender: "gender", sex: "gender",
  phone: "phone", mobile: "phone", "phone number": "phone", msisdn: "phone", telephone: "phone",
  email: "email", "email address": "email", "e mail": "email",
  "ghana card": "ghana_card", "ghana card number": "ghana_card", "ghana card last4": "ghana_card", "ghana card last 4": "ghana_card", "national id": "ghana_card", nia: "ghana_card",
  relationship: "relationship", relation: "relationship", "member type": "relationship", type: "relationship",
  "principal ref": "principal_ref", principal: "principal_ref", "principal id": "principal_ref", "employee of": "principal_ref", "dependant of": "principal_ref",
  "cover tier": "cover_tier", tier: "cover_tier", plan: "cover_tier", "plan level": "cover_tier", "cover level": "cover_tier",
  "salary band": "salary_band", band: "salary_band", grade: "salary_band",
};

const RELATIONSHIP_ALIASES: Record<string, MemberRelationship> = {
  employee: "employee", staff: "employee", principal: "employee", self: "employee", member: "employee", main: "employee",
  spouse: "spouse", wife: "spouse", husband: "spouse", partner: "spouse",
  child: "child", son: "child", daughter: "child", kid: "child", dependant: "child", dependent: "child",
  parent: "parent", mother: "parent", father: "parent",
};

const GENDER_ALIASES: Record<string, "female" | "male" | "other"> = { f: "female", female: "female", woman: "female", m: "male", male: "male", man: "male", other: "other", x: "other" };

/** Last 4 digits of a Ghana Card (GHA-123456789-0 → "7890"); null when there are fewer than 4 digits. */
export function ghanaCardLast4(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Parse an employer's member list. Valid rows come back in file order (employees before their dependants is not
 * required — the server inserts principals first). Invalid rows are reported with their line number and skipped,
 * never partially imported. Duplicates: the same employee_ref twice, the same employee phone twice, or the same
 * person (name + date of birth) twice. Dependants need a `principal_ref` that names an employee in the file or
 * one of `knownPrincipalRefs` (employees already on the scheme).
 */
export function parseMemberCsv(text: string, opts: { maxRows?: number; knownPrincipalRefs?: string[]; today?: Date } = {}): MemberImportResult {
  const max = opts.maxRows ?? 5000;
  const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
  const table = parseCsvLines(text);
  const errors: CsvRowError[] = [];
  const rows: MemberImportRow[] = [];
  if (!table.some((r) => !isBlank(r))) return { rows, errors: [{ row: 1, message: "The file is empty" }], columns: [] };

  const map = headerMap(table[0]!, MEMBER_ALIASES);
  const columns = map.filter((c): c is string => !!c);
  if (!columns.includes("full_name")) {
    return { rows, errors: [{ row: 1, message: `A "full_name" column is required (found: ${table[0]!.join(", ") || "nothing"})` }], columns };
  }

  const fileEmployeeRefs = new Map<string, number>();
  // First pass: which employee refs exist in the file (dependants may come before their principal).
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const refIdx = map.indexOf("employee_ref");
    const relIdx = map.indexOf("relationship");
    if (refIdx === -1) break;
    const rel = RELATIONSHIP_ALIASES[(cells[relIdx] ?? "").trim().toLowerCase()] ?? (relIdx === -1 || !(cells[relIdx] ?? "").trim() ? "employee" : null);
    const ref = (cells[refIdx] ?? "").trim().toLowerCase();
    if (rel === "employee" && ref && !fileEmployeeRefs.has(ref)) fileEmployeeRefs.set(ref, i + 1);
  }
  const known = new Set((opts.knownPrincipalRefs ?? []).map((r) => r.trim().toLowerCase()));

  const seenRef = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const seenPerson = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const rowNo = i + 1;
    const cells = table[i]!;
    if (isBlank(cells)) continue;
    if (rows.length + errors.length >= max) {
      errors.push({ row: rowNo, message: `Only the first ${max} rows are processed per file` });
      break;
    }
    const get = (col: string) => {
      const idx = map.indexOf(col);
      return idx === -1 ? "" : (cells[idx] ?? "").trim();
    };
    const problems: string[] = [];
    const fullName = get("full_name").replace(/\s+/g, " ");
    if (fullName.length < 2) problems.push("full_name is missing");
    else if (fullName.length > 160) problems.push("full_name is longer than 160 characters");

    const relRaw = get("relationship").toLowerCase();
    const relationship = relRaw ? RELATIONSHIP_ALIASES[relRaw] : "employee";
    if (!relationship) problems.push(`relationship "${get("relationship")}" is not one of employee, spouse, child, parent`);

    const employeeRef = get("employee_ref");
    const principalRef = get("principal_ref");
    if (relationship && relationship !== "employee") {
      if (!principalRef) problems.push("principal_ref is required for dependants (the employee_ref of the employee)");
      else if (!fileEmployeeRefs.has(principalRef.toLowerCase()) && !known.has(principalRef.toLowerCase())) problems.push(`principal_ref "${principalRef}" does not match an employee`);
    }

    let dob: string | undefined;
    const dobRaw = get("date_of_birth");
    if (dobRaw) {
      const iso = normDate(dobRaw);
      if (!iso) problems.push(`date_of_birth "${dobRaw}" is not a date (use YYYY-MM-DD)`);
      else if (iso > today) problems.push("date_of_birth is in the future");
      else if (ageOn(iso, today) > 120) problems.push("date_of_birth is more than 120 years ago");
      else dob = iso;
    }

    const genderRaw = get("gender").toLowerCase();
    const gender = genderRaw ? GENDER_ALIASES[genderRaw] : undefined;
    if (genderRaw && !gender) problems.push(`gender "${get("gender")}" is not female, male or other`);

    const phoneRaw = get("phone");
    const phone = phoneRaw ? normalisePhone(phoneRaw) : "";
    if (phoneRaw && !/^\+233\d{9}$/.test(phone)) problems.push(`phone "${phoneRaw}" is not a Ghana number`);

    const email = get("email").toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`email "${email}" is not valid`);

    const cardRaw = get("ghana_card");
    const last4 = cardRaw ? ghanaCardLast4(cardRaw) : null;
    if (cardRaw && !last4) problems.push("ghana_card needs at least the last 4 digits");

    const tier = get("cover_tier").slice(0, 60);
    const band = get("salary_band").slice(0, 60);

    // Duplicates inside the file.
    if (relationship === "employee" && employeeRef) {
      const k = employeeRef.toLowerCase();
      const first = seenRef.get(k);
      if (first !== undefined) problems.push(`duplicate employee_ref (same as row ${first})`);
      else seenRef.set(k, rowNo);
    }
    if (relationship === "employee" && phone) {
      const first = seenPhone.get(phone);
      if (first !== undefined) problems.push(`duplicate phone (same as row ${first})`);
      else seenPhone.set(phone, rowNo);
    }
    if (fullName && dob) {
      const k = `${fullName.toLowerCase()}|${dob}`;
      const first = seenPerson.get(k);
      if (first !== undefined) problems.push(`duplicate member (same name and date of birth as row ${first})`);
      else seenPerson.set(k, rowNo);
    }

    if (problems.length) {
      errors.push({ row: rowNo, message: problems.join("; ") });
      continue;
    }
    rows.push({
      row: rowNo,
      employee_ref: employeeRef || undefined,
      full_name: fullName,
      date_of_birth: dob,
      gender,
      phone: phone || undefined,
      email: email || undefined,
      ghana_card_last4: last4 ?? undefined,
      relationship: relationship!,
      principal_ref: relationship !== "employee" ? principalRef : undefined,
      cover_tier: tier || undefined,
      salary_band: band || undefined,
    });
  }
  return { rows, errors, columns };
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------
export interface FleetImportRow {
  row: number;
  registration: string;
  make?: string;
  model?: string;
  year?: number;
  value?: number;
  use: FleetUse;
  driver_name?: string;
}
export interface FleetImportResult {
  rows: FleetImportRow[];
  errors: CsvRowError[];
  columns: string[];
}

export const FLEET_CSV_COLUMNS = ["registration", "make", "model", "year", "value", "use", "driver_name"] as const;
export const fleetCsvTemplate =
  `${FLEET_CSV_COLUMNS.join(",")}\n` +
  "GR 1234-23,Toyota,Hilux,2021,320000,commercial,Kwesi Appiah\n" +
  "GT 5678-22,Hyundai,Elantra,2019,150000,private,Abena Owusu\n" +
  "AS 902-24,Toyota,Hiace,2024,480000,hire,\n";

const FLEET_ALIASES: Record<string, string> = {
  registration: "registration", "registration number": "registration", reg: "registration", "reg no": "registration", plate: "registration", "number plate": "registration", "vehicle registration": "registration",
  make: "make", manufacturer: "make", brand: "make",
  model: "model",
  year: "year", "year of manufacture": "year", "manufacture year": "year",
  value: "value", "vehicle value": "value", "sum insured": "value", "market value": "value", "value ghs": "value",
  use: "use", usage: "use", "vehicle use": "use", purpose: "use",
  "driver name": "driver_name", driver: "driver_name", "main driver": "driver_name",
};
const USE_ALIASES: Record<string, FleetUse> = {
  private: "private", "private use": "private", personal: "private", "own goods": "commercial",
  commercial: "commercial", business: "commercial", "goods carrying": "commercial", delivery: "commercial", "ride hailing": "commercial", "ride-hailing": "commercial",
  hire: "hire", taxi: "hire", "hire and reward": "hire", "hire & reward": "hire", rental: "hire", trotro: "hire", bus: "hire",
};

/** Parse a fleet list. Registrations are normalised ("gr1234-23" → "GR 1234-23"); duplicates are row errors. */
export function parseFleetCsv(text: string, opts: { maxRows?: number; existingRegistrations?: string[]; now?: Date } = {}): FleetImportResult {
  const max = opts.maxRows ?? 2000;
  const nextYear = (opts.now ?? new Date()).getFullYear() + 1;
  const table = parseCsvLines(text);
  const errors: CsvRowError[] = [];
  const rows: FleetImportRow[] = [];
  if (!table.some((r) => !isBlank(r))) return { rows, errors: [{ row: 1, message: "The file is empty" }], columns: [] };
  const map = headerMap(table[0]!, FLEET_ALIASES);
  const columns = map.filter((c): c is string => !!c);
  if (!columns.includes("registration")) {
    return { rows, errors: [{ row: 1, message: `A "registration" column is required (found: ${table[0]!.join(", ") || "nothing"})` }], columns };
  }
  const existing = new Set((opts.existingRegistrations ?? []).map((r) => normaliseRegistration(r)));
  const seen = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const rowNo = i + 1;
    const cells = table[i]!;
    if (isBlank(cells)) continue;
    if (rows.length + errors.length >= max) {
      errors.push({ row: rowNo, message: `Only the first ${max} rows are processed per file` });
      break;
    }
    const get = (col: string) => {
      const idx = map.indexOf(col);
      return idx === -1 ? "" : (cells[idx] ?? "").trim();
    };
    const problems: string[] = [];
    const regRaw = get("registration");
    const registration = normaliseRegistration(regRaw);
    if (!registration) problems.push("registration is missing");
    else if (registration.length > 20) problems.push(`registration "${regRaw}" is too long`);

    const yearRaw = get("year");
    let year: number | undefined;
    if (yearRaw) {
      const n = Number(yearRaw);
      if (!Number.isInteger(n) || n < 1950 || n > nextYear) problems.push(`year "${yearRaw}" must be between 1950 and ${nextYear}`);
      else year = n;
    }
    const valueRaw = get("value").replace(/[,\s]|GH₵|GHS|GHC|cedis?/gi, "");
    let value: number | undefined;
    if (valueRaw) {
      const n = Number(valueRaw);
      if (!Number.isFinite(n) || n <= 0) problems.push(`value "${get("value")}" must be a positive amount in GH₵`);
      else if (n > 100_000_000) problems.push("value looks too large (over GH₵ 100m)");
      else value = Math.round(n * 100) / 100;
    }
    const useRaw = get("use").toLowerCase();
    const use = useRaw ? USE_ALIASES[useRaw] : "private";
    if (!use) problems.push(`use "${get("use")}" is not private, commercial or hire`);

    if (registration) {
      const first = seen.get(registration);
      if (first !== undefined) problems.push(`duplicate registration (same as row ${first})`);
      else seen.set(registration, rowNo);
      if (existing.has(registration)) problems.push(`${registration} is already on your fleet`);
    }
    if (problems.length) {
      errors.push({ row: rowNo, message: problems.join("; ") });
      continue;
    }
    rows.push({
      row: rowNo,
      registration,
      make: get("make").slice(0, 60) || undefined,
      model: get("model").slice(0, 60) || undefined,
      year,
      value,
      use: use!,
      driver_name: get("driver_name").replace(/\s+/g, " ").slice(0, 120) || undefined,
    });
  }
  return { rows, errors, columns };
}

// ---------------------------------------------------------------------------
// Complexity & census
// ---------------------------------------------------------------------------
export interface CensusMember {
  relationship: string;
  date_of_birth?: string | null;
  gender?: string | null;
  cover_tier?: string | null;
  salary_band?: string | null;
  status?: string | null;
}
export interface FleetVehicleLite {
  status?: string | null;
  use?: string | null;
  value?: number | string | null;
}

export interface GroupComplexity {
  /** Covered lives (employees + dependants), removed members excluded. */
  lives: number;
  employees: number;
  dependants: number;
  fleetSize: number;
  /** Flags the routing engine raises for these numbers (same thresholds as `complexityFlags`). */
  flags: ComplexityFlag[];
  /** Keys to merge into `requests.risk_data` so the routing engine sees the size. */
  riskKeys: { lives?: number; fleet_size?: number };
}

const live = <T extends { status?: string | null }>(xs: T[]) => xs.filter((x) => (x.status ?? "active") !== "removed");

/** Size of a business's risk for routing (group schemes ≥ 20 lives and fleets ≥ 5 vehicles go to brokers). */
export function groupComplexity(members: CensusMember[], fleet: FleetVehicleLite[] = [], thresholds: Partial<ComplexityThresholds> = {}): GroupComplexity {
  const t = { ...DEFAULT_COMPLEXITY_THRESHOLDS, ...thresholds };
  const m = live(members);
  const v = live(fleet);
  const employees = m.filter((x) => x.relationship === "employee").length;
  const lives = m.length;
  const flags: ComplexityFlag[] = [];
  if (lives > 0 && lives >= t.groupLives) flags.push("group_scheme");
  if (v.length > 0 && v.length >= t.fleetVehicles) flags.push("fleet");
  const riskKeys: GroupComplexity["riskKeys"] = {};
  if (lives > 0) riskKeys.lives = lives;
  if (v.length > 0) riskKeys.fleet_size = v.length;
  return { lives, employees, dependants: lives - employees, fleetSize: v.length, flags, riskKeys };
}

export const AGE_BANDS = ["0-17", "18-29", "30-39", "40-49", "50-59", "60-64", "65+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number] | "unknown";

/** Whole years between a date of birth and `asOf` (both YYYY-MM-DD). */
export function ageOn(dob: string, asOf: string): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const [ay, am, ad] = asOf.split("-").map(Number) as [number, number, number];
  let age = ay - y;
  if (am < m || (am === m && ad < d)) age--;
  return age;
}

export function ageBand(age: number | null): AgeBand {
  if (age === null || !Number.isFinite(age) || age < 0) return "unknown";
  if (age < 18) return "0-17";
  if (age < 30) return "18-29";
  if (age < 40) return "30-39";
  if (age < 50) return "40-49";
  if (age < 60) return "50-59";
  if (age < 65) return "60-64";
  return "65+";
}

export interface CensusSummary {
  lives: number;
  employees: number;
  dependants: number;
  byRelationship: Record<MemberRelationship, number>;
  byAgeBand: Record<AgeBand, number>;
  byTier: Record<string, number>;
  byGender: Record<string, number>;
  bySalaryBand: Record<string, number>;
  averageAge: number | null;
  /** Average age of employees only (insurers price group life on the workforce). */
  averageEmployeeAge: number | null;
  oldestAge: number | null;
  youngestAge: number | null;
  /** Members without a date of birth (the insurer will ask for them). */
  missingDateOfBirth: number;
  asOf: string;
}

/**
 * Census summary for insurer quoting: counts only, never names, phones or IDs. Safe to put in `requests.risk_data`
 * and to share with every insurer the broker approaches.
 */
export function censusSummary(members: CensusMember[], asOf: Date | string = new Date()): CensusSummary {
  const on = typeof asOf === "string" ? asOf.slice(0, 10) : asOf.toISOString().slice(0, 10);
  const m = live(members);
  const byRelationship: Record<MemberRelationship, number> = { employee: 0, spouse: 0, child: 0, parent: 0 };
  const byAgeBand = Object.fromEntries([...AGE_BANDS, "unknown"].map((b) => [b, 0])) as Record<AgeBand, number>;
  const byTier: Record<string, number> = {};
  const byGender: Record<string, number> = {};
  const bySalaryBand: Record<string, number> = {};
  const ages: number[] = [];
  const employeeAges: number[] = [];
  let missing = 0;
  for (const x of m) {
    const rel = (MEMBER_RELATIONSHIPS as readonly string[]).includes(x.relationship) ? (x.relationship as MemberRelationship) : "employee";
    byRelationship[rel]++;
    const age = x.date_of_birth ? ageOn(x.date_of_birth.slice(0, 10), on) : null;
    if (age === null) missing++;
    else {
      ages.push(age);
      if (rel === "employee") employeeAges.push(age);
    }
    byAgeBand[ageBand(age)]++;
    const tier = x.cover_tier?.trim() || "unspecified";
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    const gender = x.gender?.trim() || "unspecified";
    byGender[gender] = (byGender[gender] ?? 0) + 1;
    if (rel === "employee") {
      const band = x.salary_band?.trim() || "unspecified";
      bySalaryBand[band] = (bySalaryBand[band] ?? 0) + 1;
    }
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, n) => s + n, 0) / xs.length) * 10) / 10 : null);
  return {
    lives: m.length,
    employees: byRelationship.employee,
    dependants: m.length - byRelationship.employee,
    byRelationship,
    byAgeBand,
    byTier,
    byGender,
    bySalaryBand,
    averageAge: avg(ages),
    averageEmployeeAge: avg(employeeAges),
    oldestAge: ages.length ? Math.max(...ages) : null,
    youngestAge: ages.length ? Math.min(...ages) : null,
    missingDateOfBirth: missing,
    asOf: on,
  };
}

// ---------------------------------------------------------------------------
// Consolidated billing
// ---------------------------------------------------------------------------
export interface BillablePolicy {
  policy_id?: string | null;
  scheme_id?: string | null;
  /** Unpaid new business (accepted quote → submitted application): paid through checkout. */
  application_id?: string | null;
  insurer_org_id: string;
  insurer_name?: string | null;
  description: string;
  /** Premium for one billing period (or the amount due for new business). */
  premium: number;
  billing_period?: string | null;
  cover_start?: string | null;
  cover_end?: string | null;
  status?: string | null;
  currency?: string | null;
}
export interface InvoicePeriod {
  start: string;
  end: string;
}
export interface InvoiceLine {
  policy_id: string | null;
  scheme_id: string | null;
  application_id: string | null;
  description: string;
  amount: number;
  insurer_org_id: string;
  insurer_name: string | null;
  /** Why this line is due in the period. */
  basis: "new_business" | "monthly" | "quarterly" | "annual" | "renewal";
}
export interface InsurerTotal {
  insurer_org_id: string;
  insurer_name: string | null;
  amount: number;
  lines: number;
}
export interface ConsolidatedInvoice {
  period: InvoicePeriod;
  currency: string;
  lines: InvoiceLine[];
  byInsurer: InsurerTotal[];
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
};
const inPeriod = (iso: string, p: InvoicePeriod) => iso >= p.start && iso <= p.end;

/** The first and last day of the month before `d` (statements cover the previous month). */
export function previousMonthPeriod(d: Date = new Date()): InvoicePeriod {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Builds a consolidated statement for a period: new business awaiting payment, monthly premiums of active
 * policies, quarterly premiums falling due, and annual premiums whose inception / anniversary is in the period.
 * Lines are grouped per insurer because each insurer is paid separately — premiums settle to the insurer, the
 * statement only consolidates what the business sees.
 */
export function consolidateInvoice(policies: BillablePolicy[], period: InvoicePeriod): ConsolidatedInvoice {
  const lines: InvoiceLine[] = [];
  let currency = "GHS";
  for (const p of policies) {
    const premium = Number(p.premium);
    if (!Number.isFinite(premium) || premium <= 0) continue;
    if (p.currency) currency = p.currency;
    const base = {
      policy_id: p.policy_id ?? null,
      scheme_id: p.scheme_id ?? null,
      application_id: p.application_id ?? null,
      description: p.description,
      amount: r2(premium),
      insurer_org_id: p.insurer_org_id,
      insurer_name: p.insurer_name ?? null,
    };
    if (p.application_id) {
      lines.push({ ...base, basis: "new_business" });
      continue;
    }
    if (p.status && !["active", "renewed"].includes(p.status)) continue;
    if (!p.cover_start) continue;
    const start = p.cover_start.slice(0, 10);
    if (start > period.end) continue;
    if (p.cover_end && p.cover_end.slice(0, 10) < period.start) continue;
    const period_ = (p.billing_period ?? "year").toLowerCase();
    if (period_ === "month" || period_ === "monthly") {
      lines.push({ ...base, basis: "monthly" });
    } else if (period_ === "quarter" || period_ === "quarterly") {
      const months = monthsBetween(start, period.start);
      if (months >= 0 && months % 3 === 0) lines.push({ ...base, basis: "quarterly" });
    } else {
      // Annual: due at inception or on the anniversary falling inside the period.
      const anniversaryYears = Number(period.start.slice(0, 4)) - Number(start.slice(0, 4));
      const candidates = [0, anniversaryYears, anniversaryYears + 1].filter((n) => n >= 0);
      const due = candidates.some((n) => inPeriod(`${Number(start.slice(0, 4)) + n}${start.slice(4)}`, period));
      if (due) lines.push({ ...base, basis: inPeriod(start, period) ? "annual" : "renewal" });
    }
  }
  const byMap = new Map<string, InsurerTotal>();
  for (const l of lines) {
    const t = byMap.get(l.insurer_org_id) ?? { insurer_org_id: l.insurer_org_id, insurer_name: l.insurer_name, amount: 0, lines: 0 };
    t.amount = r2(t.amount + l.amount);
    t.lines++;
    byMap.set(l.insurer_org_id, t);
  }
  const byInsurer = [...byMap.values()].sort((a, b) => b.amount - a.amount);
  return { period, currency, lines, byInsurer, total: r2(lines.reduce((s, l) => s + l.amount, 0)) };
}
