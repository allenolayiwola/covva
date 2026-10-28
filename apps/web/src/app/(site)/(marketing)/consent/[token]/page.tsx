import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { CONSENT_KIND_META, countryByCode, relationshipLabel } from "@im/core";
import { Card, Container, Notice, Pill } from "@im/ui";
import { consentLinkContext } from "@/server/diaspora";
import { ConsentDecision } from "./decision";

export const metadata: Metadata = { title: "Your consent", robots: { index: false, follow: false } };

/**
 * No-login consent page for a beneficiary in Ghana: the link in the SMS/WhatsApp carries a signed
 * token (HMAC over beneficiary id + consent kind + expiry, `CONSENT_LINK_SECRET`). Shows who is
 * asking and what is shared; Accept / Decline is recorded with the service role.
 */
export default function ConsentPage({ params }: PageProps<"/consent/[token]">) {
  return (
    <Container className="py-10 sm:py-16">
      <div className="mx-auto max-w-lg">
        <Suspense fallback={<Card className="p-6"><p className="text-sm text-muted">Loading…</p></Card>}>
          <Body params={params} />
        </Suspense>
      </div>
    </Container>
  );
}

async function Body({ params }: Pick<PageProps<"/consent/[token]">, "params">) {
  const { token } = await params;
  const ctx = await consentLinkContext(decodeURIComponent(token));
  if (!ctx) {
    return (
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-ink">This link has expired</h1>
        <p className="mt-2 text-muted">Consent links work for 7 days. Ask your family member to send a new one from their Covva account — or read them the 6-digit code from the message instead.</p>
      </Card>
    );
  }
  const meta = CONSENT_KIND_META[ctx.kind];
  const country = countryByCode(ctx.sponsorCountry);
  return (
    <Card className="p-6 sm:p-8">
      <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted"><ShieldCheck aria-hidden className="size-4 text-brand" /> Consent request</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">Hi {ctx.beneficiaryFirstName}, {ctx.sponsorName} wants to look after you</h1>
      <p className="mt-2 text-muted">
        {ctx.sponsorName}{country && country.code !== "GH" ? ` (in ${country.name})` : ""} has added you on Covva as their {relationshipLabel(ctx.relationship).toLowerCase()} and is asking for your permission to:
      </p>
      <p className="mt-4 rounded-card border border-line bg-mist/50 p-4 font-semibold text-ink">{meta.title}</p>
      <p className="mt-3 text-sm text-ink-2">{meta.summary}</p>
      <h2 className="mt-5 text-sm font-semibold uppercase tracking-[0.1em] text-muted">What is shared</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
        {meta.shares.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <Notice tone="info" className="mt-5">
        Covva is a technology platform. Policies are arranged by licensed brokers and issued by licensed insurers in Ghana. Your details are handled under the Data Protection Act, 2012 (Act 843), and you can withdraw consent by contacting support.
      </Notice>
      {ctx.decided ? (
        <div className="mt-6">
          <Pill tone={ctx.decided === "granted" ? "ok" : "danger"}>{ctx.decided === "granted" ? "You accepted" : "You declined"}</Pill>
          <p className="mt-2 text-sm text-muted">{ctx.decided === "granted" ? "Thank you. Your family member can now arrange cover for you; you will get the documents and reminders too." : "Nothing is shared. Your family member can ask again if you change your mind."}</p>
        </div>
      ) : (
        <ConsentDecision token={token} />
      )}
    </Card>
  );
}
