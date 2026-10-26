import type { Enum } from "@im/db";

export type Tone = "ok" | "wait" | "neutral" | "danger" | "info";
export interface StatusMeta { label: string; tone: Tone; customerHint?: string }

export type RequestStatus = Enum<"request_status">;
export type QuoteStatus = Enum<"quote_status">;
export type PolicyStatus = Enum<"policy_status">;
export type ClaimStatus = Enum<"claim_status">;
export type ComplaintStatus = Enum<"complaint_status">;
export type PaymentStatus = Enum<"payment_status">;
export type CategoryAvailability = Enum<"category_availability">;
export type Party = Enum<"party">;

/** Request statuses as shown in the broker queue and customer tracker. */
export const REQUEST_STATUS: Record<RequestStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral", customerHint: "Finish your request to send it to your broker." },
  submitted: { label: "Received", tone: "info", customerHint: "Your request has been received and assigned to your broker." },
  awaiting_customer_info: { label: "Awaiting your information", tone: "wait", customerHint: "Your broker needs something from you to continue." },
  adviser_action: { label: "With your adviser", tone: "info", customerHint: "Your adviser is reviewing your needs." },
  insurer_response: { label: "Awaiting insurers", tone: "info", customerHint: "Insurers are preparing quotations. Timing is confirmed by your broker." },
  quotes_ready: { label: "Quotes ready", tone: "ok", customerHint: "Compare your quotes and choose an option." },
  payment_confirmation: { label: "Awaiting payment confirmation", tone: "wait", customerHint: "We are waiting for the payment provider to confirm your payment." },
  policy_documents: { label: "Awaiting insurer issuance", tone: "wait", customerHint: "Payment received. Your cover starts once the insurer confirms acceptance and issues documents." },
  completed: { label: "Completed", tone: "ok", customerHint: "Your policy documents are in your wallet." },
  cancelled: { label: "Cancelled", tone: "neutral" },
  closed_no_cover: { label: "Closed — no cover arranged", tone: "neutral" },
};

/** Broker queue buckets from the proposal: what the request is waiting on. */
export const QUEUE_BUCKETS: { key: string; label: string; statuses: RequestStatus[] }[] = [
  { key: "new", label: "New requests", statuses: ["submitted"] },
  { key: "customer", label: "Awaiting customer information", statuses: ["awaiting_customer_info"] },
  { key: "adviser", label: "Adviser action", statuses: ["adviser_action"] },
  { key: "insurer", label: "Insurer response", statuses: ["insurer_response"] },
  { key: "payment", label: "Payment confirmation", statuses: ["payment_confirmation"] },
  { key: "documents", label: "Policy documents", statuses: ["policy_documents"] },
];

export const OPEN_REQUEST_STATUSES: RequestStatus[] = [
  "submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready", "payment_confirmation", "policy_documents",
];

/** Allowed request transitions and who may make them. */
export const REQUEST_TRANSITIONS: Record<RequestStatus, { to: RequestStatus; by: Party[] }[]> = {
  draft: [{ to: "submitted", by: ["customer", "broker", "platform"] }, { to: "cancelled", by: ["customer"] }],
  submitted: [
    { to: "adviser_action", by: ["broker", "platform", "system"] },
    { to: "awaiting_customer_info", by: ["broker"] },
    { to: "insurer_response", by: ["broker"] },
    { to: "quotes_ready", by: ["broker", "system"] },
    { to: "cancelled", by: ["customer", "broker"] },
  ],
  awaiting_customer_info: [
    { to: "adviser_action", by: ["customer", "broker", "system"] },
    { to: "insurer_response", by: ["broker"] },
    { to: "cancelled", by: ["customer", "broker"] },
  ],
  adviser_action: [
    { to: "awaiting_customer_info", by: ["broker"] },
    { to: "insurer_response", by: ["broker"] },
    { to: "quotes_ready", by: ["broker"] },
    { to: "closed_no_cover", by: ["broker"] },
  ],
  insurer_response: [
    { to: "quotes_ready", by: ["broker", "insurer", "system"] },
    { to: "awaiting_customer_info", by: ["broker"] },
    { to: "closed_no_cover", by: ["broker"] },
  ],
  quotes_ready: [
    { to: "payment_confirmation", by: ["customer", "system"] },
    { to: "adviser_action", by: ["customer", "broker"] },
    { to: "cancelled", by: ["customer"] },
  ],
  payment_confirmation: [
    { to: "policy_documents", by: ["system", "platform"] },
    { to: "quotes_ready", by: ["system"] },
  ],
  policy_documents: [{ to: "completed", by: ["insurer", "broker", "system"] }],
  completed: [],
  cancelled: [],
  closed_no_cover: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus, by: Party): boolean {
  return REQUEST_TRANSITIONS[from].some((t) => t.to === to && t.by.includes(by));
}

