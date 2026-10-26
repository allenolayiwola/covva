import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Info } from "lucide-react";
import {
  LABELS,
  QUOTE_STATUS,
  buildDisclosure,
  compareQuotes,
  comparisonSummary,
  formatDate,
  formatDateTime,
  formatGHS,
  humanize,
  type ComparableQuote,
  type QuoteStatus,
  type ScoredQuote,
} from "@im/core";
import type { Row } from "@im/db";
import { Card, DemoBadge, DisclosureBlock, EmptyState, Notice, Pill, StatusPill, buttonClass, cn } from "@im/ui";
import { getFlags } from "@/lib/catalog";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { RealtimeRefresh } from "@/components/customer/realtime-refresh";
import { ORG_COLS, account, getRequestOr404, type OrgLite } from "../../../_lib/data";
import { NotifyButton } from "./notify-button";

export const metadata: Metadata = { title: "Compare quotes" };

export default function ComparePage({ params, searchParams }: PageProps<"/account/requests/[id]/quotes">) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Compare params={params} searchParams={searchParams} />
    </Suspense>
  );
}

type QuoteRow = Row<"quotes"> & { insurer: OrgLite | null };
type SortKey = "price" | "cover" | "excess";

const NON_MONEY = /(days|months|percent|members|count|max_family)/i;

function fmtLimit(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return NON_MONEY.test(key) ? v.toLocaleString("en-GH") : formatGHS(v);
  if (typeof v === "boolean") return v ? "Included" : "Not included";
  return String(v);
}

