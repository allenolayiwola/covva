"use server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CRM_ACCOUNT_KINDS, CRM_SOURCES, CRM_STAGE_KEYS, canMoveStage, crmStageLabel, type CrmStage } from "@im/core";
import type { Json } from "@im/db";
import { dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { adminUrl, authorizeCrm, contactOf, siteUrl, type CrmActor } from "@/lib/crm";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyUsers } from "@/server/notify";
import { emailHtml, emailText, sendEmail } from "@/server/email";
import { accountHref } from "./meta";

const opt = (max = 300) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date");
const optDateTime = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Use a valid date and time")
  .transform((v) => (v ? new Date(v).toISOString() : null));
const optMoney = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? Number(v.replace(/[,\s]/g, "")) : null))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Enter a positive amount");
const tagsField = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? [...new Set(v.split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) : []));

const AccountFields = z.object({
  kind: z.enum(CRM_ACCOUNT_KINDS),
  name: z.string().trim().min(2, "Name is required").max(200),
  source: z.enum(CRM_SOURCES).default("rep"),
  owner_user_id: optUuid,
  org_id: optUuid,
  region: opt(100),
  estimated_value: optMoney,
  expected_go_live: optDate,
  contact_name: opt(200),
  contact_email: z.union([z.string().trim().email("Enter a valid email"), z.literal("")]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  contact_phone: opt(50),
  contact_title: opt(100),
  tags: tagsField,
});

function contactJson(f: z.infer<typeof AccountFields>): Json {
  const c: Record<string, string> = {};
  if (f.contact_name) c.name = f.contact_name;
  if (f.contact_email) c.email = f.contact_email;
  if (f.contact_phone) c.phone = f.contact_phone;
  if (f.contact_title) c.title = f.contact_title;
  return c;
}

const Create = AccountFields.extend({ lead_id: optUuid });

export async function createAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Create.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const f = parsed.data;
  const { data, error } = await auth.supabase
    .from("crm_accounts")
    .insert({
      kind: f.kind,
      name: f.name,
      source: f.source,
      owner_user_id: f.owner_user_id ?? (auth.actor.isRep ? auth.actor.staff.userId : null),
      org_id: f.org_id,
      lead_id: f.lead_id,
      region: f.region,
      estimated_value: f.estimated_value,
      expected_go_live: f.expected_go_live,
      contact: contactJson(f),
      tags: f.tags,
      created_by: auth.actor.staff.userId,
    })
    .select("id, owner_user_id, name")
    .single();
  if (error) return fail(dbMessage(error));
  if (data.owner_user_id && data.owner_user_id !== auth.actor.staff.userId) notifyAssignment(auth.actor, data.owner_user_id, data.id, data.name);
  redirect(accountHref(data.id));
}

const Update = AccountFields.extend({ accountId: z.string().uuid() });

export async function updateAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Update.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { accountId, ...f } = parsed.data;
  const { data: current } = await auth.supabase.from("crm_accounts").select("owner_user_id, name").eq("id", accountId).maybeSingle();
  if (!current) return fail("Account not found.");
  const { error } = await auth.supabase
    .from("crm_accounts")
    .update({
      kind: f.kind,
      name: f.name,
      source: f.source,
      owner_user_id: f.owner_user_id,
      org_id: f.org_id,
      region: f.region,
      estimated_value: f.estimated_value,
      expected_go_live: f.expected_go_live,
      contact: contactJson(f),
      tags: f.tags,
    })
    .eq("id", accountId);
  if (error) return fail(dbMessage(error));
  if (f.owner_user_id && f.owner_user_id !== current.owner_user_id && f.owner_user_id !== auth.actor.staff.userId) notifyAssignment(auth.actor, f.owner_user_id, accountId, f.name);
  return done("Account saved.");
}

const Assign = z.object({ accountId: z.string().uuid(), owner_user_id: optUuid });

