"use server";
import { z } from "zod";
import { normaliseRetentionConfig, retentionPlan } from "@im/core";
import type { Json } from "@im/db";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";
import type { Supabase } from "@/lib/query";
import { notifyUsers } from "@/server/notify";
import { emailHtml, emailText, sendEmail } from "@/server/email";
import { generateExportFile, removeStorageObjects } from "@/server/privacy";

/**
 * Act 843 privacy-request actions. Every write is a SECURITY DEFINER RPC called with the STAFF session, so the
 * database checks the role (private.is_privacy_officer), enforces the status transitions and writes the audit trail
 * with the staff member as actor. The service client is used only for Storage and for reading a customer's data
 * into their export.
 */
const webBase = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const Id = z.object({ requestId: z.string().uuid() });

async function loadRequest(supabase: Supabase, id: string) {
  const { data } = await supabase.from("privacy_requests").select("id, reference, type, status, user_id").eq("id", id).maybeSingle();
  return data;
}

async function tellCustomer(userId: string, title: string, body: string) {
  await notifyUsers({ userId, kind: "privacy.request.updated", title, body, link: `${webBase()}/account/privacy`, email: true }).catch(() => undefined);
}

async function act(fd: FormData, action: "verify_identity" | "approve" | "refuse" | "fulfil" | "close" | "note", schema: z.ZodType<{ requestId: string; reason?: string; method?: string }>): Promise<ActionState> {
  const auth = await authorize("privacy");
  if (!auth.ok) return fail(auth.error);
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error as z.ZodError);
  const { requestId, reason, method } = parsed.data;
  const { data, error } = await auth.supabase.rpc("privacy_request_action", { p_id: requestId, p_action: action, p_reason: reason || undefined, p_method: method || undefined });
  if (error) return fail(dbMessage(error));
  const r = (data ?? {}) as { reference?: string; user_id?: string; status?: string };
  if (r.user_id) {
    if (action === "verify_identity") await tellCustomer(r.user_id, `We've confirmed it's you (${r.reference})`, "We're now working on your privacy request. We'll let you know when it's done.");
    if (action === "refuse") await tellCustomer(r.user_id, `Update on your privacy request ${r.reference}`, `We couldn't carry out your request: ${reason}`);
    if (action === "fulfil") await tellCustomer(r.user_id, `Your privacy request ${r.reference} is complete`, reason ?? "We've done what you asked.");
  }
  const labels = { verify_identity: "Identity verified.", approve: "Request approved.", refuse: "Request refused; the customer has been told the reason.", fulfil: "Marked as completed; the customer has been told.", close: "Request closed.", note: "Note added." };
  return done(labels[action]);
}

const Verify = Id.extend({
  method: z.enum(["signed_in_session", "ghana_card", "video_call", "in_person", "other"], { error: "Choose how identity was verified" }),
  reason: z.string().trim().max(2000).optional(),
});
export async function verifyIdentity(_: ActionState, fd: FormData) {
  return act(fd, "verify_identity", Verify);
}

const OptionalNote = Id.extend({ reason: z.string().trim().max(2000).optional() });
export async function approveRequest(_: ActionState, fd: FormData) {
  return act(fd, "approve", OptionalNote);
}
export async function closeRequest(_: ActionState, fd: FormData) {
  return act(fd, "close", OptionalNote);
}

const Required = Id.extend({ reason: z.string().trim().min(5, "At least 5 characters").max(2000) });
export async function refuseRequest(_: ActionState, fd: FormData) {
  return act(fd, "refuse", Required);
}
export async function fulfilRequest(_: ActionState, fd: FormData) {
  return act(fd, "fulfil", Required);
}
export async function addNote(_: ActionState, fd: FormData) {
  return act(fd, "note", Required);
}

