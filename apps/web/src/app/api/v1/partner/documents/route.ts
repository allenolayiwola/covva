import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES, PartnerDocumentUploadInput } from "@im/core";
import { STORAGE_BUCKETS, documentPath, type Json } from "@im/db";
import { ApiError, check, forbidden, invalid, must, withApi } from "@/server/api-auth";
import { documentOwner } from "@/server/documents";
import { notify } from "@/server/notify";
import { decodeBase64, resolvePartnerOrg, scopeFor } from "@/server/partner-mobile";

/**
 * POST /api/v1/partner/documents — upload a file from the phone camera in one call (policy schedules,
 * certificates, IDs, claim evidence) for a request, policy or claim the organisation services.
 * Accepts JSON `{ fileName, mimeType, kind, content (base64), requestId|policyId|claimId, deliveredToInsurer }`
 * or multipart form-data with a `file` part plus the same field names. The web/mobile two-step flow
 * (`/documents/upload-url` then `/documents`) remains available for large files.
 */
export const POST = withApi(
  async ({ auth, req, client }) => {
    const p = await resolvePartnerOrg(auth, req, client);
    const { input, bytes } = await readUpload(req);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw invalid(`Files must be ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller.`);

    const { ownerId, party } = await documentOwner(auth, input);
    if (party === "customer") throw forbidden("Use the customer upload flow for your own documents.");
    const path = documentPath(ownerId, scopeFor(input), input.fileName);
    const upload = await auth.supabase.storage.from(STORAGE_BUCKETS.documents).upload(path, bytes, { contentType: input.mimeType, upsert: false });
    if (upload.error) throw new ApiError("forbidden", "You can't upload a document here.", { storage: upload.error.message });

    const doc = must(
      await auth.supabase
        .from("documents")
        .insert({
          owner_id: ownerId,
          uploaded_by: auth.userId,
          uploaded_by_party: party,
          request_id: input.requestId ?? null,
          policy_id: input.policyId ?? null,
          claim_id: input.claimId ?? null,
          task_id: input.taskId ?? null,
          kind: input.kind,
          storage_path: path,
          file_name: input.fileName,
          mime_type: input.mimeType,
          size_bytes: bytes.byteLength,
          delivered_to_insurer_at: input.deliveredToInsurer ? new Date().toISOString() : null,
        })
        .select("id, kind, file_name, mime_type, size_bytes, request_id, policy_id, claim_id, task_id, verified, delivered_to_insurer_at, created_at")
        .single(),
    );
    if (input.requestId) {
      check(
        await auth.supabase.from("request_events").insert({
          request_id: input.requestId,
          actor_id: auth.userId,
          actor_party: party,
          event: "document_uploaded",
          note: `${input.kind.replace(/_/g, " ")} uploaded by ${p.orgName}`,
          data: { document_id: doc.id } as Json,
        }),
      );
    }
    // Policy documents added by the broker are worth telling the customer about (wallet update).
    if (input.policyId && ["policy_schedule", "certificate", "policy_wording", "endorsement"].includes(input.kind)) {
      const { data: pol } = await auth.supabase.from("policies").select("customer_id, internal_reference, policy_number").eq("id", input.policyId).maybeSingle();
      if (pol) {
        await notify({ userId: pol.customer_id, kind: "policy.documents", title: `${input.kind.replace(/_/g, " ")} added to ${pol.policy_number ?? pol.internal_reference}`, link: `/account/policies/${input.policyId}`, data: { policy_id: input.policyId, document_id: doc.id }, channels: ["in_app", "push"] });
      }
    }
    return Response.json({ ok: true, data: { document: doc } }, { status: 201 });
  },
  { auth: "user", rateLimit: { capacity: 60, refillPerSecond: 1, name: "upload" } },
);

async function readUpload(req: Request): Promise<{ input: PartnerDocumentUploadInput; bytes: Uint8Array }> {
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw invalid("The upload must be multipart/form-data with a `file` part.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw invalid("Attach the file as the `file` part.");
    const fields: Record<string, unknown> = {};
    for (const key of ["fileName", "mimeType", "kind", "requestId", "policyId", "claimId", "taskId", "deliveredToInsurer"]) {
      const v = form.get(key);
      if (typeof v === "string" && v !== "") fields[key] = key === "deliveredToInsurer" ? v === "true" || v === "1" : v;
    }
    fields.fileName ??= file.name;
    fields.mimeType ??= file.type;
    const mime = String(fields.mimeType);
    if (!(ALLOWED_UPLOAD_MIME as readonly string[]).includes(mime)) throw invalid("That file type isn't supported. Use PDF, JPEG, PNG, WebP, HEIC or Word.");
    const parsed = PartnerDocumentUploadInput.safeParse({ ...fields, content: "." });
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
  const parsed = PartnerDocumentUploadInput.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid upload.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return { input: parsed.data, bytes: decodeBase64(parsed.data.content) };
}
