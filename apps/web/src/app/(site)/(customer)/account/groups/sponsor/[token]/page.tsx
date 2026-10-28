import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SUPPORTED_DISPLAY_CURRENCIES } from "@im/core";
import { Card, EmptyState, Field, Notice, PageHeader, Select, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { getProfile } from "@/lib/auth";
import { sponsorInvitePreview } from "@/server/welfare";
import { account } from "../../../_lib/data";
import { acceptSponsorAction } from "../../actions";

export const metadata: Metadata = { title: "Sponsor a member" };

export default function SponsorPage({ params }: PageProps<"/account/groups/sponsor/[token]">) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Groups" title="Pay contributions for a relative" description="Accept the invitation to see that member's contributions and pay them from abroad in your own currency." />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await account(`/account/groups/sponsor/${token}`);
  const [preview, profile] = await Promise.all([sponsorInvitePreview(token), getProfile()]);
  if (!preview) {
    return <EmptyState title="This invitation is not valid any more" body="Ask the member or the group admin for a new sponsor link." action={<Link href="/account/groups" className={buttonClass("secondary", "sm")}>Back to groups</Link>} />;
  }
  const preferred = profile?.preferred_currency && (SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes(profile.preferred_currency) ? profile.preferred_currency : preview.currency;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card className="p-5 sm:p-6">
        <h2 className="text-xl font-semibold text-ink">{preview.member}</h2>
        <p className="mt-1 text-sm text-muted">{preview.group}</p>
        <ActionForm action={acceptSponsorAction} submitLabel="Accept and sponsor" pendingLabel="Accepting…" size="md" className="mt-5">
          <input type="hidden" name="token" value={token} />
          <Field label="Show amounts in" htmlFor="s-cur" hint="The contribution is a cedi amount paid to the insurer; your bank converts at checkout. We show an indicative rate with its source.">
            <Select id="s-cur" name="currency" defaultValue={preferred}>
              {SUPPORTED_DISPLAY_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Card>
      <Notice tone="info" title="What you will see">
        Only {preview.member}’s membership and contributions — not the other members. Every payment you make settles directly to the group’s insurer (with the broker’s commission split); Covva records that you paid and never holds the money.
      </Notice>
    </div>
  );
}
