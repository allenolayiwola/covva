import { RecordConsentsInput } from "@im/core";
import { getSetting } from "@/lib/catalog";
import { check, parseJson, withApi } from "@/server/api-auth";

/** POST /api/v1/me/consents — record consent decisions (append-only). */
export const POST = withApi(
  async ({ auth, req, ip }) => {
    const { consents } = await parseJson(req, RecordConsentsInput);
    const [terms, privacy] = await Promise.all([getSetting<string>("terms_version"), getSetting<string>("privacy_version")]);
    const rows = consents.map((c) => ({
      user_id: auth.userId,
      type: c.type,
      granted: c.granted,
      version: c.version ?? (c.type === "terms" ? terms : c.type === "privacy" ? privacy : null) ?? "unversioned",
      context: c.context ?? (auth.via === "bearer" ? "mobile" : "web"),
      ip_address: ip === "unknown" ? null : ip,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    }));
    const res = await auth.supabase.from("consents").insert(rows).select("id, type, version, granted, created_at");
    check(res);
    return { recorded: res.data ?? [] };
  },
  { auth: "user" },
);
