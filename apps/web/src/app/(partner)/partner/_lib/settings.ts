import { assignableRoles } from "@im/core";

/** Enum values an organisation may assign by invite — derived from the Addendum 3 role lists in `@im/core` (`roles.ts`). */
export const BROKER_ROLES: readonly string[] = assignableRoles("broker");
export const INSURER_ROLES: readonly string[] = assignableRoles("insurer");
export const DISTRIBUTOR_ROLES: readonly string[] = assignableRoles("distributor");

export const API_SCOPES = ["requests:read", "requests:write", "quotes:write", "policies:read", "policies:write", "claims:read", "claims:write", "finance:read", "webhooks:manage"] as const;
/** Scopes offered to distribution partners (embedded widget / partner API). Their keys reach /distribution/* only. */
export const DISTRIBUTOR_API_SCOPES = ["distribution:quote", "distribution:lead", "distribution:read"] as const;

/** Single source of truth for webhook event names: `@/server/webhook-events` (emitted by `@/server/webhooks`). */
export { WEBHOOK_EVENTS, WEBHOOK_EVENT_DESCRIPTIONS, type WebhookEvent } from "@/server/webhook-events";
