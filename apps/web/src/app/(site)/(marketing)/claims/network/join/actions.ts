"use server";
import { ServicePartnerApplicationInput, submitServicePartnerApplication } from "@/server/partner-network";
import { BusinessRuleError } from "@/server/requests";

/**
 * Public "join the partner network" form. Every Server Action is a public POST endpoint: input is
 * validated here, a honeypot and minimum fill time discard bots, and the response is deliberately narrow.
 */
export interface JoinState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

export async function applyToNetwork(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const raw = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const values = { ...raw };
  delete values.website;
  delete values.started;
  // Bots: honeypot filled or submitted faster than a person can type.
  const started = Number(raw.started ?? 0);
  if (raw.website || (started && Date.now() - started < 2500)) return { status: "success" };
  if (raw.consent !== "on") return { status: "error", message: "Please confirm we may contact you about your application.", fieldErrors: { consent: "Required" }, values };
  const parsed = ServicePartnerApplicationInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "_")] ??= i.message;
    return { status: "error", message: "Please check the highlighted fields.", fieldErrors, values };
  }
  try {
    await submitServicePartnerApplication(parsed.data, { sourcePage: "/claims/network/join" });
    return { status: "success" };
  } catch (err) {
    return { status: "error", message: err instanceof BusinessRuleError ? err.message : "We couldn't send your application. Please try again.", values };
  }
}
