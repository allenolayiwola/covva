import type { RiskField } from "@im/core";

/** Catalogue category as the public quote flow needs it (from `getCategories()`). */
export interface FlowCategory {
  slug: string;
  name: string;
  icon: string | null;
  short_description: string | null;
  availability: "integrated" | "broker_assisted" | "planned";
  segment: string;
  risk_schema: RiskField[];
}

/** Broker as shown in the picker (public directory columns only). */
export interface FlowBroker {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  region: string | null;
  nic_licence_number: string | null;
  logo_url: string | null;
  brand_color: string | null;
  demo: boolean;
}

export type Value = string | string[];
export type Values = Record<string, Value>;

/** One screen of the flow. Questions hold one field (choice cards) or at most two short inputs. */
export type Screen =
  | { kind: "category" }
  | { kind: "question"; fields: RiskField[]; title: string; help?: string }
  | { kind: "review" }
  | { kind: "auth" }
  | { kind: "brokers" };

/** The six macro steps shown as "Step x of 6" (mockups 03–05). */
export const MACRO_STEPS = ["Cover", "Details", "Review", "Sign in", "Brokers", "Sent"] as const;
export function macroStep(screen: Screen): number {
  switch (screen.kind) {
    case "category": return 1;
    case "question": return 2;
    case "review": return 3;
    case "auth": return 4;
    case "brokers": return 5;
  }
}

export const MAX_BROKERS = 3;

const CHOICE_TYPES = new Set<RiskField["type"]>(["select", "boolean", "multiselect", "region"]);

/**
 * Turns a category's risk schema into question screens: every choice question gets its own screen with big
 * tappable cards; short inputs are paired (at most two per screen). An optional registration number is asked
 * first so the broker can pre-fill the vehicle. Pure, so the step count is stable for a given category.
 */
export function buildScreens(fields: RiskField[]): Screen[] {
  const ordered = [...fields].sort((a, b) => (a.key === "registration_number" ? -1 : b.key === "registration_number" ? 1 : 0));
  const screens: Screen[] = [{ kind: "category" }];
  let pending: RiskField[] = [];
  const flush = () => {
    if (!pending.length) return;
    screens.push({ kind: "question", fields: pending, title: pending.length === 1 ? pending[0]!.label : `${pending[0]!.label} and ${pending[1]!.label.toLowerCase()}`, help: pending.length === 1 ? pending[0]!.help : undefined });
    pending = [];
  };
  for (const f of ordered) {
    if (CHOICE_TYPES.has(f.type)) {
      flush();
      screens.push({ kind: "question", fields: [f], title: f.label, help: f.help });
    } else {
      pending.push(f);
      if (pending.length === 2) flush();
    }
  }
  flush();
  screens.push({ kind: "review" }, { kind: "auth" }, { kind: "brokers" });
  return screens;
}

export function toFormValue(f: RiskField, v: unknown): Value {
  if (f.type === "multiselect") return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  if (f.type === "boolean") return v === true || v === "true" ? "true" : v === false || v === "false" ? "false" : "";
  return v === undefined || v === null ? "" : String(v);
}

/** The risk payload `createRequest()` validates: booleans and numbers coerced, empty optionals dropped. */
export function riskPayload(fields: RiskField[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === "boolean") {
      if (v === "true" || v === "false") out[f.key] = v === "true";
    } else if (f.type === "multiselect") out[f.key] = Array.isArray(v) ? v : [];
    else if (v !== "" && v !== undefined) out[f.key] = v;
  }
  return out;
}

/** Per-screen validation (the full zod schema runs again on the server). */
export function screenErrors(fields: RiskField[], values: Values): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key];
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (f.required && empty) {
      errs[f.key] = f.type === "boolean" ? "Choose yes or no" : f.type === "select" || f.type === "region" ? "Choose one" : f.type === "multiselect" ? "Choose at least one" : "This is needed for a quote";
      continue;
    }
    if (!empty && (f.type === "number" || f.type === "currency")) {
      const n = Number(v);
      if (!Number.isFinite(n)) errs[f.key] = `${f.label} must be a number`;
      else if (f.min !== undefined && n < f.min) errs[f.key] = `${f.label} must be at least ${f.min}`;
      else if (f.max !== undefined && n > f.max) errs[f.key] = `${f.label} must be at most ${f.max}`;
    }
  }
  return errs;
}

/* ----------------------------------------------------------------------------
 * Device draft: answers stay on this device until the request is sent (resumes after sign-in).
 * ------------------------------------------------------------------------- */
export const DRAFT_KEY = "covva:quote:v1";
export interface Draft { categorySlug: string; values: Values; brokerIds: string[]; index: number; savedAt: number }

export function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || typeof d !== "object" || typeof d.categorySlug !== "string") return null;
    // Drafts older than 7 days are stale (prices and schemas move on).
    if (Date.now() - (d.savedAt ?? 0) > 7 * 86_400_000) return null;
    return d;
  } catch {
    return null;
  }
}
export function writeDraft(d: Omit<Draft, "savedAt">) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    /* private mode or full storage: the flow still works, it just does not resume */
  }
}
export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Marketing product-line slugs (hero picker, product pages) → the catalogue category that starts the flow. */
export const LINE_TO_CATEGORY: Record<string, string> = {
  motor: "motor",
  home: "home",
  health: "health",
  travel: "travel",
  "life-funeral": "life-funeral",
  life: "life-funeral",
  business: "sme-property",
  micro: "personal-accident",
};
