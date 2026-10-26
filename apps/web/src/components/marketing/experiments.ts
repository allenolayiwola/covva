/**
 * A/B testing hooks for the marketing site (Addendum 5 "A/B testing support").
 *
 * - Experiments are declared once in EXPERIMENTS; variants are weighted and "control" is always first.
 * - An experiment runs only when its key is listed in NEXT_PUBLIC_EXPERIMENTS (comma-separated). With the
 *   variable unset every visitor sees control and no cookie is written, so Lighthouse, e2e and SEO snapshots
 *   are deterministic.
 * - Assignment is sticky per browser in the functional cookie `covva_exp` (90 days): `key:variant|key:variant`.
 *   It holds no personal data and is listed in the cookie notice.
 * - QA override: `?exp=key:variant` (several separated by commas) forces a variant and persists it, even for
 *   an experiment that is not running, so a variant can be reviewed on production before it starts.
 * - Exposure is reported once per page view per experiment through `track("experiment_exposure")`, which
 *   only reaches a vendor after analytics consent.
 *
 * The variant is resolved on the client after hydration; the server always renders control. Keep the
 * difference between variants small (copy, order, a CTA label) so the swap does not shift layout.
 */

export interface ExperimentDef<V extends string = string> {
  /** Human description, for the experiments doc and the analytics dashboard. */
  description: string;
  variants: readonly V[];
  /** Relative weights, same order as `variants`. Defaults to an even split. */
  weights?: readonly number[];
}

export const EXPERIMENTS = {
  home_hero_headline: {
    description: "Home hero: outcome-led headline vs the control 'Compare, buy and manage insurance in minutes'.",
    variants: ["control", "instant"],
  },
} as const satisfies Record<string, ExperimentDef>;

export type ExperimentKey = keyof typeof EXPERIMENTS;
export type VariantOf<K extends ExperimentKey> = (typeof EXPERIMENTS)[K]["variants"][number];

export const EXPERIMENT_COOKIE = "covva_exp";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
const ENABLED = new Set((process.env.NEXT_PUBLIC_EXPERIMENTS || "").split(",").map((s) => s.trim()).filter(Boolean));

export function isExperimentEnabled(key: ExperimentKey): boolean {
  return ENABLED.has(key);
}

export function readAssignments(): Partial<Record<ExperimentKey, string>> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/(?:^|;\s*)covva_exp=([^;]*)/);
  const out: Partial<Record<ExperimentKey, string>> = {};
  if (!m) return out;
  for (const pair of decodeURIComponent(m[1]).split("|")) {
    const [k, v] = pair.split(":");
    if (k && v && k in EXPERIMENTS && (EXPERIMENTS[k as ExperimentKey].variants as readonly string[]).includes(v)) out[k as ExperimentKey] = v;
  }
  return out;
}

function writeAssignments(all: Partial<Record<ExperimentKey, string>>) {
  const value = Object.entries(all).map(([k, v]) => `${k}:${v}`).join("|");
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${EXPERIMENT_COOKIE}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

function pick<K extends ExperimentKey>(key: K): VariantOf<K> {
  const def = EXPERIMENTS[key] as ExperimentDef;
  const weights = def.weights ?? def.variants.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < def.variants.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) return def.variants[i] as VariantOf<K>;
  }
  return def.variants[0] as VariantOf<K>;
}

/** `?exp=key:variant,key2:variant` overrides, validated against the registry. */
function overridesFromUrl(): Partial<Record<ExperimentKey, string>> {
  const out: Partial<Record<ExperimentKey, string>> = {};
  const raw = new URLSearchParams(window.location.search).get("exp");
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split(":");
    if (k && v && k in EXPERIMENTS && (EXPERIMENTS[k as ExperimentKey].variants as readonly string[]).includes(v)) out[k as ExperimentKey] = v;
  }
  return out;
}

/**
 * Resolves the visitor's variant for one experiment on the client: URL override → stored assignment →
 * (when the experiment is running) a fresh weighted pick that is then stored. Control otherwise.
 */
export function resolveVariant<K extends ExperimentKey>(key: K): VariantOf<K> {
  const control = EXPERIMENTS[key].variants[0] as VariantOf<K>;
  if (typeof window === "undefined") return control;
  const stored = readAssignments();
  const override = overridesFromUrl()[key];
  if (override) {
    if (stored[key] !== override) writeAssignments({ ...stored, [key]: override });
    return override as VariantOf<K>;
  }
  if (stored[key]) return stored[key] as VariantOf<K>;
  if (!isExperimentEnabled(key)) return control;
  const chosen = pick(key);
  writeAssignments({ ...stored, [key]: chosen });
  return chosen;
}
