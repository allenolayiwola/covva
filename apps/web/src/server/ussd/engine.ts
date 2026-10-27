import "server-only";
import {
  POLICY_STATUS,
  USSD_MAX_LIST,
  formatDate,
  ghanaNetwork,
  normaliseMsisdn,
  normaliseNetwork,
  parseUssdHistory,
  phoneVariants,
  renderUssdScreen,
  routeUssd,
  stripDialExtension,
  ussdEnd,
  ussdMoney,
  ussdReference,
  type MessageKey,
  type MessageVars,
  type RatingRule,
  type UssdAction,
  type UssdContext,
  type UssdParams,
  type UssdReply,
  type UssdRoute,
  type UssdViewData,
} from "@im/core";
import type { Json } from "@im/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { translatorFor } from "@/lib/i18n/server";
import { log, mask } from "@/server/log";
import { notifyOrg, sendSms } from "@/server/notify";
import { quoteVersion } from "@/server/catalogue";
import { siteUrl } from "@/server/env";
import { fromTable, type UssdSessionRow } from "@/server/phase3-tables";
import type { UssdRequest } from "./types";

/**
 * USSD menu engine (provider-agnostic). One call per aggregator hop:
 *
 *   1. normalise the MSISDN; load or create the `ussd_sessions` row (customer matched by
 *      profiles.phone, a snapshot of their policies and due instalments kept in `state`);
 *   2. rebuild the input history (from the provider's `text`, or the stored history + the new
 *      input for one-input-at-a-time providers) and navigate with the pure `routeUssd`;
 *   3. a screen → CON with catalogue copy (≤ 160 chars); a terminal action → do it (SMS link,
 *      callback lead, MoMo prompt through the instalments / micro modules) and END.
 *
 * Prices on USSD are indicative (rating rules of approved products); the insurer confirms
 * before any payment. Payments never pass through Covva: MoMo prompts are created by the
 * instalments / micro modules with the insurer as payee.
 */
type Svc = ReturnType<typeof createServiceClient>;
type Tr = Awaited<ReturnType<typeof translatorFor>>;

interface PolicySnap {
  id: string;
  title: string;
  ref: string;
  status: string;
  coverStart: string | null;
  coverEnd: string | null;
  insurer: string | null;
  brokerOrgId: string | null;
  micro: boolean;
  premium: number | null;
}
interface InstalmentSnap {
  id: string;
  label: string;
  amount: number;
}
interface SessionState {
  history: string[];
  policies: PolicySnap[];
  instalments: InstalmentSnap[];
  name: string | null;
  /** Micro product picked when the price was shown (bought on "Buy now"). */
  microVersionId?: string | null;
}

const MOMO_NETWORK = { mtn: "mtn", telecel: "vod", airteltigo: "atl" } as const;

export async function handleUssd(req: UssdRequest): Promise<UssdReply> {
  const msisdn = normaliseMsisdn(req.msisdn);
  const fallbackTr = await translatorFor("en");
  if (!msisdn || !req.sessionId) return ussdEnd(fallbackTr("ussd.error"));
  let svc: Svc;
  try {
    svc = createServiceClient();
  } catch {
    log.error("ussd.no_service_client");
    return ussdEnd(fallbackTr("ussd.error"));
  }

  let session = await loadSession(svc, req.sessionId);
  if (req.isRelease) {
    if (session && !session.ended_at) await fromTable(svc, "ussd_sessions").update({ ended_at: new Date().toISOString(), end_reason: "released" }).eq("id", session.id);
    return ussdEnd("");
  }
  if (session?.ended_at) {
    // Some aggregators re-send the final hop; repeat a neutral END rather than re-running an action.
    return ussdEnd(fallbackTr("ussd.error"));
  }
  if (!session) {
    session = await createSession(svc, req, msisdn);
    if (!session) return ussdEnd(fallbackTr("ussd.error"));
  }
  const state = normaliseState(session.state);
  const tr = await translatorFor(session.locale);

  // History: full text from the provider, or our stored history plus the new input.
  let history: string[];
  if (req.text !== undefined && req.text !== null) {
    history = stripDialExtension(parseUssdHistory(req.text), process.env.USSD_DIAL_EXTENSION ?? null);
  } else {
    const input = (req.input ?? "").trim();
    history = req.isNew || !input ? state.history : [...state.history, input];
    if (req.isNew && input && !isServiceCodeEcho(input, req.serviceCode)) history = [input];
  }
  history = history.map((h) => h.slice(0, 40)).slice(-40);
  const ctx: UssdContext = { known: !!session.customer_id, policies: state.policies.length, instalments: state.instalments.length };
  const route = routeUssd(history, ctx);

  let reply: UssdReply;
  let step: string = route.node;
  let endReason: string | null = null;
  try {
    if (route.action) {
      step = `action:${route.action}`;
      endReason = route.action;
      reply = await perform(svc, route.action, route, { session, state, msisdn, tr });
    } else {
      const data = await viewData(svc, route, state);
      reply = renderUssdScreen(route, data, tr);
      if (data.microVersionId !== undefined) state.microVersionId = data.microVersionId;
    }
  } catch (err) {
    log.error("ussd.hop_failed", { sessionId: req.sessionId, provider: req.provider, step, err });
    reply = ussdEnd(tr("ussd.error"));
    endReason = "error";
  }

  const ended = reply.type === "END";
  await fromTable(svc, "ussd_sessions")
    .update({
      step,
      last_input: history[history.length - 1] ?? null,
      hops: session.hops + 1,
      state: { ...state, history } as unknown as Json,
      ...(ended ? { ended_at: new Date().toISOString(), end_reason: endReason ?? "end" } : {}),
    })
    .eq("id", session.id);
  log.info("ussd.hop", { provider: req.provider, sessionId: req.sessionId, msisdn: mask(msisdn), step, type: reply.type, chars: reply.text.length });
  return reply;
}

