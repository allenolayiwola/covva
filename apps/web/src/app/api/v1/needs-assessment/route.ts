import { NEEDS_QUESTIONS, NeedsAssessmentInput, assessNeeds } from "@im/core";
import type { Json } from "@im/db";
import { getCategories } from "@/lib/catalog";
import { createServiceClient } from "@/lib/supabase/server";
import { parseJson, withApi } from "@/server/api-auth";

/** GET /api/v1/needs-assessment — the questions (shared with web). */
export const GET = withApi(async () => ({ questions: NEEDS_QUESTIONS }), { auth: "none" });

/**
 * POST /api/v1/needs-assessment — run "help me choose" and store the answers.
 * Signed-in users store via RLS; anonymous runs are stored with an anonymous id via
 * the service client (no anon insert policy exists; the row has no user attached).
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, NeedsAssessmentInput);
    const result = assessNeeds(input.answers);
    const categories = await getCategories();
    const suggestions = result.suggestions.map((s) => {
      const c = categories.find((x) => x.slug === s.slug);
      return { ...s, name: c?.name ?? s.slug, availability: c?.availability ?? "planned", icon: c?.icon ?? null };
    });
    const row = { answers: input.answers as Json, suggested_categories: suggestions as unknown as Json };
    const { data } = auth
      ? await auth.supabase.from("needs_assessments").insert({ ...row, user_id: auth.userId }).select("id").single()
      : await createServiceClient().from("needs_assessments").insert({ ...row, anonymous_id: input.anonymousId ?? null }).select("id").single();
    return {
      id: data?.id ?? null,
      suggestions,
      needsAdviser: result.needsAdviser,
      adviserReason: result.adviserReason ?? null,
      note: "These are categories to consider, not product advice. Your broker of record advises on suitability.",
    };
  },
  { auth: "optional" },
);
