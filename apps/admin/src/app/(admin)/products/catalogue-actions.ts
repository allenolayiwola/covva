"use server";
import { z } from "zod";
import { validateTemplate } from "@im/core";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";
import { revalidateEverywhere, webCacheNote } from "@/lib/revalidate";

/**
 * Catalogue extensions for the admin console (Addendum 3 B3 approval workflow,
 * Addendum 2 B rate tables): compliance review of submitted product versions,
 * rate table review and document template approval.
 */
const uuid = z.string().uuid();

async function notifyUser(userId: string | null | undefined, msg: { kind: string; title: string; body: string; link: string; data?: Record<string, unknown> }) {
  if (!userId) return false;
  try {
    const svc = createServiceClient();
    await svc.from("notifications").insert({ user_id: userId, ...msg, data: (msg.data ?? {}) as never });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Compliance review of product versions
// ---------------------------------------------------------------------------
export async function startComplianceReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("productApproval");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ versionId: uuid }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("product_versions").update({ compliance_status: "in_review", reviewed_by: auth.staff.userId, reviewed_at: new Date().toISOString() }).eq("id", parsed.data.versionId).eq("compliance_status", "submitted");
  if (error) return fail(dbMessage(error));
  return done("Marked as in review.");
}

const Publish = z.object({ versionId: uuid, reason: z.string().trim().max(2000).optional(), insurerConfirmed: z.string().optional() });

/**
 * Publish: version → approved + compliance published. If the version carries a
 * scheduled_effective_from in the future it is NOT made current now; the hourly
 * price-schedule cron promotes it (private.activate_scheduled_versions). Otherwise
 * it becomes current immediately, like approveVersion.
 */
export async function publishVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("productApproval");
  if (!auth.ok) return fail(auth.error);
  const parsed = Publish.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase, staff } = auth;
  const { data: v } = await supabase.from("product_versions").select("id, product_id, status, version, insurer_approved_at, scheduled_effective_from, rating, submitted_by").eq("id", parsed.data.versionId).single();
  if (!v) return fail("Version not found.");
  if (v.status !== "pending_approval") return fail(`Only submitted versions can be published (this one is ${v.status}).`);
  if (!v.insurer_approved_at && parsed.data.insurerConfirmed !== "on") return fail("The insurer has not recorded sign-off. Confirm you hold the insurer's written approval of the wording and rates.");
  const rating = (v.rating ?? {}) as { model?: string; rate_table_id?: string };
  if (rating.model === "rate_table") {
    if (!rating.rate_table_id) return fail("This version prices from a rate table but none is linked.");
    const { data: t } = await supabase.from("rate_tables").select("status, name").eq("id", rating.rate_table_id).maybeSingle();
    if (!t) return fail("The linked rate table could not be found.");
    if (t.status !== "approved") return fail(`Approve the rate table "${t.name}" (currently ${t.status.replace("_", " ")}) before publishing this version.`);
  }
  const { data: product } = await supabase.from("products").select("id, current_version_id, status, name").eq("id", v.product_id).single();
  if (!product) return fail("Product not found.");

  const now = new Date().toISOString();
  const scheduled = !!v.scheduled_effective_from && new Date(v.scheduled_effective_from).getTime() > Date.now();
  const { error } = await supabase
    .from("product_versions")
    .update({ status: "approved", approved_by: staff.userId, approved_at: now, compliance_status: "published", compliance_notes: parsed.data.reason || null, reviewed_by: staff.userId, reviewed_at: now })
    .eq("id", v.id);
  if (error) return fail(dbMessage(error));

  if (!scheduled) {
    if (product.current_version_id && product.current_version_id !== v.id) {
      await supabase.from("product_versions").update({ effective_to: now.slice(0, 10) }).eq("id", product.current_version_id);
      await supabase.from("product_versions").update({ supersedes_version_id: product.current_version_id }).eq("id", v.id).is("supersedes_version_id", null);
    }
    const { error: pErr } = await supabase.from("products").update({ current_version_id: v.id, status: product.status === "retired" ? "retired" : "approved" }).eq("id", product.id);
    if (pErr) return fail(`Version published but the product could not be updated: ${dbMessage(pErr)}`);
  }
  await notifyUser(v.submitted_by, { kind: "product_version_published", title: `${product.name} v${v.version} published`, body: scheduled ? `Goes live ${new Date(v.scheduled_effective_from!).toLocaleString("en-GB")}.` : "Now current for new quotes.", link: `/partner/products/${v.product_id}/versions/${v.id}`, data: { version_id: v.id } });
  const web = await revalidateEverywhere(["catalog"]);
  return done(scheduled ? `${product.name} v${v.version} published; it goes live at ${new Date(v.scheduled_effective_from!).toLocaleString("en-GB")} (hourly cron). ${webCacheNote(web)}` : `${product.name} v${v.version} published and now current. ${webCacheNote(web)}`);
}

