import { Container } from "@im/ui";
import { HeroQuoteCard, type HeroExample } from "./hero-quote-card";
import { HeroPhone } from "./hero-phone";
import type { HeroInsurer } from "./hero-visual";
import { Experiment } from "./experiment";

/**
 * Home hero ("show the product"): a short headline, one-line lede and the category picker on the left; on desktop a
 * phone on the right shows three example quotes and the MoMo pay button, so the page shows the service instead of
 * describing it. On phones the illustration is not rendered and the picker lists the two example prices instead.
 */
export function HomeHero({ examples, insurers }: { examples: HeroExample[]; insurers: HeroInsurer[] }) {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip bg-gradient-to-br from-mint-2 via-white to-white">
      <Container className="grid items-center gap-12 pb-14 pt-8 lg:grid-cols-[1.1fr_0.9fr] lg:pb-16 lg:pt-14">
        <div>
          <h1 id="hero-title" className="text-[44px] leading-[1.02] tracking-[-0.035em] text-ink sm:text-[60px] lg:text-[72px]">
            Three quotes. <span className="text-brand">One tap to pay.</span>
          </h1>
          <p className="mt-5 text-[18px] text-muted lg:text-[20px]">
            <Experiment
              name="home_hero_headline"
              variants={{
                control: <>Licensed brokers compete for your cover. You pay by MoMo.</>,
                instant: <>Real quotes from licensed brokers in minutes, paid by MoMo or card.</>,
              }}
            />
          </p>
          <HeroQuoteCard examples={examples} className="mt-8" />
        </div>

        <div className="hidden lg:block">
          <HeroPhone insurers={insurers} motorMonthly={examples[0]?.monthly ?? 45} healthMonthly={examples[1]?.monthly ?? 180} />
        </div>
      </Container>
    </section>
  );
}
