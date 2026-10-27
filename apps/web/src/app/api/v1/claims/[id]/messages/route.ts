import { ClaimMessageInput, ClaimMessagesQuery, canMessage } from "@im/core";
import { must, parseJson, parseQuery, uuidParam, withApi } from "@/server/api-auth";
import { addClaimMessage, listClaimMessages, partyFor } from "@/server/claims";

/** GET /api/v1/claims/{id}/messages — the claim thread, oldest first. Internal notes are only returned to partner/staff users (RLS). */
export const GET = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/claims/[id]">) => {
    const id = uuidParam((await route.params).id);
    const q = parseQuery(req, ClaimMessagesQuery);
    const claim = must(await auth.supabase.from("claims").select("id, reference, status, customer_id, broker_org_id, insurer_org_id, policy_id").eq("id", id).maybeSingle(), "Claim not found.");
    const party = await partyFor(auth.supabase, claim, auth.userId);
    const items = await listClaimMessages(auth.supabase, id, q);
    return { items, canMessage: canMessage(party === "sponsor" ? "sponsor" : party, claim), party };
  },
  { auth: "user" },
);

/** POST /api/v1/claims/{id}/messages — send a message (attachments reference uploaded documents). */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/claims/[id]">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, ClaimMessageInput);
    const message = await addClaimMessage(auth.supabase, {
      claimId: id,
      userId: auth.userId,
      body: input.body,
      internal: input.internal,
      attachments: input.attachments.map((a) => ({ document_id: a.documentId, storage_path: a.storagePath, name: a.name })),
    });
    return Response.json({ ok: true, data: { message } }, { status: 201 });
  },
  { auth: "user" },
);
