import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Ban, Clock, FileText, Gauge, Hourglass, Info, PlusCircle, Receipt, ShieldCheck, TriangleAlert } from "lucide-react";
import { DemoBadge, Notice, buttonClass } from "@im/ui";
import { CATEGORY_AVAILABILITY, humanize } from "@im/core";
import { getCategories, getCategory, getFlags, getProductsForCategory, type Category, type PublicProduct } from "@/lib/catalog";
import { displayOrgName, getBrand, isDemoOrg } from "@/components/marketing/brand";
import { PageHero } from "@/components/marketing/page-hero";
import { CheckList, IconTile, Section, SectionHeading } from "@/components/marketing/section";
import { AvailabilityPill } from "@/components/marketing/category-card";
import { CategoryIcon, DOCUMENT_LABELS } from "@/components/marketing/category-icon";
import { FaqList } from "@/components/marketing/faq-list";
import { JsonLd, faqJsonLd } from "@/components/marketing/json-ld";
import { CtaBand } from "@/components/marketing/cta-band";
import { OrgTile } from "@/components/marketing/org-tile";

export async function generateStaticParams() {
  const categories = await getCategories();
  return categories.length ? categories.map((c) => ({ slug: c.slug })) : [{ slug: "motor" }];
}

export async function generateMetadata({ params }: PageProps<"/explore/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return { title: "Cover not found", robots: { index: false } };
  const title = `${category.name} insurance in Ghana`;
  const description =
    category.short_description ??
    `Compare ${category.name.toLowerCase()} cover from participating licensed insurers in Ghana, with a named broker by your side.`;
  return {
    title,
    description,
    alternates: { canonical: `/explore/${category.slug}` },
    openGraph: { title, description, url: `/explore/${category.slug}` },
  };
}

export default function CategoryPage({ params }: PageProps<"/explore/[slug]">) {
  return (
    <Suspense fallback={<CategorySkeleton />}>
      <CategoryContent params={params} />
    </Suspense>
  );
}

/* --------------------------------------------------------------------------- */

type JsonObj = Record<string, unknown>;
const isObj = (v: unknown): v is JsonObj => !!v && typeof v === "object" && !Array.isArray(v);

