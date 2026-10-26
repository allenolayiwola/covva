import { STORAGE_BUCKETS, documentPath } from "@im/db";
import { UploadUrlInput } from "@im/core";
import { ApiError, parseJson, withApi } from "@/server/api-auth";
import { documentOwner } from "@/server/documents";

/**
 * POST /api/v1/documents/upload-url — signed upload URL in the private `documents` bucket
 * at `{customerId}/{scope}/{uuid}-{file}`. PUT the bytes to `signedUrl`, then confirm with POST /documents.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, UploadUrlInput);
    const { ownerId } = await documentOwner(auth, input);
    const path = documentPath(ownerId, input.scope, input.fileName);
    // Created as the caller so storage RLS applies (own folder, or servicing staff).
    const { data, error } = await auth.supabase.storage.from(STORAGE_BUCKETS.documents).createSignedUploadUrl(path);
    if (error || !data) throw new ApiError("forbidden", "You can't upload a document here.");
    return {
      bucket: STORAGE_BUCKETS.documents,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
      method: "PUT",
      headers: { "content-type": input.mimeType, "x-upsert": "false" },
      expiresInSeconds: 7200,
      confirm: { endpoint: "/api/v1/documents", body: { path: data.path, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, kind: input.kind, requestId: input.requestId, policyId: input.policyId, claimId: input.claimId, taskId: input.taskId } },
    };
  },
  { auth: "user" },
);
