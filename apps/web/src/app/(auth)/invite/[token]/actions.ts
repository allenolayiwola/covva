"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ruleMessage } from "@/server/requests";
import type { ActionState } from "@/components/customer/utils";

const Token = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);

/**
 * Accept a team invitation as the signed-in user. The database function re-checks
 * everything that matters (token valid, not expired/accepted, invited email = the
 * caller's email, org active) and creates or reactivates the membership — the
 * invitee can't write `memberships` under RLS, hence the SECURITY DEFINER RPC.
 */
export async function acceptInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = Token.safeParse(formData.get("token"));
  if (!parsed.success) return { ok: false, error: "This invitation link is not valid." };
  const token = parsed.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Please sign in to accept this invitation." };

  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { ok: false, error: ruleMessage(error, "We couldn't accept this invitation. Please try again.") };
  const row = data?.[0];
  if (!row) return { ok: false, error: "We couldn't accept this invitation. Please try again." };
  redirect(row.org_type === "broker" || row.org_type === "insurer" ? "/partner?joined=1" : row.org_type === "enterprise" ? `/account/business?org=${row.org_id}` : "/");
}
