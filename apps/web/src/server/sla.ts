import "server-only";
import { formatDateTime, slaEscalationLevel, slaMilestones } from "@im/core";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { log } from "@/server/log";
import { notify, notifyOrg } from "@/server/notify";

/**
 * SLA timers with escalation (Addendum 2 A). One open timer per subject (request,
 * submission, issuance = a policy awaiting the insurer, claim). The cron `sla-monitor`
 * escalates: level 1 at due (insurer contacts), level 2 at due + 50% (Covva ops), level 3 =
 * final breach at 2× due (customer chooses refund or re-route, see `applySlaChoice`).
 * All writes use the service client: timers span organisations.
 */
type Svc = ReturnType<typeof createServiceClient>;
export type SlaSubjectType = Row<"sla_timers">["subject_type"];
export interface SlaSubject { type: SlaSubjectType; id: string }
export interface SlaParties { insurerOrgId?: string | null; brokerOrgId?: string | null }

export async function activeTimer(svc: Svc, subject: SlaSubject): Promise<Row<"sla_timers"> | null> {
  const { data } = await svc.from("sla_timers").select("*").eq("subject_type", subject.type).eq("subject_id", subject.id).is("resolved_at", null).maybeSingle();
  return data ?? null;
}

/** Starts (or returns the existing open) timer for a subject. */
export async function startTimer(svc: Svc, subject: SlaSubject, dueAt: Date, parties: SlaParties = {}, startedAt: Date = new Date()): Promise<Row<"sla_timers">> {
  const existing = await activeTimer(svc, subject);
  if (existing) return existing;
  const { data, error } = await svc
    .from("sla_timers")
    .insert({ subject_type: subject.type, subject_id: subject.id, insurer_org_id: parties.insurerOrgId ?? null, broker_org_id: parties.brokerOrgId ?? null, started_at: startedAt.toISOString(), due_at: dueAt.toISOString() })
    .select("*")
    .single();
  if (error?.code === "23505") return (await activeTimer(svc, subject))!;
  if (error || !data) throw error ?? new Error("Could not start the SLA timer");
  return data;
}

/** Resolves the open timer for a subject (no-op when none). */
export async function resolveTimer(svc: Svc, subject: SlaSubject): Promise<boolean> {
  const { data } = await svc.from("sla_timers").update({ resolved_at: new Date().toISOString() }).eq("subject_type", subject.type).eq("subject_id", subject.id).is("resolved_at", null).select("id");
  return !!data?.length;
}

interface SubjectContext {
  customerId: string | null;
  requestId: string | null;
  reference: string;
  insurerOrgId: string | null;
  brokerOrgId: string | null;
  /** The subject is finished: resolve the timer instead of escalating. */
  done: boolean;
  customerLink: string;
  partnerLink: string;
}

