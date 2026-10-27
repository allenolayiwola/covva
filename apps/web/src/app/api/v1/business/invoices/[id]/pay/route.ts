import { PayBusinessInvoiceInput } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { payInvoice } from "@/server/business";

type Route = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/business/invoices/{id}/pay — starts one payment per insurer line (owner/admin/finance). Each payment
 * settles to that insurer; complete each `authorizationUrl` (card / hosted MoMo) or approve the MoMo prompt.
 */
export const POST = withApi<"user", Route>(
  async ({ auth, req }, { params }) => {
    const id = uuidParam((await params).id);
    const input = await parseJson(req, PayBusinessInvoiceInput);
    return payInvoice({ supabase: auth.supabase, userId: auth.userId, source: "mobile" }, id, { channel: input.channel, momo: input.momo ?? null, insurerOrgId: input.insurerOrgId ?? null, callbackUrl: input.callbackUrl });
  },
  { auth: "user" },
);
