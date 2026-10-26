/**
 * Document templates (Addendum 3 B3): schedule, certificate, sticker and receipt
 * templates per product version. A template is either a structured document
 * (fields + layout blocks) or raw HTML; both interpolate `{{path.to.value}}` from a
 * context such as { policy, customer, insurer, product, quote }. No external deps.
 */
export type TemplateKind = "schedule" | "certificate" | "sticker" | "receipt";
export const TEMPLATE_KINDS: TemplateKind[] = ["schedule", "certificate", "sticker", "receipt"];

export interface TemplateField { key: string; label: string; path: string; format?: "text" | "money" | "date" }
export type TemplateBlock =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "paragraph"; text: string }
  | { type: "fields"; fields: string[]; columns?: 1 | 2 | 3 }
  | { type: "table"; rows: { label: string; value: string }[] }
  | { type: "divider" }
  | { type: "signature"; label?: string };

export interface StructuredTemplate { title?: string; fields: TemplateField[]; blocks: TemplateBlock[]; footer?: string }
export interface HtmlTemplate { html: string }
export type DocumentTemplate = StructuredTemplate | HtmlTemplate;

export type TemplateContext = Record<string, unknown>;

const BLOCK_TYPES = ["heading", "paragraph", "fields", "table", "divider", "signature"] as const;

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Reads a dotted path (`policy.number`, `items.0.label`) from the context. */
export function readPath(ctx: TemplateContext, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc !== null && acc !== undefined && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), ctx);
}

