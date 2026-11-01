import {
  Briefcase,
  Car,
  Heart,
  House,
  Plane,
  Scale,
  Ship,
  ShieldPlus,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  car: Car,
  motor: Car,
  plane: Plane,
  travel: Plane,
  "shield-plus": ShieldPlus,
  home: House,
  house: House,
  heart: Heart,
  health: Heart,
  users: Users,
  store: Store,
  scale: Scale,
  ship: Ship,
  briefcase: Briefcase,
};

export function CategoryIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const Icon = (icon && ICONS[icon]) || ShieldPlus;
  return <Icon aria-hidden className={className} strokeWidth={1.75} />;
}

/** Labels for `document_kind` values as a customer would recognise them. */
export const DOCUMENT_LABELS: Record<string, string> = {
  id_document: "Ghana Card or passport",
  vehicle_registration: "Vehicle registration document (DVLA)",
  drivers_licence: "Driver's licence",
  photo: "Recent photos of the property or item",
  proof_of_address: "Proof of address, such as a GhanaPost digital address or utility bill",
  medical: "Medical information requested by the insurer",
  policy_schedule: "Your current policy schedule",
  certificate: "Existing insurance certificate",
  policy_wording: "Existing policy wording",
  receipt: "Receipts or valuations",
  invoice: "Commercial invoice or bill of lading",
  police_report: "Police report, where relevant",
  other: "Supporting documents your adviser will confirm with you",
};

export const SEGMENT_LABELS: Record<string, { title: string; description: string }> = {
  personal: {
    title: "For you and your family",
    description: "Everyday cover for the things people in Ghana rely on most.",
  },
  business: {
    title: "For your business",
    description: "Adviser-assisted cover for traders, SMEs and professionals.",
  },
  specialist: {
    title: "Specialist cover",
    description: "Arranged by specialist brokers with the right market knowledge.",
  },
};
