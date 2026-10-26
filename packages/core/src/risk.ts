import { z } from "zod";

/** A field in product_categories.risk_schema — rendered by web and mobile forms. */
export interface RiskField {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "select" | "multiselect" | "boolean" | "date" | "region";
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export const GHANA_REGIONS = [
  "Greater Accra", "Ashanti", "Western", "Western North", "Central", "Eastern", "Volta", "Oti",
  "Northern", "Savannah", "North East", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo",
] as const;

/** Build a zod validator for a category's risk form. Coerces numbers/booleans from form strings. */
export function riskSchemaToZod(fields: RiskField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    let s: z.ZodType;
    switch (f.type) {
      case "number":
      case "currency": {
        let n = z.coerce.number({ error: `${f.label} must be a number` });
        if (f.min !== undefined) n = n.min(f.min, `${f.label} must be at least ${f.min}`);
        if (f.max !== undefined) n = n.max(f.max, `${f.label} must be at most ${f.max}`);
        s = n;
        break;
      }
      case "boolean":
        s = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "yes", z.boolean());
        break;
      case "select":
        s = f.options?.length
          ? z.enum(f.options.map((o) => o.value) as [string, ...string[]], { error: `Choose ${f.label.toLowerCase()}` })
          : z.string();
        break;
      case "multiselect":
        s = z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.string()));
        break;
      case "region":
        s = z.enum(GHANA_REGIONS as unknown as [string, ...string[]], { error: "Choose a region" });
        break;
      case "date":
        s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${f.label} must be a date`);
        break;
      default:
        s = z.string().trim().min(f.required ? 1 : 0, `${f.label} is required`).max(500);
    }
    shape[f.key] = f.required || f.type === "boolean" ? s : s.optional().or(z.literal("").transform(() => undefined));
  }
  return z.object(shape);
}

/**
 * Stable fingerprint for a risk, used to prevent duplicate submissions of the
 * same risk to the same insurer. Uses Web Crypto so it runs on server, edge and RN (with polyfill).
 */
export async function riskFingerprint(input: { customerId: string; categorySlug: string; risk: Record<string, unknown> }): Promise<string> {
  const canonical = JSON.stringify({
    c: input.customerId,
    k: input.categorySlug,
    r: Object.keys(input.risk).sort().reduce<Record<string, unknown>>((acc, k) => {
      const v = input.risk[k];
      acc[k] = typeof v === "string" ? v.trim().toLowerCase() : v;
      return acc;
    }, {}),
  });
  const data = new TextEncoder().encode(canonical);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short human summary of a risk for queue rows and notifications. */
export function riskTitle(categorySlug: string, risk: Record<string, unknown>): string {
  const s = (k: string) => (risk[k] ? String(risk[k]) : "");
  switch (categorySlug) {
    case "motor": return [s("vehicle_make"), s("vehicle_model"), s("vehicle_year")].filter(Boolean).join(" ") || "Motor cover";
    case "travel": return `Travel · ${s("destination_region") || "trip"} · ${s("trip_days")} days`;
    case "home": return `Home · ${s("cover_scope").replace(/_/g, " ")}`;
    case "sme-property": return s("business_name") || "Business property";
    case "marine-cargo": return `Cargo · ${s("goods_description")}`;
    default: return categorySlug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }
}
