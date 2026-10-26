import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { defaultTemplate, isHtmlTemplate, qrMatrix, readPath, type DocumentTemplate, type StructuredTemplate, type TemplateField, type TemplateKind } from "@im/core";

/**
 * Policy document renderer (Addendum 2 A, Level 2). Renders the schedule, certificate,
 * motor sticker (A6) and premium receipt from the insurer's approved `document_templates`
 * (structured blocks → typeset text; HTML templates → their text), or the default layout when
 * no approved template exists. The INSURER is always the issuing party; Covva appears only as
 * the technology provider. Every document carries a QR code that opens the public verify page.
 */
export type PdfKind = TemplateKind;

export interface PdfContext {
  kind: PdfKind;
  policy: {
    policy_number: string | null;
    internal_reference: string;
    cover_start: string | null;
    cover_end: string | null;
    premium: number | string | null;
    currency?: string | null;
    sum_insured?: number | string | null;
    excess?: number | string | null;
    issued_at?: string | null;
    verification_code?: string | null;
    sticker_number?: string | null;
    summary?: string | null;
  };
  customer: { full_name: string; email?: string | null; phone?: string | null; address?: string | null };
  insurer: { name: string; nic_licence_number?: string | null; contact_phone?: string | null; contact_email?: string | null; address?: string | null };
  product: { name: string; version?: number | null };
  category?: { name: string; slug?: string } | null;
  risk?: Record<string, unknown>;
  payment?: { amount: number | string; currency: string; channel?: string | null; provider_reference?: string | null; paid_at?: string | null } | null;
  broker?: { name: string; nic_licence_number?: string | null } | null;
  /** Absolute URL encoded in the QR code (`${siteUrl}/verify?q=<verification_code>`). */
  verifyUrl: string;
  /** Approved template for this kind, or null for the default layout. */
  template?: DocumentTemplate | null;
  /** Covva disclosure line printed on every document. */
  providerLine?: string;
}

export interface RenderedPdf {
  bytes: Uint8Array;
  sha256: string;
  pages: number;
}

const INK = rgb(0.08, 0.2, 0.24);
const MUTED = rgb(0.4, 0.45, 0.48);
const LINE = rgb(0.85, 0.88, 0.9);
const BRAND = rgb(0.0, 0.47, 0.42);

const TITLES: Record<PdfKind, string> = { schedule: "Policy schedule", certificate: "Certificate of insurance", sticker: "Motor insurance sticker", receipt: "Premium receipt" };

/** pdf-lib's standard fonts only encode WinAnsi: swap the cedi sign and strip the rest. */
function safe(s: unknown): string {
  return String(s ?? "")
    .replace(/₵/g, "GHS ")
    .replace(/GH₵/g, "GHS")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff–•€]/g, "");
}

