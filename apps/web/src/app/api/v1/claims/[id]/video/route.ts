import { ClaimVideoUploadInput, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, VIDEO_UPLOAD_MIME } from "@im/core";
import { invalid, uuidParam, withApi } from "@/server/api-auth";
import { uploadClaimVideo } from "@/server/claims";
import { decodeBase64 } from "@/server/partner-mobile";

/**
 * POST /api/v1/claims/{id}/video — a short video of the damage or scene (≤ 90 s, ≤ 50 MB; MP4, WebM or QuickTime).
 * JSON `{ fileName, mimeType, durationSeconds, content (base64) }` or multipart form-data with a `file` part and the
 * same field names. Measure `durationSeconds` on the device; the server rejects longer clips.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/claims/[id]">) => {
    const id = uuidParam((await route.params).id);
    const { input, bytes } = await readVideo(req);
    const document = await uploadClaimVideo(auth.supabase, {
      claimId: id,
      userId: auth.userId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes,
      durationSeconds: input.durationSeconds ?? null,
      caption: input.caption ?? null,
    });
    return Response.json({ ok: true, data: { document, limits: { maxSeconds: MAX_VIDEO_SECONDS, maxBytes: MAX_VIDEO_BYTES } } }, { status: 201 });
  },
  { auth: "user", rateLimit: { capacity: 20, refillPerSecond: 0.2, name: "video" } },
);

async function readVideo(req: Request): Promise<{ input: ClaimVideoUploadInput; bytes: Uint8Array }> {
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw invalid("The upload must be multipart/form-data with a `file` part.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw invalid("Attach the video as the `file` part.");
    if (file.size > MAX_VIDEO_BYTES) throw invalid(`Videos must be ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB or smaller.`);
    const fields: Record<string, unknown> = {};
    for (const key of ["fileName", "mimeType", "durationSeconds", "caption"]) {
      const v = form.get(key);
      if (typeof v === "string" && v !== "") fields[key] = v;
    }
    fields.fileName ??= file.name;
    fields.mimeType ??= file.type.split(";")[0];
    if (!(VIDEO_UPLOAD_MIME as readonly string[]).includes(String(fields.mimeType))) throw invalid("Record or choose an MP4, WebM or QuickTime video.");
    const parsed = ClaimVideoUploadInput.safeParse({ ...fields, content: "." });
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid upload.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    return { input: parsed.data, bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw invalid("The request body must be valid JSON.");
  }
  const parsed = ClaimVideoUploadInput.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid upload.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const bytes = decodeBase64(parsed.data.content);
  if (bytes.byteLength > MAX_VIDEO_BYTES) throw invalid(`Videos must be ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB or smaller.`);
  return { input: parsed.data, bytes };
}
