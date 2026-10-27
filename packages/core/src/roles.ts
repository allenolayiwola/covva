/**
 * Partner user roles (Addendum 3 B2 / C3) mapped onto the `member_role` enum.
 *
 * Insurer: Admin, Product Manager, Underwriter, Claims, Finance, Read-only.
 * Broker:  Admin, Account Executive, Claims, Finance, Read-only.
 *
 * The database enum stays generic (owner/admin/supervisor/adviser/underwriter/claims_officer/
 * finance/viewer); this module is the single source of the labels shown to partners and of the
 * permissions each role carries. `owner` is the organisation's founding account (set on
 * onboarding, never offered in the invite picker) and can do everything an Admin can.
 */
import type { Enum } from "@im/db";

export type MemberRole = Enum<"member_role">;
export type PartnerKind = "broker" | "insurer" | "distributor";

export interface PartnerRoleOption {
  /** Database enum value. */
  value: MemberRole;
  /** Label from Addendum 3. */
  label: string;
  /** One line shown next to the role picker. */
  description: string;
}

export const INSURER_ROLE_OPTIONS: readonly PartnerRoleOption[] = [
  { value: "admin", label: "Admin", description: "Manages users, organisation profile, integrations and everything below." },
  { value: "supervisor", label: "Product Manager", description: "Creates and updates products, rate tables, rules and templates; submits them for review." },
  { value: "underwriter", label: "Underwriter", description: "Works submissions, quotes and issuance." },
  { value: "claims_officer", label: "Claims", description: "Handles claims and claim decisions." },
  { value: "finance", label: "Finance", description: "Settlements, statements, billing and reports." },
  { value: "viewer", label: "Read-only", description: "Can see the workspace but not change anything." },
];

export const BROKER_ROLE_OPTIONS: readonly PartnerRoleOption[] = [
  { value: "admin", label: "Admin", description: "Manages users, organisation profile, integrations and everything below." },
  { value: "adviser", label: "Account Executive", description: "Works requests, quotes, customers and renewals." },
  { value: "claims_officer", label: "Claims", description: "Helps customers report claims and tracks them with the insurer." },
  { value: "finance", label: "Finance", description: "Commission, settlements, billing and reports." },
  { value: "viewer", label: "Read-only", description: "Can see the workspace but not change anything." },
];

/** Embedded distribution partners (dealers, banks, landlords…): no advice, quoting or claims roles. */
export const DISTRIBUTOR_ROLE_OPTIONS: readonly PartnerRoleOption[] = [
  { value: "admin", label: "Admin", description: "Manages users, the widget, referral links and API keys." },
  { value: "finance", label: "Finance", description: "Revenue share statements and reports." },
  { value: "viewer", label: "Read-only", description: "Can see referrals and conversions but not change anything." },
];

export const PARTNER_ROLE_OPTIONS: Record<PartnerKind, readonly PartnerRoleOption[]> = {
  insurer: INSURER_ROLE_OPTIONS,
  broker: BROKER_ROLE_OPTIONS,
  distributor: DISTRIBUTOR_ROLE_OPTIONS,
};

/** Roles offered in the invite / edit-member pickers for an organisation kind. */
export function rolesFor(kind: PartnerKind): readonly PartnerRoleOption[] {
  return PARTNER_ROLE_OPTIONS[kind];
}

/** Enum values a `kind` organisation may assign (owner excluded: it is never assigned by invite). */
export function assignableRoles(kind: PartnerKind): MemberRole[] {
  return rolesFor(kind).map((r) => r.value);
}

/** Human label for a role as the organisation's users know it (falls back to a humanised enum value). */
export function roleLabel(kind: PartnerKind, role: MemberRole): string {
  if (role === "owner") return "Owner";
  const found = rolesFor(kind).find((r) => r.value === role);
  if (found) return found.label;
  // A role that exists in the enum but is not offered to this kind (e.g. a broker 'supervisor' from legacy data).
  if (role === "supervisor") return kind === "broker" ? "Supervisor" : "Product Manager";
  return role.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
export type PartnerAction =
  /** Invite, edit and deactivate members; change roles. */
  | "manage_team"
  /** Organisation profile, logo, licence details. */
  | "manage_org"
  /** API keys, webhooks, connectors. */
  | "manage_developer"
  /** Security settings for the organisation (e.g. MFA requirement). */
  | "manage_security"
  /** Broker: work requests, quotes, tasks, customer messages. */
  | "work_requests"
  /** Broker: reassign across the team, approve broker changes, see escalations. */
  | "supervise"
  /** Insurer: submissions, quotes, issuance queue. */
  | "underwrite"
  /** Insurer: create/edit products, rate tables, rules, templates; submit for review. */
  | "manage_products"
  /** Claims handling (both kinds). */
  | "handle_claims"
  /** Settlements, statements, invoices, subscription. */
  | "view_billing"
  /** Reports and exports. */
  | "view_reports";

const ALL_ACTIONS: readonly PartnerAction[] = [
  "manage_team",
  "manage_org",
  "manage_developer",
  "manage_security",
  "work_requests",
  "supervise",
  "underwrite",
  "manage_products",
  "handle_claims",
  "view_billing",
  "view_reports",
];

/**
 * Permission matrix for partner roles. Owner and Admin can do everything; Read-only can only view
 * reports. Platform staff roles (admin console) are not partner roles and get nothing here.
 */
export const ROLE_PERMISSIONS: Partial<Record<MemberRole, readonly PartnerAction[]>> = {
  owner: ALL_ACTIONS,
  admin: ALL_ACTIONS,
  // Broker supervisor / insurer Product Manager
  supervisor: ["work_requests", "supervise", "manage_products", "handle_claims", "view_reports"],
  // Broker Account Executive
  adviser: ["work_requests", "view_reports"],
  underwriter: ["underwrite", "view_reports"],
  claims_officer: ["handle_claims", "view_reports"],
  finance: ["view_billing", "view_reports"],
  viewer: ["view_reports"],
};

/** Whether `role` may perform `action`. Unknown roles get nothing. */
export function can(role: MemberRole | null | undefined, action: PartnerAction): boolean {
  if (!role) return false;
  return (ROLE_PERMISSIONS[role] ?? []).includes(action);
}

/** Roles (enum values) that may perform `action`, e.g. for RLS-equivalent checks in code. */
export function rolesWith(action: PartnerAction): MemberRole[] {
  return (Object.keys(ROLE_PERMISSIONS) as MemberRole[]).filter((r) => can(r, action));
}
