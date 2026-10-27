import { TELEMATICS_CONSENT_VERSION, TelematicsEnrolInput } from "@im/core";
import { check, parseJson, withApi } from "@/server/api-auth";
import { enrolTelematics, telematicsOverview } from "@/server/telematics";

/**
 * POST /api/v1/me/telematics/enrol — enrol one of the caller's motor policies. The telematics consent must be on
 * file (record it first with POST /me/consents, or pass `consent: { granted: true }` here and it is recorded in
 * the same call). The database refuses non-motor, external or ended policies and a second active enrolment.
 */
export const POST = withApi(
  async ({ auth, req, ip }) => {
    const input = await parseJson(req, TelematicsEnrolInput);
    if (input.consent?.granted) {
      const res = await auth.supabase.from("consents").insert({
        user_id: auth.userId,
        type: "telematics",
        granted: true,
        version: input.consent.version ?? TELEMATICS_CONSENT_VERSION,
        context: auth.via === "bearer" ? "mobile" : "web",
        ip_address: ip === "unknown" ? null : ip,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      });
      check(res);
    }
    const enrolment = await enrolTelematics(auth.supabase, { policyId: input.policyId, deviceId: input.deviceId, deviceLabel: input.deviceLabel ?? null });
    const overview = await telematicsOverview(auth.supabase, auth.userId);
    return Response.json({ ok: true, data: { enrolment, overview } }, { status: 201 });
  },
  { auth: "user" },
);
