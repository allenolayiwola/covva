import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { simulatorEnabled, verifySimulatorSignature } from "@/server/env";
import { applyPaymentResult } from "@/server/payments";

/**
 * SANDBOX PAYMENT SIMULATOR — default when no provider is configured, including production.
 * Always disabled by PAYMENTS_MODE=live. No money moves; uses the same result path as webhooks.
 */
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox payment</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#F1F7F3;color:#26434C}main{max-width:420px;margin:40px auto;padding:0 16px}.card{background:#fff;border:1px solid #DCE3E1;border-radius:16px;padding:24px}
.badge{display:inline-block;background:#FFF0D6;color:#966E28;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600}h1{font-size:20px;color:#15343E;margin:12px 0}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:14px}dt{color:#486068}button{width:100%;padding:14px;border-radius:10px;border:0;font-size:16px;font-weight:600;margin-top:12px;cursor:pointer}
.ok{background:#00796E;color:#fff}.fail{background:#DCEEE4;color:#0F514D}p.small{font-size:12px;color:#486068}</style></head><body><main><div class="card">${body}</div></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}

async function load(reference: string) {
  const svc = createServiceClient();
  const { data } = await svc
    .from("payments")
    .select("id, status, amount, currency, provider, provider_reference, raw_event, request_id, payee:organizations!payments_payee_org_id_fkey(name)")
    .eq("provider_reference", reference)
    .maybeSingle();
  return data;
}

function callbackFor(raw: unknown, reference: string) {
  const cb = (raw as { initialize?: { callback_url?: string } } | null)?.initialize?.callback_url;
  if (!cb) return null;
  const u = new URL(cb);
  u.searchParams.set("reference", reference);
  u.searchParams.set("trxref", reference);
  return u.toString();
}

export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference") ?? "";
  const sig = req.nextUrl.searchParams.get("sig");
  if (!simulatorEnabled()) return page("<h1>Not available</h1><p>The payment simulator is disabled on this environment.</p>", 404);
  if (!verifySimulatorSignature(reference, sig)) return page("<h1>Invalid link</h1>", 403);
  const p = await load(reference);
  if (!p || p.provider !== "simulator") return page("<h1>Payment not found</h1>", 404);
  const payee = (p.payee as unknown as { name: string } | null)?.name ?? "the insurer";
  if (p.status !== "pending" && p.status !== "processing") {
    const back = callbackFor(p.raw_event, reference);
    return page(`<span class="badge">Sandbox simulator</span><h1>Payment ${esc(p.status)}</h1>${back ? `<p><a href="${esc(back)}">Return to the app</a></p>` : ""}`);
  }
  return page(`<span class="badge">Sandbox simulator · no real money</span>
<h1>Test payment</h1>
<dl><dt>Amount</dt><dd>${esc(p.currency)} ${Number(p.amount).toFixed(2)}</dd><dt>Pays to</dt><dd>${esc(payee)} (insurer)</dd><dt>Reference</dt><dd>${esc(reference)}</dd></dl>
<form method="post"><input type="hidden" name="reference" value="${esc(reference)}"><input type="hidden" name="sig" value="${esc(sig ?? "")}">
<button class="ok" name="outcome" value="success">Simulate successful payment</button>
<button class="fail" name="outcome" value="fail">Simulate failed payment</button></form>
<p class="small">This page exists only in test environments. A successful payment does not activate cover — the insurer issues the policy afterwards.</p>`);
}

export async function POST(req: NextRequest) {
  if (!simulatorEnabled()) return page("<h1>Not available</h1>", 404);
  const form = await req.formData();
  const reference = String(form.get("reference") ?? "");
  const sig = String(form.get("sig") ?? "");
  const outcome = String(form.get("outcome") ?? "");
  if (!verifySimulatorSignature(reference, sig)) return page("<h1>Invalid link</h1>", 403);
  const p = await load(reference);
  if (!p || p.provider !== "simulator") return page("<h1>Payment not found</h1>", 404);
  const result =
    outcome === "success"
      ? await applyPaymentResult(reference, { status: "succeeded", amountMinor: Math.round(Number(p.amount) * 100), currency: p.currency, paidAt: new Date().toISOString(), channel: "mobile_money", event: { simulator: true, outcome }, source: "simulator" })
      : await applyPaymentResult(reference, { status: "failed", failureReason: "Simulated failure", event: { simulator: true, outcome }, source: "simulator" });
  const back = callbackFor(p.raw_event, reference);
  if (back) return Response.redirect(back, 303);
  return page(`<span class="badge">Sandbox simulator</span><h1>Payment ${esc(result.status ?? "updated")}</h1>`);
}
