import "server-only";
import type { createClient } from "@/lib/supabase/server";

type SB = Awaited<ReturnType<typeof createClient>>;
export interface ReportScope { supabase: SB; orgId: string; kind: "broker" | "insurer"; days: number }

export interface Metric {
  key: string;
  label: string;
  value: string;
  detail?: string;
  /** 0–1 for progress bars */
  ratio?: number | null;
  warn?: boolean;
  placeholder?: boolean;
}

export interface Report {
  metrics: Metric[];
  weekly: { label: string; value: number }[];
  breakdowns: { title: string; items: { label: string; value: number }[] }[];
  datasets: Record<string, { header: string[]; rows: (string | number | null)[][] }>;
}

const H = 3_600_000;
const D = 86_400_000;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const pct = (n: number, d: number) => (d ? n / d : null);
const fmtPct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);
const fmtHours = (h: number | null) => (h == null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

function weeks(dates: string[], n = 12) {
  const now = Date.now();
  const out = Array.from({ length: n }, (_, i) => {
    const start = new Date(now - (n - i) * 7 * D);
    return { label: start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), from: start.getTime(), to: start.getTime() + 7 * D, value: 0 };
  });
  for (const d of dates) {
    const t = Date.parse(d);
    const w = out.find((x) => t >= x.from && t < x.to);
    if (w) w.value++;
  }
  return out.map(({ label, value }) => ({ label, value }));
}

function countBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export async function buildReport(scope: ReportScope, names: { categories: Map<string, string>; orgs?: Map<string, string> }): Promise<Report> {
  return scope.kind === "insurer" ? insurerReport(scope, names) : brokerReport(scope, names);
}

