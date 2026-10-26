import type { Metadata } from "next";
import Link from "next/link";
import { Download, Mail, Newspaper } from "lucide-react";
import { Logo, CanopyMark } from "@im/ui";
import { getBrand } from "@/components/marketing/brand";
import { PageHero } from "@/components/marketing/page-hero";
import { Section, SectionHeading } from "@/components/marketing/section";
import { LeadForm } from "@/components/marketing/lead-form";
import { PRESS_BOILERPLATE } from "@/components/marketing/content";

export const metadata: Metadata = {
  title: "Press & media kit",
  description: "Covva press kit: company boilerplate, logo files, brand colours and media contact.",
  alternates: { canonical: "/press" },
};

const LOGO_FILES = [
  { file: "horizontal.svg", label: "Primary lockup (SVG)", use: "Web, documents, light backgrounds" },
  { file: "horizontal-light.png", label: "Primary lockup (PNG)", use: "Light backgrounds" },
  { file: "horizontal-reverse.svg", label: "Reverse lockup (SVG)", use: "On Covva Teal or dark backgrounds" },
  { file: "horizontal-reverse-light.png", label: "Reverse lockup (PNG)", use: "On teal or dark backgrounds" },
  { file: "stacked.svg", label: "Stacked lockup (SVG)", use: "Square formats, splash screens" },
  { file: "mark.svg", label: "Canopy C mark (SVG)", use: "App icon, avatars, compact use (≥ 32px)" },
  { file: "mark-transparent.png", label: "Canopy C mark (PNG)", use: "Social avatars" },
  { file: "wordmark.svg", label: "Wordmark (SVG)", use: "Text-only contexts" },
];

const PALETTE = [
  { name: "Covva Teal", hex: "#00796E", use: "Primary — buttons, links" },
  { name: "Deep Ink", hex: "#15343E", use: "Headings, wordmark" },
  { name: "Forest", hex: "#0F514D", use: "Pressed / dark accents" },
  { name: "Harvest Gold", hex: "#D9B36A", use: "Highlights only — never text" },
  { name: "Slate", hex: "#486068", use: "Body text" },
  { name: "Mint", hex: "#DCEEE4", use: "Tints" },
  { name: "Mist", hex: "#F1F7F3", use: "Page backgrounds" },
  { name: "Cream", hex: "#FFF0D6", use: "Notices" },
];