function isServiceCodeEcho(input: string, serviceCode?: string | null): boolean {
  return !!serviceCode && (input === serviceCode || input.startsWith("*"));
}

// ---------------------------------------------------------------------------
// Session + customer context
// ---------------------------------------------------------------------------
async function loadSession(svc: Svc, sessionId: string): Promise<UssdSessionRow | null> {
  const { data } = await fromTable(svc, "ussd_sessions").select("*").eq("session_id", sessionId.slice(0, 200)).maybeSingle();
  return (data as UssdSessionRow | null) ?? null;
}

function normaliseState(raw: unknown): SessionState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<SessionState>;
  return {
    history: Array.isArray(s.history) ? s.history.map(String) : [],
    policies: Array.isArray(s.policies) ? s.policies : [],
    instalments: Array.isArray(s.instalments) ? s.instalments : [],
    name: typeof s.name === "string" ? s.name : null,
    microVersionId: typeof s.microVersionId === "string" ? s.microVersionId : null,
  };
}

async function createSession(svc: Svc, req: UssdRequest, msisdn: string): Promise<UssdSessionRow | null> {
  const { data: profile } = await svc.from("profiles").select("id, full_name, preferred_name, locale").in("phone", phoneVariants(msisdn)).limit(1).maybeSingle();
  const state: SessionState = { history: [], policies: [], instalments: [], name: profile?.preferred_name ?? profile?.full_name ?? null };
  if (profile) {
    state.policies = await loadPolicies(svc, profile.id);
    state.instalments = await loadInstalments(profile.id);
  }
  const row = {
    session_id: req.sessionId.slice(0, 200),
    provider: req.provider,
    msisdn,
    network: normaliseNetwork(req.network, msisdn),
    service_code: req.serviceCode?.slice(0, 40) ?? process.env.USSD_SERVICE_CODE ?? null,
    customer_id: profile?.id ?? null,
    locale: "en", // USSD copy is English until approved translations exist for these keys
    state: state as unknown as Json,
  };
  const { data, error } = await fromTable(svc, "ussd_sessions").insert(row).select("*").single();
  if (error) {
    // Concurrent first hop (aggregator retry): read the winner.
    const again = await loadSession(svc, req.sessionId);
    if (again) return again;
    log.warn("ussd.session_insert_failed", { err: error });
    return null;
  }
  return data as UssdSessionRow;
}

