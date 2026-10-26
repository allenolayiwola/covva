/** Navigation used by the header (desktop + mobile menu) and footer. Plain data: safe in client components. */
export const PRIMARY_NAV = [
  { href: "/explore", label: "Explore cover" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/support", label: "Support" },
] as const;

export const SECONDARY_NAV = [
  { href: "/get-started", label: "Help me choose" },
  { href: "/business", label: "For business" },
  { href: "/brokers", label: "For brokers" },
  { href: "/insurers", label: "For insurers" },
  { href: "/trust", label: "Regulation & protection" },
] as const;
