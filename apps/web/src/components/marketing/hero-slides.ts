import type { StaticImageData } from "next/image";
import familyWide from "@/assets/hero/family.jpg";
import familyTall from "@/assets/hero/family-portrait.jpg";
import motorWide from "@/assets/hero/motor.jpg";
import motorTall from "@/assets/hero/motor-portrait.jpg";
import homeWide from "@/assets/hero/home.jpg";
import homeTall from "@/assets/hero/home-portrait.jpg";
import phoneWide from "@/assets/hero/phone.jpg";
import phoneTall from "@/assets/hero/phone-portrait.jpg";
import type { HeroLine } from "./hero-categories";

/**
 * The home hero's rotating slides (home-hero.tsx + home-hero-carousel.tsx).
 *
 * Images: `wide` is 3840px (16:9-ish, subject on the right; next/image serves smaller widths), `tall` is a
 * full-height portrait crop (aspect 0.6) around the subject for phones. To replace a photo, drop the new
 * files into `src/assets/hero/` and change the two imports above — nothing else needs to change.
 * `focus` is the CSS object-position (and the Ken Burns origin) for each crop.
 *
 * Provenance: every image here is an AI-generated illustration, owned by Covva. No photographer credit is
 * shown on the page. Replace with commissioned photography of real customers when available.
 *
 * Copy rules: Covva compares and connects; licensed brokers arrange cover; licensed insurers issue it;
 * premiums go to the insurer. Never "download the app" (there is no store app yet).
 */
export interface HeroSlide {
  id: "family" | "motor" | "home" | "phone";
  /** One-word topic on the slide control (fits four across a phone screen). */
  topic: string;
  eyebrow: string;
  headline: string;
  /** Italic serif accent line under the headline. */
  accent: string;
  subline: string;
  /** Small italic caption, bottom right on desktop (decorative). */
  caption: string;
  /** Cover the picker preselects while this slide shows (until the visitor chooses). */
  category: HeroLine;
  image: {
    wide: StaticImageData;
    tall: StaticImageData;
    alt: string;
    /** object-position for the wide image (desktop/tablet) and the portrait crop (phones). */
    focus: { wide: string; tall: string };
    provenance: string;
  };
}

const AI_PROVENANCE = "AI-generated illustration, owned by Covva";

export const HERO_SLIDES: readonly HeroSlide[] = [
  {
    id: "family",
    topic: "Family",
    eyebrow: "At home. Or far from home.",
    headline: "Protect what matters.",
    accent: "Wherever you are.",
    subline: "Compare insurance quotes from licensed brokers in Ghana. Choose your cover. Pay with MoMo or card.",
    caption: "For the life you’re building.",
    category: "health",
    image: {
      wide: familyWide,
      tall: familyTall,
      alt: "A smiling mother hugs her laughing young daughter on the front steps of their home, among tropical plants in warm afternoon light.",
      focus: { wide: "70% 40%", tall: "50% 30%" },
      provenance: AI_PROVENANCE,
    },
  },
  {
    id: "motor",
    topic: "Motor",
    eyebrow: "Motor cover and claims",
    headline: "A bad day on the road.",
    accent: "Help that shows up.",
    subline: "Compare motor cover from licensed brokers, and have your broker beside you when you need to claim.",
    caption: "For the road ahead.",
    category: "motor",
    image: {
      wide: motorWide,
      tall: motorTall,
      alt: "A worried driver on his phone beside his dented silver car at the side of a palm-lined road in Accra.",
      focus: { wide: "72% 35%", tall: "50% 25%" },
      provenance: AI_PROVENANCE,
    },
  },
  {
    id: "home",
    topic: "Home",
    eyebrow: "Home insurance",
    headline: "The home you built.",
    accent: "The people inside it.",
    subline: "Cover your house and what’s in it against risks like fire, flood and theft, arranged by a licensed broker.",
    caption: "For the home you’ve made.",
    category: "home",
    image: {
      wide: homeWide,
      tall: homeTall,
      alt: "A smiling family of four, two parents and two young children, standing in front of their two-storey home at sunset.",
      focus: { wide: "68% 50%", tall: "50% 35%" },
      provenance: AI_PROVENANCE,
    },
  },
  {
    id: "phone",
    topic: "Phone",
    eyebrow: "Covva on your phone",
    headline: "Your cover.",
    accent: "In your pocket.",
    subline: "Get quotes, pay with MoMo and keep your policy documents in one place, right from your phone.",
    caption: "For life on the move.",
    category: "life-funeral",
    image: {
      wide: phoneWide,
      tall: phoneTall,
      alt: "A smiling young woman with curly hair holds up her phone, showing an insurance screen, at an outdoor café.",
      focus: { wide: "70% 35%", tall: "50% 30%" },
      provenance: AI_PROVENANCE,
    },
  },
];
