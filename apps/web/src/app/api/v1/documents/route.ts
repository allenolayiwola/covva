import { ConfirmUploadInput } from "@im/core";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { check, forbidden, invalid, must, parseJson, withApi } from "@/server/api-auth";
import { documentOwner } from "@/server/documents";
import { notifyOrg } from "@/server/notify";

/** POST /api/v1/documents — confirm an upload and create the `documents` row. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, ConfirmUploadInput);
    const { ownerId, party } = await documentOwner(auth, input);
    const segments = input.path.split("/");
    if (segments[0] !== ownerId || segments.length < 3 || input.path.includes("..")) throw forbidden("That upload path doesn't belong to this record.");

    // Existence check with the service client: staff can't read an object until its documents row exists.
    const { data: exists } = await createServiceClient().storage.from("documents").exists(input.path);
    if (!exists) throw invalid("We couldn't find the uploaded file. Upload it again.");

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
          storage_path: input.path,
          file_name: input.fileName,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          checksum: input.checksum ?? null,
        })
        .select("id, kind, file_name, mime_type, size_bytes, request_id, policy_id, claim_id, task_id, verified, delivered_to_insurer_at, created_at")
        .single(),
    );

    let taskCompleted = false;
    if (input.taskId && input.requestId && party === "customer") {
      const { data: task } = await auth.supabase.from("request_tasks").select("id, kind, status, assignee_party, title").eq("id", input.taskId).eq("request_id", input.requestId).maybeSingle();
      if (task && task.status === "open" && task.kind === "document" && task.assignee_party === "customer") {
        const res = await auth.supabase.from("request_tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: auth.userId }).eq("id", task.id);
        taskCompleted = !res.error;
      }
    }
    if (input.requestId) {
      check(
        await auth.supabase.from("request_events").insert({
          request_id: input.requestId,
          actor_id: auth.userId,
          actor_party: party,
          event: "document_uploaded",
          note: `${input.kind.replace(/_/g, " ")} uploaded`,
          data: { document_id: doc.id } as Json,
        }),
      );
      if (party === "customer") {
        const { data: r } = await auth.supabase.from("requests").select("reference, broker_org_id").eq("id", input.requestId).single();
        if (r?.broker_org_id) {
          await notifyOrg(r.broker_org_id, { kind: "document.uploaded", title: `${r.reference}: ${input.kind.replace(/_/g, " ")} uploaded`, link: `/partner/requests/${input.requestId}`, data: { request_id: input.requestId, document_id: doc.id }, channels: ["in_app"] });
        }
      }
    }
    return Response.json(
      { ok: true, data: { document: doc, taskCompleted, note: "Uploaded. Your broker checks documents and confirms when they have been delivered to the insurer." } },
      { status: 201 },
    );
  },
  { auth: "user" },
);
