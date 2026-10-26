import "server-only";
import { revalidateTag } from "next/cache";

/**
 * Invalidate cache tags in this app AND ask the public web app (separate Vercel
 * project with its own cache) to do the same. The web endpoint is owned by the
 * Backend stream: POST {NEXT_PUBLIC_SITE_URL}/api/revalidate with header
 * `x-revalidate-secret` and body `{ tags }`. Failures are ignored (best effort) and
 * reported back so the UI can mention it.
 */
export async function revalidateEverywhere(tags: string[]): Promise<{ web: "ok" | "skipped" | "failed" }> {
  for (const t of tags) revalidateTag(t, "max");

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!site || !secret) return { web: "skipped" };
  try {
    const res = await fetch(new URL("/api/revalidate", site), {
      method: "POST",
      headers: { "content-type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    return { web: res.ok ? "ok" : "failed" };
  } catch {
    return { web: "failed" };
  }
}

export function webCacheNote(r: { web: "ok" | "skipped" | "failed" }): string {
  if (r.web === "ok") return "Public site cache refreshed.";
  if (r.web === "skipped") return "Public site cache not notified (REVALIDATE_SECRET not set) — it will refresh on its own schedule.";
  return "Public site cache could not be notified — it will refresh on its own schedule.";
}
