import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SERVICE_PARTNER_KINDS } from "@im/core";
import type { Database, Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";
import { notifyOrg } from "@/server/notify";
import { BusinessRuleError, ruleMessage } from "@/server/requests";

/**
 * Post-claim partner network (Addendum 6 item 5): self-onboarding applications and customer ratings.
 * Applications are written with the service client (the form is public; there is no anon insert policy)
 * and also land in the CRM as a lead tagged `service_partner`. Approval happens in the admin console,
 * which creates the `service_partners` row. Reviews are written as the customer (RLS + trigger: one per
 * completed job on their own claim); `service_partners.rating` is recomputed by the database.
 */
type Db = SupabaseClient<Database>;

export const ServicePartnerApplicationInput = z.object({
  kind: z.enum(SERVICE_PARTNER_KINDS),
  name: z.string().trim().min(2, "Enter the business name.").max(160),
  contact_name: z.string().trim().min(2, "Enter a contact name.").max(120),
  phone: z.string().trim().regex(/^[+()\d\s-]{7,20}$/, "Enter a valid phone number, for example 024 123 4567."),
  email: z.string().trim().max(200).optional().transform((v) => (v ? v : undefined)).pipe(z.email("Enter a valid email address.").optional()),
  address: z.string().trim().min(3, "Enter the address.").max(400),
  region: z.string().trim().min(2, "Choose the region.").max(100),
  services: z.string().trim().max(1000).optional(),
  licence: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional(),
});
export type ServicePartnerApplicationInput = z.infer<typeof ServicePartnerApplicationInput>;

export async function submitServicePartnerApplication(input: ServicePartnerApplicationInput, meta: { sourcePage?: string | null } = {}): Promise<{ id: string }> {
  const svc = createServiceClient();
  const services = (input.services ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
  const { data: lead, error: leadErr } = await svc
    .from("leads")
    .insert({
      kind: "other",
      name: input.contact_name,
      email: input.email ?? null,
      phone: input.phone,
      organization: input.name,
      message: [`Service partner application (${input.kind}) — ${input.region}.`, input.message].filter(Boolean).join("\n").slice(0, 4000),
      source_page: meta.sourcePage ?? "/claims/network/join",
      tags: ["service_partner"],
      metadata: { partner_kind: input.kind, region: input.region } as Json,
    })
    .select("id")
    .single();
  if (leadErr) log.warn("partner_network.lead_failed", { err: leadErr });
  const { data, error } = await svc
    .from("service_partner_applications")
    .insert({
      kind: input.kind,
      name: input.name,
      contacts: { contact_name: input.contact_name, phone: input.phone, email: input.email ?? null } as Json,
      address: input.address,
      region: input.region,
      services,
      documents: (input.licence ? [{ name: "Licence / registration", note: input.licence }] : []) as Json,
      lead_id: lead?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    log.error("partner_network.application_failed", { err: error });
    throw new BusinessRuleError("We couldn't send your application. Please try again.");
  }
  const { data: platform } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
  if (platform) {
    await notifyOrg(platform.id, { kind: "service_partner.application", title: `New partner application: ${input.name}`, body: `${input.kind} in ${input.region}. Review it in the admin console.`, link: "/service-partners/applications", data: { application_id: data.id } }, ["platform_admin", "platform_ops"]).catch(() => {});
  }
  return { id: data.id };
}

export type ServicePartnerReview = Row<"service_partner_reviews">;

/** The customer rates a completed job on their claim (RLS + trigger enforce ownership, completion and one per job). */
export async function reviewClaimJob(db: Db, args: { userId: string; claimId: string; jobId: string; rating: number; comment?: string | null }): Promise<ServicePartnerReview> {
  const { data: job } = await db.from("claim_jobs").select("id, claim_id, status, service_partner_id").eq("id", args.jobId).eq("claim_id", args.claimId).maybeSingle();
  if (!job) throw new BusinessRuleError("Job not found.", "not_found");
  if (job.status !== "completed") throw new BusinessRuleError("You can rate the partner once the job is completed.");
  const { data, error } = await db
    .from("service_partner_reviews")
    .insert({ claim_job_id: job.id, service_partner_id: job.service_partner_id, customer_id: args.userId, rating: Math.round(args.rating), comment: args.comment?.trim() || null })
    .select("*")
    .single();
  if (error?.code === "23505") throw new BusinessRuleError("You've already rated this job. Thank you!", "conflict");
  if (error || !data) throw new BusinessRuleError(ruleMessage(error, "We couldn't save your rating."), error?.code === "42501" ? "forbidden" : "business_rule");
  return data;
}

/** The caller's reviews for a set of jobs (to show "rated" instead of the prompt). */
export async function myJobReviews(db: Db, jobIds: string[]): Promise<Map<string, Pick<ServicePartnerReview, "id" | "rating" | "comment" | "status">>> {
  if (!jobIds.length) return new Map();
  const { data } = await db.from("service_partner_reviews").select("id, claim_job_id, rating, comment, status").in("claim_job_id", jobIds);
  return new Map((data ?? []).map((r) => [r.claim_job_id, r]));
}
