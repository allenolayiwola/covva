import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ruleMessage } from "@/server/requests";

/**
 * Server Action context: a fresh RLS client plus the verified user. Every action calls this —
 * actions are public POST endpoints, so auth is re-checked each time (the proxy is optimistic only).
 */
export async function actionContext() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user ?? null };
}

/** Friendly message for a Supabase/PostgREST error; P0001 = business rule from a DB trigger. */
export function dbError(err: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong. Please try again.") {
  if (err?.code === "42501") return "You don't have permission to do that.";
  return ruleMessage(err, fallback);
}

export const SIGNED_OUT = { ok: false as const, error: "Your session has ended. Please sign in again." };

export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "_");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
