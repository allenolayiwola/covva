import { CLAIM_DISCLAIMER, CLAIM_STATUS } from "@im/core";
import { must, uuidParam, withApi } from "@/server/api-auth";

/** GET /api/v1/claims/{id} — claim, customer-visible timeline, documents and checklist. */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/claims/[id]">) => {
    const id = uuidParam((await route.params).id);
    const sb = auth.supabase;
    const claim = must(
      await sb
        .from("claims")
        .select("*, policy:policies!claims_policy_id_fkey(id, internal_reference, policy_number, nickname, status, category:product_categories(name, slug)), insurer:organizations!claims_insurer_org_id_fkey(id, name), broker:organizations!claims_broker_org_id_fkey(id, name)")
        .eq("id", id)
        .maybeSingle(),
      "Claim not found.",
    );
    const isCustomer = claim.customer_id === auth.userId;
    let events = sb.from("claim_events").select("id, from_status, to_status, note, actor_party, created_at").eq("claim_id", id).order("created_at");
    if (isCustomer) events = events.eq("visible_to_customer", true);
    const [ev, docs] = await Promise.all([
      events,
      sb.from("documents").select("id, kind, file_name, mime_type, size_bytes, uploaded_by_party, delivered_to_insurer_at, verified, created_at").eq("claim_id", id).order("created_at"),
    ]);
    return {
      claim: { ...claim, statusLabel: CLAIM_STATUS[claim.status].label, statusHint: CLAIM_STATUS[claim.status].customerHint ?? null },
      timeline: (ev.data ?? []).map((e) => ({ ...e, toStatusLabel: e.to_status ? CLAIM_STATUS[e.to_status].label : null })),
      documents: docs.data ?? [],
      canWithdraw: isCustomer && ["draft", "reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"].includes(claim.status),
      disclaimer: CLAIM_DISCLAIMER,
    };
  },
  { auth: "user" },
);
