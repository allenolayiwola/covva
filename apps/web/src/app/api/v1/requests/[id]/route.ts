import { REQUEST_STATUS, buildDisclosure, canTransitionRequest } from "@im/core";
import { getSetting } from "@/lib/catalog";
import { must, uuidParam, withApi } from "@/server/api-auth";
import { requestForCaller } from "@/server/access";

/** GET /api/v1/requests/{id} — request, customer-visible timeline, tasks, broker, documents, quotes summary, payments. */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/requests/[id]">) => {
    const id = uuidParam((await route.params).id);
    const { party } = await requestForCaller(auth, id);
    const sb = auth.supabase;
    const request = must(
      await sb
        .from("requests")
        .select("*, category:product_categories(id, slug, name, icon, availability, required_documents, regulatory_note), broker:organizations!requests_broker_org_id_fkey(id, name, nic_licence_number, contact_email, contact_phone, logo_url, settings)")
        .eq("id", id)
        .maybeSingle(),
      "Request not found.",
    );
    let events = sb.from("request_events").select("id, event, from_status, to_status, note, actor_party, created_at, visible_to_customer").eq("request_id", id).order("created_at");
    if (party === "customer") events = events.eq("visible_to_customer", true);
    const [ev, tasks, documents, disclosures, applications, payments, policies, quoteCounts, brand] = await Promise.all([
      events,
      sb.from("request_tasks").select("id, kind, title, detail, document_kind, assignee_party, status, due_at, completed_at, created_at").eq("request_id", id).order("created_at"),
      sb.from("documents").select("id, kind, file_name, mime_type, size_bytes, task_id, uploaded_by_party, verified, delivered_to_insurer_at, created_at").eq("request_id", id).order("created_at"),
      sb.from("broker_disclosures").select("id, broker_org_id, stage, method, acknowledged_at").eq("request_id", id).order("acknowledged_at"),
      sb.from("applications").select("id, quote_id, status, submitted_at, decided_at, created_at").eq("request_id", id).order("created_at", { ascending: false }),
      sb.from("payments").select("id, status, amount, currency, channel, provider, provider_reference, paid_at, failure_reason, created_at").eq("request_id", id).order("created_at", { ascending: false }),
      sb.from("policies").select("id, status, internal_reference, policy_number, cover_start, cover_end").eq("request_id", id),
      sb.from("quotes").select("status").eq("request_id", id),
      getSetting<{ name?: string }>("brand"),
    ]);
    const broker = request.broker as unknown as { id: string; name: string; nic_licence_number: string | null; settings: Record<string, unknown> | null } | null;
    const counts: Record<string, number> = {};
    for (const q of quoteCounts.data ?? []) counts[q.status] = (counts[q.status] ?? 0) + 1;
    const { risk_data, risk_fingerprint, ...rest } = request;
    return {
      request: {
        ...rest,
        risk_data,
        statusLabel: REQUEST_STATUS[request.status].label,
        statusHint: REQUEST_STATUS[request.status].customerHint ?? null,
        canCancel: party === "customer" && canTransitionRequest(request.status, "cancelled", "customer"),
      },
      party,
      broker: broker
        ? { ...broker, serviceHours: (broker.settings?.service_hours as string | undefined) ?? null, primaryContact: (broker.settings?.primary_contact as string | undefined) ?? null, demo: !!broker.settings?.demo }
        : null,
      disclosure: broker ? buildDisclosure({ platform: brand?.name, broker: { name: broker.name, licence: broker.nic_licence_number } }) : null,
      disclosureAcknowledged: !!broker && (disclosures.data ?? []).some((d) => d.broker_org_id === broker.id),
      timeline: ev.data ?? [],
      tasks: tasks.data ?? [],
      documents: documents.data ?? [],
      disclosures: disclosures.data ?? [],
      applications: applications.data ?? [],
      payments: payments.data ?? [],
      policies: policies.data ?? [],
      quoteCounts: counts,
      ...(risk_fingerprint && party !== "customer" ? { riskFingerprint: risk_fingerprint } : {}),
    };
  },
  { auth: "user" },
);
