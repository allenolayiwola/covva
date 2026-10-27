import { DistributionReferralsQuery } from "@im/core";
import { dbError, parseQuery, withApi } from "@/server/api-auth";
import { requireDistributor } from "../_lib";

/**
 * GET /api/v1/distribution/referrals?from=YYYY-MM-DD&to=YYYY-MM-DD — attributions, conversions and
 * revenue share for the calling partner (scope `distribution:read`). Customer details are limited to a
 * first name and a masked phone (partner_referral_report).
 */
export const GET = withApi(
  async ({ auth, req }) => {
    await requireDistributor(auth);
    const q = parseQuery(req, DistributionReferralsQuery);
    const { data, error } = await auth.svc.rpc("partner_referral_report", { p_org_id: auth.orgId, p_from: q.from, p_to: q.to });
    if (error) throw dbError(error);
    const items = data ?? [];
    return {
      items,
      totals: {
        referrals: items.length,
        conversions: items.filter((r) => r.converted_at).length,
        revenueShare: Math.round(items.reduce((s, r) => s + Number(r.revenue_share ?? 0), 0) * 100) / 100,
        currency: "GHS",
      },
      note: "Revenue share is a share of Covva's platform fee on converted policies, accrued after the holding period and paid by statement. It is never a share of the premium.",
    };
  },
  { auth: "apiKey", scopes: ["distribution:read"] },
);