function deriveComparison(products: PublicProduct[]) {
  const versions = products.map((p) => p.version).filter((v): v is NonNullable<PublicProduct["version"]> => !!v);
  const n = versions.length;

  const coverage = new Map<string, number>();
  for (const v of versions) {
    if (!Array.isArray(v.coverage)) continue;
    for (const item of v.coverage) {
      if (!isObj(item) || typeof item.label !== "string") continue;
      coverage.set(item.label, (coverage.get(item.label) ?? 0) + (item.included === false ? 0 : 1));
    }
  }

  const exclusions = new Map<string, number>();
  for (const v of versions) for (const e of v.exclusions ?? []) exclusions.set(e, (exclusions.get(e) ?? 0) + 1);

  const keysOf = (pick: (v: (typeof versions)[number]) => unknown) => {
    const keys = new Set<string>();
    for (const v of versions) {
      const o = pick(v);
      if (isObj(o)) for (const k of Object.keys(o)) if (!["unit", "currency_note"].includes(k)) keys.add(k);
    }
    return [...keys].map(humanize);
  };

  const optional = new Set<string>();
  for (const v of versions) {
    if (!Array.isArray(v.optional_benefits)) continue;
    for (const b of v.optional_benefits) if (isObj(b) && typeof b.label === "string") optional.add(b.label);
  }

  const waits = versions.map((v) => v.waiting_period_days).filter((d) => d > 0);
  const insurers = new Map<string, NonNullable<PublicProduct["insurer"]>>();
  for (const p of products) if (p.insurer) insurers.set(p.insurer.id, p.insurer);

  return {
    productCount: n,
    insurers: [...insurers.values()],
    coverage: [...coverage.entries()].sort((a, b) => b[1] - a[1]),
    exclusions: [...exclusions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    limits: keysOf((v) => v.limits),
    excesses: keysOf((v) => v.excesses),
    optional: [...optional],
    waiting: waits.length ? { min: Math.min(...waits), max: Math.max(...waits) } : null,
  };
}

function buildFaq(category: Category, insurerCount: number, brandName: string) {
  const meta = CATEGORY_AVAILABILITY[category.availability];
  const name = category.name.toLowerCase();
  const items: { q: string; a: string }[] = [
    {
      q: `Can I get ${name} cover through ${brandName} today?`,
      a: `${meta.label}. ${meta.promise}`,
    },
    {
      q: "How many insurers will I compare?",
      a:
        insurerCount > 0
          ? `${insurerCount} participating insurer${insurerCount === 1 ? " currently offers" : "s currently offer"} approved ${name} products through the marketplace. This is not the whole market, and every comparison tells you exactly how many insurers and products were included.`
          : `We are still agreeing ${name} products with participating insurers. When quotes are available, every comparison tells you how many insurers and products were included.`,
    },
    {
      q: "When does my cover start?",
      a: "Only when the insurer confirms acceptance and issues your policy. Paying the premium alone does not start your cover — you will see the status change in your account and receive your documents.",
    },
    {
      q: "Who will help me?",
      a: "A named broker of record, licensed by the National Insurance Commission, is assigned to your request and shown to you before any advice or application. They prepare quotes, confirm the final terms and help with renewals and claims.",
    },
  ];
  if (category.slug === "motor") {
    items.splice(1, 0, {
      q: "Is motor insurance compulsory in Ghana?",
      a: "Yes. Third-party motor insurance is compulsory for any vehicle used on a public road in Ghana. Comprehensive cover is optional and also protects your own vehicle.",
    });
  }
  if (category.slug === "travel") {
    items.splice(1, 0, {
      q: "Does travel cover meet Schengen visa requirements?",
      a: "Many travel products do, but not all. Check the “Meets Schengen visa requirements” line in each quote and the medical limit before you apply. Your broker can confirm.",
    });
  }
  if (category.slug === "health") {
    items.splice(1, 0, {
      q: "Does private health insurance replace NHIS?",
      a: "No. Private plans can add faster access and services NHIS does not cover, but check waiting periods, hospital networks and exclusions carefully. Your broker can explain how a plan works alongside NHIS.",
    });
  }
  return items;
}

async function CategoryContent({ params }: Pick<PageProps<"/explore/[slug]">, "params">) {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) notFound();

  const [products, flags, brand] = await Promise.all([getProductsForCategory(category.id), getFlags(), getBrand()]);
  const demo = flags.demo_mode ?? true;
  const cmp = deriveComparison(products);
  const meta = CATEGORY_AVAILABILITY[category.availability];
  const planned = category.availability === "planned";
  const faq = buildFaq(category, cmp.insurers.length, brand.name);
  const docs = category.required_documents ?? [];
  const anyDemo = cmp.insurers.some((i) => isDemoOrg(i.settings));

  return (
    <>
      <JsonLd data={faqJsonLd(faq)} />
      <PageHero
        breadcrumb={[{ label: "Explore cover", href: "/explore" }, { label: category.name }]}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <CategoryIcon icon={category.icon} className="size-4" />
            {category.segment === "personal" ? "Personal cover" : category.segment === "business" ? "Business cover" : "Specialist cover"}
          </span>
        }
        title={`${category.name} insurance`}
        lede={category.description ?? category.short_description}
        actions={
          planned ? (
            <>
              <Link href={`/contact?topic=${category.slug}`} className={buttonClass("primary", "lg")}>Register interest</Link>
              <Link href="/get-started" className={buttonClass("secondary", "lg")}>Not sure? Help me choose</Link>
            </>
          ) : (
            <>
              <Link href={`/account/requests/new?category=${category.slug}`} className={buttonClass("primary", "lg")}>
                Get quotes <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link href="/get-started" className={buttonClass("secondary", "lg")}>Not sure? Help me choose</Link>
            </>
          )
        }
        aside={
          <div className="rounded-[24px] border border-line bg-white p-6 shadow-float sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-muted">Availability</span>
              <AvailabilityPill availability={category.availability} />
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{meta.promise}</p>
            <dl className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-mist p-4">
                <dt className="text-xs text-muted">Participating insurers</dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">{cmp.insurers.length}</dd>
              </div>
              <div className="rounded-xl bg-mist p-4">
                <dt className="text-xs text-muted">Approved products</dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">{cmp.productCount}</dd>
              </div>
            </dl>
            <p className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-muted">
              <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
              Broker response target: within {category.default_sla_hours} working hours of a complete request. Insurer timing varies.
            </p>
            <p className="mt-2 text-[12px] text-subtle">Participating insurers only — not the whole market.</p>
          </div>
        }
      />

      {/* What it covers */}
      {cmp.coverage.length > 0 && (
        <Section labelledBy="covers-title">
          <SectionHeading
            id="covers-title"
            eyebrow="What it covers"
            title={`What ${category.name.toLowerCase()} cover typically includes`}
            description={`Based on the ${cmp.productCount} approved product${cmp.productCount === 1 ? "" : "s"} from participating insurers. Your quote shows exactly what your policy includes.`}
          />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cmp.coverage.map(([label, count]) => (
              <li key={label} className="flex items-start gap-3 rounded-card border border-line bg-white p-5">
                <ShieldCheck aria-hidden className={count > 0 ? "mt-0.5 size-5 shrink-0 text-brand" : "mt-0.5 size-5 shrink-0 text-subtle"} />
                <div>
                  <p className="font-medium text-ink">{label}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {count === cmp.productCount ? "Included in every product" : count === 0 ? "Usually an optional extra" : `Included in ${count} of ${cmp.productCount} products`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* What to compare */}
      <Section tone="mist" labelledBy="compare-title">
        <SectionHeading
          id="compare-title"
          eyebrow="What to compare"
          title="The details that decide what you get"
          description="Premiums differ for a reason. Look at these side by side — every quote you receive lines them up for you."
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cmp.limits.length > 0 && (
            <CompareCard icon={<Gauge />} title="Limits to check">
              <TagList items={cmp.limits} />
            </CompareCard>
          )}
          {cmp.excesses.length > 0 && (
            <CompareCard icon={<Receipt />} title="Excesses">
              <p className="mb-3">The part of a claim you pay yourself. A lower premium often means a higher excess.</p>
              <TagList items={cmp.excesses} />
            </CompareCard>
          )}
          <CompareCard icon={<Hourglass />} title="Waiting periods">
            {cmp.waiting ? (
              <p>
                Some benefits only start after{" "}
                <strong className="text-ink">
                  {cmp.waiting.min === cmp.waiting.max ? `${cmp.waiting.min} days` : `${cmp.waiting.min}–${cmp.waiting.max} days`}
                </strong>
                , depending on the product. Check before you rely on the cover.
              </p>
            ) : (
              <p>Approved products in this category have no general waiting period. Specific conditions may still apply.</p>
            )}
          </CompareCard>
          {cmp.exclusions.length > 0 && (
            <CompareCard icon={<Ban />} title="Typical exclusions" className="md:col-span-2 lg:col-span-2">
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {cmp.exclusions.map(([e]) => (
                  <li key={e} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber" />
                    {e}
                  </li>
                ))}
              </ul>
            </CompareCard>
          )}
          {cmp.optional.length > 0 && (
            <CompareCard icon={<PlusCircle />} title="Optional extras">
              <TagList items={cmp.optional} />
            </CompareCard>
          )}
        </div>
        <p className="mt-6 text-[13px] text-muted">
          Summary drawn from approved product data. Fictional demo terms where shown. Full policy wording applies, and your broker confirms eligibility and the final quote.
        </p>
      </Section>

      {/* Participating insurers + documents */}
      <Section labelledBy="who-title">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 id="who-title" className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">Participating insurers</h2>
            <p className="mt-2 text-[15px] text-muted">
              {cmp.insurers.length > 0
                ? `${cmp.insurers.length} insurer${cmp.insurers.length === 1 ? "" : "s"} with approved ${category.name.toLowerCase()} products.`
                : "No participating insurer has an approved product in this category yet."}
            </p>
            {cmp.insurers.length > 0 && (
              <ul className="mt-6 divide-y divide-line rounded-card border border-line">
                {cmp.insurers.map((ins) => (
                  <li key={ins.id} className="flex items-center gap-3 p-4">
                    <OrgTile name={ins.name} color={ins.brand_color} size={36} />
                    <span className="font-medium text-ink">{displayOrgName(ins.name)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(demo || anyDemo) && cmp.insurers.length > 0 && <DemoBadge className="mt-3" />}
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">What you will need</h2>
            <p className="mt-2 text-[15px] text-muted">Have these ready to speed things up. You can upload them later from your phone.</p>
            <ul className="mt-6 space-y-3">
              {(docs.length ? docs : ["id_document"]).map((d) => (
                <li key={d} className="flex items-start gap-3 rounded-card border border-line bg-white p-4">
                  <IconTile size="sm"><FileText /></IconTile>
                  <span className="pt-1.5 text-[15px] text-ink-2">{DOCUMENT_LABELS[d] ?? humanize(d)}</span>
                </li>
              ))}
            </ul>
            <CheckList
              className="mt-6"
              items={[
                "Your broker may ask for more if an insurer needs it.",
                "Uploading a document is not the same as the insurer receiving it — we show when delivery is confirmed.",
              ]}
            />
          </div>
        </div>

        {category.regulatory_note && (
          <Notice tone="wait" icon={<TriangleAlert className="size-4" />} title="Regulatory note" className="mt-12">
            {category.regulatory_note}
          </Notice>
        )}
      </Section>

      {/* FAQ */}
      <Section tone="mist" labelledBy="cat-faq-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <h2 id="cat-faq-title" className="text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[36px]">
              {category.name}: common questions
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-muted">
              Something else? <Link href="/support" className="font-medium text-brand hover:underline">Visit the help centre</Link>.
            </p>
            <Notice tone="info" icon={<Info className="size-4" />} className="mt-6">
              General information, not advice. Your broker advises on your circumstances.
            </Notice>
          </div>
          <FaqList items={faq} />
        </div>
      </Section>

      <div className="pt-16 sm:pt-24">
        <CtaBand
          title={planned ? `${category.name} is coming.` : `Ready to compare ${category.name.toLowerCase()} cover?`}
          body={
            planned
              ? "Tell us you are interested and we will let you know when participating insurers and brokers can support it."
              : "Tell us about the risk once. Your named broker gets quotes from participating insurers and walks you through the differences."
          }
          primary={planned ? { label: "Register interest", href: `/contact?topic=${category.slug}` } : { label: "Get quotes", href: `/account/requests/new?category=${category.slug}` }}
          secondary={{ label: "Help me choose", href: "/get-started" }}
        />
      </div>
    </>
  );
}

function CompareCard({ icon, title, children, className }: { icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-line bg-white p-6 ${className ?? ""}`}>
      <div className="flex items-center gap-3">
        <IconTile size="sm">{icon}</IconTile>
        <h3 className="font-semibold text-ink">{title}</h3>
      </div>
      <div className="mt-4 text-[14.5px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((t) => (
        <li key={t} className="rounded-full bg-mist px-3 py-1 text-[13px] font-medium text-ink-2">{t}</li>
      ))}
    </ul>
  );
}

function CategorySkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="border-b border-line bg-gradient-to-b from-mist to-white">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 lg:px-8">
        <span className="sr-only">Loading cover details…</span>
        <div className="h-4 w-40 animate-pulse rounded bg-line motion-reduce:animate-none" />
        <div className="mt-6 h-12 w-2/3 max-w-xl animate-pulse rounded-lg bg-line motion-reduce:animate-none" />
        <div className="mt-5 h-5 w-full max-w-2xl animate-pulse rounded bg-line/70 motion-reduce:animate-none" />
        <div className="mt-2 h-5 w-4/5 max-w-xl animate-pulse rounded bg-line/70 motion-reduce:animate-none" />
        <div className="mt-8 flex gap-3">
          <div className="h-12 w-36 animate-pulse rounded-[10px] bg-mint motion-reduce:animate-none" />
          <div className="h-12 w-52 animate-pulse rounded-[10px] bg-mint-2 motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}
