import { ApplyInput, formatDate } from "@im/core";
import type { Json } from "@im/db";
import { getSetting } from "@/lib/catalog";
import { check, invalid, must, parseJson, rule, withApi } from "@/server/api-auth";
import { requestForCustomer } from "@/server/access";
import { notifyOrg } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";

/**
 * POST /api/v1/applications — apply for a ready-to-accept quote. The broker disclosure must
 * have been acknowledged first (POST /requests/{id}/disclosure); the database enforces it too.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, ApplyInput);
    const sb = auth.supabase;
    const quote = must(await sb.from("quotes").select("id, request_id, status, valid_until, optional_benefits").eq("id", input.quoteId).maybeSingle(), "Quote not found.");
    const request = await requestForCustomer(auth, quote.request_id);

    // Checkout revalidation.
    if (quote.status !== "ready_to_accept") throw rule("Only a quote that is ready to accept can be applied for. Estimates must be confirmed by the insurer first.");
    if (quote.valid_until && new Date(quote.valid_until) < new Date()) throw rule(`This quote expired on ${formatDate(quote.valid_until)}. Ask your broker to revalidate it.`);
    const keys = new Set((Array.isArray(quote.optional_benefits) ? quote.optional_benefits : []).map((b) => String((b as { key?: string }).key)));
    const unknown = input.selectedBenefits.filter((b) => !keys.has(b));
    if (unknown.length) throw invalid(`Unknown optional benefit: ${unknown.join(", ")}`);

    const { data: existing } = await sb.from("applications").select("id, status, quote_id, submitted_at").eq("quote_id", quote.id).eq("customer_id", auth.userId).eq("status", "submitted").maybeSingle();
    if (existing) return { application: existing, created: false };

    if (!request.broker_org_id) throw rule("A broker of record must be assigned before you can apply.");
    const { data: disclosure } = await sb
      .from("broker_disclosures")
      .select("id")
      .eq("request_id", request.id)
      .eq("broker_org_id", request.broker_org_id)
      .order("acknowledged_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!disclosure) throw rule("Please read and acknowledge who your broker of record is before you apply.");

    const termsVersion = (await getSetting<string>("terms_version")) ?? "unversioned";
    const application = must(
      await sb
        .from("applications")
        .insert({
          request_id: request.id,
          quote_id: quote.id,
          customer_id: auth.userId,
          status: "submitted",
          declarations: input.declarations as Json,
          selected_benefits: input.selectedBenefits as Json,
          terms_accepted_at: new Date().toISOString(),
          terms_version: termsVersion,
          disclosure_id: disclosure.id,
        })
        .select("id, status, quote_id, request_id, submitted_at, terms_version")
        .single(),
    );
    check(await sb.from("request_events").insert({ request_id: request.id, actor_id: auth.userId, actor_party: "customer", event: "application_submitted", note: "Application submitted.", data: { application_id: application.id, quote_id: quote.id } as Json }));
    if (request.broker_org_id) {
      await notifyOrg(request.broker_org_id, { kind: "application.submitted", title: `Application submitted for ${request.reference}`, link: `/partner/requests/${request.id}`, data: { request_id: request.id, application_id: application.id }, channels: ["in_app", "email"] });
      await emitEvent(request.broker_org_id, "application.submitted", { request_id: request.id, reference: request.reference, application_id: application.id, quote_id: quote.id, status: "submitted" });
    }
    return Response.json({ ok: true, data: { application, created: true, next: "POST /api/v1/payments with this applicationId" } }, { status: 201 });
  },
  { auth: "user" },
);
