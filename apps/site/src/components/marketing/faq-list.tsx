import { Plus } from "lucide-react";
import { cn } from "@im/ui";

/** Accessible accordion built on <details>/<summary>: works without JavaScript. */
export function FaqList({ items, className }: { items: { id?: string; q: string; a: string }[]; className?: string }) {
  return (
    <div className={cn("divide-y divide-line rounded-card border border-line bg-white", className)}>
      {items.map((it, i) => (
        <details key={it.id ?? i} id={it.id ? `faq-${it.id}` : undefined} className="group scroll-mt-24 px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 text-left text-[16px] font-semibold text-ink marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            <span>{it.q}</span>
            <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-mint text-brand-deep transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">
              <Plus className="size-3.5" strokeWidth={2.5} />
            </span>
          </summary>
          <p className="-mt-1 pb-5 pr-10 text-[15px] leading-relaxed text-muted">{it.a}</p>
        </details>
      ))}
    </div>
  );
}
