import type { NextRequest } from "next/server";
import { resolveStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/query";

const TYPES = ["premium_received", "premium_to_insurer", "broker_commission", "platform_fee", "revenue_share", "subscription_fee", "refund", "adjustment"];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** GET /commercial/export — CSV of ledger entries matching the list filters (max 10,000 rows). */
export async function GET(request: NextRequest) {
  const r = await resolveStaff();
  if (r.status !== "ok") return new Response("Not authorised", { status: r.status === "anonymous" ? 401 : 403 });

  const p = request.nextUrl.searchParams;
  const supabase = await createClient();
  let query = supabase.from("ledger_entries").select("*").order("id", { ascending: false }).limit(10000);
  const org = p.get("org");
  if (org && isUuid(org)) query = query.or(`org_id.eq.${org},counterparty_org_id.eq.${org}`);
  const type = p.get("type");
  if (type && TYPES.includes(type)) query = query.eq("entry_type", type);
  const from = p.get("from");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00Z`);
  const to = p.get("to");
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59Z`);

  const [{ data, error }, { data: orgs }] = await Promise.all([query, supabase.from("organizations").select("id, name")]);
  if (error) return new Response(error.message, { status: 500 });
  const names = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const header = ["id", "created_at", "entry_type", "org", "org_id", "counterparty", "counterparty_org_id", "amount", "currency", "payment_id", "policy_id", "reference", "memo"];
  const lines = [header.join(",")];
  for (const e of data ?? []) {
    lines.push([e.id, e.created_at, e.entry_type, names.get(e.org_id), e.org_id, e.counterparty_org_id ? names.get(e.counterparty_org_id) : "", e.counterparty_org_id, e.amount, e.currency, e.payment_id, e.policy_id, e.reference, e.memo].map(csvCell).join(","));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ledger-${stamp}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
