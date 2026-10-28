import { test } from "node:test";
import assert from "node:assert/strict";
import type { RemittancePartnerAdapter, RemittancePayment, RemittanceQuote } from "./remittance.ts";

/**
 * The remittance adapter is an interface only (no partner yet). This test pins the contract a partner
 * integration must satisfy: a quote in the payer's currency that settles a fixed GHS amount, an initiate
 * step that returns the partner's payment id, and a webhook parser that yields a payment outcome or null.
 */
class FakePartner implements RemittancePartnerAdapter {
  readonly slug = "fake-remit";
  async quote(input: { ghsAmount: number; payerCurrency: string; reference: string }): Promise<RemittanceQuote> {
    const rate = input.payerCurrency === "GBP" ? 0.052 : 0.066; // payer currency per GHS
    const payerAmount = Math.round(input.ghsAmount * rate * 100) / 100;
    return { partnerQuoteId: `q_${input.reference}`, payerAmount, payerCurrency: input.payerCurrency, ghsAmount: input.ghsAmount, rate, fees: [{ amount: 1.5, currency: input.payerCurrency, description: "Transfer fee" }], expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  }
  async initiate(input: { quote: RemittanceQuote; payerId: string; returnUrl: string }) {
    return { partnerPaymentId: `p_${input.quote.partnerQuoteId}`, redirectUrl: `https://partner.example/pay?return=${encodeURIComponent(input.returnUrl)}` };
  }
  async parseWebhook(rawBody: string, headers: Record<string, string | undefined>): Promise<RemittancePayment | null> {
    if (headers["x-signature"] !== "ok") return null;
    const body = JSON.parse(rawBody) as { id: string; status: string; ghs?: number };
    return { partnerPaymentId: body.id, status: body.status === "paid" ? "succeeded" : body.status === "failed" ? "failed" : "pending", settledGhsAmount: body.ghs ?? null, settledAt: body.status === "paid" ? "2026-11-01T00:00:00Z" : null, failureReason: body.status === "failed" ? "Declined" : null };
  }
}

test("a partner adapter quotes in the payer's currency and keeps the GHS settlement fixed", async () => {
  const partner = new FakePartner();
  const q = await partner.quote({ ghsAmount: 1200, payerCurrency: "GBP", reference: "ref-1" });
  assert.equal(q.ghsAmount, 1200, "the insurer still receives the GHS premium");
  assert.equal(q.payerAmount, 62.4);
  assert.equal(q.payerCurrency, "GBP");
  assert.ok(q.fees.every((f) => f.currency === "GBP"), "fees are disclosed in the payer's currency");
  assert.ok(Date.parse(q.expiresAt) > Date.now(), "quotes expire");
  const started = await partner.initiate({ quote: q, payerId: "user-1", returnUrl: "https://covva.example/account" });
  assert.equal(started.partnerPaymentId, "p_q_ref-1");
  assert.match(started.redirectUrl ?? "", /^https:\/\//);
});

test("webhooks must verify before they become a payment outcome", async () => {
  const partner = new FakePartner();
  assert.equal(await partner.parseWebhook('{"id":"p1","status":"paid"}', {}), null, "unsigned deliveries are ignored");
  const ok = await partner.parseWebhook('{"id":"p1","status":"paid","ghs":1200}', { "x-signature": "ok" });
  assert.deepEqual(ok, { partnerPaymentId: "p1", status: "succeeded", settledGhsAmount: 1200, settledAt: "2026-11-01T00:00:00Z", failureReason: null });
  const failed = await partner.parseWebhook('{"id":"p2","status":"failed"}', { "x-signature": "ok" });
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.failureReason, "Declined");
});
