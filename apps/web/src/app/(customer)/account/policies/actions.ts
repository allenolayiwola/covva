"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Enum } from "@im/db";
import { BusinessRuleError, createRequest } from "@/server/requests";
import { isOwnUpload, parseUploads, type ActionState, type UploadedFile } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext, dbError } from "../_lib/action";

const uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Rename (the only policy field customers may change — DB trigger enforces)
// ---------------------------------------------------------------------------
export async function renamePolicy(policyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success) return { ok: false, error: "Unknown policy." };
  const nickname = String(formData.get("nickname") ?? "").trim().slice(0, 60);
  const { data, error } = await supabase
    .from("policies")
    .update({ nickname: nickname || null })
    .eq("id", policyId)
    .eq("customer_id", user.id)
    .select("id");
  if (error) return { ok: false, error: dbError(error, "We couldn't rename this policy.") };
  if (!data?.length) return { ok: false, error: "We couldn't find that policy." };
  revalidatePath("/account", "layout");
  return { ok: true, message: nickname ? `Renamed to “${nickname}”.` : "Name cleared." };
}

// ---------------------------------------------------------------------------
// Documents on a policy (customer uploads; insurer-issued documents arrive separately)
// ---------------------------------------------------------------------------
export async function attachPolicyDocument(policyId: string, file: UploadedFile): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success || !isOwnUpload(file, user.id)) return { ok: false, error: "That upload isn't valid." };
  const { data: policy } = await supabase.from("policies").select("id, external_source").eq("id", policyId).eq("customer_id", user.id).maybeSingle();
  if (!policy) return { ok: false, error: "We couldn't find that policy." };
  const { error } = await supabase.from("documents").insert({
    owner_id: user.id,
    uploaded_by: user.id,
    uploaded_by_party: "customer",
    policy_id: policy.id,
    kind: policy.external_source ? "policy_schedule" : "other",
    storage_path: file.path,
    file_name: file.name.slice(0, 255),
    mime_type: file.mime || null,
    size_bytes: file.size || null,
  });
  if (error) return { ok: false, error: dbError(error, "We couldn't save that document.") };
  revalidatePath(`/account/policies/${policy.id}`);
  return { ok: true, message: `${file.name} added to your wallet.` };
}

// ---------------------------------------------------------------------------
// Add a policy bought elsewhere (external_source = true; trigger allows only this insert)
// ---------------------------------------------------------------------------
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const External = z
  .object({
    category_id: uuid.or(z.literal("")).refine((v) => v !== "", "Choose the type of cover"),
    insurer_org_id: uuid.or(z.literal("other")).or(z.literal("")).refine((v) => v !== "", "Choose the insurer"),
    external_insurer_name: z.string().trim().max(120).optional(),
    policy_number: z.string().trim().min(3, "Enter the policy number").max(60),
    nickname: z.string().trim().max(60).optional(),
    cover_start: date,
    cover_end: date,
    premium: z.union([z.literal(""), z.coerce.number().nonnegative("Premium can't be negative")]).optional(),
    sum_insured: z.union([z.literal(""), z.coerce.number().nonnegative()]).optional(),
  })
  .refine((v) => v.cover_end > v.cover_start, { message: "The end date must be after the start date", path: ["cover_end"] })
  .refine((v) => v.insurer_org_id !== "other" || (v.external_insurer_name?.length ?? 0) >= 2, { message: "Enter the insurer's name as printed on your policy", path: ["external_insurer_name"] });

