import "server-only";
import { SHARE_TOKEN_RE, compareQuotes, riskTitle, shareText, whatsappShareLink, type ComparableQuote, type SharedQuote } from "@im/core";
import type { Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserClient } from "@/server/api-auth";
import { emailHtml, sendEmail } from "@/server/notify";
import { BusinessRuleError } from "@/server/requests";
import { siteUrl } from "@/server/env";

/**
 * Save & share a comparison (Phase 1 "fast quoting"). A share is a random token that opens a
 * read-only public page with the quote summaries — no customer identity, no request reference,
 * no risk details beyond the vehicle/cover title. Sign in resumes the saved request.
 */
export type ShareChannel = "link" | "whatsapp" | "email";

export interface ShareResult {
  id: string;
  token: string;
  url: string;
  channel: ShareChannel;
  expiresAt: string;
  text: string;
  whatsappUrl: string;
  emailSent?: boolean;
}

export const shareUrl = (token: string) => `${siteUrl()}/q/${token}`;

type SharedRequest = Pick<Row<"requests">, "id" | "customer_id" | "risk_data" | "title"> & { category: { slug: string; name: string } | null };

async function sharedQuotesFor(svc: ReturnType<typeof createServiceClient>, requestId: string) {
  const { data } = await svc
    .from("quotes")
    .select("id, status, premium, billing_period, excess, sum_insured, key_exclusion, coverage, exclusions, waiting_period_days, optional_benefits, valid_until, paid_placement, product:products(name), insurer:organizations!quotes_insurer_org_id_fkey(id, name, brand_color)")
    .eq("request_id", requestId)
    .in("status", ["estimate", "awaiting_underwriting", "ready_to_accept", "accepted"])
    .order("premium");
  return (data ?? []) as unknown as (Pick<Row<"quotes">, "id" | "status" | "premium" | "billing_period" | "excess" | "sum_insured" | "key_exclusion" | "coverage" | "exclusions" | "waiting_period_days" | "optional_benefits" | "valid_until" | "paid_placement"> & {
    product: { name: string } | null;
    insurer: { id: string; name: string; brand_color: string | null } | null;
  })[];
}

function toShared(q: Awaited<ReturnType<typeof sharedQuotesFor>>[number]): SharedQuote & { id: string; insurerId: string; brandColor: string | null; validUntil: string | null; coverage: { key: string; label: string; included: boolean }[]; waitingPeriodDays: number } {
  return {
    id: q.id,
    insurerId: q.insurer?.id ?? "",
    insurerName: q.insurer?.name ?? "Insurer",
    brandColor: q.insurer?.brand_color ?? null,
    productName: q.product?.name ?? null,
    premium: Number(q.premium),
    billingPeriod: q.billing_period,
    excess: q.excess == null ? null : Number(q.excess),
    sumInsured: q.sum_insured == null ? null : Number(q.sum_insured),
    status: q.status,
    keyExclusion: q.key_exclusion,
    validUntil: q.valid_until,
    coverage: (Array.isArray(q.coverage) ? q.coverage : []) as { key: string; label: string; included: boolean }[],
    waitingPeriodDays: q.waiting_period_days,
  };
}

/**
 * Create a share for one of the caller's requests. `supabase` is the caller's RLS client (cookie or
 * bearer) so ownership is enforced by the insert policy; the quote summary comes from the service
 * client so the share text matches what the public page will show.
 */
