/**
 * "Help me choose" needs assessment (strategy doc Journey B).
 * Identifies suitable categories — not merely the cheapest product — and
 * explains why. Complex or high-risk cases are flagged for adviser review.
 */
export interface NeedsQuestion {
  key: string;
  question: string;
  help?: string;
  type: "single" | "multi" | "boolean";
  options?: { value: string; label: string }[];
}

export const NEEDS_QUESTIONS: NeedsQuestion[] = [
  { key: "who", question: "Who are you looking to protect?", type: "single", options: [
    { value: "me", label: "Just me" }, { value: "family", label: "Me and my family" }, { value: "business", label: "My business" } ] },
  { key: "work", question: "How do you earn a living?", type: "single", options: [
    { value: "employed", label: "Employed" }, { value: "self_employed", label: "Self-employed / trader" },
    { value: "informal", label: "Informal work (market, transport, artisan)" }, { value: "professional", label: "Professional (doctor, lawyer, consultant…)" },
    { value: "business_owner", label: "I run a business with staff" }, { value: "not_working", label: "Not currently working" } ] },
  { key: "assets", question: "What do you own or use that you'd struggle to replace?", type: "multi", options: [
    { value: "vehicle", label: "A car, taxi or motorbike" }, { value: "home_owned", label: "A home I own" }, { value: "home_rented", label: "Belongings in a rented home" },
    { value: "shop", label: "Shop, stock or equipment" }, { value: "goods_transit", label: "Goods I import, export or transport" }, { value: "none", label: "None of these" } ] },
  { key: "dependants", question: "Does anyone depend on your income?", type: "boolean" },
  { key: "travel", question: "Are you travelling outside Ghana in the next 6 months?", type: "boolean" },
  { key: "health_cover", question: "How are your medical costs covered today?", type: "single", options: [
    { value: "nhis_only", label: "NHIS only" }, { value: "employer", label: "Employer health plan" }, { value: "private", label: "Private health insurance" }, { value: "none", label: "Nothing" } ] },
  { key: "advice_on_claims", question: "Could a client or member of the public hold you responsible for a loss?", type: "boolean",
    help: "For example advice you give, or people visiting your premises." },
  { key: "budget", question: "Roughly how much could you put towards cover each month?", type: "single", options: [
    { value: "lt100", label: "Under GH₵ 100" }, { value: "100_500", label: "GH₵ 100 – 500" }, { value: "500_2000", label: "GH₵ 500 – 2,000" }, { value: "gt2000", label: "More than GH₵ 2,000" } ] },
];

export type NeedsAnswers = Partial<Record<string, string | string[] | boolean>>;

export interface CategorySuggestion { slug: string; priority: "essential" | "recommended" | "consider"; why: string }

export function assessNeeds(a: NeedsAnswers): { suggestions: CategorySuggestion[]; needsAdviser: boolean; adviserReason?: string } {
  const assets = new Set(Array.isArray(a.assets) ? a.assets : a.assets ? [String(a.assets)] : []);
  const out: CategorySuggestion[] = [];
  const add = (s: CategorySuggestion) => { if (!out.some((o) => o.slug === s.slug)) out.push(s); };

  if (assets.has("vehicle")) add({ slug: "motor", priority: "essential", why: "Third-party motor insurance is compulsory in Ghana for any vehicle on the road. Comprehensive cover also protects your own vehicle." });
  if (a.travel === true) add({ slug: "travel", priority: "essential", why: "Travel cover pays for emergency medical care abroad, which is often very expensive, and is required for Schengen visas." });
  if (a.dependants === true) add({ slug: "life-funeral", priority: "recommended", why: "Life or funeral cover gives your family a lump sum if something happens to you." });
  if (a.work === "informal" || a.work === "self_employed") add({ slug: "personal-accident", priority: "recommended", why: "If you can't work after an accident, there's no sick pay. Accident and hospital cash cover replaces some of that income." });
  if (assets.has("home_owned")) add({ slug: "home", priority: "recommended", why: "Buildings cover protects your home against fire, flood and storm damage." });
  if (assets.has("home_rented")) add({ slug: "home", priority: "consider", why: "Contents cover protects your belongings against burglary, fire and flood, even when you rent." });
  if (a.health_cover === "nhis_only" || a.health_cover === "none") add({ slug: "health", priority: "consider", why: "Private health cover can add faster access and services NHIS does not cover. Check waiting periods carefully." });
  if (assets.has("shop") || a.who === "business") add({ slug: "sme-property", priority: "recommended", why: "Fire and burglary cover protects your premises, stock and equipment." });
  if (a.advice_on_claims === true || a.work === "professional") add({ slug: "liability", priority: "recommended", why: "Liability cover pays legal costs and compensation if someone holds you responsible for a loss or injury." });
  if (assets.has("goods_transit")) add({ slug: "marine-cargo", priority: "recommended", why: "Cargo cover protects goods while they are shipped or transported." });
  if (!out.length) add({ slug: "personal-accident", priority: "consider", why: "A simple, low-cost starting point that pays out after accidental injury." });

  const order = { essential: 0, recommended: 1, consider: 2 } as const;
  out.sort((x, y) => order[x.priority] - order[y.priority]);

  const businessy = a.who === "business" || a.work === "business_owner" || assets.has("goods_transit");
  return {
    suggestions: out,
    needsAdviser: businessy || out.length >= 4,
    adviserReason: businessy ? "Business and specialist risks are reviewed by a business adviser before insurers are approached." :
      out.length >= 4 ? "You have several needs — an adviser can help you prioritise within your budget." : undefined,
  };
}
