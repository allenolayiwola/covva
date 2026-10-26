import { DisclosureAckInput, buildDisclosure } from "@im/core";
import { getSetting } from "@/lib/catalog";
import { check, parseJson, rule, uuidParam, withApi } from "@/server/api-auth";
import { requestForCustomer } from "@/server/access";

/** POST /api/v1/requests/{id}/disclosure — customer acknowledges the broker-of-record disclosure. Idempotent. */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/requests/[id]/disclosure">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, DisclosureAckInput);
    const request = await requestForCustomer(auth, id);
    if (!request.broker_org_id) throw rule("A broker of record hasn't been assigned yet.");

    const { data: existing } = await auth.supabase
      .from("broker_disclosures")
      .select("id, broker_org_id, stage, method, disclosure_text, acknowledged_at")
      .eq("request_id", id)
      .eq("broker_org_id", request.broker_org_id)
      .eq("stage", input.stage)
      .maybeSingle();
    if (existing) return { disclosure: existing, created: false };

    const { data: broker } = await auth.supabase.from("organizations").select("name, nic_licence_number").eq("id", request.broker_org_id).single();
    const brand = await getSetting<{ name?: string }>("brand");
    const text = buildDisclosure({ platform: brand?.name, broker: { name: broker?.name ?? "Your broker", licence: broker?.nic_licence_number } });
    const res = await auth.supabase
      .from("broker_disclosures")
      .insert({ request_id: id, broker_org_id: request.broker_org_id, shown_to: auth.userId, method: input.method, stage: input.stage, disclosure_text: text })
      .select("id, broker_org_id, stage, method, disclosure_text, acknowledged_at")
      .single();
    check(res);
    return Response.json({ ok: true, data: { disclosure: res.data, created: true } }, { status: 201 });
  },
  { auth: "user" },
);
