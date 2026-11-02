/** Approved home hero copy shared by every slide. */
export const HOME_HERO = {
  badge: "Made for everyday life in Ghana",
  formTitle: "What would you like to cover?",
  note: ["About 3 minutes.", "No payment needed."],
};

/** The hero's cover chips, in display order, with the word that finishes "Start my … quote". */
export const HOME_HERO_CHIPS = [
  { line: "motor", label: "Motor", cta: "motor" },
  { line: "travel", label: "Travel", cta: "travel" },
  { line: "health", label: "Health", cta: "health" },
  { line: "home", label: "Home", cta: "home" },
  { line: "business", label: "Business", cta: "business" },
  { line: "life-funeral", label: "Life", cta: "life" },
] as const;

/** A cover line the hero can preselect; /quote maps it to a catalogue category. */
export type HeroLine = (typeof HOME_HERO_CHIPS)[number]["line"];

export interface HomeHeroSlide {
  id: string;
  /** Short name on the slide control. */
  topic: string;
  headline: string;
  lede: string;
  /** Cover the picker preselects while this slide shows (until the visitor picks one). */
  line: HeroLine;
  /** `public/images/home-hero/{image}.webp` (3840×2160, scene in the right half) and `{image}-mobile.webp` (1200×1364 crop around the scene). */
  image: string;
  alt: string;
}

/**
 * Rotating slides (home-hero.tsx). Slide 1 is the page's <h1> and loads first; the others load after the page.
 * Images are AI-generated illustrations (visible credit "Image: AI-generated"); see public/images/home-hero/README.md.
 * Copy rules: Covva compares and connects; licensed brokers arrange cover; licensed insurers issue it.
 */
export const HOME_HERO_SLIDES: readonly HomeHeroSlide[] = [
  {
    id: "welcome",
    topic: "Covva",
    headline: "Insurance\nyou actually\nunderstand.",
    lede: "Compare real cover side by side, see what you’re paying for, and keep a licensed broker on your side from first question to renewal.",
    line: "motor",
    image: "welcome",
    alt: "Illustration: a couple walking home with a suitcase past their car and house in Ghana.",
  },
  {
    id: "motor",
    topic: "Motor",
    headline: "Motor cover\nthat keeps\nyou moving.",
    lede: "Compare third-party and comprehensive cover from licensed insurers, pay by MoMo or card, and keep your policy on your phone.",
    line: "motor",
    image: "motor",
    alt: "Illustration: a woman with her car keys beside her teal car on a tree-lined street in Accra.",
  },
  {
    id: "home",
    topic: "Home",
    headline: "Protect the\nhome you’ve\nbuilt.",
    lede: "Cover the building and what’s inside it against fire, flood and theft, whether you live there or look after it from abroad.",
    line: "home",
    image: "home",
    alt: "Illustration: a family arriving at the front door of their home.",
  },
  {
    id: "health",
    topic: "Health",
    headline: "Health cover\nfor the people\nyou love.",
    lede: "Compare plans for yourself, your family or your parents back home, explained in plain language before you choose.",
    line: "health",
    image: "health",
    alt: "Illustration: a doctor talking with a mother, her son and his grandfather outside a clinic.",
  },
  {
    id: "travel",
    topic: "Travel",
    headline: "Cover that\ntravels\nwith you.",
    lede: "Travel insurance for visas, holidays and trips home, arranged in minutes with your documents ready to download.",
    line: "travel",
    image: "travel",
    alt: "Illustration: a couple with suitcases and passports walking through an airport terminal.",
  },
  {
    id: "business",
    topic: "Business",
    headline: "Cover that\nworks as hard\nas you do.",
    lede: "Protect your shop, stock and equipment, with a licensed broker to help you choose what your business needs.",
    line: "business",
    image: "business",
    alt: "Illustration: a shop owner at the front of her fabric shop with her assistant.",
  },
  {
    id: "life",
    topic: "Life",
    headline: "Peace of mind\nfor your\nfamily.",
    lede: "Life and funeral cover that gives the people you love support when they need it most.",
    line: "life-funeral",
    image: "life",
    alt: "Illustration: three generations of a family together under a mango tree.",
  },
];
