import { Suspense } from "react";
import Link from "next/link";
import { PageHeader, Pill, Table, THead, Th, Td, Tabs } from "@im/ui";
import type { Enum } from "@im/db";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { pageOf, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { LoadingBlock, Pagination, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { reviewKyc } from "./actions";

const TONE: Record<Enum<"kyc_status">, "ok" | "wait" | "danger" | "neutral"> = { verified: "ok", pending: "wait", rejected: "danger", unverified: "neutral" };

export default function KycPage({ searchParams }: PageProps<"/kyc">) {
  return (
    <>
      <PageHeader title="KYC review" description="Ghana Card identity checks awaiting a human decision. Approving updates the customer's verification status." />
      <Suspense fallback={<LoadingBlock label="Loading verifications…" />}>
        <KycList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function maskId(id: string | null): string {
  if (!id) return "—";
  return id.length <= 6 ? id : `${id.slice(0, 4)}••••${id.slice(-3)}`;
}

async function KycList({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const view = sp(params, "view") === "all" ? "all" : "pending";
  const { page, from, to } = pageOf(params);
  let query = supabase
    .from("kyc_verifications")
    .select("id, user_id, method, id_number, status, provider, provider_reference, result, reviewed_by, reviewed_at, created_at", { count: "exact" })
    .order("created_at", { ascending: view === "pending" })
    .range(from, to);
  if (view === "pending") query = query.eq("status", "pending");
  const { data, count } = await query;
  const rows = data ?? [];
  const people = await profileMap(supabase, rows.flatMap((r) => [r.user_id, r.reviewed_by]));
  const { data: profiles } = rows.length
    ? await supabase.from("profiles").select("id, date_of_birth, ghana_card_number, kyc_status").in("id", rows.map((r) => r.user_id))
    : { data: [] };
  const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const canAct = can(staff.roles, "conduct");

  return (
    <>
      <Tabs className="mb-4 w-fit" active={view} items={[{ key: "pending", label: "Pending", href: "/kyc" }, { key: "all", label: "All", href: "/kyc?view=all" }]} />
      <ReadOnlyBanner show={!canAct} />
      <Table>
        <THead><tr><Th>Customer</Th><Th>Method</Th><Th>ID number</Th><Th>Provider result</Th><Th>Status</Th><Th>Submitted</Th><Th /></tr></THead>
        <tbody>
          {rows.map((v) => {
            const prof = pmap.get(v.user_id);
            const idMatches = prof?.ghana_card_number && v.id_number ? prof.ghana_card_number === v.id_number : null;
            return (
              <tr key={v.id} className="align-top">
                <Td>
                  <Link href={`/users/${v.user_id}`} className="font-semibold text-ink hover:text-brand">{personName(people.get(v.user_id))}</Link>
                  <p className="text-xs text-muted">DOB {prof?.date_of_birth ?? "—"}</p>
                </Td>
                <Td className="capitalize">{v.method.replace("_", " ")}</Td>
                <Td>
                  <span className="font-mono text-xs">{maskId(v.id_number)}</span>
                  {idMatches !== null && <Pill tone={idMatches ? "ok" : "danger"} className="ml-2">{idMatches ? "matches profile" : "differs from profile"}</Pill>}
                </Td>
                <Td className="max-w-xs text-xs text-muted">
                  {v.provider ?? "Manual"}
                  {v.result ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-brand">View result</summary>
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-mist p-2 text-[11px]">{JSON.stringify(v.result, null, 2)}</pre>
                    </details>
                  ) : null}
                </Td>
                <Td>
                  <Pill tone={TONE[v.status]}>{v.status}</Pill>
                  {v.reviewed_at && <p className="mt-1 text-xs text-muted">{personName(people.get(v.reviewed_by ?? ""), "staff")} · {formatDateTime(v.reviewed_at)}</p>}
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(v.created_at)}</Td>
                <Td>
                  {v.status === "pending" && (
                    <div className="flex flex-col items-end gap-2">
                      <ActionForm action={reviewKyc} inline submitLabel="Approve" readOnly={!canAct}>
                        <input type="hidden" name="verificationId" value={v.id} />
                        <input type="hidden" name="decision" value="verified" />
                      </ActionForm>
                      <ConfirmAction
                        action={reviewKyc}
                        fields={{ verificationId: v.id, decision: "rejected" }}
                        label="Reject"
                        title="Reject identity verification"
                        confirmLabel="Reject"
                        reasonLabel="Reason (the customer will be asked to try again)"
                        disabled={!canAct}
                      />
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={7} className="py-10 text-center text-muted">{view === "pending" ? "No verifications waiting for review." : "No verifications yet."}</Td></tr>}
        </tbody>
      </Table>
      <Pagination base="/kyc" params={params} page={page} total={count} />
    </>
  );
}
