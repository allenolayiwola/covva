import { version } from "../../../../package.json";

/** Public liveness only. Never probes or exposes infrastructure. */
export function GET() {
  return Response.json({ status: "ok", version });
}
