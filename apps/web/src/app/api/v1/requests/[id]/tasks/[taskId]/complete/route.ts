import { CompleteTaskInput } from "@im/core";
import type { Json } from "@im/db";
import { check, invalid, must, parseJson, rule, uuidParam, withApi } from "@/server/api-auth";
import { requestForCustomer } from "@/server/access";
import { notifyOrg } from "@/server/notify";

/** POST /api/v1/requests/{id}/tasks/{taskId}/complete — customer completes one of their tasks. */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/requests/[id]/tasks/[taskId]/complete">) => {
    const params = await route.params;
    const id = uuidParam(params.id);
    const taskId = uuidParam(params.taskId, "task");
    const input = await parseJson(req, CompleteTaskInput);
    const request = await requestForCustomer(auth, id);
    const sb = auth.supabase;
    const task = must(await sb.from("request_tasks").select("id, kind, title, status, assignee_party, document_kind").eq("id", taskId).eq("request_id", id).maybeSingle(), "Task not found.");
    if (task.assignee_party !== "customer") throw rule("This task is for your broker or the insurer.");
    if (task.status !== "open") return { task, alreadyDone: true };

    if (task.kind === "document") {
      if (!input.documentId) throw invalid("Upload the document first, then pass its documentId.");
      const doc = must(await sb.from("documents").select("id, owner_id, request_id").eq("id", input.documentId).maybeSingle(), "Document not found.");
      if (doc.owner_id !== auth.userId) throw invalid("Document not found.");
      if (!doc.request_id) await sb.from("documents").update({ request_id: id, task_id: taskId }).eq("id", doc.id);
    }

    const res = await sb
      .from("request_tasks")
      .update({ status: "done", completed_at: new Date().toISOString(), completed_by: auth.userId })
      .eq("id", taskId)
      .select("id, kind, title, status, completed_at")
      .single();
    check(res);
    await sb.from("request_events").insert({
      request_id: id,
      actor_id: auth.userId,
      actor_party: "customer",
      event: "task_completed",
      note: `${task.title} — done${input.note ? `: ${input.note}` : ""}`,
      data: { task_id: taskId, document_id: input.documentId ?? null } as Json,
    });

    // All customer tasks done while waiting on the customer → back to the adviser.
    const { count } = await sb.from("request_tasks").select("id", { count: "exact", head: true }).eq("request_id", id).eq("assignee_party", "customer").eq("status", "open");
    let requestStatus = request.status;
    if (!count && request.status === "awaiting_customer_info") {
      const upd = await sb.from("requests").update({ status: "adviser_action", next_step: "Thanks — your adviser is reviewing what you sent." }).eq("id", id).select("status").single();
      if (!upd.error) requestStatus = upd.data.status;
    }
    if (request.broker_org_id) {
      await notifyOrg(request.broker_org_id, { kind: "task.completed", title: `${request.reference}: ${task.title} done`, link: `/partner/requests/${id}`, data: { request_id: id, task_id: taskId }, channels: ["in_app"] });
    }
    return { task: res.data, openCustomerTasks: count ?? 0, requestStatus };
  },
  { auth: "user" },
);
