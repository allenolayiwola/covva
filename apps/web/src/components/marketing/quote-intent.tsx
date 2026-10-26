import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import { buttonClass } from "@im/ui";
import { getCategory } from "@/lib/catalog";
import { CategoryIcon } from "./category-icon";
import { productLineForCategory } from "./products-content";

/**
 * Shown at the top of /get-started when the hero quote widget sends someone here with
 * `?category=…&reg=…` (plus value/people/days). Offers the direct route to quotes for that category
 * while the needs wizard stays available below. Reads searchParams, so render it inside <Suspense>.
 */
export async function QuoteIntent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const first = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.toString().trim().slice(0, 60) ?? "";
  };
  const slug = first("category");
  if (!slug) return null;
  const category = await getCategory(slug);
  if (!category) return null;

  const reg = first("reg").toUpperCase();
  const details = [
    reg ? `Registration ${reg}` : "",
    first("value") ? `Value GH₵ ${Number(first("value")).toLocaleString("en-GH")}` : "",
    first("people") ? `${first("people")} ${Number(first("people")) === 1 ? "person" : "people"}` : "",
    first("days") ? `${first("days")} days` : "",
  ].filter(Boolean);
  const line = productLineForCategory(category.slug);

  const params = new URLSearchParams({ category: category.slug });
  for (const k of ["reg", "value", "people", "days"]) if (first(k)) params.set(k, first(k));
  const planned = category.availability === "planned";
  const href = planned ? `/contact?topic=${category.slug}` : `/account/requests/new?${params.toString()}`;

  return (
    <section aria-labelledby="quote-intent-title" className="mx-auto mb-10 max-w-3xl rounded-[24px] border border-brand/40 bg-white p-5 shadow-float sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-mint text-brand-deep"><CategoryIcon icon={category.icon} className="size-6" /></span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">Your quote</p>
            <h2 id="quote-intent-title" className="mt-1 text-[22px] font-semibold tracking-tight text-ink">{category.name} quotes</h2>
            <p className="mt-1 text-[14.5px] text-muted">
              {details.length ? details.join(" · ") + ". " : ""}
              {planned ? "This category is not sold online yet — register your interest and we will tell you when it is." : "Sign in or create an account to get quotes from participating insurers; your details carry over."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Link href={href} className={buttonClass("primary", "lg")}>
            <Zap aria-hidden className="size-4" /> {planned ? "Register interest" : "Get quotes"} <ArrowRight aria-hidden className="size-4" />
          </Link>
          {line && <Link href={`/insurance/${line.slug}`} className="rounded text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">What {line.short.toLowerCase()} cover includes</Link>}
        </div>
      </div>
      <p className="mt-4 text-[13px] text-subtle">Not sure this is the right cover? Answer the questions below and we will suggest what is worth considering.</p>
    </section>
  );
}
