"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Enum, Json } from "@im/db";
import { notifyOrg } from "@/server/notify";
import { emitEvent } from "@/server/webhooks";
import { isOwnUpload, parseUploads, type ActionState, type UploadedFile } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext, dbError } from "../_lib/action";
import { requiredEvidence } from "../_lib/labels";

const uuid = z.string().uuid();

const Report = z.object({
  policyId: uuid,
  incidentType: z.string().trim().min(1, "Choose what happened").max(40),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it happened"),
  incidentTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  location: z.string().trim().max(300).optional(),
  description: z.string().trim().min(10, "Describe what happened in a few sentences").max(5000),
  amountClaimed: z.union([z.literal(""), z.coerce.number().positive("Enter an amount above zero")]).optional(),
  thirdParty: z.string().trim().max(500).optional(),
});

function kindFor(mime: string): Enum<"document_kind"> {
  return mime.startsWith("image/") ? "photo" : "claim_evidence";
}

export async function reportClaim(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = Report.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your answers.", fieldErrors: fe };
  }
  const v = parsed.data;
  const incidentAt = new Date(`${v.incidentDate}T${v.incidentTime ?? "12:00"}:00Z`);
  if (incidentAt.getTime() > Date.now() + 86_400_000) return { ok: false, error: "The date can't be in the future.", fieldErrors: { incidentDate: "The date can't be in the future" } };

  const { data: policy } = await supabase
    .from("policies")
    .select("id, insurer_org_id, broker_org_id, status, external_source, category:product_categories(slug)")
    .eq("id", v.policyId)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!policy) return { ok: false, error: "We couldn't find that policy in your wallet." };
  if (policy.external_source || !policy.insurer_org_id) return { ok: false, error: "For a policy you added yourself, contact the insurer that issued it to make a claim." };

  const slug = (policy.category as unknown as { slug: string } | null)?.slug;
  const { data: claim, error } = await supabase
    .from("claims")
    .insert({
      policy_id: policy.id,
      customer_id: user.id,
      insurer_org_id: policy.insurer_org_id,
      broker_org_id: policy.broker_org_id,
      status: "reported", // customers may only draft, report or withdraw (DB trigger)
      incident_type: v.incidentType,
      incident_at: incidentAt.toISOString(),
      location: v.location || null,
      description: v.description,
      amount_claimed: typeof v.amountClaimed === "number" ? v.amountClaimed : null,
      third_parties: (v.thirdParty ? [{ details: v.thirdParty }] : []) as Json,
      required_evidence: requiredEvidence(slug, v.incidentType) as unknown as Json,
    })
    .select("id, reference")
    .single();
  if (error) return { ok: false, error: dbError(error, "We couldn't report your claim. Please try again.") };

  for (const f of parseUploads(formData.get("evidence"), user.id)) {
    await supabase.from("documents").insert({
      owner_id: user.id,
      uploaded_by: user.id,
      uploaded_by_party: "customer",
      claim_id: claim.id,
      policy_id: policy.id,
      kind: kindFor(f.mime),
      storage_path: f.path,
      file_name: f.name.slice(0, 255),
      mime_type: f.mime || null,
      size_bytes: f.size || null,
    });
  }

  if (policy.broker_org_id) {
    await notifyOrg(policy.broker_org_id, {
      kind: "claim.reported",
      title: `Claim ${claim.reference} reported`,
      body: `${v.incidentType.replace(/_/g, " ")} · ${v.description.slice(0, 100)}`,
      link: `/partner/claims/${claim.id}`,
      data: { claim_id: claim.id },
    }).catch(() => {});
  }
  const reported = { claim_id: claim.id, reference: claim.reference, policy_id: policy.id, status: "reported", incident_type: v.incidentType };
  await emitEvent(policy.broker_org_id, "claim.reported", reported);
  await emitEvent(policy.insurer_org_id, "claim.reported", reported);
  revalidatePath("/account", "layout");
  redirect(`/account/claims/${claim.id}?reported=1`);
}

export async function attachClaimEvidence(claimId: string, kind: string | null, file: UploadedFile): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(claimId).success || !isOwnUpload(file, user.id)) return { ok: false, error: "That upload isn't valid." };
  const { data: claim } = await supabase.from("claims").select("id, reference, policy_id, broker_org_id, status").eq("id", claimId).eq("customer_id", user.id).maybeSingle();
  if (!claim) return { ok: false, error: "We couldn't find that claim." };
  if (["withdrawn", "closed", "paid", "rejected"].includes(claim.status)) return { ok: false, error: "This claim is closed. Message your broker if you have new information." };
  const docKind = (kind && /^[a-z_]{2,30}$/.test(kind) ? kind : kindFor(file.mime)) as Enum<"document_kind">;
  const { error } = await supabase.from("documents").insert({
    owner_id: user.id,
    uploaded_by: user.id,
    uploaded_by_party: "customer",
    claim_id: claim.id,
    policy_id: claim.policy_id,
    kind: docKind,
    storage_path: file.path,
    file_name: file.name.slice(0, 255),
    mime_type: file.mime || null,
    size_bytes: file.size || null,
  });
  if (error) return { ok: false, error: dbError(error, "We couldn't save that file.") };
  if (claim.broker_org_id) {
    await notifyOrg(claim.broker_org_id, { kind: "claim.evidence", title: `New evidence on ${claim.reference}`, body: file.name, link: `/partner/claims/${claim.id}` }).catch(() => {});
  }
  revalidatePath(`/account/claims/${claim.id}`);
  return { ok: true, message: `${file.name} added. It reaches the insurer once your broker confirms delivery.` };
}

export async function withdrawClaim(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const claimId = String(formData.get("claimId") ?? "");
  if (!uuid.safeParse(claimId).success) return { ok: false, error: "Unknown claim." };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const { data: claim } = await supabase.from("claims").select("id, status, broker_org_id, reference").eq("id", claimId).eq("customer_id", user.id).maybeSingle();
  if (!claim) return { ok: false, error: "We couldn't find that claim." };
  if (["approved", "partially_approved", "rejected", "paid", "closed", "withdrawn"].includes(claim.status)) {
    return { ok: false, error: "This claim can no longer be withdrawn online." };
  }
  const { error } = await supabase.from("claims").update({ status: "withdrawn" }).eq("id", claim.id);
  if (error) return { ok: false, error: dbError(error, "We couldn't withdraw this claim. Please message your broker.") };
  await emitEvent(claim.broker_org_id, "claim.status_changed", { claim_id: claim.id, reference: claim.reference, from_status: claim.status, status: "withdrawn" });
  if (reason) {
    await supabase.from("claim_events").insert({ claim_id: claim.id, actor_id: user.id, actor_party: "customer", note: `Withdrawn: ${reason}` });
  }
  if (claim.broker_org_id) {
    await notifyOrg(claim.broker_org_id, { kind: "claim.withdrawn", title: `Claim ${claim.reference} withdrawn by the customer`, body: reason || undefined, link: `/partner/claims/${claim.id}` }).catch(() => {});
  }
  revalidatePath("/account", "layout");
  return { ok: true, message: "Claim withdrawn." };
}
