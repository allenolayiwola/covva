import { UpdateBeneficiaryInput } from "@im/core";
import { notFound, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { getBeneficiary, listConsents, updateBeneficiary } from "@/server/diaspora";

type Route = { params: Promise<{ id: string }> };

/** GET /api/v1/family/beneficiaries/{id} — one family member with their consent records. */
export const GET = withApi<"user", Route>(
  async ({ auth }, { params }) => {
    const id = uuidParam((await params).id);
    const beneficiary = await getBeneficiary(auth.supabase, auth.userId, id);
    if (!beneficiary) throw notFound("Family member not found.");
    const consents = await listConsents(auth.supabase, id);
    return { beneficiary, consents: consents.map((c) => ({ kind: c.kind, granted: c.granted, grantedAt: c.granted_at, declinedAt: c.declined_at, requestedAt: c.requested_at, expiresAt: c.expires_at, locked: !!c.locked_at, channel: c.channel })) };
  },
  { auth: "user" },
);

/** PATCH /api/v1/family/beneficiaries/{id} — edit details (changing the phone resets consent). */
export const PATCH = withApi<"user", Route>(
  async ({ auth, req }, { params }) => {
    const id = uuidParam((await params).id);
    const input = await parseJson(req, UpdateBeneficiaryInput);
    return { beneficiary: await updateBeneficiary(auth.supabase, auth.userId, id, input) };
  },
  { auth: "user" },
);
