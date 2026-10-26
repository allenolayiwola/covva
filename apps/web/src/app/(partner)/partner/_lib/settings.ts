export const BROKER_ROLES = ["admin", "supervisor", "adviser", "finance", "viewer"] as const;
export const INSURER_ROLES = ["admin", "underwriter", "claims_officer", "finance", "viewer"] as const;

export const API_SCOPES = ["requests:read", "requests:write", "quotes:write", "policies:read", "policies:write", "claims:read", "claims:write", "webhooks:manage"] as const;

/** Single source of truth for webhook event names: `@/server/webhook-events` (emitted by `@/server/webhooks`). */
export { WEBHOOK_EVENTS, WEBHOOK_EVENT_DESCRIPTIONS, type WebhookEvent } from "@/server/webhook-events";
