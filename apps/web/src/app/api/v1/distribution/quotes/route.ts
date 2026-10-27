import { DistributionQuoteInput, EMBED_DISCLOSURE, type RiskField } from "@im/core";
import { notFound, parseJson, rule, siteUrl, withApi } from "@/server/api-auth";
import { embedFieldsFor, indicativeEstimates, partnerDefaultCode } from "@/server/referrals";
import { requireDistributor } from "../_lib";

/**
 * POST /api/v1/distribution/quotes — indicative estimates for a risk payload (scope `distribution:quote`).
 * Nothing is stored and nothing is binding; the customer continues on Covva (`continueUrl`) where a
 * licensed broker and the insurer confirm the price. Sorted by price only — paid placements never
 * influence the order.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const partner = await requireDistributor(auth);
    const input = await parseJson(req, DistributionQuoteInput);
    if (partner.allowed_categories.length && !partner.allowed_categories.includes(input.categorySlug)) throw rule("This category is not enabled for your partnership.");
    const result = await indicativeEstimates(input.categorySlug, input.risk, partner.allowed_categories);
    if (!result) throw notFound("Unknown or unavailable insurance category.");
    const { data: category } = await auth.svc.from("product_categories").select("risk_schema").eq("slug", input.categorySlug).maybeSingle();
    const fields = embedFieldsFor(input.categorySlug, ((category?.risk_schema ?? []) as unknown as RiskField[])).map((f) => ({ key: f.key, label: f.label, type: f.type, required: !!f.required, options: f.options ?? null, min: f.min ?? null, max: f.max ?? null }));
    const code = await partnerDefaultCode(auth.svc, auth.orgId);
    const continueUrl = code ? `${siteUrl()}/get-started?category=${encodeURIComponent(result.category.slug)}&ref=${code}&src=api` : null;
    return { ...result, fields, continueUrl, disclosure: EMBED_DISCLOSURE };
  },
  { auth: "apiKey", scopes: ["distribution:quote"] },
);
