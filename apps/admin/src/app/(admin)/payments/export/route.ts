import type { NextRequest } from "next/server";
import { PAYMENT_STATUS, type PaymentStatus } from "@im/core";
import type { Enum } from "@im/db";
import { resolveStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ilikeTerm, isUuid } from "@/lib/query";
import { PAYMENT_COLUMNS, type PaymentRow } from "@/lib/payments";

const CHANNELS = ["mobile_money", "card", "bank_transfer", "ussd"];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** GET /payments/export — CSV of payments matching the list filters (max 10,000 rows). */
export async function GET(request: NextRequest) {
  const r = await resolveStaff();
  if (r.status !== "ok") return new Response("Not authorised", { status: r.status === "anonymous" ? 401 : 403 });

  const p = request.nextUrl.searchParams;
  const supabase = await createClient();
  let query = supabase.from("payments").select(PAYMENT_COLUMNS).order("created_at", { ascending: false }).limit(10000);
  const status = p.get("status");
  if (status && status in PAYMENT_STATUS) query = query.eq("status", status as PaymentStatus);
  if (p.get("reconciled") === "yes") query = query.eq("reconciled", true);
  if (p.get("reconciled") === "no") query = query.eq("reconciled", false);
  const payee = p.get("payee");
  if (payee && isUuid(payee)) query = query.eq("payee_org_id", payee);
  const channel = p.get("channel");
  if (channel && CHANNELS.includes(channel)) query = query.eq("channel", channel as Enum<"payment_channel">);
  const q = p.get("q");
  if (q) query = isUuid(q) ? query.or(`id.eq.${q},request_id.eq.${q}`) : query.ilike("provider_reference", ilikeTerm(q));

  const [{ data, error }, { data: orgs }] = await Promise.all([query, supabase.from("organizations").select("id, name").eq("type", "insurer")]);
  if (error) return new Response(error.message, { status: 500 });
  const names = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const header = ["id", "provider", "provider_reference", "status", "amount", "currency", "channel", "payee_insurer", "payee_org_id", "request_id", "quote_id", "policy_id", "paid_at", "created_at", "reconciled", "reconciled_at", "failure_reason"];
  const lines = [header.join(",")];
  for (const row of (data ?? []) as PaymentRow[]) {
    lines.push(
      [row.id, row.provider, row.provider_reference, row.status, row.amount, row.currency, row.channel, names.get(row.payee_org_id), row.payee_org_id, row.request_id, row.quote_id, row.policy_id, row.paid_at, row.created_at, row.reconciled, row.reconciled_at, row.failure_reason]
        .map(csvCell)
        .join(","),
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payments-${stamp}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
