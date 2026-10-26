"use client";
import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button, Field, Input, Notice, Select, Textarea, buttonClass } from "@im/ui";
import type { RiskField } from "@im/core";
import { FormMessage, SubmitButton, type FormAction } from "./action-form";
import { RiskFields } from "./risk-fields";

export interface CategoryOption {
  id: string;
  name: string;
  availability: string;
  riskSchema: RiskField[];
}

/**
 * "Create request" — an assisted request on behalf of an existing customer (looked up by
 * email or phone). Saved with source = call_centre and this broker as broker of record.
 */
export function CreateRequestButton({ categories, action }: { categories: CategoryOption[]; action: FormAction }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [state, formAction] = useActionState(action, { ok: false });
  const category = categories.find((c) => c.id === categoryId);
  const createdId = state.ok && typeof state.data?.requestId === "string" ? state.data.requestId : null;

  return (
    <>
      <Button size="lg" onClick={() => dialog.current?.showModal()}>Create request</Button>
      <dialog
        ref={dialog}
        aria-labelledby="create-request-title"
        className="m-auto w-[min(720px,calc(100vw-2rem))] rounded-card border border-line bg-white p-0 shadow-float backdrop:bg-ink/30"
      >
        <form action={formAction} className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <h2 id="create-request-title" className="text-xl font-semibold text-ink">Create an assisted request</h2>
              <p className="text-sm text-muted">For a customer who called or visited. You become the broker of record.</p>
            </div>
            <button type="button" onClick={() => dialog.current?.close()} className="rounded-full p-1.5 text-muted hover:bg-mist" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            {createdId ? (
              <Notice tone="ok" title="Request created">
                {state.message}{" "}
                <Link href={`/partner/requests/${createdId}`} className="font-semibold underline">Open the request</Link>
              </Notice>
            ) : null}
            {state.data?.invite === true && (
              <Notice tone="wait" title="No customer account found">
                The customer needs their own account before we can hold their data. Ask them to sign up at
                {" "}<span className="font-medium">/sign-up</span> with this email or phone (it takes two minutes and records their consent),
                then create the request again. You can also send them the sign-up link by SMS from your usual channel.
              </Notice>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer email or phone" htmlFor="cr-customer" hint="Exact match on the customer's account">
                <Input id="cr-customer" name="customer" required placeholder="ama@example.com or +233…" autoComplete="off" />
              </Field>
              <Field label="Category" htmlFor="cr-category">
                <Select id="cr-category" name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.currentTarget.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.availability === "planned"}>
                      {c.name}{c.availability === "planned" ? " (planned)" : c.availability === "broker_assisted" ? " (broker assisted)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Request type" htmlFor="cr-type">
                <Select id="cr-type" name="type" defaultValue="new_cover">
                  <option value="new_cover">New cover</option>
                  <option value="renewal">Renewal</option>
                  <option value="switch">Switch</option>
                  <option value="endorsement">Endorsement / change</option>
                  <option value="service">Service</option>
                </Select>
              </Field>
              <Field label="How did they contact you?" htmlFor="cr-channel">
                <Select id="cr-channel" name="channel" defaultValue="call">
                  <option value="call">Phone call</option>
                  <option value="visit">Office visit</option>
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                </Select>
              </Field>
            </div>
            {category && category.riskSchema.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink">Risk details <span className="font-normal text-muted">(fill what you know — the customer can complete the rest)</span></legend>
                <RiskFields key={category.id} fields={category.riskSchema} requiredOff idPrefix="cr" />
              </fieldset>
            )}
            <Field label="Note for the file (internal)" htmlFor="cr-note">
              <Textarea id="cr-note" name="note" rows={3} placeholder="What the customer asked for, timing, anything to check." className="min-h-20" />
            </Field>
            <FormMessage state={state.data?.invite ? { ok: false } : state} />
          </div>
          <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
            <button type="button" className={buttonClass("ghost", "md")} onClick={() => dialog.current?.close()}>Close</button>
            <SubmitButton size="md" pendingLabel="Creating…">Create request</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
