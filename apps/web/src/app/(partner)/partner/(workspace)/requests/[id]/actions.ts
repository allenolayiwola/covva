"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { BrokerQuoteInput, REQUEST_STATUS, canTransitionRequest, riskFingerprint, type RequestStatus } from "@im/core";
import type { Enum } from "@im/db";
import { notify, notifyOrg } from "@/server/notify";
import { ROLES, actionContext, dbMessage, run, type ActionState, type PartnerContext } from "../../../_lib/context";

const uuid = z.string().uuid();
const fd = (formData: FormData) => Object.fromEntries(formData) as Record<string, string>;
const optional = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

/** Loads the request through RLS and confirms it belongs to the active broker org. */
async function loadRequest(ctx: PartnerContext, requestId: string) {
  const { data } = await ctx.supabase
    .from("requests")
    .select("id, reference, status, customer_id, category_id, broker_org_id, assigned_to, team, risk_data, risk_fingerprint, related_policy_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!data || data.broker_org_id !== ctx.orgId) throw new Error("not-found");
  return data;
}

function guard<T>(fn: (ctx: PartnerContext) => Promise<T>, roles = ROLES.brokerWork) {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles });
    try {
      return (await fn(ctx)) as ActionState;
    } catch (e) {
      if (e instanceof Error && e.message === "not-found") return { ok: false, error: "This request isn't in your organisation's queue." };
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------
export async function assignRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ requestId: uuid, assignee: z.string().optional(), team: z.string().max(60).optional() }).parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    const assignee = input.assignee ? uuid.parse(input.assignee) : null;
    if (!ctx.isSupervisor && assignee !== ctx.userId) {
      return { ok: false, error: "Only supervisors can assign work to colleagues. You can take ownership yourself." };
    }
    if (assignee) {
      const { data: m } = await ctx.supabase.from("memberships").select("user_id, team").eq("org_id", ctx.orgId).eq("user_id", assignee).eq("active", true).maybeSingle();
      if (!m) return { ok: false, error: "That person isn't an active member of your organisation." };
    }
    const team = input.team?.trim() || null;
    const { error } = await ctx.supabase.from("requests").update({ assigned_to: assignee, team }).eq("id", req.id);
    if (error) return { ok: false, error: dbMessage(error) };
    if (assignee && assignee !== ctx.userId) {
      await notify({ userId: assignee, kind: "request.assigned", title: `${req.reference} assigned to you`, link: `/partner/requests/${req.id}` });
    }
    refresh();
    return { ok: true, message: assignee ? "Owner updated." : "Request unassigned." };
  });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
export async function transitionRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z
      .object({ requestId: uuid, to: z.string(), note: z.string().max(2000).optional(), nextStep: z.string().max(300).optional(), share: z.string().optional() })
      .parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    const to = input.to as RequestStatus;
    if (!(to in REQUEST_STATUS) || !canTransitionRequest(req.status, to, "broker")) {
      return { ok: false, error: `A broker can't move a request from “${REQUEST_STATUS[req.status].label}” to “${REQUEST_STATUS[to]?.label ?? to}”.` };
    }
    if (to === "completed") {
      const { data: pol } = await ctx.supabase.from("policies").select("status").eq("request_id", req.id).eq("status", "active").limit(1);
      if (!pol?.length) return { ok: false, error: "Complete the request only after the insurer has issued the policy (status Active)." };
    }
    const nextStep = input.nextStep?.trim();
    const { error } = await ctx.supabase
      .from("requests")
      .update({ status: to, ...(nextStep ? { next_step: nextStep } : {}), ...(["submitted", "adviser_action", "insurer_response"].includes(to) ? { due_at: null } : {}) })
      .eq("id", req.id);
    if (error) return { ok: false, error: dbMessage(error, "We couldn't change the status.") };
    if (input.note?.trim()) {
      await ctx.supabase.from("request_events").insert({
        request_id: req.id,
        actor_id: ctx.userId,
        actor_party: "broker",
        event: "note",
        note: input.note.trim(),
        visible_to_customer: input.share === "on",
      });
    }
    await notify({
      userId: req.customer_id,
      kind: "request.status",
      title: `${req.reference}: ${REQUEST_STATUS[to].label}`,
      body: nextStep || REQUEST_STATUS[to].customerHint,
      link: `/account/requests/${req.id}`,
      data: { request_id: req.id, status: to },
    });
    refresh();
    return { ok: true, message: `Moved to ${REQUEST_STATUS[to].label}.` };
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
const DOC_KINDS = [
  "id_document", "vehicle_registration", "drivers_licence", "photo", "proof_of_address", "medical", "receipt", "police_report", "invoice", "other",
] as const;

