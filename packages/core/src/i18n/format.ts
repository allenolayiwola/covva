/**
 * ICU-light message formatting — enough for UI strings without a runtime dependency:
 *
 *   "Hello {name}"                                    simple argument
 *   "{count, plural, =0 {No policies} one {# policy} other {# policies}}"
 *   "{party, select, broker {Your broker} other {Covva}}"
 *
 * `#` inside a plural branch is the number. Missing arguments render as an empty string
 * (and are reported through `onMissingArg`), so a translator's typo never crashes a page.
 * Apostrophes are literal (no ICU quoting rules); use `{'{'}` style escapes are not supported.
 */
export type MessageValue = string | number | boolean | null | undefined | Date;
export type MessageVars = Record<string, MessageValue>;

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

const pluralRulesCache = new Map<string, Intl.PluralRules>();

/** Locales whose CLDR plural data may be missing in a small ICU build map to a known one. */
const PLURAL_FALLBACK: Record<string, string> = { tw: "ak", gaa: "en", ee: "ee" };

function pluralRules(locale: string): Intl.PluralRules {
  const hit = pluralRulesCache.get(locale);
  if (hit) return hit;
  let rules: Intl.PluralRules;
  try {
    const candidates = [locale, PLURAL_FALLBACK[locale], "en"].filter(Boolean) as string[];
    const supported = Intl.PluralRules.supportedLocalesOf(candidates);
    rules = new Intl.PluralRules(supported[0] ?? "en");
  } catch {
    rules = new Intl.PluralRules("en");
  }
  pluralRulesCache.set(locale, rules);
  return rules;
}

/** CLDR plural category for `count` in `locale` (falls back to English rules). */
export function pluralCategory(locale: string, count: number): PluralCategory {
  return pluralRules(locale).select(count) as PluralCategory;
}

/**
 * Choose a plural form: `pluralise("en", 2, { one: "# policy", other: "# policies" })` → "2 policies".
 * `=N` exact matches win over categories; `other` is required.
 */
export function pluralise(locale: string, count: number, forms: Partial<Record<PluralCategory | `=${number}`, string>> & { other: string }): string {
  const exact = forms[`=${count}` as `=${number}`];
  const form = exact ?? forms[pluralCategory(locale, count)] ?? forms.other;
  return form.replace(/#/g, formatNumber(locale, count));
}

function formatNumber(locale: string, n: number): string {
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-GH" : "en-GH").format(n);
  } catch {
    return String(n);
  }
}

function stringify(locale: string, v: MessageValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return formatNumber(locale, v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Find the index of the `}` matching the `{` at `open` (nesting aware). -1 if unbalanced. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse `one {…} other {…}` into a map. */
function parseBranches(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    const start = i;
    while (i < body.length && body[i] !== "{" && !/\s/.test(body[i])) i++;
    const key = body.slice(start, i);
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] !== "{") break;
    const close = matchBrace(body, i);
    if (close < 0) break;
    out[key] = body.slice(i + 1, close);
    i = close + 1;
  }
  return out;
}

export interface FormatOptions {
  onMissingArg?: (name: string) => void;
}

/** Interpolate `template` with `vars` (see module doc for the syntax). */
export function formatMessage(locale: string, template: string, vars: MessageVars = {}, opts: FormatOptions = {}): string {
  if (!template.includes("{")) return template;
  let out = "";
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{", i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = matchBrace(template, open);
    if (close < 0) {
      out += template.slice(open);
      break;
    }
    const inner = template.slice(open + 1, close);
    const comma = inner.indexOf(",");
    if (comma < 0) {
      const name = inner.trim();
      if (!(name in vars)) opts.onMissingArg?.(name);
      out += stringify(locale, vars[name]);
    } else {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1);
      const comma2 = rest.indexOf(",");
      const kind = (comma2 < 0 ? rest : rest.slice(0, comma2)).trim();
      const body = comma2 < 0 ? "" : rest.slice(comma2 + 1);
      if (!(name in vars)) opts.onMissingArg?.(name);
      const value = vars[name];
      if (kind === "plural") {
        const n = typeof value === "number" ? value : Number(value ?? 0);
        const branches = parseBranches(body);
        const chosen = branches[`=${n}`] ?? branches[pluralCategory(locale, n)] ?? branches.other ?? "";
        out += formatMessage(locale, chosen, vars, opts).replace(/#/g, formatNumber(locale, n));
      } else if (kind === "select") {
        const branches = parseBranches(body);
        const chosen = branches[String(value)] ?? branches.other ?? "";
        out += formatMessage(locale, chosen, vars, opts);
      } else {
        out += stringify(locale, value);
      }
    }
    i = close + 1;
  }
  return out;
}

/** Argument names used by a template (for translator tooling: a translation must use the same ones). */
export function messageArgs(template: string): string[] {
  const names = new Set<string>();
  const walk = (t: string) => {
    let i = 0;
    while (i < t.length) {
      const open = t.indexOf("{", i);
      if (open < 0) return;
      const close = matchBrace(t, open);
      if (close < 0) return;
      const inner = t.slice(open + 1, close);
      const comma = inner.indexOf(",");
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.add(name);
      if (comma >= 0) {
        const rest = inner.slice(comma + 1);
        const comma2 = rest.indexOf(",");
        const kind = (comma2 < 0 ? rest : rest.slice(0, comma2)).trim();
        if ((kind === "plural" || kind === "select") && comma2 >= 0) {
          for (const branch of Object.values(parseBranches(rest.slice(comma2 + 1)))) walk(branch);
        }
      }
      i = close + 1;
    }
  };
  walk(template);
  return [...names].sort();
}