export async function shareQuotes(supabase: UserClient, userId: string, requestId: string, channel: ShareChannel, opts: { email?: string | null } = {}): Promise<ShareResult> {
  const { data: request } = await supabase.from("requests").select("id, customer_id, risk_data, title, category:product_categories(slug, name)").eq("id", requestId).maybeSingle();
  if (!request || request.customer_id !== userId) throw new BusinessRuleError("Request not found.", "not_found");
  const { data: share, error } = await supabase
    .from("quote_shares")
    .insert({ request_id: requestId, channel, created_by: userId })
    .select("id, token, expires_at")
    .single();
  if (error || !share) throw new BusinessRuleError("We couldn't create a share link just now. Please try again.");

  const svc = createServiceClient();
  const quotes = (await sharedQuotesFor(svc, requestId)).map(toShared);
  const req = request as unknown as SharedRequest;
  const url = shareUrl(share.token);
  const text = shareText({
    categoryName: req.category?.name,
    riskTitle: req.category?.slug ? riskTitle(req.category.slug, (req.risk_data ?? {}) as Record<string, unknown>) : req.title,
    quotes,
    url,
    insurersCompared: new Set(quotes.map((q) => q.insurerId)).size,
  });
  const result: ShareResult = { id: share.id, token: share.token, url, channel, expiresAt: share.expires_at, text, whatsappUrl: whatsappShareLink(text) };

  if (channel === "email") {
    const to = opts.email?.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new BusinessRuleError("Enter the email address to send the quotes to.", "invalid_input");
    const title = `${req.category?.name ?? "Insurance"} quotes compared on Covva`;
    const r = await sendEmail({ to, subject: title, html: emailHtml({ title, body: text.replace(`See the full comparison: ${url}`, "").trim(), link: url }), text });
    result.emailSent = r.ok === true;
  }
  return result;
}

export interface SharedComparison {
  token: string;
  categoryName: string | null;
  categorySlug: string | null;
  riskTitle: string | null;
  quotes: ReturnType<typeof toShared>[];
  insurersCompared: number;
  ranked: { id: string; labels: string[]; score: number }[];
  expiresAt: string;
  expired: boolean;
  text: string;
  url: string;
}

/**
 * Resolve a share token for the public page. Uses the service client (anonymous visitors cannot
 * read quote_shares) and exposes quote summaries only. Returns null for unknown / malformed tokens;
 * `expired` shares still render a "this link has expired" state.
 */
export async function loadSharedComparison(token: string, opts: { recordView?: boolean } = {}): Promise<SharedComparison | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const svc = createServiceClient();
  const { data: share } = await svc
    .from("quote_shares")
    .select("id, token, request_id, quote_id, expires_at, view_count, request:requests(id, title, risk_data, category:product_categories(slug, name))")
    .eq("token", token)
    .maybeSingle();
  if (!share) return null;
  const request = share.request as unknown as (Pick<Row<"requests">, "id" | "title" | "risk_data"> & { category: { slug: string; name: string } | null }) | null;
  const requestId = share.request_id ?? request?.id ?? null;
  const expired = new Date(share.expires_at) < new Date();
  if (opts.recordView && !expired) {
    await svc.from("quote_shares").update({ viewed_at: new Date().toISOString(), view_count: (share.view_count ?? 0) + 1 }).eq("id", share.id);
  }
  const all = requestId && !expired ? (await sharedQuotesFor(svc, requestId)).map(toShared) : [];
  const quotes = share.quote_id ? all.filter((q) => q.id === share.quote_id) : all;
  const comparable: ComparableQuote[] = quotes.map((q) => ({
    id: q.id,
    insurerId: q.insurerId,
    insurerName: q.insurerName,
    productName: q.productName ?? undefined,
    status: q.status as ComparableQuote["status"],
    premium: q.premium,
    excess: q.excess ?? null,
    sumInsured: q.sumInsured ?? null,
    coverage: q.coverage,
    exclusions: [],
    keyExclusion: q.keyExclusion,
    waitingPeriodDays: q.waitingPeriodDays,
    optionalBenefits: [],
    validUntil: q.validUntil,
  }));
  const cmp = compareQuotes(comparable);
  const slug = request?.category?.slug ?? null;
  const title = slug ? riskTitle(slug, (request?.risk_data ?? {}) as Record<string, unknown>) : null;
  const url = shareUrl(token);
  return {
    token,
    categoryName: request?.category?.name ?? null,
    categorySlug: slug,
    riskTitle: title,
    quotes,
    insurersCompared: cmp.insurersCompared,
    ranked: cmp.ranked.map((r) => ({ id: r.quote.id, labels: r.labels, score: r.score })),
    expiresAt: share.expires_at,
    expired,
    text: shareText({ categoryName: request?.category?.name, riskTitle: title, quotes, url, insurersCompared: cmp.insurersCompared }),
    url,
  };
}
