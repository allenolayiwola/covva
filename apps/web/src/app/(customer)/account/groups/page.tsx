import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HeartHandshake, Link2, Plus, Users } from "lucide-react";
import { WELFARE_GROUP_STATUS, WELFARE_MEMBER_STATUS, contributionPlanLabel, formatGHS, welfareKindLabel, type WelfareGroupStatus, type WelfareMemberStatus } from "@im/core";
import { Card, Checkbox, EmptyState, Field, Input, Notice, PageHeader, Pill, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { myWelfareGroups } from "@/server/welfare";
import { account } from "../_lib/data";
import { consentMembershipAction, endSponsorshipAction } from "./actions";

export const metadata: Metadata = { title: "Groups" };

export default function GroupsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Groups"
        description="Funeral and welfare cover for your association, church, alumni group, hometown union or family — members, contributions and beneficiaries in one place."
        actions={
          <Link href="/account/groups/new" className={buttonClass("primary", "sm")}>
            <Plus aria-hidden className="size-4" /> Set up a group
          </Link>
        }
      />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body />
      </Suspense>
    </div>
  );
}

const statusMeta = (s: string) => WELFARE_GROUP_STATUS[s as WelfareGroupStatus] ?? WELFARE_GROUP_STATUS.draft;
const memberMeta = (s: string) => WELFARE_MEMBER_STATUS[s as WelfareMemberStatus] ?? WELFARE_MEMBER_STATUS.invited;

async function Body() {
  const { user, supabase } = await account("/account/groups");
  const mine = await myWelfareGroups({ supabase, userId: user.id });
  const empty = !mine.admin.length && !mine.member.length && !mine.sponsored.length;

  return (
    <div className="space-y-8">
      {mine.pendingConsent.length > 0 && (
        <section aria-labelledby="consent-h" className="space-y-3">
          <h2 id="consent-h" className="text-lg font-semibold text-ink">You have been added to a group</h2>
          {mine.pendingConsent.map(({ group, me }) => (
            <Card key={me.id} className="p-5">
              <p className="font-semibold text-ink">{group.name}</p>
              <p className="mt-1 text-sm text-muted">The admin added you by phone number. Enrolment needs your agreement.</p>
              <ActionForm action={consentMembershipAction} submitLabel="I agree — enrol me" className="mt-3">
                <input type="hidden" name="memberId" value={me.id} />
                <Checkbox name="consent" label="I agree to be enrolled and to my details being shared with the group's broker and insurer." required />
              </ActionForm>
            </Card>
          ))}
        </section>
      )}

      {empty && (
        <EmptyState
          icon={<HeartHandshake className="size-5" />}
          title="No groups yet"
          body="Set up a welfare group and invite members with a link, or ask your group admin for the invitation link. Cover is provided by an insurer and arranged by a licensed broker; Covva records enrolment and contributions and never holds the money."
          action={
            <div className="flex flex-wrap gap-2">
              <Link href="/account/groups/new" className={buttonClass("primary", "sm")}>Set up a group</Link>
              <a href="#join" className={buttonClass("secondary", "sm")}>I have an invitation link</a>
            </div>
          }
        />
      )}

      {mine.admin.length > 0 && (
        <section aria-labelledby="admin-h" className="space-y-3">
          <h2 id="admin-h" className="text-lg font-semibold text-ink">Groups you run</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {mine.admin.map((g) => {
              const meta = statusMeta(g.status);
              return (
                <li key={g.id}>
                  <Link href={`/account/groups/${g.id}`} className="block rounded-[20px] border border-line bg-white p-5 transition-colors hover:border-brand">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{g.name}</p>
                        <p className="text-xs text-muted">{welfareKindLabel(g.kind)} · {g.reference}</p>
                      </div>
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                    </div>
                    <p className="mt-3 flex items-center gap-2 text-sm text-ink-2"><Users aria-hidden className="size-4 text-brand" /> {g.member_count} member{g.member_count === 1 ? "" : "s"} · {contributionPlanLabel({ amount: Number(g.contribution_amount), cadence: g.contribution_cadence })}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {mine.member.length > 0 && (
        <section aria-labelledby="member-h" className="space-y-3">
          <h2 id="member-h" className="text-lg font-semibold text-ink">Groups you belong to</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {mine.member.map(({ group: g, me }) => {
              const meta = memberMeta(me.status);
              return (
                <li key={me.id}>
                  <Link href={`/account/groups/${g.id}`} className="block rounded-[20px] border border-line bg-white p-5 transition-colors hover:border-brand">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{g.name}</p>
                        <p className="text-xs text-muted">{welfareKindLabel(g.kind)} · {statusMeta(g.status).label}</p>
                      </div>
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                    </div>
                    <p className="mt-3 text-sm text-ink-2">{contributionPlanLabel({ amount: Number(g.contribution_amount), cadence: g.contribution_cadence })}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {mine.sponsored.length > 0 && (
        <section aria-labelledby="sponsor-h" className="space-y-3">
          <h2 id="sponsor-h" className="text-lg font-semibold text-ink">Members you pay for</h2>
          <p className="text-sm text-muted">You see only the members you sponsor. Each contribution you pay settles directly to the insurer; you can pay in {mine.sponsored[0]!.sponsorship.display_currency} with the cedi amount shown.</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {mine.sponsored.map(({ group: g, member: m, sponsorship: s, standing, unpaidGhs }) => (
              <li key={s.id} className="rounded-[20px] border border-line bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{m.full_name}</p>
                    <p className="text-xs text-muted">{g.name} · {statusMeta(g.status).label}</p>
                  </div>
                  <Pill tone={standing.tone}>{standing.label}</Pill>
                </div>
                <p className="mt-3 text-sm text-ink-2">{unpaidGhs > 0 ? `${formatGHS(unpaidGhs, { decimals: true })} outstanding` : "Nothing outstanding"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link href={`/account/groups/${g.id}?tab=contributions`} className={buttonClass(unpaidGhs > 0 ? "primary" : "secondary", "sm")}>{unpaidGhs > 0 ? "Pay now" : "View"}</Link>
                  <ActionForm action={endSponsorshipAction} submitLabel="Stop sponsoring" variant="ghost" confirm={`Stop paying for ${m.full_name}? Their contributions will fall to them.`}>
                    <input type="hidden" name="sponsorId" value={s.id} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card id="join" className="p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-mist text-brand"><Link2 aria-hidden className="size-5" /></span>
          <div>
            <p className="font-semibold text-ink">Have an invitation link?</p>
            <p className="text-xs text-muted">Paste the link or the code your group admin shared. If the admin added you by phone, sign in with that number and your membership links itself.</p>
          </div>
        </div>
        <form action="/account/groups/join" method="get" className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Invitation link or code" htmlFor="join-token" className="min-w-[16rem] flex-1">
            <Input id="join-token" name="t" placeholder="https://covva.com.gh/account/groups/join/…" required />
          </Field>
          <button type="submit" className={buttonClass("secondary", "md")}>Continue</button>
        </form>
      </Card>

      <Notice tone="info">
        Covva is a marketplace. Group cover is provided by the insurer named on the group and arranged by its licensed broker. Contributions settle directly to them; Covva records who paid for whom and never holds the money. Only the insurer decides claims.
      </Notice>
    </div>
  );
}
