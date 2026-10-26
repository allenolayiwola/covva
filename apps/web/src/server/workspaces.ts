import "server-only";
import { workspaceAccess, type ActiveWorkspace, type ClientKind } from "@im/core";

/**
 * Workspaces for `GET /api/v1/me` and `POST /api/v1/me/workspace` (Addendum 4): the customer
 * workspace plus one per broker/insurer membership, with per-client availability.
 */
export interface Workspace {
  type: "customer" | "broker" | "insurer";
  orgId?: string;
  orgName?: string;
  role?: string;
  /** Whether this workspace can be used from the mobile app (Addendum 4: insurers are web-only). */
  mobileAllowed: boolean;
  /** Whether the calling client may use it right now. */
  allowed: boolean;
}

/**
 * Workspaces a user can switch between: the customer workspace (always) plus one per broker /
 * insurer membership. The mobile app shows the broker workspace in the same app; insurer
 * workspaces are listed with `mobileAllowed: false` so the app can explain rather than fail.
 */
export function buildWorkspaces(memberships: { org_id: string; role: string; org: unknown }[], client: ClientKind): Workspace[] {
  const out: Workspace[] = [{ type: "customer", mobileAllowed: true, allowed: true }];
  for (const m of memberships) {
    const org = m.org as { type?: string; name?: string } | null;
    if (org?.type !== "broker" && org?.type !== "insurer") continue;
    out.push({
      type: org.type,
      orgId: m.org_id,
      orgName: org.name ?? "",
      role: m.role,
      mobileAllowed: workspaceAccess(org.type, "mobile").allowed,
      allowed: workspaceAccess(org.type, client).allowed,
    });
  }
  return out;
}

/** The stored choice if it is still valid for this user and client, else the first usable workspace. */
export function resolveActiveWorkspace(stored: ActiveWorkspace | null, workspaces: Workspace[]): ActiveWorkspace {
  const match = stored && workspaces.find((w) => w.allowed && w.type === stored.type && (w.type === "customer" || w.orgId === stored.orgId));
  if (match) return match.type === "customer" ? { type: "customer" } : { type: match.type, orgId: match.orgId };
  const partner = workspaces.find((w) => w.allowed && w.type !== "customer");
  // Partner staff default to their workspace; everyone else is a customer.
  return partner ? { type: partner.type, orgId: partner.orgId } : { type: "customer" };
}