export default async function PressPage() {
  const brand = await getBrand();
  return (
    <>
      <PageHero
        breadcrumb={[{ label: "Press" }]}
        eyebrow={<span className="inline-flex items-center gap-2"><Newspaper aria-hidden className="size-4" /> Press & media</span>}
        title={<>Media kit and <span className="text-brand">press contact.</span></>}
        lede="Everything you need to write about Covva: who we are, what we do, approved logo files and brand colours. For interviews and comment, use the form below."
      />

      <Section labelledBy="boiler-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <SectionHeading id="boiler-title" eyebrow="About Covva" title="Boilerplate" className="mb-6! sm:mb-6!" />
            <p className="rounded-card border border-line bg-white p-6 text-[16px] leading-relaxed text-ink-2">{PRESS_BOILERPLATE}</p>
            <dl className="mt-6 grid gap-3 text-[15px] sm:grid-cols-2">
              <div className="rounded-card border border-line bg-mist p-4"><dt className="text-xs uppercase tracking-wider text-muted">Tagline</dt><dd className="mt-1 font-medium text-ink">{brand.tagline}</dd></div>
              <div className="rounded-card border border-line bg-mist p-4"><dt className="text-xs uppercase tracking-wider text-muted">Headquarters</dt><dd className="mt-1 font-medium text-ink">Accra, Ghana</dd></div>
              <div className="rounded-card border border-line bg-mist p-4"><dt className="text-xs uppercase tracking-wider text-muted">Regulatory position</dt><dd className="mt-1 font-medium text-ink">Technology platform; not an insurer or broker. Partners licensed by the NIC.</dd></div>
              <div className="rounded-card border border-line bg-mist p-4"><dt className="text-xs uppercase tracking-wider text-muted">Press contact</dt><dd className="mt-1 font-medium text-ink"><a href={`mailto:${brand.supportEmail}`} className="text-brand hover:underline">{brand.supportEmail}</a></dd></div>
            </dl>
          </div>
          <div>
            <SectionHeading id="logo-title" eyebrow="Logo" title="Approved logo files" description="Use the files as supplied. Do not retype, redraw, recolour, stretch or add effects to the logo. Keep clear space of half the mark height on all sides; minimum width 96px for the lockup, 20px for the mark." className="mb-6! sm:mb-6!" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-center rounded-card border border-line bg-white p-8"><Logo height={44} label="Covva primary logo" /></div>
              <div className="flex items-center justify-center rounded-card bg-brand p-8"><Logo reverse height={44} label="Covva reverse logo" /></div>
              <div className="flex items-center justify-center rounded-card border border-line bg-white p-8"><Logo variant="stacked" height={96} label="Covva stacked logo" /></div>
              <div className="flex items-center justify-center rounded-card border border-line bg-mist p-8"><CanopyMark size={64} /></div>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="mist" labelledBy="files-title">
        <SectionHeading id="files-title" eyebrow="Downloads" title="Logo files" />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LOGO_FILES.map((f) => (
            <li key={f.file}>
              <a href={`/brand/${f.file}`} download className="flex h-full flex-col rounded-card border border-line bg-white p-5 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <span className="flex items-center justify-between font-semibold text-ink">{f.label} <Download aria-hidden className="size-4 text-brand" /></span>
                <span className="mt-1 text-[13px] text-muted">{f.use}</span>
                <span className="mt-3 font-mono text-[12px] text-subtle">/brand/{f.file}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] text-muted">Full guidelines: <code className="rounded bg-white px-1.5 py-0.5 text-[12px]">docs/design/brand/brand-guidelines.pdf</code> — available on request.</p>
      </Section>

      <Section labelledBy="palette-title">
        <SectionHeading id="palette-title" eyebrow="Colour" title="Brand palette" description="Covva Teal is the primary colour. Harvest Gold is a highlight only and is never used for text." />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PALETTE.map((c) => (
            <li key={c.hex} className="overflow-hidden rounded-card border border-line bg-white">
              <div aria-hidden className="h-16" style={{ backgroundColor: c.hex }} />
              <div className="p-4">
                <p className="font-semibold text-ink">{c.name}</p>
                <p className="font-mono text-[13px] text-ink-2">{c.hex}</p>
                <p className="mt-1 text-[12.5px] text-muted">{c.use}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] text-muted">Typefaces: Outfit (display and headings, 300–400) and Inter (body and UI, 300–500).</p>
      </Section>

      <Section tone="mist" labelledBy="press-form-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div>
            <SectionHeading id="press-form-title" eyebrow="Media enquiries" title="Talk to us" className="mb-6! sm:mb-6!" />
            <p className="text-[17px] leading-relaxed text-muted">Interviews, comment on insurance and fintech in Ghana, data requests and partnership announcements.</p>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Mail aria-hidden className="size-4 text-brand" /> Or email <a href={`mailto:${brand.supportEmail}`} className="font-medium text-brand hover:underline">{brand.supportEmail}</a>. See also <Link href="/about" className="font-medium text-brand hover:underline">About us</Link>.</p>
          </div>
          <LeadForm kind="press" organization="required" organizationLabel="Publication or outlet" messageLabel="Your enquiry" messagePlaceholder="Topic, deadline and the format you need (comment, interview, data)." submitLabel="Send media enquiry" successBody="Thank you. We respond to media enquiries within one working day." />
        </div>
      </Section>
    </>
  );
}
