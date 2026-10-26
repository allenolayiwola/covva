import { MarkNotificationsReadInput } from "@im/core";
import { check, parseJson, withApi } from "@/server/api-auth";

/** POST /api/v1/notifications/read — mark some (ids) or all notifications as read. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, MarkNotificationsReadInput);
    let q = auth.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", auth.userId).is("read_at", null);
    if (!input.all && input.ids) q = q.in("id", input.ids);
    const res = await q.select("id");
    check(res);
    return { marked: res.data?.length ?? 0 };
  },
  { auth: "user" },
);
