/**
 * Plain-language lines for the partner activity log (`partner_activity` view) and the staff audit views:
 * team role changes, invitations, acceptance, deactivation, MFA enrolment/removal and bulk product actions.
 * The view only exposes a whitelisted `detail` (role / active / supervisor / team / title, invitation email
 * and role, verified factor count, bulk count and reason); everything here is derived from that.
 */
import { roleLabel, type MemberRole, type PartnerKind } from "./roles";

export interface ActivityRow {
  id?: number | null;
  action: string | null;
  entity_type: string | null;
  entity_id?: string | null;
  actor_id: string | null;
  actor_role?: string | null;
  occurred_at?: string | null;
  changed_fields?: string[] | null;
  subject_user_id?: string | null;
  detail?: unknown;
}

export interface ActivityLine {
  /** Who did it ("Kofi Mensah", "Platform (automated)", "System"). */
  actor: string;
  /** One sentence: "Changed Ama Owusu's role: Underwriter → Claims officer". */
  summary: string;
  tone: "ok" | "info" | "danger" | "neutral" | "wait";
  /** Record type label for the table ("Team member", "Invitation", "Two-step verification"). */
  entityLabel: string;
}

export const ACTIVITY_ENTITY_LABEL: Record<string, string> = {
  requests: "Request",
  quotes: "Quote",
  policies: "Policy",
  claims: "Claim",
  memberships: "Team member",
  organizations: "Organisation",
  api_keys: "API key",
  webhook_endpoints: "Webhook",
  invitations: "Invitation",
  insurer_submissions: "Submission",
  products: "Product",
  product_versions: "Product version",
  rate_tables: "Rate table",
  underwriting_rules: "Underwriting rule",
  document_templates: "Document template",
  complaints: "Complaint",
  documents: "Document",
  mfa: "Two-step verification",
};

