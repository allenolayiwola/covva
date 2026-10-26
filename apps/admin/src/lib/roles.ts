/**
 * Platform staff roles and the permission matrix used by pages (to show/hide
 * controls) and Server Actions (to authorise). `support` is read-only everywhere.
 * Safe to import from client components (no server-only code).
 */
export const STAFF_ROLES = ["platform_admin", "platform_ops", "compliance", "support"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<StaffRole, string> = {
  platform_admin: "Platform admin",
  platform_ops: "Platform operations",
  compliance: "Compliance",
  support: "Support (read-only)",
};

/** Who may write in each area. Reading is open to every staff role. */
export const PERMS = {
  /** Requests, payments, policies oversight actions. */
  operations: ["platform_admin", "platform_ops"],
  /** Complaints handling, KYC review. */
  conduct: ["platform_admin", "platform_ops", "compliance"],
  /** Organisations, members, routing, appointments. */
  network: ["platform_admin", "platform_ops"],
  /** Licence verification and partner due diligence. */
  dueDiligence: ["platform_admin", "platform_ops", "compliance"],
  /** Categories, launch gate, risk schema. */
  catalogue: ["platform_admin", "platform_ops"],
  /** Product version approval / rejection / suspension. */
  productApproval: ["platform_admin", "compliance"],
  /** Plans, subscriptions, invoices. */
  commercial: ["platform_admin"],
  /** Marketing leads. */
  leads: ["platform_admin", "platform_ops"],
  /**
   * Partnerships CRM (accounts, notes, tasks, meetings, assisted onboarding).
   * Members of the partnerships team (memberships.team = 'partnerships') may also
   * write regardless of role — see lib/crm.ts authorizeCrm().
   */
  crm: ["platform_admin", "platform_ops"],
  /** Feature flags, platform settings, AI model settings, user invitations. */
  platform: ["platform_admin"],
  /** Running the audit chain verification. */
  audit: ["platform_admin", "compliance"],
  /** AI insights generation (costs money). */
  insights: ["platform_admin", "platform_ops", "compliance"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type PermKey = keyof typeof PERMS;

export function can(roles: readonly StaffRole[], perm: PermKey): boolean {
  return roles.some((r) => (PERMS[perm] as readonly StaffRole[]).includes(r));
}
