import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Info, LogIn, MessageCircle } from "lucide-react";
import { LABELS, QUOTE_STATUS, ROLE_STATEMENTS, formatDate, formatGHS, whatsappShareLink, type LabelKey, type QuoteStatus } from "@im/core";
import { Card, Container, Eyebrow, Notice, Pill, StatusPill, buttonClass } from "@im/ui";
import { loadSharedComparison } from "@/server/shares";

/**
 * Public, read-only view of a shared comparison (/q/<token>). Shows quote summaries only — no
 * customer identity, no request reference, no risk details beyond the cover title. The CTA signs
 * in to resume the saved request. Never indexed.
 */
export const metadata: Metadata = {
  title: "Shared quotes",
  description: "A read-only comparison of insurance quotes shared from Covva.",
  robots: { index: false, follow: false },
};

export default function SharedQuotesPage({ params }: PageProps<"/q/[token]">) {
  return (
    <Suspense fallback={<Container className="py-16"><div aria-busy="true" className="h-64 animate-pulse rounded-card bg-mist motion-reduce:animate-none" /></Container>}>
      <Shared params={params} />
    </Suspense>
  );
}

async function Shared({ params }: Pick<PageProps<"/q/[token]">, "params">) {
  const { token } = await params;
  const share = await loadSharedComparison(token, { recordView: true });
  if (!share) notFound();

  const byId = new Map(share.quotes.map((q) => [q.id, q]));
  const ordered = share.ranked.map((r) => ({ ...r, quote: byId.get(r.id)! })).filter((r) => r.quote);
  const heading = [share.categoryName ? `${share.categoryName} quotes` : "Insurance quotes", share.riskTitle].filter(Boolean).join(" · ");
  const signIn = `/sign-in?next=${encodeURIComponent("/account/requests")}`;

  return (
    <div className="bg-gradient-to-b from-mist to-white">
      <Container className="py-12 sm:py-16">
        <div className="mx-auto max-w-3xl">
          <Eyebrow>Shared from Covva</Eyebrow>
          <h1 className="mt-3 text-[32px] font-bold leading-tight tracking-[-0.03em] text-ink sm:text-[42px]">{heading}</h1>
          <p className="mt-3 text-[15px] text-muted">
            {share.expired
              ? "This link has expired. Share links work for 14 days."
              : `${share.insurersCompared} insurer${share.insurersCompared === 1 ? "" : "s"} compared${share.insurersCompared === 1 ? " — we show every licensed insurer that quoted for this risk" : ""}. Read-only; the person who shared it can sign in to apply.`}
          </p>

          {share.expired ? (
            <Notice tone="wait" className="mt-8" title="Link expired">
              Ask the person who shared it to send a new one, or <Link href="/get-started" className="font-semibold underline">get your own quotes</Link>.
            </Notice>
          ) : ordered.length === 0 ? (
            <Notice tone="info" className="mt-8" title="No quotes to show yet">Quotes are still being prepared. Check back soon.</Notice>
          ) : (
            <ul className="mt-8 space-y-4">
              {ordered.map(({ quote: q, labels }) => {
                const rec = labels.includes("recommended");
                return (
                  <li key={q.id}>
                    <Card className={rec ? "border-brand p-5" : "p-5"}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span aria-hidden className="grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm font-bold text-white" style={{ background: q.brandColor ?? "#486068" }}>
                            {q.insurerName.replace(/\(.*\)/, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}
                          </span>
                          <div>
                            <p className="font-semibold text-ink">{q.insurerName}</p>
                            {q.productName && <p className="text-sm text-muted">{q.productName}</p>}
                          </div>
                        </div>
                        <StatusPill meta={QUOTE_STATUS[q.status as QuoteStatus]} />
                      </div>
                      <p className="mt-3 text-[28px] font-bold leading-none tracking-tight text-ink">
                        {formatGHS(q.premium)} <span className="text-sm font-normal text-muted">/ {q.billingPeriod === "month" ? "month" : "year"}</span>
                      </p>
                      {(rec || labels.length > 0) && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {labels.map((l) => (
                            <Pill key={l} tone="ok" className={l === "recommended" ? "bg-brand text-white" : undefined}>{LABELS[l as LabelKey]}</Pill>
                          ))}
                        </div>
                      )}
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                        <div><dt className="text-muted">Cover limit</dt><dd className="font-medium text-ink">{q.sumInsured != null ? formatGHS(q.sumInsured) : "—"}</dd></div>
                        <div><dt className="text-muted">Excess</dt><dd className="font-medium text-ink">{q.excess != null ? formatGHS(q.excess) : "None"}</dd></div>
                        <div><dt className="text-muted">Waiting period</dt><dd className="font-medium text-ink">{q.waitingPeriodDays ? `${q.waitingPeriodDays} days` : "None"}</dd></div>
                        <div><dt className="text-muted">Valid until</dt><dd className="font-medium text-ink">{q.status === "ready_to_accept" && q.validUntil ? formatDate(q.validUntil) : "Pending"}</dd></div>
                      </dl>
                      {q.coverage.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                          {q.coverage.slice(0, 8).map((c) => (
                            <li key={c.key} className={c.included ? "" : "text-subtle line-through"}>{c.label}</li>
                          ))}
                        </ul>
                      )}
                      {q.keyExclusion && <p className="mt-2 text-xs text-muted"><span className="font-semibold text-ink">Key exclusion:</span> {q.keyExclusion}</p>}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={signIn} className={buttonClass("primary")}>
              <LogIn aria-hidden className="size-4" /> Sign in to resume and apply
            </Link>
            {!share.expired && ordered.length > 0 && (
              <a href={whatsappShareLink(share.text)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
                <MessageCircle aria-hidden className="size-4" /> Share on WhatsApp
              </a>
            )}
            <Link href="/get-started" className={buttonClass("ghost")}>Get my own quotes</Link>
          </div>

          <Card className="mt-8 p-5">
            <p className="flex items-center gap-2 font-semibold text-ink"><Info aria-hidden className="size-4 text-brand" /> About this comparison</p>
            <p className="mt-2 text-sm text-ink-2">
              {`“${LABELS.recommended}” is an explained score on price, excess, cover and waiting period — not advice. `}
              Quotes marked estimate are indicative until the insurer confirms. Only the account holder can apply, and no cover starts until an insurer accepts it.
            </p>
            <p className="mt-2 text-xs text-subtle">{ROLE_STATEMENTS.platform} {ROLE_STATEMENTS.payment} Link expires {formatDate(share.expiresAt)}.</p>
          </Card>
        </div>
      </Container>
    </div>
  );
}
