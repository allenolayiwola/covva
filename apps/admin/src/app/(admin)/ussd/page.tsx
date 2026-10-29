import { Suspense } from "react";
import { Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { sp, type SearchParams } from "@/lib/query";
import { LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { fromTable, type UssdSessionRow } from "@/lib/phase3-tables";
import { UssdSimulator } from "./simulator";

function maskPhone(p: string) {
  return p.length > 7 ? `${p.slice(0, 6)}***${p.slice(-3)}` : p;
}

export default function UssdPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <>
      <PageHeader
        title="USSD"
        description="Feature-phone channel: quote, renew, pay an instalment, check a policy, claim callback, talk to us. Aggregator-dependent (Africa's Talking, Hubtel or Arkesel) on an NCA-approved short code — see docs/OPERATIONS.md › USSD. The simulator runs the production engine."
      />
      <Suspense fallback={<LoadingBlock label="Loading…" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Body({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const staff = await requireStaff();
  const supabase = await createClient();
  const canSim = can(staff.roles, "ussd");
  const provider = sp(params, "provider");
  let query = fromTable(supabase, "ussd_sessions").select("*").order("created_at", { ascending: false }).limit(100);
  if (provider) query = query.eq("provider", provider);
  const { data, error } = await query;
  const sessions = (data ?? []) as UssdSessionRow[];
  const serviceCode = process.env.USSD_SERVICE_CODE ?? "*920*44#";

  return (
    <div className="space-y-6">
      <ReadOnlyBanner show={!canSim} />
      <Panel title="Simulator" description={`Service code ${serviceCode} · active aggregator: ${process.env.USSD_PROVIDER ?? "not set"} (set USSD_PROVIDER on the web app).`}>
        <UssdSimulator serviceCode={serviceCode} readOnly={!canSim} />
      </Panel>
      <Panel title="Session log" description="Newest first (100). History and the customer snapshot are kept in state; MSISDNs are masked here." bodyClassName="p-0">
        {error && <p className="p-4 text-sm text-danger">Couldn&apos;t load sessions: {error.message}</p>}
        <Table>
          <THead><tr><Th>Started</Th><Th>Provider</Th><Th>MSISDN</Th><Th>Network</Th><Th>Customer</Th><Th>Inputs</Th><Th>Last step</Th><Th>Ended</Th></tr></THead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <Td className="text-xs">{formatDateTime(s.created_at)}</Td>
                <Td><Pill tone={s.provider === "simulator" ? "neutral" : "info"}>{s.provider}</Pill></Td>
                <Td className="font-mono text-xs">{maskPhone(s.msisdn)}</Td>
                <Td className="text-xs">{s.network ?? "—"}</Td>
                <Td className="text-xs">{s.customer_id ? "Known" : s.lead_id ? "Lead" : "Unknown"}</Td>
                <Td className="font-mono text-xs">{(s.state?.history ?? []).join("*") || "—"}</Td>
                <Td className="font-mono text-xs">{s.step}</Td>
                <Td className="text-xs">{s.ended_at ? `${formatDateTime(s.ended_at)}${s.end_reason ? ` · ${s.end_reason}` : ""}` : <Pill tone="wait">open</Pill>}</Td>
              </tr>
            ))}
            {!sessions.length && <tr><Td colSpan={8} className="py-8 text-center text-muted">No USSD sessions yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