function formatValue(v: unknown, format?: TemplateField["format"]): string {
  if (v === undefined || v === null || v === "") return "";
  if (format === "money") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isNaN(n) ? String(v) : `GH₵ ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (format === "date") {
    const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : String(v);
  }
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Replaces `{{ path }}` placeholders; values are HTML-escaped. Unknown paths render empty. */
export function interpolate(text: string, ctx: TemplateContext): string {
  return String(text ?? "").replace(/\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}/g, (_m, path: string) => escapeHtml(formatValue(readPath(ctx, path))));
}

export function isHtmlTemplate(t: DocumentTemplate | null | undefined): t is HtmlTemplate {
  return !!t && typeof (t as HtmlTemplate).html === "string";
}

/**
 * Renders a template to a self-contained HTML fragment. Structured templates become
 * simple semantic markup (h1/h2, p, dl, table) with class names the apps can style.
 */
export function renderTemplate(template: DocumentTemplate, ctx: TemplateContext): string {
  if (isHtmlTemplate(template)) return interpolate(template.html, ctx);
  const t = template as StructuredTemplate;
  const fields = new Map((t.fields ?? []).map((f) => [f.key, f]));
  const out: string[] = ['<article class="doc">'];
  if (t.title) out.push(`<h1 class="doc-title">${interpolate(t.title, ctx)}</h1>`);
  for (const b of t.blocks ?? []) {
    switch (b.type) {
      case "heading": {
        const level = b.level && b.level >= 1 && b.level <= 3 ? b.level : 2;
        out.push(`<h${level} class="doc-heading">${interpolate(b.text, ctx)}</h${level}>`);
        break;
      }
      case "paragraph":
        out.push(`<p class="doc-paragraph">${interpolate(b.text, ctx)}</p>`);
        break;
      case "fields": {
        const cols = b.columns ?? 2;
        out.push(`<dl class="doc-fields doc-cols-${cols}">`);
        for (const key of b.fields ?? []) {
          const f = fields.get(key);
          if (!f) continue;
          out.push(`<div class="doc-field"><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(formatValue(readPath(ctx, f.path), f.format))}</dd></div>`);
        }
        out.push("</dl>");
        break;
      }
      case "table":
        out.push('<table class="doc-table"><tbody>');
        for (const r of b.rows ?? []) out.push(`<tr><th scope="row">${interpolate(r.label, ctx)}</th><td>${interpolate(r.value, ctx)}</td></tr>`);
        out.push("</tbody></table>");
        break;
      case "divider":
        out.push('<hr class="doc-divider" />');
        break;
      case "signature":
        out.push(`<div class="doc-signature"><span class="doc-signature-line"></span><span>${escapeHtml(b.label ?? "Authorised signatory")}</span></div>`);
        break;
      default:
        break;
    }
  }
  if (t.footer) out.push(`<footer class="doc-footer">${interpolate(t.footer, ctx)}</footer>`);
  out.push("</article>");
  return out.join("\n");
}

export interface TemplateValidation { ok: boolean; errors: string[]; placeholders: string[] }

/** Structural checks before a template is saved or approved. */
export function validateTemplate(template: unknown): TemplateValidation {
  const errors: string[] = [];
  const placeholders = new Set<string>();
  const collect = (s: unknown) => {
    for (const m of String(s ?? "").matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
      const p = m[1] ?? "";
      if (!/^[a-zA-Z0-9_.\-]+$/.test(p)) errors.push(`Placeholder "{{${p}}}" is not a simple path like policy.number.`);
      else placeholders.add(p);
    }
    const open = (String(s ?? "").match(/\{\{/g) ?? []).length;
    const close = (String(s ?? "").match(/\}\}/g) ?? []).length;
    if (open !== close) errors.push("Unbalanced {{ }} placeholders.");
  };
  if (!template || typeof template !== "object") return { ok: false, errors: ["Template must be an object."], placeholders: [] };
  if (isHtmlTemplate(template as DocumentTemplate)) {
    const html = (template as HtmlTemplate).html;
    if (!html.trim()) errors.push("HTML template is empty.");
    if (/<script\b/i.test(html)) errors.push("Scripts are not allowed in document templates.");
    collect(html);
    return { ok: errors.length === 0, errors, placeholders: [...placeholders] };
  }
  const t = template as Partial<StructuredTemplate>;
  if (!Array.isArray(t.blocks) || t.blocks.length === 0) errors.push("Add at least one block.");
  const fieldKeys = new Set<string>();
  for (const [i, f] of (Array.isArray(t.fields) ? t.fields : []).entries()) {
    if (!f || typeof f !== "object" || !f.key) { errors.push(`Field ${i + 1} needs a key.`); continue; }
    if (fieldKeys.has(f.key)) errors.push(`Field key "${f.key}" is used twice.`);
    fieldKeys.add(f.key);
    if (!f.label) errors.push(`Field "${f.key}" needs a label.`);
    if (!f.path || !/^[a-zA-Z0-9_.\-]+$/.test(f.path)) errors.push(`Field "${f.key}" needs a data path like customer.full_name.`);
    else placeholders.add(f.path);
  }
  for (const [i, b] of (Array.isArray(t.blocks) ? t.blocks : []).entries()) {
    const n = i + 1;
    if (!b || typeof b !== "object" || !(BLOCK_TYPES as readonly string[]).includes((b as { type?: string }).type ?? "")) {
      errors.push(`Block ${n} has an unknown type (use ${BLOCK_TYPES.join(", ")}).`);
      continue;
    }
    if (b.type === "heading" || b.type === "paragraph") {
      if (!b.text?.trim()) errors.push(`Block ${n} (${b.type}) has no text.`);
      collect(b.text);
    }
    if (b.type === "fields") {
      if (!Array.isArray(b.fields) || !b.fields.length) errors.push(`Block ${n} (fields) lists no fields.`);
      for (const k of b.fields ?? []) if (!fieldKeys.has(k)) errors.push(`Block ${n} references unknown field "${k}".`);
    }
    if (b.type === "table") {
      if (!Array.isArray(b.rows) || !b.rows.length) errors.push(`Block ${n} (table) has no rows.`);
      for (const r of b.rows ?? []) { collect(r.label); collect(r.value); }
    }
  }
  if (t.title) collect(t.title);
  if (t.footer) collect(t.footer);
  return { ok: errors.length === 0, errors, placeholders: [...placeholders] };
}

/** Starter templates per kind so insurers do not begin from a blank page. */
export function defaultTemplate(kind: TemplateKind): StructuredTemplate {
  const common: TemplateField[] = [
    { key: "policy_number", label: "Policy number", path: "policy.policy_number" },
    { key: "insured", label: "Insured", path: "customer.full_name" },
    { key: "insurer", label: "Insurer", path: "insurer.name" },
    { key: "product", label: "Product", path: "product.name" },
    { key: "cover_start", label: "Cover starts", path: "policy.cover_start", format: "date" },
    { key: "cover_end", label: "Cover ends", path: "policy.cover_end", format: "date" },
    { key: "premium", label: "Premium", path: "policy.premium", format: "money" },
  ];
  const titles: Record<TemplateKind, string> = { schedule: "Policy schedule", certificate: "Certificate of insurance", sticker: "Insurance sticker", receipt: "Premium receipt" };
  const blocks: TemplateBlock[] =
    kind === "sticker"
      ? [{ type: "heading", text: "{{insurer.name}}", level: 2 }, { type: "fields", fields: ["policy_number", "cover_start", "cover_end"], columns: 1 }]
      : kind === "receipt"
        ? [{ type: "paragraph", text: "Received from {{customer.full_name}} the premium for policy {{policy.policy_number}}." }, { type: "fields", fields: ["premium", "product", "insurer"], columns: 3 }, { type: "signature", label: "For the insurer" }]
        : [
            { type: "paragraph", text: "This {{kind}} is issued by {{insurer.name}} under the policy wording for {{product.name}}." },
            { type: "fields", fields: ["policy_number", "insured", "product", "cover_start", "cover_end", "premium"], columns: 2 },
            { type: "divider" },
            { type: "signature", label: "Authorised signatory" },
          ];
  return { title: titles[kind], fields: common, blocks, footer: "Full policy wording applies. Complaints: contact your insurer or broker, or Covva." };
}
