import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session cookie and does optimistic route protection for
 * the admin portal. This is NOT the authorisation layer: every page, Server Action
 * and Route Handler re-checks staff membership, role and MFA via `requireStaff()`,
 * and RLS is the final boundary.
 */
const PUBLIC = ["/sign-in", "/mfa", "/no-access"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Must run immediately after creating the client so refreshed tokens are written.
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

  const redirectTo = (pathname: string, withNext: boolean) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = withNext ? `?next=${encodeURIComponent(path + request.nextUrl.search)}` : "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!data?.claims) {
    if (isPublic && path !== "/mfa") return response;
    // Route handlers answer 401 themselves; only redirect page navigations.
    if (request.method !== "GET" || path.endsWith("/export") || path.endsWith("/insights")) return response;
    return redirectTo("/sign-in", path !== "/");
  }

  // Optimistic MFA gate based on the JWT's assurance level (re-verified server-side).
  const mfaRequired = (process.env.ADMIN_MFA_REQUIRED ?? "true").toLowerCase() !== "false";
  const aal = (data.claims as { aal?: string }).aal;
  if (mfaRequired && aal !== "aal2" && !isPublic && request.method === "GET") {
    return redirectTo("/mfa", path !== "/");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