async function loadPolicies(svc: Svc, userId: string): Promise<PolicySnap[]> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await svc
    .from("policies")
    .select("id, nickname, summary, policy_number, internal_reference, status, cover_start, cover_end, premium, broker_org_id, insured_items, category:product_categories(name), insurer:organizations!policies_insurer_org_id_fkey(name)")
    .eq("customer_id", userId)
    .in("status", ["active", "pending_issuance", "expired", "lapsed"])
    .order("cover_end", { ascending: true, nullsFirst: false })
    .limit(20);
  const rows = (data ?? []) as unknown as {
    id: string; nickname: string | null; summary: string | null; policy_number: string | null; internal_reference: string; status: string;
    cover_start: string | null; cover_end: string | null; premium: number | string | null; broker_org_id: string | null; insured_items: unknown;
    category: { name: string } | null; insurer: { name: string } | null;
  }[];
  // Micro flag lives on the instalments/micro builder's column; read it untyped when present.
  const microIds = new Set<string>();
  try {
    const { data: micro, error } = await (svc as unknown as SupabaseClient).from("policies").select("id").in("id", rows.map((r) => r.id)).eq("micro", true);
    if (!error) for (const m of (micro ?? []) as { id: string }[]) microIds.add(m.id);
  } catch {
    /* column not there yet */
  }
  return rows
    .filter((r) => r.status !== "expired" && r.status !== "lapsed" ? true : !r.cover_end || r.cover_end >= since)
    .slice(0, USSD_MAX_LIST)
    .map((r) => {
      const items = (r.insured_items && typeof r.insured_items === "object" ? r.insured_items : {}) as Record<string, unknown>;
      const reg = typeof items.registration_number === "string" ? ` ${items.registration_number}` : "";
      return {
        id: r.id,
        title: r.nickname ?? `${r.category?.name ?? "Policy"}${reg}`,
        ref: r.policy_number ?? r.internal_reference,
        status: r.status,
        coverStart: r.cover_start,
        coverEnd: r.cover_end,
        insurer: r.insurer?.name ?? null,
        brokerOrgId: r.broker_org_id,
        micro: microIds.has(r.id),
        premium: r.premium == null ? null : Number(r.premium),
      };
    });
}

/** Due instalments through the instalments module (Phase 3 builder) — absent module → none. */
async function loadInstalments(userId: string): Promise<InstalmentSnap[]> {
  try {
    const mod = (await import("@/server/instalments")) as unknown as { listSchedulesForUser?: (u: string) => Promise<{ status: string; policy: { internal_reference: string; policy_number: string | null } | null; instalments: { id: string; amount: number; status: string; due_at: string; seq: number }[] }[]> };
    if (typeof mod.listSchedulesForUser !== "function") return [];
    const schedules = await mod.listSchedulesForUser(userId);
    const due: (InstalmentSnap & { dueAt: string })[] = [];
    for (const s of schedules) {
      if (["cancelled", "completed", "lapsed"].includes(s.status)) continue;
      const next = s.instalments.filter((i) => i.status === "due" || i.status === "failed").sort((a, b) => a.seq - b.seq)[0];
      if (next && Date.parse(next.due_at) <= Date.now() + 7 * 86_400_000) {
        due.push({ id: next.id, amount: Number(next.amount), label: s.policy?.policy_number ?? s.policy?.internal_reference ?? "policy", dueAt: next.due_at });
      }
    }
    return due.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, USSD_MAX_LIST).map((d) => ({ id: d.id, label: d.label, amount: d.amount }));
  } catch (err) {
    log.warn("ussd.instalments_unavailable", { err });
    return [];
  }
}

// ---------------------------------------------------------------------------
// View data (indicative prices)
// ---------------------------------------------------------------------------
async function viewData(svc: Svc, route: UssdRoute, state: SessionState): Promise<UssdViewData & { microVersionId?: string | null }> {
  const base: UssdViewData & { microVersionId?: string | null } = {
    policies: state.policies.map((p) => ({ title: p.title, coverEnd: p.coverEnd, micro: p.micro, renewPrice: p.premium })),
    instalments: state.instalments,
  };
  if (route.node === "quote.motor.result") base.quotePrice = await indicativePrice(svc, "motor", motorRisk(route.params));
  if (route.node === "quote.funeral.result") {
    const annual = await indicativePrice(svc, "life-funeral", { cover_type: "funeral", persons: route.params.people ?? 1, number_of_people: route.params.people ?? 1 });
    base.quotePrice = annual ? Math.ceil(annual / 12) : null;
  }
  if (route.node === "quote.micro.result") {
    const micro = await microPrice(route.params.period ?? "day");
    base.quotePrice = micro?.amount ?? null;
    base.microVersionId = micro?.versionId ?? null;
  }
  return base;
}

function motorRisk(p: UssdParams): Record<string, unknown> {
  return {
    cover_type: "third_party",
    registration_number: p.registration,
    vehicle_use: p.vehicleUse === "commercial" ? "commercial" : "private",
    vehicle_type: p.vehicleUse === "motorbike" ? "motorcycle" : "car",
  };
}

