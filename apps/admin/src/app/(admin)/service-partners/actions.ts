"use server";
import { z } from "zod";
import { revalidateEverywhere } from "@/lib/revalidate";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Kind = z.enum(["garage", "towing", "hospital", "clinic", "pharmacy", "assessor"]);
const Status = z.enum(["pending", "approved", "suspended"]);

const Partner = z.object({
  partnerId: z.string().uuid().optional(),
  kind: Kind,
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  address: z.string().trim().max(400).optional(),
  region: z.string().trim().max(100).optional(),
  lat: z.string().trim().optional(),
  lng: z.string().trim().optional(),
  services: z.string().trim().max(1000).optional(),
  direct_billing_insurer_ids: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  status: Status.optional(),
  notes: z.string().trim().max(2000).optional(),
});

function toRow(v: z.infer<typeof Partner>) {
  const lat = v.lat ? Number(v.lat) : NaN;
  const lng = v.lng ? Number(v.lng) : NaN;
  const billing = v.direct_billing_insurer_ids == null ? [] : Array.isArray(v.direct_billing_insurer_ids) ? v.direct_billing_insurer_ids : [v.direct_billing_insurer_ids];
  return {
    kind: v.kind,
    name: v.name,
    phone: v.phone || null,
    email: v.email || null,
    address: v.address || null,
    region: v.region || null,
    gps: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    services: (v.services ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30),
    direct_billing_insurer_ids: [...new Set(billing)],
    notes: v.notes || null,
  };
}

/** Add a partner to the directory (pending until approved) or update an existing one. Rows are never deleted — suspend instead. */
export async function saveServicePartner(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = Partner.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const row = toRow(parsed.data);
  const { error } = parsed.data.partnerId
    ? await auth.supabase.from("service_partners").update({ ...row, ...(parsed.data.status ? { status: parsed.data.status } : {}) }).eq("id", parsed.data.partnerId)
    : await auth.supabase.from("service_partners").insert({ ...row, status: parsed.data.status ?? "pending", created_by: auth.staff.userId });
  if (error) return fail(dbMessage(error));
  await revalidateEverywhere(["service-partners"]);
  return done(parsed.data.partnerId ? "Partner updated." : "Partner added to the directory (pending approval).");
}

const SetStatus = z.object({ partnerId: z.string().uuid(), status: Status, reason: z.string().trim().max(1000).optional() });

/** Approve (publish to the directory), suspend or return to pending. */
export async function setServicePartnerStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("network");
  if (!auth.ok) return fail(auth.error);
  const parsed = SetStatus.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data: current } = await auth.supabase.from("service_partners").select("notes").eq("id", parsed.data.partnerId).maybeSingle();
  const stamp = parsed.data.reason ? `${new Date().toISOString().slice(0, 10)} ${parsed.data.status}: ${parsed.data.reason}` : null;
  const { error } = await auth.supabase
    .from("service_partners")
    .update({ status: parsed.data.status, ...(stamp ? { notes: [current?.notes, stamp].filter(Boolean).join("\n") } : {}) })
    .eq("id", parsed.data.partnerId);
  if (error) return fail(dbMessage(error));
  await revalidateEverywhere(["service-partners"]);
  return done(parsed.data.status === "approved" ? "Partner approved and published." : parsed.data.status === "suspended" ? "Partner suspended and removed from the public directory." : "Partner set to pending.");
}