const Return = z.object({ versionId: uuid, reason: z.string().trim().min(5, "Explain what needs to change (at least 5 characters)").max(2000) });

/** Return with comments: version → draft, compliance_status returned, notes stored on the version and sent to the submitter. */
export async function returnVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("productApproval");
  if (!auth.ok) return fail(auth.error);
  const parsed = Return.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase, staff } = auth;
  const { data: v } = await supabase.from("product_versions").select("id, product_id, status, version, submitted_by").eq("id", parsed.data.versionId).single();
  if (!v) return fail("Version not found.");
  if (v.status !== "pending_approval") return fail("Only submitted versions can be returned.");
  const now = new Date().toISOString();
  const { error } = await supabase.from("product_versions").update({ status: "draft", compliance_status: "returned", compliance_notes: parsed.data.reason, review_note: parsed.data.reason, reviewed_by: staff.userId, reviewed_at: now }).eq("id", v.id);
  if (error) return fail(dbMessage(error));
  const { data: product } = await supabase.from("products").select("name, status, data_owner_id").eq("id", v.product_id).single();
  if (product?.status === "pending_approval") await supabase.from("products").update({ status: "draft" }).eq("id", v.product_id);
  const notified = await notifyUser(v.submitted_by ?? product?.data_owner_id, { kind: "product_version_returned", title: `${product?.name ?? "Product"} v${v.version} returned by compliance`, body: parsed.data.reason, link: `/partner/products/${v.product_id}/versions/${v.id}`, data: { version_id: v.id } });
  return done(`Version returned with your comments.${notified ? " The submitter has been notified." : ""}`);
}

// ---------------------------------------------------------------------------
// Rate tables
// ---------------------------------------------------------------------------
const ReviewTable = z.object({ tableId: uuid, decision: z.enum(["approved", "rejected"]), reason: z.string().trim().max(2000).optional() });

export async function reviewRateTable(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("productApproval");
  if (!auth.ok) return fail(auth.error);
  const parsed = ReviewTable.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase, staff } = auth;
  const { data: t } = await supabase.from("rate_tables").select("id, name, status, product_version_id, proposed_insurer_name, submitted_by").eq("id", parsed.data.tableId).single();
  if (!t) return fail("Rate table not found.");
  if (t.status === "approved" && parsed.data.decision === "approved") return fail("Already approved.");
  if (parsed.data.decision === "approved" && !t.product_version_id) {
    return fail("A broker proposal has no product yet. Once the insurer joins Covva, attach the table to their product version (set product_version_id) before approving it.");
  }
  if (parsed.data.decision === "rejected" && !(parsed.data.reason && parsed.data.reason.length >= 5)) return fail("Give a reason for rejecting (at least 5 characters).");
  const { count } = await supabase.from("rate_rows").select("id", { count: "exact", head: true }).eq("rate_table_id", t.id);
  if (parsed.data.decision === "approved" && !count) return fail("The table has no rows.");
  const { error } = await supabase.from("rate_tables").update({ status: parsed.data.decision, reviewed_by: staff.userId, reviewed_at: new Date().toISOString(), review_notes: parsed.data.reason || null }).eq("id", t.id);
  if (error) return fail(dbMessage(error));
  await notifyUser(t.submitted_by, { kind: `rate_table_${parsed.data.decision}`, title: `Rate table "${t.name}" ${parsed.data.decision}`, body: parsed.data.reason || (parsed.data.decision === "approved" ? "Approved for use in pricing." : "Rejected."), link: t.product_version_id ? `/partner/products` : `/partner/products/propose`, data: { rate_table_id: t.id } });
  return done(`Rate table ${parsed.data.decision}.`);
}

// ---------------------------------------------------------------------------
// Document templates
// ---------------------------------------------------------------------------
export async function approveTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("productApproval");
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ templateId: uuid, reason: z.string().trim().max(2000).optional() }).safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase, staff } = auth;
  const { data: t } = await supabase.from("document_templates").select("id, name, kind, status, template, product_version_id").eq("id", parsed.data.templateId).single();
  if (!t) return fail("Template not found.");
  if (t.status === "approved") return fail("Already approved.");
  const check = validateTemplate(t.template);
  if (!check.ok) return fail(`The template is not valid: ${check.errors.slice(0, 3).join(" ")}`);
  const { error } = await supabase.from("document_templates").update({ status: "approved", approved_by: staff.userId, approved_at: new Date().toISOString() }).eq("id", t.id);
  if (error) return fail(dbMessage(error));
  return done(`${t.kind} template "${t.name}" approved.`);
}
