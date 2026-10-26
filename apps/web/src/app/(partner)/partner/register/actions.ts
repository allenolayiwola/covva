"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Json } from "@im/db";
import {
  APPLICATION_DOCUMENT_KINDS,
  INTEGRATION_LEVELS,
  COMMERCIAL_MODELS,
  agreementHash,
  agreementText,
  applicationCompleteness,
  companySchema,
  contactSchema,
  currentAgreement,
  licenceSchema,
  nextStep,
  settlementAccountSchema,
  type ApplicationStep,
  type PartnerApplicationType,
} from "@im/core";
import { getCategories } from "@/lib/catalog";
import { notifyApplicationSubmitted } from "@/server/onboarding";
import { ActionError, dbMessage, run, type ActionState } from "../_lib/context";
import { applicantAction, parseType, registerPath, toInput } from "./_lib";

const uuid = z.string().uuid();

function typeOf(fd: FormData): PartnerApplicationType {
  const t = parseType(fd.get("type"));
  if (!t) throw new ActionError("Choose whether you are registering an insurer or a broker.");
  return t;
}
const idOf = (fd: FormData) => {
  const raw = fd.get("applicationId");
  return typeof raw === "string" && raw ? uuid.parse(raw) : null;
};
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
function firstIssue(e: z.ZodError): string {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${String(i.path[0]).replace(/_/g, " ")}: ` : ""}${i.message}` : "Please check the form.";
}

/** Save a step and continue to the next incomplete one (or the step the applicant asked for). */
async function saveAndContinue(type: PartnerApplicationType, step: ApplicationStep, fd: FormData, patch: Record<string, Json | null | undefined>): Promise<ActionState> {
  const { supabase, user, application } = await applicantAction(type, idOf(fd));
  let id = application?.id ?? null;
  if (!id) {
    const { data, error } = await supabase
      .from("partner_applications")
      .insert({ type, applicant_user_id: user.id, status: "draft", ...(patch as Record<string, never>) })
      .select("id")
      .single();
    if (error) {
      // A draft already exists (unique open application per applicant and type): load and update it instead.
      if (error.code === "23505") {
        const { data: existing } = await supabase.from("partner_applications").select("id").eq("applicant_user_id", user.id).eq("type", type).in("status", ["draft", "needs_changes"]).limit(1).maybeSingle();
        if (!existing) return { ok: false, error: "You already have an application in review. Check its status instead." };
        id = existing.id;
      } else return { ok: false, error: dbMessage(error, "We couldn't save your application.") };
    } else id = data.id;
  }
  const { data: saved, error } = await supabase
    .from("partner_applications")
    .update(patch as Record<string, never>)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return { ok: false, error: dbMessage(error, "We couldn't save this step.") };
  const next = str(fd, "goto") === "stay" ? step : nextStep(toInput(saved), step);
  redirect(registerPath(type, next));
}

// ---------------------------------------------------------------------------
export async function saveCompany(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    const parsed = companySchema.safeParse({
      company_name: str(fd, "company_name"),
      legal_name: str(fd, "legal_name"),
      registration_number: str(fd, "registration_number"),
      address: str(fd, "address"),
      region: str(fd, "region"),
      website: str(fd, "website"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const v = parsed.data;
    return saveAndContinue(type, "company", fd, {
      company_name: v.company_name,
      legal_name: v.legal_name ?? null,
      registration_number: v.registration_number ?? null,
      address: v.address,
      region: v.region,
      website: v.website ?? null,
    });
  });
}

export async function saveLicence(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    const parsed = licenceSchema.safeParse({
      nic_licence_number: str(fd, "nic_licence_number"),
      nic_licence_class: str(fd, "nic_licence_class") || undefined,
      nic_licence_expires_on: str(fd, "nic_licence_expires_on"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const v = parsed.data;
    if (type === "broker" && v.nic_licence_class !== "broker") return { ok: false, error: "A broker registers with a broker-class NIC licence." };
    if (type === "insurer" && v.nic_licence_class === "broker") return { ok: false, error: "An insurer registers with a life, non-life or composite licence." };
    if (v.nic_licence_expires_on < new Date().toISOString().slice(0, 10)) return { ok: false, error: "That licence has already expired. Renew it before registering." };
    return saveAndContinue(type, "licence", fd, { nic_licence_number: v.nic_licence_number, nic_licence_class: v.nic_licence_class, nic_licence_expires_on: v.nic_licence_expires_on });
  });
}

function contactFrom(fd: FormData, prefix: string) {
  return { name: str(fd, `${prefix}_name`), email: str(fd, `${prefix}_email`), phone: str(fd, `${prefix}_phone`), title: str(fd, `${prefix}_title`) };
}

export async function saveContacts(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    const primary = contactSchema.safeParse(contactFrom(fd, "primary"));
    if (!primary.success) return { ok: false, error: `Primary contact — ${firstIssue(primary.error)}` };
    const secondKey = type === "insurer" ? "compliance" : "officer";
    const second = contactSchema.safeParse(contactFrom(fd, secondKey));
    if (!second.success) return { ok: false, error: `${type === "insurer" ? "Compliance contact" : "Principal officer"} — ${firstIssue(second.error)}` };
    const patch: Record<string, Json> = { primary_contact: primary.data as Json };
    if (type === "insurer") patch.compliance_contact = second.data as Json;
    else patch.principal_officer = second.data as Json;
    return saveAndContinue(type, "contacts", fd, patch);
  });
}

