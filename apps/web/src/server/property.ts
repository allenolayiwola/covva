import "server-only";
import type { Json, Row } from "@im/db";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError, ruleMessage } from "@/server/requests";
import { notify, notifyOrg } from "@/server/notify";
import { log } from "@/server/log";

/**
 * Property cover for homes being built or owned in Ghana (roadmap Phase 4 "advanced diaspora"):
 * partner site inspections and construction photo updates. Covva arranges the inspection with a
 * partner organisation (`organizations.settings.inspection_partner = true`); the INSURER decides what
 * a report means for cover. Customer/sponsor writes go through RLS (their own policy); assignment is a
 * staff action with the service client.
 */
type UserClient = Awaited<ReturnType<typeof createClient>>;
type Svc = ReturnType<typeof createServiceClient>;
export type PropertyInspection = Row<"property_inspections">;
export type PropertyUpdate = Row<"property_updates">;

export const PROPERTY_CATEGORY_SLUGS = ["home", "sme-property", "property", "buildings"] as const;
export const isPropertyCategory = (slug: string | null | undefined) => !!slug && (PROPERTY_CATEGORY_SLUGS as readonly string[]).includes(slug);

export interface InspectionPhoto { storage_path: string; taken_at?: string | null; caption?: string | null }

export const INSPECTION_STATUS: Record<PropertyInspection["status"] | string, { label: string; tone: "wait" | "info" | "ok" | "danger" | "neutral" }> = {
  requested: { label: "Requested", tone: "wait" },
  assigned: { label: "Partner assigned", tone: "info" },
  scheduled: { label: "Scheduled", tone: "info" },
  completed: { label: "Completed", tone: "ok" },
  failed: { label: "Could not inspect", tone: "danger" },
};

// ---------------------------------------------------------------------------
// Customer / sponsor
// ---------------------------------------------------------------------------
export async function requestInspection(
  supabase: UserClient,
  userId: string,
  input: { policyId?: string | null; requestId?: string | null; address: string; gps?: { lat: number; lng: number } | null; notes?: string | null },
): Promise<PropertyInspection> {
  if (!input.policyId && !input.requestId) throw new BusinessRuleError("Link the inspection to a policy or a request.", "invalid_input");
  // One open inspection per policy/request at a time.
  let openQ = supabase.from("property_inspections").select("id").in("status", ["requested", "assigned", "scheduled"]).limit(1);
  openQ = input.policyId ? openQ.eq("policy_id", input.policyId) : openQ.eq("request_id", input.requestId!);
  const { data: open } = await openQ;
  if (open?.length) throw new BusinessRuleError("An inspection is already in progress for this property.", "conflict");
  const { data, error } = await supabase
    .from("property_inspections")
    .insert({
      policy_id: input.policyId ?? null,
      request_id: input.requestId ?? null,
      requested_by: userId,
      address: input.address.trim().slice(0, 500),
      gps: input.gps ? ({ lat: input.gps.lat, lng: input.gps.lng } as Json) : null,
      notes: input.notes?.trim().slice(0, 2000) || null,
      status: "requested",
    })
    .select("*")
    .single();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "We couldn't request the inspection. Check the policy is yours."), error?.code === "42501" ? "forbidden" : "business_rule");
  // Tell platform ops (they assign a partner) — best effort.
  try {
    const svc = createServiceClient();
    const { data: platform } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
    if (platform) {
      await notifyOrg(platform.id, { kind: "property.inspection_requested", title: "Property inspection requested", body: `${data.address ?? "A property"} — assign an inspection partner in the admin console.`, link: "/inspections", data: { inspection_id: data.id, policy_id: data.policy_id, request_id: data.request_id }, channels: ["in_app"] }, ["platform_admin", "platform_ops"]);
    }
  } catch (err) {
    log.warn("property.notify_ops_failed", { err });
  }
  return data;
}

