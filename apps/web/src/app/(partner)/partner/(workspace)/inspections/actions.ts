"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError } from "@/server/requests";
import { completeInspection, scheduleInspection } from "@/server/property";
import { actionContext, run, type ActionState } from "../../_lib/context";

const uuid = z.string().uuid();

const Schedule = z.object({ inspectionId: uuid, scheduledFor: z.string().min(10, "Choose a date and time") });

/** Accept an assigned inspection and set the visit date. */
export async function scheduleAssignedInspection(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ["owner", "admin", "supervisor", "adviser", "underwriter", "claims_officer"] });
    const parsed = Schedule.safeParse(Object.fromEntries(fd));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
    const when = new Date(parsed.data.scheduledFor);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "Choose a valid date and time." };
    try {
      await scheduleInspection(ctx.supabase, { inspectionId: parsed.data.inspectionId, scheduledFor: when.toISOString() });
    } catch (err) {
      return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't schedule the inspection." };
    }
    revalidatePath("/partner/inspections");
    return { ok: true, message: "Visit scheduled. The customer and sponsor have been told." };
  });
}

const Complete = z.object({
  inspectionId: uuid,
  outcome: z.enum(["completed", "failed"]),
  condition: z.enum(["good", "fair", "poor", "under_construction", "not_found"]).optional(),
  stage: z.string().trim().max(120).optional(),
  summary: z.string().trim().min(10, "Write a short summary for the insurer").max(4000),
  risks: z.string().trim().max(4000).optional(),
  photos: z.string().optional(),
});

/** File the report (and the uploaded photos) — the insurer decides what it means for cover. */
export async function completeAssignedInspection(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ["owner", "admin", "supervisor", "adviser", "underwriter", "claims_officer"] });
    const parsed = Complete.safeParse(Object.fromEntries(fd));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
    const d = parsed.data;
    let photos: { storage_path: string; taken_at?: string | null; caption?: string | null }[] = [];
    try {
      const raw = d.photos ? (JSON.parse(d.photos) as unknown) : [];
      if (Array.isArray(raw)) photos = raw.filter((p): p is { path: string; name?: string } => !!p && typeof p === "object" && typeof (p as { path?: unknown }).path === "string").map((p) => ({ storage_path: p.path, caption: p.name ?? null, taken_at: new Date().toISOString() }));
    } catch {
      photos = [];
    }
    try {
      await completeInspection(ctx.supabase, {
        inspectionId: d.inspectionId,
        outcome: d.outcome,
        report: { summary: d.summary, condition: d.condition ?? null, stage: d.stage ?? null, risks: d.risks ?? null, inspector_org_id: ctx.orgId, inspector_user_id: ctx.userId, filed_at: new Date().toISOString() },
        photos,
      });
    } catch (err) {
      return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't file the report." };
    }
    revalidatePath("/partner/inspections");
    return { ok: true, message: d.outcome === "completed" ? "Report filed and shared with the insurer." : "Recorded as not inspected; the broker has been told." };
  });
}
