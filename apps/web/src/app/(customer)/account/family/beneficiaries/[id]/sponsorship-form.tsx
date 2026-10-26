"use client";
import * as React from "react";
import { useActionState } from "react";
import { Gift } from "lucide-react";
import { Button, Checkbox, Field, Select, Textarea } from "@im/ui";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState, type ActionState } from "@/components/customer/utils";
import { handOverGift, saveSponsorshipGift, sponsorExistingPolicy } from "../../actions";

export interface SponsorshipLite {
  id: string;
  gift: boolean;
  gift_message: string | null;
  gift_revealed_at: string | null;
  notify_beneficiary: boolean;
  policy_id: string | null;
}

/** "Gift this policy" toggle + personal message + "tell them about updates" on a sponsorship. */
export function SponsorshipForm({ sponsorship, beneficiaryName }: { sponsorship: SponsorshipLite; beneficiaryName: string }) {
  const [state, action] = useActionState(saveSponsorshipGift, initialActionState);
  const [gift, setGift] = React.useState(sponsorship.gift);
  const [handing, startHanding] = React.useTransition();
  const [handResult, setHandResult] = React.useState<ActionState | null>(null);
  return (
    <form action={action} className="mt-4 space-y-3 border-t border-line pt-4" noValidate>
      <input type="hidden" name="sponsorship_id" value={sponsorship.id} />
      <Checkbox
        name="gift"
        checked={gift}
        onChange={(e) => setGift(e.target.checked)}
        label={
          <span>
            <span className="inline-flex items-center gap-1.5 font-medium text-ink"><Gift aria-hidden className="size-4 text-brand" /> Gift this policy</span>
            <span className="block text-sm text-muted">{beneficiaryName} hears about it when you hand it over, with your message. Until then it stays a surprise.</span>
          </span>
        }
      />
      {gift && (
        <Field label="Your message" htmlFor={`gift-${sponsorship.id}`} hint="Up to 500 characters. Shown when they open the gift.">
          <Textarea id={`gift-${sponsorship.id}`} name="gift_message" defaultValue={sponsorship.gift_message ?? ""} maxLength={500} rows={3} placeholder={`Dear Mum, this is so you never have to worry about hospital bills…`} />
        </Field>
      )}
      <Checkbox
        name="notify_beneficiary"
        defaultChecked={sponsorship.notify_beneficiary}
        label={
          <span>
            <span className="font-medium text-ink">Send {beneficiaryName} documents, reminders and claim updates too</span>
            <span className="block text-sm text-muted">By SMS or WhatsApp to their phone, or in the app once they sign in with that number.</span>
          </span>
        }
      />
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Save</SubmitButton>
        {sponsorship.gift && sponsorship.policy_id && !sponsorship.gift_revealed_at && (
          <Button
            type="button"
            size="sm"
            loading={handing}
            onClick={() =>
              startHanding(async () => {
                setHandResult(await handOverGift(sponsorship.id));
              })
            }
          >
            <Gift aria-hidden className="size-4" /> Hand over the gift now
          </Button>
        )}
      </div>
      <FormMessage state={handResult ?? undefined} />
    </form>
  );
}

/** Link a policy the sponsor already holds to this family member (creates the sponsorship). */
export function LinkPolicyForm({ beneficiaryId, beneficiaryName, policies }: { beneficiaryId: string; beneficiaryName: string; policies: { id: string; label: string }[] }) {
  const [state, action] = useActionState(sponsorExistingPolicy, initialActionState);
  return (
    <form action={action} className="mt-6 rounded-card border border-dashed border-line p-4" noValidate>
      <input type="hidden" name="beneficiary_id" value={beneficiaryId} />
      <p className="mb-3 text-sm font-medium text-ink">Already pay for a policy that covers {beneficiaryName}? Link it here.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Policy" htmlFor={`link-policy-${beneficiaryId}`} className="min-w-[16rem] flex-1">
          <Select id={`link-policy-${beneficiaryId}`} name="policy_id" defaultValue="">
            <option value="">Choose a policy…</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <SubmitButton size="md" variant="secondary" pendingText="Linking…">Link policy</SubmitButton>
      </div>
      <FormMessage state={state} className="mt-3" />
    </form>
  );
}
