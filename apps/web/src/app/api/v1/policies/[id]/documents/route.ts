import { must, uuidParam, withApi } from "@/server/api-auth";
import { siteUrl } from "@/lib/site-url";

/**
 * GET /api/v1/policies/{id}/documents — the policy's documents with short-lived signed URLs
 * (15 minutes). Generated documents (schedule, certificate, motor sticker, receipt) are flagged
 * `generated: true` and carry their SHA-256 so the app can cache and verify downloads.
 */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/policies/[id]/documents">) => {
    const id = uuidParam((await route.params).id);
    const sb = auth.supabase;
    const policy = must(await sb.from("policies").select("id, policy_number, internal_reference, verification_code, sticker_number, status, external_source").eq("id", id).maybeSingle(), "Policy not found.");
    const { data: docs } = await sb.from("documents").select("id, kind, file_name, mime_type, size_bytes, checksum, storage_path, bucket, uploaded_by_party, created_at").eq("policy_id", id).order("created_at", { ascending: false });
    const rows = docs ?? [];
    const { data: signed } = rows.length ? await sb.storage.from("documents").createSignedUrls(rows.filter((d) => d.bucket === "documents").map((d) => d.storage_path), 900) : { data: [] as { path: string | null; signedUrl: string }[] };
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    const prefix = `policies/${policy.id}/`;
    return {
      policyId: policy.id,
      policyNumber: policy.policy_number,
      verificationCode: policy.external_source ? null : policy.verification_code,
      stickerNumber: policy.sticker_number,
      verifyUrl: policy.verification_code && !policy.external_source ? `${siteUrl()}/verify?q=${encodeURIComponent(policy.verification_code)}` : null,
      documents: rows.map((d) => ({
        id: d.id,
        kind: d.kind,
        fileName: d.file_name,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes,
        sha256: d.checksum,
        generated: d.storage_path.startsWith(prefix),
        uploadedByParty: d.uploaded_by_party,
        createdAt: d.created_at,
        url: urls.get(d.storage_path) ?? null,
        expiresInSeconds: 900,
      })),
    };
  },
  { auth: "user" },
);
