import { BrokerQuoteInput, ENGINE_VERSION } from "@im/core";
import type { Enum, Json } from "@im/db";
import { forbidden, invalid, must, notFound, parseJson, rule, withApi } from "@/server/api-auth";
import { notify } from "@/server/notify";

const QUOTABLE: Enum<"request_status">[] = ["submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready"];

/**
 * POST /api/v1/partner/quotes — API key (scope quotes:write). A broker posts a quote for an
 * appointed insurer, or an insurer posts its own quote for a request submitted to it.
 * Service client, with the key's organisation checked against the request below.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, BrokerQuoteInput);
    const svc = auth.svc;
    const request = must(await svc.from("requests").select("id, reference, status, customer_id, broker_org_id, category_id").eq("id", input.requestId).maybeSingle(), "Request not found.");

    let submissionId: string | null = null;
    if (auth.orgType === "broker") {
      if (request.broker_org_id !== auth.orgId) throw notFound("Request not found.");
    } else {
      if (input.insurerOrgId !== auth.orgId) throw forbidden("Insurers can only quote for themselves.");
      const { data: sub } = await svc.from("insurer_submissions").select("id").eq("request_id", request.id).eq("insurer_org_id", auth.orgId).not("status", "in", "(withdrawn,error)").maybeSingle();
      if (!sub) throw notFound("Request not found.");
      submissionId = sub.id;
    }
    if (!request.broker_org_id) throw rule("The request has no broker of record yet.");
    if (!QUOTABLE.includes(request.status)) throw rule(`Quotes can't be added while the request is ${request.status.replace(/_/g, " ")}.`);

    const { data: appt } = await svc.from("insurer_broker_appointments").select("id").eq("insurer_org_id", input.insurerOrgId).eq("broker_org_id", request.broker_org_id).eq("active", true).or(`category_id.eq.${request.category_id},category_id.is.null`).limit(1).maybeSingle();
    if (!appt) throw rule("This insurer is not appointed to the broker for this category.");

    let version: { id: string; product_id: string; coverage: Json; limits: Json; excesses: Json; exclusions: string[]; key_exclusion: string | null; waiting_period_days: number; optional_benefits: Json; conditions: string | null } | null = null;
    if (input.productVersionId) {
      const { data: v } = await svc
        .from("product_versions")
        .select("id, product_id, status, coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions, product:products!product_versions_product_id_fkey(insurer_org_id, category_id)")
        .eq("id", input.productVersionId)
        .maybeSingle();
      const product = v?.product as unknown as { insurer_org_id: string; category_id: string } | null;
      if (!v || v.status !== "approved" || product?.insurer_org_id !== input.insurerOrgId || product?.category_id !== request.category_id) {
        throw invalid("productVersionId must be an approved product of this insurer in the request's category.");
      }
      version = v;
    }
    if (input.validUntil && Number.isNaN(Date.parse(input.validUntil))) throw invalid("validUntil must be an ISO date-time.");
    if (!submissionId) {
      const { data: sub } = await svc.from("insurer_submissions").select("id").eq("request_id", request.id).eq("insurer_org_id", input.insurerOrgId).not("status", "in", "(withdrawn,error,declined)").maybeSingle();
      submissionId = sub?.id ?? null;
    }

    const quote = must(
      await svc
        .from("quotes")
        .insert({
          request_id: request.id,
          submission_id: submissionId,
          insurer_org_id: input.insurerOrgId,
          broker_org_id: request.broker_org_id,
          product_id: version?.product_id ?? null,
          product_version_id: version?.id ?? null,
          status: input.status,
          premium: input.premium,
          excess: input.excess ?? null,
          sum_insured: input.sumInsured ?? null,
          key_exclusion: input.keyExclusion ?? version?.key_exclusion ?? null,
          valid_until: input.validUntil ? new Date(input.validUntil).toISOString() : null,
          broker_note: input.brokerNote ?? null,
          coverage: version?.coverage ?? [],
          limits: version?.limits ?? {},
          excesses: version?.excesses ?? {},
          exclusions: version?.exclusions ?? [],
          waiting_period_days: version?.waiting_period_days ?? 0,
          optional_benefits: version?.optional_benefits ?? [],
          conditions: version?.conditions ?? null,
          assumptions: { source: "partner_api", api_key_org: auth.orgId, engine: ENGINE_VERSION } as Json,
          commission_disclosure: "The broker of record may receive commission from the insurer. Ask your broker for details.",
        })
        .select("id, status, premium, valid_until, is_binding, created_at")
        .single(),
    );
    if (submissionId) await svc.from("insurer_submissions").update({ status: "quoted", responded_at: new Date().toISOString() }).eq("id", submissionId);

    if (input.status === "ready_to_accept" && request.status !== "quotes_ready") {
      await svc.from("requests").update({ status: "quotes_ready", next_step: "Compare your quotes and choose an option." }).eq("id", request.id).in("status", QUOTABLE);
    }
    if (input.status === "ready_to_accept") {
      await notify({ userId: request.customer_id, kind: "quote.ready", title: `A quote is ready for ${request.reference}`, body: "An insurer has confirmed a binding quote. Compare it before it expires.", link: `/account/requests/${request.id}/quotes`, data: { request_id: request.id, quote_id: quote.id } });
    }
    return Response.json({ ok: true, data: quote }, { status: 201 });
  },
  { auth: "apiKey", scopes: ["quotes:write"] },
);