export async function createTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z
      .object({
        requestId: uuid,
        kind: z.enum(["document", "information"]),
        title: z.string().trim().min(3, "Give the task a short title").max(160),
        detail: z.string().max(2000).optional(),
        documentKind: z.enum(DOC_KINDS).optional().or(z.literal("").transform(() => undefined)),
        due: z.string().optional(),
        wait: z.string().optional(),
      })
      .parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    const due = input.due ? new Date(`${input.due}T17:00:00Z`).toISOString() : new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { error } = await ctx.supabase.from("request_tasks").insert({
      request_id: req.id,
      kind: input.kind,
      title: input.title,
      detail: input.detail || null,
      document_kind: input.kind === "document" ? (input.documentKind ?? "other") : null,
      assignee_party: "customer",
      due_at: due,
      created_by: ctx.userId,
    });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't create the task.") };
    let moved = false;
    if (input.wait === "on" && req.status !== "awaiting_customer_info" && canTransitionRequest(req.status, "awaiting_customer_info", "broker")) {
      const { error: e2 } = await ctx.supabase.from("requests").update({ status: "awaiting_customer_info", next_step: input.title }).eq("id", req.id);
      moved = !e2;
    }
    await notify({
      userId: req.customer_id,
      kind: "request.task",
      title: input.kind === "document" ? `Your broker needs a document for ${req.reference}` : `Your broker has a question about ${req.reference}`,
      body: input.title,
      link: `/account/requests/${req.id}`,
      data: { request_id: req.id },
      channels: ["in_app", "email", "sms", "push"],
    });
    refresh();
    return { ok: true, message: `Sent to the customer${moved ? " and moved to Awaiting customer information" : ""}.` };
  });
}

