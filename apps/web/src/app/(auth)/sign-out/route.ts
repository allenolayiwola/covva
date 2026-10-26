import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /sign-out — for plain HTML forms (works without JavaScript). In React forms prefer the
 * `signOut` Server Action from `app/(auth)/actions.ts`. GET is intentionally not supported so a
 * third-party page can't sign people out with an <img> tag.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/sign-in?signed_out=1", request.nextUrl.origin), { status: 303 });
}
