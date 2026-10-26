import {
  Activity, BadgeCheck, Banknote, Bot, Building2, ClipboardList, FileCheck2, Flag, Gauge, Handshake,
  HeartPulse, Inbox, LayoutGrid, MessageSquareWarning, Network, Package, Receipt, ScrollText, Settings, ShieldCheck,
  Tags, Users, Wallet, type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon; keywords?: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: "", items: [{ href: "/", label: "Overview", icon: Gauge, keywords: "dashboard kpi metrics home" }] },
  {
    label: "Operations",
    items: [
      { href: "/requests", label: "Requests", icon: Inbox, keywords: "queue sla reassign" },
      { href: "/payments", label: "Payments", icon: Wallet, keywords: "reconciliation exceptions paystack" },
      { href: "/policies", label: "Policies", icon: FileCheck2, keywords: "book issued" },
      { href: "/claims", label: "Claims", icon: HeartPulse, keywords: "insurer decisions" },
      { href: "/complaints", label: "Complaints", icon: MessageSquareWarning, keywords: "nic escalation sla" },
      { href: "/kyc", label: "KYC review", icon: BadgeCheck, keywords: "ghana card verify identity" },
    ],
  },
  {
    label: "Network",
    items: [
      { href: "/organisations", label: "Organisations", icon: Building2, keywords: "brokers insurers licence nic" },
      { href: "/users", label: "Users", icon: Users, keywords: "profiles members invite" },
      { href: "/routing", label: "Routing", icon: Network, keywords: "broker rules simulate" },
      { href: "/appointments", label: "Appointments", icon: Handshake, keywords: "insurer broker matrix" },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { href: "/categories", label: "Categories", icon: LayoutGrid, keywords: "launch gate risk schema availability" },
      { href: "/products", label: "Products", icon: Package, keywords: "versions approval review" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { href: "/plans", label: "Plans", icon: Tags, keywords: "pricing saas" },
      { href: "/subscriptions", label: "Subscriptions", icon: ClipboardList, keywords: "trial billing" },
      { href: "/invoices", label: "Invoices", icon: Receipt, keywords: "billing generate" },
      { href: "/usage", label: "Usage", icon: Activity, keywords: "metering events" },
      { href: "/leads", label: "Leads", icon: Banknote, keywords: "marketing inbox contact" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/ai", label: "AI", icon: Bot, keywords: "usage cost models insights" },
      { href: "/flags", label: "Feature flags", icon: Flag, keywords: "toggles" },
      { href: "/settings", label: "Settings", icon: Settings, keywords: "platform configuration" },
      { href: "/audit", label: "Audit log", icon: ScrollText, keywords: "events chain verify" },
      { href: "/health", label: "System health", icon: ShieldCheck, keywords: "status env cron webhooks" },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