export async function updateTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ taskId: uuid, requestId: uuid, status: z.enum(["done", "cancelled", "open"]) }).parse(fd(formData));
    await loadRequest(ctx, input.requestId);
    const { error } = await ctx.supabase
      .from("request_tasks")
      .update({ status: input.status, completed_at: input.status === "done" ? new Date().toISOString() : null, completed_by: input.status === "done" ? ctx.userId : null })
      .eq("id", input.taskId)
      .eq("request_id", input.requestId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Insurer submissions
// ---------------------------------------------------------------------------
export async function submitToInsurer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ requestId: uuid, insurerOrgId: uuid, move: z.string().optional() }).parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);

    const { data: appts } = await ctx.supabase
      .from("insurer_broker_appointments")
      .select("id, category_id")
      .eq("broker_org_id", ctx.orgId)
      .eq("insurer_org_id", input.insurerOrgId)
      .eq("active", true);
    if (!(appts ?? []).some((a) => a.category_id === null || a.category_id === req.category_id)) {
      return { ok: false, error: "Your organisation isn't appointed by this insurer for this category." };
    }
    const [{ data: insurer }, { data: category }] = await Promise.all([
      ctx.supabase.from("organizations").select("name, integration_level").eq("id", input.insurerOrgId).single(),
      ctx.supabase.from("product_categories").select("slug, default_sla_hours").eq("id", req.category_id).single(),
    ]);
    const fingerprint =
      req.risk_fingerprint ?? (await riskFingerprint({ customerId: req.customer_id, categorySlug: category?.slug ?? "", risk: (req.risk_data ?? {}) as Record<string, unknown> }));
    const now = Date.now();
    const { error } = await ctx.supabase.from("insurer_submissions").insert({
      request_id: req.id,
      insurer_org_id: input.insurerOrgId,
      broker_org_id: ctx.orgId,
      risk_fingerprint: fingerprint,
      channel: insurer?.integration_level ?? "portal",
      status: "sent",
      sent_at: new Date(now).toISOString(),
      response_due_at: new Date(now + (category?.default_sla_hours ?? 24) * 3_600_000).toISOString(),
      idempotency_key: `${req.id}:${input.insurerOrgId}:${now}`,
      submitted_by: ctx.userId,
    });
    if (error) {
      if (error.code === "23505") return { ok: false, error: `Already submitted to ${insurer?.name ?? "this insurer"}. The same risk can't be sent to the same insurer twice.` };
      return { ok: false, error: dbMessage(error, "We couldn't submit to the insurer.") };
    }
    if (input.move === "on" && req.status !== "insurer_response" && canTransitionRequest(req.status, "insurer_response", "broker")) {
      await ctx.supabase.from("requests").update({ status: "insurer_response", next_step: "Insurers are preparing quotations." }).eq("id", req.id);
    }
    await notifyOrg(input.insurerOrgId, {
      kind: "submission.new",
      title: `New submission ${req.reference} from ${ctx.orgName}`,
      link: `/partner/submissions`,
      data: { request_id: req.id },
    }, ["owner", "admin", "underwriter"]);
    refresh();
    return { ok: true, message: `Submitted to ${insurer?.name ?? "the insurer"}.` };
  });
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
export async function saveQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const raw = fd(formData);
    const parsed = BrokerQuoteInput.safeParse({
      requestId: raw.requestId,
      insurerOrgId: raw.insurerOrgId,
      productVersionId: optional(formData.get("productVersionId")),
      status: raw.status,
      premium: raw.premium,
      excess: optional(formData.get("excess")),
      sumInsured: optional(formData.get("sumInsured")),
      keyExclusion: optional(formData.get("keyExclusion")),
      validUntil: optional(formData.get("validUntil")),
      brokerNote: optional(formData.get("brokerNote")),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ") };
    const q = parsed.data;
    if (q.premium <= 0) return { ok: false, error: "Enter a premium greater than zero." };
    const req = await loadRequest(ctx, q.requestId);

    const { data: appts } = await ctx.supabase.from("insurer_broker_appointments").select("category_id").eq("broker_org_id", ctx.orgId).eq("insurer_org_id", q.insurerOrgId).eq("active", true);
    if (!(appts ?? []).some((a) => a.category_id === null || a.category_id === req.category_id)) {
      return { ok: false, error: "Choose an insurer that has appointed you for this category." };
    }

    let version: { id: string; product_id: string; coverage: unknown; limits: unknown; excesses: unknown; exclusions: string[]; key_exclusion: string | null; waiting_period_days: number; optional_benefits: unknown; conditions: string | null } | null = null;
    if (q.productVersionId) {
      const { data } = await ctx.supabase
        .from("product_versions")
        .select("id, product_id, coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions, product:products!product_versions_product_id_fkey(insurer_org_id)")
        .eq("id", q.productVersionId)
        .maybeSingle();
      const owner = (data?.product as unknown as { insurer_org_id: string } | null)?.insurer_org_id;
      if (!data || owner !== q.insurerOrgId) return { ok: false, error: "That product doesn't belong to the chosen insurer." };
      version = data;
    }
    const { data: sub } = await ctx.supabase
      .from("insurer_submissions")
      .select("id")
      .eq("request_id", req.id)
      .eq("insurer_org_id", q.insurerOrgId)
      .not("status", "in", "(declined,error,withdrawn)")
      .limit(1);

    const validUntil = q.validUntil ? new Date(`${q.validUntil}T23:59:00Z`).toISOString() : null;
    if (validUntil && Date.parse(validUntil) < Date.now()) return { ok: false, error: "Validity must be in the future." };

    const { error } = await ctx.supabase.from("quotes").insert({
      request_id: req.id,
      submission_id: sub?.[0]?.id ?? null,
      insurer_org_id: q.insurerOrgId,
      broker_org_id: ctx.orgId,
      product_id: version?.product_id ?? null,
      product_version_id: version?.id ?? null,
      status: q.status,
      premium: q.premium,
      excess: q.excess ?? null,
      sum_insured: q.sumInsured ?? null,
      key_exclusion: q.keyExclusion ?? version?.key_exclusion ?? null,
      valid_until: validUntil,
      broker_note: q.brokerNote ?? null,
      prepared_by: ctx.userId,
      ...(version
        ? {
            coverage: version.coverage as never,
            limits: version.limits as never,
            excesses: version.excesses as never,
            exclusions: version.exclusions,
            waiting_period_days: version.waiting_period_days,
            optional_benefits: version.optional_benefits as never,
            conditions: version.conditions,
          }
        : {}),
      commission_disclosure: "The broker of record may receive commission from the insurer. Ask your broker for details.",
    });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't save the quote.") };
    refresh();
    return { ok: true, message: q.status === "ready_to_accept" ? "Binding quote saved. Validity defaults to 14 days." : "Quote saved." };
  });
}

