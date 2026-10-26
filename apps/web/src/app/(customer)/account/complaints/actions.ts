"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { FileComplaintInput } from "@im/core";
import { getSetting } from "@/lib/catalog";
import { notifyOrg } from "@/server/notify";
import type { ActionState } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext, dbError } from "../_lib/action";

export async function fileComplaint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  const raw = Object.fromEntries(formData) as Record<string, string>;
  for (const k of ["requestId", "policyId", "claimId", "desiredOutcome"]) if (!raw[k]) delete raw[k];
  const parsed = FileComplaintInput.safeParse(raw);
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0]);
      fe[k] ??= k === "subject" ? "Give your complaint a short title" : k === "description" ? "Tell us what happened (at least a sentence)" : i.message;
    }
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: fe };
  }
  const v = parsed.data;

  // Resolve the linked records (RLS: only the customer's own) and who owns the complaint.
  const [req, pol, clm] = await Promise.all([
    v.requestId ? supabase.from("requests").select("id, broker_org_id").eq("id", v.requestId).eq("customer_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    v.policyId ? supabase.from("policies").select("id, broker_org_id, insurer_org_id").eq("id", v.policyId).eq("customer_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    v.claimId ? supabase.from("claims").select("id, broker_org_id, insurer_org_id, policy_id").eq("id", v.claimId).eq("customer_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if ((v.requestId && !req.data) || (v.policyId && !pol.data) || (v.claimId && !clm.data)) return { ok: false, error: "We couldn't find one of the linked items." };

  const ownerOrg =
    v.againstParty === "broker"
      ? req.data?.broker_org_id ?? pol.data?.broker_org_id ?? clm.data?.broker_org_id ?? null
      : v.againstParty === "insurer"
        ? clm.data?.insurer_org_id ?? pol.data?.insurer_org_id ?? null
        : null; // platform complaints are handled by platform staff
  if (v.againstParty !== "platform" && !ownerOrg) {
    return {
      ok: false,
      error: `Link the ${v.againstParty === "broker" ? "request or policy" : "policy or claim"} this is about, so we can send it to the right ${v.againstParty}.`,
      fieldErrors: { link: "Choose what this complaint is about" },
    };
  }

  const slaDays = Number((await getSetting<number>("complaint_sla_days")) ?? 14) || 14;
  const { data: complaint, error } = await supabase
    .from("complaints")
    .insert({
      customer_id: user.id,
      request_id: req.data?.id ?? null,
      policy_id: pol.data?.id ?? clm.data?.policy_id ?? null,
      claim_id: clm.data?.id ?? null,
      against_party: v.againstParty,
      owner_org_id: ownerOrg,
      category: v.category,
      subject: v.subject,
      description: v.description,
      desired_outcome: v.desiredOutcome ?? null,
      due_at: new Date(Date.now() + slaDays * 86_400_000).toISOString(),
    })
    .select("id, reference")
    .single();
  if (error) return { ok: false, error: dbError(error, "We couldn't file your complaint. Please try again.") };

  if (ownerOrg) {
    await notifyOrg(ownerOrg, {
      kind: "complaint.new",
      title: `New complaint ${complaint.reference}`,
      body: v.subject,
      link: `/partner/complaints/${complaint.id}`,
      data: { complaint_id: complaint.id },
    }).catch(() => {});
  }
  revalidatePath("/account/complaints");
  redirect(`/account/complaints/${complaint.id}?filed=1`);
}
