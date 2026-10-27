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
  /**
   * WhatsApp support console: take over conversations, reply, hand off, opt contacts out.
   * The one place `support` writes — they are the support agents.
   */
  whatsapp: ["platform_admin", "platform_ops", "support"],
  /** WhatsApp template registry (what we submit to Meta). */
  whatsappTemplates: ["platform_admin", "platform_ops"],
  /** Translations: drafting and reviewing strings (support staff can act as translators). */
  translations: ["platform_admin", "platform_ops", "compliance", "support"],
  /** Translations: approving a string makes it live for every visitor. */
  translationsApprove: ["platform_admin", "platform_ops", "compliance"],
  /** USSD simulator (sends real SMS / creates leads in non-sandbox environments). */
  ussd: ["platform_admin", "platform_ops", "support"],
  /** Embedded distribution partners (segment, categories, widget domains, status; revenue share). */
  distribution: ["platform_admin", "platform_ops"],
  /** Switching reward rules on/off (customer inducements need NIC + insurer approval). */
  rewardRules: ["platform_admin", "compliance"],
  /**
   * Act 843 privacy requests: verify identity, generate exports, approve / refuse, run the deletion (anonymisation),
   * close. Mirrors private.is_privacy_officer() in the database; support reads only.
   */
  privacy: ["platform_admin", "platform_ops", "compliance"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type PermKey = keyof typeof PERMS;

export function can(roles: readonly StaffRole[], perm: PermKey): boolean {
  return roles.some((r) => (PERMS[perm] as readonly StaffRole[]).includes(r));
}