async function brokerReport({ supabase: sb, orgId, days }: ReportScope, names: { categories: Map<string, string> }): Promise<Report> {
  const since = new Date(Date.now() - days * D).toISOString();
  const { data: reqs } = await sb
    .from("requests")
    .select("id, reference, status, type, source, category_id, created_at, submitted_at, completed_at, due_at")
    .eq("broker_org_id", orgId)
    .neq("status", "draft")
    .gte("created_at", since)
    .limit(5000);
  const requests = reqs ?? [];
  const ids = requests.map((r) => r.id);
  const chunk = ids.slice(0, 1000); // PostgREST URL limits; pilot volumes fit comfortably
  const empty = { data: [] as never[] };
  const [quotes, events, policies, payments, complaints, messages, tasks, expiring] = await Promise.all([
    sb.from("quotes").select("id, request_id, insurer_org_id, status, premium, excess, key_exclusion, valid_until, created_at").eq("broker_org_id", orgId).gte("created_at", since).limit(10000),
    chunk.length ? sb.from("request_events").select("request_id, actor_party, event, created_at").in("request_id", chunk).eq("actor_party", "broker").order("created_at").limit(20000) : Promise.resolve(empty),
    sb.from("policies").select("id, request_id, status, created_at, issued_at, cover_end, policy_number").eq("broker_org_id", orgId).gte("created_at", since).limit(5000),
    chunk.length ? sb.from("payments").select("id, request_id, status, reconciled, paid_at, amount").in("request_id", chunk).limit(5000) : Promise.resolve(empty),
    sb.from("complaints").select("id, status, created_at, resolved_at, due_at").eq("owner_org_id", orgId).gte("created_at", since).limit(5000),
    chunk.length ? sb.from("request_messages").select("request_id").in("request_id", chunk).limit(20000) : Promise.resolve(empty),
    chunk.length ? sb.from("request_tasks").select("request_id").in("request_id", chunk).limit(20000) : Promise.resolve(empty),
    sb.from("policies").select("id, status, cover_end").eq("broker_org_id", orgId).lte("cover_end", new Date().toISOString().slice(0, 10)).gte("cover_end", since.slice(0, 10)).limit(5000),
  ]);
  const q = quotes.data ?? [];
  const pol = policies.data ?? [];
  const pay = (payments.data ?? []) as { id: string; request_id: string; status: string; reconciled: boolean; paid_at: string | null; amount: number }[];
  const cmp = complaints.data ?? [];

  const withQuotes = new Set(q.map((x) => x.request_id));
  const insurersPer = requests.map((r) => new Set(q.filter((x) => x.request_id === r.id).map((x) => x.insurer_org_id)).size);
  const complete = q.filter((x) => Number(x.premium) > 0 && x.excess != null && !!x.key_exclusion && (x.status !== "ready_to_accept" || !!x.valid_until));

  const firstResponse: number[] = [];
  let withinTarget = 0;
  let measured = 0;
  for (const r of requests) {
    const start = Date.parse(r.submitted_at ?? r.created_at);
    const first = (events.data ?? []).find((e: { request_id: string; event: string; created_at: string }) => e.request_id === r.id && e.event !== "created" && Date.parse(e.created_at) >= start);
    if (first) {
      const hrs = (Date.parse(first.created_at) - start) / H;
      firstResponse.push(hrs);
      if (r.due_at) {
        measured++;
        if (Date.parse(first.created_at) <= Date.parse(r.due_at)) withinTarget++;
      }
    }
  }
  const withPolicy = new Set(pol.map((p) => p.request_id).filter(Boolean));
  const converted = [...withQuotes].filter((id) => withPolicy.has(id)).length;
  const issuance = pol.filter((p) => p.issued_at).map((p) => (Date.parse(p.issued_at!) - Date.parse(p.created_at)) / H);
  const exceptions = pay.filter((p) => (p.status === "succeeded" && !p.reconciled && p.paid_at && Date.now() - Date.parse(p.paid_at) > 2 * D) || p.status === "reversed" || p.status === "failed").length;
  const activePolicies = pol.filter((p) => p.status === "active").length;
  const resolvedInSla = cmp.filter((c) => c.resolved_at && Date.parse(c.resolved_at) <= Date.parse(c.due_at)).length;
  const due = expiring.data ?? [];
  const renewed = due.filter((p) => p.status === "renewed").length;
  const msgPer = requests.length ? (messages.data ?? []).length / requests.length : null;
  const taskPer = requests.length ? (tasks.data ?? []).length / requests.length : null;

  const coverage = pct(withQuotes.size, requests.length);
  const metrics: Metric[] = [
    { key: "quote_coverage", label: "Quote coverage", value: fmtPct(coverage), ratio: coverage, detail: `${withQuotes.size} of ${requests.length} requests received at least one quote · avg ${(insurersPer.reduce((s, x) => s + x, 0) / Math.max(1, requests.length)).toFixed(1)} insurers per request` },
    { key: "quote_completeness", label: "Quote completeness", value: fmtPct(pct(complete.length, q.length)), ratio: pct(complete.length, q.length), detail: "Quotes with premium, excess, key exclusion and validity" },
    { key: "median_response", label: "Median first response", value: fmtHours(median(firstResponse)), detail: `${fmtPct(pct(withinTarget, measured))} within response target` },
    { key: "conversion", label: "Quote → policy conversion", value: fmtPct(pct(converted, withQuotes.size)), ratio: pct(converted, withQuotes.size), detail: `${converted} policies from ${withQuotes.size} quoted requests` },
    { key: "issuance_time", label: "Median issuance time", value: fmtHours(median(issuance)), detail: "Payment confirmed → insurer issues policy" },
    { key: "reconciliation", label: "Reconciliation exceptions", value: String(exceptions), warn: exceptions > 0, detail: "Unreconciled after 2 days, failed or reversed payments" },
    { key: "complaints_rate", label: "Complaints per 100 policies", value: activePolicies ? ((cmp.length / activePolicies) * 100).toFixed(1) : cmp.length ? "∞" : "0", detail: `${cmp.length} complaints · ${fmtPct(pct(resolvedInSla, cmp.length))} resolved within 14 days` },
    { key: "retention", label: "Renewal retention", value: fmtPct(pct(renewed, due.length)), ratio: pct(renewed, due.length), detail: `${renewed} of ${due.length} policies expiring in the period were renewed` },
    { key: "cost_to_serve", label: "Cost to serve", value: msgPer == null ? "—" : `${msgPer.toFixed(1)} msgs · ${taskPer!.toFixed(1)} tasks`, detail: "Per request. Cost per adviser hour is a placeholder until finance data is connected.", placeholder: true },
  ];

  return {
    metrics,
    weekly: weeks(requests.map((r) => r.created_at)),
    breakdowns: [
      { title: "Requests by source", items: countBy(requests, (r) => r.source.replace("_", " ")) },
      { title: "Requests by category", items: countBy(requests, (r) => names.categories.get(r.category_id) ?? "Other") },
      { title: "Quotes by status", items: countBy(q, (x) => x.status.replace(/_/g, " ")) },
    ],
    datasets: {
      metrics: { header: ["metric", "value", "detail"], rows: metrics.map((m) => [m.label, m.value, m.detail ?? ""]) },
      requests: {
        header: ["reference", "status", "type", "source", "category", "created_at", "submitted_at", "completed_at", "due_at"],
        rows: requests.map((r) => [r.reference, r.status, r.type, r.source, names.categories.get(r.category_id) ?? "", r.created_at, r.submitted_at, r.completed_at, r.due_at]),
      },
      quotes: {
        header: ["quote_id", "request_id", "insurer_org_id", "status", "premium", "excess", "valid_until", "created_at"],
        rows: q.map((x) => [x.id, x.request_id, x.insurer_org_id, x.status, Number(x.premium), x.excess != null ? Number(x.excess) : null, x.valid_until, x.created_at]),
      },
      policies: {
        header: ["policy_id", "policy_number", "request_id", "status", "created_at", "issued_at", "cover_end"],
        rows: pol.map((p) => [p.id, p.policy_number, p.request_id, p.status, p.created_at, p.issued_at, p.cover_end]),
      },
    },
  };
}

