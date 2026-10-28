"use client";
import { useActionState, useState } from "react";
import { Field, Input, Select } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { MultiUpload } from "@/components/customer/upload";
import { initialActionState } from "@/components/customer/utils";
import { addExternalPolicy } from "../actions";

export function ExternalPolicyForm({
  userId,
  categories,
  insurers,
}: {
  userId: string;
  categories: { id: string; name: string }[];
  insurers: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(addExternalPolicy, initialActionState);
  const [insurer, setInsurer] = useState("");
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type of cover" htmlFor="category_id" error={fe.category_id}>
          <Select id="category_id" name="category_id" defaultValue="" aria-invalid={!!fe.category_id}>
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Insurer" htmlFor="insurer_org_id" error={fe.insurer_org_id} hint="Participating insurers are listed first. Choose “Other” if yours isn't here.">
          <Select id="insurer_org_id" name="insurer_org_id" value={insurer} onChange={(e) => setInsurer(e.currentTarget.value)} aria-invalid={!!fe.insurer_org_id}>
            <option value="">Choose…</option>
            {insurers.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
            <option value="other">Other / not listed</option>
          </Select>
        </Field>
        {insurer === "other" && (
          <Field label="Insurer name" htmlFor="external_insurer_name" error={fe.external_insurer_name} hint="As printed on your policy. We won't contact them." className="sm:col-span-2">
            <Input id="external_insurer_name" name="external_insurer_name" maxLength={120} required aria-invalid={!!fe.external_insurer_name} />
          </Field>
        )}
        <Field label="Policy number" htmlFor="policy_number" error={fe.policy_number}>
          <Input id="policy_number" name="policy_number" autoComplete="off" aria-invalid={!!fe.policy_number} />
        </Field>
        <Field label={<>Name <span className="font-normal text-subtle">(optional)</span></>} htmlFor="nickname" hint="e.g. Family car">
          <Input id="nickname" name="nickname" maxLength={60} />
        </Field>
        <Field label="Cover starts" htmlFor="cover_start" error={fe.cover_start}>
          <Input id="cover_start" name="cover_start" type="date" aria-invalid={!!fe.cover_start} />
        </Field>
        <Field label="Cover ends" htmlFor="cover_end" error={fe.cover_end}>
          <Input id="cover_end" name="cover_end" type="date" aria-invalid={!!fe.cover_end} />
        </Field>
        <Field label={<>Premium per year <span className="font-normal text-subtle">(optional)</span></>} htmlFor="premium" error={fe.premium}>
          <Input id="premium" name="premium" type="number" inputMode="decimal" min={0} step="any" />
        </Field>
        <Field label={<>Sum insured <span className="font-normal text-subtle">(optional)</span></>} htmlFor="sum_insured" error={fe.sum_insured}>
          <Input id="sum_insured" name="sum_insured" type="number" inputMode="decimal" min={0} step="any" />
        </Field>
      </div>
      <MultiUpload userId={userId} scope="policies" name="documents" label="Policy schedule or certificate" hint="Optional · PDF, JPG or PNG · up to 10 MB each" max={5} />
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Adding…">Add to my wallet</SubmitButton>
    </form>
  );
}
