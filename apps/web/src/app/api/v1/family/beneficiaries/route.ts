import { CreateBeneficiaryInput } from "@im/core";
import { parseJson, withApi } from "@/server/api-auth";
import { createBeneficiary, listBeneficiaries } from "@/server/diaspora";

/** GET /api/v1/family/beneficiaries — the family members the caller (sponsor) looks after. Ghana Card is masked. */
export const GET = withApi(async ({ auth }) => listBeneficiaries(auth.supabase, auth.userId), { auth: "user" });

/** POST /api/v1/family/beneficiaries — add a family member in Ghana; consent starts `pending`. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, CreateBeneficiaryInput);
    const beneficiary = await createBeneficiary(auth.supabase, auth.userId, input);
    return Response.json({ ok: true, data: { beneficiary, nextStep: "Send a consent code so they can agree to cover being arranged for them." } }, { status: 201 });
  },
  { auth: "user" },
);
