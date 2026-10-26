import "server-only";
import type { ClientImportRow } from "@im/core";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";
import { notify, notifyOrg } from "@/server/notify";

/**
 * Partner onboarding server helpers (Addendum 3): notifications for the registration flow and
 * the broker bulk client import. The import uses the service client because it creates auth
 * users and profile/assignment rows for *other* people; callers MUST verify the broker
 * owner/admin role first (see customers/import/actions.ts).
 */
const adminUrl = () => (process.env.NEXT_PUBLIC_ADMIN_URL ?? "").replace(/\/$/, "");

/** Applicant confirmation + a heads-up to the partnerships / compliance staff. */
export async function notifyApplicationSubmitted(input: { id: string; type: "insurer" | "broker"; companyName: string; applicantUserId: string }) {
  await notify({
    userId: input.applicantUserId,
    kind: "partner.application.submitted",
    title: `We received your ${input.type} application for ${input.companyName}`,
    body: "Our partnerships team verifies the NIC licence and the documents, usually within 3 working days. We'll email you as soon as there is a decision or if anything needs changing.",
    link: "/partner/register/status",
    data: { application_id: input.id },
    channels: ["in_app", "email"],
  });
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    return;
  }
  const { data: platform } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
  if (!platform) return;
  await notifyOrg(
    platform.id,
    {
      kind: "partner.application.submitted",
      title: `New ${input.type} application: ${input.companyName}`,
      body: "Verify the NIC licence against the register, check the documents and approve, return or reject the application.",
      link: adminUrl() ? `${adminUrl()}/partners/applications/${input.id}` : `/partner/register/status`,
      data: { application_id: input.id, type: input.type },
      channels: ["in_app", "email"],
    },
    ["platform_admin", "platform_ops", "compliance"],
  );
}

// ---------------------------------------------------------------------------
// Broker bulk import of existing clients (Addendum 2 C5 / Addendum 3 C4)
// ---------------------------------------------------------------------------
export interface ImportOutcome {
  row: number;
  name: string;
  status: "created" | "linked" | "skipped";
  detail: string;
  customerId?: string;
  policyCreated?: boolean;
}
export interface ImportSummary {
  created: number;
  linked: number;
  skipped: number;
  policies: number;
  outcomes: ImportOutcome[];
}

type Svc = ReturnType<typeof createServiceClient>;

async function findExisting(svc: Svc, row: ClientImportRow): Promise<string | null> {
  if (row.email) {
    const { data } = await svc.from("profiles").select("id").eq("email", row.email).limit(1).maybeSingle();
    if (data) return data.id;
  }
  if (row.phone) {
    const { data } = await svc.from("profiles").select("id").eq("phone", row.phone).limit(1).maybeSingle();
    if (data) return data.id;
  }
  return null;
}

/**
 * Create an account for a client who has none: email → invitation (they set a password from the
 * link); phone only → user with a phone identity (signs in by OTP). The profiles row is created by
 * the auth trigger from the metadata.
 */
async function createAccount(svc: Svc, row: ClientImportRow, brokerName: string): Promise<{ id: string; how: string } | { error: string }> {
  const meta = { full_name: row.name, phone: row.phone, account_type: "individual", onboarded_by_broker: brokerName };
  if (row.email) {
    const invited = await svc.auth.admin.inviteUserByEmail(row.email, { data: meta });
    if (!invited.error && invited.data.user) return { id: invited.data.user.id, how: "invitation emailed" };
    if (invited.error && !/already|exists/i.test(invited.error.message)) {
      // Invitation delivery can fail (e.g. no SMTP configured): fall back to a plain user record.
      const created = await svc.auth.admin.createUser({ email: row.email, phone: row.phone, email_confirm: false, user_metadata: meta });
      if (created.error || !created.data.user) return { error: created.error?.message ?? "account could not be created" };
      return { id: created.data.user.id, how: "account created (invitation not sent)" };
    }
    return { error: invited.error?.message ?? "account could not be created" };
  }
  const created = await svc.auth.admin.createUser({ phone: row.phone, phone_confirm: true, user_metadata: meta });
  if (created.error || !created.data.user) return { error: created.error?.message ?? "account could not be created" };
  return { id: created.data.user.id, how: "account created for phone sign-in" };
}

