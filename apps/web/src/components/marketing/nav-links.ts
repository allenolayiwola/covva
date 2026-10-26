/** Navigation used by the header (desktop + mobile menu). Plain data: safe in client components. */
export interface NavLink { href: string; label: string; description?: string; /** Desktop header only: show from this breakpoint (always in the mobile menu). */ from?: "lg" | "xl" }
export interface NavGroup { label: string; items: NavLink[]; from?: "lg" | "xl" }
export type NavEntry = NavLink | NavGroup;

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

export const INSURANCE_NAV: NavLink[] = [
  { href: "/insurance/motor", label: "Motor", description: "Third party or comprehensive, instant certificate" },
  { href: "/insurance/home", label: "Home & contents", description: "Fire, flood, burglary — and homes being built" },
  { href: "/insurance/health", label: "Health", description: "Private plans that work alongside NHIS" },
  { href: "/insurance/travel", label: "Travel", description: "Schengen-compliant cover in minutes" },
  { href: "/insurance/life-funeral", label: "Life & funeral", description: "Dignity for the family, paid from anywhere" },
  { href: "/insurance/business", label: "Business", description: "Property, liability, staff and fleet" },
  { href: "/insurance/micro", label: "Micro-insurance", description: "Hospital cash and accident cover by MoMo" },
  { href: "/explore", label: "Explore all cover", description: "Every category and what to compare" },
];

export const PARTNERS_NAV: NavLink[] = [
  { href: "/insurers", label: "For insurers", description: "Digital distribution under your control" },
  { href: "/brokers", label: "For brokers", description: "Qualified leads, faster payment, a free digital office" },
  { href: "/partners/embedded", label: "Embedded partners", description: "Dealers, banks, landlords, fleets, travel agents" },
  { href: "/partners", label: "Partner directory", description: "Licensed insurers and brokers on Covva" },
];

export const PRIMARY_NAV: NavEntry[] = [
  { label: "Insurance", items: INSURANCE_NAV },
  { href: "/diaspora", label: "Diaspora" },
  { href: "/business", label: "Business" },
  { href: "/claims", label: "Claims", from: "lg" },
  { href: "/verify", label: "Verify", from: "xl" },
  { label: "Partners", items: PARTNERS_NAV },
  { href: "/learn", label: "Learn", from: "lg" },
  { href: "/about", label: "About", from: "xl" },
];

/** "More" links shown in the mobile menu and used by the footer. */
export const SECONDARY_NAV: NavLink[] = [
  { href: "/get-started", label: "Help me choose" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/support", label: "Help centre" },
  { href: "/trust", label: "Regulation & protection" },
  { href: "/referrals", label: "Refer a friend" },
  { href: "/waitlist", label: "Join the waitlist" },
  { href: "/press", label: "Press & media kit" },
  { href: "/contact", label: "Contact" },
];
