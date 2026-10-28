"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessRuleError } from "@/server/requests";
import { addPropertyUpdate, requestInspection } from "@/server/property";
import { isOwnUpload, type ActionState, type UploadedFile } from "@/components/customer/utils";
import { SIGNED_OUT, actionContext } from "../../_lib/action";

const uuid = z.string().uuid();

/** Photo update from the site (customer in Ghana or sponsor abroad) — the file is already in the documents bucket. */
export async function addPropertyPhoto(policyId: string, file: UploadedFile): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success || !isOwnUpload(file, user.id)) return { ok: false, error: "That upload isn't valid." };
  try {
    await addPropertyUpdate(supabase, user.id, { policyId, storagePath: file.path, caption: file.name.slice(0, 120) });
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't save that photo." };
  }
  revalidatePath(`/account/policies/${policyId}`);
  return { ok: true, message: "Photo added. Your broker and the insurer can see progress on the site." };
}

const Inspection = z.object({
  address: z.string().trim().min(5, "Enter the site address or a landmark").max(500),
  notes: z.string().trim().max(2000).optional(),
});

export async function requestPropertyInspection(policyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(policyId).success) return { ok: false, error: "Unknown policy." };
  const parsed = Inspection.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message, fieldErrors: { address: parsed.error.issues[0]?.message ?? "" } };
  try {
    await requestInspection(supabase, user.id, { policyId, address: parsed.data.address, notes: parsed.data.notes });
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't request the inspection." };
  }
  revalidatePath(`/account/policies/${policyId}`);
  return { ok: true, message: "Inspection requested. We assign a partner and let you know when it's scheduled." };
}
