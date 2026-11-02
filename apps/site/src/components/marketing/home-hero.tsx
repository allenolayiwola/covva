import { getImageProps } from "next/image";
import { Banknote, ShieldCheck, Smartphone } from "lucide-react";
import { Container } from "@im/ui";
import { HOME_HERO_SLIDES } from "./home-hero-content";
import { HomeHeroSlideshow, type SlideMedia } from "./home-hero-slideshow";

/**
 * Home hero: a slideshow of illustrated scenes, one per cover type (home-hero-slideshow.tsx). This server part builds
 * the responsive image sources. Slide 1 loads eagerly at high priority (on desktop its scene is the LCP element); the
 * others load after the page. Quality 85 and sizes up to 3840w keep the illustrations sharp on retina screens.
 */
export function HomeHero() {
  const media: SlideMedia[] = HOME_HERO_SLIDES.map((s, i) => {
    const first = i === 0;
    const common = { alt: s.alt, quality: 85, sizes: "100vw", loading: "eager" as const, fetchPriority: first ? ("high" as const) : ("low" as const) };
    const { props: desktop } = getImageProps({ ...common, src: `/images/home-hero/${s.image}.webp`, width: 3840, height: 2160 });
    const { props: mobile } = getImageProps({ ...common, src: `/images/home-hero/${s.image}-mobile.webp`, width: 1200, height: 1364 });
    return { desktop, mobile: { srcSet: mobile.srcSet, sizes: mobile.sizes } };
  });
  return <HomeHeroSlideshow slides={HOME_HERO_SLIDES} media={media} />;
}

const TRUST_ITEMS = [
  { Icon: ShieldCheck, text: "Licensed insurers & brokers" },
  { Icon: Smartphone, text: "Pay with MoMo or card" },
  { Icon: Banknote, text: "Premiums paid to the insurer" },
];

/** The light strip directly under the hero: three promises with icons, separated by thin rules. */
export function HeroTrustStrip() {
  return (
    <section aria-label="Why you can trust Covva" className="border-b border-line bg-mist">
      <Container>
        <ul className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {TRUST_ITEMS.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-3 py-4 sm:justify-center sm:px-4 sm:py-6">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-mint text-brand-deep">
                <Icon className="size-5" />
              </span>
              <span className="text-[15px] font-medium text-ink">{text}</span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
