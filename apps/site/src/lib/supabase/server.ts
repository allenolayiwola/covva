import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import type { Database } from "@im/db";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Per-request Supabase client acting as the signed-in user (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy refreshes sessions.
        }
      },
    },
  });
}

/**
 * Privileged client (bypasses RLS). Only for trusted server code such as payment
 * webhooks, cron jobs and system notifications. Never expose to the browser.
 */
export function createServiceClient() {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured");
  return createPlainClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Anonymous client for public, cacheable reads (catalogue, plans, flags). */
export function createPublicClient() {
  return createPlainClient<Database>(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
