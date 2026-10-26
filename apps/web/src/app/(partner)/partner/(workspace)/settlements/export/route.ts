import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE } from "../../../_lib/context";
import { toCsv } from "../../../_lib/reports";

const ENTRY_LABEL: Record<string, string> = {
  premium_received: "Premium received",
  premium_to_insurer: "Premium to insurer",
  broker_commission: "Broker commission",
  platform_fee: "Platform fee",
  revenue_share: "Revenue share",
  subscription_fee: "Subscription fee",
  refund: "Refund",
  adjustment: "Adjustment",
};

/**
 * CSV export of the organisation's ledger (owners, admins and finance — enforced by the
 * `ledger: org read` RLS policy, so the query runs as the user). Query: `?from=YYYY-MM-DD&to=YYYY-MM-DD`
 * (default: the last 90 days). Entries where the org is the counterparty are shown as debits.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Sign in required", { status: 401 });

  const { data: memberships } = await supabase
    .from("memberships")
    .select("org_id, role, org:organizations(type, slug, name)")
    .eq("user_id", auth.user.id)
    .eq("active", true);
  const partner = (memberships ?? []).filter((m) => {
    const t = (m.org as unknown as { type: string } | null)?.type;
    return t === "broker" || t === "insurer";
  });
  if (!partner.length) return new Response("Partner access required", { status: 403 });
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const m = partner.find((x) => x.org_id === wanted) ?? partner[0]!;
  if (!["owner", "admin", "finance"].includes(m.role)) return new Response("Owners, admins and finance only", { status: 403 });
  const org = m.org as unknown as { type: "broker" | "insurer"; slug: string; name: string };

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const to = dateRe.test(req.nextUrl.searchParams.get("to") ?? "") ? req.nextUrl.searchParams.get("to")! : new Date().toISOString().slice(0, 10);
  const from = dateRe.test(req.nextUrl.searchParams.get("from") ?? "") ? req.nextUrl.searchParams.get("from")! : new Date(Date.parse(`${to}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);

  const { data: entries, error } = await supabase
    .from("ledger_entries")
    .select("id, created_at, entry_type, org_id, counterparty_org_id, amount, currency, memo, reference, payment_id, policy_id")
    .or(`org_id.eq.${m.org_id},counterparty_org_id.eq.${m.org_id}`)
    .gte("created_at", `${from}T00:00:00Z`)
    .lt("created_at", `${new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`)
    .order("created_at", { ascending: true })
    .limit(10000);
  if (error) return new Response("Could not read the ledger", { status: 500 });

  const orgIds = [...new Set((entries ?? []).flatMap((e) => [e.org_id, e.counterparty_org_id]).filter((x): x is string => !!x))];
  const { data: orgs } = orgIds.length ? await supabase.from("organizations").select("id, name").in("id", orgIds) : { data: [] as { id: string; name: string }[] };
  const names = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const rows = (entries ?? []).map((e) => {
    const credit = e.org_id === m.org_id;
    const signed = credit ? Number(e.amount) : -Number(e.amount);
    return [
      e.created_at,
      ENTRY_LABEL[e.entry_type] ?? e.entry_type,
      credit ? "credit" : "debit",
      signed.toFixed(2),
      e.currency,
      credit ? (e.counterparty_org_id ? names.get(e.counterparty_org_id) ?? e.counterparty_org_id : "Customer") : names.get(e.org_id) ?? e.org_id,
      e.reference,
      e.payment_id,
      e.policy_id,
      e.memo,
      String(e.id),
    ];
  });
  const csv = toCsv({ header: ["posted_at", "entry", "direction", "amount", "currency", "counterparty", "reference", "payment_id", "policy_id", "memo", "entry_id"], rows });
  const filename = `${org.slug}-ledger-${from}-to-${to}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
