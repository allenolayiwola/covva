/**
 * Translator CSV import/export (`key,value` columns), on top of the RFC 4180 reader the
 * rate-table importer already uses. No dependency.
 */
import { parseCsv } from "../rate-table";

export interface TranslationImportResult {
  rows: { key: string; value: string }[];
  errors: { line: number; message: string }[];
}

/**
 * Parse a translator's CSV: header `key,value` (case-insensitive, optional) — or our export's
 * `key,english,value,status` (the `value` column is used) — one row per string.
 * `isKnownKey` rejects keys that are not in the English catalogue. Empty values are skipped.
 */
export function parseTranslationCsv(text: string, isKnownKey: (key: string) => boolean, maxRows = 5000): TranslationImportResult {
  const all = parseCsv(text);
  const out: TranslationImportResult = { rows: [], errors: [] };
  let start = 0;
  // A header row may name the columns (our export is key,english,value,status): use `value`.
  let valueCol: number | null = null;
  const header = all[0]?.map((h) => h.trim().toLowerCase());
  if (header && header[0] === "key") {
    start = 1;
    const vi = header.indexOf("value");
    if (vi > 0 && header.length > 2) valueCol = vi;
  }
  const seen = new Set<string>();
  for (let i = start; i < all.length; i++) {
    const line = i + 1;
    if (out.rows.length >= maxRows) {
      out.errors.push({ line, message: `Only ${maxRows} rows can be imported at once.` });
      break;
    }
    const [rawKey, ...rest] = all[i] ?? [];
    const key = (rawKey ?? "").trim();
    const value = (valueCol != null ? (all[i]?.[valueCol] ?? "") : rest.join(",")).replace(/\r/g, "");
    if (!key) {
      out.errors.push({ line, message: "Missing key." });
      continue;
    }
    if (!isKnownKey(key)) {
      out.errors.push({ line, message: `Unknown key "${key}".` });
      continue;
    }
    if (seen.has(key)) {
      out.errors.push({ line, message: `Duplicate key "${key}" — the first row was kept.` });
      continue;
    }
    if (!value.trim()) continue;
    if (value.length > 4000) {
      out.errors.push({ line, message: `Value for "${key}" is longer than 4000 characters.` });
      continue;
    }
    seen.add(key);
    out.rows.push({ key, value });
  }
  return out;
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Export rows as `key,value` CSV (with header). */
export function toTranslationCsv(rows: readonly { key: string; value: string }[]): string {
  return ["key,value", ...rows.map((r) => `${csvField(r.key)},${csvField(r.value)}`)].join("\n") + "\n";
}
