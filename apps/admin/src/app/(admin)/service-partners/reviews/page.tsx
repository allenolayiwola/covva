import { Suspense } from "react";
import { PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { moderateReview } from "./actions";

export default function PartnerReviewsPage({ searchParams }: PageProps<"/service-partners/reviews">) {
  return (
    <>
      <PageHeader title="Partner reviews" description="Customer ratings of garages, towing, hospitals and other partners after a completed claim job. Hide abusive, off-topic or personal-data reviews; ratings show publicly from 3 published reviews." />
      <Suspense fallback={<LoadingBlock label="Loading reviews…" />}>
        <Reviews searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Reviews({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const status = sp(params, "status") ?? "published";
  const canAct = can(staff.roles, "conduct");
  const supabase = await createClient();
  let q = supabase.from("service_partner_reviews").select("*, partner:service_partners(name, rating, review_count)").order("created_at", { ascending: false }).limit(200);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  const rows = (data ?? []) as unknown as (NonNullable<typeof data>[number] & { partner: { name: string; rating: number | null; review_count: number } | null })[];
  return (
    <>
      <FilterBar action="/service-partners/reviews">
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "published", label: "Published" }, { value: "hidden", label: "Hidden" }, { value: "all", label: "All" }]} />
      </FilterBar>
      <ReadOnlyBanner show={!canAct} />
      {error && <p className="mb-3 text-sm text-danger">{error.message}</p>}
      <Table>
        <THead><tr><Th>Partner</Th><Th>Rating</Th><Th>Comment</Th><Th>Status</Th><Th>Posted</Th><Th>&nbsp;</Th></tr></THead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <Td><p className="font-semibold text-ink">{r.partner?.name ?? "—"}</p><p className="text-xs text-muted">{r.partner?.rating != null ? `${Number(r.partner.rating).toFixed(2)} avg · ` : ""}{r.partner?.review_count ?? 0} published</p></Td>
              <Td className="whitespace-nowrap">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></Td>
              <Td className="max-w-md text-sm">{r.comment ?? <span className="text-muted">No comment</span>}{r.hidden_reason && <p className="mt-1 text-xs text-danger">Hidden: {r.hidden_reason}</p>}</Td>
              <Td><Pill tone={r.status === "published" ? "ok" : "neutral"}>{r.status}</Pill></Td>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
              <Td>
                {canAct && (r.status === "published" ? (
                  <ConfirmAction action={moderateReview} fields={{ reviewId: r.id, status: "hidden" }} label="Hide" title="Hide this review" body="The review stays on record but no longer counts towards the partner's public rating." confirmLabel="Hide review" />
                ) : (
                  <ConfirmAction action={moderateReview} fields={{ reviewId: r.id, status: "published" }} label="Publish" title="Publish this review again" confirmLabel="Publish" variant="primary" requireReason={false} />
                ))}
              </Td>
            </tr>
          ))}
          {!rows.length && <tr><Td colSpan={6} className="text-muted">No reviews.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
