import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { notify, sendSms, type NotifyInput } from "@/server/notify";
import { log, mask } from "@/server/log";

/**
 * Dual notifications (build prompt "DIASPORA"): every policy event reaches the **sponsor** who pays
 * for the cover AND the **beneficiary** it covers.
 *
 *  - sponsor / customer → `notify()` (in-app + push + email + SMS per their preferences), tagged
 *    `notifications.recipient_role`.
 *  - beneficiary with a Covva account (`beneficiaries.linked_user_id`) → `notify()` as well.
 *  - beneficiary without an account → SMS (WhatsApp first when the beneficiary consented on that
 *    channel and a provider is live), only when the sponsorship has `notify_beneficiary` on and the
 *    beneficiary gave data-sharing consent. No account means no in-app row; we log the delivery.
 *
 * Wired into: `onPolicyIssued` (server/policies.ts), the renewal-reminders cron (server/cron.ts) and
 * proxy claims (server/diaspora-claims.ts). **Claims stream:** call `notifyPolicyParties(policyId,
 * "claim.status", {...})` from your status-change path and both parties are covered; pass
 * `skipUserIds` for anyone you have already notified.
 */
export type PolicyNotificationKind = "policy.issued" | "renewal.reminder" | "document.issued" | "claim.reported" | "claim.status" | "payment.succeeded" | "payment.failed" | "policy.expired" | (string & {});

export interface PartyPayload {
  title: string;
  body?: string;
  /** Web path for the sponsor/customer (the beneficiary gets the same unless `beneficiaryLink` is set). */
  link?: string;
  beneficiaryLink?: string;
  data?: Record<string, unknown>;
  channels?: NotifyInput["channels"];
  /** Users already notified by the caller (avoid a second copy). */
  skipUserIds?: string[];
  /** Override the SMS text for an account-less beneficiary (default: title + body + link). */
  beneficiarySms?: string;
}

export interface PartyNotificationResult {
  sponsor: string | null;
  customer: string | null;
  beneficiary: { userId: string | null; phone: string | null; delivered: "in_app" | "sms" | "whatsapp" | "skipped"; reason?: string };
}

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_ENV === "production" ? "https://covva.com.gh" : "http://localhost:3000")).replace(/\/$/, "");

function absolute(link: string | undefined) {
  if (!link) return "";
  return /^https?:\/\//.test(link) ? link : `${siteUrl()}${link.startsWith("/") ? "" : "/"}${link}`;
}

async function tagRole(svc: ReturnType<typeof createServiceClient>, userId: string, kind: string, role: "sponsor" | "beneficiary" | "customer", marker: string) {
  // notify() inserts the row before deferring delivery, so the row exists by now; the marker in `data`
  // identifies this exact copy without touching notify.ts.
  await svc.from("notifications").update({ recipient_role: role }).eq("user_id", userId).eq("kind", kind).contains("data", { _party: marker } as Record<string, unknown>).is("recipient_role", null);
}

/** Object form of the call, used by the claims stream (`notifyClaimParties` → `notifyPolicyParties({...})`). */
export interface PartyNotificationInput extends PartyPayload {
  policyId: string;
  kind: PolicyNotificationKind;
  claimId?: string | null;
  /** Alias of `skipUserIds`. */
  excludeUserIds?: (string | null | undefined)[];
}

/**
 * Notify everyone with a stake in a policy. Safe when the policy has no sponsor/beneficiary (then it
 * behaves like a plain customer notification, or does nothing when `skipUserIds` covers the customer).
 *
 * Call as `notifyPolicyParties(policyId, kind, payload)` or `notifyPolicyParties({ policyId, kind, ...payload })`.
 */
