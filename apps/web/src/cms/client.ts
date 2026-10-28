import "server-only";
import { getPayload, type Payload } from "payload";
import config from "./payload.config";
import { cmsConfigured } from "./env";

/**
 * Payload Local API client (no HTTP hop). Imported lazily (`await import("@/cms/client")`) by the
 * site readers so Payload only loads on a server that has the CMS configured.
 */
export async function getPayloadClient(): Promise<Payload> {
  if (!cmsConfigured()) throw new Error("CMS is not configured (DATABASE_URI / PAYLOAD_SECRET)");
  return getPayload({ config });
}
