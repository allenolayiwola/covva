import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Building2, Mail } from "lucide-react";
import { formatDate, humanize } from "@im/core";
import { Avatar, Card, Notice, buttonClass } from "@im/ui";
import { getUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { PageSkeleton } from "@/components/customer/skeletons";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept your invitation", robots: { index: false } };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <Card className="p-6 shadow-float sm:p-8">
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body params={params} />
      </Suspense>
    </Card>
  );
}

/** Request-time clock (the page renders once per request after `connection()`). */
const nowMs = () => Date.now();

const ORG_KIND: Record<string, string> = { broker: "broker", insurer: "insurer", enterprise: "business", platform: "platform" };

async function Body({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  await connection();
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{16,128}$/.test(token);
  // Server-only RPC: validate the invitation token before reading invitation metadata.
  const { data } = valid ? await createServiceClient().rpc("invitation_preview", { p_token: token }) : { data: null };
  const invite = data?.[0] ?? null;
  const user = await getUser();
  const here = `/invite/${encodeURIComponent(token)}`;

  if (!invite) {
    return (
      <>
        <h1 className="text-[28px] font-bold tracking-tight text-ink">Invitation not found</h1>
        <p className="mt-2 text-[15px] text-muted">This link is not valid. Ask the person who invited you to send a new invitation.</p>
        <Link href="/" className={buttonClass("secondary", "md", "mt-6")}>Go to the homepage</Link>
      </>
    );
  }

  const expired = Date.parse(invite.expires_at) < nowMs();
  const kind = ORG_KIND[invite.org_type] ?? "organisation";
  const emailMatches = !!user?.email && user.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar name={invite.org_name} size={48} />
        <div>
          <p className="text-sm text-muted">You&apos;re invited to join</p>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight text-ink">{invite.org_name}</h1>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-mist p-4 text-sm">
        <div>
          <dt className="text-muted">Role</dt>
          <dd className="font-medium text-ink">{humanize(invite.role)}{invite.team ? ` · ${invite.team}` : ""}</dd>
        </div>
        <div>
          <dt className="text-muted">Organisation</dt>
          <dd className="font-medium text-ink"><Building2 aria-hidden className="mr-1 inline size-4 text-brand" />{humanize(kind)}</dd>
        </div>
        <div>
          <dt className="text-muted">Sent to</dt>
          <dd className="font-medium text-ink"><Mail aria-hidden className="mr-1 inline size-4 text-brand" />{invite.email}</dd>
        </div>
        <div>
          <dt className="text-muted">{expired ? "Expired" : "Expires"}</dt>
          <dd className="font-medium text-ink">{formatDate(invite.expires_at)}</dd>
        </div>
      </dl>
      {invite.invited_by_name && <p className="mt-3 text-sm text-muted">Invited by {invite.invited_by_name}.</p>}

      {invite.accepted_at ? (
        <Notice tone="ok" className="mt-6" title="Already accepted">
          This invitation was accepted on {formatDate(invite.accepted_at)}.{" "}
          <Link href="/partner" className="font-semibold underline">Open the partner workspace</Link>.
        </Notice>
      ) : expired ? (
        <Notice tone="wait" className="mt-6" title="This invitation has expired">
          Ask an admin at {invite.org_name} to send a new one.
        </Notice>
      ) : !user ? (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-ink-2">Sign in with <span className="font-medium">{invite.email}</span> to accept, or create an account with that address.</p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className={buttonClass("primary", "md")}>Sign in</Link>
            <Link href={`/sign-up?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`} className={buttonClass("secondary", "md")}>Create an account</Link>
          </div>
        </div>
      ) : !emailMatches ? (
        <Notice tone="wait" className="mt-6" title="Signed in with a different email">
          You&apos;re signed in as <span className="font-medium">{user.email}</span>, but this invitation was sent to <span className="font-medium">{invite.email}</span>.{" "}
          <form action={`/sign-out?next=${encodeURIComponent(here)}`} method="post" className="mt-2">
            <button type="submit" className={buttonClass("outline", "sm")}>Sign out and switch account</button>
          </form>
          Or ask the admin to re-invite your current email.
        </Notice>
      ) : (
        <div className="mt-6">
          <p className="text-sm text-ink-2">
            Accepting adds you to {invite.org_name} as {humanize(invite.role).toLowerCase()}. Colleagues will see your name and email.
            {kind === "broker" || kind === "insurer" ? " You'll work in the partner workspace." : ""}
          </p>
          <AcceptForm token={token} orgName={invite.org_name} />
        </div>
      )}
    </>
  );
}
