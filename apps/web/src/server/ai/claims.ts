import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { CLAIM_DISCLAIMER } from "@im/core";
import type { Json } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { notFound, type UserAuth } from "@/server/api-auth";
import { requiredEvidence } from "@/server/claims";
import { log } from "@/server/log";
import { aiFlagOn, getModels } from "./config";
import { BASE_INSTRUCTIONS, redactPII } from "./guardrails";
import { logAiUsage } from "./usage";

const AiCompleteness = z.object({
  descriptionGaps: z.array(z.string()).describe("Details missing from the description that the insurer usually asks for (who, what, when, where, how, injuries, witnesses, third parties)"),
  extraItems: z.array(z.string()).describe("Other evidence that would help for this kind of incident, if any"),
  guidance: z.string().describe("Two to four short sentences of plain-language guidance on what to provide next. No promises about the outcome."),
});

/**
 * Claim completeness check: required evidence for the category/incident vs uploaded
 * documents and the description. Deterministic checklist + optional AI guidance.
 * Stored on `claims.completeness`. Never predicts or implies the claim decision.
 */
export async function claimCompleteness(auth: UserAuth, claimId: string) {
  const { data: claim } = await auth.supabase
    .from("claims")
    .select("id, reference, status, incident_type, incident_at, location, description, amount_claimed, third_parties, insurer_org_id, broker_org_id, policy:policies!claims_policy_id_fkey(id, category:product_categories(slug, name))")
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) throw notFound("Claim not found.");
  const policy = claim.policy as unknown as { id: string; category: { slug: string; name: string } | null } | null;
  const categorySlug = policy?.category?.slug ?? "other";

  const { data: docs } = await auth.supabase.from("documents").select("id, kind, file_name, created_at").eq("claim_id", claim.id);
  const kinds = new Map<string, number>();
  for (const d of docs ?? []) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);

  const required = requiredEvidence(categorySlug, claim.incident_type);
  const description = claim.description ?? "";
  const checklist = required.map((item) => {
    let status: "provided" | "missing" | "unclear";
    if (item.key === "description") status = description.trim().length >= 40 ? "provided" : description.trim() ? "unclear" : "missing";
    else if (item.documentKind) status = kinds.get(item.documentKind) ? "provided" : kinds.get("claim_evidence") || kinds.get("other") ? "unclear" : "missing";
    else status = "unclear";
    return { key: item.key, label: item.label, status, optional: !!item.optional, documentKind: item.documentKind ?? null };
  });
  const missing = checklist.filter((c) => c.status === "missing" && !c.optional).map((c) => c.label);

  let ai: z.infer<typeof AiCompleteness> | null = null;
  let model: string | null = null;
  if (await aiFlagOn("ai_assistant")) {
    const models = await getModels();
    model = models.fast;
    const started = Date.now();
    try {
      const { output, usage } = await generateText({
        model: models.fast,
        instructions: `${BASE_INSTRUCTIONS}

Task: check whether a claim notification looks complete enough for the broker to deliver it to the insurer. You do not assess cover and you must not suggest whether it will be approved. Focus on missing facts and evidence.`,
        prompt: JSON.stringify({
          category: policy?.category?.name ?? categorySlug,
          incidentType: claim.incident_type,
          incidentDate: claim.incident_at?.slice(0, 10) ?? null,
          location: claim.location ? redactPII(claim.location) : null,
          description: redactPII(description).slice(0, 4000),
          amountClaimed: claim.amount_claimed,
          thirdPartiesListed: Array.isArray(claim.third_parties) ? claim.third_parties.length : 0,
          checklist: checklist.map((c) => ({ item: c.label, status: c.status })),
        }),
        output: Output.object({ schema: AiCompleteness }),
      });
      ai = output;
      await logAiUsage({ feature: "claim_completeness", model: models.fast, usage, latencyMs: Date.now() - started, success: true, userId: auth.userId });
    } catch (err) {
      log.warn("ai.claim_completeness_failed", { claimId, err });
      await logAiUsage({ feature: "claim_completeness", model: models.fast, latencyMs: Date.now() - started, success: false, userId: auth.userId });
    }
  }

  const result = {
    checkedAt: new Date().toISOString(),
    checklist,
    missing,
    complete: missing.length === 0 && (ai?.descriptionGaps.length ?? 0) === 0,
    descriptionGaps: ai?.descriptionGaps ?? [],
    extraItems: ai?.extraItems ?? [],
    guidance:
      ai?.guidance ??
      (missing.length
        ? `Please add: ${missing.join("; ")}. Your broker will check everything before it is delivered to the insurer.`
        : "Everything usually needed appears to be here. Your broker will check it before it is delivered to the insurer."),
    aiAssisted: !!ai,
    model,
    label: ai ? "AI-assisted checklist — your broker reviews it." : "Checklist — your broker reviews it.",
    disclaimer: CLAIM_DISCLAIMER,
  };

  // Service client: customers can't update claim columns other than reporting fields
  // (claims guard), and this is a system-computed field. Read access was verified above.
  await createServiceClient().from("claims").update({ completeness: result as unknown as Json, required_evidence: required as unknown as Json }).eq("id", claim.id);
  return { claimId: claim.id, completeness: result };
}