async function subjectContext(svc: Svc, t: Row<"sla_timers">): Promise<SubjectContext | null> {
  if (t.subject_type === "issuance") {
    const { data: p } = await svc.from("policies").select("id, status, customer_id, request_id, insurer_org_id, broker_org_id, internal_reference").eq("id", t.subject_id).maybeSingle();
    if (!p) return null;
    return { customerId: p.customer_id, requestId: p.request_id, reference: p.internal_reference, insurerOrgId: p.insurer_org_id, brokerOrgId: p.broker_org_id, done: p.status !== "pending_issuance", customerLink: p.request_id ? `/account/requests/${p.request_id}` : `/account/policies/${p.id}`, partnerLink: "/partner/issuance" };
  }
  if (t.subject_type === "submission") {
    const { data: s } = await svc.from("insurer_submissions").select("id, status, request_id, insurer_org_id, broker_org_id, request:requests!insurer_submissions_request_id_fkey(reference, customer_id, status)").eq("id", t.subject_id).maybeSingle();
    if (!s) return null;
    const r = s.request as unknown as { reference: string; customer_id: string; status: string } | null;
    return { customerId: r?.customer_id ?? null, requestId: s.request_id, reference: r?.reference ?? s.id, insurerOrgId: s.insurer_org_id, brokerOrgId: s.broker_org_id, done: !["pending", "sent", "acknowledged"].includes(s.status) || ["completed", "cancelled", "closed_no_cover"].includes(r?.status ?? ""), customerLink: `/account/requests/${s.request_id}`, partnerLink: `/partner/submissions/${s.id}` };
  }
  if (t.subject_type === "claim") {
    const { data: c } = await svc.from("claims").select("id, status, customer_id, insurer_org_id, broker_org_id, reference").eq("id", t.subject_id).maybeSingle();
    if (!c) return null;
    return { customerId: c.customer_id, requestId: null, reference: c.reference, insurerOrgId: c.insurer_org_id, brokerOrgId: c.broker_org_id, done: ["approved", "partially_approved", "rejected", "paid", "closed", "withdrawn"].includes(c.status), customerLink: `/account/claims/${c.id}`, partnerLink: `/partner/claims/${c.id}` };
  }
  const { data: r } = await svc.from("requests").select("id, status, customer_id, broker_org_id, reference").eq("id", t.subject_id).maybeSingle();
  if (!r) return null;
  return { customerId: r.customer_id, requestId: r.id, reference: r.reference, insurerOrgId: t.insurer_org_id, brokerOrgId: r.broker_org_id, done: ["completed", "cancelled", "closed_no_cover"].includes(r.status), customerLink: `/account/requests/${r.id}`, partnerLink: `/partner/requests/${r.id}` };
}

