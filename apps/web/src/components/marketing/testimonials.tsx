import { Quote } from "lucide-react";
import { Avatar, Pill } from "@im/ui";
import type { Testimonial } from "./content";

/**
 * Testimonials block. Until real, consented reviews exist every card is labelled "Illustrative"
 * and uses neutral placeholder attributions — never fake named reviews presented as real. A CMS
 * testimonial loses the label only when it is marked genuine with consent on file (docs/CMS.md).
 */
export function Testimonials({ items }: { items: Pick<Testimonial, "id" | "quote" | "name" | "context" | "illustrative">[] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {items.map((t) => (
        <li key={t.id} className="flex flex-col rounded-card border border-line bg-white p-6">
          <div className="flex items-center justify-between">
            <Quote aria-hidden className="size-5 text-gold" />
            {t.illustrative ? <Pill tone="wait">Illustrative</Pill> : <Pill tone="ok">Customer review</Pill>}
          </div>
          <blockquote className="mt-4 text-[16px] leading-relaxed text-ink-2">“{t.quote}”</blockquote>
          <footer className="mt-auto flex items-center gap-3 pt-6">
            <Avatar initials="—" size={36} />
            <div>
              <p className="text-sm font-semibold text-ink">{t.name}</p>
              <p className="text-[13px] text-muted">{t.context}</p>
            </div>
          </footer>
        </li>
      ))}
    </ul>
  );
}
