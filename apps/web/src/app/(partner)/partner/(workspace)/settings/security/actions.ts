"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../../_lib/context";

const uuid = z.string().uuid();

/**
 * Session & device management for partner accounts (Addendum 4).
 * `revoke_my_session` / `list_my_sessions` are SECURITY DEFINER functions scoped to auth.uid()
 * (supabase/migrations/20261027100300_access_security.sql).
 */
export async function revokeSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext();
    const id = uuid.parse(formData.get("sessionId"));
    const { data: claims } = await ctx.supabase.auth.getClaims();
    const current = (claims?.claims as { session_id?: string } | undefined)?.session_id ?? null;
    // Types are regenerated once the function is applied; until then call it untyped.
    const rpc = ctx.supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: boolean | null; error: { message?: string; code?: string } | null }>;
    const { data, error } = await rpc("revoke_my_session", { p_session_id: id });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't sign out that device.") };
    if (!data) return { ok: false, error: "That session has already ended." };
    if (current === id) {
      // We just ended our own session: clear the cookie and go to sign-in.
      await ctx.supabase.auth.signOut({ scope: "local" });
      redirect("/sign-in?next=%2Fpartner&signed_out=1");
    }
    refresh();
    return { ok: true, message: "That device has been signed out." };
  });
}

/** Signs out every other session; this browser stays signed in. */
export async function signOutEverywhere(): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext();
    const { error } = await ctx.supabase.auth.signOut({ scope: "others" });
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, message: "All other devices have been signed out. Push tokens registered by the mobile app stop working at the next refresh." };
  });
}

/** Forgets a mobile push registration (same as the app calling DELETE /api/v1/devices/{token}). */
export async function removeDevice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext();
    const id = uuid.parse(formData.get("deviceId"));
    const { error } = await ctx.supabase.from("device_tokens").delete().eq("id", id).eq("user_id", ctx.userId);
    if (error) return { ok: false, error: dbMessage(error, "We couldn't remove that device.") };
    refresh();
    return { ok: true, message: "Device removed. It will no longer receive push notifications." };
  });
}

/** Organisation policy: whether this organisation's users must use two-step verification. */
export async function setRequireMfa(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ roles: ROLES.orgAdmin });
    const require = formData.get("require_mfa") === "true";
    const { error } = await ctx.supabase.from("organizations").update({ require_mfa: require }).eq("id", ctx.orgId);
    if (error) return { ok: false, error: dbMessage(error) };
    refresh();
    return { ok: true, message: require ? "Two-step verification is now required for everyone in your organisation." : "Two-step verification is no longer enforced for your organisation (the platform may still require it)." };
  });
}
