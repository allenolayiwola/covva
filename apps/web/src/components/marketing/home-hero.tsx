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
 * Home hero (redesign variation A, after monday.com and VEED on Mobbin): overline, headline and paragraph
 * centred, the six-category picker in one row with Get quotes under it, the trust ticks in a row, then the
 * Accra photo as a wide band (credited). On phones the picker sits directly under the headline, above the
 * paragraph (order utilities), and the photo is not loaded.
 */
export function HomeHero({ examples }: { examples: HeroExample[] }) {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip bg-gradient-to-b from-mist to-white">
      <Container className="flex flex-col items-center pb-16 pt-10 text-center lg:pb-20 lg:pt-16">
        <div className="order-1">
          <Eyebrow>Insurance for Ghana and the diaspora</Eyebrow>
          <h1 id="hero-title" className="mx-auto mt-5 max-w-[16ch] text-h1 text-ink">
            Real quotes. Your broker. <span className="text-brand">Pay by MoMo.</span>
          </h1>
        </div>

        <p className="order-3 mx-auto mt-6 max-w-[42rem] text-lead text-muted lg:order-2">
          <Experiment
            name="home_hero_headline"
            variants={{
              control: <>Tell us what you want to insure, choose up to three licensed brokers and compare their quotes side by side. Pay with MTN MoMo, Telecel Cash, AirtelTigo Money or card, and the insurer issues your policy to your wallet.</>,
              instant: <>Compare, buy and manage insurance in minutes: real quotes from licensed insurers through brokers you choose, paid by MoMo or card, with your policy issued by the insurer straight to your wallet.</>,
            }}
          />
        </p>

        <HeroQuoteCard examples={examples} className="order-2 mt-8 max-w-[1000px] lg:order-3 lg:mt-10" />

        <ul className="order-4 mt-8 grid gap-3 text-left text-[15px] text-ink-2 sm:grid-cols-3 sm:gap-8 lg:mt-10">
          {TICKS.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5">
              <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-mint text-brand-deep"><Icon className="size-3.5" /></span>
              {text}
            </li>
          ))}
        </ul>

        {/* Photo band (desktop). */}
        <div className="relative order-5 mt-12 hidden h-[400px] w-full overflow-hidden rounded-hero bg-mint lg:block">
          <Image
            src={heroPhoto}
            alt={HERO_PHOTO.alt}
            fill
            sizes="(min-width: 1024px) 1280px, 0px"
            placeholder="blur"
            className="object-cover object-[50%_14%]"
          />
          <a
            href={HERO_PHOTO.creditHref}
            target="_blank"
            rel="noreferrer"
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-[13px] font-medium text-ink-2 shadow-card backdrop-blur hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {HERO_PHOTO.credit}<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </Container>
    </section>
  );
}
