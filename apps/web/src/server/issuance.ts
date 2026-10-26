import "server-only";
import {
  connectorFor,
  decideIssuanceMode,
  fitsDelegatedIssuance,
  formatDateTime,
  nicMotorRegistration,
  parseNicMotorDbMode,
  reviewWindowEnd,
  verifyUrl,
  type DocumentTemplate,
  type IssuanceJobStatus,
  type IssuanceMode,
  type UnderwritingRule,
} from "@im/core";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/server/env";
import { log } from "@/server/log";
import { notify, notifyOrg } from "@/server/notify";
import { renderPolicyPdf, type PdfContext, type PdfKind } from "@/server/pdf";
import { resolveTimer, startTimer } from "@/server/sla";
import { emitEvent } from "@/server/webhooks";

/**
 * Issuance engine (Addendum 2 A). Called once the paid policy row exists
 * (`applyPaymentResult` → `startIssuance`). Decides the mode from the insurer's line
 * integration and the underwriting rules, then:
 *   delegated      → allocates a number from the insurer's block, generates the documents,
 *                    activates cover and opens the insurer's review window (endorse / cancel);
 *   insurer_portal → the existing Level 1 queue (policy stays pending_issuance) with an SLA
 *                    timer; referred items carry the rule outcome for the underwriter;
 *   api            → queued for the insurer's adapter (simulator only for now).
 * Everything runs with the service client: issuance is a system action on the insurer's behalf
 * (the policies trigger trusts the service role), so callers never pass user input here.
 */
type Svc = ReturnType<typeof createServiceClient>;
export type IssuanceJob = Row<"issuance_jobs">;

export interface GeneratedDocument { kind: PdfKind; storage_path: string; sha256: string; generated_at: string; pages: number }

const DOC_KIND: Record<PdfKind, Row<"documents">["kind"]> = { schedule: "policy_schedule", certificate: "certificate", sticker: "sticker", receipt: "receipt" };
const DOC_NAME: Record<PdfKind, string> = { schedule: "Policy schedule.pdf", certificate: "Certificate of insurance.pdf", sticker: "Motor insurance sticker.pdf", receipt: "Premium receipt.pdf" };

const addYear = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

type PolicyFacts = Row<"policies"> & {
  insurer: Pick<Row<"organizations">, "id" | "name" | "nic_licence_number" | "contact_phone" | "contact_email" | "settings"> | null;
  category: Pick<Row<"product_categories">, "id" | "name" | "slug"> | null;
};

async function loadPolicy(svc: Svc, policyId: string): Promise<PolicyFacts | null> {
  const { data } = await svc
    .from("policies")
    .select("*, insurer:organizations!policies_insurer_org_id_fkey(id, name, nic_licence_number, contact_phone, contact_email, settings), category:product_categories!policies_category_id_fkey(id, name, slug)")
    .eq("id", policyId)
    .maybeSingle();
  return (data as unknown as PolicyFacts | null) ?? null;
}