/** Lowest indicative annual premium across approved products in a category (rating rules only). */
async function indicativePrice(svc: Svc, categorySlug: string, risk: Record<string, unknown>): Promise<number | null> {
  const { data: cat } = await svc.from("product_categories").select("id").eq("slug", categorySlug).maybeSingle();
  if (!cat) return null;
  const { data: products } = await svc
    .from("products")
    .select("id, version:product_versions!products_current_version_fk(id, status, rating)")
    .eq("category_id", cat.id)
    .eq("status", "approved")
    .limit(20);
  let best: number | null = null;
  for (const p of (products ?? []) as unknown as { version: { status: string; rating: unknown } | null }[]) {
    if (!p.version || p.version.status !== "approved" || !p.version.rating) continue;
    try {
      const r = await quoteVersion(svc, p.version.rating as RatingRule, risk);
      const price = r.ok && r.premium > 0 ? r.premium : minPremium(p.version.rating);
      if (price && (best == null || price < best)) best = price;
    } catch {
      const price = minPremium(p.version.rating);
      if (price && (best == null || price < best)) best = price;
    }
  }
  return best == null ? null : Math.round(best);
}

function minPremium(rating: unknown): number | null {
  const r = (rating ?? {}) as { min_premium?: unknown; amount?: unknown; model?: unknown };
  if (typeof r.min_premium === "number" && r.min_premium > 0) return r.min_premium;
  if (r.model === "flat" && typeof r.amount === "number" && r.amount > 0) return r.amount;
  return null;
}

