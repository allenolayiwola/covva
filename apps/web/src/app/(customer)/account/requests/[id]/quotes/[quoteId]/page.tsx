import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Check, Mail, Phone, X } from "lucide-react";
import { QUOTE_STATUS, buildDisclosure, formatDate, formatDateTime, formatGHS, humanize, type QuoteStatus } from "@im/core";
import type { Row } from "@im/db";
import { Card, DefinitionList, DemoBadge, DisclosureBlock, Notice, Pill, StatusPill, buttonClass } from "@im/ui";
import { getFlags } from "@/lib/catalog";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { BrokerCard, brokerContact } from "@/components/customer/broker-card";
import { DetailTabs } from "@/components/customer/detail-tabs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { DiscountLines } from "@/components/customer/discount-lines";
import { quoteDiscountLines, toDiscountLine } from "@/server/loyalty";
import { ORG_COLS, UUID_RE, account, getRequestOr404, requestTime, type OrgLite } from "../../../../_lib/data";

export const metadata: Metadata = { title: "Quote details" };

export default function QuoteDetailPage({ params }: PageProps<"/account/requests/[id]/quotes/[quoteId]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <QuoteDetail params={params} />
    </Suspense>
  );
}

type QuoteRow = Row<"quotes"> & { insurer: OrgLite | null };
type CoverageItem = { key: string; label: string; included: boolean; note?: string };

const NON_MONEY = /(days|months|percent|members|count|max_family)/i;
function fmt(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return NON_MONEY.test(key) ? v.toLocaleString("en-GH") : formatGHS(v);
  if (typeof v === "boolean") return v ? "Included" : "Not included";
  return String(v);
}