/**
 * Import a broker's existing clients: find or create the customer, mark them assisted-service,
 * record the standing broker assignment (source broker_import, with an account manager) and
 * any external policy. Idempotent per customer: an existing active assignment with this broker
 * is kept; one with another broker makes the row a skip (customers choose their broker).
 */
export async function importBrokerClients(input: {
  brokerOrgId: string;
  brokerName: string;
  actorUserId: string;
  accountManagerId: string | null;
  rows: ClientImportRow[];
}): Promise<ImportSummary> {
  const svc = createServiceClient();
  const summary: ImportSummary = { created: 0, linked: 0, skipped: 0, policies: 0, outcomes: [] };
  const { data: cats } = await svc.from("product_categories").select("id, slug");
  const catBySlug = new Map((cats ?? []).map((c) => [c.slug, c.id]));
  const { data: insurers } = await svc.from("organizations").select("id, name").eq("type", "insurer").neq("status", "offboarded");
  const insurerByName = new Map((insurers ?? []).map((o) => [o.name.trim().toLowerCase(), o.id]));

  for (const row of input.rows) {
    const out: ImportOutcome = { row: row.row, name: row.name, status: "skipped", detail: "" };
    summary.outcomes.push(out);
    try {
      let customerId = await findExisting(svc, row);
      if (customerId) {
        out.status = "linked";
        out.detail = "existing Covva account";
      } else {
        const r = await createAccount(svc, row, input.brokerName);
        if ("error" in r) {
          out.detail = r.error;
          summary.skipped++;
          continue;
        }
        customerId = r.id;
        out.status = "created";
        out.detail = r.how;
      }
      out.customerId = customerId;

      // Standing relationship (one active assignment per customer).
      const { data: active } = await svc.from("customer_broker_assignments").select("id, broker_org_id").eq("customer_id", customerId).eq("active", true).maybeSingle();
      if (active && active.broker_org_id !== input.brokerOrgId) {
        out.status = "skipped";
        out.detail = "already assigned to another broker — the customer must choose to switch";
        summary.skipped++;
        continue;
      }
      if (!active) {
        const { error } = await svc.from("customer_broker_assignments").insert({
          customer_id: customerId,
          broker_org_id: input.brokerOrgId,
          source: "broker_import",
          active: true,
          account_manager_id: input.accountManagerId,
          created_by: input.actorUserId,
          note: `Imported from client list (row ${row.row})`,
        });
        if (error) throw error;
      } else if (input.accountManagerId) {
        await svc.from("customer_broker_assignments").update({ account_manager_id: input.accountManagerId }).eq("id", active.id);
      }
      await svc.from("profiles").update({ assisted_service: true }).eq("id", customerId);

      // External policy (bought elsewhere): keeps the renewal date so reminders and servicing work.
      if (row.policy_number && row.insurer_name && row.category_slug) {
        const categoryId = catBySlug.get(row.category_slug);
        if (!categoryId) {
          out.detail += `; policy skipped (unknown category "${row.category_slug}")`;
        } else {
          const insurerId = insurerByName.get(row.insurer_name.trim().toLowerCase()) ?? null;
          const { data: dup } = await svc.from("policies").select("id").eq("customer_id", customerId).eq("policy_number", row.policy_number).limit(1).maybeSingle();
          if (dup) out.detail += "; policy already on record";
          else {
            const { error } = await svc.from("policies").insert({
              customer_id: customerId,
              broker_org_id: input.brokerOrgId,
              insurer_org_id: insurerId,
              external_source: true,
              external_insurer_name: insurerId ? null : row.insurer_name,
              category_id: categoryId,
              policy_number: row.policy_number,
              status: row.cover_end && row.cover_end < new Date().toISOString().slice(0, 10) ? "expired" : "active",
              cover_end: row.cover_end ?? null,
              source: "broker",
              summary: `Imported by ${input.brokerName}`,
              insured_items: {} as Json,
            });
            if (error) out.detail += `; policy not created (${error.message})`;
            else {
              out.policyCreated = true;
              summary.policies++;
            }
          }
        }
      }
      if (out.status === "created") summary.created++;
      else summary.linked++;
    } catch (err) {
      out.status = "skipped";
      out.detail = err instanceof Error ? err.message : "failed";
      summary.skipped++;
      log.warn("import.row_failed", { row: row.row, err });
    }
  }
  return summary;
}
