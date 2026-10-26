import * as React from "react";
import Link from "next/link";
import { FileWarning } from "lucide-react";
import { Container, Notice, Pill } from "@im/ui";

export interface LegalSection { id: string; title: string; body: React.ReactNode }

const LEGAL_NAV = [
  { href: "/legal/terms", label: "Terms of use" },
  { href: "/legal/privacy", label: "Privacy notice" },
  { href: "/legal/complaints", label: "Complaints procedure" },
  { href: "/legal/disclosures", label: "Disclosures" },
  { href: "/legal/cookies", label: "Cookies" },
];

/** Shared layout for legal documents: draft banner, version, contents, readable prose. */
export function LegalPage({
  title,
  summary,
  version,
  current,
  sections,
}: {
  title: string;
  summary: React.ReactNode;
  version?: string | null;
  current: string;
  sections: LegalSection[];
}) {
  return (
    <div className="bg-white">
      <div className="border-b border-line bg-mist">
        <Container className="py-12 sm:py-16">
          <nav aria-label="Breadcrumb" className="mb-5 text-sm text-muted">
            <Link href="/" className="hover:text-brand">Home</Link>
            <span aria-hidden className="mx-2 text-subtle">/</span>
            <span>Legal</span>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="wait">Draft — subject to legal review</Pill>
            {version && <Pill>Version {version}</Pill>}
          </div>
          <h1 className="mt-4 text-[34px] font-bold leading-tight tracking-[-0.03em] text-ink sm:text-[46px]">{title}</h1>
          <div className="mt-4 max-w-3xl text-[17px] leading-relaxed text-muted">{summary}</div>
        </Container>
      </div>
      <Container className="py-12 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <nav aria-label="Legal documents">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Legal</p>
              <ul className="mt-3 space-y-1 text-sm">
                {LEGAL_NAV.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={l.href === current ? "page" : undefined}
                      className={l.href === current ? "block rounded-lg bg-mint px-3 py-2 font-semibold text-brand-deep" : "block rounded-lg px-3 py-2 text-muted hover:bg-mist hover:text-ink"}
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="On this page" className="mt-8 hidden lg:block">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">On this page</p>
              <ol className="mt-3 space-y-1.5 text-sm">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="text-muted hover:text-brand">{i + 1}. {s.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
          <article className="min-w-0 max-w-3xl">
            <Notice tone="wait" icon={<FileWarning className="size-4" />} title="Draft document" className="mb-10">
              This is a working draft prepared for a Ghanaian insurance technology platform ahead of launch. It is subject to legal and regulatory review and may change. Placeholders are shown in [square brackets].
            </Notice>
            <div className="space-y-12">
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-28">
                  <h2 id={`${s.id}-h`} className="text-[22px] font-bold tracking-tight text-ink">
                    <span className="mr-2 text-subtle tabular-nums">{i + 1}.</span>
                    {s.title}
                  </h2>
                  <div className="mt-4 space-y-4 text-[16px] leading-[1.7] text-ink-2 [&_a]:font-medium [&_a]:text-brand [&_a:hover]:underline [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-ink [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_li]:marker:text-subtle">
                    {s.body}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </Container>
    </div>
  );
}
