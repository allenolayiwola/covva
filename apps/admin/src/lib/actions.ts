import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveStaff, type Staff } from "@/lib/auth";
import { PERMS, can, type PermKey } from "@/lib/roles";

export type { ActionState } from "@/lib/action-state";
import type { ActionState } from "@/lib/action-state";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Authorise a Server Action. Every action is a public POST endpoint, so this
 * re-verifies the session, MFA level, platform staff membership and role.
 */
export async function authorize(perm: PermKey): Promise<{ ok: true; staff: Staff; supabase: Supabase } | { ok: false; error: string }> {
  const r = await resolveStaff();
  if (r.status === "anonymous") return { ok: false, error: "Your session has expired. Sign in again." };
  if (r.status === "mfa") return { ok: false, error: "Multi-factor verification is required. Reload the page to verify." };
  if (r.status === "forbidden") return { ok: false, error: "You are not a member of the platform staff." };
  if (!can(r.staff.roles, perm)) {
    return { ok: false, error: `Your role (${r.staff.roles.join(", ")}) cannot do this. Required: ${PERMS[perm].join(" or ")}.` };
  }
  return { ok: true, staff: r.staff, supabase: await createClient() };
}

/** Map Postgres/PostgREST errors to messages staff can act on. Trigger errors (P0001) are business rules. */
export function dbMessage(error: PostgrestError | { message: string; code?: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  const code = "code" in error ? error.code : undefined;
  if (code === "P0001") return error.message;
  if (code === "42501") return "The database refused this change (row-level security). Check your role and the record's organisation.";
  if (code === "23505") return "That value already exists — it must be unique.";
  if (code === "23503") return "This record is referenced elsewhere or refers to something that doesn't exist.";
  if (code === "23514") return "A value is outside the allowed range.";
  if (code === "22P02") return "One of the values has the wrong format.";
  return error.message || "Something went wrong.";
}

export function zodError(err: z.ZodError): ActionState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const k = issue.path.join(".") || "_";
    (fieldErrors[k] ??= []).push(issue.message);
  }
  const first = err.issues[0];
  return { ok: false, error: first ? `${first.path.length ? `${first.path.join(".")}: ` : ""}${first.message}` : "Invalid input", fieldErrors };
}

/** Plain object from FormData; repeated keys become arrays. */
export function formObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = typeof v === "string" ? v : v.name;
    if (k in out) {
      const prev = out[k];
      out[k] = Array.isArray(prev) ? [...prev, val] : [prev, val];
    } else out[k] = val;
  }
  return out;
}

/** Success result + re-render the current route in the action response. */
export function done(message: string): ActionState {
  refresh();
  return { ok: true, message };
}

export function fail(error: string): ActionState {
  return { ok: false, error };
}
