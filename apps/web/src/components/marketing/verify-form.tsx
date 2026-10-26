"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { CircleCheck, CircleX, Search, ShieldQuestion } from "lucide-react";
import { Button, Field, Input, Notice, Select, cn } from "@im/ui";

export interface VerifyInsurer { slug: string; name: string }
interface VerifyResult { valid: boolean; status?: string; insurerName?: string; coverStart?: string | null; coverEnd?: string | null; categoryName?: string; policyNumberMasked?: string | null; message?: string }

/** 10-character wallet/QR verification code (Crockford base32) vs. an insurer policy number. */
const isCode = (s: string) => /^[0-9A-HJKMNP-TV-Z]{10}$/i.test(s.trim());

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Public policy verification form. POSTs to /api/public/verify-policy (the `verify_policy` RPC),
 * which returns only { valid, status, insurerName, coverStart, coverEnd, categoryName,
 * policyNumberMasked } — never customer data. `?q=` (from a wallet QR code) prefills the field:
 * a 10-character verification code is looked up on its own, anything else as insurer + number.
 */
export function VerifyForm({ insurers, className }: { insurers: VerifyInsurer[]; className?: string }) {
  const params = useSearchParams();
  const prefill = params.get("q") ?? "";
  const [policyNumber, setPolicyNumber] = React.useState(prefill);
  const [insurer, setInsurer] = React.useState(params.get("insurer") ?? insurers[0]?.slug ?? "");
  const [state, setState] = React.useState<{ kind: "idle" | "loading" | "done" | "error"; result?: VerifyResult; error?: string }>({ kind: "idle" });
  const resultRef = React.useRef<HTMLDivElement>(null);
  const uid = React.useId();
  const id = (f: string) => `${uid}-${f}`;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const number = policyNumber.trim();
    if (!number) {
      setState({ kind: "error", error: "Please enter the policy number." });
      return;
    }
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/public/verify-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isCode(number) ? { code: number.toUpperCase() } : { insurer, policyNumber: number }),
      });
      if (res.status === 429) {
        setState({ kind: "error", error: "Too many checks in a short time. Please wait a moment and try again." });
        return;
      }
      const json = (await res.json()) as VerifyResult;
      setState({ kind: "done", result: json });
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch {
      setState({ kind: "error", error: "We could not reach the verification service. Please try again." });
    }
  }

  const r = state.result;
  return (
    <div className={cn("space-y-5", className)}>
      <form onSubmit={submit} noValidate className="rounded-[24px] border border-line bg-white p-5 shadow-float sm:p-7" aria-labelledby={id("title")}>
        <h2 id={id("title")} className="font-display text-[22px] text-ink">Check a policy</h2>
        <p className="mt-1 text-[14px] text-muted">Enter the policy number from the certificate or scan the QR code in the customer’s Covva wallet.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Insurer" htmlFor={id("ins")}>
            <Select id={id("ins")} value={insurer} onChange={(e) => setInsurer(e.target.value)}>
              {insurers.map((i) => (
                <option key={i.slug} value={i.slug}>{i.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Policy number" htmlFor={id("num")} hint={isCode(policyNumber) ? "Verification code recognised — the insurer is read from the code." : undefined} error={state.kind === "error" ? state.error : undefined}>
            <Input id={id("num")} value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} autoComplete="off" placeholder="Policy number or 10-character code" maxLength={60} aria-invalid={state.kind === "error"} />
          </Field>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-subtle">We only show whether the policy is valid, the insurer, cover dates and the type of cover. No personal details.</p>
          <Button type="submit" size="lg" loading={state.kind === "loading"}>
            <Search aria-hidden className="size-4" /> Verify
          </Button>
        </div>
      </form>

      {state.kind === "done" && r && (
        <div ref={resultRef} tabIndex={-1} role="status" className="focus:outline-none">
          {r.valid ? (
            <div className="rounded-card border border-brand/40 bg-mint-2 p-5 sm:p-6">
              <p className="flex items-center gap-2 text-lg font-semibold text-brand-deep"><CircleCheck aria-hidden className="size-5" /> Valid policy</p>
              <dl className="mt-4 grid gap-3 text-[15px] sm:grid-cols-2">
                <div><dt className="text-xs uppercase tracking-wider text-muted">Insurer</dt><dd className="font-medium text-ink">{r.insurerName}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-muted">Cover</dt><dd className="font-medium text-ink">{r.categoryName}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-muted">Cover start</dt><dd className="font-medium text-ink">{fmt(r.coverStart)}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-muted">Cover end</dt><dd className="font-medium text-ink">{fmt(r.coverEnd)}</dd></div>
                {r.policyNumberMasked && <div><dt className="text-xs uppercase tracking-wider text-muted">Policy number</dt><dd className="font-mono font-medium text-ink">{r.policyNumberMasked}</dd></div>}
              </dl>
              <p className="mt-4 text-[13px] text-muted">Status: {r.status}. Checked just now against the insurer’s issued record on Covva.</p>
            </div>
          ) : (
            <Notice tone="danger" icon={<CircleX className="size-4" />} title="No valid policy found">
              {r.message ?? "We could not find an active policy with that number for this insurer. Check the number, the insurer, and that the policy was issued through Covva. A policy bought elsewhere must be verified with the insurer directly."}
            </Notice>
          )}
        </div>
      )}
      {state.kind === "idle" && (
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
          <ShieldQuestion aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
          For police, landlords, employers and partners. A “not found” result is not proof that a vehicle is uninsured — the policy may have been bought outside Covva.
        </p>
      )}
    </div>
  );
}
