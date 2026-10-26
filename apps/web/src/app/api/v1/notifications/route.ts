import { z } from "zod";
import { webPathToDeepLink } from "@im/core";
import { PageQuery, check, parseQuery, withApi } from "@/server/api-auth";

const Query = PageQuery.extend({ unread: z.enum(["true", "false"]).optional() });

/** GET /api/v1/notifications — in-app inbox with deep links for the app. */
export const GET = withApi(
  async ({ auth, req }) => {
    const q = parseQuery(req, Query);
    let query = auth.supabase.from("notifications").select("id, kind, title, body, link, data, read_at, created_at").eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(q.limit);
    if (q.unread === "true") query = query.is("read_at", null);
    if (q.before) query = query.lt("created_at", q.before);
    const [res, unread] = await Promise.all([
      query,
      auth.supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", auth.userId).is("read_at", null),
    ]);
    check(res);
    const items = (res.data ?? []).map((n) => ({ ...n, deepLink: webPathToDeepLink(n.link).url }));
    return { items, unreadCount: unread.count ?? 0, nextCursor: items.length === q.limit ? items[items.length - 1]!.created_at : null };
  },
  { auth: "user" },
);
