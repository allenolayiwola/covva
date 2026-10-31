/**
 * Product-line marketing content for `/insurance/[slug]` (Addendum 5 §2).
 * Plain data so it can feed static params, metadata, JSON-LD and client widgets.
 * Prices are INDICATIVE fallbacks; the page prefers real "from" prices read from approved product
 * versions via `getFromPrices()` when any exist for the mapped catalogue categories.
 */
export interface ProductLine {
  slug: string;
  name: string;
  short: string;
  /** Catalogue category slugs (product_categories.slug) this line maps to, first = primary. */
  categorySlugs: string[];
  icon: string;
  headline: string;
  lede: string;
  covers: string[];
  notCovered: string[];
  /** Fallback indicative monthly "from" price in GHS when no approved product data exists. */
  fromMonthlyGhs: number;
  instalments: string;
  claims: { steps: string[]; timeline: string; documents: string[] };
  faqs: { q: string; a: string }[];
  /** Optional comparison block (e.g. third party vs comprehensive). */
  compare?: { title: string; intro: string; options: { name: string; who: string; covers: string[]; price: string }[] };
  /** Optional callout (e.g. sticker + QR verification). */
  callout?: { title: string; body: string };
  /** Hero widget: which quick fields to show. */
  quickFields: "motor" | "value" | "people" | "trip" | "none";
}

