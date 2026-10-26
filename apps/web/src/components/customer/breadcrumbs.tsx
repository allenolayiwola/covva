import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {it.href ? (
              <Link href={it.href} className="hover:text-brand">{it.label}</Link>
            ) : (
              <span aria-current="page" className="text-ink-2">{it.label}</span>
            )}
            {i < items.length - 1 && <ChevronRight aria-hidden className="size-3.5" />}
          </li>
        ))}
      </ol>
    </nav>
  );
}