export async function setQuoteStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ quoteId: uuid, requestId: uuid, status: z.enum(["estimate", "awaiting_underwriting", "ready_to_accept", "withdrawn"]) }).parse(fd(formData));
    await loadRequest(ctx, input.requestId);
    const { data: quote } = await ctx.supabase.from("quotes").select("id, status, valid_until").eq("id", input.quoteId).eq("request_id", input.requestId).maybeSingle();
    if (!quote) return { ok: false, error: "Quote not found." };
    if (["accepted", "declined", "expired"].includes(quote.status)) return { ok: false, error: `This quote is ${quote.status} and can no longer change.` };
    const patch: { status: Enum<"quote_status">; valid_until?: string | null } = { status: input.status };
    if (input.status === "ready_to_accept" && quote.valid_until && Date.parse(quote.valid_until) < Date.now()) patch.valid_until = null; // trigger sets a fresh 14-day validity
    const { error } = await ctx.supabase.from("quotes").update(patch).eq("id", input.quoteId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true };
  });
}

export async function sendQuotesToCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ requestId: uuid, message: z.string().max(1000).optional() }).parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    const { data: live } = await ctx.supabase.from("quotes").select("id, status").eq("request_id", req.id).in("status", ["estimate", "awaiting_underwriting", "ready_to_accept"]);
    if (!live?.length) return { ok: false, error: "Prepare at least one quote before sending." };
    if (req.status !== "quotes_ready") {
      if (!canTransitionRequest(req.status, "quotes_ready", "broker")) {
        return { ok: false, error: `Quotes can't be sent while the request is “${REQUEST_STATUS[req.status].label}”.` };
      }
      const ready = live.filter((q) => q.status === "ready_to_accept").length;
      const { error } = await ctx.supabase
        .from("requests")
        .update({ status: "quotes_ready", next_step: ready ? "Compare your quotes and choose an option." : "Compare the estimates. Your broker will confirm binding prices." })
        .eq("id", req.id);
      if (error) return { ok: false, error: dbMessage(error) };
    }
    if (input.message?.trim()) {
      await ctx.supabase.from("request_messages").insert({ request_id: req.id, sender_id: ctx.userId, sender_party: "broker", body: input.message.trim() });
    }
    await notify({
      userId: req.customer_id,
      kind: "quote.ready",
      title: `Your quotes for ${req.reference} are ready to compare`,
      body: `${live.length} option${live.length === 1 ? "" : "s"} from participating insurers. Estimates are indicative; only “Ready to accept” quotes are binding.`,
      link: `/account/requests/${req.id}`,
      data: { request_id: req.id },
      channels: ["in_app", "email", "sms", "push"],
    });
    refresh();
    return { ok: true, message: "Quotes sent to the customer." };
  });
}

// ---------------------------------------------------------------------------
// Messages & documents
// ---------------------------------------------------------------------------
export async function sendMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ requestId: uuid, body: z.string().trim().min(1, "Write a message").max(4000), internal: z.string().optional() }).parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    const internal = input.internal === "on";
    const { error } = await ctx.supabase.from("request_messages").insert({
      request_id: req.id,
      sender_id: ctx.userId,
      sender_party: "broker",
      body: input.body,
      internal,
      read_by_broker_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't send the message.") };
    if (!internal) {
      await notify({ userId: req.customer_id, kind: "message.new", title: `New message from ${ctx.orgName} about ${req.reference}`, body: input.body.slice(0, 140), link: `/account/requests/${req.id}` });
    }
    refresh();
    return { ok: true };
  }, ["owner", "admin", "supervisor", "adviser"]);
}

export async function documentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ requestId: uuid, documentId: uuid, op: z.enum(["verify", "deliver"]) }).parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    const patch = input.op === "verify" ? { verified: true, verified_by: ctx.userId } : { delivered_to_insurer_at: new Date().toISOString() };
    const { error } = await ctx.supabase.from("documents").update(patch).eq("id", input.documentId).eq("request_id", req.id);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: input.op === "verify" ? "Marked as verified." : "Recorded as delivered to the insurer." };
  });
}

