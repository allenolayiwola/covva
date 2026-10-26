import "server-only";
import { OPEN_REQUEST_STATUSES } from "@im/core";
import { DAY, HOUR, median, type Supabase } from "@/lib/query";
import { findPaymentExceptions } from "@/lib/payments";

/**
 * Platform KPIs and unit economics (strategy doc). Computed from RLS reads with
 * bounded windows. At production scale these should move to SQL views / RPCs.
 * Everything here is aggregate-only — safe to pass to the AI insights summariser.
 */
export interface PlatformMetrics {
  generatedAt: string;
  requests: { today: number; d7: number; d30: number; daily: number[]; bySource: Record<string, number>; byCategory: Record<string, number> };
  quotes: { avgPerRequest: number | null; pctWith3Plus: number | null; medianResponseHours: number | null; requestsWithQuotes: number };
  conversion: { quoteToPurchase: number | null; purchased: number };
  policies: { issued30d: number; dailyIssued: number[]; medianIssuanceHours: number | null; active: number };
  payments: { exceptions: number; failed7d: number; succeeded30d: number; volume30d: number };
  complaints: { open: number; slaBreached: number; escalatedNic: number };
  sla: { openRequests: number; breached: number; unassigned: number };
  renewal: { rate: number | null; dueWindow: number };
  customers: { active: number };
  network: { activeBrokers: number; activeInsurers: number; pendingOrgs: number };
  gwp: { activePremium: number; note: string };
  revenue: { mrr: number; usageFeesMonth: number; paidInvoices30d: number; liveSubscriptions: number; trialing: number; note: string };
  ai: { calls30d: number; tokens30d: number; cost30d: number; successRate: number | null; dailyCost: number[] };
}

export interface PlatformAlerts {
  licences: { id: string; name: string; type: string; issue: string; due: string | null }[];
  slaBreaches: { id: string; reference: string; due_at: string | null; broker_org_id: string | null; status: string }[];
  failedPayments: { id: string; amount: number; provider_reference: string | null; created_at: string; failure_reason: string | null }[];
  audit: { ok: boolean; checked: number; firstBadId: number | null } | null;
}

function dayIndex(iso: string, start: number): number {
  return Math.floor((new Date(iso).getTime() - start) / DAY);
}