function money(v: unknown, currency = "GHS"): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return safe(v);
  return `${currency} ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function date(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? safe(v) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatValue(v: unknown, format?: TemplateField["format"], currency = "GHS"): string {
  if (v === undefined || v === null || v === "") return "";
  if (format === "money") return money(v, currency);
  if (format === "date") return date(v);
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(", ");
  if (typeof v === "object") return safe(JSON.stringify(v));
  return safe(v);
}

/** Plain-text `{{path}}` interpolation (the core `interpolate` HTML-escapes; PDFs need raw text). */
function fill(text: string, ctx: Record<string, unknown>, currency: string): string {
  return safe(String(text ?? "").replace(/\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}/g, (_m, path: string) => {
    const v = readPath(ctx, path);
    const format: TemplateField["format"] = /premium|amount|sum_insured|excess/.test(path) ? "money" : /_at$|_start$|_end$|date/.test(path) ? "date" : "text";
    return formatValue(v, format, currency);
  }));
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/h[1-6]|\/li|\/tr|\/div)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

interface Cursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  margin: number;
  width: number;
  height: number;
  regular: PDFFont;
  bold: PDFFont;
  pages: number;
  footer: (page: PDFPage) => void;
}

function ensure(c: Cursor, needed: number) {
  if (c.y - needed >= c.margin + 36) return;
  c.footer(c.page);
  c.page = c.doc.addPage([c.width, c.height]);
  c.pages++;
  c.y = c.height - c.margin;
}

function text(c: Cursor, s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; width?: number; gap?: number } = {}) {
  const size = opts.size ?? 10;
  const font = opts.bold ? c.bold : c.regular;
  const width = opts.width ?? c.width - c.margin * 2 - (opts.indent ?? 0);
  const lines = wrap(safe(s), font, size, width);
  for (const line of lines) {
    ensure(c, size * 1.4);
    c.page.drawText(line, { x: c.margin + (opts.indent ?? 0), y: c.y - size, size, font, color: opts.color ?? INK });
    c.y -= size * 1.4;
  }
  c.y -= opts.gap ?? 2;
}

function divider(c: Cursor) {
  ensure(c, 10);
  c.page.drawLine({ start: { x: c.margin, y: c.y - 4 }, end: { x: c.width - c.margin, y: c.y - 4 }, thickness: 0.6, color: LINE });
  c.y -= 12;
}

function fieldGrid(c: Cursor, items: { label: string; value: string }[], columns: number) {
  const cols = Math.max(1, Math.min(3, columns));
  const colWidth = (c.width - c.margin * 2) / cols;
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols);
    const valueLines = row.map((it) => wrap(it.value || "-", c.regular, 10, colWidth - 8));
    const rowHeight = 12 + Math.max(...valueLines.map((l) => l.length)) * 13 + 6;
    ensure(c, rowHeight);
    row.forEach((it, j) => {
      const x = c.margin + j * colWidth;
      c.page.drawText(safe(it.label).toUpperCase(), { x, y: c.y - 8, size: 7, font: c.bold, color: MUTED });
      valueLines[j]!.forEach((line, k) => c.page.drawText(line, { x, y: c.y - 21 - k * 13, size: 10, font: c.regular, color: INK }));
    });
    c.y -= rowHeight;
  }
}

function drawQr(page: PDFPage, value: string, x: number, y: number, size: number) {
  const m = qrMatrix(value);
  const quiet = 2;
  const cell = size / (m.size + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  for (let r = 0; r < m.size; r++) {
    for (let col = 0; col < m.size; col++) {
      if (!m.modules[r]![col]) continue;
      page.drawRectangle({ x: x + (col + quiet) * cell, y: y + size - (r + 1 + quiet) * cell, width: cell + 0.1, height: cell + 0.1, color: INK });
    }
  }
}

function templateContext(ctx: PdfContext): Record<string, unknown> {
  const currency = ctx.policy.currency ?? "GHS";
  return {
    kind: TITLES[ctx.kind].toLowerCase(),
    policy: { ...ctx.policy, policy_number: ctx.policy.policy_number ?? ctx.policy.internal_reference, currency },
    customer: ctx.customer,
    insurer: ctx.insurer,
    product: ctx.product,
    category: ctx.category ?? {},
    risk: ctx.risk ?? {},
    payment: ctx.payment ?? {},
    broker: ctx.broker ?? {},
    verify_url: ctx.verifyUrl,
  };
}

function resolveTemplate(ctx: PdfContext): StructuredTemplate | { text: string } {
  const t = ctx.template;
  const tctx = templateContext(ctx);
  const currency = ctx.policy.currency ?? "GHS";
  if (t && isHtmlTemplate(t)) return { text: htmlToText(fill(t.html, tctx, currency)) };
  if (t && Array.isArray((t as StructuredTemplate).blocks) && (t as StructuredTemplate).blocks.length) return t as StructuredTemplate;
  return defaultTemplate(ctx.kind);
}

function renderStructured(c: Cursor, t: StructuredTemplate, ctx: PdfContext) {
  const tctx = templateContext(ctx);
  const currency = ctx.policy.currency ?? "GHS";
  const fields = new Map((t.fields ?? []).map((f) => [f.key, f]));
  for (const b of t.blocks ?? []) {
    switch (b.type) {
      case "heading":
        text(c, fill(b.text, tctx, currency), { size: b.level === 1 ? 15 : b.level === 3 ? 10.5 : 12, bold: true, gap: 4 });
        break;
      case "paragraph":
        text(c, fill(b.text, tctx, currency), { size: 10, gap: 6 });
        break;
      case "fields": {
        const items = (b.fields ?? [])
          .map((k) => fields.get(k))
          .filter((f): f is TemplateField => !!f)
          .map((f) => ({ label: f.label, value: formatValue(readPath(tctx, f.path), f.format, currency) }));
        fieldGrid(c, items, b.columns ?? 2);
        break;
      }
      case "table":
        for (const r of b.rows ?? []) {
          ensure(c, 16);
          c.page.drawText(fill(r.label, tctx, currency), { x: c.margin, y: c.y - 10, size: 9.5, font: c.bold, color: MUTED });
          const lines = wrap(fill(r.value, tctx, currency), c.regular, 10, (c.width - c.margin * 2) * 0.6);
          lines.forEach((line, i) => c.page.drawText(line, { x: c.margin + (c.width - c.margin * 2) * 0.4, y: c.y - 10 - i * 13, size: 10, font: c.regular, color: INK }));
          c.y -= 6 + Math.max(1, lines.length) * 13;
        }
        c.y -= 4;
        break;
      case "divider":
        divider(c);
        break;
      case "signature":
        ensure(c, 40);
        c.page.drawLine({ start: { x: c.margin, y: c.y - 24 }, end: { x: c.margin + 180, y: c.y - 24 }, thickness: 0.8, color: INK });
        c.page.drawText(safe(b.label ?? "Authorised signatory"), { x: c.margin, y: c.y - 36, size: 8, font: c.regular, color: MUTED });
        c.page.drawText(`${safe(ctx.insurer.name)} (issued electronically)`, { x: c.margin, y: c.y - 46, size: 8, font: c.regular, color: MUTED });
        c.y -= 56;
        break;
      default:
        break;
    }
  }
  if (t.footer) {
    c.y -= 6;
    text(c, fill(t.footer, tctx, currency), { size: 8, color: MUTED });
  }
}

/** Renders one policy document. Returns the bytes, their SHA-256 and the page count. */
export async function renderPolicyPdf(kind: PdfKind, ctx: PdfContext): Promise<RenderedPdf> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${TITLES[kind]} - ${ctx.policy.policy_number ?? ctx.policy.internal_reference}`);
  doc.setAuthor(safe(ctx.insurer.name));
  doc.setProducer("Covva");
  doc.setCreator("Covva policy document renderer");
  doc.setSubject(`${TITLES[kind]} issued by ${safe(ctx.insurer.name)}`);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const providerLine = ctx.providerLine ?? "Technology provided by Covva. Covva is not an insurer or broker and does not hold premiums.";
  const number = ctx.policy.policy_number ?? ctx.policy.internal_reference;

  if (kind === "sticker") {
    // A6 portrait (105 × 148 mm): insurer, policy number, vehicle, dates and a large QR.
    const [w, h] = PageSizes.A6;
    const page = doc.addPage([w, h]);
    const margin = 18;
    page.drawRectangle({ x: margin / 2, y: margin / 2, width: w - margin, height: h - margin, borderColor: INK, borderWidth: 1.2 });
    page.drawRectangle({ x: margin / 2, y: h - margin / 2 - 34, width: w - margin, height: 34, color: BRAND });
    page.drawText(safe(ctx.insurer.name).slice(0, 40), { x: margin, y: h - margin / 2 - 22, size: 12, font: bold, color: rgb(1, 1, 1) });
    page.drawText("MOTOR INSURANCE STICKER", { x: margin, y: h - margin / 2 - 31, size: 6.5, font: bold, color: rgb(1, 1, 1) });
    let y = h - margin / 2 - 52;
    const row = (label: string, value: string, size = 10) => {
      page.drawText(label.toUpperCase(), { x: margin, y, size: 6, font: bold, color: MUTED });
      page.drawText(safe(value) || "-", { x: margin, y: y - 12, size, font: bold, color: INK });
      y -= 26;
    };
    const risk = ctx.risk ?? {};
    const reg = (risk.vehicle_registration ?? risk.registration_number ?? risk.registration ?? "") as string;
    row("Policy number", number, 11);
    if (reg) row("Vehicle registration", String(reg), 11);
    if (ctx.policy.sticker_number) row("Sticker number", ctx.policy.sticker_number);
    row("Cover from", `${date(ctx.policy.cover_start)}  to  ${date(ctx.policy.cover_end)}`, 9);
    if (ctx.category?.name) row("Cover", `${ctx.category.name}${ctx.product.name ? ` - ${ctx.product.name}` : ""}`, 8);
    const qrSize = 104;
    drawQr(page, ctx.verifyUrl, (w - qrSize) / 2, 44, qrSize);
    page.drawText("Scan to verify this policy", { x: margin, y: 34, size: 7, font: bold, color: INK });
    page.drawText(safe(ctx.verifyUrl).replace(/^https?:\/\//, ""), { x: margin, y: 25, size: 6, font: regular, color: MUTED });
    page.drawText(safe(providerLine).split(".")[0]!, { x: margin, y: 14, size: 5.5, font: regular, color: MUTED });
    const bytes = await doc.save();
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), pages: 1 };
  }

  const [width, height] = PageSizes.A4;
  const margin = 48;
  const footer = (page: PDFPage) => {
    page.drawLine({ start: { x: margin, y: 40 }, end: { x: width - margin, y: 40 }, thickness: 0.5, color: LINE });
    page.drawText(safe(providerLine), { x: margin, y: 28, size: 7, font: regular, color: MUTED });
    page.drawText(`Verify: ${safe(ctx.verifyUrl)}`, { x: margin, y: 18, size: 7, font: regular, color: MUTED });
  };
  const c: Cursor = { doc, page: doc.addPage([width, height]), y: height - margin, margin, width, height, regular, bold, pages: 1, footer };

  // Header: the insurer is the issuing party; Covva is the technology provider.
  c.page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: BRAND });
  c.page.drawText(safe(ctx.insurer.name), { x: margin, y: height - margin - 6, size: 18, font: bold, color: INK });
  const sub = [ctx.insurer.nic_licence_number ? `NIC licence ${ctx.insurer.nic_licence_number}` : null, ctx.insurer.contact_phone, ctx.insurer.contact_email].filter(Boolean).join("  |  ");
  if (sub) c.page.drawText(safe(sub), { x: margin, y: height - margin - 20, size: 8, font: regular, color: MUTED });
  c.page.drawText("Technology provided by Covva", { x: width - margin - regular.widthOfTextAtSize("Technology provided by Covva", 8), y: height - margin - 6, size: 8, font: regular, color: MUTED });
  const qrSize = 72;
  drawQr(c.page, ctx.verifyUrl, width - margin - qrSize, height - margin - 24 - qrSize, qrSize);
  c.page.drawText("Scan to verify", { x: width - margin - qrSize, y: height - margin - 24 - qrSize - 10, size: 7, font: regular, color: MUTED });

  c.y = height - margin - 40;
  text(c, TITLES[kind], { size: 20, bold: true, width: width - margin * 2 - qrSize - 12, gap: 2 });
  text(c, `Policy ${number}${ctx.policy.issued_at ? `  |  Issued ${date(ctx.policy.issued_at)}` : ""}`, { size: 10, color: MUTED, width: width - margin * 2 - qrSize - 12, gap: 10 });
  c.y = Math.min(c.y, height - margin - 24 - qrSize - 24);
  divider(c);

  const template = resolveTemplate(ctx);
  if ("text" in template) {
    text(c, template.text, { size: 10 });
  } else {
    renderStructured(c, template, ctx);
  }

  if (kind === "receipt" && ctx.payment) {
    divider(c);
    fieldGrid(
      c,
      [
        { label: "Amount received", value: money(ctx.payment.amount, ctx.payment.currency) },
        { label: "Paid on", value: date(ctx.payment.paid_at) },
        { label: "Channel", value: safe(ctx.payment.channel ?? "").replace(/_/g, " ") || "-" },
        { label: "Provider reference", value: safe(ctx.payment.provider_reference ?? "-") },
      ],
      2,
    );
    text(c, `Premium paid to ${safe(ctx.insurer.name)} through an authorised payment provider. Covva never holds premiums.`, { size: 8, color: MUTED });
  }

  if (kind === "schedule" && ctx.risk && Object.keys(ctx.risk).length) {
    divider(c);
    text(c, "Insured details", { size: 12, bold: true, gap: 4 });
    const items = Object.entries(ctx.risk)
      .filter(([k, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object" && !/^(preferred_insurer|insurer_org_id|talk_to_expert|simulate)/.test(k))
      .slice(0, 18)
      .map(([k, v]) => ({ label: k.replace(/_/g, " "), value: formatValue(v) }));
    if (items.length) fieldGrid(c, items, 3);
  }

  c.y -= 8;
  text(c, `Verification code ${safe(ctx.policy.verification_code ?? "")}. Anyone can confirm this policy at ${safe(ctx.verifyUrl)} without seeing personal details.`, { size: 8, color: MUTED });
  if (ctx.broker) text(c, `Broker of record: ${safe(ctx.broker.name)}${ctx.broker.nic_licence_number ? ` (NIC licence ${safe(ctx.broker.nic_licence_number)})` : ""}.`, { size: 8, color: MUTED });
  else text(c, "Issued directly by the insurer. There is no broker of record for this policy.", { size: 8, color: MUTED });
  footer(c.page);

  const bytes = await doc.save();
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), pages: c.pages };
}
