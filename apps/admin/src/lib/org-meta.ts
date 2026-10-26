import type { Enum } from "@im/db";

export const ORG_TYPES: Enum<"org_type">[] = ["broker", "insurer", "enterprise", "platform"];
export const ORG_STATUSES: Enum<"org_status">[] = ["pending", "active", "suspended", "offboarded"];
export const INTEGRATION_LEVELS: Enum<"integration_level">[] = ["portal", "quote_api", "policy_api"];

export const STATUS_TONE: Record<Enum<"org_status">, "ok" | "wait" | "danger" | "neutral"> = {
  active: "ok",
  pending: "wait",
  suspended: "danger",
  offboarded: "neutral",
};

/** Member roles allowed per organisation type. */
export const ROLES_BY_ORG_TYPE: Record<Enum<"org_type">, Enum<"member_role">[]> = {
  broker: ["owner", "admin", "supervisor", "adviser", "finance", "viewer"],
  insurer: ["owner", "admin", "underwriter", "claims_officer", "finance", "viewer"],
  enterprise: ["owner", "admin", "finance", "viewer"],
  platform: ["platform_admin", "platform_ops", "compliance", "support"],
};

export const NIC_VERIFY_URL = "https://nic.gov.gh/entities/verify";

/**
 * Partner due-diligence checklists (strategy doc §15, broker & insurer assessment),
 * stored in organizations.settings.due_diligence as { [key]: boolean, notes, reviewed_at, reviewed_by }.
 */
export const DUE_DILIGENCE: Record<"broker" | "insurer", { key: string; label: string }[]> = {
  broker: [
    { key: "nic_licence", label: "Valid NIC broker licence of the right class (verified on the NIC register)" },
    { key: "pi_cover", label: "Professional indemnity cover in force, limit adequate for volume" },
    { key: "fit_and_proper", label: "Ownership, directors and principal officer are fit and proper" },
    { key: "financials", label: "Latest audited financial statements reviewed" },
    { key: "regulatory_history", label: "No unresolved NIC sanctions; complaints history reviewed" },
    { key: "aml_kyc", label: "AML/CFT policy and customer KYC procedures in place" },
    { key: "data_protection", label: "Registered with the Data Protection Commission; data-sharing terms signed" },
    { key: "insurer_access", label: "Appointments / agency agreements with participating insurers" },
    { key: "service_capacity", label: "Staffing, service hours and SLA commitments agreed" },
    { key: "claims_support", label: "Claims assistance and complaints-handling process documented" },
    { key: "commission_disclosure", label: "Commission and fee disclosure policy agreed" },
    { key: "client_money", label: "Confirms premiums are paid directly to insurers (no client money held via platform)" },
    { key: "training", label: "Staff trained on the partner workspace and disclosure rules" },
  ],
  insurer: [
    { key: "nic_licence", label: "Valid NIC insurer licence (life / non-life) for the categories offered" },
    { key: "solvency", label: "Solvency / capital adequacy within NIC requirements" },
    { key: "claims_record", label: "Claims payment record and turnaround reviewed" },
    { key: "approved_wording", label: "Product wordings approved and filed with NIC" },
    { key: "data_owner", label: "Named product-data owner for rates, limits and exclusions" },
    { key: "quote_method", label: "Quote method agreed (portal, quote API or policy API)" },
    { key: "payment_route", label: "Payment route agreed — provider subaccount settles to the insurer" },
    { key: "issuance_process", label: "Issuance process, timing and policy document format agreed" },
    { key: "claims_procedure", label: "Claims notification procedure and contacts agreed" },
    { key: "complaints", label: "Complaints handling procedure and escalation contacts" },
    { key: "data_protection", label: "Data-sharing / processing agreement signed" },
    { key: "broker_appointments", label: "Broker appointments confirmed for each category" },
    { key: "technical_contact", label: "Technical contact and integration testing completed" },
  ],
};