export async function assignOwner(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Assign.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data, error } = await auth.supabase.from("crm_accounts").update({ owner_user_id: parsed.data.owner_user_id }).eq("id", parsed.data.accountId).select("id, name, owner_user_id").single();
  if (error) return fail(dbMessage(error));
  if (data.owner_user_id && data.owner_user_id !== auth.actor.staff.userId) notifyAssignment(auth.actor, data.owner_user_id, data.id, data.name);
  return done(data.owner_user_id ? "Owner assigned." : "Owner cleared.");
}

function notifyAssignment(actor: CrmActor, ownerId: string, accountId: string, name: string) {
  after(() =>
    notifyUsers({
      userId: ownerId,
      kind: "crm.account.assigned",
      title: `You now own ${name}`,
      body: `${actor.staff.name ?? actor.staff.email ?? "A colleague"} assigned this partnership account to you.`,
      link: adminUrl(accountHref(accountId)),
      data: { account_id: accountId },
    }),
  );
}

const Move = z.object({
  accountId: z.string().uuid(),
  to: z.enum(CRM_STAGE_KEYS as [CrmStage, ...CrmStage[]]),
  note: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  reason: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
});

/** Move an account one stage (or to lost). The DB RPC records the audit row with the note. */
export async function moveStage(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Move.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { accountId, to, note, reason } = parsed.data;
  const { data: acc } = await auth.supabase.from("crm_accounts").select("id, name, stage, org_id, owner_user_id").eq("id", accountId).maybeSingle();
  if (!acc) return fail("Account not found.");
  const check = canMoveStage(acc.stage as CrmStage, to, { hasOrg: !!acc.org_id });
  if (!check.ok) return fail(check.reason ?? "That move is not allowed.");
  if (to === "lost" && !(reason || note)) return fail("Record why the account was lost.");
  const { error } = await auth.supabase.rpc("crm_move_stage", { p_account_id: accountId, p_to_stage: to, p_note: note ?? undefined, p_lost_reason: reason ?? undefined });
  if (error) return fail(dbMessage(error));
  if (acc.owner_user_id && acc.owner_user_id !== auth.actor.staff.userId) {
    const ownerId = acc.owner_user_id;
    after(() =>
      notifyUsers({
        userId: ownerId,
        kind: "crm.account.stage",
        title: `${acc.name} moved to ${crmStageLabel(to)}`,
        body: note ?? undefined,
        link: adminUrl(accountHref(accountId)),
        data: { account_id: accountId, from: acc.stage, to },
      }),
    );
  }
  return done(`Moved to ${crmStageLabel(to)}.`);
}

const Note = z.object({ accountId: z.string().uuid(), body: z.string().trim().min(1, "Write a note").max(8000), pinned: z.string().optional() });

export async function addNote(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Note.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("crm_notes").insert({ account_id: parsed.data.accountId, body: parsed.data.body, author_id: auth.actor.staff.userId, pinned: parsed.data.pinned === "on" });
  if (error) return fail(dbMessage(error));
  return done("Note added.");
}

const Pin = z.object({ noteId: z.string().uuid(), value: z.enum(["true", "false"]) });

export async function pinNote(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Pin.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("crm_notes").update({ pinned: parsed.data.value === "true" }).eq("id", parsed.data.noteId);
  if (error) return fail(dbMessage(error));
  return done(parsed.data.value === "true" ? "Pinned." : "Unpinned.");
}

const Task = z.object({
  accountId: z.string().uuid(),
  title: z.string().trim().min(1, "Give the task a title").max(300),
  due_at: optDateTime,
  assignee_id: optUuid,
});

export async function addTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Task.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const assignee = parsed.data.assignee_id ?? auth.actor.staff.userId;
  const { data, error } = await auth.supabase
    .from("crm_tasks")
    .insert({ account_id: parsed.data.accountId, title: parsed.data.title, due_at: parsed.data.due_at, assignee_id: assignee, created_by: auth.actor.staff.userId })
    .select("id, account_id")
    .single();
  if (error) return fail(dbMessage(error));
  if (assignee !== auth.actor.staff.userId) {
    const { data: acc } = await auth.supabase.from("crm_accounts").select("name").eq("id", data.account_id).maybeSingle();
    after(() =>
      notifyUsers({
        userId: assignee,
        kind: "crm.task.assigned",
        title: `Task: ${parsed.data.title}`,
        body: `${auth.actor.staff.name ?? auth.actor.staff.email ?? "A colleague"} assigned you a task on ${acc?.name ?? "a partnership account"}${parsed.data.due_at ? `, due ${parsed.data.due_at.slice(0, 10)}` : ""}.`,
        link: adminUrl(accountHref(data.account_id)),
        data: { account_id: data.account_id, task_id: data.id },
      }),
    );
  }
  return done("Task added.");
}