export async function saveSettlement(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    const kind = str(fd, "account_type");
    const raw =
      kind === "momo"
        ? { type: "momo", account_name: str(fd, "momo_account_name"), momo_network: str(fd, "momo_network"), momo_number: str(fd, "momo_number") }
        : { type: "bank", bank_name: str(fd, "bank_name"), account_name: str(fd, "bank_account_name"), account_number: str(fd, "account_number") };
    const parsed = settlementAccountSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    return saveAndContinue(type, "settlement", fd, { settlement_account: parsed.data as Json });
  });
}

const DocumentList = z.array(z.object({ path: z.string().min(1).max(500), name: z.string().min(1).max(200), kind: z.enum(APPLICATION_DOCUMENT_KINDS) })).min(1).max(20);

/** Called by the upload component after the files are in Storage (`partner-applications/<id>/…`). */
export async function recordDocuments(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    const id = idOf(fd);
    if (!id) return { ok: false, error: "Save the company step first." };
    const { supabase, application } = await applicantAction(type, id);
    let files: z.infer<typeof DocumentList>;
    try {
      files = DocumentList.parse(JSON.parse(str(fd, "files")));
    } catch {
      return { ok: false, error: "No files were uploaded." };
    }
    if (files.some((f) => !f.path.startsWith(`partner-applications/${id}/`))) return { ok: false, error: "Files must be uploaded to this application's folder." };
    const existing = Array.isArray(application!.documents) ? (application!.documents as Json[]) : [];
    const now = new Date().toISOString();
    const docs = [...existing, ...files.map((f) => ({ kind: f.kind, storage_path: f.path, name: f.name, uploaded_at: now }))];
    const { error } = await supabase.from("partner_applications").update({ documents: docs as Json }).eq("id", id);
    if (error) return { ok: false, error: dbMessage(error) };
    redirect(registerPath(type, "documents"));
  });
}

export async function removeDocument(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    const id = idOf(fd);
    const path = str(fd, "path");
    if (!id || !path) return { ok: false, error: "Nothing to remove." };
    const { supabase, application } = await applicantAction(type, id);
    const docs = (Array.isArray(application!.documents) ? (application!.documents as { storage_path?: string }[]) : []).filter((d) => d?.storage_path !== path);
    const { error } = await supabase.from("partner_applications").update({ documents: docs as Json }).eq("id", id);
    if (error) return { ok: false, error: dbMessage(error) };
    redirect(registerPath(type, "documents"));
  });
}

export async function saveIntegration(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    if (type !== "insurer") return { ok: false, error: "Integration levels apply to insurers." };
    const cats = await getCategories();
    const levels: { category_slug: string; level: string }[] = [];
    for (const c of cats) {
      const level = str(fd, `level_${c.slug}`);
      if (!level) continue;
      if (!(INTEGRATION_LEVELS as readonly string[]).includes(level)) return { ok: false, error: `Choose a valid level for ${c.name}.` };
      levels.push({ category_slug: c.slug, level });
    }
    if (!levels.length) return { ok: false, error: "Choose at least one product line you will offer on Covva." };
    return saveAndContinue(type, "integration", fd, { integration_levels: levels as Json });
  });
}

export async function saveCommercial(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    if (type !== "broker") return { ok: false, error: "The commercial model applies to brokers." };
    const model = str(fd, "commercial_model");
    if (!(COMMERCIAL_MODELS as readonly string[]).includes(model)) return { ok: false, error: "Choose revenue share or a subscription plan." };
    return saveAndContinue(type, "commercial", fd, { commercial_model: model });
  });
}

const Signature = z.object({
  signed_name: z.string().trim().min(2, "Type your full name as it appears on your ID").max(120),
  signed_title: z.string().trim().max(80).optional(),
  consent: z.literal("on", { error: "Tick the box to confirm you have read and agree to the partner agreement." }),
});

/**
 * In-app e-signature: typed name + explicit consent + timestamp + IP + user agent + SHA-256 of the
 * exact agreement text version shown. `provider` stays empty until an external provider is wired in.
 */
export async function signAgreement(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    const id = idOf(fd);
    if (!id) return { ok: false, error: "Save the company step first." };
    const parsed = Signature.safeParse({ signed_name: str(fd, "signed_name"), signed_title: str(fd, "signed_title") || undefined, consent: str(fd, "consent") || undefined });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const agreement = currentAgreement(type);
    const expectedHash = str(fd, "hash");
    const hash = await agreementHash(agreementText(agreement));
    if (expectedHash && expectedHash !== hash) return { ok: false, error: "The agreement text changed while you were reading it. Reload and sign again." };
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0]?.trim() ?? "";
    const signature = {
      version: agreement.version,
      signed_name: parsed.data.signed_name,
      signed_title: parsed.data.signed_title ?? "",
      signed_at: new Date().toISOString(),
      ip: ip.slice(0, 64),
      user_agent: (h.get("user-agent") ?? "").slice(0, 400),
      hash,
      provider: "",
    };
    return saveAndContinue(type, "agreement", fd, { agreement: signature as Json });
  });
}

export async function submitApplication(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const type = typeOf(fd);
    const id = idOf(fd);
    if (!id) return { ok: false, error: "Nothing to submit yet." };
    const { supabase, application, user } = await applicantAction(type, id);
    const completeness = applicationCompleteness(toInput(application!));
    if (!completeness.complete) {
      const first = completeness.missing[0]!;
      return { ok: false, error: `${first.label}: ${first.reason}`, data: { step: first.step } };
    }
    const { error } = await supabase.from("partner_applications").update({ status: "submitted" }).eq("id", id);
    if (error) return { ok: false, error: dbMessage(error, "We couldn't submit your application.") };
    await notifyApplicationSubmitted({ id, type, companyName: application!.company_name ?? "A partner", applicantUserId: user.id }).catch(() => {});
    redirect("/partner/register/status?submitted=1");
  });
}
