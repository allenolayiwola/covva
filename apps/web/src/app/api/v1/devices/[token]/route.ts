import { check, withApi } from "@/server/api-auth";

/** DELETE /api/v1/devices/{token} — unregister a push token (call on sign-out). Token must be URL-encoded. */
export const DELETE = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/devices/[token]">) => {
    const raw = (await route.params).token;
    let token = raw;
    try {
      token = decodeURIComponent(raw);
    } catch {
      /* already decoded */
    }
    const res = await auth.supabase.from("device_tokens").delete().eq("user_id", auth.userId).in("token", [...new Set([token, raw])]).select("id");
    check(res);
    return { removed: res.data?.length ?? 0 };
  },
  { auth: "user" },
);
