import { COMPLAINT_STATUS, FileComplaintInput } from "@im/core";
import { getSetting } from "@/lib/catalog";
import { createServiceClient } from "@/lib/supabase/server";
import { check, must, parseJson, rule, withApi } from "@/server/api-auth";
import { notify, notifyOrg } from "@/server/notify";

/** GET /api/v1/complaints — the customer's complaints. */
export const GET = withApi(
  async ({ auth }) => {
    const res = await auth.supabase
      .from("complaints")
      .select("id, reference, status, category, subject, against_party, due_at, acknowledged_at, resolved_at, outcome, created_at, request_id, policy_id, claim_id")
      .eq("customer_id", auth.userId)
      .order("created_at", { ascending: false });
    check(res);
    return (res.data ?? []).map((c) => ({ ...c, statusLabel: COMPLAINT_STATUS[c.status].label }));
  },
  { auth: "user" },
);

/** POST /api/v1/complaints — file a complaint against the broker, insurer or platform. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, FileComplaintInput);
    const sb = auth.supabase;
    let brokerOrg: string | null = null;
    let insurerOrg: string | null = null;
    if (input.requestId) {
      const r = must(await sb.from("requests").select("customer_id, broker_org_id").eq("id", input.requestId).maybeSingle(), "Request not found.");
      if (r.customer_id !== auth.userId) throw rule("You can only complain about your own request.");
      brokerOrg = r.broker_org_id;
    }
    if (input.policyId) {
      const p = must(await sb.from("policies").select("customer_id, broker_org_id, insurer_org_id").eq("id", input.policyId).maybeSingle(), "Policy not found.");
      if (p.customer_id !== auth.userId) throw rule("You can only complain about your own policy.");
      brokerOrg ??= p.broker_org_id;
      insurerOrg = p.insurer_org_id;
    }
    if (input.claimId) {
      const c = must(await sb.from("claims").select("customer_id, broker_org_id, insurer_org_id").eq("id", input.claimId).maybeSingle(), "Claim not found.");
      if (c.customer_id !== auth.userId) throw rule("You can only complain about your own claim.");
      brokerOrg ??= c.broker_org_id;
      insurerOrg ??= c.insurer_org_id;
    }
    if (input.againstParty === "broker" && !brokerOrg) {
      const { data: latest } = await sb.from("requests").select("broker_org_id").eq("customer_id", auth.userId).not("broker_org_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      brokerOrg = latest?.broker_org_id ?? null;
    }
    let ownerOrg = input.againstParty === "broker" ? brokerOrg : input.againstParty === "insurer" ? insurerOrg : null;
    if (input.againstParty === "insurer" && !ownerOrg) throw rule("Choose the policy or claim this complaint is about so we can send it to the right insurer.");
    if (input.againstParty === "platform" || !ownerOrg) {
      // Service client: the platform organisation isn't in the public directory customers can read.
      const { data: platform } = await createServiceClient().from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle();
      ownerOrg = platform?.id ?? null;
    }
    const slaDays = Number((await getSetting<number>("complaint_sla_days")) ?? 14) || 14;
    const complaint = must(
      await sb
        .from("complaints")
        .insert({
          customer_id: auth.userId,
          subject: input.subject,
          description: input.description,
          category: input.category,
          against_party: input.againstParty,
          owner_org_id: ownerOrg,
          request_id: input.requestId ?? null,
          policy_id: input.policyId ?? null,
          claim_id: input.claimId ?? null,
          desired_outcome: input.desiredOutcome ?? null,
          due_at: new Date(Date.now() + slaDays * 86_400_000).toISOString(),
        })
        .select("id, reference, status, due_at, against_party, created_at")
        .single(),
    );
    if (ownerOrg) {
      await notifyOrg(ownerOrg, { kind: "complaint.new", title: `New complaint ${complaint.reference}`, body: input.subject, link: `/partner/complaints/${complaint.id}`, data: { complaint_id: complaint.id }, channels: ["in_app", "email"] }, ["owner", "admin", "supervisor", "compliance", "platform_admin", "support"]);
    }
    await notify({
      userId: auth.userId,
      kind: "complaint.received",
      title: `Complaint ${complaint.reference} received`,
      body: `We aim to resolve it by ${complaint.due_at.slice(0, 10)}. If you're not satisfied with the outcome you can escalate to the National Insurance Commission.`,
      link: `/account/complaints/${complaint.id}`,
      data: { complaint_id: complaint.id },
      channels: ["in_app", "email"],
    });
    return Response.json({ ok: true, data: { complaint: { ...complaint, statusLabel: COMPLAINT_STATUS[complaint.status].label } } }, { status: 201 });
  },
  { auth: "user" },
);
