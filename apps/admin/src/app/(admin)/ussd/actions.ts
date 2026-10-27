"use server";
import { z } from "zod";
import { authorize } from "@/lib/actions";

const Hop = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  phoneNumber: z.string().trim().min(9).max(20),
  text: z.string().max(400),
});

export type SimResult = { ok: true; type: "CON" | "END"; text: string; chars: number } | { ok: false; error: string };

/**
 * One simulator hop: forwards to the web app's `/api/ussd/simulator` adapter (server to server,
 * `X-USSD-Secret`). Runs the real engine — it reads the real customer by phone number, and END
 * actions send real SMS and create real leads where providers are configured.
 */
export async function simulateHop(input: { sessionId: string; phoneNumber: string; text: string }): Promise<SimResult> {
  const auth = await authorize("ussd");
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = Hop.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return { ok: false, error: "NEXT_PUBLIC_SITE_URL is not set for the admin app." };
  const secret = process.env.USSD_SHARED_SECRET;
  try {
    const res = await fetch(new URL("/api/ussd/simulator", site), {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-ussd-secret": secret } : {}) },
      body: JSON.stringify({ ...parsed.data, serviceCode: process.env.USSD_SERVICE_CODE ?? "*920*44#" }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: { type: "CON" | "END"; text: string; chars: number }; error?: { message?: string } } | null;
    if (!res.ok || !json?.ok || !json.data) return { ok: false, error: json?.error?.message ?? `The web app answered ${res.status}. Check USSD_SHARED_SECRET on both apps.` };
    return { ok: true, ...json.data };
  } catch {
    return { ok: false, error: "Couldn't reach the web app's USSD endpoint." };
  }
}