async function microPrice(period: "day" | "week" | "month"): Promise<{ amount: number; versionId: string } | null> {
  try {
    const mod = (await import("@/server/micro")) as unknown as { listMicroProducts?: (c: Svc, a?: string | null) => Promise<{ versionId: string; byPeriod: Partial<Record<string, number>> }[]> };
    if (typeof mod.listMicroProducts !== "function") return null;
    const products = await mod.listMicroProducts(createServiceClient());
    const priced = products.map((p) => ({ versionId: p.versionId, amount: p.byPeriod[period] ?? 0 })).filter((p) => p.amount > 0).sort((a, b) => a.amount - b.amount);
    return priced[0] ?? null;
  } catch (err) {
    log.warn("ussd.micro_unavailable", { err });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Terminal actions
// ---------------------------------------------------------------------------
interface ActCtx {
  session: UssdSessionRow;
  state: SessionState;
  msisdn: string;
  tr: Tr;
}

async function perform(svc: Svc, action: UssdAction, route: UssdRoute, c: ActCtx): Promise<UssdReply> {
  const { tr } = c;
  const end = (key: MessageKey, vars?: MessageVars) => ussdEnd(tr(key, vars));
  const p = route.params;
  const policy = p.policyIndex != null ? c.state.policies[p.policyIndex] : undefined;
  const site = siteUrl();

  switch (action) {
    case "end.notFound":
      return end("ussd.notFound");
    case "end.renew.none":
      return end("ussd.renew.none");
    case "end.pay.none":
      return end("ussd.pay.none");
    case "end.check.none":
      return end("ussd.check.none");

    case "check.detail": {
      if (!policy) return end("ussd.check.none");
      const status = POLICY_STATUS[policy.status as keyof typeof POLICY_STATUS]?.label ?? policy.status;
      return end("ussd.check.detail", { policy: `${policy.title} ${policy.ref}`.slice(0, 50), status, end: policy.coverEnd ? formatDate(policy.coverEnd) : "—", insurer: policy.insurer ?? "—" });
    }

    case "quote.sms": {
      const product = p.product ?? "motor";
      const category = product === "motor" ? "motor" : product === "funeral" ? "life-funeral" : "micro";
      const qs = new URLSearchParams({ category, utm_source: "ussd" });
      if (p.registration) qs.set("reg", p.registration);
      if (p.people) qs.set("people", String(p.people));
      const link = product === "micro" ? `${site}/insurance/micro?utm_source=ussd` : `${site}/get-started?${qs.toString()}`;
      const productName = product === "motor" ? "motor third-party" : product === "funeral" ? "funeral cover" : "micro cover";
      await sendSms(c.msisdn, tr("sms.quote", { product: productName, link }));
      if (!c.session.customer_id) await createLead(svc, c, { category, message: `USSD quote link sent (${productName}${p.registration ? `, ${p.registration}` : ""}${p.people ? `, ${p.people} people` : ""}).`, topic: "quote_link" });
      return end("ussd.sms.sent");
    }

    case "quote.callback":
    case "talk.callback": {
      const ref = ussdReference("CB");
      const category = p.product === "motor" ? "motor" : p.product === "funeral" ? "life-funeral" : p.product === "micro" ? "micro" : null;
      await createLead(svc, c, { category, ref, topic: action === "quote.callback" ? "quote_callback" : "support_callback", message: action === "quote.callback" ? `Callback requested from USSD quote (${p.product ?? "quote"}${p.registration ? `, ${p.registration}` : ""}${p.people ? `, ${p.people} people` : ""}).` : "Callback requested from the USSD menu (Talk to us)." });
      await sendSms(c.msisdn, tr("sms.callback", { ref }));
      return end("ussd.callback.done", { ref });
    }

    case "claim.callback": {
      const ref = ussdReference("CL");
      await createLead(svc, c, {
        category: null,
        ref,
        topic: "claim_callback",
        message: `Claim callback requested by USSD${policy ? ` for policy ${policy.ref} (${policy.title})` : " (policy not listed)"}. Call back to take the claim details; reporting is not approval.`,
        policyId: policy?.id ?? null,
      });
      if (policy?.brokerOrgId) {
        await notifyOrg(policy.brokerOrgId, { kind: "ussd.claim_callback", title: `Claim callback ${ref}: ${policy.ref}`, body: `${c.state.name ?? "Your customer"} asked by USSD to report a claim on ${policy.ref}. Please call ${c.msisdn}.`, link: `/partner/policies/${policy.id}`, data: { policy_id: policy.id, ref }, channels: ["in_app", "email"] }, ["owner", "admin", "supervisor", "adviser"]).catch(() => {});
      }
      await sendSms(c.msisdn, tr("sms.callback", { ref }));
      return end("ussd.claim.done", { ref });
    }

    case "talk.sms": {
      const wa = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "—";
      await sendSms(c.msisdn, tr("sms.help", { whatsapp: wa, link: `${site}/support` }));
      return end("ussd.talk.sms");
    }

    case "micro.buy": {
      const versionId = c.state.microVersionId;
      if (c.session.customer_id && versionId) {
        try {
          const mod = (await import("@/server/micro")) as unknown as { buyMicroCover?: (customerId: string, versionId: string, period: "day" | "week" | "month", channel: "ussd", opts: Record<string, unknown>) => Promise<{ mode: string; amount: number | null }> };
          if (typeof mod.buyMicroCover === "function") {
            const res = await mod.buyMicroCover(c.session.customer_id, versionId, p.period ?? "day", "ussd", { payment: "mobile_money", momo: momo(c.msisdn) });
            if (res.mode === "instant" && res.amount) return end("ussd.pay.prompted", { amount: ussdMoney(res.amount) });
            // Routed to a broker / the insurer to quote: they call the customer back.
            const ref = ussdReference("CB");
            await createLead(svc, c, { category: "micro", ref, topic: "micro_routed", message: `Micro cover (${p.period ?? "day"}) requested by USSD; routed for a quote.` });
            return end("ussd.callback.done", { ref });
          }
        } catch (err) {
          log.warn("ussd.micro_buy_failed", { err });
        }
      }
      await sendSms(c.msisdn, tr("sms.quote", { product: "micro cover", link: `${site}/insurance/micro?utm_source=ussd` }));
      return end("ussd.sms.sent");
    }

    case "renew.primary":
    case "renew.secondary": {
      if (!policy) return end("ussd.renew.none");
      const microPay = policy.micro && action === "renew.primary";
      if (microPay && c.session.customer_id) {
        try {
          const mod = (await import("@/server/micro")) as unknown as { renewMicro?: (policyId: string, userId: string | null, opts: Record<string, unknown>) => Promise<{ amount: number; status: string }> };
          if (typeof mod.renewMicro === "function") {
            const res = await mod.renewMicro(policy.id, c.session.customer_id, { channel: "mobile_money", momo: momo(c.msisdn), sessionChannel: "ussd" });
            if (res.status === "link_sent") return end("ussd.pay.linkSent", { amount: ussdMoney(res.amount) });
            return end("ussd.pay.prompted", { amount: ussdMoney(res.amount) });
          }
        } catch (err) {
          log.warn("ussd.micro_renew_failed", { err });
        }
      }
      if (!policy.micro && action === "renew.secondary") {
        const ref = ussdReference("CB");
        await createLead(svc, c, { category: null, ref, topic: "renewal_callback", message: `Renewal callback requested by USSD for policy ${policy.ref} (${policy.title}).`, policyId: policy.id });
        if (policy.brokerOrgId) {
          await notifyOrg(policy.brokerOrgId, { kind: "ussd.renewal_callback", title: `Renewal callback ${ref}: ${policy.ref}`, body: `${c.state.name ?? "Your customer"} asked by USSD to renew ${policy.ref}. Please call ${c.msisdn}.`, link: `/partner/policies/${policy.id}`, data: { policy_id: policy.id, ref }, channels: ["in_app", "email"] }, ["owner", "admin", "supervisor", "adviser"]).catch(() => {});
        }
        await sendSms(c.msisdn, tr("sms.callback", { ref }));
        return end("ussd.callback.done", { ref });
      }
      await sendSms(c.msisdn, tr("sms.renew", { policy: policy.ref, link: `${site}/account/policies/${policy.id}/renew?utm_source=ussd` }));
      return end("ussd.sms.sent");
    }

    case "pay.momo":
    case "pay.link": {
      const inst = p.instalmentIndex != null ? c.state.instalments[p.instalmentIndex] : undefined;
      if (!inst || !c.session.customer_id) return end("ussd.pay.none");
      try {
        const mod = (await import("@/server/instalments")) as unknown as { payInstalment?: (id: string, userId: string | null, args: Record<string, unknown>) => Promise<{ status: string; amount: number }> };
        if (typeof mod.payInstalment === "function") {
          const res = await mod.payInstalment(inst.id, c.session.customer_id, action === "pay.momo" ? { channel: "mobile_money", momo: momo(c.msisdn) } : { channel: "link" });
          if (res.status === "link_sent" || action === "pay.link") return end("ussd.pay.linkSent", { amount: ussdMoney(res.amount || inst.amount) });
          return end("ussd.pay.prompted", { amount: ussdMoney(res.amount || inst.amount) });
        }
      } catch (err) {
        log.warn("ussd.instalment_pay_failed", { err });
      }
      await sendSms(c.msisdn, tr("sms.pay", { amount: ussdMoney(inst.amount), policy: inst.label, link: `${site}/account/payments/instalments?pay=${inst.id}` }));
      return end("ussd.pay.linkSent", { amount: ussdMoney(inst.amount) });
    }
  }
}

function momo(msisdn: string): { phone: string; network: "mtn" | "vod" | "atl" } | null {
  const net = ghanaNetwork(msisdn);
  if (net === "unknown") return null;
  return { phone: msisdn, network: MOMO_NETWORK[net] };
}

/** A lightweight lead (unknown callers, callbacks) + a ping to the support team. */
async function createLead(svc: Svc, c: ActCtx, l: { category: string | null; message: string; topic: string; ref?: string; policyId?: string | null }) {
  const { data: lead, error } = await svc
    .from("leads")
    .insert({
      kind: "customer",
      name: (c.state.name ?? "USSD caller").slice(0, 120),
      phone: c.msisdn,
      category_slug: l.category,
      message: `${l.ref ? `[${l.ref}] ` : ""}${l.message}`.slice(0, 2000),
      source_page: "ussd",
      utm: { source: "ussd", topic: l.topic, ref: l.ref ?? null, customer_id: c.session.customer_id, policy_id: l.policyId ?? null, session_id: c.session.session_id } as unknown as Json,
    })
    .select("id")
    .single();
  if (error) {
    log.warn("ussd.lead_failed", { err: error });
    return;
  }
  if (lead) await fromTable(svc, "ussd_sessions").update({ lead_id: lead.id }).eq("id", c.session.id);
  try {
    const { data: platform } = await svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
    if (platform) {
      await notifyOrg(
        platform.id,
        { kind: "ussd.callback", title: `USSD ${l.topic.replace(/_/g, " ")}${l.ref ? ` ${l.ref}` : ""}`, body: `${mask(c.msisdn)}: ${l.message}`.slice(0, 300), link: `${(process.env.NEXT_PUBLIC_ADMIN_URL ?? "").replace(/\/$/, "")}/leads`, data: { lead_id: lead?.id ?? null, ref: l.ref ?? null }, channels: ["in_app"] },
        ["platform_admin", "platform_ops", "support"],
      );
    }
  } catch {
    /* best effort */
  }
}