export async function notifyPolicyParties(policyId: string, kind: PolicyNotificationKind, payload: PartyPayload): Promise<PartyNotificationResult>;
export async function notifyPolicyParties(input: PartyNotificationInput): Promise<PartyNotificationResult>;
export async function notifyPolicyParties(a: string | PartyNotificationInput, b?: PolicyNotificationKind, c?: PartyPayload): Promise<PartyNotificationResult> {
  if (typeof a === "object") {
    const { policyId: pid, kind: k, excludeUserIds, claimId, ...rest } = a;
    const skipUserIds = [...(rest.skipUserIds ?? []), ...((excludeUserIds ?? []).filter((x): x is string => typeof x === "string" && x.length > 0))];
    return notifyPolicyParties(pid, k, { ...rest, skipUserIds, data: { ...(rest.data ?? {}), ...(claimId ? { claim_id: claimId } : {}) } });
  }
  const policyId = a;
  const kind = b!;
  const payload = c ?? { title: kind };
  const out: PartyNotificationResult = { sponsor: null, customer: null, beneficiary: { userId: null, phone: null, delivered: "skipped" } };
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch (err) {
    log.warn("diaspora.notify.unconfigured", { err });
    return out;
  }
  const { data: policy } = await svc.from("policies").select("id, customer_id, sponsor_user_id, beneficiary_id, policy_number, internal_reference").eq("id", policyId).maybeSingle();
  if (!policy) return out;
  const skip = new Set(payload.skipUserIds ?? []);
  const marker = `${policyId}:${kind}:${Date.now()}`;
  const data = { ...(payload.data ?? {}), policy_id: policyId, _party: marker };
  const sent = new Set<string>();

  const sendTo = async (userId: string, role: "sponsor" | "beneficiary" | "customer", link?: string) => {
    if (skip.has(userId) || sent.has(userId)) return null;
    sent.add(userId);
    await notify({ userId, kind, title: payload.title, body: payload.body, link: link ?? payload.link, data: { ...data, recipient_role: role }, channels: payload.channels });
    await tagRole(svc, userId, kind, role, marker).catch(() => {});
    return userId;
  };

  // Customer of record (the sponsor when they bought it in their own name).
  const customerIsSponsor = !!policy.sponsor_user_id && policy.sponsor_user_id === policy.customer_id;
  out.customer = await sendTo(policy.customer_id, customerIsSponsor ? "sponsor" : "customer");
  if (policy.sponsor_user_id && !customerIsSponsor) out.sponsor = await sendTo(policy.sponsor_user_id, "sponsor");
  else if (customerIsSponsor) out.sponsor = out.customer;

  if (!policy.beneficiary_id) return out;
  const [{ data: beneficiary }, { data: sponsorship }] = await Promise.all([
    svc.from("beneficiaries").select("id, full_name, phone, linked_user_id, consent_status, consent_channel, sponsor_user_id").eq("id", policy.beneficiary_id).maybeSingle(),
    svc.from("sponsorships").select("id, notify_beneficiary, gift, gift_revealed_at").eq("policy_id", policyId).maybeSingle(),
  ]);
  if (!beneficiary) return out;
  out.beneficiary.phone = beneficiary.phone;
  out.beneficiary.userId = beneficiary.linked_user_id;

  if (sponsorship && sponsorship.notify_beneficiary === false) {
    out.beneficiary.reason = "sponsor_opted_out";
    return out;
  }
  if (beneficiary.consent_status !== "granted") {
    out.beneficiary.reason = "consent_not_granted";
    return out;
  }
  // An unrevealed gift stays a surprise: the beneficiary hears about it when the sponsor hands it over
  // (gift reveal), not from a system notification.
  if (sponsorship?.gift && !sponsorship.gift_revealed_at && kind === "policy.issued") {
    out.beneficiary.reason = "gift_not_revealed";
    return out;
  }

  if (beneficiary.linked_user_id) {
    // Linked account: in-app/push like any customer (the linked user is also the policy customer in many cases).
    const id = await sendTo(beneficiary.linked_user_id, "beneficiary", payload.beneficiaryLink);
    if (id || sent.has(beneficiary.linked_user_id)) {
      out.beneficiary.delivered = "in_app";
      return out;
    }
  }

  // No account: SMS / WhatsApp straight to the phone number the consent was captured on.
  const text = payload.beneficiarySms ?? [payload.title, payload.body, absolute(payload.beneficiaryLink ?? payload.link)].filter(Boolean).join(" ").slice(0, 320);
  let delivered: PartyNotificationResult["beneficiary"]["delivered"] = "skipped";
  if (beneficiary.consent_channel === "whatsapp") {
    try {
      const { sendWhatsApp, whatsAppLive } = await import("@/server/providers/whatsapp");
      const r = await sendWhatsApp({ to: beneficiary.phone, kind, title: payload.title, body: payload.body ?? null, link: absolute(payload.beneficiaryLink ?? payload.link) || null });
      if (r.ok && r.provider === "meta" && whatsAppLive()) delivered = "whatsapp";
    } catch (err) {
      log.warn("diaspora.notify.whatsapp_failed", { err });
    }
  }
  if (delivered === "skipped") {
    const r = await sendSms(beneficiary.phone, text);
    if (r.ok) delivered = "sms";
    else out.beneficiary.reason = "sms_failed";
  }
  out.beneficiary.delivered = delivered;
  log.info("diaspora.notify.beneficiary", { policyId, kind, to: mask(beneficiary.phone), delivered });
  return out;
}

/** Alias used by the claims and payments streams. */
export const notifyParties = notifyPolicyParties;
