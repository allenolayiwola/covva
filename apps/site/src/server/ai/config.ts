import "server-only";
import { getFlags, getSetting } from "@/lib/catalog";
import { ApiError } from "@/server/api-auth";

/**
 * Model routing through the Vercel AI Gateway (plain "creator/model" ids).
 * Env defaults, overridable at runtime by `platform_settings.ai_models`
 * ({ "default": "...", "fast": "...", "vision": "..." }) — admin-controlled.
 */
export interface AiModels { default: string; fast: string; vision: string }

export async function getModels(): Promise<AiModels> {
  const fallbackDefault = process.env.AI_DEFAULT_MODEL ?? "anthropic/claude-sonnet-5.5";
  const fallbackFast = process.env.AI_FAST_MODEL ?? "anthropic/claude-haiku-5.5";
  let override: Partial<AiModels> | null = null;
  try {
    override = await getSetting<Partial<AiModels>>("ai_models");
  } catch {
    override = null;
  }
  const pick = (v: unknown, d: string) => (typeof v === "string" && /^[\w.-]+\/[\w.:-]+$/.test(v) ? v : d);
  const def = pick(override?.default, fallbackDefault);
  return { default: def, fast: pick(override?.fast, fallbackFast), vision: pick(override?.vision, process.env.AI_VISION_MODEL ?? def) };
}

/** Gateway credentials: an API key, or Vercel OIDC on deployments. */
export function aiConfigured() {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL === "1");
}

/** Throws `unavailable` unless the feature flag is on and the gateway is configured. */
export async function requireAiFeature(flag: "ai_assistant" | "ai_document_extraction") {
  const flags = await getFlags().catch(() => ({}) as Record<string, boolean>);
  if (!flags[flag]) throw new ApiError("unavailable", "AI assistance is switched off at the moment.");
  if (!aiConfigured()) throw new ApiError("unavailable", "AI assistance isn't configured on this environment.");
}

export async function aiFlagOn(flag: "ai_assistant" | "ai_document_extraction") {
  const flags = await getFlags().catch(() => ({}) as Record<string, boolean>);
  return !!flags[flag] && aiConfigured();
}
