import "server-only";
import { revalidateTag } from "next/cache";
import { publicSiteUrl } from "@/lib/public-urls";

type Outcome = "ok" | "skipped" | "failed";

/**
 * Invalidate cache tags in this app AND ask the two public apps (separate Vercel projects with their own
 * caches, docs/APPS.md) to do the same: the marketing site (NEXT_PUBLIC_SITE_URL) and the app
 * (NEXT_PUBLIC_APP_URL). Each exposes POST /api/revalidate with header `x-revalidate-secret` and body
 * `{ tags }`. Failures are ignored (best effort) and reported back so the UI can mention it. An origin
 * that is not configured, or the app URL when it equals the site URL (pre-split), is skipped.
 */
export async function revalidateEverywhere(tags: string[]): Promise<{ web: Outcome }> {
  for (const t of tags) revalidateTag(t, "max");

  const secret = process.env.REVALIDATE_SECRET;
  const site = publicSiteUrl();
  const app = process.env.NEXT_PUBLIC_APP_URL ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "") : null;
  const origins = [...new Set([site, app].filter((o): o is string => !!o))];
  if (!origins.length || !secret) return { web: "skipped" };

  const results = await Promise.all(origins.map((origin) => notify(origin, secret, tags)));
  return { web: results.every((r) => r === "ok") ? "ok" : "failed" };
}

async function notify(origin: string, secret: string, tags: string[]): Promise<Outcome> {
  try {
    const res = await fetch(new URL("/api/revalidate", origin), {
      method: "POST",
      headers: { "content-type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export function webCacheNote(r: { web: Outcome }): string {
  if (r.web === "ok") return "Public site cache refreshed.";
  if (r.web === "skipped") return "Public site cache not notified (REVALIDATE_SECRET not set) — it will refresh on its own schedule.";
  return "Public site cache could not be notified — it will refresh on its own schedule.";
}