export function humanizeKey(s: string | null | undefined): string {
  const t = (s ?? "").replace(/[_.]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

type Change = { from?: unknown; to?: unknown; changed?: boolean };
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const change = (detail: Record<string, unknown>, key: string): Change | null => {
  const c = detail[key];
  return c && typeof c === "object" && ("from" in (c as object) || "to" in (c as object) || "changed" in (c as object)) ? (c as Change) : null;
};

function role(kind: PartnerKind, value: unknown): string {
  return typeof value === "string" && value ? roleLabel(kind, value as MemberRole) : "—";
}

/**
 * Describes one activity row. `names` resolves a user id to a display name (team list); unknown ids
 * become "a former member". Role labels follow the organisation kind (insurer / broker / distributor).
 */
export function describeActivity(row: ActivityRow, ctx: { kind: PartnerKind; names: (userId: string | null | undefined) => string | null | undefined }): ActivityLine {
  const actorName = row.actor_id ? ctx.names(row.actor_id) ?? "A former member" : row.actor_role === "service_role" ? "Platform (automated)" : "System";
  const subjectName = row.subject_user_id ? ctx.names(row.subject_user_id) ?? "a former member" : null;
  const subject = row.subject_user_id && row.subject_user_id === row.actor_id ? "themselves" : subjectName;
  const detail = asRecord(row.detail);
  const action = row.action ?? "";
  const entity = row.entity_type ?? "";
  const entityLabel = ACTIVITY_ENTITY_LABEL[entity] ?? humanizeKey(entity);

  if (entity === "memberships") {
    const who = subject ?? "a team member";
    if (action === "insert") {
      return { actor: actorName, summary: `${who === "themselves" ? actorName : who} joined the team as ${role(ctx.kind, detail.role)}`, tone: "ok", entityLabel };
    }
    if (action === "update") {
      const parts: string[] = [];
      const r = change(detail, "role");
      if (r) parts.push(`changed ${who === "themselves" ? "their own" : `${who}'s`} role: ${role(ctx.kind, r.from)} → ${role(ctx.kind, r.to)}`);
      const a = change(detail, "active");
      if (a) parts.push(a.to === true ? `reactivated ${who}` : `deactivated ${who}`);
      const s = change(detail, "is_supervisor");
      if (s) parts.push(s.to === true ? `made ${who} a supervisor` : `removed ${who} as supervisor`);
      const t = change(detail, "team");
      if (t) parts.push(t.to ? `moved ${who} to the ${String(t.to)} team` : `removed ${who} from their team`);
      const ti = change(detail, "title");
      if (ti) parts.push(`updated ${who === "themselves" ? "their own" : `${who}'s`} job title`);
      const summary = parts.length ? parts.join("; ") : `updated ${who}'s membership`;
      const tone = a && a.to !== true ? "danger" : "info";
      return { actor: actorName, summary: summary.charAt(0).toUpperCase() + summary.slice(1), tone, entityLabel };
    }
    if (action === "delete") return { actor: actorName, summary: `Removed ${who} from the organisation`, tone: "danger", entityLabel };
  }

  if (entity === "invitations") {
    const email = typeof detail.email === "string" ? detail.email : "a new member";
    if (action === "insert") {
      return { actor: actorName, summary: `Invited ${email} as ${role(ctx.kind, detail.role)}`, tone: "ok", entityLabel };
    }
    if (action === "update") {
      const acc = change(detail, "accepted_at");
      if (acc && acc.to) return { actor: actorName, summary: `Accepted the invitation and joined the team`, tone: "ok", entityLabel };
      const r = change(detail, "role");
      if (r) return { actor: actorName, summary: `Changed an invitation's role: ${role(ctx.kind, r.from)} → ${role(ctx.kind, r.to)}`, tone: "info", entityLabel };
      return { actor: actorName, summary: "Updated an invitation", tone: "info", entityLabel };
    }
    if (action === "delete") return { actor: actorName, summary: `Revoked the invitation for ${email}`, tone: "danger", entityLabel };
  }

  if (entity === "mfa") {
    const n = typeof detail.verified_factors === "number" ? detail.verified_factors : Number(detail.verified_factors ?? 0) || 0;
    const left = n === 1 ? "1 authenticator" : `${n} authenticators`;
    if (action === "mfa.enrolled") return { actor: actorName, summary: `Set up two-step verification (${left} on the account)`, tone: "ok", entityLabel };
    if (action === "mfa.removed") return { actor: actorName, summary: n === 0 ? "Two-step verification was removed from the account (no authenticator left)" : `An authenticator was removed (${left} left)`, tone: "danger", entityLabel };
  }

  if (action.startsWith("products.bulk_")) {
    const verb = action === "products.bulk_pause" ? "Paused" : action === "products.bulk_withdraw" ? "Withdrew" : "Republished";
    const count = Number(detail.count ?? 0) || 0;
    const reason = typeof detail.reason === "string" && detail.reason ? ` — ${detail.reason}` : "";
    return { actor: actorName, summary: `${verb} ${count === 1 ? "1 product" : `${count} products`}${reason}`, tone: action === "products.bulk_republish" ? "ok" : action === "products.bulk_pause" ? "wait" : "danger", entityLabel: "Products" };
  }

  const fields = (row.changed_fields ?? []).map(humanizeKey).filter(Boolean);
  const verb = action === "insert" ? "Created" : action === "delete" ? "Deleted" : action === "update" ? "Updated" : humanizeKey(action);
  const summary = fields.length ? `${verb} ${entityLabel.toLowerCase()} (${fields.join(", ")})` : `${verb} ${entityLabel.toLowerCase()}`;
  return { actor: actorName, summary, tone: action === "insert" ? "ok" : action === "delete" ? "danger" : action === "update" ? "info" : "neutral", entityLabel };
}

/** Rows about the team itself (for the "Team changes" filter on the activity page). */
export const TEAM_ACTIVITY_ENTITIES = ["memberships", "invitations", "mfa"] as const;

export function isTeamActivity(row: Pick<ActivityRow, "entity_type">): boolean {
  return (TEAM_ACTIVITY_ENTITIES as readonly string[]).includes(row.entity_type ?? "");
}
