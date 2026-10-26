import { RegisterDeviceInput } from "@im/core";
import { createServiceClient } from "@/lib/supabase/server";
import { must, parseJson, withApi } from "@/server/api-auth";

/** POST /api/v1/devices — register (or move) an Expo push token for the signed-in user. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, RegisterDeviceInput);
    // Service client: a token may already belong to another account on a shared device; RLS
    // would block re-assigning it. The device holder presenting the token proves possession.
    const device = must(
      await createServiceClient()
        .from("device_tokens")
        .upsert(
          { user_id: auth.userId, token: input.token, platform: input.platform, provider: input.provider, app_version: input.appVersion ?? null, last_seen_at: new Date().toISOString() },
          { onConflict: "token" },
        )
        .select("id, platform, provider, app_version, last_seen_at")
        .single(),
    );
    return Response.json({ ok: true, data: device }, { status: 201 });
  },
  { auth: "user" },
);
