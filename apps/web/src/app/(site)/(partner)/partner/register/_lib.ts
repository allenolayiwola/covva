import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Row } from "@im/db";
import type { PartnerApplicationInput, PartnerApplicationType } from "@im/core";
import { getUser, requireUser } from "@/lib/auth";
import { getFlags } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import { ActionError } from "../_lib/context";

export type Application = Row<"partner_applications">;
export const OPEN_STATUSES = ["draft", "submitted", "in_review", "needs_changes"] as const;
export const EDITABLE_STATUSES = ["draft", "needs_changes"] as const;

export function parseType(raw: unknown): PartnerApplicationType | null {
  return raw === "insurer" || raw === "broker" ? raw : null;
}

export function registerPath(type: PartnerApplicationType, step?: string) {
  return `/partner/register?type=${type}${step ? `&step=${step}` : ""}`;
}

/** Feature flag per applicant type (Addendum 3 E: registration can be opened or restricted). */
export async function registrationOpen(type: PartnerApplicationType): Promise<boolean> {
  const flags = await getFlags();
  return flags[`partner_self_service_${type}`] === true;
}

/** Signed-in applicant + their open application of this type (RLS: own rows only). */
export const getApplicant = cache(async (type: PartnerApplicationType) => {
  const user = await requireUser(registerPath(type));
  const supabase = await createClient();
  const { data } = await supabase
    .from("partner_applications")
    .select("*")
    .eq("applicant_user_id", user.id)
    .eq("type", type)
    .in("status", [...OPEN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { user, supabase, application: data ?? null };
});

/** All applications of the signed-in user (status page). */
export async function getMyApplications() {
  const user = await getUser();
  if (!user) redirect("/sign-in?next=%2Fpartner%2Fregister%2Fstatus");
  const supabase = await createClient();
  const { data } = await supabase.from("partner_applications").select("*").eq("applicant_user_id", user.id).order("created_at", { ascending: false });
  return { user, supabase, applications: data ?? [] };
}

/** Narrow the DB row to the shape the core rules understand. */
export function toInput(app: Application): PartnerApplicationInput {
  return {
    type: app.type as PartnerApplicationType,
    company_name: app.company_name,
    legal_name: app.legal_name,
    registration_number: app.registration_number,
    nic_licence_number: app.nic_licence_number,
    nic_licence_class: app.nic_licence_class as PartnerApplicationInput["nic_licence_class"],
    nic_licence_expires_on: app.nic_licence_expires_on,
    address: app.address,
    region: app.region,
    website: app.website,
    primary_contact: app.primary_contact as PartnerApplicationInput["primary_contact"],
    compliance_contact: app.compliance_contact as PartnerApplicationInput["compliance_contact"],
    principal_officer: app.principal_officer as PartnerApplicationInput["principal_officer"],
    settlement_account: app.settlement_account as PartnerApplicationInput["settlement_account"],
    commercial_model: app.commercial_model as PartnerApplicationInput["commercial_model"],
    integration_levels: app.integration_levels as PartnerApplicationInput["integration_levels"],
    documents: app.documents as PartnerApplicationInput["documents"],
    agreement: app.agreement as PartnerApplicationInput["agreement"],
  };
}

/**
 * Server Action context: re-verifies the session, the feature flag and that the application
 * (when given) belongs to the caller and is still editable. RLS is the real boundary.
 */
export async function applicantAction(type: PartnerApplicationType, applicationId?: string | null) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ActionError("Your session has ended. Please sign in again.");
  if (!(await registrationOpen(type))) throw new ActionError("Self-service registration is currently closed. Our partnerships team will be in touch.");
  let application: Application | null = null;
  if (applicationId) {
    const { data: app } = await supabase.from("partner_applications").select("*").eq("id", applicationId).eq("applicant_user_id", data.user.id).maybeSingle();
    if (!app) throw new ActionError("We couldn't find that application.");
    if (!(EDITABLE_STATUSES as readonly string[]).includes(app.status)) throw new ActionError(`This application is ${app.status.replace(/_/g, " ")} and can no longer be edited.`);
    application = app;
  }
  return { supabase, user: data.user, application };
}