export async function computeMetrics(supabase: Supabase): Promise<PlatformMetrics> {
  const now = Date.now();
  const startToday = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime(); // Ghana = UTC
  const start30 = startToday - 29 * DAY;
  const since30 = new Date(start30).toISOString();
  const since60 = new Date(startToday - 59 * DAY).toISOString();
  const monthStart = new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00Z").toISOString();

  const [
    { data: reqs },
    { data: quotes },
    { data: activePolicies },
    { data: issued },
    { data: payments30 },
    { data: complaints },
    { data: openReqs },
    { data: renewalWindow },
    { data: orgs },
    { data: subs },
    { data: usage },
    { data: invoices },
    { data: ai },
    exceptions,
  ] = await Promise.all([
    supabase.from("requests").select("id, created_at, submitted_at, status, source, category_id, customer_id").gte("created_at", since30).neq("status", "draft").limit(20000),
    supabase.from("quotes").select("request_id, created_at, status").gte("created_at", since60).limit(50000),
    supabase.from("policies").select("customer_id, premium").eq("status", "active").eq("external_source", false).limit(50000),
    supabase.from("policies").select("id, issued_at, request_id").gte("issued_at", since30).limit(20000),
    supabase.from("payments").select("id, request_id, status, amount, paid_at, created_at").gte("created_at", since60).limit(20000),
    supabase.from("complaints").select("id, status, due_at").not("status", "in", "(resolved,closed)").limit(10000),
    supabase.from("requests").select("id, due_at, sla_breached_at, broker_org_id").in("status", OPEN_REQUEST_STATUSES).limit(20000),
    supabase.from("policies").select("status").gte("cover_end", new Date(now - 90 * DAY).toISOString().slice(0, 10)).lte("cover_end", new Date(now).toISOString().slice(0, 10)).neq("status", "cancelled").limit(20000),
    supabase.from("organizations").select("type, status"),
    supabase.from("subscriptions").select("org_id, status, plan:plans(monthly_fee, included_requests, per_request_fee, per_active_policy_fee)").in("status", ["trialing", "active", "past_due"]),
    supabase.from("usage_events").select("org_id, metric, quantity").gte("occurred_at", monthStart).limit(50000),
    supabase.from("invoices").select("total, paid_at").eq("status", "paid").gte("paid_at", since30),
    supabase.from("ai_usage").select("created_at, input_tokens, output_tokens, cost_usd, success").gte("created_at", since30).limit(50000),
    findPaymentExceptions(supabase),
  ]);

  // Requests ---------------------------------------------------------------
  const requests = reqs ?? [];
  const daily = Array.from({ length: 30 }, () => 0);
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let today = 0, d7 = 0;
  for (const r of requests) {
    const t = new Date(r.created_at).getTime();
    const i = dayIndex(r.created_at, start30);
    if (i >= 0 && i < 30) daily[i]!++;
    if (t >= startToday) today++;
    if (t >= startToday - 6 * DAY) d7++;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byCategory[r.category_id] = (byCategory[r.category_id] ?? 0) + 1;
  }

  // Quotes -------------------------------------------------------------------
  const reqIds = new Set(requests.map((r) => r.id));
  const quotesByReq = new Map<string, { created_at: string; status: string }[]>();
  for (const q of quotes ?? []) {
    if (!reqIds.has(q.request_id)) continue;
    const list = quotesByReq.get(q.request_id) ?? [];
    list.push(q);
    quotesByReq.set(q.request_id, list);
  }
  const quoteCounts = requests.map((r) => quotesByReq.get(r.id)?.length ?? 0);
  const responseHours: number[] = [];
  for (const r of requests) {
    const qs = quotesByReq.get(r.id);
    if (!qs?.length) continue;
    // Response = first insurer/broker-prepared quote (not an instant engine estimate), else first quote.
    const prepared = qs.filter((q) => q.status !== "estimate");
    const first = (prepared.length ? prepared : qs).map((q) => new Date(q.created_at).getTime()).sort((a, b) => a - b)[0]!;
    const start = new Date(r.submitted_at ?? r.created_at).getTime();
    if (first >= start) responseHours.push((first - start) / HOUR);
  }
  const requestsWithQuotes = quoteCounts.filter((c) => c > 0).length;

  // Policies & conversion ------------------------------------------------------
  const issuedList = issued ?? [];
  const dailyIssued = Array.from({ length: 30 }, () => 0);
  for (const p of issuedList) {
    const i = p.issued_at ? dayIndex(p.issued_at, start30) : -1;
    if (i >= 0 && i < 30) dailyIssued[i]!++;
  }
  const { data: purchased } = reqIds.size
    ? await supabase.from("policies").select("request_id").in("request_id", [...quotesByReq.keys()].slice(0, 300))
    : { data: [] as { request_id: string | null }[] };
  const purchasedCount = new Set((purchased ?? []).map((p) => p.request_id)).size;

  const paidByRequest = new Map<string, number>();
  for (const p of payments30 ?? []) {
    if (p.status === "succeeded") paidByRequest.set(p.request_id, new Date(p.paid_at ?? p.created_at).getTime());
  }
  const issuanceHours = issuedList
    .map((p) => (p.request_id && p.issued_at && paidByRequest.has(p.request_id) ? (new Date(p.issued_at).getTime() - paidByRequest.get(p.request_id)!) / HOUR : null))
    .filter((h): h is number => h !== null && h >= 0);

  // Payments ---------------------------------------------------------------------
  const pay30 = (payments30 ?? []).filter((p) => new Date(p.created_at).getTime() >= start30);
  const failed7d = pay30.filter((p) => (p.status === "failed" || p.status === "reversed") && new Date(p.created_at).getTime() >= now - 7 * DAY).length;
  const succeeded = pay30.filter((p) => p.status === "succeeded");

  // Complaints / SLA ----------------------------------------------------------------
  const openComplaints = complaints ?? [];
  const open = openReqs ?? [];

  // Renewal rate: of policies whose cover ended in the last 90 days, share renewed.
  const rw = renewalWindow ?? [];
  const renewed = rw.filter((p) => p.status === "renewed").length;
  const ended = rw.filter((p) => ["renewed", "expired", "lapsed"].includes(p.status)).length;

  // Customers -----------------------------------------------------------------------
  const customers = new Set<string>([...(activePolicies ?? []).map((p) => p.customer_id), ...requests.map((r) => r.customer_id)]);

  // Revenue ---------------------------------------------------------------------------
  type Plan = { monthly_fee: number; included_requests: number | null; per_request_fee: number; per_active_policy_fee: number };
  const usageByOrg = new Map<string, Record<string, number>>();
  for (const u of usage ?? []) {
    const m = usageByOrg.get(u.org_id) ?? {};
    m[u.metric] = (m[u.metric] ?? 0) + Number(u.quantity);
    usageByOrg.set(u.org_id, m);
  }
  let mrr = 0, usageFees = 0, trialing = 0;
  for (const s of subs ?? []) {
    const plan = (s.plan as unknown as Plan | null) ?? null;
    if (!plan) continue;
    if (s.status === "trialing") {
      trialing++;
      continue;
    }
    mrr += Number(plan.monthly_fee);
    const u = usageByOrg.get(s.org_id) ?? {};
    const reqOver = Math.max(0, (u.request_processed ?? 0) - (plan.included_requests ?? 0));
    usageFees += reqOver * Number(plan.per_request_fee) + (u.policy_active ?? 0) * Number(plan.per_active_policy_fee);
  }

  // AI -----------------------------------------------------------------------------------
  const aiRows = ai ?? [];
  const dailyCost = Array.from({ length: 30 }, () => 0);
  for (const a of aiRows) {
    const i = dayIndex(a.created_at, start30);
    if (i >= 0 && i < 30) dailyCost[i]! += Number(a.cost_usd ?? 0);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    requests: { today, d7, d30: requests.length, daily, bySource, byCategory },
    quotes: {
      avgPerRequest: requests.length ? quoteCounts.reduce((a, b) => a + b, 0) / requests.length : null,
      pctWith3Plus: requests.length ? quoteCounts.filter((c) => c >= 3).length / requests.length : null,
      medianResponseHours: median(responseHours),
      requestsWithQuotes,
    },
    conversion: { quoteToPurchase: requestsWithQuotes ? purchasedCount / requestsWithQuotes : null, purchased: purchasedCount },
    policies: { issued30d: issuedList.length, dailyIssued, medianIssuanceHours: median(issuanceHours), active: (activePolicies ?? []).length },
    payments: {
      exceptions: exceptions.length,
      failed7d,
      succeeded30d: succeeded.length,
      volume30d: succeeded.reduce((s, p) => s + Number(p.amount), 0),
    },
    complaints: {
      open: openComplaints.length,
      slaBreached: openComplaints.filter((c) => new Date(c.due_at).getTime() < now).length,
      escalatedNic: openComplaints.filter((c) => c.status === "escalated_nic").length,
    },
    sla: {
      openRequests: open.length,
      breached: open.filter((r) => r.sla_breached_at || (r.due_at && new Date(r.due_at).getTime() < now)).length,
      unassigned: open.filter((r) => !r.broker_org_id).length,
    },
    renewal: { rate: ended ? renewed / ended : null, dueWindow: rw.length },
    customers: { active: customers.size },
    network: {
      activeBrokers: (orgs ?? []).filter((o) => o.type === "broker" && o.status === "active").length,
      activeInsurers: (orgs ?? []).filter((o) => o.type === "insurer" && o.status === "active").length,
      pendingOrgs: (orgs ?? []).filter((o) => o.status === "pending").length,
    },
    gwp: {
      activePremium: (activePolicies ?? []).reduce((s, p) => s + Number(p.premium ?? 0), 0),
      note: "Premium arranged, not platform revenue. Premiums settle directly to insurers.",
    },
    revenue: {
      mrr,
      usageFeesMonth: usageFees,
      paidInvoices30d: (invoices ?? []).reduce((s, i) => s + Number(i.total), 0),
      liveSubscriptions: (subs ?? []).length,
      trialing,
      note: "Subscriptions (excluding trials) + usage fees this month from plan rates × usage_events.",
    },
    ai: {
      calls30d: aiRows.length,
      tokens30d: aiRows.reduce((s, a) => s + a.input_tokens + a.output_tokens, 0),
      cost30d: aiRows.reduce((s, a) => s + Number(a.cost_usd ?? 0), 0),
      successRate: aiRows.length ? aiRows.filter((a) => a.success).length / aiRows.length : null,
      dailyCost,
    },
  };
}

