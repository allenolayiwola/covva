import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Pill, cn } from "@im/ui";
import { CATEGORY_AVAILABILITY } from "@im/core";
import type { Category } from "@/lib/catalog";
import { CategoryIcon } from "./category-icon";

export function AvailabilityPill({ availability, className }: { availability: Category["availability"]; className?: string }) {
  const meta = CATEGORY_AVAILABILITY[availability];
  return (
    <Pill tone={meta.tone} className={className}>
      {meta.label}
    </Pill>
  );
}

/** Compact category tile from the home mockup ("Cover for what matters to you"). */
export function CategoryTile({ category, className }: { category: Category; className?: string }) {
  return (
    <Link
      href={`/explore/${category.slug}`}
      className={cn(
        "group relative flex min-h-[124px] flex-col justify-between rounded-card border border-line bg-white p-5 transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-float motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <CategoryIcon icon={category.icon} className="size-6 text-brand" />
        <AvailabilityPill availability={category.availability} />
      </div>
      <div className="mt-6 flex items-end justify-between gap-2">
        <span className="text-[17px] font-semibold leading-snug tracking-tight text-ink">{category.name}</span>
        <ArrowUpRight aria-hidden className="size-4 shrink-0 text-subtle transition-colors group-hover:text-brand" />
      </div>
    </Link>
  );
}

/** Larger card used on /explore and /business: description + customer promise. */
export function CategoryCard({ category, className }: { category: Category; className?: string }) {
  const meta = CATEGORY_AVAILABILITY[category.availability];
  return (
    <Link
      href={`/explore/${category.slug}`}
      className={cn(
        "group flex h-full flex-col rounded-card border border-line bg-white p-6 transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-float motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden className="grid size-12 place-items-center rounded-xl bg-mint text-brand-deep">
          <CategoryIcon icon={category.icon} className="size-6" />
        </span>
        <AvailabilityPill availability={category.availability} />
      </div>
      <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">{category.name}</h3>
      {category.short_description && <p className="mt-2 text-[15px] leading-relaxed text-muted">{category.short_description}</p>}
      <p className="mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-subtle">{meta.promise}</p>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-brand">
        {category.availability === "planned" ? "Find out more" : "See what to compare"}
        <ArrowUpRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none" />
      </span>
    </Link>
  );
}
