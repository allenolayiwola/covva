import { OPEN_REQUEST_STATUSES, PartnerDashboardQuery } from "@im/core";
import { parseQuery, withApi } from "@/server/api-auth";
import { loadDashboard } from "@/server/partner-analytics";
import { canSeeMoney, resolvePartnerOrg } from "@/server/partner-mobile";

/**
 * GET /api/v1/partner/dashboard?days=30&orgId= — broker workspace home on mobile (Addendum 4 §2) and the
 * same numbers the web overview shows: sales funnel for the range, renewals due, claims, SLA, lapses,
 * the month's commission (owners/admins/finance or keys with `finance:read`) and open work counts.
 * Users (bearer): RLS + membership-checked analytics functions. Keys (scope requests:read): service client scoped to the key's org.
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const q = parseQuery(req, PartnerDashboardQuery);
    const p = await resolvePartnerOrg(auth, req, client, { orgId: q.orgId });
    const money = canSeeMoney(auth, p);
    const [dash, offers, requests, submissions] = await Promise.all([
      loadDashboard(p.db, p.orgId, { days: q.days, includeCommission: money }),
      p.orgType === "broker"
        ? p.db.from("order_offers").select("id", { count: "exact", head: true }).eq("broker_org_id", p.orgId).eq("status", "offered")
        : Promise.resolve({ count: 0 }),
      p.orgType === "broker"
        ? p.db.from("requests").select("id", { count: "exact", head: true }).eq("broker_org_id", p.orgId).in("status", OPEN_REQUEST_STATUSES)
        : Promise.resolve({ count: 0 }),
      p.orgType === "insurer"
        ? p.db.from("insurer_submissions").select("id", { count: "exact", head: true }).eq("insurer_org_id", p.orgId).in("status", ["pending", "sent", "acknowledged"])
        : Promise.resolve({ count: 0 }),
    ]);
    return {
      org: { id: p.orgId, name: p.orgName, type: p.orgType, role: p.role },
      range: { days: dash.days, from: dash.from, to: dash.to },
      kpis: {
        ...dash.totals,
        conversionRate: dash.totals.quotes ? Math.round((dash.totals.conversions / dash.totals.quotes) * 1000) / 10 : null,
        change: dash.change,
      },
      series: dash.series,
      open: { offers: offers.count ?? 0, requests: requests.count ?? 0, submissions: submissions.count ?? 0, claims: dash.claims.open },
      renewals: dash.renewals,
      claims: dash.claims,
      sla: dash.sla,
      lapses: dash.lapses,
      commission: money ? dash.commission : null,
      commissionVisible: money,
      period: dash.period,
    };
  },
  { auth: "either", scopes: ["requests:read"] },
);
