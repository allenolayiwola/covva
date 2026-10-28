import type { Metadata } from "next";
import { Suspense } from "react";
import { GHANA_REGIONS, WELFARE_CONSENT_TEXT, WELFARE_GROUP_KINDS } from "@im/core";
import { Card, Field, Input, Notice, PageHeader, Select, Textarea } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { PageSkeleton } from "@/components/customer/skeletons";
import { getProfile } from "@/lib/auth";
import { account } from "../../_lib/data";
import { createGroupAction } from "../actions";

export const metadata: Metadata = { title: "Set up a group" };

export default function NewGroupPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Groups" title="Set up a welfare group" description="You become the group admin and its first member. Add members next, then ask a licensed broker for funeral cover quotes." />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  await account("/account/groups/new");
  const profile = await getProfile();
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card className="p-5 sm:p-6">
        <ActionForm action={createGroupAction} submitLabel="Create the group" pendingLabel="Creating…" size="md">
          <Field label="Group name" htmlFor="g-name"><Input id="g-name" name="name" required minLength={2} maxLength={160} placeholder="e.g. Nsawam Hometown Union, London branch" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type of group" htmlFor="g-kind">
              <Select id="g-kind" name="kind" defaultValue="association" required>
                {WELFARE_GROUP_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </Select>
            </Field>
            <Field label="Region (Ghana)" htmlFor="g-region">
              <Select id="g-region" name="region" defaultValue="">
                <option value="">Choose…</option>
                {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          </div>
          <fieldset className="rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Contribution plan</legend>
            <p className="mb-3 text-xs text-muted">What each member (or their sponsor abroad) pays towards the group’s cover. Every contribution settles straight to the insurer, with the broker’s commission split — never into a Covva account.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Per member (GH₵)" htmlFor="g-amount"><Input id="g-amount" name="contribution_amount" inputMode="decimal" required pattern="\d{1,6}(\.\d{1,2})?" defaultValue="50" /></Field>
              <Field label="How often" htmlFor="g-cadence">
                <Select id="g-cadence" name="cadence" defaultValue="monthly">
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Every 3 months</option>
                  <option value="annual">Yearly</option>
                </Select>
              </Field>
              <Field label="Due on day" htmlFor="g-day" hint="1–28 of the month"><Input id="g-day" name="contribution_day" type="number" min={1} max={28} defaultValue={5} required /></Field>
            </div>
          </fieldset>
          <Field label="About the group (optional)" htmlFor="g-desc"><Textarea id="g-desc" name="description" rows={3} maxLength={2000} placeholder="Who the group is for, meeting days, the benefits you want the cover to pay (funeral grant, hospital cash…)" /></Field>
          <Field label="Your phone number on the group" htmlFor="g-phone" hint="So members and the broker can reach the admin."><Input id="g-phone" name="phone" type="tel" inputMode="tel" defaultValue={profile?.phone ?? ""} placeholder="024 123 4567" /></Field>
        </ActionForm>
      </Card>
      <div className="space-y-4">
        <Notice tone="info" title="How it works">
          <ol className="list-decimal space-y-1 pl-4 text-sm">
            <li>Add members by phone number, upload a CSV, or share the join link.</li>
            <li>Members agree to be enrolled (consent is recorded) and name their beneficiaries.</li>
            <li>Ask a licensed broker for quotes; the insurer issues one master policy for the group.</li>
            <li>Contributions are collected per member — or paid by a relative abroad in their own currency — and settle to the insurer.</li>
            <li>When a member dies, the admin or a beneficiary raises the claim here; only the insurer decides it.</li>
          </ol>
        </Notice>
        <Notice tone="neutral" title="What members agree to">{WELFARE_CONSENT_TEXT}</Notice>
      </div>
    </div>
  );
}
