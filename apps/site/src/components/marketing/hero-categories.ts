import { Briefcase, Car, HeartPulse, House, Plane, Umbrella } from "lucide-react";

/** The six hero categories. `line` is the marketing product line; /quote maps it to a catalogue category. */
export const HERO_CATEGORIES = [
  { line: "motor", label: "Motor", Icon: Car },
  { line: "home", label: "Home", Icon: House },
  { line: "health", label: "Health", Icon: HeartPulse },
  { line: "travel", label: "Travel", Icon: Plane },
  { line: "life-funeral", label: "Life & funeral", Icon: Umbrella },
  { line: "business", label: "Business", Icon: Briefcase },
] as const;

export type HeroLine = (typeof HERO_CATEGORIES)[number]["line"];

export const HERO_LINES: readonly HeroLine[] = HERO_CATEGORIES.map((c) => c.line);