async function upsertJob(svc: Svc, policy: PolicyFacts, patch: Partial<Row<"issuance_jobs">>): Promise<IssuanceJob> {
  const { data: existing } = await svc.from("issuance_jobs").select("*").eq("policy_id", policy.id).maybeSingle();
  if (existing) {
    const { data } = await svc.from("issuance_jobs").update(patch).eq("id", existing.id).select("*").single();
    return data ?? existing;
  }
  const { data, error } = await svc.from("issuance_jobs").insert({ policy_id: policy.id, request_id: policy.request_id, insurer_org_id: policy.insurer_org_id!, mode: "insurer_portal", status: "queued", ...patch }).select("*").single();
  if (error?.code === "23505") return (await svc.from("issuance_jobs").select("*").eq("policy_id", policy.id).single()).data!;
  if (error || !data) throw error ?? new Error("Could not create the issuance job");
  return data;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
async function approvedTemplates(svc: Svc, productVersionId: string | null): Promise<Map<PdfKind, DocumentTemplate>> {
  const out = new Map<PdfKind, DocumentTemplate>();
  if (!productVersionId) return out;
  const { data } = await svc.from("document_templates").select("kind, template, version").eq("product_version_id", productVersionId).eq("status", "approved").order("version", { ascending: false });
  for (const t of data ?? []) if (!out.has(t.kind as PdfKind)) out.set(t.kind as PdfKind, t.template as unknown as DocumentTemplate);
  return out;
}

/**
 * Renders schedule, certificate, receipt (and the motor sticker) for an active policy, stores
 * them in the private `documents` bucket (`policies/<policy_id>/<kind>.pdf`), records `documents`
 * rows for the wallet and returns the manifest (with SHA-256) kept on the issuance job.
 */
export async function generatePolicyDocuments(svc: Svc, policyId: string, opts: { kinds?: PdfKind[]; replace?: boolean } = {}): Promise<GeneratedDocument[]> {
  const policy = await loadPolicy(svc, policyId);
  if (!policy || !policy.insurer) throw new Error("Policy not found");
  if (!policy.policy_number) throw new Error("A policy number is required before documents can be generated");
  const [{ data: customer }, { data: payment }, { data: version }, { data: broker }, templates] = await Promise.all([
    svc.from("profiles").select("full_name, email, phone, region, city").eq("id", policy.customer_id).maybeSingle(),
    svc.from("payments").select("amount, currency, channel, provider_reference, paid_at").eq("policy_id", policy.id).eq("status", "succeeded").order("paid_at", { ascending: false }).limit(1).maybeSingle(),
    policy.product_version_id ? svc.from("product_versions").select("version, product:products!product_versions_product_id_fkey(name)").eq("id", policy.product_version_id).maybeSingle() : Promise.resolve({ data: null }),
    policy.broker_org_id ? svc.from("organizations").select("name, nic_licence_number").eq("id", policy.broker_org_id).maybeSingle() : Promise.resolve({ data: null }),
    approvedTemplates(svc, policy.product_version_id),
  ]);
  const insured = (policy.insured_items ?? {}) as { title?: string; risk?: Record<string, unknown> };
  const productName = (version?.product as unknown as { name: string } | null)?.name ?? policy.summary ?? policy.category?.name ?? "Insurance policy";
  const isMotor = policy.category?.slug === "motor";
  const kinds: PdfKind[] = opts.kinds ?? (isMotor ? ["schedule", "certificate", "sticker", "receipt"] : ["schedule", "certificate", "receipt"]);
  const url = verifyUrl(siteUrl(), policy.verification_code ?? policy.internal_reference);

  const base: Omit<PdfContext, "kind"> = {
    policy: { ...policy, premium: policy.premium, sum_insured: policy.sum_insured, excess: policy.excess },
    customer: { full_name: customer?.full_name ?? "Policyholder", email: customer?.email, phone: customer?.phone, address: [customer?.city, customer?.region].filter(Boolean).join(", ") || null },
    insurer: { name: policy.insurer.name, nic_licence_number: policy.insurer.nic_licence_number, contact_phone: policy.insurer.contact_phone, contact_email: policy.insurer.contact_email },
    product: { name: productName, version: version?.version ?? null },
    category: policy.category,
    risk: insured.risk ?? {},
    payment: payment ? { amount: payment.amount, currency: payment.currency, channel: payment.channel, provider_reference: payment.provider_reference, paid_at: payment.paid_at } : null,
    broker: broker ? { name: broker.name, nic_licence_number: broker.nic_licence_number } : null,
    verifyUrl: url,
  };

  const generated: GeneratedDocument[] = [];
  for (const kind of kinds) {
    if (kind === "receipt" && !payment) continue;
    const rendered = await renderPolicyPdf(kind, { ...base, kind, template: templates.get(kind) ?? null });
    const path = `policies/${policy.id}/${kind}.pdf`;
    const { error: upErr } = await svc.storage.from("documents").upload(path, rendered.bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`Could not store ${kind}: ${upErr.message}`);
    const row = {
      owner_id: policy.customer_id,
      uploaded_by: null,
      uploaded_by_party: "insurer" as const,
      policy_id: policy.id,
      request_id: policy.request_id,
      kind: DOC_KIND[kind],
      bucket: "documents",
      storage_path: path,
      file_name: DOC_NAME[kind],
      mime_type: "application/pdf",
      size_bytes: rendered.bytes.byteLength,
      checksum: rendered.sha256,
      verified: true,
    };
    const { data: existing } = await svc.from("documents").select("id").eq("storage_path", path).maybeSingle();
    const { error: docErr } = existing ? await svc.from("documents").update(row).eq("id", existing.id) : await svc.from("documents").insert(row);
    if (docErr) throw new Error(`Could not record ${kind}: ${docErr.message}`);
    generated.push({ kind, storage_path: path, sha256: rendered.sha256, generated_at: new Date().toISOString(), pages: rendered.pages });
  }
  return generated;
}

// ---------------------------------------------------------------------------
// NIC motor insurance database
// ---------------------------------------------------------------------------
/**
 * Registers a motor policy on the NIC motor insurance database (`NIC_MOTOR_DB_MODE`): `api`
 * through the insurer's connector when it has one, otherwise a manual hand-off that creates an
 * insurer task and tracks `issuance_jobs.nic_registration` until the insurer marks it registered.
 */
export async function registerMotorPolicy(svc: Svc, policy: PolicyFacts, job: IssuanceJob): Promise<Json> {
  if (policy.category?.slug !== "motor" || !policy.policy_number) return { status: "not_required" } as Json;
  const mode = parseNicMotorDbMode(process.env.NIC_MOTOR_DB_MODE);
  const settings = (policy.insurer?.settings ?? {}) as { connector?: string; connector_id?: string };
  const adapter = nicMotorRegistration(mode, connectorFor(settings.connector_id ?? settings.connector));
  const risk = ((policy.insured_items ?? {}) as { risk?: Record<string, unknown> }).risk ?? {};
  const result = await adapter.register({
    policyId: policy.id,
    policyNumber: policy.policy_number,
    insurerName: policy.insurer?.name ?? "",
    insurerNicLicence: policy.insurer?.nic_licence_number,
    vehicleRegistration: (risk.vehicle_registration ?? risk.registration_number ?? null) as string | null,
    chassisNumber: (risk.chassis_number ?? null) as string | null,
    coverStart: policy.cover_start ?? "",
    coverEnd: policy.cover_end ?? "",
    stickerNumber: policy.sticker_number,
  });
  let nic: Record<string, unknown>;
  if (!result.ok) {
    nic = { status: "failed", provider: adapter.provider, error: result.message, submitted_at: new Date().toISOString() };
  } else if (result.status === "registered") {
    nic = { status: "registered", reference: result.reference, provider: result.provider, submitted_at: result.submittedAt, registered_at: result.submittedAt };
    if (result.reference && !policy.sticker_number) await svc.from("policies").update({ sticker_number: result.reference }).eq("id", policy.id);
  } else {
    // Manual hand-off: the insurer registers it and ticks the task from the delegated-issuance queue.
    let taskId: string | null = null;
    if (policy.request_id) {
      const { data: task } = await svc
        .from("request_tasks")
        .insert({
          request_id: policy.request_id,
          kind: "information",
          title: `Register policy ${policy.policy_number} on the NIC motor insurance database`,
          detail: `Cover ${policy.cover_start ?? "?"} to ${policy.cover_end ?? "?"}${risk.vehicle_registration ? ` · vehicle ${risk.vehicle_registration}` : ""}. Record the NIC reference / sticker number in the delegated issuance queue.`,
          assignee_party: "insurer",
          status: "open",
          due_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        })
        .select("id")
        .single();
      taskId = task?.id ?? null;
    }
    nic = { status: "pending", reference: null, provider: result.provider, submitted_at: result.submittedAt, task_id: taskId };
  }
  await svc.from("issuance_jobs").update({ nic_registration: nic as Json }).eq("id", job.id);
  return nic as Json;
}

// ---------------------------------------------------------------------------
// startIssuance
// ---------------------------------------------------------------------------
export interface IssuanceResult { jobId: string; mode: IssuanceMode; status: IssuanceJobStatus; policyNumber?: string | null; reason: string }

export async function startIssuance(svc: Svc, policyId: string): Promise<IssuanceResult | null> {
  const policy = await loadPolicy(svc, policyId);
  if (!policy || !policy.insurer || policy.external_source) return null;
  if (policy.status !== "pending_issuance") {
    const { data: job } = await svc.from("issuance_jobs").select("id, mode, status").eq("policy_id", policy.id).maybeSingle();
    return job ? { jobId: job.id, mode: job.mode as IssuanceMode, status: job.status as IssuanceJobStatus, reason: "Policy is no longer awaiting issuance." } : null;
  }
  const { data: existing } = await svc.from("issuance_jobs").select("*").eq("policy_id", policy.id).maybeSingle();
  if (existing && !["queued", "failed"].includes(existing.status)) {
    return { jobId: existing.id, mode: existing.mode as IssuanceMode, status: existing.status as IssuanceJobStatus, reason: "Issuance already in progress." };
  }

  // Facts: the insurer's line integration, the product version's issuance type and its rules.
  const [{ data: line }, { data: version }, { data: rules }, { data: request }] = await Promise.all([
    svc.from("insurer_line_integrations").select("level, sla_hours, issuance_type, active").eq("insurer_org_id", policy.insurer_org_id!).eq("category_id", policy.category_id).maybeSingle(),
    policy.product_version_id ? svc.from("product_versions").select("issuance_type, sla_hours").eq("id", policy.product_version_id).maybeSingle() : Promise.resolve({ data: null }),
    policy.product_version_id ? svc.from("underwriting_rules").select("id, name, condition, outcome, message, priority, active").eq("product_version_id", policy.product_version_id) : Promise.resolve({ data: [] }),
    policy.request_id ? svc.from("requests").select("id, reference, broker_org_id, customer_id, risk_data").eq("id", policy.request_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const risk = ((policy.insured_items ?? {}) as { risk?: Record<string, unknown> }).risk ?? ((request?.risk_data ?? {}) as Record<string, unknown>);
  // The product version's issuance type wins when the insurer set one; a version left at the
  // default ("manual") falls back to the line integration's setting for this insurer × line.
  const issuanceType = version?.issuance_type && version.issuance_type !== "manual" ? version.issuance_type : (line?.issuance_type ?? version?.issuance_type ?? "manual");
  const outcome = fitsDelegatedIssuance((rules ?? []) as unknown as UnderwritingRule[], risk, issuanceType);
  const decision = decideIssuanceMode(line ? { level: line.level, slaHours: line.sla_hours, issuanceType, active: line.active } : null, outcome);
  const slaHours = version?.sla_hours && version.sla_hours > 0 ? Math.min(version.sla_hours, decision.slaHours) : decision.slaHours;
  const job = await upsertJob(svc, policy, {
    mode: decision.mode,
    status: decision.status,
    underwriting_outcome: { ...outcome, issuance_type: issuanceType, level: line?.level ?? "L1", decided_at: new Date().toISOString() } as unknown as Json,
    attempts: (existing?.attempts ?? 0) + 1,
    error: null,
  });
  const reference = request?.reference ?? policy.internal_reference;

  try {
    if (decision.mode === "delegated") {
      const r = await issueDelegated(svc, policy, job, slaHours, reference);
      return { jobId: job.id, mode: "delegated", status: r.status, policyNumber: r.policyNumber, reason: decision.reason };
    }
    if (decision.mode === "api") {
      const r = await issueViaApi(svc, policy, job, slaHours, reference);
      return { jobId: job.id, mode: "api", status: r.status, policyNumber: r.policyNumber, reason: decision.reason };
    }
    // Insurer portal (Level 1), including L2 referrals: SLA timer + expected time for the customer.
    const due = new Date(Date.now() + slaHours * 3_600_000);
    await startTimer(svc, { type: "issuance", id: policy.id }, due, { insurerOrgId: policy.insurer_org_id, brokerOrgId: policy.broker_org_id });
    if (policy.request_id) {
      await svc.from("requests").update({ next_step: `${decision.status === "referred" ? "The insurer is reviewing your application. " : ""}Expected to be issued by ${formatDateTime(due.toISOString())}.` }).eq("id", policy.request_id).in("status", ["policy_documents", "payment_confirmation"]);
      await svc.from("request_events").insert({
        request_id: policy.request_id,
        actor_party: "system",
        event: decision.status === "referred" ? "issuance_referred" : "issuance_queued",
        note: decision.status === "referred" ? `Referred to ${policy.insurer.name} for review (${outcome.reason}). Expected by ${formatDateTime(due.toISOString())}.` : `Awaiting issuance by ${policy.insurer.name}. Expected by ${formatDateTime(due.toISOString())}.`,
        visible_to_customer: true,
        data: { job_id: job.id, due_at: due.toISOString(), outcome: outcome.outcome } as Json,
      });
    }
    if (decision.status === "referred") {
      await notifyOrg(policy.insurer_org_id!, {
        kind: "issuance.referred",
        title: `Referred for review: ${reference}`,
        body: `${outcome.reason} Review and issue (or decline) in the issuance queue before ${formatDateTime(due.toISOString())}.`,
        link: "/partner/issuance?tab=delegated",
        data: { policy_id: policy.id, job_id: job.id },
        channels: ["in_app", "email", "push"],
      }, ["owner", "admin", "underwriter"]);
    }
    return { jobId: job.id, mode: "insurer_portal", status: decision.status, reason: decision.reason };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Issuance failed";
    log.error("issuance.failed", { policyId: policy.id, jobId: job.id, err });
    await svc.from("issuance_jobs").update({ status: "failed", error: message.slice(0, 1000) }).eq("id", job.id);
    // The policy stays pending: the insurer can still issue manually in the L1 queue.
    await startTimer(svc, { type: "issuance", id: policy.id }, new Date(Date.now() + slaHours * 3_600_000), { insurerOrgId: policy.insurer_org_id, brokerOrgId: policy.broker_org_id }).catch(() => null);
    return { jobId: job.id, mode: decision.mode, status: "failed", reason: message };
  }
}

async function activatePolicy(svc: Svc, policy: PolicyFacts, policyNumber: string, issuedBy: string | null = null): Promise<Row<"policies">> {
  const coverStart = policy.cover_start ?? new Date().toISOString().slice(0, 10);
  const coverEnd = policy.cover_end ?? addYear(coverStart);
  const { data, error } = await svc
    .from("policies")
    .update({ status: "active", policy_number: policyNumber, cover_start: coverStart, cover_end: coverEnd, issued_at: new Date().toISOString(), issued_by: issuedBy })
    .eq("id", policy.id)
    .eq("status", "pending_issuance")
    .select("*")
    .single();
  if (error?.code === "23505") throw new Error(`Policy number ${policyNumber} is already in use for this insurer`);
  if (error || !data) throw error ?? new Error("Could not activate the policy");
  if (policy.request_id && policy.quote_id) {
    await svc.from("applications").update({ status: "accepted", decided_at: new Date().toISOString(), decision_note: `Issued as ${policyNumber}` }).eq("request_id", policy.request_id).eq("quote_id", policy.quote_id).eq("status", "submitted");
  }
  return data;
}

async function finishIssued(svc: Svc, policyId: string) {
  const { onPolicyIssued } = await import("@/server/policies");
  await onPolicyIssued(policyId);
  await resolveTimer(svc, { type: "issuance", id: policyId });
}

async function issueDelegated(svc: Svc, policy: PolicyFacts, job: IssuanceJob, slaHours: number, reference: string): Promise<{ status: IssuanceJobStatus; policyNumber: string | null }> {
  const { data: number, error } = await svc.rpc("allocate_policy_number", { p_insurer: policy.insurer_org_id!, p_category: policy.category_id });
  if (error || !number) {
    // No usable block: refer to the insurer's L1 queue rather than fail silently.
    const reason = error?.message ?? "No policy number block";
    await svc.from("issuance_jobs").update({ mode: "insurer_portal", status: "referred", error: reason, underwriting_outcome: { ...(job.underwriting_outcome as Record<string, unknown>), referred_because: reason } as Json }).eq("id", job.id);
    const due = new Date(Date.now() + slaHours * 3_600_000);
    await startTimer(svc, { type: "issuance", id: policy.id }, due, { insurerOrgId: policy.insurer_org_id, brokerOrgId: policy.broker_org_id });
    await notifyOrg(policy.insurer_org_id!, { kind: "issuance.referred", title: `Delegated issuance needs a policy number block: ${reference}`, body: `${reason}. Add or top up a number block, or issue this policy manually.`, link: "/partner/issuance/number-blocks", data: { policy_id: policy.id } }, ["owner", "admin", "underwriter"]);
    return { status: "referred", policyNumber: null };
  }
  const active = await activatePolicy(svc, policy, number);
  const documents = await generatePolicyDocuments(svc, policy.id);
  const reviewUntil = reviewWindowEnd(new Date(active.issued_at ?? Date.now()), slaHours);
  await svc.from("issuance_jobs").update({ status: "review_window", review_until: reviewUntil.toISOString(), documents: documents as unknown as Json, error: null }).eq("id", job.id);
  const nic = await registerMotorPolicy(svc, { ...policy, ...active, insurer: policy.insurer, category: policy.category }, job);
  await finishIssued(svc, policy.id);
  if (policy.request_id) {
    await svc.from("request_events").insert({ request_id: policy.request_id, actor_party: "system", event: "issued_delegated", note: `Policy ${number} issued instantly on behalf of ${policy.insurer?.name}. Documents are in your wallet.`, visible_to_customer: true, data: { job_id: job.id, documents: documents.map((d) => d.kind), nic } as Json });
  }
  await notifyOrg(policy.insurer_org_id!, {
    kind: "issuance.delegated",
    title: `Issued on your behalf: ${number} (${reference})`,
    body: `Covva issued this policy under your delegated authority. You can endorse or cancel it until ${formatDateTime(reviewUntil.toISOString())}.${(nic as { status?: string }).status === "pending" ? " NIC motor database registration is waiting for you." : ""}`,
    link: "/partner/issuance?tab=delegated",
    data: { policy_id: policy.id, job_id: job.id, review_until: reviewUntil.toISOString() },
    channels: ["in_app", "email"],
  }, ["owner", "admin", "underwriter"]);
  await emitEvent(policy.insurer_org_id, "policy.issued", { policy_id: policy.id, policy_number: number, issued_by: "delegated", review_until: reviewUntil.toISOString(), documents: documents.map((d) => `${d.kind}:${d.sha256}`).join(",") });
  return { status: "review_window", policyNumber: number };
}

async function issueViaApi(svc: Svc, policy: PolicyFacts, job: IssuanceJob, slaHours: number, reference: string): Promise<{ status: IssuanceJobStatus; policyNumber: string | null }> {
  const settings = (policy.insurer?.settings ?? {}) as { connector?: string; connector_id?: string };
  const connector = connectorFor(settings.connector_id ?? settings.connector);
  const due = new Date(Date.now() + slaHours * 3_600_000);
  if (!connector) {
    // No adapter yet: stays queued for the adapter and the insurer's SLA timer runs meanwhile.
    await startTimer(svc, { type: "issuance", id: policy.id }, due, { insurerOrgId: policy.insurer_org_id, brokerOrgId: policy.broker_org_id });
    await svc.from("issuance_jobs").update({ status: "queued", error: "No API adapter configured for this insurer; waiting for the adapter or manual issuance." }).eq("id", job.id);
    return { status: "queued", policyNumber: null };
  }
  const { data: customer } = await svc.from("profiles").select("full_name, phone, email").eq("id", policy.customer_id).maybeSingle();
  const coverStart = policy.cover_start ?? new Date().toISOString().slice(0, 10);
  const risk = ((policy.insured_items ?? {}) as { risk?: Record<string, unknown> }).risk ?? {};
  const result = await connector.issue({ policyId: policy.id, externalReference: "", coverStart, coverEnd: policy.cover_end ?? addYear(coverStart), customer: { fullName: customer?.full_name ?? "Policyholder", phone: customer?.phone, email: customer?.email }, risk });
  if (!result.ok) {
    if (result.retryable) throw new Error(result.message);
    await svc.from("issuance_jobs").update({ status: "referred", mode: "insurer_portal", error: result.message }).eq("id", job.id);
    await startTimer(svc, { type: "issuance", id: policy.id }, due, { insurerOrgId: policy.insurer_org_id, brokerOrgId: policy.broker_org_id });
    await notifyOrg(policy.insurer_org_id!, { kind: "issuance.referred", title: `API issuance rejected: ${reference}`, body: `${result.message} Review in the issuance queue.`, link: "/partner/issuance", data: { policy_id: policy.id } }, ["owner", "admin", "underwriter"]);
    return { status: "referred", policyNumber: null };
  }
  const active = await activatePolicy(svc, policy, result.policyNumber);
  const documents = await generatePolicyDocuments(svc, policy.id);
  await svc.from("issuance_jobs").update({ status: "issued", documents: documents as unknown as Json, error: null }).eq("id", job.id);
  await registerMotorPolicy(svc, { ...policy, ...active, insurer: policy.insurer, category: policy.category }, job);
  await finishIssued(svc, policy.id);
  return { status: "issued", policyNumber: result.policyNumber };
}

/**
 * Level 1 follow-up: once the insurer has issued (entered the number), render the documents with
 * the QR code and close the job + SLA timer. Safe to call more than once; never throws.
 */
export async function afterInsurerIssued(policyId: string): Promise<GeneratedDocument[]> {
  let svc: Svc;
  try {
    svc = createServiceClient();
  } catch {
    return [];
  }
  try {
    const policy = await loadPolicy(svc, policyId);
    if (!policy || policy.status !== "active" || !policy.policy_number || policy.external_source) return [];
    const documents = await generatePolicyDocuments(svc, policy.id);
    const job = await upsertJob(svc, policy, { status: "issued", documents: documents as unknown as Json, error: null });
    await registerMotorPolicy(svc, policy, job);
    await resolveTimer(svc, { type: "issuance", id: policy.id });
    return documents;
  } catch (err) {
    log.error("issuance.after_insurer_issued_failed", { policyId, err });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Review window: endorse / cancel (insurer), expiry (cron), retry (admin/cron)
// ---------------------------------------------------------------------------
export async function endorseDelegatedPolicy(args: { insurerOrgId: string; policyId: string; notes: string; actorId: string | null; regenerate?: boolean }): Promise<void> {
  const svc = createServiceClient();
  const policy = await loadPolicy(svc, args.policyId);
  if (!policy || policy.insurer_org_id !== args.insurerOrgId) throw new Error("Policy not found.");
  const { data: job } = await svc.from("issuance_jobs").select("*").eq("policy_id", policy.id).maybeSingle();
  if (!job || !["review_window", "endorsed", "issued"].includes(job.status)) throw new Error("This policy is not in a review window.");
  let documents = (job.documents ?? []) as unknown as GeneratedDocument[];
  if (args.regenerate && policy.status === "active") documents = await generatePolicyDocuments(svc, policy.id);
  const notes = `${job.notes ? `${job.notes}\n` : ""}${new Date().toISOString().slice(0, 16).replace("T", " ")} — ${args.notes.trim()}`;
  await svc.from("issuance_jobs").update({ status: "endorsed", notes, documents: documents as unknown as Json }).eq("id", job.id);
  if (policy.request_id) {
    await svc.from("request_events").insert({ request_id: policy.request_id, actor_id: args.actorId, actor_party: "insurer", event: "policy_endorsed", note: `${policy.insurer?.name ?? "The insurer"} endorsed your policy: ${args.notes.trim()}`, visible_to_customer: true, data: { policy_id: policy.id } as Json });
  }
  await notify({ userId: policy.customer_id, kind: "policy.endorsed", title: `Your policy ${policy.policy_number ?? policy.internal_reference} was updated`, body: args.notes.trim(), link: `/account/policies/${policy.id}`, data: { policy_id: policy.id } });
}

export async function cancelDelegatedPolicy(args: { insurerOrgId: string; policyId: string; reason: string; actorId: string | null; insurerName?: string }): Promise<{ refund: string | null }> {
  const svc = createServiceClient();
  const policy = await loadPolicy(svc, args.policyId);
  if (!policy || policy.insurer_org_id !== args.insurerOrgId) throw new Error("Policy not found.");
  const { data: job } = await svc.from("issuance_jobs").select("*").eq("policy_id", policy.id).maybeSingle();
  if (!job || !["review_window", "endorsed"].includes(job.status)) throw new Error("This policy is outside its review window.");
  if (job.review_until && new Date(job.review_until) < new Date()) throw new Error("The review window has closed. Use an endorsement or a formal cancellation instead.");
  const reason = args.reason.trim();
  const { error } = await svc.from("policies").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: `Cancelled by the insurer within the delegated review window: ${reason}` }).eq("id", policy.id).eq("status", "active");
  if (error) throw new Error(error.message);
  let refund: string | null = null;
  const { data: payment } = await svc.from("payments").select("id, amount, currency").eq("policy_id", policy.id).eq("status", "succeeded").limit(1).maybeSingle();
  if (payment) {
    const { refundPayment } = await import("@/server/payments");
    refund = (await refundPayment(payment.id, `Insurer cancelled within the delegated review window: ${reason}`)).refund;
  }
  await svc.from("issuance_jobs").update({ status: "cancelled", notes: `${job.notes ? `${job.notes}\n` : ""}Cancelled: ${reason}` }).eq("id", job.id);
  if (policy.request_id) {
    await svc.from("requests").update({ status: "closed_no_cover", next_step: refund ? "The insurer withdrew the policy during its review. Your premium is being refunded." : "The insurer withdrew the policy during its review." }).eq("id", policy.request_id).in("status", ["completed", "policy_documents"]);
    await svc.from("request_events").insert({ request_id: policy.request_id, actor_id: args.actorId, actor_party: "insurer", event: "insurer_declined", note: `${args.insurerName ?? "The insurer"} cancelled the policy within its review window: ${reason}`, data: { policy_id: policy.id, refund } as Json });
  }
  await notify({
    userId: policy.customer_id,
    kind: "payment.refund",
    title: `Policy ${policy.policy_number ?? policy.internal_reference} was cancelled by the insurer`,
    body: `${reason}. ${payment ? `Your premium of ${payment.currency} ${Number(payment.amount).toFixed(2)} is being refunded.` : ""}`.trim(),
    link: policy.request_id ? `/account/requests/${policy.request_id}` : `/account/policies/${policy.id}`,
    data: { policy_id: policy.id },
    channels: ["in_app", "email", "sms", "push"],
  });
  if (policy.broker_org_id) await notifyOrg(policy.broker_org_id, { kind: "application.declined", title: `${args.insurerName ?? "Insurer"} cancelled ${policy.policy_number ?? policy.internal_reference} in its review window`, body: reason, link: policy.request_id ? `/partner/requests/${policy.request_id}` : "/partner/policies" });
  return { refund };
}

/** Insurer records the NIC motor database reference after a manual hand-off. */
export async function markMotorRegistered(args: { insurerOrgId: string; policyId: string; reference: string; actorId: string | null }): Promise<void> {
  const svc = createServiceClient();
  const policy = await loadPolicy(svc, args.policyId);
  if (!policy || policy.insurer_org_id !== args.insurerOrgId) throw new Error("Policy not found.");
  const { data: job } = await svc.from("issuance_jobs").select("id, nic_registration").eq("policy_id", policy.id).maybeSingle();
  if (!job) throw new Error("No issuance record for this policy.");
  const nic: Record<string, unknown> = { ...((job.nic_registration ?? {}) as Record<string, unknown>), status: "registered", reference: args.reference.trim(), registered_at: new Date().toISOString(), registered_by: args.actorId };
  await svc.from("issuance_jobs").update({ nic_registration: nic as Json }).eq("id", job.id);
  await svc.from("policies").update({ sticker_number: args.reference.trim() }).eq("id", policy.id);
  if (typeof nic.task_id === "string") await svc.from("request_tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: args.actorId }).eq("id", nic.task_id).eq("status", "open");
}

/** Cron: review windows that have passed → `issued` (the insurer did not endorse or cancel). */
export async function expireReviewWindows(svc: Svc): Promise<{ closed: number }> {
  const { data } = await svc.from("issuance_jobs").update({ status: "issued" }).eq("status", "review_window").lt("review_until", new Date().toISOString()).select("id");
  return { closed: data?.length ?? 0 };
}

/** Cron / admin retry: re-runs `startIssuance` for queued or failed jobs whose policy is still pending. */
export async function retryIssuanceJobs(svc: Svc, opts: { jobIds?: string[]; limit?: number } = {}): Promise<{ checked: number; retried: number; failed: number }> {
  let q = svc.from("issuance_jobs").select("id, policy_id, status, attempts, policy:policies!issuance_jobs_policy_id_fkey(status)").in("status", ["queued", "failed"]).lt("attempts", 10).order("updated_at").limit(opts.limit ?? 50);
  if (opts.jobIds?.length) q = q.in("id", opts.jobIds);
  const { data } = await q;
  let retried = 0;
  let failed = 0;
  for (const j of data ?? []) {
    if ((j.policy as unknown as { status: string } | null)?.status !== "pending_issuance") continue;
    try {
      const r = await startIssuance(svc, j.policy_id);
      if (r?.status === "failed") failed++;
      else retried++;
    } catch (err) {
      failed++;
      log.error("issuance.retry_failed", { jobId: j.id, err });
    }
  }
  return { checked: data?.length ?? 0, retried, failed };
}
