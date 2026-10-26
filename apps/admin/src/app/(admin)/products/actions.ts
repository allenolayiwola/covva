"use server";
import { z } from "zod";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";
import { revalidateEverywhere, webCacheNote } from "@/lib/revalidate";

const Approve = z.object({ versionId: z.string().uuid(), reason: z.string().trim().max(1000).optional(), insurerConfirmed: z.string().optional() });

/**
 * Approve a pending product version: version → approved (approved_by/at), the
 * previous current version is end-dated, product.current_version_id points to the
 * new version and the product becomes approved. Catalogue caches are refreshed.
 */
export async function approveVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("productApproval");
  if (!auth.ok) return fail(auth.error);
  const parsed = Approve.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase, staff } = auth;

  const { data: v } = await supabase.from("product_versions").select("id, product_id, status, version, insurer_approved_at, scheduled_effective_from").eq("id", parsed.data.versionId).single();
  if (!v) return fail("Version not found.");
  if (v.status !== "pending_approval") return fail(`Only versions pending approval can be approved (this one is ${v.status}).`);
  // Scheduled price changes are published from the compliance queue so they go live on time, not now.
  if (v.scheduled_effective_from && new Date(v.scheduled_effective_from).getTime() > Date.now()) return fail("This version is a scheduled price change — publish it from Products → Compliance so it goes live at its scheduled time.");
  if (!v.insurer_approved_at && parsed.data.insurerConfirmed !== "on") {
    return fail("The insurer has not recorded sign-off for this version. Confirm you have the insurer's written approval of the wording and rates.");
  }
  const { data: product } = await supabase.from("products").select("id, current_version_id, status, name").eq("id", v.product_id).single();
  if (!product) return fail("Product not found.");

  const now = new Date().toISOString();
  const { error } = await supabase.from("product_versions").update({ status: "approved", approved_by: staff.userId, approved_at: now, compliance_status: "published" }).eq("id", v.id);
  if (error) return fail(dbMessage(error));
  if (product.current_version_id && product.current_version_id !== v.id) {
    await supabase.from("product_versions").update({ effective_to: now.slice(0, 10) }).eq("id", product.current_version_id);
  }
  const { error: pErr } = await supabase
    .from("products")
    .update({ current_version_id: v.id, status: product.status === "retired" ? "retired" : "approved" })
    .eq("id", product.id);
  if (pErr) return fail(`Version approved but the product could not be updated: ${dbMessage(pErr)}`);
  const web = await revalidateEverywhere(["catalog"]);
  return done(`${product.name} v${v.version} approved and now current. ${webCacheNote(web)}`);
}

const Reject = z.object({ versionId: z.string().uuid(), reason: z.string().trim().min(5, "Explain what needs to change (at least 5 characters)").max(2000) });

/**
 * Reject a pending version back to draft. product_versions has no review-note
 * column, so the note is sent to the submitter as a notification (system write via
 * the service client when configured) and the status change is audited.
 */
export async function rejectVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("productApproval");
  if (!auth.ok) return fail(auth.error);
  const parsed = Reject.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase } = auth;

  const { data: v } = await supabase.from("product_versions").select("id, product_id, status, version, submitted_by").eq("id", parsed.data.versionId).single();
  if (!v) return fail("Version not found.");
  if (v.status !== "pending_approval") return fail("Only versions pending approval can be rejected.");
  const { error } = await supabase.from("product_versions").update({ status: "draft", compliance_status: "returned", compliance_notes: parsed.data.reason }).eq("id", v.id);
  if (error) return fail(dbMessage(error));
  const { data: product } = await supabase.from("products").select("name, status, data_owner_id").eq("id", v.product_id).single();
  if (product?.status === "pending_approval") await supabase.from("products").update({ status: "draft" }).eq("id", v.product_id);

  let notified = false;
  const recipient = v.submitted_by ?? product?.data_owner_id;
  if (recipient) {
    try {
      const svc = createServiceClient();
      await svc.from("notifications").insert({
        user_id: recipient,
        kind: "product_version_rejected",
        title: `${product?.name ?? "Product"} v${v.version} needs changes`,
        body: parsed.data.reason,
        link: `/partner/products/${v.product_id}`,
        data: { version_id: v.id },
      });
      notified = true;
    } catch {
      notified = false;
    }
  }
  return done(`Version returned to draft.${notified ? " The submitter has been notified with your note." : " Share your note with the insurer directly (notification not sent)."}`);
}

const ProductStatus = z.object({
  productId: z.string().uuid(),
  status: z.enum(["suspended", "retired", "approved"]),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(1000),
});

export async function setProductStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("productApproval");
  if (!auth.ok) return fail(auth.error);
  const parsed = ProductStatus.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { supabase } = auth;
  const { data: p } = await supabase.from("products").select("id, current_version_id, status").eq("id", parsed.data.productId).single();
  if (!p) return fail("Product not found.");
  if (parsed.data.status === "approved") {
    if (!p.current_version_id) return fail("This product has no approved current version — approve a version first.");
    const { data: cv } = await supabase.from("product_versions").select("status").eq("id", p.current_version_id).single();
    if (cv?.status !== "approved") return fail("The current version is not approved.");
  }
  const { error } = await supabase.from("products").update({ status: parsed.data.status }).eq("id", p.id);
  if (error) return fail(dbMessage(error));
  const web = await revalidateEverywhere(["catalog"]);
  return done(`Product ${parsed.data.status === "approved" ? "reinstated" : parsed.data.status}. ${webCacheNote(web)}`);
}