/** Access requests: collect → redact → upload (private bucket) → record as staff → notify the customer. */
export async function generateExport(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("privacy");
  if (!auth.ok) return fail(auth.error);
  const parsed = Id.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const req = await loadRequest(auth.supabase, parsed.data.requestId);
  if (!req) return fail("Privacy request not found.");
  if (req.type !== "access") return fail("Exports are generated for access requests only.");
  if (!["identity_verified", "approved", "export_ready"].includes(req.status)) return fail("Verify the person's identity before generating their export.");

  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    return fail("SUPABASE_SECRET_KEY is not configured, so the export cannot be read or stored.");
  }
  let file: Awaited<ReturnType<typeof generateExportFile>>;
  try {
    file = await generateExportFile(svc, req);
  } catch (err) {
    return fail(`Could not build or store the export: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  const { data, error } = await auth.supabase.rpc("record_privacy_export", { p_id: req.id, p_path: file.path, p_bytes: file.bytes, p_sha256: file.sha256 });
  if (error) {
    await removeStorageObjects(svc, [file.path]); // don't leave an orphaned copy of personal data behind
    return fail(dbMessage(error));
  }
  const previous = (data as { previous_path?: string | null } | null)?.previous_path;
  if (previous) await removeStorageObjects(svc, [previous]);
  await tellCustomer(req.user_id, "Your data is ready to download", `Your copy of the data we hold (${req.reference}) is ready. Sign in to download it — the link works for 7 days.`);
  const total = Object.values(file.counts).reduce((a, b) => a + b, 0);
  return done(`Export generated: ${total} records, ${(file.bytes / 1024).toFixed(1)} KB. The customer has been notified.`);
}

const Deletion = Id.extend({ reason: z.string().trim().max(2000).optional(), dryRun: z.enum(["1", "0"]).optional() });

/** Deletion: preview (dry run) or anonymise, then remove Storage objects and soft-delete the sign-in. */
export async function fulfilDeletion(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("privacy");
  if (!auth.ok) return fail(auth.error);
  const parsed = Deletion.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { requestId, reason, dryRun } = parsed.data;

  if (dryRun === "1") {
    const { data, error } = await auth.supabase.rpc("fulfil_privacy_deletion", { p_id: requestId, p_dry_run: true });
    if (error) return fail(dbMessage(error));
    return { ok: true, message: "Preview only — nothing has changed.", data };
  }

  const req = await loadRequest(auth.supabase, requestId);
  if (!req) return fail("Privacy request not found.");
  let svc: ReturnType<typeof createServiceClient> | null = null;
  try {
    svc = createServiceClient();
  } catch {
    svc = null;
  }
  // Capture the address for the confirmation email before it is erased.
  const contact = svc ? (await svc.from("profiles").select("email, full_name, preferred_name").eq("id", req.user_id).maybeSingle()).data : null;

  const { data, error } = await auth.supabase.rpc("fulfil_privacy_deletion", { p_id: requestId, p_dry_run: false, p_note: reason || undefined });
  if (error) return fail(dbMessage(error));
  const summary = (data ?? {}) as { storage_paths?: string[]; retention_note?: string };

  const notes: string[] = [];
  if (svc) {
    const files = await removeStorageObjects(svc, summary.storage_paths ?? []);
    if (files.failed) notes.push(`${files.failed} stored file(s) could not be removed — remove them from Storage by hand.`);
    // Soft delete keeps the auth.users row (so every foreign key and retained record stays valid) while GoTrue
    // obfuscates the email / phone, clears metadata and blocks sign-in.
    const { error: authError } = await svc.auth.admin.deleteUser(req.user_id, true);
    if (authError) notes.push(`Sign-in could not be closed (${authError.message}) — disable the account in Supabase Auth.`);
    if (contact?.email) {
      const content = {
        title: "Your Covva account has been deleted",
        body: summary.retention_note ?? "We've erased the personal data we don't need to keep.",
        name: contact.preferred_name || contact.full_name,
      };
      await sendEmail({ to: contact.email, subject: content.title, html: emailHtml(content), text: emailText(content) }).catch(() => undefined);
    }
  } else {
    notes.push("SUPABASE_SECRET_KEY missing: stored files were not removed and the sign-in was not closed — do both by hand.");
  }
  await auth.supabase.rpc("privacy_request_action", {
    p_id: requestId,
    p_action: "note",
    p_reason: `Post-deletion: ${notes.length ? notes.join(" ") : "stored files removed, sign-in closed, confirmation emailed."}`,
  });
  return done(`Deletion fulfilled for ${req.reference}.${notes.length ? ` ${notes.join(" ")}` : ""}`);
}

/** Preview the retention job with the current settings (always a dry run from the console). */
export async function previewRetention(): Promise<ActionState> {
  const auth = await authorize("privacy");
  if (!auth.ok) return fail(auth.error);
  const { data: setting } = await auth.supabase.from("platform_settings").select("value").eq("key", "privacy_retention").maybeSingle();
  const config = normaliseRetentionConfig(setting?.value);
  const plan = retentionPlan(config);
  const { data, error } = await auth.supabase.rpc("run_privacy_retention", {
    p_plan: plan.map((p) => ({ class: p.class, cutoff: p.cutoff })) as unknown as Json,
    p_dry_run: true,
    p_triggered_by: "staff",
  });
  if (error) return fail(dbMessage(error));
  const results = ((data as { results?: Record<string, { count?: number }> } | null)?.results ?? {}) as Record<string, { count?: number }>;
  const due = Object.entries(results).map(([k, r]) => `${k.replace(/_/g, " ")} ${r.count ?? "error"}`).join(", ");
  return done(`Dry run logged — due now: ${due || "nothing"}${config.warnings.length ? ` (${config.warnings.join("; ")})` : ""}. Mode: ${config.mode === "enforce" ? "enforce" : "dry run only"}.`);
}