async function Compare({ params, searchParams }: Pick<PageProps<"/account/requests/[id]/quotes">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const sort: SortKey = sp.sort === "cover" || sp.sort === "excess" ? sp.sort : "price";
  const diffOnly = sp.diff === "1";
  const { supabase } = await account(`/account/requests/${id}/quotes`);
  const [request, flags] = await Promise.all([getRequestOr404(supabase, id), getFlags()]);

  const [quotesRes, appRes] = await Promise.all([
    supabase
      .from("quotes")
      .select(`*, insurer:organizations!quotes_insurer_org_id_fkey(${ORG_COLS})`)
      .eq("request_id", id)
      .in("status", ["estimate", "awaiting_underwriting", "ready_to_accept", "accepted"])
      .order("premium", { ascending: true }),
    supabase.from("applications").select("id, quote_id, status").eq("request_id", id).in("status", ["submitted", "accepted"]).order("created_at", { ascending: false }).limit(1),
  ]);
  const rows = (quotesRes.data ?? []) as unknown as QuoteRow[];
  const application = appRes.data?.[0] ?? null;
  const now = Date.now();
  const expired = (q: QuoteRow) => !!q.valid_until && new Date(q.valid_until).getTime() < now;

  const risk = (request.risk_data ?? {}) as Record<string, unknown>;
  const isMotor = request.category?.slug === "motor";
  const vehicle = isMotor ? [risk.vehicle_make, risk.vehicle_model, risk.vehicle_year].filter(Boolean).join(" ") : null;
  const coverType = typeof risk.cover_type === "string" ? humanize(risk.cover_type) : null;

  const comparable: ComparableQuote[] = rows.map((q) => ({
    id: q.id,
    insurerId: q.insurer_org_id,
    insurerName: q.insurer?.name ?? "Insurer",
    status: q.status as ComparableQuote["status"],
    premium: Number(q.premium),
    excess: q.excess != null ? Number(q.excess) : null,
    sumInsured: q.sum_insured != null ? Number(q.sum_insured) : null,
    coverage: (Array.isArray(q.coverage) ? q.coverage : []) as unknown as ComparableQuote["coverage"],
    exclusions: q.exclusions ?? [],
    keyExclusion: q.key_exclusion,
    waitingPeriodDays: q.waiting_period_days,
    optionalBenefits: (Array.isArray(q.optional_benefits) ? q.optional_benefits : []) as unknown as ComparableQuote["optionalBenefits"],
    validUntil: q.valid_until,
    paidPlacement: q.paid_placement,
  }));
  const cmp = compareQuotes(comparable);
  const byId = new Map(rows.map((q) => [q.id, q]));
  const scoredById = new Map(cmp.ranked.map((s) => [s.quote.id, s]));
  const ordered = [...cmp.ranked].sort((a, b) => {
    if (sort === "cover") return b.coverageCount - a.coverageCount || (b.quote.sumInsured ?? 0) - (a.quote.sumInsured ?? 0) || a.quote.premium - b.quote.premium;
    if (sort === "excess") return (a.quote.excess ?? Infinity) - (b.quote.excess ?? Infinity) || a.quote.premium - b.quote.premium;
    return a.quote.premium - b.quote.premium;
  });
  const paid = flags.paid_placements ? cmp.paidPlacements : [];
  const recommended = cmp.ranked.find((s) => s.labels.includes("recommended"));
  const respondedInsurers = new Set(rows.map((q) => q.insurer_org_id)).size;

  // Rows of the comparison table
  const limitKeys = [...new Set(ordered.flatMap((s) => Object.keys((byId.get(s.quote.id)?.limits ?? {}) as Record<string, unknown>)))].filter(
    (k) => k !== "vehicle_cover_limit" && k !== "currency_note",
  );
  type TableRow = { key: string; label: string; cell: (q: QuoteRow, s: ScoredQuote) => React.ReactNode; text: (q: QuoteRow) => string };
  const coverLimit = (q: QuoteRow) => {
    const lim = (q.limits ?? {}) as Record<string, unknown>;
    if (q.sum_insured != null) return formatGHS(Number(q.sum_insured));
    return fmtLimit("vehicle_cover_limit", lim.vehicle_cover_limit ?? lim.annual_limit);
  };
  const benefits = (q: QuoteRow) => ((Array.isArray(q.optional_benefits) ? q.optional_benefits : []) as { label: string; premium?: number }[]);
  const allRows: TableRow[] = [
    { key: "limit", label: isMotor ? "Vehicle cover limit" : "Sum insured / cover limit", cell: (q) => coverLimit(q), text: coverLimit },
    {
      key: "excess",
      label: isMotor ? "Own-damage excess" : "Main excess",
      cell: (q) => (q.excess != null ? formatGHS(Number(q.excess)) : "None"),
      text: (q) => (q.excess != null ? String(q.excess) : "none"),
    },
    ...limitKeys.map<TableRow>((k) => ({
      key: `lim:${k}`,
      label: humanize(k),
      cell: (q) => fmtLimit(k, ((q.limits ?? {}) as Record<string, unknown>)[k]),
      text: (q) => fmtLimit(k, ((q.limits ?? {}) as Record<string, unknown>)[k]),
    })),
    {
      key: "cover",
      label: "What's covered",
      cell: (_q, s) => (
        <ul className="space-y-0.5">
          {s.quote.coverage.map((c) => (
            <li key={c.key} className={c.included ? "text-ink-2" : "text-subtle line-through"}>
              {c.label}
            </li>
          ))}
        </ul>
      ),
      text: (q) => JSON.stringify(q.coverage),
    },
    { key: "exclusion", label: "Key exclusion", cell: (q) => q.key_exclusion ?? "—", text: (q) => q.key_exclusion ?? "" },
    {
      key: "waiting",
      label: "Waiting period",
      cell: (q) => (q.waiting_period_days ? `${q.waiting_period_days} days` : "None"),
      text: (q) => String(q.waiting_period_days),
    },
    {
      key: "benefits",
      label: "Optional benefits",
      cell: (q) =>
        benefits(q).length ? (
          <ul className="space-y-0.5">
            {benefits(q).map((b) => (
              <li key={b.label}>
                {b.label}
                {b.premium ? <span className="text-subtle"> +{formatGHS(b.premium)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          "None offered"
        ),
      text: (q) => JSON.stringify(q.optional_benefits),
    },
    {
      key: "valid",
      label: "Quote valid until",
      cell: (q) => (q.status === "ready_to_accept" ? (expired(q) ? <span className="text-danger">Expired {formatDate(q.valid_until)}</span> : formatDate(q.valid_until)) : "Pending"),
      text: (q) => q.valid_until ?? "pending",
    },
    { key: "quoted", label: "Quoted", cell: (q) => formatDateTime(q.updated_at ?? q.created_at), text: () => "" },
  ];
  const tableRows = diffOnly
    ? allRows.filter((r) => r.key === "limit" || r.key === "quoted" || new Set(ordered.map((s) => r.text(byId.get(s.quote.id)!))).size > 1)
    : allRows;

  const commission = [...new Set(rows.map((q) => q.commission_disclosure).filter(Boolean))] as string[];
  const disclosure = request.broker ? buildDisclosure({ broker: { name: request.broker.name, licence: request.broker.nic_licence_number } }) : null;
  const showDemo = !!flags.demo_mode;

  const action = (s: ScoredQuote, wide = true) => {
    const q = byId.get(s.quote.id)!;
    if (application) {
      return application.quote_id === q.id ? (
        <Link href={`/account/requests/${id}/apply/${q.id}`} className={buttonClass("primary", "md", wide ? "w-full" : "")}>Continue</Link>
      ) : null;
    }
    if (q.status === "ready_to_accept" && !expired(q)) {
      return (
        <Link
          href={`/account/requests/${id}/apply/${q.id}`}
          className={buttonClass(s.labels.includes("recommended") ? "primary" : "secondary", "md", wide ? "w-full" : "")}
        >
          Choose this quote
        </Link>
      );
    }
    if (q.status === "awaiting_underwriting" || q.status === "estimate") return <NotifyButton requestId={id} quoteId={q.id} />;
    if (expired(q)) return <p className="text-center text-sm text-muted">Expired — ask your broker to revalidate</p>;
    return null;
  };

  const sortHref = (k: SortKey) => `/account/requests/${id}/quotes?sort=${k}${diffOnly ? "&diff=1" : ""}`;

  return (
    <div>
      <RealtimeRefresh channel={`quotes:${id}`} watch={[{ table: "quotes", filter: `request_id=eq.${id}` }, { table: "requests", filter: `id=eq.${id}` }]} />
      <Breadcrumbs
        items={[
          { label: "Requests", href: "/account/requests" },
          { label: `${request.category?.name ?? ""} request ${request.reference}`, href: `/account/requests/${id}` },
          { label: "Compare" },
        ]}
      />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink sm:text-[44px]">Compare the cover, not just the price.</h1>
          <p className="mt-2 text-[15px] text-muted">
            {[coverType ? `${coverType} ${request.category?.name.toLowerCase()}` : request.category?.name, "12 months", vehicle, `${rows.length} broker-prepared quote${rows.length === 1 ? "" : "s"}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {rows.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Sort quotes" className="inline-flex rounded-xl bg-mist p-1">
              {(["price", "cover", "excess"] as SortKey[]).map((k) => (
                <Link
                  key={k}
                  href={sortHref(k)}
                  scroll={false}
                  aria-current={sort === k ? "true" : undefined}
                  className={cn("rounded-lg px-3.5 py-1.5 text-sm font-medium", sort === k ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink")}
                >
                  {humanize(k)}
                </Link>
              ))}
            </nav>
            <Link
              href={`/account/requests/${id}/quotes?sort=${sort}${diffOnly ? "" : "&diff=1"}`}
              scroll={false}
              className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium", diffOnly ? "bg-mint text-brand-deep" : "bg-mist text-muted hover:text-ink")}
            >
              {diffOnly ? "Showing differences only" : "Show differences only"}
            </Link>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="No quotes yet"
          body="Your broker is preparing quotes from participating insurers. We'll notify you when they're ready."
          action={<Link href={`/account/requests/${id}`} className={buttonClass("secondary")}>Back to request</Link>}
        />
      ) : (
        <>
          {application && (
            <Notice tone="info" className="mt-6">
              You&apos;ve already applied for one of these quotes. Continue your application or message your broker to change your choice.
            </Notice>
          )}

          {/* Desktop: side-by-side table (web-compare.jpg) */}
          <div className="mt-8 hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-[15px]">
              <caption className="sr-only">Quotes compared side by side</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-48 align-bottom pb-4 pr-4 text-sm font-normal text-muted">
                    Participating insurers
                    <span className="block font-semibold text-ink">{respondedInsurers} responded</span>
                  </th>
                  {ordered.map((s) => {
                    const q = byId.get(s.quote.id)!;
                    const rec = s.labels.includes("recommended");
                    return (
                      <th key={q.id} scope="col" className={cn("px-5 pb-4 pt-5 align-top font-normal", rec && "rounded-t-card bg-mist")}>
                        <InsurerHead q={q} s={s} demo={showDemo} />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="border-t border-line py-3.5 pr-4 align-top text-sm font-normal text-muted">{r.label}</th>
                    {ordered.map((s) => {
                      const q = byId.get(s.quote.id)!;
                      return (
                        <td key={q.id} className={cn("border-t border-line px-5 py-3.5 align-top text-ink", s.labels.includes("recommended") && "bg-mist")}>
                          {r.cell(q, s)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td />
                  {ordered.map((s) => (
                    <td key={s.quote.id} className={cn("px-5 pb-5 pt-4", s.labels.includes("recommended") && "rounded-b-card bg-mist")}>
                      {action(s)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards (mobile-compare-quotes.jpg) */}
          <ul className="mt-6 space-y-4 lg:hidden">
            {ordered.map((s) => {
              const q = byId.get(s.quote.id)!;
              return (
                <li key={q.id}>
                  <Card className={cn("p-5", s.labels.includes("recommended") && "border-brand")}>
                    <InsurerHead q={q} s={s} demo={showDemo} compact />
                    <dl className="mt-3 divide-y divide-line text-sm">
                      {tableRows
                        .filter((r) => ["limit", "excess", "exclusion", "waiting", "valid"].includes(r.key))
                        .map((r) => (
                          <div key={r.key} className="flex justify-between gap-4 py-2.5">
                            <dt className="text-muted">{r.label}</dt>
                            <dd className="text-right font-medium text-ink">{r.cell(q, s)}</dd>
                          </div>
                        ))}
                    </dl>
                    <details className="mt-1 text-sm">
                      <summary className="cursor-pointer py-2 font-medium text-brand">Full cover details</summary>
                      <dl className="divide-y divide-line">
                        {tableRows
                          .filter((r) => !["limit", "excess", "exclusion", "waiting", "valid"].includes(r.key))
                          .map((r) => (
                            <div key={r.key} className="flex justify-between gap-4 py-2.5">
                              <dt className="text-muted">{r.label}</dt>
                              <dd className="text-right text-ink">{r.cell(q, s)}</dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                    <div className="mt-3">{action(s)}</div>
                  </Card>
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-sm text-muted">Fictional terms. Full policy wording applies. Your broker confirms eligibility and the final quote.</p>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <Info aria-hidden className="size-4 text-brand" /> How we compared
              </p>
              <p className="mt-2 text-sm text-ink-2">{comparisonSummary(cmp)} {cmp.disclaimer}</p>
              {recommended && (
                <p className="mt-3 text-sm text-ink-2">
                  <span className="font-semibold">“{LABELS.recommended}”</span> is the quote with the highest score on these disclosed criteria:{" "}
                  {Object.entries(cmp.criteria)
                    .map(([k, w]) => `${k === "waiting" ? "waiting period" : k} ${Math.round(w * 100)}%`)
                    .join(", ")}
                  . It is not advice — your broker can help you decide what suits you.
                </p>
              )}
              {cmp.materialExclusions.length > 0 && (
                <p className="mt-3 text-sm text-ink-2">
                  <span className="font-semibold">Check the exclusions:</span> each quote lists a key exclusion above. Read the full wording before you accept.
                </p>
              )}
            </Card>
            <div className="space-y-4">
              {disclosure && <DisclosureBlock text={disclosure} />}
              {commission.length > 0 && (
                <div className="rounded-xl border border-line px-4 py-3 text-[13px] text-ink-2">
                  <span className="font-semibold text-ink">Commission. </span>
                  {commission.join(" ")}
                </div>
              )}
              {showDemo && <DemoBadge />}
            </div>
          </div>

          {paid.length > 0 && (
            <section aria-labelledby="sponsored" className="mt-10">
              <h2 id="sponsored" className="text-lg font-semibold text-ink">Sponsored</h2>
              <p className="text-sm text-muted">Paid placements. Shown separately and not part of the comparison or ranking above.</p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {paid.map((p) => {
                  const q = byId.get(p.id)!;
                  return (
                    <li key={p.id}>
                      <Card className="p-5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-ink">{p.insurerName}</p>
                          <Pill tone="neutral">Paid placement</Pill>
                        </div>
                        <p className="mt-1 text-2xl font-bold text-ink">
                          {formatGHS(p.premium)} <span className="text-sm font-normal text-muted">/ year</span>
                        </p>
                        <StatusPill meta={QUOTE_STATUS[q.status]} className="mt-2" />
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function InsurerHead({ q, s, demo, compact = false }: { q: QuoteRow; s: ScoredQuote; demo: boolean; compact?: boolean }) {
  const labels = s.labels.filter((l) => l !== "recommended");
  const rec = s.labels.includes("recommended");
  const isDemoOrg = !!(q.insurer?.settings as { demo?: boolean } | null)?.demo;
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span
          aria-hidden
          className="grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-bold text-white"
          style={{ background: q.insurer?.brand_color ?? "#486068" }}
        >
          {(q.insurer?.name ?? "?").replace(/\(.*\)/, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}
        </span>
        <StatusPill meta={QUOTE_STATUS[q.status as QuoteStatus]} />
      </div>
      <p className={cn("mt-3 font-semibold text-ink", compact ? "text-base" : "text-[17px]")}>
        {q.insurer?.name ?? "Insurer"}
        {demo && isDemoOrg && <span className="ml-1.5 rounded bg-[#EEF2F1] px-1.5 py-0.5 align-middle text-[11px] font-medium text-muted">Demo</span>}
      </p>
      <p className="mt-1 text-[28px] font-bold leading-none tracking-tight text-ink">
        {formatGHS(Number(q.premium))} <span className="text-sm font-normal text-muted">/ {q.billing_period === "month" ? "month" : "year"}</span>
      </p>
      {q.status !== "ready_to_accept" && <p className="mt-1 text-xs text-muted">{QUOTE_STATUS[q.status as QuoteStatus].customerHint}</p>}
      {(rec || labels.length > 0) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {rec && <Pill tone="ok" className="bg-brand text-white">{LABELS.recommended}</Pill>}
          {labels.map((l) => (
            <Pill key={l} tone="ok">{LABELS[l]}</Pill>
          ))}
        </div>
      )}
      {s.reasons.length > 0 && !compact && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {s.reasons.slice(0, 3).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
