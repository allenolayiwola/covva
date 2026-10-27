import { must, uuidParam, withApi } from "@/server/api-auth";
import { endorsementView, syncEndorsementPayment } from "@/server/endorsements";

/** GET /api/v1/endorsements/{id} — one change request (RLS: policyholder, broker of record, insurer, staff). */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/endorsements/[id]">) => {
    const id = uuidParam((await route.params).id);
    let e = must(await auth.supabase.from("endorsements").select("*").eq("id", id).maybeSingle(), "Change request not found.");
    let paymentStatus: string | null = null;
    if (e.adjustment_payment_id) {
      paymentStatus = (await syncEndorsementPayment(e.id)).status;
      e = (await auth.supabase.from("endorsements").select("*").eq("id", id).maybeSingle()).data ?? e;
    }
    return { endorsement: { ...endorsementView(e), paymentStatus } };
  },
  { auth: "user" },
);