/** Quote detail (mockup 07): Cover / Exclusions / Conditions tabs and the broker who prepared it. */
async function QuoteDetail({ params }: Pick<PageProps<"/account/requests/[id]/quotes/[quoteId]">, "params">) {
  const { id, quoteId } = await params;
  if (!UUID_RE.test(quoteId)) notFound();
  const { supabase } = await account(`/account/requests/${id}/quotes/${quoteId}`);
  const [request, flags] = await Promise.all([getRequestOr404(supabase, id), getFlags()]);
  const { data } = await supabase.from("quotes").select(`*, insurer:organizations!quotes_insurer_org_id_fkey(${ORG_COLS})`).eq("id", quoteId).eq("request_id", id).maybeSingle();
  const quote = data as unknown as QuoteRow | null;
  if (!quote) notFound();
  // Phase 4 loyalty: explicit discount lines recorded on this quote (RLS: the request's customer).
  const discountLines = ((await quoteDiscountLines(supabase, [quote.id])).get(quote.id) ?? []).map(toDiscountLine);

  const insurerName = quote.insurer?.name ?? "Insurer";
  const insurerDemo = !!(quote.insurer?.settings as { demo?: boolean } | null)?.demo;
  const expired = !!quote.valid_until && new Date(quote.valid_until).getTime() < requestTime();
  const coverage = (Array.isArray(quote.coverage) ? quote.coverage : []) as CoverageItem[];
  const limits = (quote.limits ?? {}) as Record<string, unknown>;
  const excesses = (quote.excesses ?? {}) as Record<string, unknown>;
  const benefits = (Array.isArray(quote.optional_benefits) ? quote.optional_benefits : []) as { key: string; label: string; premium?: number }[];
  const assumptions = (quote.assumptions ?? {}) as Record<string, unknown> & { issuance?: { label?: string } };
  const canApply = quote.status === "ready_to_accept" && !expired && !!request.broker;
  const broker = request.broker;
  const contact = brokerContact(broker);
  const disclosure = buildDisclosure({ broker: { name: broker?.name ?? "your broker of record", licence: broker?.nic_licence_number }, insurer: { name: insurerName } });
  const total = Number(quote.premium) + Number(quote.taxes ?? 0) + Number(quote.fees ?? 0);

  const tabs = [
    {
      key: "cover",
      label: "Cover",
      content: (
        <div className="grid gap-4">
          <DefinitionList
            items={[
              ...(quote.sum_insured != null ? [{ label: "Sum insured / cover limit", value: formatGHS(Number(quote.sum_insured)) }] : []),
              ...Object.entries(limits)
                .filter(([k]) => k !== "currency_note")
                .map(([k, v]) => ({ label: humanize(k), value: fmt(k, v) })),
            ]}
          />
          {coverage.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {coverage.map((c) => (
                <li key={c.key} className="flex items-start gap-2.5 rounded-card border border-line bg-white px-4 py-3 text-[15px]">
                  <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${c.included ? "bg-mint text-brand-deep" : "bg-mist text-subtle"}`}>
                    {c.included ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
                  </span>
                  <span className={c.included ? "text-ink" : "text-subtle"}>
                    {c.label}
                    <span className="sr-only">{c.included ? " — included" : " — not included"}</span>
                    {c.note && <span className="block text-[13px] text-muted">{c.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {benefits.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-ink">Optional benefits</p>
              <ul className="mt-2 divide-y divide-line rounded-card border border-line">
                {benefits.map((b) => (
                  <li key={b.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[15px]">
                    <span className="text-ink-2">{b.label}</span>
                    {b.premium ? <span className="font-medium text-ink">+{formatGHS(b.premium)}</span> : <span className="text-muted">Included</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "exclusions",
      label: "Exclusions",
      content: (
        <div className="grid gap-4">
          {quote.key_exclusion && (
            <Notice tone="wait" title="Key exclusion">
              {quote.key_exclusion}
            </Notice>
          )}
          {quote.exclusions.length > 0 ? (
            <ul className="divide-y divide-line rounded-card border border-line">
              {quote.exclusions.map((e) => (
                <li key={e} className="flex items-start gap-2.5 px-4 py-3 text-[15px] text-ink-2">
                  <X aria-hidden className="mt-1 size-4 shrink-0 text-danger" /> {e}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">The insurer has not listed further exclusions on this quote. The full policy wording applies.</p>
          )}
          <p className="text-[13px] text-muted">Read the full policy wording before you accept. Your broker can explain any exclusion.</p>
        </div>
      ),
    },
    {
      key: "conditions",
      label: "Conditions",
      content: (
        <div className="grid gap-4">
          <DefinitionList
            items={[
              { label: "Main excess", value: quote.excess != null ? formatGHS(Number(quote.excess)) : "None" },
              ...Object.entries(excesses).map(([k, v]) => ({ label: humanize(k), value: fmt(k, v) })),
              { label: "Waiting period", value: quote.waiting_period_days ? `${quote.waiting_period_days} days` : "None" },
              { label: "Billing", value: quote.billing_period === "month" ? "Monthly" : "Annual" },
              { label: "Quote valid until", value: quote.status === "ready_to_accept" ? (expired ? `Expired ${formatDate(quote.valid_until)}` : formatDate(quote.valid_until)) : "Pending" },
              ...(assumptions.issuance?.label ? [{ label: "Issuance", value: assumptions.issuance.label }] : []),
              { label: "Quoted", value: formatDateTime(quote.updated_at ?? quote.created_at) },
            ]}
          />
          {quote.conditions && <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{quote.conditions}</p>}
          {quote.broker_note && (
            <div className="rounded-card border border-line bg-mist px-4 py-3 text-[14px] leading-relaxed text-ink-2">
              <span className="font-semibold text-ink">From your broker. </span>
              {quote.broker_note}
            </div>
          )}
          {quote.commission_disclosure && (
            <div className="rounded-card border border-line px-4 py-3 text-[13px] text-ink-2">
              <span className="font-semibold text-ink">Commission. </span>
              {quote.commission_disclosure}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Requests", href: "/account/requests" },
          { label: request.reference, href: `/account/requests/${id}` },
          { label: "Quotes", href: `/account/requests/${id}/quotes` },
          { label: insurerName },
        ]}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted">{request.category?.name} · {request.title}</p>
              <h1 className="mt-1 flex flex-wrap items-center gap-2 text-h3 text-ink">
                {insurerName}
                {flags.demo_mode && insurerDemo && <Pill tone="wait">DEMO</Pill>}
              </h1>
              <p className="mt-1 text-sm text-muted">via {broker?.name ?? "your broker"}</p>
            </div>
            <StatusPill meta={QUOTE_STATUS[quote.status as QuoteStatus]} />
          </div>
          <p className="mt-4 text-[36px] font-semibold leading-none tracking-tight text-gold">
            <span className="text-ink">{formatGHS(Number(quote.premium))}</span> <span className="text-base font-normal text-muted">/ {quote.billing_period === "month" ? "month" : "year"}</span>
          </p>
          {total !== Number(quote.premium) && <p className="mt-1 text-sm text-muted">{formatGHS(total)} including taxes and fees</p>}
          <DiscountLines lines={discountLines} premium={Number(quote.premium)} className="mt-5" />

          <DetailTabs tabs={tabs} className="mt-8" />

          <p className="mt-8 rounded-card border border-line bg-mist px-4 py-3 text-[13px] leading-relaxed text-ink-2">
            <strong className="font-semibold text-ink">A quote request is not cover.</strong> Payment does not make cover active until the insurer accepts. Fictional terms on demo quotes; the full policy wording applies.
          </p>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            {canApply ? (
              <Link href={`/account/requests/${id}/apply/${quote.id}`} className={buttonClass("primary", "lg", "w-full")}>Choose this quote</Link>
            ) : (
              <p className="text-sm text-muted">{expired ? "This quote has expired. Ask your broker to refresh it." : QUOTE_STATUS[quote.status as QuoteStatus].customerHint}</p>
            )}
            <Link href={`/account/requests/${id}/quotes`} className={buttonClass("ghost", "md", "mt-2 w-full")}>Back to all quotes</Link>
            {flags.demo_mode && <DemoBadge className="mt-3" />}
          </Card>
          <BrokerCard broker={broker} messageHref={`/account/requests/${id}/messages`} />
          {contact && (contact.phone || contact.email) && (
            <Card className="p-5 text-sm">
              <p className="font-semibold text-ink">Contact {contact.firstName}</p>
              <ul className="mt-2 space-y-1.5 text-ink-2">
                {contact.phone && <li><a href={`tel:${contact.phone}`} className="inline-flex items-center gap-2 rounded hover:text-brand"><Phone aria-hidden className="size-4 text-brand" />{contact.phone}</a></li>}
                {contact.email && <li><a href={`mailto:${contact.email}`} className="inline-flex items-center gap-2 rounded hover:text-brand"><Mail aria-hidden className="size-4 text-brand" />{contact.email}</a></li>}
              </ul>
            </Card>
          )}
          <DisclosureBlock text={disclosure} />
        </aside>
      </div>
    </div>
  );
}
