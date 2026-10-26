import { PartnerCommissionQuery } from "@im/core";
import { forbidden, parseQuery, withApi } from "@/server/api-auth";
import { commissionSummary, currentPeriod } from "@/server/partner-analytics";
import { canSeeMoney, resolvePartnerOrg } from "@/server/partner-mobile";

/**
 * GET /api/v1/partner/commission?period=YYYY-MM — commission earned (brokers) or payable (insurers) for a
 * month from the ledger, what has been settled on paid statements and the outstanding balance.
 * Owners, admins and finance (users) or keys with scope finance:read.
 */
export const GET = withApi(
  async ({ auth, req, client }) => {
    const q = parseQuery(req, PartnerCommissionQuery);
    const p = await resolvePartnerOrg(auth, req, client, { orgId: q.orgId });
    if (!canSeeMoney(auth, p)) throw forbidden("Commission figures are visible to owners, admins and finance.");
    const period = q.period ?? currentPeriod();
    const row = await commissionSummary(p.db, p.orgId, period);
    if (!row) throw forbidden("Commission figures are visible to owners, admins and finance.");
    return {
      period: row.period,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      currency: row.currency,
      earned: row.earned,
      paid: row.paid,
      outstanding: row.outstanding,
      revenueShare: row.revenue_share,
      platformFee: row.platform_fee,
      entries: row.entries,
      statement: row.statement_id ? { id: row.statement_id, status: row.statement_status, netDue: row.statement_net_due } : null,
      side: p.orgType === "broker" ? "earned" : "payable",
      note: "Premiums settle to the insurer directly; Covva never holds client funds. Commission is paid by the insurer out of the premium per the settlement statement.",
    };
  },
  { auth: "either", scopes: ["finance:read"] },
);