async function insurerReport({ supabase: sb, orgId, days }: ReportScope, names: { categories: Map<string, string>; orgs?: Map<string, string> }): Promise<Report> {
  const since = new Date(Date.now() - days * D).toISOString();
  const [subs, quotes, policies, claims] = await Promise.all([
    sb.from("insurer_submissions").select("id, request_id, broker_org_id, status, channel, sent_at, responded_at, response_due_at, created_at").eq("insurer_org_id", orgId).gte("created_at", since).limit(10000),
    sb.from("quotes").select("id, status, created_at").eq("insurer_org_id", orgId).gte("created_at", since).limit(10000),
    sb.from("policies").select("id, policy_number, status, created_at, issued_at, category_id").eq("insurer_org_id", orgId).gte("created_at", since).limit(10000),
    sb.from("claims").select("id, reference, status, reported_at, delivered_to_insurer_at, decision_at, paid_at, created_at").eq("insurer_org_id", orgId).gte("created_at", since).limit(10000),
  ]);
  const s = subs.data ?? [];
  const q = quotes.data ?? [];
  const p = policies.data ?? [];
  const c = claims.data ?? [];
  const responded = s.filter((x) => x.responded_at);
  const respHours = responded.map((x) => (Date.parse(x.responded_at!) - Date.parse(x.sent_at ?? x.created_at)) / H);
  const onTime = responded.filter((x) => x.response_due_at && Date.parse(x.responded_at!) <= Date.parse(x.response_due_at)).length;
  const ready = q.filter((x) => ["ready_to_accept", "accepted", "expired"].includes(x.status)).length;
  const accepted = q.filter((x) => x.status === "accepted").length;
  const issuance = p.filter((x) => x.issued_at).map((x) => (Date.parse(x.issued_at!) - Date.parse(x.created_at)) / H);
  const decided = c.filter((x) => x.decision_at);
  const decisionDays = decided.map((x) => (Date.parse(x.decision_at!) - Date.parse(x.delivered_to_insurer_at ?? x.reported_at ?? x.created_at)) / H);
  const approved = c.filter((x) => ["approved", "partially_approved", "paid"].includes(x.status)).length;

  const metrics: Metric[] = [
    { key: "submissions", label: "Submissions received", value: String(s.length), detail: `${s.filter((x) => x.status === "declined").length} declined` },
    { key: "response_rate", label: "Response rate", value: fmtPct(pct(responded.length, s.length)), ratio: pct(responded.length, s.length), detail: `${fmtPct(pct(onTime, responded.length))} within the response target` },
    { key: "median_response", label: "Median response time", value: fmtHours(median(respHours)) },
    { key: "bind_rate", label: "Binding quote → accepted", value: fmtPct(pct(accepted, ready)), ratio: pct(accepted, ready), detail: `${accepted} of ${ready} binding quotes accepted` },
    { key: "issuance_time", label: "Median issuance time", value: fmtHours(median(issuance)), detail: `${p.filter((x) => x.status === "pending_issuance").length} awaiting issuance` },
    { key: "claims_decision", label: "Median claim decision time", value: fmtHours(median(decisionDays)), detail: `${decided.length} decisions · ${fmtPct(pct(approved, decided.length))} approved in full or part` },
  ];
  return {
    metrics,
    weekly: weeks(s.map((x) => x.created_at)),
    breakdowns: [
      { title: "Submissions by broker", items: countBy(s, (x) => names.orgs?.get(x.broker_org_id) ?? "Broker") },
      { title: "Submissions by status", items: countBy(s, (x) => x.status) },
      { title: "Claims by status", items: countBy(c, (x) => x.status.replace(/_/g, " ")) },
    ],
    datasets: {
      metrics: { header: ["metric", "value", "detail"], rows: metrics.map((m) => [m.label, m.value, m.detail ?? ""]) },
      submissions: {
        header: ["submission_id", "request_id", "broker", "status", "channel", "sent_at", "responded_at", "response_due_at"],
        rows: s.map((x) => [x.id, x.request_id, names.orgs?.get(x.broker_org_id) ?? x.broker_org_id, x.status, x.channel, x.sent_at, x.responded_at, x.response_due_at]),
      },
      policies: {
        header: ["policy_id", "policy_number", "status", "category", "created_at", "issued_at"],
        rows: p.map((x) => [x.id, x.policy_number, x.status, names.categories.get(x.category_id) ?? "", x.created_at, x.issued_at]),
      },
      claims: {
        header: ["reference", "status", "reported_at", "delivered_to_insurer_at", "decision_at", "paid_at"],
        rows: c.map((x) => [x.reference, x.status, x.reported_at, x.delivered_to_insurer_at, x.decision_at, x.paid_at]),
      },
    },
  };
}

export function toCsv(d: { header: string[]; rows: (string | number | null)[][] }) {
  const esc = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    // Neutralise spreadsheet formula injection and quote as needed.
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [d.header.join(","), ...d.rows.map((r) => r.map(esc).join(","))].join("\n");
}
