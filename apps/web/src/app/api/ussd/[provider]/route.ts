import { isUssdProvider } from "@im/core";
import { handleUssd } from "@/server/ussd/engine";
import { authorizeUssd } from "@/server/ussd/auth";
import { formatAfricasTalking, parseAfricasTalking } from "@/server/ussd/africastalking";
import { formatHubtel, parseHubtel } from "@/server/ussd/hubtel";
import { formatArkesel, parseArkesel } from "@/server/ussd/arkesel";
import { formatSimulator, parseSimulator } from "@/server/ussd/simulator";
import { log } from "@/server/log";

export const maxDuration = 20;

/**
 * POST /api/ussd/{africastalking|hubtel|arkesel|simulator} — aggregator callbacks.
 * Auth per provider: shared secret (header or `?key=`) and an optional IP allowlist
 * (see server/ussd/auth.ts and docs/OPERATIONS.md "USSD").
 */
export async function POST(req: Request, ctx: RouteContext<"/api/ussd/[provider]">) {
  const { provider } = await ctx.params;
  if (!isUssdProvider(provider)) return new Response("Not found", { status: 404 });
  const auth = authorizeUssd(req, provider);
  if (!auth.ok) {
    log.warn("ussd.unauthorised", { provider, status: auth.status });
    return Response.json({ ok: false, error: { code: "unauthorised", message: auth.message } }, { status: auth.status });
  }
  try {
    switch (provider) {
      case "africastalking": {
        const r = await parseAfricasTalking(req);
        return formatAfricasTalking(await handleUssd(r));
      }
      case "hubtel": {
        const r = await parseHubtel(req);
        return formatHubtel(await handleUssd(r), r);
      }
      case "arkesel": {
        const r = await parseArkesel(req);
        return formatArkesel(await handleUssd(r), r);
      }
      case "simulator": {
        const r = await parseSimulator(req);
        return formatSimulator(await handleUssd(r));
      }
    }
  } catch (err) {
    log.error("ussd.route_failed", { provider, err });
    const reply = { type: "END" as const, text: "Sorry, something went wrong. Please try again later." };
    if (provider === "africastalking") return formatAfricasTalking(reply);
    return Response.json({ ok: false, error: { code: "internal_error", message: reply.text } }, { status: 500 });
  }
}
