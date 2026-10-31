import { ArrowDown, ArrowRight } from "lucide-react";

/** Real text and CSS keep the illustrated payment flow readable without JS or images. */
export function PaymentSplit() {
  return (
    <figure aria-labelledby="payment-split-title" className="max-w-[1000px]">
      <div className="rounded-[24px] border border-line bg-mist p-8 sm:p-10">
        <h3 id="payment-split-title" className="mb-8 text-[20px] leading-[1.25] text-ink md:text-[24px]">How a payment is split</h3>
        <div className="grid items-center gap-3 md:grid-cols-[1fr_48px_1fr_72px_1fr]">
          <div className="rounded-[20px] border border-line bg-white p-5 text-center">
            <p className="font-medium text-ink">Customer pays</p>
            <p className="mt-1 text-sm text-muted [text-wrap:balance]">Pays by MoMo or card</p>
          </div>
          <ArrowRight aria-hidden className="mx-auto hidden size-6 text-brand md:block" />
          <ArrowDown aria-hidden className="mx-auto size-6 text-brand md:hidden" />
          <div className="rounded-[20px] border border-brand bg-mint p-5 text-center">
            <p className="font-medium text-ink">Paystack</p>
            <p className="mt-1 text-sm text-muted [text-wrap:balance]">Payment processor</p>
          </div>
          <div className="flex flex-col items-center gap-1 text-brand">
            <span className="text-sm">Split</span>
            <svg aria-hidden viewBox="0 0 72 160" className="hidden h-40 w-full md:block" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M0 80C32 80 32 8 66 8m-7-6 7 6-7 6" />
              <path d="M0 80c32 0 32 72 66 72m-7-6 7 6-7 6" stroke="#D9B36A" />
            </svg>
            <ArrowDown aria-hidden className="size-6 md:hidden" />
          </div>
          <ul className="grid gap-3 md:gap-12" aria-label="Payment recipients">
            <li className="rounded-[20px] border border-brand bg-white p-5 text-center">
              <p className="font-medium text-ink">Insurer / broker</p>
              <p className="mt-1 text-sm text-muted [text-wrap:balance]">Premium for the policy</p>
            </li>
            <li className="rounded-[20px] border border-[#D9B36A] bg-[#FFF0D6] p-5 text-center">
              <p className="font-medium text-ink">Covva</p>
              <p className="mt-1 text-sm text-muted [text-wrap:balance]">Platform commission</p>
            </li>
          </ul>
        </div>
        <p className="mt-8 text-sm text-muted">Amounts depend on the policy.</p>
      </div>
      <figcaption className="mt-3 text-[13px] leading-relaxed text-muted [text-wrap:pretty]">Diagram for illustration. The split is shown on your receipt. Any fees are shown by Paystack before you confirm.</figcaption>
    </figure>
  );
}
