import { getImageProps } from "next/image";
import { preload } from "react-dom";
import { Banknote, ShieldCheck, Smartphone } from "lucide-react";
import { Container } from "@im/ui";
import { Experiment } from "./experiment";
import { HERO_SLIDES, type HeroSlide } from "./hero-slides";
import { HomeHeroCarousel, type HeroCarouselSlide } from "./home-hero-carousel";

/** Phones (tall portrait screens) get the portrait crop; tablets and up the 3840px landscape image. Keep in sync with globals.css. */
const PORTRAIT_MEDIA = "(max-aspect-ratio: 2/3)";
const QUALITY = 85;

/*
 * `sizes` is the width the photo is actually drawn at with object-fit: cover. The landscape file (~16:9) is
 * full-width on wide screens but overflows the sides on squarer ones (laptops at 16:10, tablets), where its
 * drawn width is 177vh; the portrait crop (0.6) is drawn 60vh wide on phones taller than 5:3. Plain "100vw" would
 * pick a file up to 2× too small there and the photo would look soft.
 */
const SIZES_WIDE = "(max-aspect-ratio: 16/9) 177vh, 100vw";
const SIZES_TALL = "(max-aspect-ratio: 3/5) 60vh, 100vw";

function HeroPicture({ slide, first }: { slide: HeroSlide; first: boolean }) {
  // Slide 1 is the LCP image: eager + high priority, plus a media-scoped <link rel="preload"> per art-directed file
  // (next/image's `preload` prop would fetch both), so its request starts from <head> alongside CSS and fonts.
  // No blur placeholder: the section's neutral dark background shows until the photo arrives.
  const loading = first ? ({ loading: "eager", fetchPriority: "high" } as const) : ({ loading: "lazy", fetchPriority: "low" } as const);
  const common = { alt: slide.image.alt, fill: true, quality: QUALITY, ...loading };
  const {
    props: { srcSet: tallSrcSet, src: tallSrc },
  } = getImageProps({ ...common, sizes: SIZES_TALL, src: slide.image.tall });
  const { props: wide } = getImageProps({ ...common, sizes: SIZES_WIDE, src: slide.image.wide });
  if (first) {
    preload(tallSrc, { as: "image", imageSrcSet: tallSrcSet, imageSizes: SIZES_TALL, fetchPriority: "high", media: PORTRAIT_MEDIA });
    preload(wide.src, { as: "image", imageSrcSet: wide.srcSet, imageSizes: SIZES_WIDE, fetchPriority: "high", media: `not all and ${PORTRAIT_MEDIA}` });
  }
  return (
    <picture>
      <source media={PORTRAIT_MEDIA} srcSet={tallSrcSet} sizes={SIZES_TALL} />
      {/* Art-directed <picture> built with getImageProps, as in the next/image docs. */}
      <img {...wide} alt={slide.image.alt} className="object-cover" />
    </picture>
  );
}

/**
 * Home hero (owner brief, October 2026): a full-viewport photographic hero that rotates between four slides —
 * family, motor claims, home and "on your phone" — each with its own copy and suggested cover, behind a
 * transparent header. The <h1> (slide 1) and slide 1's image are server-rendered; the carousel behaviour is in
 * home-hero-carousel.tsx and the slide data in hero-slides.ts.
 */
export function HomeHero() {
  const slides: HeroCarouselSlide[] = HERO_SLIDES.map((s, i) => ({
    id: s.id,
    topic: s.topic,
    eyebrow: s.eyebrow,
    headline: s.headline,
    accent: s.accent,
    subline:
      i === 0 ? (
        <Experiment
          name="home_hero_headline"
          variants={{
            control: <>{s.subline}</>,
            instant: <>Compare quotes from licensed brokers in minutes. Choose your cover and pay with MoMo or card.</>,
          }}
        />
      ) : (
        s.subline
      ),
    caption: s.caption,
    category: s.category,
    focus: s.image.focus,
    media: <HeroPicture slide={s} first={i === 0} />,
  }));
  return <HomeHeroCarousel slides={slides} />;
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
