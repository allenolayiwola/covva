export const BROKER_ROLES = ["admin", "supervisor", "adviser", "finance", "viewer"] as const;
export const INSURER_ROLES = ["admin", "underwriter", "claims_officer", "finance", "viewer"] as const;

export const API_SCOPES = ["requests:read", "requests:write", "quotes:write", "policies:read", "policies:write", "claims:read", "claims:write", "webhooks:manage"] as const;

export const WEBHOOK_EVENTS = [
  "request.created", "request.status_changed", "submission.created", "quote.ready", "quote.accepted",
  "payment.confirmed", "policy.issued", "claim.reported", "claim.status_changed", "complaint.created",
] as const;
