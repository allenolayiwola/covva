"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePartner } from "@/lib/auth";
import { ORG_COOKIE, run, type ActionState } from "../_lib/context";

/** Switch the active partner organisation (only to one the user belongs to). */
export async function switchOrg(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const orgId = z.string().uuid().parse(formData.get("orgId"));
    const { all } = await requirePartner();
    if (!all.some((m) => m.org_id === orgId)) return { ok: false, error: "You are not a member of that organisation." };
    const jar = await cookies();
    jar.set(ORG_COOKIE, orgId, { path: "/partner", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 180 });
    redirect("/partner");
  });
}

export async function markNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", data.user.id).is("read_at", null);
  refresh();
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
