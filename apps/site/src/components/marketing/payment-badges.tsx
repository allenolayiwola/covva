import { CreditCard, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { cn } from "@im/ui";
import { PAYMENT_METHODS } from "./content";

/**
 * Text-only payment method badges (no third-party brand image files). A small coloured dot hints
 * at the brand; the label is always real text so contrast and screen readers are unaffected.
 */
export function PaymentBadges({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Accepted payment methods">
      {PAYMENT_METHODS.map((m) => (
        <li
          key={m.id}
          className={cn("inline-flex items-center gap-2 rounded-[10px] border border-line bg-white font-semibold text-ink", compact ? "h-8 px-2.5 text-[14px]" : "h-10 px-3 text-[14px]")}
        >
          <span aria-hidden className="inline-block size-2.5 rounded-full ring-1 ring-black/5" style={{ backgroundColor: m.tone }} />
          {m.id === "visa" || m.id === "mastercard" ? <CreditCard aria-hidden className="size-4 text-muted" /> : <Smartphone aria-hidden className="size-4 text-muted" />}
          {m.label}
        </li>
      ))}
    </ul>
  );
}

export function SecurityBadges({ className, compact }: { className?: string; compact?: boolean }) {
  const items = [
    { icon: Lock, label: "Encrypted payments (TLS)" },
    { icon: ShieldCheck, label: "Act 843 data protection" },
    { icon: ShieldCheck, label: "NIC-licensed partners only" },
  ];
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Security and compliance">
      {items.map((it) => (
        <li key={it.label} className={cn("inline-flex items-center gap-2 rounded-[10px] bg-mist font-medium text-ink-2", compact ? "h-8 px-2.5 text-[14px]" : "h-10 px-3 text-[14px]")}>
          <it.icon aria-hidden className="size-4 text-brand" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