const Toggle = z.object({ taskId: z.string().uuid(), value: z.enum(["true", "false"]) });

export async function toggleTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Toggle.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { error } = await auth.supabase.from("crm_tasks").update({ done_at: parsed.data.value === "true" ? new Date().toISOString() : null }).eq("id", parsed.data.taskId);
  if (error) return fail(dbMessage(error));
  return done(parsed.data.value === "true" ? "Task done." : "Task reopened.");
}

const Meeting = z.object({
  accountId: z.string().uuid(),
  starts_at: z.string().trim().min(1, "When does it start?").refine((v) => !Number.isNaN(Date.parse(v)), "Use a valid date and time").transform((v) => new Date(v).toISOString()),
  ends_at: optDateTime,
  location: opt(300),
  attendees: z.string().trim().max(1000).optional().transform((v) => (v ? v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30) : [])),
  summary: opt(4000),
});

export async function addMeeting(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Meeting.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const m = parsed.data;
  if (m.ends_at && m.ends_at < m.starts_at) return fail("The meeting cannot end before it starts.");
  const { error } = await auth.supabase.from("crm_meetings").insert({
    account_id: m.accountId,
    starts_at: m.starts_at,
    ends_at: m.ends_at,
    location: m.location,
    attendees: m.attendees as unknown as Json,
    summary: m.summary,
    created_by: auth.actor.staff.userId,
  });
  if (error) return fail(dbMessage(error));
  return done("Meeting recorded.");
}

const MAX_UPLOAD = 20 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