export async function computeAlerts(supabase: Supabase): Promise<PlatformAlerts> {
  const now = Date.now();
  const in60 = new Date(now + 60 * DAY).toISOString().slice(0, 10);
  const [{ data: orgs }, { data: breaches }, { data: failed }, audit] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, type, nic_licence_number, nic_licence_expires_on, professional_indemnity_expires_on, licence_verified_at")
      .in("type", ["broker", "insurer"])
      .in("status", ["active", "pending"]),
    supabase
      .from("requests")
      .select("id, reference, due_at, broker_org_id, status")
      .in("status", OPEN_REQUEST_STATUSES)
      .lt("due_at", new Date(now).toISOString())
      .order("due_at")
      .limit(8),
    supabase
      .from("payments")
      .select("id, amount, provider_reference, created_at, failure_reason")
      .in("status", ["failed", "reversed"])
      .eq("reconciled", false)
      .gte("created_at", new Date(now - 7 * DAY).toISOString())
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.rpc("verify_audit_chain", { p_limit: 10000 }),
  ]);

  const licences: PlatformAlerts["licences"] = [];
  for (const o of orgs ?? []) {
    if (!o.nic_licence_number) licences.push({ id: o.id, name: o.name, type: o.type, issue: "No NIC licence number recorded", due: null });
    else if (!o.licence_verified_at) licences.push({ id: o.id, name: o.name, type: o.type, issue: "Licence not verified", due: null });
    if (o.nic_licence_expires_on && o.nic_licence_expires_on <= in60) {
      licences.push({ id: o.id, name: o.name, type: o.type, issue: o.nic_licence_expires_on < new Date(now).toISOString().slice(0, 10) ? "NIC licence expired" : "NIC licence expiring", due: o.nic_licence_expires_on });
    }
    if (o.type === "broker") {
      if (!o.professional_indemnity_expires_on) licences.push({ id: o.id, name: o.name, type: o.type, issue: "No PI cover expiry recorded", due: null });
      else if (o.professional_indemnity_expires_on <= in60) licences.push({ id: o.id, name: o.name, type: o.type, issue: "PI cover expiring", due: o.professional_indemnity_expires_on });
    }
  }

  const a = audit.data?.[0];
  return {
    licences,
    slaBreaches: breaches ?? [],
    failedPayments: (failed ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
    audit: a ? { ok: a.ok, checked: a.checked, firstBadId: a.first_bad_id } : null,
  };
}
