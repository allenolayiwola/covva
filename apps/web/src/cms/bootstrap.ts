import "server-only";
import { connection } from "next/server";
import { cmsConfigured } from "./env";

/**
 * Fail-closed gate for the admin (/cms) and its REST API (/cms-api).
 *
 * Payload shows a public "create first user" screen while the `users` collection is empty, which
 * would let whoever reaches the deployment first become the admin (and `cms:seed` would then skip
 * the intended account). So while the CMS is configured but has no user, both routes refuse to
 * serve Payload: the admin renders a "not initialised" notice and the API answers 503. The first
 * admin is created by `pnpm --filter @im/web cms:seed` (docs/CMS.md §5). The one-time switch
 * `CMS_BOOTSTRAP_ALLOW_FIRST_USER=1` opens Payload's own screen instead; unset it afterwards.
 *
 * The check is memoised per server instance so admin asset and API requests do not each hit the
 * database: a positive answer is kept for a few minutes, an empty table for a few seconds (so the
 * seed takes effect without a redeploy) and a failure for a moment.
 */
export type CmsBootstrapState = "ready" | "uninitialised" | "unavailable";

const TTL_MS: Record<CmsBootstrapState, number> = { ready: 5 * 60_000, uninitialised: 15_000, unavailable: 5_000 };

let memo: { state: CmsBootstrapState; until: number } | null = null;
let inflight: Promise<CmsBootstrapState> | null = null;

/** The one-time switch that lets Payload's own create-first-user screen through. */
export function firstUserAllowed(): boolean {
  return process.env.CMS_BOOTSTRAP_ALLOW_FIRST_USER?.trim() === "1";
}

async function probe(): Promise<CmsBootstrapState> {
  try {
    const { getPayloadClient } = await import("./client");
    const payload = await getPayloadClient();
    const { totalDocs } = await payload.count({ collection: "users", overrideAccess: true });
    return totalDocs > 0 ? "ready" : "uninitialised";
  } catch (err) {
    console.error("[cms] bootstrap check failed:", err instanceof Error ? err.message : err);
    return "unavailable";
  }
}

/**
 * Whether Payload may be served. "ready" when at least one CMS user exists (or the one-time
 * switch is set), "uninitialised" while the users table is empty, "unavailable" when the
 * database could not be asked (the gate stays closed rather than guessing).
 */
export async function cmsBootstrapState(): Promise<CmsBootstrapState> {
  if (!cmsConfigured()) return "unavailable";
  // Request time only: the answer must never be prerendered into the route's static shell (a
  // build made before the seed would otherwise show "not initialised" until the next deploy).
  await connection();
  const now = Date.now();
  let state: CmsBootstrapState;
  if (memo && memo.until > now) {
    state = memo.state;
  } else {
    inflight ??= probe()
      .then((s) => {
        memo = { state: s, until: Date.now() + TTL_MS[s] };
        return s;
      })
      .finally(() => {
        inflight = null;
      });
    state = await inflight;
  }
  return state === "uninitialised" && firstUserAllowed() ? "ready" : state;
}

/** Convenience for the routes: configured and ready to serve Payload. */
export async function cmsReady(): Promise<boolean> {
  return cmsConfigured() && (await cmsBootstrapState()) === "ready";
}
