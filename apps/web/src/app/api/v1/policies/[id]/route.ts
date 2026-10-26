import { CLAIM_STATUS, POLICY_STATUS, UpdatePolicyInput, buildDisclosure } from "@im/core";
import { getSetting } from "@/lib/catalog";
import { must, parseJson, uuidParam, withApi } from "@/server/api-auth";

/** GET /api/v1/policies/{id} — policy, wording summary, documents, claims and disclosure. */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/policies/[id]">) => {
    const id = uuidParam((await route.params).id);
    const sb = auth.supabase;
    const policy = must(
      await sb
        .from("policies")
        .select("*, category:product_categories(id, slug, name, icon), insurer:organizations!policies_insurer_org_id_fkey(id, name, logo_url, contact_phone, contact_email, settings), broker:organizations!policies_broker_org_id_fkey(id, name, nic_licence_number, contact_phone, contact_email, settings), version:product_versions(coverage, limits, excesses, exclusions, key_exclusion, waiting_period_days, optional_benefits, conditions, claims_process, wording_url)")
        .eq("id", id)
        .maybeSingle(),
      "Policy not found.",
    );
    const [docs, claims, renewals, brand] = await Promise.all([
      sb.from("documents").select("id, kind, file_name, mime_type, size_bytes, uploaded_by_party, created_at").eq("policy_id", id).order("created_at"),
      sb.from("claims").select("id, reference, status, incident_type, reported_at, created_at").eq("policy_id", id).order("created_at", { ascending: false }),
      sb.from("requests").select("id, reference, status, type, created_at").eq("related_policy_id", id).order("created_at", { ascending: false }),
      getSetting<{ name?: string }>("brand"),
    ]);
    const broker = policy.broker as unknown as { name: string; nic_licence_number: string | null } | null;
    const insurer = policy.insurer as unknown as { name: string; settings: { demo?: boolean } | null } | null;
    return {
      policy: {
        ...policy,
        statusLabel: policy.external_source && policy.status === "active" ? "Added by you" : POLICY_STATUS[policy.status].label,
        statusHint: POLICY_STATUS[policy.status].customerHint ?? null,
        coverActive: policy.status === "active" && !policy.external_source,
        demo: !!insurer?.settings?.demo,
      },
      documents: docs.data ?? [],
      claims: (claims.data ?? []).map((c) => ({ ...c, statusLabel: CLAIM_STATUS[c.status].label })),
      renewals: renewals.data ?? [],
      disclosure: broker ? buildDisclosure({ platform: brand?.name, broker: { name: broker.name, licence: broker.nic_licence_number }, insurer: insurer ? { name: insurer.name } : null }) : null,
    };
  },
  { auth: "user" },
);

/** PATCH /api/v1/policies/{id} — rename (nickname). Customers can change nothing else. */
export const PATCH = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/policies/[id]">) => {
    const id = uuidParam((await route.params).id);
    const { nickname } = await parseJson(req, UpdatePolicyInput);
    return must(await auth.supabase.from("policies").update({ nickname: nickname || null }).eq("id", id).eq("customer_id", auth.userId).select("id, nickname").maybeSingle(), "Policy not found.");
  },
  { auth: "user" },
);