export const PRODUCT_LINES: ProductLine[] = [
  {
    slug: "motor",
    name: "Motor insurance",
    short: "Motor",
    categorySlugs: ["motor"],
    icon: "car",
    headline: "Motor insurance that is on your phone, not in your glovebox.",
    lede: "Third party or comprehensive, for private cars, taxis, commercial vehicles and motorbikes. Compare participating insurers, pay with MoMo or card, and get your certificate instantly.",
    covers: [
      "Injury or damage you cause to other people and their property (third party — compulsory)",
      "Damage to your own vehicle from accidents, fire and theft (comprehensive)",
      "Towing and recovery after an accident, up to the policy limit",
      "Medical expenses for you and passengers, where included",
      "Windscreen and glass, often as an optional extra",
    ],
    notCovered: [
      "Driving without a valid licence, or under the influence of alcohol or drugs",
      "Wear and tear, mechanical or electrical breakdown",
      "Use of the vehicle for hire or reward unless declared",
      "Damage while the vehicle is unroadworthy",
      "The excess — the first part of any own-damage claim you pay yourself",
    ],
    fromMonthlyGhs: 45,
    instalments: "Comprehensive premiums can be split into monthly or quarterly MoMo payments where the insurer allows. Third-party cover is usually paid annually because the certificate is issued for the full period.",
    claims: {
      steps: ["Make sure everyone is safe and, for injuries or theft, report to the police.", "Open the app, tap the policy and report the claim with photos of the damage and the scene.", "Your broker checks the report and submits it to the insurer, usually the same day.", "The insurer assesses, may send an assessor to the garage, and decides.", "Repairs at an approved garage or a cash settlement, minus your excess."],
      timeline: "Acknowledged within 1 working day. Simple own-damage claims are typically decided within 5–10 working days of a complete file; third-party injury claims take longer.",
      documents: ["Driver's licence", "Police report (accidents with injury, theft)", "Photos of the damage", "Repair estimate from a garage"],
    },
    compare: {
      title: "Third party vs comprehensive, in plain words",
      intro: "Every vehicle on a public road in Ghana must have at least third-party cover. Comprehensive adds protection for your own car.",
      options: [
        { name: "Third party", who: "Older or lower-value vehicles; drivers who need the legal minimum.", covers: ["Injury to other people", "Damage to other people's property", "Legal costs for claims against you"], price: "Lowest price — set by the vehicle class" },
        { name: "Third party, fire & theft", who: "A middle option where the insurer offers it.", covers: ["Everything in third party", "Your vehicle if stolen", "Your vehicle if it catches fire"], price: "Moderate" },
        { name: "Comprehensive", who: "Newer or financed vehicles; anyone who could not afford to replace the car.", covers: ["Everything above", "Accident damage to your own car", "Towing, often medical and windscreen"], price: "Based on vehicle value — from about 4–6% a year" },
      ],
    },
    callout: {
      title: "Sticker and QR verification",
      body: "Your insurer issues the motor certificate and sticker. Every policy in your Covva wallet also carries a QR code: police, a buyer or a landlord scans it (or enters the policy number on the policy verification page) and sees only whether the policy is valid, with the insurer and cover dates. Nothing personal is shown.",
    },
    faqs: [
      { q: "Do I need the car registration to get a quote?", a: "No. The registration helps us pre-fill details, but you can start with the make, year and approximate value and add the registration before the policy is issued." },
      { q: "Can I buy today and drive today?", a: "For integrated motor products, yes: once payment is confirmed and the insurer issues the certificate — usually minutes — it appears in your wallet. Cover never starts on payment alone." },
      { q: "What is an excess?", a: "The first part of an own-damage claim that you pay. A higher excess usually means a lower premium. Every quote shows it clearly before you buy." },
      { q: "Is the price the same at every insurer?", a: "Third-party prices are broadly standard by vehicle class. Comprehensive prices vary, which is why comparing matters." },
    ],
    quickFields: "motor",
  },
  {
    slug: "home",
    name: "Home & contents insurance",
    short: "Home",
    categorySlugs: ["home"],
    icon: "home",
    headline: "Protect the home you built — and everything in it.",
    lede: "Buildings and contents cover against fire, flood, burglary and accidental damage, for homes you live in, rent out, or are still building.",
    covers: ["Fire, lightning and explosion", "Flooding, storm and burst pipes", "Burglary and theft with forced entry", "Accidental damage to the building, as an option", "Contents: furniture, electronics, appliances", "Alternative accommodation while repairs happen, where included"],
    notCovered: ["Gradual wear, damp and poor maintenance", "Unoccupied homes beyond the period in the policy (often 30–60 days)", "Theft without forced entry, unless specified", "Items above the single-item limit that were not declared", "Buildings without a permit or on disputed land"],
    fromMonthlyGhs: 35,
    instalments: "Most home policies are annual but can be paid monthly or quarterly by MoMo where the insurer offers instalments. Diaspora sponsors can pay in GBP, USD, EUR or CAD.",
    claims: {
      steps: ["Make the property safe and report burglary to the police.", "Report the claim in the app with photos and a list of what was lost or damaged.", "Your broker submits it; the insurer may send an assessor.", "The insurer decides and pays repair or replacement costs, less any excess."],
      timeline: "Acknowledged within 1 working day; most contents claims are decided within 10 working days of a complete file.",
      documents: ["Proof of ownership or tenancy", "Photos before and after, if you have them", "Police report for theft", "Receipts or valuations for high-value items"],
    },
    faqs: [
      { q: "Can I insure a house that is still being built?", a: "Yes, through contractors' all-risks or buildings-in-construction cover from participating insurers. Tell us the stage of construction and the value of work completed." },
      { q: "Does contents cover include my phone outside the home?", a: "Not usually. Items you carry outside need 'all-risks' or personal possessions cover, available as an extra on some products." },
      { q: "I rent. Do I need buildings cover?", a: "No, your landlord insures the building. Contents cover protects your own belongings." },
    ],
    quickFields: "value",
  },
  {
    slug: "health",
    name: "Private health insurance",
    short: "Health",
    categorySlugs: ["health"],
    icon: "heart",
    headline: "Private health cover that works alongside NHIS.",
    lede: "Outpatient, inpatient and maternity plans from participating insurers, with hospital networks across Ghana. Cover yourself, your family — or your parents back home.",
    covers: ["Outpatient consultations, tests and prescribed medicines", "Inpatient treatment, surgery and hospital stays", "Maternity, after the waiting period", "Chronic condition management on higher plans", "Emergency ambulance, where included"],
    notCovered: ["Pre-existing conditions during the waiting period, or excluded altogether on some plans", "Cosmetic treatment and elective procedures", "Treatment outside the hospital network without pre-approval", "Costs above the annual limit for each benefit"],
    fromMonthlyGhs: 120,
    instalments: "Health premiums are commonly paid monthly or quarterly. Diaspora sponsors can set up a recurring card payment in their own currency and add parents as beneficiaries.",
    claims: {
      steps: ["Show your digital membership card at a network hospital — most treatment is paid directly by the insurer.", "For out-of-network or reimbursement claims, upload receipts and the medical report in the app.", "Your broker checks the file and submits it.", "The insurer approves and pays, typically to your MoMo wallet."],
      timeline: "Network treatment is pre-approved at the hospital. Reimbursement claims are usually paid within 10–14 working days.",
      documents: ["Medical report or discharge summary", "Itemised hospital bill and receipts", "Prescription for medicines"],
    },
    faqs: [
      { q: "Does this replace NHIS?", a: "No. NHIS remains the national scheme. Private plans add faster access, wider networks and benefits NHIS does not cover. Many people keep both." },
      { q: "What is a waiting period?", a: "The time after your plan starts before some benefits can be claimed — commonly 30 days for general treatment and 9–12 months for maternity. Every quote shows the waiting periods." },
      { q: "Can my parents over 60 join?", a: "Several participating insurers accept members up to 70 or beyond, sometimes with a medical declaration. We show you which plans accept each age." },
    ],
    quickFields: "people",
  },
  {
    slug: "travel",
    name: "Travel insurance",
    short: "Travel",
    categorySlugs: ["travel"],
    icon: "plane",
    headline: "Travel cover in minutes, including Schengen-compliant plans.",
    lede: "Medical emergencies abroad, trip cancellation, lost baggage and delays — with the certificate embassies ask for, delivered to your wallet instantly.",
    covers: ["Emergency medical treatment and hospital costs abroad", "Medical evacuation and repatriation", "Trip cancellation or curtailment for covered reasons", "Lost, stolen or delayed baggage", "Personal liability while travelling", "Schengen visa requirements (minimum €30,000 medical) on labelled plans"],
    notCovered: ["Pre-existing conditions unless declared and accepted", "Travelling against medical advice", "Extreme sports unless added", "Losses already covered by the airline or another policy", "Trips already started before the policy was bought"],
    fromMonthlyGhs: 9,
    instalments: "Travel policies are single-trip and paid in full before departure — usually from GH₵ 9 a day. Annual multi-trip plans can be paid in instalments where offered.",
    claims: {
      steps: ["In an emergency, call the insurer's 24-hour assistance line shown on your certificate.", "Keep every receipt and report theft to local police within 24 hours.", "Report the claim in the app, even while abroad.", "The insurer assesses and pays once you provide the documents."],
      timeline: "Emergency assistance is immediate. Reimbursement claims are usually settled within 14 working days of a complete file.",
      documents: ["Passport and visa pages", "Flight tickets and boarding passes", "Medical reports and receipts", "Police or airline reports for theft or delay"],
    },
    faqs: [
      { q: "Will the embassy accept the certificate?", a: "Plans labelled 'Meets Schengen visa requirements' include the €30,000 medical minimum and the certificate wording embassies expect. Check the label on each quote." },
      { q: "How quickly do I get the certificate?", a: "Immediately after payment is confirmed and the insurer issues it — usually within minutes, in your wallet and by email." },
    ],
    quickFields: "trip",
  },
  {
    slug: "life-funeral",
    name: "Life & funeral insurance",
    short: "Life & funeral",
    categorySlugs: ["life-funeral", "personal-accident"],
    icon: "shield-plus",
    headline: "Dignity for the family. Certainty for you.",
    lede: "Term life and funeral plans for you, your spouse, children and parents — paid in cedis, or by a relative abroad in their own currency.",
    covers: ["A lump sum to your family if you die during the term", "Funeral benefit paid within days of a valid claim", "Cover for parents, spouse and children on family plans", "Accidental death and disability, as an extra or stand-alone", "Premium waiver on some plans if you cannot work"],
    notCovered: ["Death from a pre-existing condition during the waiting period (often 6–12 months, accidents excluded)", "Suicide within the first 12–24 months", "Misstated age or medical history", "Parents above the maximum entry age on the plan"],
    fromMonthlyGhs: 20,
    instalments: "Funeral and life plans are monthly by design. Sponsors abroad can pay monthly or annually by card in GBP, USD, EUR or CAD, with the policyholder in Ghana receiving every notification.",
    claims: {
      steps: ["Report the death in the app or by calling your broker — a family member can do this on your behalf.", "Upload the death certificate and the claimant's ID.", "Your broker submits it; the insurer verifies.", "The benefit is paid to the named beneficiary, usually by bank transfer or MoMo."],
      timeline: "Funeral benefits are typically paid within 48–72 hours of a complete claim. Life benefits take longer, often 2–4 weeks.",
      documents: ["Death certificate", "Beneficiary's ID (Ghana Card)", "Policy certificate", "Medical report where the cause of death is required"],
    },
    faqs: [
      { q: "Can my son in the UK pay for my plan?", a: "Yes. He becomes the payer and you stay the policyholder, with the beneficiary you choose. Both of you get reminders and documents." },
      { q: "What is a waiting period on a funeral plan?", a: "A period, usually 6–12 months, during which death from natural causes is not covered. Accidental death is normally covered from day one." },
    ],
    quickFields: "people",
  },
  {
    slug: "business",
    name: "Business insurance",
    short: "Business",
    categorySlugs: ["sme-property", "liability", "marine-cargo"],
    icon: "store",
    headline: "Cover for the shop, the stock, the staff and the fleet.",
    lede: "Property and stock, public and professional liability, goods in transit, staff group health and life, and fleet motor — reviewed by a business adviser before insurers are approached.",
    covers: ["Premises, stock and equipment against fire, flood and burglary", "Business interruption after an insured event", "Public liability for injury or damage to third parties", "Professional indemnity for advisers and consultants", "Goods in transit and marine cargo", "Staff group health, life and personal accident", "Fleet motor on one policy"],
    notCovered: ["Unregistered businesses or undeclared activities", "Stock kept outside the insured premises", "Fines, penalties and deliberate acts", "Cyber incidents unless a cyber policy is added", "Wear and tear and poor maintenance"],
    fromMonthlyGhs: 95,
    instalments: "Business policies can usually be paid quarterly. Larger programmes are invoiced to the business with a schedule agreed with the insurer.",
    claims: {
      steps: ["Report the incident in the business dashboard with photos and any police or fire report.", "Your business adviser reviews and submits to the insurer.", "The insurer appoints a loss adjuster for larger claims.", "Settlement to the business account, less any excess."],
      timeline: "Acknowledged within 1 working day. Small claims are decided within 10–15 working days; adjusted claims depend on the loss.",
      documents: ["Business registration", "Stock records or inventory", "Police or fire service report", "Invoices for damaged equipment"],
    },
    faqs: [
      { q: "Can I enrol all my staff at once?", a: "Yes. Upload a spreadsheet or add staff by link. Each employee sees their own membership and documents in the app." },
      { q: "Do I need an adviser?", a: "Business risks vary, so every business request is reviewed by a licensed business adviser before quotes are requested. There is no charge for this." },
    ],
    quickFields: "none",
  },
  {
    slug: "micro",
    name: "Micro-insurance",
    short: "Micro-insurance",
    categorySlugs: ["personal-accident"],
    icon: "shield-plus",
    headline: "Small premiums. Real protection. Paid with MoMo.",
    lede: "Hospital cash, personal accident and small funeral plans from a few cedis a week — designed for traders, drivers, artisans and gig workers.",
    covers: ["Daily cash while you are in hospital", "Lump sums for accidental injury or disability", "Small funeral benefit for you or a parent", "Weekly, monthly or seasonal payment by MoMo"],
    notCovered: ["Illness during the first weeks of cover (waiting period)", "Injuries from undeclared hazardous work", "Claims without a hospital record or police report"],
    fromMonthlyGhs: 8,
    instalments: "Micro plans are built around small, frequent MoMo payments — weekly or monthly — with cover that pauses rather than lapses if a payment is missed, where the insurer offers it.",
    claims: {
      steps: ["Report from the app or by USSD with the hospital name and dates.", "Upload or send a photo of the discharge note.", "Your broker checks it; the insurer pays to your MoMo wallet."],
      timeline: "Hospital cash claims are typically paid within 3–5 working days.",
      documents: ["Ghana Card", "Hospital admission and discharge note"],
    },
    faqs: [
      { q: "Is micro-insurance available now?", a: "Hospital cash and personal accident plans are available from participating insurers. More micro products are being added as insurers approve them." },
      { q: "What if I miss a payment?", a: "Many micro plans pause cover until the next payment instead of cancelling. Each quote explains exactly what happens." },
    ],
    quickFields: "none",
  },
];

export function findProductLine(slug: string): ProductLine | undefined {
  return PRODUCT_LINES.find((p) => p.slug === slug);
}

/** Map a catalogue category slug to the marketing product line that covers it. */
export function productLineForCategory(categorySlug: string): ProductLine | undefined {
  return PRODUCT_LINES.find((p) => p.categorySlugs.includes(categorySlug));
}
