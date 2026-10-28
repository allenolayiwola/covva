"use client";
import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Field, Input, Notice, Select, Textarea, cn } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { MultiUpload } from "@/components/customer/upload";
import { initialActionState } from "@/components/customer/utils";
import { reportProxyClaim } from "../../actions";

export interface ProxyClaimPolicy {
  id: string;
  label: string;
  subtitle: string;
  beneficiaryId: string;
  beneficiaryName: string;
  incidents: { value: string; label: string; icon: string }[];
  eligible: boolean;
  blockedReason: string | null;
}

export function ProxyClaimForm({ userId, policies, initialPolicyId }: { userId: string; policies: ProxyClaimPolicy[]; initialPolicyId?: string }) {
  const [state, action] = useActionState(reportProxyClaim, initialActionState);
  const [policyId, setPolicyId] = React.useState(initialPolicyId && policies.some((p) => p.id === initialPolicyId) ? initialPolicyId : "");
  const policy = policies.find((p) => p.id === policyId);
  const fe = state.fieldErrors ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const blocked = !!policy && !policy.eligible;

  return (
    <form action={action} className="space-y-5" noValidate aria-label="File a claim for a family member">
      <Field label="Which policy?" htmlFor="policyId" error={fe.policyId}>
        <Select id="policyId" name="policyId" value={policyId} onChange={(e) => setPolicyId(e.target.value)} aria-invalid={!!fe.policyId}>
          <option value="">Choose a policy…</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>{p.label} — {p.subtitle}</option>
          ))}
        </Select>
      </Field>

      {blocked && policy && (
        <Notice tone="wait" title={`You need ${policy.beneficiaryName}'s consent`}>
          {policy.blockedReason}{" "}
          <Link href={`/account/family/beneficiaries/${policy.beneficiaryId}`} className="font-medium text-brand hover:underline">Ask for consent</Link>
        </Notice>
      )}

      <fieldset className={cn("space-y-5", (!policy || blocked) && "opacity-60")} disabled={!policy || blocked}>
        <Field label="What happened?" htmlFor="incidentType" error={fe.incidentType}>
          <Select id="incidentType" name="incidentType" defaultValue="" aria-invalid={!!fe.incidentType}>
            <option value="">Choose…</option>
            {(policy?.incidents ?? []).map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date it happened" htmlFor="incidentDate" error={fe.incidentDate}>
            <Input id="incidentDate" name="incidentDate" type="date" max={today} required aria-invalid={!!fe.incidentDate} />
          </Field>
          <Field label={<>Time <span className="font-normal text-subtle">(optional)</span></>} htmlFor="incidentTime">
            <Input id="incidentTime" name="incidentTime" type="time" />
          </Field>
        </div>
        <Field label={<>Where <span className="font-normal text-subtle">(optional)</span></>} htmlFor="location" error={fe.location}>
          <Input id="location" name="location" maxLength={300} placeholder="e.g. Kumasi, near Kejetia" />
        </Field>
        <Field label={`What happened to ${policy?.beneficiaryName ?? "them"}?`} htmlFor="description" error={fe.description} hint="Describe it as they told you. The broker may call them to confirm.">
          <Textarea id="description" name="description" rows={5} maxLength={5000} required aria-invalid={!!fe.description} />
        </Field>
        <Field label={<>Amount claimed (GH₵) <span className="font-normal text-subtle">(optional)</span></>} htmlFor="amountClaimed" error={fe.amountClaimed}>
          <Input id="amountClaimed" name="amountClaimed" type="number" inputMode="decimal" min={0} step="any" />
        </Field>
        <MultiUpload userId={userId} scope="claims" name="evidence" label="Photos, receipts or reports" hint="You can add more later. Files go to the broker, who delivers them to the insurer." />
      </fieldset>

      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-subtle">Reported on behalf of {policy?.beneficiaryName ?? "your family member"} with their consent. Reporting is not approval; only the insurer decides.</p>
        <SubmitButton size="lg" pendingText="Sending…" disabled={!policy || blocked} className="shrink-0">Report claim</SubmitButton>
      </div>
    </form>
  );
}
