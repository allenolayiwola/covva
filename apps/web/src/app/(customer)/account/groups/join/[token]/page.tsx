import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { contributionPlanLabel, welfareDisclaimer, welfareKindLabel } from "@im/core";
import { Card, Checkbox, EmptyState, Field, Input, Notice, PageHeader, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { getProfile } from "@/lib/auth";
import { welfareInvitePreview } from "@/server/welfare";
import { account } from "../../../_lib/data";
import { joinGroupAction } from "../../actions";

export const metadata: Metadata = { title: "Join a group" };

export default function JoinPage({ params }: PageProps<"/account/groups/join/[token]">) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Groups" title="Join a welfare group" description="Check the group, agree to be enrolled, and you are in. The admin approves new members who were not added by phone number." />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await account(`/account/groups/join/${token}`);
  const [preview, profile] = await Promise.all([welfareInvitePreview(token), getProfile()]);
  if (!preview) {
    return <EmptyState title="This invitation link is not valid" body="It may have been switched off by the group admin. Ask them for a new link." action={<Link href="/account/groups" className={buttonClass("secondary", "sm")}>Back to groups</Link>} />;
  }
  const { group } = preview;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card className="p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{welfareKindLabel(group.kind)}{group.region ? ` · ${group.region}` : ""}</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">{group.name}</h2>
        <p className="mt-1 text-sm text-muted">{group.member_count} member{group.member_count === 1 ? "" : "s"} · {contributionPlanLabel({ amount: Number(group.contribution_amount), cadence: group.contribution_cadence })}</p>
        <ActionForm action={joinGroupAction} submitLabel="Join the group" pendingLabel="Joining…" size="md" className="mt-5">
          <input type="hidden" name="token" value={token} />
          <Field label="Your full name" htmlFor="j-name"><Input id="j-name" name="full_name" required minLength={2} maxLength={160} defaultValue={profile?.full_name ?? ""} /></Field>
          <Field label="Your phone number" htmlFor="j-phone" hint="If the admin already added you with this number, your membership links to it."><Input id="j-phone" name="phone" type="tel" inputMode="tel" defaultValue={profile?.phone ?? ""} placeholder="024 123 4567" /></Field>
          <Checkbox name="consent" required label={preview.consentText} />
        </ActionForm>
      </Card>
      <Notice tone="info" title="Who provides the cover">{welfareDisclaimer(preview.insurer, preview.broker)}</Notice>
    </div>
  );
}
