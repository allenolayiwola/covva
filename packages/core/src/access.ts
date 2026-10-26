import { z } from "zod";
import { uuid } from "./api";

/**
 * Platform access by user type (Addendum 4).
 *
 * * Customers: mobile app and web app.
 * * Brokers: the same mobile app (broker workspace) and the web partner workspace.
 * * Insurers: web portal only — the mobile app shows a clear message.
 * * Platform staff: the admin console only.
 *
 * Clients identify themselves with the `X-Covva-Client` header; a missing header means `web`.
 */
export const CLIENT_HEADER = "x-covva-client";

export const CLIENT_KINDS = ["mobile", "web", "partner-web"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];
export const DEFAULT_CLIENT: ClientKind = "web";

/** Normalises the raw header value; unknown or missing values fall back to `web`. */
export function parseClientKind(value: string | null | undefined): ClientKind {
  const v = (value ?? "").trim().toLowerCase();
  return (CLIENT_KINDS as readonly string[]).includes(v) ? (v as ClientKind) : DEFAULT_CLIENT;
}

export const WORKSPACE_TYPES = ["customer", "broker", "insurer", "platform"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

/** Workspace that a membership of an organisation of this type opens. */
export type MembershipType = Exclude<WorkspaceType, "customer">;

export interface WorkspaceAccess {
  allowed: boolean;
  /** Stable reason code when not allowed. */
  reason?: "insurer_web_only" | "staff_admin_console_only";
  /** Customer-facing message (the API returns it in the 403 body). `{portal}` is the partner URL. */
  message?: string;
}

const MESSAGES = {
  insurer_web_only: "Insurer accounts are managed in the Covva web portal, not the mobile app. Sign in at {portal} on a computer, tablet or phone browser.",
  staff_admin_console_only: "Covva staff accounts use the admin console, not the mobile app.",
} as const;

/**
 * Whether a workspace of `type` may be used from `client`.
 * The customer workspace is always available; broker users use the same mobile app;
 * insurer users and platform staff are web-only.
 */
export function workspaceAccess(type: WorkspaceType, client: ClientKind): WorkspaceAccess {
  if (client !== "mobile") return { allowed: true };
  switch (type) {
    case "customer":
    case "broker":
      return { allowed: true };
    case "insurer":
      return { allowed: false, reason: "insurer_web_only", message: MESSAGES.insurer_web_only };
    case "platform":
      return { allowed: false, reason: "staff_admin_console_only", message: MESSAGES.staff_admin_console_only };
  }
}

/** Fills the `{portal}` placeholder with the partner workspace URL. */
export function accessMessage(access: WorkspaceAccess, siteUrl: string): string | null {
  if (access.allowed || !access.message) return null;
  return access.message.replace("{portal}", `${siteUrl.replace(/\/$/, "")}/partner`);
}

/**
 * True when a signed-in user must be turned away from `client` altogether: they hold at least one
 * organisation membership and none of their workspaces (including the implicit customer one for
 * people who are genuinely customers) is usable there. In practice: insurer-only and staff-only
 * accounts on the mobile app. A user with any broker membership keeps mobile access; a user with
 * no memberships at all is a customer and is never blocked.
 */
export function isClientBlocked(membershipTypes: readonly MembershipType[], client: ClientKind): boolean {
  if (client !== "mobile" || membershipTypes.length === 0) return false;
  return membershipTypes.every((t) => !workspaceAccess(t, client).allowed);
}

/** `POST /api/v1/me/workspace` body. */
export const SetActiveWorkspaceInput = z
  .object({
    type: z.enum(["customer", "broker", "insurer"]),
    orgId: uuid.optional(),
  })
  .refine((v) => v.type === "customer" || !!v.orgId, { message: "orgId is required for a broker or insurer workspace", path: ["orgId"] });
export type SetActiveWorkspaceInput = z.infer<typeof SetActiveWorkspaceInput>;

/** Shape persisted in `profiles.active_workspace` and returned by `GET /api/v1/me`. */
export interface ActiveWorkspace {
  type: "customer" | "broker" | "insurer";
  orgId?: string;
}

export function parseActiveWorkspace(value: unknown): ActiveWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { type?: unknown; orgId?: unknown };
  if (v.type !== "customer" && v.type !== "broker" && v.type !== "insurer") return null;
  if (v.type === "customer") return { type: "customer" };
  return typeof v.orgId === "string" ? { type: v.type, orgId: v.orgId } : null;
}
