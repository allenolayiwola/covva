import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Card, Logo, Notice, Pill, buttonClass } from "@im/ui";
import { formatDateTime, humanize } from "@im/core";
import { getMemberships, getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/partner/action-form";
import { OfferCountdown } from "@/components/partner/offer-countdown";
import { Skeleton } from "@/components/partner/ui";
import { acceptByToken, declineByToken } from "./actions";

function isPast(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}

export const metadata: Metadata = { title: "Accept request", robots: { index: false, follow: false } };

/**
 * One-tap accept link from SMS / WhatsApp / push (Addendum 2 E). Lightweight on purpose: no
 * workspace shell, one button. Signed-out users go to sign-in and come straight back.
 */
export default function AcceptOfferPage({ params }: PageProps<"/partner/offers/accept/[token]">) {
  return (
    <div className="min-h-dvh bg-mist/50">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-[720px] items-center justify-between px-4 sm:px-6">
          <Link href="/partner" aria-label="Partner workspace"><Logo height={32} /></Link>
          <span className="text-[15px] text-muted">New request offer</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[720px] px-4 py-8 sm:py-12">
        <Card className="p-6 sm:p-8">
          <Suspense fallback={<div className="space-y-3"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-10 w-48" /></div>}>
            <Body params={params} />
          </Suspense>
        </Card>
      </main>
    </div>
  );
}

async function Body({ params }: Pick<PageProps<"/partner/offers/accept/[token]">, "params">) {
  await connection();
  const { token } = await params;
  const here = `/partner/offers/accept/${encodeURIComponent(token)}`;
  const user = await getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  if (!/^[a-f0-9]{32,64}$/i.test(token)) return <Invalid />;

  const memberships = await getMemberships();
  const brokerOrgs = memberships.filter((m) => m.org.type === "broker");
  if (!brokerOrgs.length) redirect("/partner/no-access");

  const supabase = await createClient();
  // RLS: visible only to members of the offered broker.
  const { data: offer } = await supabase.from("order_offers").select("id, request_id, broker_org_id, status, round, responds_by, responded_at").eq("accept_token", token).maybeSingle();
  if (!offer) return <Invalid />;
  const { data: req } = await supabase.from("requests").select("id, reference, title, type, category_id, broker_org_id, talk_to_expert, complexity_flags, category:product_categories(name)").eq("id", offer.request_id).maybeSingle();
  const org = brokerOrgs.find((m) => m.org_id === offer.broker_org_id)?.org;
  const canAct = memberships.some((m) => m.org_id === offer.broker_org_id && ["owner", "admin", "supervisor", "adviser"].includes(m.role));
  const expired = isPast(offer.responds_by);
  const catName = (req?.category as unknown as { name: string } | null)?.name ?? "Insurance";

  if (offer.status === "accepted") {
    const mine = req?.broker_org_id === offer.broker_org_id;
    return (
      <>
        <h1 className="text-[24px] font-bold tracking-tight text-ink">{mine ? "Already accepted" : "Taken by another broker"}</h1>
        <p className="mt-2 text-[15px] text-muted">{mine ? `${org?.name ?? "Your organisation"} is the broker of record for ${req?.reference ?? "this request"}.` : "Another broker accepted this request first."}</p>
        {mine && req && <Link href={`/partner/requests/${req.id}`} className={buttonClass("primary", "md", "mt-6")}>Open the request</Link>}
      </>
    );
  }
  if (offer.status !== "offered" || expired) {
    return (
      <>
        <h1 className="text-[24px] font-bold tracking-tight text-ink">This offer is {expired && offer.status === "offered" ? "no longer open" : humanize(offer.status)}</h1>
        <p className="mt-2 text-[15px] text-muted">
          {offer.status === "declined" ? "Your organisation declined this request." : "The acceptance window closed and the request was offered to the next broker."}
        </p>
        <Link href="/partner/offers" className={buttonClass("secondary", "md", "mt-6")}>See open offers</Link>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Offered to {org?.name ?? "your organisation"} · round {offer.round}</p>
          <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-tight text-ink">{req?.reference ?? "New request"} · {catName}</h1>
          {req?.title && <p className="mt-1 text-[15px] text-ink-2">{req.title}</p>}
        </div>
        <OfferCountdown respondsBy={offer.responds_by} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {req?.talk_to_expert && <Pill tone="wait">Wants to talk to an expert</Pill>}
        {(req?.complexity_flags ?? []).map((f) => <Pill key={f} tone="neutral">{humanize(f)}</Pill>)}
      </div>
      <p className="mt-4 text-sm text-muted">Accept by {formatDateTime(offer.responds_by)}. The first broker to accept becomes the broker of record and is disclosed to the customer; the others are withdrawn.</p>
      {!canAct ? (
        <Notice tone="wait" className="mt-6">Only advisers and supervisors can accept requests. Ask a colleague with that role, or open the workspace.</Notice>
      ) : (
        <div className="mt-6 space-y-3">
          <ActionForm action={acceptByToken} submitLabel="Accept this request" pendingLabel="Accepting…" size="md">
            <input type="hidden" name="token" value={token} />
          </ActionForm>
          <ActionForm action={declineByToken} submitLabel="Decline" variant="secondary" size="sm">
            <input type="hidden" name="token" value={token} />
          </ActionForm>
        </div>
      )}
      <p className="mt-6 text-xs text-subtle">
        Signed in as {user.email}. <Link href="/partner/offers" className="underline">All offers</Link>
      </p>
    </>
  );
}

function Invalid() {
  return (
    <>
      <h1 className="text-[24px] font-bold tracking-tight text-ink">Offer not found</h1>
      <p className="mt-2 text-[15px] text-muted">This link is not valid for your organisation, or it has expired. Open the workspace to see your current offers.</p>
      <Link href="/partner/offers" className={buttonClass("secondary", "md", "mt-6")}>See open offers</Link>
    </>
  );
}
