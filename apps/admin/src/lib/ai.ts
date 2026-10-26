/** Default AI Gateway model ids (overridden by platform_settings key `ai_models`). */
export const DEFAULT_MODELS = {
  default: "anthropic/claude-sonnet-5.5",
  fast: "anthropic/claude-haiku-5.5",
  vision: "anthropic/claude-sonnet-5.5",
} as const;

/** AI feature flags the admin can manage (created on first toggle if missing). */
export const AI_FLAGS = [
  { key: "ai_assistant", description: "Customer & adviser AI assistant (explains, summarises, drafts; never decides suitability)." },
  { key: "ai_document_extraction", description: "Extract fields from uploaded documents for adviser review." },
  { key: "ai_claim_completeness", description: "AI checks claim evidence for completeness (never decides claims)." },
  { key: "ai_product_summaries", description: "AI-drafted plain-language product summaries, reviewed by the insurer." },
  { key: "ai_admin_insights", description: "Operational insights for platform staff from aggregate metrics." },
] as const;