export async function addPropertyUpdate(
  supabase: UserClient,
  userId: string,
  input: { policyId: string; storagePath: string; caption?: string | null; takenAt?: string | null },
): Promise<PropertyUpdate> {
  // Uploads live in the private documents bucket under the uploader's own folder.
  if (!input.storagePath.startsWith(`${userId}/`)) throw new BusinessRuleError("That upload isn't yours.", "forbidden");
  const { data, error } = await supabase
    .from("property_updates")
    .insert({ policy_id: input.policyId, storage_path: input.storagePath, caption: input.caption?.trim().slice(0, 500) || null, taken_at: input.takenAt ?? null, uploaded_by: userId })
    .select("*")
    .single();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "We couldn't save that photo. Check the policy is yours."), error?.code === "42501" ? "forbidden" : "business_rule");
  return data;
}

// ---------------------------------------------------------------------------
// Platform staff
// ---------------------------------------------------------------------------
/** Organisations flagged as inspection partners (`settings.inspection_partner = true`). */
export async function listInspectionPartners(svc: Svc): Promise<{ id: string; name: string; type: string }[]> {
  const { data } = await svc.from("organizations").select("id, name, type, settings").eq("status", "active").limit(500);
  return (data ?? []).filter((o) => (o.settings as { inspection_partner?: boolean } | null)?.inspection_partner === true).map((o) => ({ id: o.id, name: o.name, type: o.type }));
}

export async function assignInspectionPartner(svc: Svc, args: { inspectionId: string; partnerOrgId: string; actorId?: string | null }): Promise<PropertyInspection> {
  const { data: org } = await svc.from("organizations").select("id, name, settings, status").eq("id", args.partnerOrgId).maybeSingle();
  if (!org || org.status !== "active" || (org.settings as { inspection_partner?: boolean } | null)?.inspection_partner !== true) {
    throw new BusinessRuleError("Choose an active organisation flagged as an inspection partner.", "invalid_input");
  }
  const { data, error } = await svc
    .from("property_inspections")
    .update({ partner_org_id: org.id, status: "assigned" })
    .eq("id", args.inspectionId)
    .in("status", ["requested", "assigned"])
    .select("*")
    .maybeSingle();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "This inspection can't be assigned (already scheduled or completed)."));
  await notifyOrg(org.id, { kind: "inspection.assigned", title: "New property inspection", body: `${data.address ?? "Property"} — accept and schedule it in your workspace.`, link: "/partner/inspections", data: { inspection_id: data.id }, channels: ["in_app", "email"] });
  await notifyParties(svc, data, "inspection.assigned", "Inspection partner assigned", `${org.name} will contact you to schedule the site visit.`);
  return data;
}

// ---------------------------------------------------------------------------
// Inspection partner (RLS: update own assigned rows)
// ---------------------------------------------------------------------------
export async function scheduleInspection(supabase: UserClient, args: { inspectionId: string; scheduledFor: string }): Promise<PropertyInspection> {
  const { data, error } = await supabase
    .from("property_inspections")
    .update({ scheduled_for: args.scheduledFor, status: "scheduled" })
    .eq("id", args.inspectionId)
    .in("status", ["assigned", "scheduled"])
    .select("*")
    .maybeSingle();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "This inspection can't be scheduled."));
  await notifyParties(createServiceClient(), data, "inspection.scheduled", "Site inspection scheduled", `The inspection partner will visit on ${new Date(args.scheduledFor).toLocaleString("en-GB", { timeZone: "Africa/Accra", dateStyle: "medium", timeStyle: "short" })}.`);
  return data;
}

