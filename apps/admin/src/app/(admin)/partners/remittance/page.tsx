import { Suspense } from "react";
import { Notice, PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { LoadingBlock } from "@/components/ui/layout";

const KIND_LABEL: Record<string, string> = { remittance: "Remittance provider", diaspora_bank: "Diaspora bank", embedded_partner: "Embedded partner" };
const TONE = { draft: "wait", active: "ok", suspended: "danger" } as const;

/** Placeholder list for future remittance / diaspora-bank partner APIs (roadmap Phase 4). Documented in docs/OPERATIONS.md; no customer UI yet. */
export default function RemittancePartnersPage() {
  return (
    <>
      <PageHeader title="Remittance & diaspora-bank partners" description="Placeholder for partner integrations that will quote and collect premiums through the API (remittance apps, diaspora banks, embedded partners). Keys are stored hashed; a partner becomes active only after the commercial and compliance review." />
      <Suspense fallback={<LoadingBlock label="Loading partners…" />}>
        <Partners />
      </Suspense>
    </>
  );
}

async function Partners() {
  await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("remittance_partners").select("id, name, slug, kind, status, webhook_url, api_key_hash, created_at, updated_at").order("name");
  return (
    <>
      <Notice tone="info" className="mb-4">No integration is live yet. Rows are created by platform engineering with the service key (see docs/OPERATIONS.md → Diaspora payments) once a partner agreement exists.</Notice>
      <Table>
        <THead><tr><Th>Partner</Th><Th>Kind</Th><Th>Status</Th><Th>Webhook</Th><Th>API key</Th><Th>Created</Th></tr></THead>
        <tbody>
          {(data ?? []).map((p) => (
            <tr key={p.id}>
              <Td><p className="font-medium text-ink">{p.name}</p><p className="text-xs text-muted">{p.slug}</p></Td>
              <Td>{KIND_LABEL[p.kind] ?? p.kind}</Td>
              <Td><Pill tone={TONE[p.status as keyof typeof TONE] ?? "neutral"}>{p.status}</Pill></Td>
              <Td className="text-xs">{p.webhook_url ?? "—"}</Td>
              <Td className="text-xs">{p.api_key_hash ? "set (hashed)" : "not issued"}</Td>
              <Td className="text-xs">{formatDate(p.created_at)}</Td>
            </tr>
          ))}
          {!data?.length && <tr><Td colSpan={6} className="py-8 text-center text-muted">No partners yet.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
