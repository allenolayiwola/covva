import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Check } from "lucide-react";
import { QUOTE_STATUS, buildDisclosure, formatDate, formatGHS } from "@im/core";
import type { Row } from "@im/db";
import { Card, DefinitionList, DemoBadge, DisclosureBlock, Notice, StatusPill, buttonClass, cn } from "@im/ui";
import { getProfile } from "@/lib/auth";
import { getFlags, getSetting } from "@/lib/catalog";
import { Breadcrumbs } from "@/components/customer/breadcrumbs";
import { PageSkeleton } from "@/components/customer/skeletons";
import { ORG_COLS, UUID_RE, account, getRequestOr404, requestTime, type OrgLite } from "../../../../_lib/data";
import { BankTransferPanel, DeclarationsStep, DisclosureStep, PaymentStep, PaymentWaiting, type BankTransferDetail, type CheckoutCurrency } from "./checkout-steps";
import { declarationsFor } from "./declarations";
import { feeBreakdownForQuoteId } from "@/server/commercial";
import { discountTotal, quoteDiscountLines, toDiscountLine } from "@/server/loyalty";
import { DiscountLines } from "@/components/customer/discount-lines";
import { fxSettings, getRates } from "@/server/fx";
import { applePayEnabled } from "@/server/env";
import { SUPPORTED_DISPLAY_CURRENCIES, fxMargin, parseDisplayCurrency, parseInstalmentPlans } from "@im/core";
import { T } from "@/lib/i18n/client";

export const metadata: Metadata = { title: "Apply" };

export default function ApplyPage({ params, searchParams }: PageProps<"/account/requests/[id]/apply/[quoteId]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={5} />}>
      <Checkout params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const STEPS = ["Your broker", "Declarations", "Payment", "Confirmation"];

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-8 grid grid-cols-4 gap-2" aria-label="Checkout progress">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined}>
          <span className={cn("block h-2 rounded-full", i <= current ? "bg-brand" : "bg-mint")} />
          <span className={cn("mt-2 flex items-center gap-1 text-xs font-medium sm:text-sm", i === current ? "text-ink" : i < current ? "text-brand" : "text-subtle")}>
            {i < current && <Check aria-hidden className="size-3.5" />}
            {s}
          </span>
        </li>
      ))}
    </ol>
  );
}