export async function uploadAttachment(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const accountId = String(fd.get("accountId") ?? "");
  if (!z.string().uuid().safeParse(accountId).success) return fail("Account not found.");
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return fail("Choose a file to upload.");
  if (file.size > MAX_UPLOAD) return fail("Files must be 20 MB or smaller.");
  if (!ALLOWED.has(file.type)) return fail("Only PDF, images and Word documents can be attached.");
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").slice(-80) || "file";
  const path = `crm/${accountId}/${crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await auth.supabase.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return fail(`Upload failed: ${upErr.message}`);
  const { error } = await auth.supabase.from("crm_attachments").insert({
    account_id: accountId,
    storage_path: path,
    name: file.name.slice(0, 200),
    size_bytes: file.size,
    content_type: file.type,
    uploaded_by: auth.actor.staff.userId,
  });
  if (error) return fail(dbMessage(error));
  return done("Attachment uploaded.");
}

const Convert = z.object({ leadId: z.string().uuid() });

/** Create (or open) the CRM account for a marketing lead — idempotent via the DB RPC. */
export async function convertLead(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Convert.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data, error } = await auth.supabase.rpc("crm_lead_to_account", { p_lead_id: parsed.data.leadId });
  if (error) return fail(dbMessage(error));
  if (!data) return fail("Only insurer, broker and enterprise leads become partnership accounts.");
  redirect(accountHref(data));
}

// ---------------------------------------------------------------------------
// Assisted onboarding (Addendum 3 D): the rep pre-fills a partner application and
// invites the partner to review, confirm and activate it on the web app.
// ---------------------------------------------------------------------------
const Assisted = z.object({ accountId: z.string().uuid(), message: z.string().trim().max(1000).optional() });

export async function startAssistedOnboarding(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorizeCrm();
  if (!auth.ok) return fail(auth.error);
  const parsed = Assisted.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data: acc } = await auth.supabase.from("crm_accounts").select("*").eq("id", parsed.data.accountId).maybeSingle();
  if (!acc) return fail("Account not found.");
  if (acc.application_id) return fail("This account already has a linked application.");
  if (acc.kind !== "insurer" && acc.kind !== "broker") return fail("Assisted onboarding creates insurer or broker applications. Embedded partners and groups are set up as enterprise organisations.");
  const contact = contactOf(acc);
  if (!contact.email) return fail("Add the partner contact's email address first — the invitation is sent there.");

  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    return fail("Assisted onboarding needs the service key (SUPABASE_SECRET_KEY) on the admin server.");
  }
  const { data: org } = acc.org_id ? await svc.from("organizations").select("legal_name, registration_number, nic_licence_number, nic_licence_class, address, website").eq("id", acc.org_id).maybeSingle() : { data: null };

  // The partner_applications table is owned by the partner self-service stream. Insert the
  // columns we know about and drop any the live table does not have (PGRST204) rather than
  // failing, so the two streams can ship independently.
  const row: Record<string, unknown> = {
    type: acc.kind,
    status: "draft",
    company_name: acc.name,
    legal_name: org?.legal_name ?? null,
    registration_number: org?.registration_number ?? null,
    nic_licence_number: org?.nic_licence_number ?? null,
    nic_licence_class: org?.nic_licence_class ?? null,
    address: org?.address ?? null,
    region: acc.region,
    website: org?.website ?? null,
    primary_contact: { name: contact.name ?? null, email: contact.email, phone: contact.phone ?? null, title: contact.title ?? null },
    assisted_by: auth.actor.staff.userId,
    applicant_user_id: null,
  };
  let applicationId: string | null = null;
  let note = "";
  for (let attempt = 0; attempt < 8 && !applicationId; attempt++) {
    const { data, error } = await svc.from("partner_applications").insert(row as never).select("id").single();
    if (!error && data) {
      applicationId = data.id;
      break;
    }
    const missing = error?.code === "PGRST204" ? /'([^']+)' column/.exec(error.message)?.[1] : undefined;
    if (missing && missing in row) {
      delete row[missing];
      continue;
    }
    if (error?.code === "23502" && row.applicant_user_id === null) {
      // Table requires an applicant: the rep holds the draft until the partner claims it via the invitation.
      row.applicant_user_id = auth.actor.staff.userId;
      note = " The application is held under your account until the partner claims it.";
      continue;
    }
    if (error?.code === "42P01") return fail("Partner applications are not available yet (the partner self-service migration has not been applied).");
    return fail(`Could not create the application: ${error ? dbMessage(error) : "unknown error"}`);
  }
  if (!applicationId) return fail("Could not create the application.");

  const { error: linkErr } = await auth.supabase.from("crm_accounts").update({ application_id: applicationId }).eq("id", acc.id);
  if (linkErr) return fail(dbMessage(linkErr));
  await auth.supabase.from("crm_notes").insert({
    account_id: acc.id,
    body: `Assisted onboarding started: application ${applicationId} pre-filled and invitation sent to ${contact.email}.${parsed.data.message ? ` Message: ${parsed.data.message}` : ""}`,
    author_id: auth.actor.staff.userId,
  });

  const link = siteUrl(`/partner/register/status?application=${encodeURIComponent(applicationId)}`);
  const repName = auth.actor.staff.name ?? auth.actor.staff.email ?? "Your Covva partnerships contact";
  const title = `${acc.name}: review your Covva ${acc.kind} application`;
  const body = [
    `${repName} has pre-filled a ${acc.kind} application for ${acc.name} on Covva.`,
    "Open the link to review the details, upload any missing documents, confirm with a one-time code and sign the partner agreement. Nothing goes live until Covva verifies the application.",
    parsed.data.message ? `Message from ${repName}: ${parsed.data.message}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const to = contact.email;
  after(async () => {
    await sendEmail({ to, subject: title, html: emailHtml({ title, body, link, cta: "Review application", name: contact.name }), text: emailText({ title, body, link, cta: "Review application" }) });
  });
  return done(`Application created and invitation sent to ${contact.email}.${note}`);
}
