/**
 * Learn hub articles (Addendum 5 §8). Plain-language, Ghana-specific, authored in English.
 * Twi, Ga and Ewe translations are not available yet: the language switcher stores the
 * preference and says so honestly. Never machine-translate these.
 */
export type ArticleBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "tip"; text: string };

export interface Article {
  slug: string;
  title: string;
  summary: string;
  topic: "Motor" | "Claims" | "Diaspora" | "Basics" | "Renewals";
  readMinutes: number;
  /** ISO date (YYYY-MM-DD). */
  published: string;
  updated?: string;
  related: { href: string; label: string }[];
  body: ArticleBlock[];
}

export const ARTICLES: Article[] = [
  {
    slug: "what-does-comprehensive-motor-cover",
    title: "What does comprehensive motor insurance cover?",
    summary: "The difference between the legal minimum and full cover for your own car, and what is still not included.",
    topic: "Motor",
    readMinutes: 4,
    published: "2026-10-01",
    related: [{ href: "/insurance/motor", label: "Motor insurance" }, { href: "/learn/third-party-vs-comprehensive", label: "Third party vs comprehensive" }],
    body: [
      { type: "p", text: "Comprehensive motor insurance pays for damage to your own vehicle as well as the damage you cause to other people. In Ghana only third-party cover is compulsory, so comprehensive is a choice — and for a car you could not easily replace, usually the right one." },
      { type: "h2", text: "What it includes" },
      { type: "ul", items: ["Accident damage to your car, whoever is at fault", "Theft of the car, and damage during attempted theft", "Fire and lightning", "Injury and property damage you cause to others (the third-party part)", "Often: towing, windscreen glass and medical expenses for passengers"] },
      { type: "h2", text: "What it still does not cover" },
      { type: "ul", items: ["Mechanical breakdown and wear and tear — insurance is for sudden events, not ageing parts", "Driving without a valid licence or under the influence", "Using a private car for hire (Uber, Bolt, taxi) without declaring it", "The excess: the first part of each own-damage claim, which you pay"] },
      { type: "h2", text: "How the price is worked out" },
      { type: "p", text: "Insurers rate comprehensive cover mainly on the value of the vehicle — typically 4–6% of its value a year — adjusted for the driver's age, where the car is kept, how it is used and claims history. Declaring the right value matters: too low and the insurer may reduce a payout; too high and you overpay." },
      { type: "tip", text: "When you compare, look past the premium at the excess, the sum insured and whether towing and windscreen are included. The cheapest quote with a high excess can cost more after one accident." },
    ],
  },
  {
    slug: "third-party-vs-comprehensive",
    title: "Third party vs comprehensive: which one do I need?",
    summary: "A simple way to decide, based on what you drive and what you could afford to lose.",
    topic: "Motor",
    readMinutes: 3,
    published: "2026-10-01",
    related: [{ href: "/insurance/motor", label: "Motor insurance" }, { href: "/learn/understanding-excess", label: "Understanding excess" }],
    body: [
      { type: "p", text: "Every vehicle on a public road in Ghana must carry at least third-party insurance. It protects other people from you. Comprehensive also protects your own car." },
      { type: "h2", text: "A quick rule of thumb" },
      { type: "ol", items: ["If your car is financed or less than about five years old, choose comprehensive — the lender usually requires it anyway.", "If the car is older and you could afford to repair or replace it yourself, third party may be enough.", "If you drive for work or carry passengers, tell the insurer; the use changes the price and the cover.", "If in doubt, ask your broker — the advice is free and they explain the trade-offs on your actual quotes."] },
      { type: "h2", text: "Third party, fire and theft" },
      { type: "p", text: "Some insurers offer a middle option: third-party cover plus your own car if it is stolen or burns. It costs less than comprehensive and suits cars parked in higher-risk areas." },
      { type: "tip", text: "Whichever you choose, keep the certificate in your Covva wallet. Police can verify it by scanning the QR code." },
    ],
  },
  {
    slug: "how-to-make-a-claim",
    title: "How to make an insurance claim in Ghana",
    summary: "Step by step: what to do first, what to send, who decides and how long it usually takes.",
    topic: "Claims",
    readMinutes: 5,
    published: "2026-10-01",
    related: [{ href: "/claims", label: "Claims" }, { href: "/support", label: "Help centre" }],
    body: [
      { type: "p", text: "A claim is a request to your insurer to pay for a loss the policy covers. Your broker helps you prepare and submit it; the insurer assesses and decides. Reporting a claim does not mean it is approved — but a complete, prompt report makes approval faster." },
      { type: "h2", text: "Step by step" },
      { type: "ol", items: ["Make people safe first. For accidents with injuries, theft or fire, report to the police or fire service and get a report number.", "Report the claim as soon as you can — most policies ask for notice within days. In the Covva app, open the policy and tap Report a claim.", "Add evidence: photos, the police report, receipts, the hospital discharge note. The app tells you what the insurer needs for your type of claim.", "Your broker checks the file for gaps and submits it to the insurer. You see when it is delivered.", "The insurer may call, send an assessor or ask for more documents. Respond quickly to keep things moving.", "The insurer decides: approve, approve in part or decline, with reasons. Payment goes to your MoMo wallet or bank, or to the garage or hospital."] },
      { type: "h2", text: "Typical timelines" },
      { type: "ul", items: ["Acknowledgement: within one working day", "Funeral benefits: 48–72 hours after a complete claim", "Motor own-damage: 5–10 working days after assessment", "Health reimbursements: 10–14 working days", "Larger property or business claims: depends on the loss adjuster"] },
      { type: "h2", text: "If the claim is declined" },
      { type: "p", text: "Ask for the reasons and the policy clause they rely on — your broker will explain it. If you still disagree, use the insurer's complaints process, then Covva's, and finally the National Insurance Commission's Complaints Bureau." },
    ],
  },
  {
    slug: "insurance-for-diaspora-families",
    title: "Insurance for diaspora families: paying from abroad for cover at home",
    summary: "How a relative in the UK, US, Europe or Canada can insure parents, a home or a car in Ghana — and stay in the loop.",
    topic: "Diaspora",
    readMinutes: 5,
    published: "2026-10-01",
    related: [{ href: "/diaspora", label: "Diaspora" }, { href: "/insurance/life-funeral", label: "Life & funeral" }],
    body: [
      { type: "p", text: "Many families in Ghana rely on a relative abroad for emergencies: a hospital bill, a funeral, a roof after a storm. Insurance turns those unpredictable calls into a small, predictable premium — and it can be paid from anywhere." },
      { type: "h2", text: "How it works on Covva" },
      { type: "ol", items: ["The relative in Ghana (or you, on their behalf) is the policyholder. You are the payer.", "You pay by card in GBP, USD, EUR or CAD; the insurer receives cedis. The price in your currency is shown before you confirm.", "Both of you get the certificate, renewal reminders and claim updates — dual notifications by SMS, WhatsApp or email.", "You see every policy you pay for in one family dashboard."] },
      { type: "h2", text: "Popular choices" },
      { type: "ul", items: ["Funeral plans for parents — small monthly premiums, benefits paid within days", "Private health for parents over 60, with a hospital network near them", "Buildings cover for a home being built or rented out", "Comprehensive motor for the family car", "Group plans for churches, hometown associations and alumni groups"] },
      { type: "h2", text: "Things to check" },
      { type: "ul", items: ["Entry age limits for parents on health and funeral plans", "Waiting periods before benefits start", "Whether the policyholder must be resident in Ghana (usually yes — that is why your relative holds the policy)", "That the beneficiary's details, including Ghana Card number, are correct"] },
      { type: "tip", text: "Gift a policy: you can buy and pay, then hand the policy to your relative with one tap. They complete their details and the insurer issues it." },
    ],
  },
  {
    slug: "how-renewals-work",
    title: "How insurance renewals work (and how not to lapse)",
    summary: "What happens when a policy ends, how reminders work, and why switching at renewal is easier than you think.",
    topic: "Renewals",
    readMinutes: 3,
    published: "2026-10-01",
    related: [{ href: "/#renewal-reminder", label: "Set a renewal reminder" }, { href: "/learn/understanding-excess", label: "Understanding excess" }],
    body: [
      { type: "p", text: "Most policies in Ghana run for 12 months. Cover does not continue automatically: if you do not renew, you are uninsured from the end date — and for motor, driving uninsured is an offence." },
      { type: "h2", text: "What Covva does" },
      { type: "ul", items: ["Reminds you 45, 30, 14, 7 and 1 day before cover ends", "Shows fresh quotes from participating insurers alongside your current insurer's renewal price", "Labels renewal prices as estimates until the insurer confirms", "Never cancels your existing cover until a replacement is accepted, dated and paid"] },
      { type: "h2", text: "Should I switch?" },
      { type: "p", text: "Not always. Loyalty discounts, no-claims bonuses and known claims service all count. But prices and products change every year, so a five-minute comparison is worth it. Your broker can explain what you would gain or give up." },
      { type: "tip", text: "Not a customer yet? Tell us when your current policy expires and we will remind you with better quotes before it ends." },
    ],
  },
  {
    slug: "understanding-excess",
    title: "Understanding excess: the part of a claim you pay",
    summary: "Why the excess exists, how it changes your premium, and how to choose one you can actually afford.",
    topic: "Basics",
    readMinutes: 3,
    published: "2026-10-01",
    related: [{ href: "/insurance/motor", label: "Motor insurance" }, { href: "/learn/what-does-comprehensive-motor-cover", label: "Comprehensive motor" }],
    body: [
      { type: "p", text: "The excess (sometimes 'deductible') is the first amount of any claim you pay yourself. If your motor excess is GH₵ 1,000 and repairs cost GH₵ 6,000, the insurer pays GH₵ 5,000." },
      { type: "h2", text: "Why it exists" },
      { type: "p", text: "It keeps very small claims out of the system and gives you a reason to take care. In return, the insurer charges less. A higher voluntary excess usually lowers your premium." },
      { type: "h2", text: "Choosing an excess" },
      { type: "ul", items: ["Pick an amount you could pay tomorrow without borrowing", "Check whether the excess is a fixed amount or a percentage of the claim", "Some policies add extra excess for young drivers or theft — read the quote", "Health plans use co-payments instead: a share of each bill"] },
      { type: "tip", text: "Every Covva quote lists the excess next to the premium so you compare both at once." },
    ],
  },
  {
    slug: "what-is-a-premium",
    title: "Premiums, sums insured and limits — the three numbers on every quote",
    summary: "Plain definitions of the numbers that decide what you pay and what you get back.",
    topic: "Basics",
    readMinutes: 3,
    published: "2026-10-01",
    related: [{ href: "/how-it-works", label: "How it works" }, { href: "/explore", label: "Explore cover" }],
    body: [
      { type: "p", text: "Three numbers appear on every insurance quote. Understanding them is most of what you need to compare fairly." },
      { type: "h2", text: "Premium" },
      { type: "p", text: "What you pay for the cover — a year, a quarter or a month. On Covva the premium goes through an authorised payment provider directly to the insurer; we never hold it." },
      { type: "h2", text: "Sum insured" },
      { type: "p", text: "The value you are insuring: the car, the building, the stock, or the benefit on a life or funeral plan. It is the most the insurer will pay in total. Declare it accurately." },
      { type: "h2", text: "Limits" },
      { type: "p", text: "Caps on particular parts of the cover — for example GH₵ 5,000 for a single item of contents, or a daily limit for hospital cash. Products with a lower premium often have lower limits; the comparison table shows them side by side." },
      { type: "tip", text: "A quote is only an offer when it says 'Ready to accept'. Estimates and quotes awaiting underwriting can still change." },
    ],
  },
];

export function findArticle(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

export const ARTICLE_LANGUAGES = [
  { code: "en", label: "English", native: "English", available: true },
  { code: "tw", label: "Twi", native: "Twi", available: false },
  { code: "ga", label: "Ga", native: "Gã", available: false },
  { code: "ee", label: "Ewe", native: "Eʋegbe", available: false },
] as const;
export type ArticleLanguage = (typeof ARTICLE_LANGUAGES)[number]["code"];
