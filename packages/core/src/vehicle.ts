/**
 * Vehicle helpers for the "motor quote in under two minutes" flow: Ghana registration
 * normalisation, age bands used by rating and the three fields that start a quick quote.
 */

/** A registration lookup result (no owner PII). Mirrors `vehicle_lookups.data`. */
export interface VehicleData {
  make?: string;
  model?: string;
  year?: number;
  body?: string;
  colour?: string;
  chassis_last4?: string;
  engine_cc?: number;
  seats?: number;
  use?: "private" | "commercial";
}

/**
 * Ghana plates: a 1–3 letter region code (GR, AS, WR, GT, GN, GW, GS, GE, GC …, plus DP dealer,
 * CD diplomatic, GP police), 1–4 digits and a two-digit year, e.g. `GR 1234-23`.
 * `GR123423`, `gr-1234-23` and `GR 1234 23` all normalise to `GR 1234-23`. Anything that doesn't fit
 * is returned upper-cased with runs of spaces collapsed (the lookup simply misses the cache).
 */
export function normaliseRegistration(input: string | null | undefined): string {
  const raw = (input ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "");
  const m = /^([A-Z]{1,3})(\d{1,4})(\d{2})$/.exec(compact);
  if (m) return `${m[1]} ${m[2]}-${m[3]}`;
  // Older / foreign formats: keep letters and digits in groups.
  return raw.replace(/\s+/g, " ");
}

/** Plate year suffix (e.g. 23 → 2023); null when the plate has no year. */
export function registrationYear(registration: string, now = new Date()): number | null {
  const m = /-(\d{2})$/.exec(normaliseRegistration(registration));
  if (!m) return null;
  const yy = Number(m[1]);
  const century = now.getFullYear() - (now.getFullYear() % 100);
  const year = century + yy;
  return year > now.getFullYear() + 1 ? year - 100 : year;
}

export type VehicleAgeBand = "new" | "recent" | "mid" | "old" | "vintage";

/** Age band from the year of manufacture: new ≤1y, recent ≤3y, mid ≤8y, old ≤15y, vintage beyond. */
export function vehicleAgeBand(year: number | null | undefined, now = new Date()): VehicleAgeBand | null {
  if (!year || !Number.isFinite(year)) return null;
  const age = now.getFullYear() - Math.floor(year);
  if (age < 0) return "new";
  if (age <= 1) return "new";
  if (age <= 3) return "recent";
  if (age <= 8) return "mid";
  if (age <= 15) return "old";
  return "vintage";
}

/** The three fields a motor quote starts with; the rest is prefilled or collapsed under "Check details". */
export const QUICK_QUOTE_FIELDS = ["registration_number", "use", "vehicle_value"] as const;
export type QuickQuoteField = (typeof QUICK_QUOTE_FIELDS)[number];

/** Risk-schema keys a successful lookup can prefill. */
export const LOOKUP_PREFILL_KEYS = ["vehicle_make", "vehicle_model", "vehicle_year", "use"] as const;

/**
 * Splits a category's risk-schema keys into the quick-start set and the rest, in schema order.
 * Non-motor categories (no registration field) get no quick set.
 */
export function quickQuoteFields<T extends { key: string }>(fields: T[]): { quick: T[]; rest: T[] } {
  const hasReg = fields.some((f) => f.key === "registration_number");
  if (!hasReg) return { quick: [], rest: fields };
  const quick = fields.filter((f) => (QUICK_QUOTE_FIELDS as readonly string[]).includes(f.key));
  const rest = fields.filter((f) => !(QUICK_QUOTE_FIELDS as readonly string[]).includes(f.key));
  return { quick, rest };
}

/** Map a lookup result onto risk-form values (strings, as forms hold them). Only fills gaps. */
export function prefillFromLookup(current: Record<string, string | string[]>, data: VehicleData): Record<string, string | string[]> {
  const out = { ...current };
  const set = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    const cur = out[k];
    if (cur === undefined || cur === "" || (Array.isArray(cur) && !cur.length)) out[k] = String(v);
  };
  set("vehicle_make", data.make);
  set("vehicle_model", data.model);
  set("vehicle_year", data.year);
  set("use", data.use);
  return out;
}
