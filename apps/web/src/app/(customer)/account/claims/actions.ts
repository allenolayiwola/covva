"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_VIDEO_SECONDS, validateClaimVideo } from "@im/core";
import type { Enum, Json } from "@im/db";
import { ApiError } from "@/server/api-auth";
import { addClaimMessage, createClaim, fulfilInfoRequest, notifyClaimParties, type ClaimParty } from "@/server/claims";
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
  lat: z.union([z.literal(""), z.coerce.number().min(-90).max(90)]).optional(),
  lng: z.union([z.literal(""), z.coerce.number().min(-180).max(180)]).optional(),
  description: z.string().trim().min(10, "Describe what happened in a few sentences").max(5000),
  amountClaimed: z.union([z.literal(""), z.coerce.number().positive("Enter an amount above zero")]).optional(),
  thirdParty: z.string().trim().max(500).optional(),
});

function kindFor(mime: string): Enum<"document_kind"> {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "claim_video";
  return "claim_evidence";
}

/** Video entries written by <VideoUpload> carry the measured duration. */
type UploadedVideo = UploadedFile & { durationSeconds?: number | null };
function parseVideos(raw: FormDataEntryValue | null, userId: string): UploadedVideo[] {
  return (parseUploads(raw, userId) as UploadedVideo[]).filter((v) => validateClaimVideo({ mimeType: v.mime, sizeBytes: v.size, durationSeconds: v.durationSeconds ?? null }).ok).slice(0, 3);
}

function actionError(e: unknown, fallback: string): ActionState {
  if (e instanceof ApiError) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
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

  const { data: policy } = await supabase.from("policies").select("id, category:product_categories(slug)").eq("id", v.policyId).eq("customer_id", user.id).maybeSingle();
  if (!policy) return { ok: false, error: "We couldn't find that policy in your wallet." };
  const slug = (policy.category as unknown as { slug: string } | null)?.slug;

  const evidence = [
    ...parseUploads(formData.get("evidence"), user.id).map((f) => ({ path: f.path, name: f.name, mime: f.mime, size: f.size, kind: kindFor(f.mime) })),
    ...parseVideos(formData.get("video"), user.id).map((f) => ({ path: f.path, name: f.name, mime: f.mime, size: f.size, kind: "claim_video" as const, durationSeconds: f.durationSeconds ?? null })),
  ];
  const lat = typeof v.lat === "number" ? v.lat : null;
  const lng = typeof v.lng === "number" ? v.lng : null;

  let claimId: string;
  try {
    const r = await createClaim(supabase, {
      policyId: policy.id,
      customerId: user.id,
      incidentType: v.incidentType,
      incidentAt,
      location: lat != null && lng != null ? { lat, lng, address: v.location || null } : v.location || null,
      description: v.description,
      amountClaimed: typeof v.amountClaimed === "number" ? v.amountClaimed : null,
      thirdParties: (v.thirdParty ? [{ details: v.thirdParty }] : []) as Json,
      requiredEvidence: requiredEvidence(slug, v.incidentType),
      evidence,
      source: "web",
    });
    claimId = r.claim.id;
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message, fieldErrors: e.code === "invalid_input" ? { incidentDate: e.message } : undefined };
    return { ok: false, error: dbError(null, "We couldn't report your claim. Please try again.") };
  }
  // Voice notes recorded for the description: link them so the broker and insurer can listen.
  const voiceIds = formData.getAll("voiceNoteId").map(String);
  if (voiceIds.length) {
    const { linkVoiceNotes } = await import("@/server/voice");
    await linkVoiceNotes(supabase, voiceIds, { claimId }).catch(() => 0);
  }
  revalidatePath("/account", "layout");
  redirect(`/account/claims/${claimId}?reported=1`);
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

