import { getImageProps } from "next/image";
import { ArrowRight, Banknote, ShieldCheck, Smartphone } from "lucide-react";
import { Container, buttonClass } from "@im/ui";
import { getPage } from "@/server/cms";
import { HOME_HERO } from "./home-hero-content";
import { HERO_CATEGORIES } from "./hero-categories";

/** Static Hero A. Native radios and a GET form remain usable without hydration. */
export async function HomeHero() {
  const page = await getPage("home-hero");
  const hero = page?.blocks.find((block) => block.type === "hero") ?? HOME_HERO;
  const common = { alt: "A family beside their car outside their home in Ghana. AI-generated placeholder.", width: 2400, height: 1200, sizes: "(max-width: 767px) calc(100vw - 40px), (max-width: 1439px) 45vw, 597px", loading: "eager" as const, fetchPriority: "high" as const };
  const { props: desktop } = getImageProps({ ...common, src: "/images/home-hero/desktop.webp" });
  const { props: mobile } = getImageProps({ ...common, src: "/images/home-hero/mobile.webp", width: 1080, height: 1350 });
  return (
    <section aria-labelledby="home-hero-title" className="bg-mist">
      <Container className="grid items-center gap-14 pb-6 pt-16 md:min-h-[640px] md:grid-cols-[1.05fr_1fr] md:py-16">
        <div className="min-w-0">
          <p className="inline-block border-b-[3px] border-[#D9B36A] pb-1.5 text-[13px] font-medium uppercase tracking-[.14em] text-brand">{hero.eyebrow}</p>
          <h1 id="home-hero-title" className="mb-[18px] mt-3.5 whitespace-pre-line font-display text-[38px] font-light leading-[1.06] tracking-[-.02em] text-ink md:text-[48px] wide:text-[60px]">{hero.title}</h1>
          <p className="max-w-[520px] text-base leading-[1.55] text-muted md:text-lg">{hero.lede}</p>
          <form action="/quote" method="get" aria-labelledby="hero-quote-title" className="mt-7 rounded-3xl border border-line bg-white p-[22px] shadow-float">
            <fieldset>
              <legend id="hero-quote-title" className="mb-3 text-base font-medium text-ink">What do you want to cover?</legend>
              <div className="flex flex-wrap gap-2.5">
                {HERO_CATEGORIES.map(({ line, label }) => (
                  <label key={line} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-3.5 text-sm font-medium text-ink has-[:checked]:border-brand has-[:checked]:bg-mint has-[:checked]:text-brand-deep has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand md:min-h-12 md:px-[18px] md:text-[15px]">
                    <input type="radio" name="type" value={line} defaultChecked={line === "motor"} className="sr-only" />
                    {/* Fixed-size local SVGs; no raster optimisation needed. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/images/category-icons/${line === "home" ? "home-contents" : line}.svg`} width={22} height={22} alt="" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
              <button type="submit" className={buttonClass("primary", "lg", "w-full rounded-full! md:w-auto")}>Continue <ArrowRight aria-hidden className="size-4" /></button>
              <span className="text-sm text-muted">Sign in with your phone to see quotes.</span>
            </div>
          </form>
          <p className="mt-3.5 text-[13px] leading-[1.55] text-muted">A quote request is not cover. You are covered only when an insurer accepts and issues your policy.</p>
        </div>
        <figure className="relative min-w-0">
          <picture>
            <source media="(max-width: 767px)" srcSet={mobile.srcSet} sizes={mobile.sizes} />
            <img {...desktop} alt={common.alt} className="h-[380px] w-full rounded-[28px] object-cover object-[50%_80%] md:h-[560px] md:object-[70%_center]" />
          </picture>
          <figcaption className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2.5 py-0.5 text-[13px] text-muted">Image: AI-generated</figcaption>
        </figure>
      </Container>
    </section>
  );
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