export const QUOTE_STATUS: Record<QuoteStatus, StatusMeta> = {
  estimate: { label: "Estimate", tone: "neutral", customerHint: "An indicative price from approved rates. Not an offer." },
  awaiting_underwriting: { label: "Awaiting underwriting", tone: "wait", customerHint: "The insurer is reviewing. The price may change." },
  ready_to_accept: { label: "Ready to accept", tone: "ok", customerHint: "A binding offer you can accept until it expires." },
  accepted: { label: "Accepted", tone: "ok" },
  expired: { label: "Expired", tone: "neutral" },
  declined: { label: "Declined by insurer", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export const POLICY_STATUS: Record<PolicyStatus, StatusMeta> = {
  pending_issuance: { label: "Pending", tone: "wait", customerHint: "Not yet active. Cover starts when the insurer issues the policy." },
  active: { label: "Active", tone: "ok" },
  lapsed: { label: "Lapsed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  renewed: { label: "Renewed", tone: "ok" },
};

export const CLAIM_STATUS: Record<ClaimStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  reported: { label: "Reported to broker", tone: "info", customerHint: "Reporting a claim does not mean it is approved. The insurer decides." },
  delivered_to_insurer: { label: "Delivered to insurer", tone: "info", customerHint: "The insurer has your notification. They will acknowledge and assess it." },
  acknowledged: { label: "Acknowledged by insurer", tone: "info" },
  under_assessment: { label: "Under assessment", tone: "wait" },
  info_requested: { label: "More information needed", tone: "wait" },
  approved: { label: "Approved by insurer", tone: "ok" },
  partially_approved: { label: "Partially approved by insurer", tone: "ok" },
  rejected: { label: "Declined by insurer", tone: "danger", customerHint: "You can ask your broker to explain or raise a complaint." },
  paid: { label: "Paid by insurer", tone: "ok" },
  closed: { label: "Closed", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export const COMPLAINT_STATUS: Record<ComplaintStatus, StatusMeta> = {
  open: { label: "Open", tone: "info" },
  acknowledged: { label: "Acknowledged", tone: "info" },
  investigating: { label: "Investigating", tone: "wait" },
  resolved: { label: "Resolved", tone: "ok" },
  escalated_nic: { label: "Escalated to NIC", tone: "danger" },
  closed: { label: "Closed", tone: "neutral" },
};

export const PAYMENT_STATUS: Record<PaymentStatus, StatusMeta> = {
  pending: { label: "Pending", tone: "neutral" },
  processing: { label: "Processing", tone: "wait" },
  succeeded: { label: "Confirmed", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  refunded: { label: "Refunded", tone: "neutral" },
  reversed: { label: "Reversed", tone: "danger" },
  abandoned: { label: "Abandoned", tone: "neutral" },
};

export const CATEGORY_AVAILABILITY: Record<CategoryAvailability, StatusMeta & { promise: string }> = {
  integrated: { label: "Available", tone: "ok", promise: "Compare approved products and pay by an authorised route. Cover starts only after confirmed acceptance." },
  broker_assisted: { label: "Broker assisted", tone: "info", promise: "A structured request, a named adviser and a realistic turnaround. No instant purchase." },
  planned: { label: "Planned", tone: "neutral", promise: "Not yet available. We only open a category when advice, underwriting and servicing can support it." },
};

/** The four fulfilment checkpoints from the broker workspace mockup. */
export const FULFILMENT_CHECKPOINTS = [
  { key: "choice", label: "Confirm choice" },
  { key: "payment", label: "Verify payment" },
  { key: "issue", label: "Insurer issue" },
  { key: "documents", label: "Deliver policy documents" },
] as const;

export function fulfilmentProgress(input: { quoteAccepted: boolean; paymentConfirmed: boolean; policyActive: boolean; documentsDelivered: boolean }) {
  return [input.quoteAccepted, input.paymentConfirmed, input.policyActive, input.documentsDelivered];
}
