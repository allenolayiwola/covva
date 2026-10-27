"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { BrokerQuoteInput, QUOTE_STATUS } from "@im/core";
import { notifyOrg } from "@/server/notify";
import { applyLoyaltyToQuote } from "@/server/loyalty";
import { ROLES, actionContext, dbMessage, run, type ActionState, type PartnerContext } from "../../_lib/context";

const uuid = z.string().uuid();
const optional = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

async function loadSubmission(ctx: PartnerContext, id: string) {
  const { data } = await ctx.supabase
    .from("insurer_submissions")
    .select("id, status, request_id, broker_org_id, insurer_org_id, request:requests!insurer_submissions_request_id_fkey(reference, category_id)")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.insurer_org_id !== ctx.orgId) return null;
  return { ...data, request: data.request as unknown as { reference: string; category_id: string } | null };
}

export async function acknowledgeSubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const sub = await loadSubmission(ctx, uuid.parse(formData.get("submissionId")));
    if (!sub) return { ok: false, error: "Submission not found." };
    if (!["pending", "sent"].includes(sub.status)) return { ok: false, error: "This submission has already been acknowledged or answered." };
    const { error } = await ctx.supabase.from("insurer_submissions").update({ status: "acknowledged" }).eq("id", sub.id);
    if (error) return { ok: false, error: dbMessage(error) };
    if (sub.broker_org_id) await notifyOrg(sub.broker_org_id, { kind: "submission.acknowledged", title: `${ctx.orgName} acknowledged ${sub.request?.reference ?? "your submission"}`, link: `/partner/requests/${sub.request_id}` });
    refresh();
    return { ok: true, message: "Acknowledged. The broker has been told." };
  });
}

export async function declineSubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const input = z.object({ submissionId: uuid, reason: z.string().trim().min(5, "Give the broker a reason they can share with the customer").max(1000) }).parse(Object.fromEntries(formData));
    const sub = await loadSubmission(ctx, input.submissionId);
    if (!sub) return { ok: false, error: "Submission not found." };
    if (["declined", "withdrawn"].includes(sub.status)) return { ok: false, error: "This submission is already closed." };
    const now = new Date().toISOString();
    const { error } = await ctx.supabase.from("insurer_submissions").update({ status: "declined", decline_reason: input.reason, responded_at: now }).eq("id", sub.id);
    if (error) return { ok: false, error: dbMessage(error) };
    await ctx.supabase
      .from("quotes")
      .update({ status: "declined" })
      .eq("request_id", sub.request_id)
      .eq("insurer_org_id", ctx.orgId)
      .in("status", ["estimate", "awaiting_underwriting"]);
    if (sub.broker_org_id) await notifyOrg(sub.broker_org_id, { kind: "submission.declined", title: `${ctx.orgName} declined ${sub.request?.reference ?? "a submission"}`, body: input.reason, link: `/partner/requests/${sub.request_id}` });
    refresh();
    return { ok: true, message: "Declined. Any open estimate from you on this request is marked declined." };
  });
}

/** Respond with a quote: updates the open estimate for this submission if there is one, else inserts. */
export async function respondWithQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const submissionId = uuid.parse(formData.get("submissionId"));
    const sub = await loadSubmission(ctx, submissionId);
    if (!sub) return { ok: false, error: "Submission not found." };
    if (["declined", "withdrawn", "error"].includes(sub.status)) return { ok: false, error: "This submission is closed." };

    const parsed = BrokerQuoteInput.safeParse({
      requestId: sub.request_id,
      insurerOrgId: ctx.orgId,
      productVersionId: optional(formData.get("productVersionId")),
      status: formData.get("status"),
      premium: formData.get("premium"),
      excess: optional(formData.get("excess")),
      sumInsured: optional(formData.get("sumInsured")),
      keyExclusion: optional(formData.get("keyExclusion")),
      validUntil: optional(formData.get("validUntil")),
      brokerNote: optional(formData.get("brokerNote")),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ") };
    const q = parsed.data;
    if (q.premium <= 0) return { ok: false, error: "Enter a premium greater than zero." };
    const validUntil = q.validUntil ? new Date(`${q.validUntil}T23:59:00Z`).toISOString() : null;
    if (validUntil && Date.parse(validUntil) < Date.now()) return { ok: false, error: "Validity must be in the future." };

    let version: Record<string, unknown> | null = null;
    if (q.productVersionId) {
      const { data } = await ctx.supabase
        .from("product_versions")
        .select("id, product_id, coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions, product:products!product_versions_product_id_fkey(insurer_org_id)")
        .eq("id", q.productVersionId)
        .maybeSingle();
      if (!data || (data.product as unknown as { insurer_org_id: string } | null)?.insurer_org_id !== ctx.orgId) return { ok: false, error: "Choose one of your own products." };
      version = data;
    }
    const terms = version
      ? {
          product_id: version.product_id as string,
          product_version_id: version.id as string,
          coverage: version.coverage as never,
          limits: version.limits as never,
          excesses: version.excesses as never,
          exclusions: version.exclusions as string[],
          waiting_period_days: version.waiting_period_days as number,
          optional_benefits: version.optional_benefits as never,
          conditions: version.conditions as string | null,
        }
      : {};
    const fields = {
      status: q.status,
      premium: q.premium,
      excess: q.excess ?? null,
      sum_insured: q.sumInsured ?? null,
      key_exclusion: q.keyExclusion ?? (version?.key_exclusion as string | null) ?? null,
      valid_until: validUntil,
      broker_note: q.brokerNote ?? null,
      prepared_by: ctx.userId,
      ...terms,
    };

    const { data: existing } = await ctx.supabase
      .from("quotes")
      .select("id")
      .eq("insurer_org_id", ctx.orgId)
      .eq("request_id", sub.request_id)
      .or(`submission_id.eq.${sub.id},submission_id.is.null`)
      .in("status", ["estimate", "awaiting_underwriting", "ready_to_accept"])
      .order("created_at", { ascending: false })
      .limit(1);

    const { data: saved, error } = existing?.length
      ? await ctx.supabase.from("quotes").update({ ...fields, submission_id: sub.id }).eq("id", existing[0]!.id).select("id").maybeSingle()
      : await ctx.supabase
          .from("quotes")
          .insert({
            ...fields,
            request_id: sub.request_id,
            submission_id: sub.id,
            insurer_org_id: ctx.orgId,
            broker_org_id: sub.broker_org_id,
            // Insurer-direct orders have no broker of record (Addendum 2 D): the disclosure says so.
            commission_disclosure: sub.broker_org_id ? "The broker of record may receive commission from the insurer. Ask your broker for details." : "Issued directly by the insurer. There is no broker of record and no broker commission on this quote.",
          })
          .select("id")
          .maybeSingle();
    if (error) return { ok: false, error: dbMessage(error, "We couldn't save the quote.") };
    // Phase 4 loyalty: re-price the discount lines for the (new) premium — explicit lines, premium untouched.
    if (saved?.id) await applyLoyaltyToQuote(saved.id);

    await ctx.supabase.from("insurer_submissions").update({ status: "quoted", responded_at: new Date().toISOString() }).eq("id", sub.id);
    if (sub.broker_org_id) await notifyOrg(sub.broker_org_id, {
      kind: "quote.insurer_response",
      title: `${ctx.orgName} quoted ${sub.request?.reference ?? ""}: ${QUOTE_STATUS[q.status].label}`,
      link: `/partner/requests/${sub.request_id}#quotes`,
      data: { request_id: sub.request_id },
    });
    refresh();
    return { ok: true, message: existing?.length ? "Quote updated and sent to the broker." : "Quote sent to the broker." };
  });
}
