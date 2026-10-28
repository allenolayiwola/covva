import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CLAIM_DISCLAIMER, WELFARE_CLAIM_KINDS, funeralClaimChecklist } from "@im/core";
import { Card, Checkbox, EmptyState, Field, Input, Notice, PageHeader, Select, Textarea, buttonClass } from "@im/ui";
import { ActionForm } from "@/components/partner/action-form";
import { MultiUpload } from "@/components/customer/upload";
import { PageSkeleton } from "@/components/customer/skeletons";
import { BusinessRuleError } from "@/server/requests";
import { welfareGroupDetail } from "@/server/welfare";
import { UUID_RE, account } from "../../../../_lib/data";
import { fileClaimAction } from "../../../actions";

export const metadata: Metadata = { title: "Raise a group claim" };

export default function NewGroupClaimPage({ params }: PageProps<"/account/groups/[id]/claims/new">) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Groups" title="Raise a funeral or welfare claim" description="Reported to the group's broker, who checks the documents and delivers the claim to the insurer. Only the insurer decides." />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { user, supabase } = await account(`/account/groups/${id}/claims/new`);
  let d;
  try {
    d = await welfareGroupDetail({ supabase, userId: user.id }, id);
  } catch (err) {
    if (err instanceof BusinessRuleError) notFound();
    throw err;
  }
  if (!d.group.policy_id || !d.policy) {
    return <EmptyState title="No policy in force yet" body="The group has no master policy to claim against. Once the insurer issues it, claims can be raised here." action={<Link href={`/account/groups/${id}`} className={buttonClass("secondary", "sm")}>Back to the group</Link>} />;
  }
  // Admins pick any member; a member may claim for themselves; a beneficiary for the member they are linked to.
  const candidates = d.isAdmin ? d.members.filter((m) => m.status !== "left") : d.members;
  const checklist = funeralClaimChecklist("death");
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card className="p-5 sm:p-6">
        <ActionForm action={fileClaimAction} submitLabel="Report the claim" pendingLabel="Reporting…" size="md">
          <input type="hidden" name="groupId" value={d.group.id} />
          <Field label="Member concerned" htmlFor="cl-member">
            <Select id="cl-member" name="memberId" required defaultValue={candidates.length === 1 ? candidates[0]!.id : ""}>
              {candidates.length !== 1 && <option value="">Choose…</option>}
              {candidates.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
          </Field>
          <Field label="What happened" htmlFor="cl-kind">
            <Select id="cl-kind" name="kind" required defaultValue="death">
              {WELFARE_CLAIM_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
          <Checkbox name="accidental" label="It was an accident (a police report will be needed)" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="cl-date"><Input id="cl-date" name="incident_at" type="date" required max={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Where (town / hospital)" htmlFor="cl-loc"><Input id="cl-loc" name="location" maxLength={300} /></Field>
          </div>
          <Field label="Tell us what happened" htmlFor="cl-desc"><Textarea id="cl-desc" name="description" rows={4} required minLength={20} maxLength={4000} /></Field>
          <Field label="Amount claimed (GH₵, optional)" htmlFor="cl-amt" hint="The benefit set out in the group's cover; the insurer confirms it."><Input id="cl-amt" name="amount_claimed" inputMode="decimal" /></Field>
          <MultiUpload userId={user.id} scope="claims" name="evidence" label="Documents (death certificate, IDs, burial permit, medical report…)" max={12} />
          <p className="text-xs text-muted">{CLAIM_DISCLAIMER}</p>
        </ActionForm>
      </Card>
      <div className="space-y-4">
        <Notice tone="info" title="Documents the insurer usually needs">
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {checklist.map((i) => <li key={i.key}>{i.label}{i.optional ? " (if available)" : ""}{i.hint ? <span className="block text-xs text-muted">{i.hint}</span> : null}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted">The list adjusts to what happened once the claim is reported. Upload what you have now; the broker can ask for the rest.</p>
        </Notice>
        <Notice tone="neutral">Covva attaches the member’s enrolment date, consent and contribution record to the claim so the insurer can see they were paid up.</Notice>
      </div>
    </div>
  );
}
