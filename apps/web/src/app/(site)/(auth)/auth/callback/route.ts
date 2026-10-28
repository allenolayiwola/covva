import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/components/customer/utils";

/**
 * OAuth / PKCE magic-link / password-recovery code exchange.
 * Supabase redirects here with `?code=…&next=/path`.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const errorDescription = url.searchParams.get("error_description");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(await withOnboarding(supabase, next), url.origin));
  }

  const failed = new URL("/sign-in", url.origin);
  failed.searchParams.set("error", "link");
  if (errorDescription) failed.searchParams.set("reason", errorDescription.slice(0, 120));
  return NextResponse.redirect(failed);
}

async function withOnboarding(supabase: Awaited<ReturnType<typeof createClient>>, next: string) {
  if (next.startsWith("/onboarding") || next.startsWith("/reset-password") || next.startsWith("/partner")) return next;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return next;
  const { data: profile } = await supabase.from("profiles").select("onboarded_at").eq("id", data.user.id).maybeSingle();
  return profile && !profile.onboarded_at ? `/onboarding?next=${encodeURIComponent(next)}` : next;
}