async function platformOrgId(svc: Svc): Promise<string | null> {
  const { data } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * Cron: escalates every open timer that is past due. Idempotent — each level notifies once
 * (escalation_level only moves up) and finished subjects resolve their timer.
 */
export async function escalateTimers(svc: Svc, limit = 500): Promise<{ checked: number; escalated: number; breached: number; resolved: number }> {
  const now = new Date();
  const { data: due } = await svc.from("sla_timers").select("*").is("resolved_at", null).lt("due_at", now.toISOString()).order("due_at").limit(limit);
  let escalated = 0;
  let breached = 0;
  let resolved = 0;
  const platform = await platformOrgId(svc);
  for (const t of due ?? []) {
    try {
      const ctx = await subjectContext(svc, t);
      if (!ctx || ctx.done) {
        await svc.from("sla_timers").update({ resolved_at: now.toISOString() }).eq("id", t.id);
        resolved++;
        continue;
      }
      const level = slaEscalationLevel(new Date(t.started_at), new Date(t.due_at), now);
      if (level <= t.escalation_level) continue;
      const milestones = slaMilestones(new Date(t.started_at), new Date(t.due_at));
      const patch: Partial<Row<"sla_timers">> = { escalation_level: level, last_notified_at: now.toISOString(), escalated_at: t.escalated_at ?? now.toISOString() };
      if (level >= 3) patch.breached_at = t.breached_at ?? now.toISOString();
      const { data: claimed } = await svc.from("sla_timers").update(patch).eq("id", t.id).lt("escalation_level", level).select("id");
      if (!claimed?.length) continue;
      escalated++;
      const subject = `${t.subject_type.replace(/_/g, " ")} ${ctx.reference}`;
      const insurerOrg = ctx.insurerOrgId ?? t.insurer_org_id;
      const brokerOrg = ctx.brokerOrgId ?? t.broker_org_id;

      // Level 1 (and every later level): the insurer's contacts, or the broker when there is no insurer.
      const partnerMsg = {
        kind: "sla.escalated",
        title: level >= 3 ? `Final SLA breach: ${subject}` : level === 2 ? `Overdue and escalated to Covva: ${subject}` : `Overdue: ${subject}`,
        body: level >= 3 ? `The service level was missed twice over (due ${formatDateTime(t.due_at)}). The customer can now choose a refund or another insurer.` : `Due ${formatDateTime(t.due_at)}. ${level === 2 ? `Covva operations have been told. Final breach at ${formatDateTime(milestones.finalAt.toISOString())}.` : `Escalates to Covva operations at ${formatDateTime(milestones.opsAt.toISOString())}.`}`,
        link: ctx.partnerLink,
        data: { timer_id: t.id, subject_type: t.subject_type, subject_id: t.subject_id, level, request_id: ctx.requestId },
        channels: ["in_app", "email", "push"] as ("in_app" | "email" | "push")[],
      };
      if (insurerOrg) await notifyOrg(insurerOrg, partnerMsg, ["owner", "admin", "underwriter"]);
      else if (brokerOrg) await notifyOrg(brokerOrg, partnerMsg, ["owner", "admin", "supervisor"]);
      if (level >= 2 && platform) {
        await notifyOrg(platform, { ...partnerMsg, link: ctx.requestId ? `/requests/${ctx.requestId}` : "/issuance" }, ["platform_admin", "platform_ops"]);
      }
      if (ctx.requestId) {
        await svc.from("request_events").insert({
          request_id: ctx.requestId,
          actor_party: "system",
          event: level >= 3 ? "sla_final_breach" : "sla_escalated",
          note: level >= 3 ? "The insurer missed the agreed service level. You can choose a refund or let us find another insurer." : `Service level missed (level ${level}); escalated to ${level === 2 ? "Covva operations" : "the insurer"}.`,
          visible_to_customer: level >= 3,
          data: { timer_id: t.id, level, due_at: t.due_at, subject_type: t.subject_type, subject_id: t.subject_id } as Json,
        });
      }
      if (level >= 3) {
        breached++;
        if (ctx.customerId) {
          await notify({
            userId: ctx.customerId,
            kind: "request.action_required",
            title: `${ctx.reference}: choose a refund or another insurer`,
            body: "The insurer did not issue within the agreed time. You can get an automatic refund of your premium, or we can find another insurer or broker for you.",
            link: ctx.customerLink,
            data: { request_id: ctx.requestId, timer_id: t.id },
            channels: ["in_app", "email", "sms", "push"],
          });
        }
        if (ctx.requestId) {
          await svc.from("requests").update({ next_step: "The insurer missed the agreed service level. Choose a refund, or let us find another insurer." }).eq("id", ctx.requestId).not("status", "in", "(completed,cancelled,closed_no_cover)");
        }
      }
    } catch (err) {
      log.error("sla.escalate_failed", { timerId: t.id, err });
    }
  }
  return { checked: due?.length ?? 0, escalated, breached, resolved };
}

/** Breached (level 3, unresolved) timer for a request or its pending policy, for the customer choice. */
export async function breachedTimerForRequest(svc: Pick<Svc, "from">, requestId: string, policyIds: string[] = []): Promise<Row<"sla_timers"> | null> {
  let q = svc.from("sla_timers").select("*").is("resolved_at", null).eq("escalation_level", 3);
  q = policyIds.length ? q.or(`and(subject_type.eq.request,subject_id.eq.${requestId}),and(subject_type.eq.issuance,subject_id.in.(${policyIds.join(",")}))`) : q.eq("subject_type", "request").eq("subject_id", requestId);
  const { data } = await q.order("breached_at", { ascending: true }).limit(1).maybeSingle();
  return data ?? null;
}

/**
 * Customer's choice after a final breach (Addendum 2 A): `refund` refunds the premium, cancels the
 * pending policy and closes the request; `reroute` does the same refund and re-runs routing with
 * the breached insurer excluded so other insurers/brokers can quote. The caller has verified the
 * customer owns the request.
 */
export async function applySlaChoice(requestId: string, choice: "refund" | "reroute", actorId: string | null): Promise<{ refunded: boolean; rerouted: boolean; mode?: string }> {
  const svc = createServiceClient();
  const { data: req } = await svc.from("requests").select("id, reference, status, title, customer_id, category_id, risk_data, broker_org_id, talk_to_expert, sla_choice").eq("id", requestId).maybeSingle();
  if (!req) throw new Error("Request not found");
  if (["completed", "cancelled", "closed_no_cover"].includes(req.status)) throw new Error("This request is already closed.");
  const { data: pending } = await svc.from("policies").select("id, insurer_org_id, status").eq("request_id", req.id).eq("status", "pending_issuance");
  const policyIds = (pending ?? []).map((p) => p.id);
  const timer = await breachedTimerForRequest(svc, req.id, policyIds);
  if (!timer) throw new Error("There is no breached service level on this request.");
  const breachedInsurer = timer.insurer_org_id ?? pending?.[0]?.insurer_org_id ?? null;

  // 1. Refund the confirmed premium (both choices: the money went to the insurer that missed the SLA).
  let refunded = false;
  const { data: payment } = await svc.from("payments").select("id").eq("request_id", req.id).eq("status", "succeeded").order("paid_at", { ascending: false }).limit(1).maybeSingle();
  if (payment) {
    const { refundPayment } = await import("@/server/payments");
    const r = await refundPayment(payment.id, `Service level breached by the insurer; customer chose ${choice}`);
    refunded = !!r;
  }
  // 2. Cancel pending policies and resolve the timer.
  for (const p of pending ?? []) {
    await svc.from("policies").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: "Insurer missed the issuance service level; cancelled at the customer's request" }).eq("id", p.id).eq("status", "pending_issuance");
    await svc.from("issuance_jobs").update({ status: "cancelled", error: "SLA breached; customer chose " + choice }).eq("policy_id", p.id);
    await resolveTimer(svc, { type: "issuance", id: p.id });
  }
  await svc.from("sla_timers").update({ resolved_at: new Date().toISOString() }).eq("id", timer.id);
  await svc.from("applications").update({ status: "withdrawn", decided_at: new Date().toISOString(), decision_note: "Withdrawn after the insurer missed the service level" }).eq("request_id", req.id).in("status", ["submitted", "accepted"]);

  let rerouted = false;
  let mode: string | undefined;
  if (choice === "reroute") {
    const { routeNewRequest } = await import("@/server/routing");
    const result = await routeNewRequest(svc, { id: req.id, reference: req.reference, customer_id: req.customer_id, category_id: req.category_id, risk_data: req.risk_data, title: req.title, talk_to_expert: req.talk_to_expert }, { excludeInsurerIds: breachedInsurer ? [breachedInsurer] : [] });
    rerouted = true;
    mode = result.mode;
    const nextStep = result.mode === "insurer_direct" ? "Another insurer is preparing your quote." : result.mode === "ops_hold" ? "Our team is finding the right broker for your request." : result.brokerOrgId ? "Your broker is finding you alternative quotes." : "We are finding you a licensed broker. The first to accept becomes your broker of record.";
    await svc.from("requests").update({ status: result.mode === "insurer_direct" ? "insurer_response" : result.brokerOrgId ? "adviser_action" : "submitted", next_step: nextStep, sla_choice: "reroute", sla_choice_at: new Date().toISOString(), sla_breached_at: null, due_at: null }).eq("id", req.id);
  } else {
    await svc.from("requests").update({ status: "closed_no_cover", next_step: refunded ? "Your premium is being refunded to the payment method you used." : "No cover was arranged.", sla_choice: "refund", sla_choice_at: new Date().toISOString() }).eq("id", req.id);
  }
  await svc.from("request_events").insert({
    request_id: req.id,
    actor_id: actorId,
    actor_party: "customer",
    event: "sla_choice",
    note: choice === "refund" ? "You chose a refund after the insurer missed the service level." : "You asked us to find another insurer after the service level was missed.",
    data: { choice, timer_id: timer.id, refunded, rerouted, excluded_insurer_org_id: breachedInsurer } as Json,
  });
  if (breachedInsurer) {
    await notifyOrg(breachedInsurer, { kind: "sla.customer_choice", title: `${req.reference}: customer chose ${choice === "refund" ? "a refund" : "another insurer"} after the SLA breach`, body: "The premium is being refunded and the pending policy has been cancelled.", link: "/partner/issuance", data: { request_id: req.id } }, ["owner", "admin", "underwriter"]);
  }
  return { refunded, rerouted, mode };
}