async function Checkout({ params, searchParams }: Pick<PageProps<"/account/requests/[id]/apply/[quoteId]">, "params" | "searchParams">) {
  const { id, quoteId } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(quoteId)) notFound();
  const { user, supabase } = await account(`/account/requests/${id}/apply/${quoteId}`);
  const request = await getRequestOr404(supabase, id);

  const [quoteRes, disclosureRes, appRes, flags, profile, termsVersion] = await Promise.all([
    supabase.from("quotes").select(`*, insurer:organizations!quotes_insurer_org_id_fkey(${ORG_COLS})`).eq("id", quoteId).eq("request_id", id).maybeSingle(),
    request.broker_org_id
      ? supabase.from("broker_disclosures").select("id, acknowledged_at").eq("request_id", id).eq("broker_org_id", request.broker_org_id).limit(1)
      : Promise.resolve({ data: [] as { id: string; acknowledged_at: string }[] }),
    supabase.from("applications").select("*").eq("quote_id", quoteId).eq("customer_id", user.id).in("status", ["submitted", "accepted"]).order("created_at", { ascending: false }).limit(1),
    getFlags(),
    getProfile(),
    getSetting<string>("terms_version"),
  ]);
  const quote = quoteRes.data as unknown as (Row<"quotes"> & { insurer: OrgLite | null }) | null;
  if (!quote) notFound();
  const application = (appRes.data?.[0] ?? null) as Row<"applications"> | null;
  const disclosed = (disclosureRes.data?.length ?? 0) > 0;
  const insurerName = quote.insurer?.name ?? "the insurer";
  const broker = request.broker;
  const disclosureText = buildDisclosure({
    broker: { name: broker?.name ?? "your broker of record", licence: broker?.nic_licence_number },
    insurer: { name: insurerName },
  });

  let payment: Pick<Row<"payments">, "id" | "status" | "failure_reason" | "authorization_url" | "amount" | "provider" | "channel_detail"> | null = null;
  if (application) {
    const { data } = await supabase
      .from("payments")
      .select("id, status, failure_reason, authorization_url, amount, provider, channel_detail")
      .eq("application_id", application.id)
      .order("created_at", { ascending: false })
      .limit(1);
    payment = data?.[0] ?? null;
    if (payment?.status === "succeeded") redirect(`/account/requests/${id}/confirmation`);
  }

  const expired = !!quote.valid_until && new Date(quote.valid_until).getTime() < requestTime();
  const benefits = (Array.isArray(quote.optional_benefits) ? quote.optional_benefits : []) as { key: string; label: string; premium?: number }[];
  const chosenBenefits = application ? ((Array.isArray(application.selected_benefits) ? application.selected_benefits : []) as string[]) : [];
  // Phase 4 loyalty: explicit discount lines come off what is paid (server/payments.ts does the same from the DB).
  const discountLines = ((await quoteDiscountLines(supabase, [quote.id])).get(quote.id) ?? []).map(toDiscountLine);
  const discount = discountTotal(discountLines);
  const amount =
    Math.max(0, Number(quote.premium) - discount) + Number(quote.taxes ?? 0) + Number(quote.fees ?? 0) + benefits.filter((b) => chosenBenefits.includes(b.key)).reduce((s, b) => s + (b.premium ?? 0), 0);
  const step = !disclosed ? 0 : !application ? 1 : 2;
  const waitingPaymentId = typeof sp.payment === "string" && UUID_RE.test(sp.payment) ? sp.payment : null;
  const failure = payment && ["failed", "abandoned", "reversed"].includes(payment.status) ? payment.failure_reason ?? "The payment was declined or cancelled." : null;

  let body: React.ReactNode;
  if (!broker) {
    body = <Notice tone="wait" title="Your broker hasn't been assigned yet">You&apos;ll be able to apply once a licensed broker of record has been named to you.</Notice>;
  } else if (!application && (quote.status !== "ready_to_accept" || expired)) {
    body = (
      <Notice tone="wait" title={expired ? "This quote has expired" : `This quote is ${QUOTE_STATUS[quote.status].label.toLowerCase()}`}>
        {expired ? "Prices must be revalidated before you can apply. Ask your broker to refresh it." : QUOTE_STATUS[quote.status].customerHint}{" "}
        <Link href={`/account/requests/${id}/quotes`} className="font-semibold underline">Back to quotes</Link>
      </Notice>
    );
  } else if (step === 0) {
    body = <DisclosureStep requestId={id} quoteId={quoteId} text={disclosureText} brokerName={broker.name} />;
  } else if (step === 1) {
    body = (
      <DeclarationsStep
        requestId={id}
        quoteId={quoteId}
        insurer={insurerName}
        premium={Math.max(0, Number(quote.premium) - discount) + Number(quote.taxes ?? 0) + Number(quote.fees ?? 0)}
        feeBreakdown={await feeBreakdownForQuoteId(quote.id).catch(() => null)}
        discounts={discountLines.length ? <DiscountLines lines={discountLines} premium={Number(quote.premium)} /> : null}
        benefits={benefits}
        termsVersion={termsVersion ?? "current"}
        declarations={declarationsFor(request.category?.slug, {
          insurer: insurerName,
          keyExclusion: quote.key_exclusion,
          risk: (request.risk_data ?? {}) as Record<string, unknown>,
        })}
      />
    );
  } else if (payment && payment.status === "pending" && payment.provider === "bank_transfer" && payment.channel_detail && !sp.retry) {
    body = <BankTransferPanel detail={payment.channel_detail as unknown as BankTransferDetail} requestId={id} retryHref={`/account/requests/${id}/apply/${quoteId}?retry=1`} />;
  } else if (waitingPaymentId || (payment && ["pending", "processing"].includes(payment.status) && !payment.authorization_url)) {
    body = <PaymentWaiting paymentId={waitingPaymentId ?? payment!.id} requestId={id} retryHref={`/account/requests/${id}/apply/${quoteId}?retry=1`} />;
  } else {
    // Diaspora: display currencies (indicative rates after the platform margin) and the sponsor option.
    const [rates, fxConf] = await Promise.all([getRates(), fxSettings()]);
    const currencies: CheckoutCurrency[] = SUPPORTED_DISPLAY_CURRENCIES.flatMap((code) => {
      const r = rates[code];
      return r ? [{ code, rate: code === "GHS" ? 1 : fxMargin(r.rate, fxConf.marginPct), source: r.source, quotedAt: r.fetchedAt, manual: r.manual }] : [];
    });
    const prof = (profile ?? {}) as { preferred_currency?: string | null; is_sponsor?: boolean | null };
    const defaultCurrency = parseDisplayCurrency(prof.preferred_currency) ?? "GHS";
    const insurerSettings = (quote.insurer?.settings ?? {}) as { instalments_allowed?: boolean };
    // Phase 3: the insurer's instalment plans on this product version (not for monthly-priced or micro quotes).
    const { data: versionPlans } = quote.product_version_id && quote.billing_period === "year" ? await supabase.from("product_versions").select("instalment_plans").eq("id", quote.product_version_id).maybeSingle() : { data: null };
    body = (
      <>
        {payment && ["pending", "processing"].includes(payment.status) && payment.authorization_url && !sp.retry && (
          <Notice tone="info" className="mb-5" title="You have a payment in progress">
            <a href={payment.authorization_url} className="font-semibold underline">Return to the payment page</a> or start again below.
          </Notice>
        )}
        <PaymentStep
          requestId={id}
          quoteId={quoteId}
          applicationId={application!.id}
          amount={payment?.amount ? Number(payment.amount) : amount}
          insurer={insurerName}
          defaultPhone={profile?.phone ?? ""}
          failure={failure}
          currencies={currencies}
          defaultCurrency={defaultCurrency}
          marginPct={fxConf.marginPct}
          applePay={applePayEnabled()}
          sponsor={{ offered: prof.is_sponsor !== false, billingPeriod: quote.billing_period, instalmentsAllowed: insurerSettings.instalments_allowed === true }}
          instalmentPlans={parseInstalmentPlans(versionPlans?.instalment_plans)}
        />
      </>
    );
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Requests", href: "/account/requests" },
          { label: request.reference, href: `/account/requests/${id}` },
          { label: "Compare", href: `/account/requests/${id}/quotes` },
          { label: "Apply" },
        ]}
      />
      <h1 className="mb-2 text-h3 text-ink"><T k="checkout.applyFor" vars={{ insurer: insurerName }} /></h1>
      <p className="mb-6 text-sm text-muted">Step {step + 1} of {STEPS.length} · A quote request is not cover. Payment does not make cover active until the insurer accepts.</p>
      <Stepper current={step} />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">{body}</div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-ink">{insurerName}</p>
              <StatusPill meta={QUOTE_STATUS[quote.status]} />
            </div>
            <p className="mt-1 text-sm text-muted">{request.category?.name} · {request.title}</p>
            <p className="mt-3 text-[28px] font-semibold leading-none text-ink">
              {formatGHS(Number(quote.premium))} <span className="text-sm font-normal text-muted">/ {quote.billing_period === "month" ? "month" : "year"}</span>
            </p>
            <DefinitionList
              className="mt-3"
              items={[
                ...(quote.sum_insured != null ? [{ label: "Cover limit", value: formatGHS(Number(quote.sum_insured)) }] : []),
                ...(quote.excess != null ? [{ label: "Main excess", value: formatGHS(Number(quote.excess)) }] : []),
                ...(quote.key_exclusion ? [{ label: "Key exclusion", value: quote.key_exclusion }] : []),
                { label: "Valid until", value: quote.valid_until ? formatDate(quote.valid_until) : "Pending" },
              ]}
            />
            {flags.demo_mode && <DemoBadge className="mt-3" />}
          </Card>
          <DisclosureBlock text={disclosureText} />
          <Link href={`/account/requests/${id}/messages`} className={buttonClass("ghost", "sm", "w-full")}>Questions? Message your broker</Link>
        </aside>
      </div>
    </div>
  );
}
