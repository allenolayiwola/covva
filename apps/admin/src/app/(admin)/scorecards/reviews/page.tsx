import { Suspense } from "react";
import Link from "next/link";
import { Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { maskReviewerName } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { orgMap, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { moderateBrokerReview } from "./actions";

export default function BrokerReviewsPage({ searchParams }: PageProps<"/scorecards/reviews">) {
  return (
    <>
      <PageHeader
        eyebrow="Broker scorecards"
        title="Review moderation"
        description="Customer ratings of brokers after a completed request or settled claim. Approve reviews that are fair and free of personal data; hide (with a reason) anything abusive, off-topic, unverifiable or that names people. Only approved reviews are shown, anonymised as “Ama K.” or “Verified customer”."
      />
      <Suspense fallback={<LoadingBlock label="Loading reviews…" />}>
        <Reviews searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUS_TONE = { pending: "wait", approved: "ok", hidden: "neutral" } as const;

async function Reviews({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const status = sp(params, "status") ?? "pending";
  const canAct = can(staff.roles, "conduct");
  const supabase = await createClient();
  let q = supabase.from("broker_reviews").select("*").order("created_at", { ascending: false }).limit(200);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  const rows = data ?? [];
  const [orgs, people] = await Promise.all([orgMap(supabase), profileMap(supabase, rows.map((r) => r.customer_id))]);
  return (
    <>
      <FilterBar action="/scorecards/reviews">
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "hidden", label: "Hidden" }, { value: "all", label: "All" }]} />
      </FilterBar>
      <ReadOnlyBanner show={!canAct} />
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Broker</Th><Th>Rating</Th><Th>Review</Th><Th>Customer</Th><Th>Status</Th><Th>Posted</Th><Th>&nbsp;</Th></tr></THead>
        <tbody>
          {rows.map((r) => {
            const p = people.get(r.customer_id);
            return (
              <tr key={r.id} className="align-top">
                <Td>
                  <Link href={`/organisations/${r.broker_org_id}`} className="font-semibold text-ink hover:text-brand">{orgs.get(r.broker_org_id)?.name ?? "—"}</Link>
                  <p className="text-xs text-muted">{r.subject_type === "claim" ? "After a settled claim" : "After a completed request"}</p>
                </Td>
                <Td className="whitespace-nowrap" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></Td>
                <Td className="max-w-md text-sm">
                  {r.comment ?? <span className="text-muted">No comment</span>}
                  {r.reply && <p className="mt-1 rounded bg-mist px-2 py-1 text-xs text-ink-2"><span className="font-medium">Broker reply:</span> {r.reply}</p>}
                  {r.moderation_reason && <p className="mt-1 text-xs text-danger">Moderation: {r.moderation_reason}</p>}
                </Td>
                <Td className="text-sm">
                  <p className="font-medium text-ink">{maskReviewerName(p?.full_name)}</p>
                  <Link href={`/users/${r.customer_id}`} className="text-xs text-brand hover:underline">Open customer (staff only)</Link>
                </Td>
                <Td><Pill tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "neutral"}>{r.status}</Pill></Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
                <Td>
                  {canAct && (
                    <div className="flex flex-col gap-1.5">
                      {r.status !== "approved" && <ConfirmAction action={moderateBrokerReview} fields={{ reviewId: r.id, status: "approved" }} label="Approve" title="Approve this review" body="It will be shown publicly with the customer's first name and initial only." confirmLabel="Approve" variant="primary" requireReason={false} />}
                      {r.status !== "hidden" && <ConfirmAction action={moderateBrokerReview} fields={{ reviewId: r.id, status: "hidden" }} label="Hide" title="Hide this review" body="The review stays on record and still counts in the broker's private scorecard, but is not shown publicly. The reason is recorded." confirmLabel="Hide review" />}
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">No {status === "all" ? "" : status} reviews.</Td></tr>}
        </tbody>
      </Table>
      <p className="mt-3 text-xs text-subtle">Rating and review text can never be edited. Hiding is reversible. <Link href="/scorecards" className="text-brand hover:underline">Broker scorecards</Link></p>
    </>
  );
}
