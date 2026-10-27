import { Suspense } from "react";
import { Notice, PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { REFERRAL_CREDIT_NOTE } from "@im/core";
import { requireStaff, hasAnyRole } from "@/lib/auth";
import { PERMS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatGHS, humanize } from "@/lib/format";
import { ToggleForm } from "@/components/ui/forms";
import { LoadingBlock, Panel } from "@/components/ui/layout";
import { setRewardRuleActive } from "./actions";

/** Referral attributions, the append-only reward ledger and the reward rules (with the regulatory note). */
export default function ReferralsAdminPage() {
  return (
    <>
      <PageHeader title="Referrals & rewards" description="Who referred whom, conversions, and the reward ledger. Rewards never influence which quotes customers see or their order." />
      <Suspense fallback={<LoadingBlock label="Loading referrals…" />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const staff = await requireStaff();
  const canToggle = hasAnyRole(staff, PERMS.rewardRules);
  const supabase = await createClient();
  const [{ data: rules }, { data: attributions }, { data: ledger }] = await Promise.all([
    supabase.from("reward_rules").select("*").order("key"),
    supabase
      .from("referral_attributions")
      .select("id, code, source, first_touch_at, converted_at, rewards_evaluated_at, created_at, partner_org_id, link:referral_links!referral_attributions_code_fkey(owner_kind, campaign), request:requests!referral_attributions_request_id_fkey(reference), partner:organizations!referral_attributions_partner_org_id_fkey(name)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("reward_ledger").select("id, user_id, org_id, kind, amount, reference, rule_key, memo, expires_at, created_at, org:organizations!reward_ledger_org_id_fkey(name)").order("created_at", { ascending: false }).limit(100),
  ]);
  return (
    <div className="space-y-6">
      <Panel title="Reward rules">
        <div className="space-y-4">
          {(rules ?? []).map((r) => (
            <div key={r.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">{r.key} <span className="text-xs font-normal text-muted">· {humanize(r.kind)}{Number(r.amount) > 0 ? ` · ${formatGHS(Number(r.amount))}` : ""}</span></p>
                  <p className="mt-1 text-sm text-muted">{r.description}</p>
                </div>
                <ToggleForm action={setRewardRuleActive} fields={{ key: r.key }} checked={r.active} label={`${r.active ? "Switch off" : "Switch on"} ${r.key}`} disabled={!canToggle} />
              </div>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-mist px-3 py-2 text-xs">{JSON.stringify(r.conditions)}</pre>
              {r.regulatory_note && <Notice tone="wait" className="mt-3">{r.regulatory_note}</Notice>}
            </div>
          ))}
          <p className="text-xs text-muted">{REFERRAL_CREDIT_NOTE} Switching rules on/off: platform admin or compliance. The daily <code>referral-rewards</code> job (04:00) posts entries after each rule&apos;s holding period.</p>
        </div>
      </Panel>

      <Panel title="Attributions" description="Latest 100. One per request; partner API leads appear before the customer creates a request.">
        <Table>
          <THead><tr><Th>Created</Th><Th>Code</Th><Th>Owner</Th><Th>Source</Th><Th>Request</Th><Th>Converted</Th><Th>Rewards</Th></tr></THead>
          <tbody>
            {(attributions ?? []).map((a) => {
              const link = a.link as unknown as { owner_kind: string; campaign: string | null } | null;
              const request = a.request as unknown as { reference: string } | null;
              const partner = a.partner as unknown as { name: string } | null;
              return (
                <tr key={a.id}>
                  <Td className="text-xs">{formatDateTime(a.created_at)}</Td>
                  <Td className="font-mono text-xs">{a.code}</Td>
                  <Td className="text-xs">{humanize(link?.owner_kind ?? "")}{partner ? ` · ${partner.name}` : ""}{link?.campaign ? ` · ${link.campaign}` : ""}</Td>
                  <Td>{humanize(a.source)}</Td>
                  <Td className="text-xs">{request?.reference ?? "Lead only"}</Td>
                  <Td className="text-xs">{a.converted_at ? formatDate(a.converted_at) : "—"}</Td>
                  <Td>{a.rewards_evaluated_at ? <Pill tone="ok">Settled</Pill> : a.converted_at ? <Pill tone="wait">Holding</Pill> : <Pill>—</Pill>}</Td>
                </tr>
              );
            })}
            {!attributions?.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No attributions yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>

      <Panel title="Reward ledger" description="Append-only. Corrections are reversal or adjustment rows. Customer credits are not cash.">
        <Table>
          <THead><tr><Th>Date</Th><Th>Kind</Th><Th>Recipient</Th><Th>Rule</Th><Th>Memo</Th><Th className="text-right">Amount</Th></tr></THead>
          <tbody>
            {(ledger ?? []).map((l) => (
              <tr key={l.id}>
                <Td className="text-xs">{formatDateTime(l.created_at)}</Td>
                <Td>{humanize(l.kind)}</Td>
                <Td className="text-xs">{(l.org as unknown as { name: string } | null)?.name ?? (l.user_id ? `Customer ${l.user_id.slice(0, 8)}` : "—")}</Td>
                <Td className="font-mono text-xs">{l.rule_key ?? "—"}</Td>
                <Td className="text-xs text-muted">{l.memo ?? ""}{l.expires_at ? ` · expires ${formatDate(l.expires_at)}` : ""}</Td>
                <Td className="text-right tabular-nums">{formatGHS(Number(l.amount), { decimals: true })}</Td>
              </tr>
            ))}
            {!ledger?.length && <tr><Td colSpan={6} className="py-8 text-center text-muted">No reward entries yet.</Td></tr>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
