import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { PRICE_POSITION_LABEL, cell, pctCell, type InsightReport } from "@/server/analytics";

/**
 * Insurer insight report as a PDF (same pdf-lib pattern as `server/pdf.ts`: standard fonts,
 * WinAnsi-safe text, Covva footer). The content is already anonymised and suppressed by the
 * database function; this file only typesets it.
 */
const INK = rgb(0.08, 0.2, 0.24);
const MUTED = rgb(0.4, 0.45, 0.48);
const LINE = rgb(0.85, 0.88, 0.9);
const BRAND = rgb(0.0, 0.47, 0.42);

function safe(s: unknown): string {
  return String(s ?? "")
    .replace(/₵/g, "GHS ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff–•€]/g, "");
}

const money = (v: number | null | undefined) => (v == null ? "<5" : `GHS ${v.toLocaleString("en-GH", { maximumFractionDigits: 0 })}`);

interface Cursor { doc: PDFDocument; page: PDFPage; y: number; regular: PDFFont; bold: PDFFont; pages: number; width: number; height: number; margin: number; footer: (p: PDFPage) => void }

function ensure(c: Cursor, needed: number) {
  if (c.y - needed >= c.margin + 36) return;
  c.footer(c.page);
  c.page = c.doc.addPage([c.width, c.height]);
  c.pages++;
  c.y = c.height - c.margin;
}

function line(c: Cursor, s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
  const size = opts.size ?? 10;
  ensure(c, size * 1.5);
  c.page.drawText(safe(s), { x: c.margin, y: c.y - size, size, font: opts.bold ? c.bold : c.regular, color: opts.color ?? INK });
  c.y -= size * 1.5 + (opts.gap ?? 0);
}

function row(c: Cursor, cells: string[], widths: number[], opts: { bold?: boolean; size?: number } = {}) {
  const size = opts.size ?? 8.5;
  ensure(c, size * 1.9);
  let x = c.margin;
  cells.forEach((text, i) => {
    c.page.drawText(safe(text), { x, y: c.y - size, size, font: opts.bold ? c.bold : c.regular, color: opts.bold ? MUTED : INK });
    x += widths[i]!;
  });
  c.y -= size * 1.9;
  c.page.drawLine({ start: { x: c.margin, y: c.y + 2 }, end: { x: c.width - c.margin, y: c.y + 2 }, thickness: 0.4, color: LINE });
}

export async function renderInsightPdf(report: InsightReport, insurer: { name: string }): Promise<{ bytes: Uint8Array; sha256: string; pages: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Market insight ${report.month} - ${safe(insurer.name)}`);
  doc.setProducer("Covva");
  doc.setCreator("Covva analytics");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [height, width] = PageSizes.A4; // landscape
  const margin = 40;
  const footer = (p: PDFPage) => {
    p.drawLine({ start: { x: margin, y: 34 }, end: { x: width - margin, y: 34 }, thickness: 0.5, color: LINE });
    p.drawText(safe(`Prepared by Covva for ${insurer.name}. Covva is a technology provider, not an insurer or broker. Counts under ${report.suppression_threshold} are shown as "<5"; no broker or customer is identified.`), { x: margin, y: 22, size: 7, font: regular, color: MUTED });
  };
  const c: Cursor = { doc, page: doc.addPage([width, height]), y: height - margin, regular, bold, pages: 1, width, height, margin, footer };
  c.page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: BRAND });
  line(c, "Market insight report", { size: 18, bold: true });
  line(c, `${insurer.name} · ${report.month} (${report.period_start} to ${report.period_end})`, { size: 10, color: MUTED, gap: 6 });
  line(c, "Your share of quotes and of policies won per category, your price position against the market median (±10 % = in line), renewal retention and claims timing. Market figures include every participating insurer.", { size: 8.5, color: MUTED, gap: 8 });

  const widths = [120, 62, 62, 60, 60, 92, 70, 70, 80, 70];
  row(c, ["Category", "Quotes", "Share", "Wins", "Share", "Price vs market", "Renewals", "Retention", "Claims opened/settled", "Days to settle"], widths, { bold: true });
  if (!report.categories.length) line(c, "No activity in this month.", { size: 9, color: MUTED });
  for (const cat of report.categories) {
    row(c, [
      cat.category_name,
      `${cell(cat.quotes.mine)} / ${cell(cat.quotes.market)}`,
      pctCell(cat.quotes.share),
      `${cell(cat.wins.mine)} / ${cell(cat.wins.market)}`,
      pctCell(cat.wins.share),
      cat.price.position ? `${PRICE_POSITION_LABEL[cat.price.position]} (${money(cat.price.my_median)} vs ${money(cat.price.market_median)})` : "<5",
      `${cell(cat.renewals.due)} due / ${cell(cat.renewals.renewed)} kept`,
      `${pctCell(cat.renewals.retention)} (mkt ${pctCell(cat.renewals.market_retention)})`,
      `${cell(cat.claims.opened)} / ${cell(cat.claims.settled)}`,
      `${cat.claims.median_days_to_settle == null ? "<5" : cat.claims.median_days_to_settle} (mkt ${cat.claims.market_median_days_to_settle == null ? "<5" : cat.claims.market_median_days_to_settle})`,
    ], widths);
  }
  c.y -= 10;
  line(c, "How to read this: 'mine / market' counts your quotes or policies against the whole market for the month. Share is your part of that market. Retention is renewals kept over renewals due in the month. Days to settle is the median from report to payment.", { size: 7.5, color: MUTED });
  line(c, `Generated ${safe(report.generated_at.slice(0, 16).replace("T", " "))} UTC.`, { size: 7.5, color: MUTED });
  footer(c.page);
  const bytes = await doc.save();
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), pages: c.pages };
}
