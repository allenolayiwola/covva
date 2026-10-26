import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CircleCheck, Clock } from "lucide-react";
import { PAYMENT_STATUS, buildDisclosure, formatDateTime, formatGHS } from "@im/core";
import { Card, DefinitionList, DisclosureBlock, Notice, StatusPill, Timeline, buttonClass } from "@im/ui";
import { PageSkeleton } from "@/components/customer/skeletons";
import { RealtimeRefresh } from "@/components/customer/realtime-refresh";
import { account, getRequestOr404 } from "../../../_lib/data";

export const metadata: Metadata = { title: "Payment confirmation" };

export default function ConfirmationPage({ params }: PageProps<"/account/requests/[id]/confirmation">) {
  return (
    <Suspense fallback={<PageSkeleton rows={3} />}>
      <Confirmation params={params} />
    </Suspense>
  );
}

async function Confirmation({ params }: Pick<PageProps<"/account/requests/[id]/confirmation">, "params">) {
  const { id } = await params;
  const { user, supabase } = await account(`/account/requests/${id}/confirmation`);
  const request = await getRequestOr404(supabase, id);
  const [{ data: payments }, { data: policies }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, status, amount, paid_at, provider_reference, channel, created_at, payee:organizations!payments_payee_org_id_fkey(name)")
      .eq("request_id", id)
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("policies").select("id, status, policy_number").eq("request_id", id).limit(1),
  ]);
  const payment = payments?.[0] as
    | (NonNullable<typeof payments>[number] & { payee: { name: string } | null })
    | undefined;
  const policy = policies?.[0];
  const paid = payment?.status === "succeeded";
  const insurer = payment?.payee?.name ?? "the insurer";
  const active = policy?.status === "active";

  return (
    <div className="mx-auto max-w-2xl">
      <RealtimeRefresh
        channel={`confirm:${id}`}
        watch={[
          { table: "requests", filter: `id=eq.${id}` },
          { table: "policies", filter: `request_id=eq.${id}` },
        ]}
      />
      <div className="text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-mint text-brand">
          {paid ? <CircleCheck aria-hidden className="size-8" /> : <Clock aria-hidden className="size-8" />}
        </span>
        <h1 className="mt-5 text-h3 text-ink">
          {active ? "Your policy has been issued." : paid ? "Payment received." : "Waiting for payment confirmation."}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-lead text-muted">
          {active
            ? `${insurer} has confirmed acceptance and issued your policy. Your documents are in your wallet.`
            : paid
              ? "Your cover starts once the insurer confirms acceptance and issues your documents."
              : "We'll update this page as soon as the payment provider confirms. No cover has started yet."}
        </p>
      </div>

      <Card className="mt-8 p-5 sm:p-6">
        <Timeline
          steps={[
            { title: paid ? "Paid" : "Payment", detail: paid ? `Received by ${insurer} through the payment provider.` : "Waiting for the payment provider to confirm.", state: paid ? "done" : "current" },
            { title: active ? "Insurer accepted" : "Insurer acceptance pending", detail: active ? `${insurer} accepted your application.` : `${insurer} reviews your application. Payment does not make cover active until the insurer accepts.`, state: active ? "done" : paid ? "current" : "upcoming" },
            { title: "Documents", detail: active ? "Your schedule, receipt and certificate are in your wallet." : "Issued with your policy number once the insurer accepts.", state: active ? "done" : "upcoming" },
          ]}
        />
        {payment && (
          <DefinitionList
            className="mt-4"
            items={[
              { label: "Paid to", value: insurer },
              { label: "Amount", value: formatGHS(Number(payment.amount), { decimals: true }) },
              { label: "Status", value: <StatusPill meta={PAYMENT_STATUS[payment.status]} /> },
              ...(payment.paid_at ? [{ label: "Confirmed", value: formatDateTime(payment.paid_at) }] : []),
              ...(payment.provider_reference ? [{ label: "Payment reference", value: payment.provider_reference }] : []),
              { label: "Request", value: request.reference },
            ]}
          />
        )}
      </Card>

      {!active && (
        <Notice tone="wait" className="mt-6" title="Payment does not make cover active until the insurer accepts">
          Your broker sends your application to {insurer}. When {insurer} accepts it, they issue your policy number and documents. We&apos;ll notify you —
          until then, please don&apos;t treat yourself as covered.
        </Notice>
      )}

      {request.broker && (
        <DisclosureBlock className="mt-6" text={buildDisclosure({ broker: { name: request.broker.name, licence: request.broker.nic_licence_number }, insurer: { name: insurer } })} />
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {active && policy ? (
          <Link href={`/account/policies/${policy.id}`} className={buttonClass("primary")}>View my policy</Link>
        ) : (
          <Link href={`/account/requests/${id}`} className={buttonClass("primary")}>Track this request</Link>
        )}
        <Link href={`/account/requests/${id}/messages`} className={buttonClass("secondary")}>Message your broker</Link>
      </div>
    </div>
  );
}
