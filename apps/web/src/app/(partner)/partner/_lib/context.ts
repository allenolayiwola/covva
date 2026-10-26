import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Enum } from "@im/db";
import { getUser, requirePartner, type Membership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Cookie remembering which partner organisation is active when a user has several. */
export const ORG_COOKIE = "im_partner_org";

export type PartnerKind = "broker" | "insurer";
export type MemberRole = Enum<"member_role">;

export const ROLES = {
  /** Can work broker requests (quotes, tasks, messages, transitions). */
  brokerWork: ["owner", "admin", "supervisor", "adviser"] as MemberRole[],
  /** Supervisors can reassign across the team and start broker changes. */
  supervise: ["owner", "admin", "supervisor"] as MemberRole[],
  /** Insurer underwriting: submissions, quotes, issuance, product data. */
  underwrite: ["owner", "admin", "underwriter"] as MemberRole[],
  /** Insurer claims handling. */
  claims: ["owner", "admin", "claims_officer"] as MemberRole[],
  /** Organisation administration (team, profile, developer, connector). */
  orgAdmin: ["owner", "admin"] as MemberRole[],
  /** Billing visibility (matches RLS on subscriptions/usage/invoices). */
  billing: ["owner", "admin", "finance"] as MemberRole[],
};

export interface PartnerContext {
  membership: Membership;
  all: Membership[];
  orgId: string;
  orgName: string;
  kind: PartnerKind;
  role: MemberRole;
  isSupervisor: boolean;
  isDemo: boolean;
  userId: string;
  userEmail: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
}

function pick(all: Membership[], wanted: string | undefined) {
  return all.find((m) => m.org_id === wanted) ?? all[0]!;
}

function build(membership: Membership, all: Membership[], user: { id: string; email?: string | null }, supabase: PartnerContext["supabase"]): PartnerContext {
  const settings = (membership.org.settings ?? {}) as Record<string, unknown>;
  return {
    membership,
    all,
    orgId: membership.org_id,
    orgName: membership.org.name,
    kind: membership.org.type as PartnerKind,
    role: membership.role,
    isSupervisor: membership.is_supervisor || ROLES.supervise.includes(membership.role),
    isDemo: settings.demo === true,
    userId: user.id,
    userEmail: user.email ?? null,
    supabase,
  };
}

/**
 * Partner context for Server Components. Reads cookies (session + active org), so it
 * must only be called inside a <Suspense> boundary and never inside "use cache".
 */
export const getPartnerContext = cache(async (): Promise<PartnerContext> => {
  await connection();
  const { all } = await requirePartner();
  const jar = await cookies();
  const membership = pick(all, jar.get(ORG_COOKIE)?.value);
  const user = (await getUser())!;
  const supabase = await createClient();
  return build(membership, all, user, supabase);
});

/** Page guard for views that only exist for one kind of organisation. */
export async function requireKind(kind: PartnerKind): Promise<PartnerContext> {
  const ctx = await getPartnerContext();
  if (ctx.kind !== kind) redirect("/partner");
  return ctx;
}

export function can(ctx: Pick<PartnerContext, "role" | "isSupervisor">, roles: MemberRole[]) {
  if (roles === ROLES.supervise && ctx.isSupervisor) return true;
  return roles.includes(ctx.role);
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------
export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}

export const idle: ActionState = { ok: false };

export class ActionError extends Error {}

/**
 * Re-checks the session and partner membership inside every Server Action (actions are
 * public POST endpoints). RLS remains the real boundary; this gives friendly errors.
 */
export async function actionContext(opts: { kind?: PartnerKind; roles?: MemberRole[] } = {}): Promise<PartnerContext> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ActionError("Your session has ended. Please sign in again.");
  const { all } = await requirePartner();
  const jar = await cookies();
  const ctx = build(pick(all, jar.get(ORG_COOKIE)?.value), all, data.user, supabase);
  if (opts.kind && ctx.kind !== opts.kind) throw new ActionError(`This action is only available to ${opts.kind} organisations.`);
  if (opts.roles && !can(ctx, opts.roles)) throw new ActionError("Your role does not allow this action. Ask a supervisor or an organisation admin.");
  return ctx;
}

/** Wraps an action body: converts thrown ActionErrors into form state. */
export async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    // Let Next.js control-flow errors (redirect/notFound) propagate.
    if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_")) throw e;
    console.error("[partner action]", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Friendly message for Supabase errors: trigger rules (P0001), duplicates, RLS denials. */
export function dbMessage(err: { code?: string; message?: string } | null | undefined, fallback = "We couldn't save that.") {
  if (!err) return fallback;
  if (err.code === "P0001" && err.message) return err.message;
  if (err.code === "23505") return "This has already been recorded.";
  if (err.code === "42501" || /row-level security/i.test(err.message ?? "")) return "You don't have permission to change this record.";
  return fallback;
}
