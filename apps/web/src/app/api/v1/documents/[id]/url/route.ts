import { z } from "zod";
import { ApiError, must, parseQuery, uuidParam, withApi } from "@/server/api-auth";

const Query = z.object({ download: z.enum(["true", "false"]).optional() });

/** GET /api/v1/documents/{id}/url — short-lived signed download URL (5 minutes). */
export const GET = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/documents/[id]/url">) => {
    const id = uuidParam((await route.params).id);
    const q = parseQuery(req, Query);
    const doc = must(await auth.supabase.from("documents").select("id, storage_path, file_name, mime_type, bucket").eq("id", id).maybeSingle(), "Document not found.");
    const { data, error } = await auth.supabase.storage
      .from(doc.bucket)
      .createSignedUrl(doc.storage_path, 300, q.download === "true" ? { download: doc.file_name } : undefined);
    if (error || !data) throw new ApiError("not_found", "The file could not be found.");
    return { url: data.signedUrl, expiresInSeconds: 300, fileName: doc.file_name, mimeType: doc.mime_type };
  },
  { auth: "user" },
);