export async function addExternalPolicy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const parsed = External.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: fe };
  }
  const v = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  const status: Enum<"policy_status"> = v.cover_end < today ? "expired" : "active";
  const { data: policy, error } = await supabase
    .from("policies")
    .insert({
      customer_id: user.id,
      // Insurer not on the platform: keep the typed name; no organisations row is created.
      insurer_org_id: v.insurer_org_id === "other" ? null : v.insurer_org_id,
      external_insurer_name: v.insurer_org_id === "other" ? v.external_insurer_name! : null,
      category_id: v.category_id,
      policy_number: v.policy_number,
      nickname: v.nickname || null,
      summary: "Added by you · bought elsewhere",
      cover_start: v.cover_start,
      cover_end: v.cover_end,
      premium: typeof v.premium === "number" ? v.premium : null,
      sum_insured: typeof v.sum_insured === "number" ? v.sum_insured : null,
      external_source: true,
      status,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A policy with that number from this insurer is already in a wallet. Contact support if it's yours." };
    return { ok: false, error: dbError(error, "We couldn't add this policy. Please try again.") };
  }
  for (const f of parseUploads(formData.get("documents"), user.id)) {
    await supabase.from("documents").insert({
      owner_id: user.id,
      uploaded_by: user.id,
      uploaded_by_party: "customer",
      policy_id: policy.id,
      kind: "policy_schedule",
      storage_path: f.path,
      file_name: f.name.slice(0, 255),
      mime_type: f.mime || null,
      size_bytes: f.size || null,
    });
  }
  revalidatePath("/account", "layout");
  redirect(`/account/policies/${policy.id}?added=1`);
}

// ---------------------------------------------------------------------------
// Renewal review → renewal request (estimate only; insurers confirm final premiums)
// ---------------------------------------------------------------------------
export async function requestRenewal(policyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success) return { ok: false, error: "Unknown policy." };
  const { data: policy } = await supabase
    .from("policies")
    .select("id, policy_number, internal_reference, request_id, insured_items, category:product_categories(slug, name)")
    .eq("id", policyId)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (!policy) return { ok: false, error: "We couldn't find that policy." };
  const category = policy.category as unknown as { slug: string; name: string } | null;
  if (!category) return { ok: false, error: "We couldn't find this policy's cover type." };

  const { data: existing } = await supabase
    .from("requests")
    .select("id")
    .eq("related_policy_id", policy.id)
    .eq("type", "renewal")
    .not("status", "in", "(cancelled,closed_no_cover,completed)")
    .limit(1);
  if (existing?.length) redirect(`/account/requests/${existing[0]!.id}`);

  const changes = formData.getAll("changes").map(String).filter((c) => c.length < 200).slice(0, 10);
  const needsNewDetails = formData.get("needs_new_details") === "1";
  const formHref = `/account/requests/new?type=renewal&policy=${policy.id}&category=${category.slug}`;

  let risk: Record<string, unknown> = (policy.insured_items ?? {}) as Record<string, unknown>;
  if (policy.request_id) {
    const { data: req } = await supabase.from("requests").select("risk_data").eq("id", policy.request_id).maybeSingle();
    if (req?.risk_data && typeof req.risk_data === "object") risk = { ...risk, ...(req.risk_data as Record<string, unknown>) };
  }
  if (needsNewDetails || !Object.keys(risk).length) redirect(formHref);

  let requestId: string;
  try {
    const res = await createRequest({ categorySlug: category.slug, type: "renewal", relatedPolicyId: policy.id, risk, source: "web" }, { supabase });
    requestId = res.request.id;
  } catch (err) {
    if (err instanceof BusinessRuleError && err.code === "invalid_input") redirect(formHref);
    if (err instanceof BusinessRuleError) return { ok: false, error: err.message };
    console.error("renewal createRequest failed", err);
    return { ok: false, error: "We couldn't send your renewal request just now. Please try again shortly." };
  }

  const lines = [
    `Please prepare renewal options for policy ${policy.policy_number ?? policy.internal_reference}.`,
    changes.length ? `What has changed:\n• ${changes.join("\n• ")}` : "Nothing has changed since last year.",
  ];
  await supabase.from("request_messages").insert({ request_id: requestId, sender_id: user.id, sender_party: "customer", body: lines.join("\n\n") });
  revalidatePath("/account", "layout");
  redirect(`/account/requests/${requestId}?new=1`);
}