/** A short video (≤ 90 s) already uploaded from the browser to the customer's claims folder. */
export async function attachClaimVideo(claimId: string, file: UploadedVideo): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(claimId).success || !isOwnUpload(file, user.id)) return { ok: false, error: "That upload isn't valid." };
  const check = validateClaimVideo({ mimeType: file.mime, sizeBytes: file.size, durationSeconds: file.durationSeconds ?? null });
  if (!check.ok) return { ok: false, error: check.reason };
  const { data: claim } = await supabase.from("claims").select("id, reference, status, customer_id, broker_org_id, insurer_org_id, policy_id").eq("id", claimId).eq("customer_id", user.id).maybeSingle();
  if (!claim) return { ok: false, error: "We couldn't find that claim." };
  if (["withdrawn", "closed", "paid", "rejected"].includes(claim.status)) return { ok: false, error: "This claim is closed. Message your broker if you have new information." };
  const { data: doc, error } = await supabase
    .from("documents")
    .insert({
      owner_id: user.id,
      uploaded_by: user.id,
      uploaded_by_party: "customer",
      claim_id: claim.id,
      policy_id: claim.policy_id,
      kind: "claim_video",
      storage_path: file.path,
      file_name: file.name.slice(0, 255),
      mime_type: file.mime || null,
      size_bytes: file.size || null,
      duration_seconds: file.durationSeconds != null ? Math.round(file.durationSeconds) : null,
    })
    .select("id")
    .single();
  if (error || !doc) return { ok: false, error: dbError(error, "We couldn't save the video.") };
  await notifyClaimParties(claim as ClaimParty, { kind: "claim.evidence", title: `Video added to claim ${claim.reference}`, body: file.name, data: { document_id: doc.id } }, { customer: false });
  revalidatePath(`/account/claims/${claim.id}`);
  return { ok: true, message: `Video added (up to ${MAX_VIDEO_SECONDS} seconds). It reaches the insurer once your broker confirms delivery.` };
}

const Message = z.object({ claimId: uuid, body: z.string().trim().min(1, "Write a message").max(4000) });

/** Post in the claim thread; attachments uploaded by <MultiUpload name="attachments"> become claim documents too. */
export async function sendClaimMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = Message.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Write a message.", fieldErrors: { body: parsed.error.issues[0]?.message ?? "" } };
  const { data: claim } = await supabase.from("claims").select("id, policy_id, customer_id").eq("id", parsed.data.claimId).maybeSingle();
  if (!claim) return { ok: false, error: "We couldn't find that claim." };
  const attachments: { document_id?: string; storage_path: string; name: string }[] = [];
  for (const f of parseUploads(formData.get("attachments"), user.id).slice(0, 5)) {
    if (claim.customer_id !== user.id) break; // sponsors message without linking files to the customer's folder
    const { data: doc } = await supabase
      .from("documents")
      .insert({ owner_id: user.id, uploaded_by: user.id, uploaded_by_party: "customer", claim_id: claim.id, policy_id: claim.policy_id, kind: kindFor(f.mime), storage_path: f.path, file_name: f.name.slice(0, 255), mime_type: f.mime || null, size_bytes: f.size || null })
      .select("id")
      .single();
    attachments.push({ document_id: doc?.id, storage_path: f.path, name: f.name });
  }
  try {
    await addClaimMessage(supabase, { claimId: claim.id, userId: user.id, body: parsed.data.body, attachments });
  } catch (e) {
    return actionError(e, "We couldn't send that message.");
  }
  revalidatePath(`/account/claims/${claim.id}`);
  return { ok: true, message: "Sent." };
}

/** Fulfil an information request with an uploaded file (UploadDropzone action). */
export async function fulfilInfoRequestWithFile(claimId: string, requestId: string, file: UploadedFile): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(claimId).success || !uuid.safeParse(requestId).success || !isOwnUpload(file, user.id)) return { ok: false, error: "That upload isn't valid." };
  const { data: claim } = await supabase.from("claims").select("id, policy_id").eq("id", claimId).eq("customer_id", user.id).maybeSingle();
  if (!claim) return { ok: false, error: "We couldn't find that claim." };
  const { data: doc, error } = await supabase
    .from("documents")
    .insert({ owner_id: user.id, uploaded_by: user.id, uploaded_by_party: "customer", claim_id: claim.id, policy_id: claim.policy_id, kind: kindFor(file.mime), storage_path: file.path, file_name: file.name.slice(0, 255), mime_type: file.mime || null, size_bytes: file.size || null })
    .select("id")
    .single();
  if (error || !doc) return { ok: false, error: dbError(error, "We couldn't save that file.") };
  try {
    await fulfilInfoRequest(supabase, { requestId, userId: user.id, documentId: doc.id });
  } catch (e) {
    return actionError(e, "We couldn't record your response.");
  }
  revalidatePath(`/account/claims/${claim.id}`);
  return { ok: true, message: `${file.name} sent in reply.` };
}

const Answer = z.object({ claimId: uuid, requestId: uuid, response: z.string().trim().min(1, "Write your reply").max(2000) });

/** Fulfil an information request in writing. */
export async function answerInfoRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = Answer.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Write your reply." };
  try {
    await fulfilInfoRequest(supabase, { requestId: parsed.data.requestId, userId: user.id, response: parsed.data.response });
  } catch (e) {
    return actionError(e, "We couldn't record your response.");
  }
  revalidatePath(`/account/claims/${parsed.data.claimId}`);
  return { ok: true, message: "Reply sent." };
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