export async function completeInspection(
  supabase: UserClient,
  args: { inspectionId: string; outcome: "completed" | "failed"; report: Record<string, unknown>; photos: InspectionPhoto[] },
): Promise<PropertyInspection> {
  const photos = args.photos.filter((p) => typeof p.storage_path === "string" && p.storage_path.length > 3).slice(0, 50).map((p) => ({ storage_path: p.storage_path, taken_at: p.taken_at ?? null, caption: p.caption?.slice(0, 300) ?? null }));
  const { data, error } = await supabase
    .from("property_inspections")
    .update({ status: args.outcome, report: args.report as Json, photos: photos as unknown as Json, completed_at: new Date().toISOString() })
    .eq("id", args.inspectionId)
    .in("status", ["assigned", "scheduled"])
    .select("*")
    .maybeSingle();
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "This inspection can't be completed."));
  const svc = createServiceClient();
  await registerInspectionPhotos(svc, supabase, data, photos);
  await notifyParties(svc, data, "inspection.completed", args.outcome === "completed" ? "Site inspection completed" : "Site inspection could not be done", args.outcome === "completed" ? "The report has been shared with the insurer, who decides what it means for your cover." : "The partner could not inspect the property. Your broker will be in touch.");
  // The insurer (and broker) on the policy see the report in their workspace.
  if (data.policy_id) {
    const { data: policy } = await svc.from("policies").select("insurer_org_id, broker_org_id, internal_reference").eq("id", data.policy_id).maybeSingle();
    for (const orgId of [policy?.insurer_org_id, policy?.broker_org_id]) {
      if (orgId) await notifyOrg(orgId, { kind: "inspection.completed", title: `Property inspection ${args.outcome} · ${policy?.internal_reference ?? ""}`.trim(), link: `/partner/policies/${data.policy_id}`, data: { inspection_id: data.id, policy_id: data.policy_id }, channels: ["in_app", "email"] });
    }
  }
  return data;
}

/**
 * The partner's photos sit in the partner's own storage folder. Registering them as `documents` of the policy
 * (owner = the policy customer) is what lets the customer, the sponsor abroad, the broker and the insurer sign and
 * view them on the photo timeline (storage RLS reads through `documents`). Idempotent; never blocks the flow.
 */
async function registerInspectionPhotos(svc: Svc, inspector: UserClient, insp: PropertyInspection, photos: InspectionPhoto[]) {
  if (!photos.length) return;
  try {
    const report = (insp.report ?? {}) as { inspector_user_id?: string };
    const uploadedBy = report.inspector_user_id ?? (await inspector.auth.getUser()).data.user?.id ?? null;
    let ownerId: string | null = null;
    if (insp.policy_id) ownerId = (await svc.from("policies").select("customer_id").eq("id", insp.policy_id).maybeSingle()).data?.customer_id ?? null;
    else if (insp.request_id) ownerId = (await svc.from("requests").select("customer_id").eq("id", insp.request_id).maybeSingle()).data?.customer_id ?? null;
    if (!ownerId) return;
    const { error } = await svc.from("documents").upsert(
      photos.map((p) => ({
        owner_id: ownerId!,
        uploaded_by: uploadedBy,
        uploaded_by_party: "broker" as const,
        policy_id: insp.policy_id,
        request_id: insp.policy_id ? null : insp.request_id,
        kind: "photo" as const,
        storage_path: p.storage_path,
        file_name: (p.caption ?? p.storage_path.split("/").pop() ?? "inspection-photo").slice(0, 255),
        mime_type: /\.(png)$/i.test(p.storage_path) ? "image/png" : /\.(webp)$/i.test(p.storage_path) ? "image/webp" : "image/jpeg",
      })),
      { onConflict: "storage_path", ignoreDuplicates: true },
    );
    if (error) log.warn("property.register_photos_failed", { inspectionId: insp.id, err: error });
  } catch (err) {
    log.warn("property.register_photos_failed", { inspectionId: insp.id, err });
  }
}

/** Notify the policy customer (and the sponsor, when the diaspora model has one) or the request customer. */
async function notifyParties(svc: Svc, insp: PropertyInspection, kind: string, title: string, body: string) {
  const users = new Set<string>();
  if (insp.policy_id) {
    const { data: p } = await svc.from("policies").select("*").eq("id", insp.policy_id).maybeSingle();
    if (p?.customer_id) users.add(p.customer_id);
    const sponsor = (p as unknown as { sponsor_user_id?: string | null } | null)?.sponsor_user_id;
    if (sponsor) users.add(sponsor);
  } else if (insp.request_id) {
    const { data: r } = await svc.from("requests").select("customer_id").eq("id", insp.request_id).maybeSingle();
    if (r?.customer_id) users.add(r.customer_id);
  }
  if (insp.requested_by) users.add(insp.requested_by);
  if (!users.size) return;
  await notify([...users].map((userId) => ({ userId, kind, title, body, link: insp.policy_id ? `/account/policies/${insp.policy_id}` : `/account/requests/${insp.request_id}`, data: { inspection_id: insp.id }, channels: ["in_app", "email", "push"] })));
}