// ---------------------------------------------------------------------------
// Broker change (supervisors). The DB requires a `broker_change` disclosure, which only
// the customer can record (RLS), before broker_org_id may change.
// ---------------------------------------------------------------------------
export async function requestBrokerChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ requestId: uuid, targetOrgId: uuid, reason: z.string().trim().min(10, "Explain the reason to the customer (at least 10 characters)").max(1000) }).parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    if (input.targetOrgId === ctx.orgId) return { ok: false, error: "Choose a different broker." };
    const { data: target } = await ctx.supabase.from("organizations").select("id, name, nic_licence_number, type, status").eq("id", input.targetOrgId).maybeSingle();
    if (!target || target.type !== "broker" || target.status !== "active") return { ok: false, error: "Choose an active, licensed broker." };
    const { error } = await ctx.supabase.from("request_tasks").insert({
      request_id: req.id,
      kind: "review",
      title: `Confirm change of broker to ${target.name}`,
      detail: `${input.reason}\n\nInsurance broking services would be provided by ${target.name}${target.nic_licence_number ? `, NIC licence ${target.nic_licence_number}` : ""}. Your request does not move until you confirm.`,
      assignee_party: "customer",
      created_by: ctx.userId,
      due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    if (error) return { ok: false, error: dbMessage(error) };
    await ctx.supabase.from("request_events").insert({
      request_id: req.id,
      actor_id: ctx.userId,
      actor_party: "broker",
      event: "broker_change_proposed",
      note: `Proposed change of broker to ${target.name}: ${input.reason}`,
      visible_to_customer: true,
      data: { target_broker_org_id: target.id },
    });
    await notify({
      userId: req.customer_id,
      kind: "request.broker_change",
      title: `Please confirm a change of broker for ${req.reference}`,
      body: `${ctx.orgName} proposes ${target.name} as your broker of record. Nothing changes until you confirm.`,
      link: `/account/requests/${req.id}`,
      data: { request_id: req.id, target_broker_org_id: target.id },
    });
    refresh();
    return { ok: true, message: `Asked the customer to confirm ${target.name}. Once they acknowledge the disclosure you can complete the hand-over.` };
  }, ROLES.supervise);
}

export async function completeBrokerChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ requestId: uuid, targetOrgId: uuid }).parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    const { error } = await ctx.supabase.from("requests").update({ broker_org_id: input.targetOrgId, assigned_to: null, team: null }).eq("id", req.id);
    if (error) {
      if (error.code === "P0001") return { ok: false, error: error.message };
      return { ok: false, error: "The customer has confirmed, but your account can't hand the request to another organisation directly. Platform operations will complete the hand-over — contact platform support with the reference." };
    }
    await notifyOrg(input.targetOrgId, { kind: "request.handover", title: `${req.reference} handed over from ${ctx.orgName}`, link: `/partner/requests/${req.id}` });
    refresh();
    return { ok: true, message: "Hand-over complete." };
  }, ROLES.supervise);
}

// ---------------------------------------------------------------------------
// Fulfilment: deliver documents → completed (only once the insurer has issued)
// ---------------------------------------------------------------------------
export async function deliverPolicyDocuments(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guard(async (ctx) => {
    const input = z.object({ requestId: uuid }).parse(fd(formData));
    const req = await loadRequest(ctx, input.requestId);
    const { data: pol } = await ctx.supabase.from("policies").select("id, status, policy_number").eq("request_id", req.id).eq("status", "active").limit(1);
    if (!pol?.length) return { ok: false, error: "The insurer hasn't issued the policy yet. Cover isn't active until they do." };
    if (!canTransitionRequest(req.status, "completed", "broker")) return { ok: false, error: `The request is “${REQUEST_STATUS[req.status].label}”, so it can't be completed yet.` };
    const { error } = await ctx.supabase.from("requests").update({ status: "completed", next_step: "Your policy documents are in your wallet." }).eq("id", req.id);
    if (error) return { ok: false, error: dbMessage(error) };
    await notify({
      userId: req.customer_id,
      kind: "policy.delivered",
      title: `Your policy ${pol[0]!.policy_number ?? ""} documents are ready`,
      body: "Your schedule and certificate are in your policy wallet.",
      link: `/account/policies/${pol[0]!.id}`,
      data: { request_id: req.id, policy_id: pol[0]!.id },
      channels: ["in_app", "email", "sms", "push"],
    });
    refresh();
    return { ok: true, message: "Documents delivered and request completed." };
  });
}
