import { ConfirmConsentInput } from "@im/core";
import { parseJson, uuidParam, withApi } from "@/server/api-auth";
import { confirmConsent, getBeneficiary } from "@/server/diaspora";

type Route = { params: Promise<{ id: string }> };

/** POST /api/v1/family/beneficiaries/{id}/consent/confirm — enter the code the beneficiary read out (5 attempts). */
export const POST = withApi<"user", Route>(
  async ({ auth, req }, { params }) => {
    const id = uuidParam((await params).id);
    const input = await parseJson(req, ConfirmConsentInput);
    const r = await confirmConsent(auth.supabase, id, input.kind, input.code);
    const beneficiary = await getBeneficiary(auth.supabase, auth.userId, id);
    return { ...r, kind: input.kind, beneficiary };
  },
  { auth: "user" },
);
