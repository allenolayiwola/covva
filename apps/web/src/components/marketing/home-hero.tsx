import Image from "next/image";
import { Banknote, ShieldCheck, UserRoundCheck } from "lucide-react";
import { Container, Eyebrow } from "@im/ui";
import heroPhoto from "@/assets/hero-accra.jpg";
import { HERO_PHOTO } from "./hero-photo";
import { HeroQuoteCard, type HeroExample } from "./hero-quote-card";
import { Experiment } from "./experiment";

const TICKS = [
  { Icon: ShieldCheck, text: "Licensed insurers and brokers only" },
  { Icon: Banknote, text: "Premiums go to the insurer, never to us" },
  { Icon: UserRoundCheck, text: "Cover starts only when the insurer accepts" },
];

/**
 * Home hero (mockup 01). Left: overline, headline, paragraph and three trust ticks. Right: a photo-led band
 * (Accra, credited, credit kept away from the people in the frame) with the framed quote card on top.
 * On phones the quote card sits directly under the headline, above the fold; the photo is not loaded there.
 */
export function HomeHero({ examples }: { examples: HeroExample[] }) {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip bg-gradient-to-b from-mist to-white">
      <Container className="grid gap-8 pb-16 pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:items-center lg:gap-16 lg:pb-24 lg:pt-16">
        {/* Copy. On phones the quote card is inserted between the headline and the paragraph (order utilities). */}
        <div className="contents lg:block">
          <div className="order-1">
            <Eyebrow>Insurance for Ghana and the diaspora</Eyebrow>
            <h1 id="hero-title" className="mt-5 text-h1 text-ink">
              <Experiment
                name="home_hero_headline"
                variants={{
                  control: <>Real quotes. Your broker. <span className="text-brand">Pay by MoMo.</span></>,
                  instant: <>Compare, buy and manage insurance <span className="text-brand">in minutes.</span></>,
                }}
              />
            </h1>
          </div>

          <div className="order-2 lg:hidden">
            <HeroQuoteCard examples={examples} slot="mobile" />
          </div>

          <div className="order-3">
            <p className="mt-6 max-w-[34rem] text-lead text-muted lg:mt-6">
              Tell us what you want to insure, choose up to three licensed brokers and compare their quotes side by side. Pay with MTN MoMo, Telecel Cash, AirtelTigo Money or card, and the insurer issues your policy to your wallet.
            </p>
            <ul className="mt-8 grid gap-3 text-[15px] text-ink-2 sm:grid-cols-3 lg:grid-cols-1">
              {TICKS.map(({ Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-mint text-brand-deep"><Icon className="size-3.5" /></span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Photo band with the framed quote card (desktop). */}
        <div className="relative hidden lg:block">
          <div className="relative min-h-[640px] overflow-hidden rounded-hero bg-mint">
            <Image
              src={heroPhoto}
              alt={HERO_PHOTO.alt}
              fill
              priority
              sizes="(min-width: 1024px) 560px, 0px"
              placeholder="blur"
              className="object-cover object-[50%_35%]"
            />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink/35 via-transparent to-transparent" />
            <a
              href={HERO_PHOTO.creditHref}
              target="_blank"
              rel="noreferrer"
              className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-[13px] font-medium text-ink-2 shadow-card backdrop-blur hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {HERO_PHOTO.credit}<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <div className="absolute inset-x-6 bottom-6">
              <HeroQuoteCard examples={examples} />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
