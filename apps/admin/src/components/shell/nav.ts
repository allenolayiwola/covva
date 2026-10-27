import {
  Activity, BadgeCheck, Banknote, Bot, Building2, ChartNoAxesColumn, ClipboardList, FileCheck2, FileSignature, Flag, Gauge, Globe2, Handshake,
  HeartPulse, Inbox, Kanban, LayoutGrid, ListChecks, MessageCircle, MessageSquareWarning, Network, Package, Receipt, Scale, ScrollText, Settings, ShieldCheck,
  Tags, Users, Wallet, Wrench, type LucideIcon,
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
      { href: "/issuance", label: "Issuance", icon: FileCheck2, keywords: "delegated L2 jobs sla timers escalation retry nic" },
      { href: "/claims", label: "Claims", icon: HeartPulse, keywords: "insurer decisions" },
      { href: "/claims/fraud", label: "Claim fraud review", icon: ShieldCheck, keywords: "fraud flags duplicate identity late report review" },
      { href: "/service-partners", label: "Service partners", icon: Wrench, keywords: "garages towing hospitals clinics direct billing network" },
      { href: "/complaints", label: "Complaints", icon: MessageSquareWarning, keywords: "nic escalation sla" },
      { href: "/kyc", label: "KYC review", icon: BadgeCheck, keywords: "ghana card verify identity" },
      { href: "/inspections", label: "Inspections", icon: Building2, keywords: "property cover diaspora site inspection partner assign home being built" },
      { href: "/diaspora", label: "Diaspora", icon: Globe2, keywords: "sponsors beneficiaries consent gifts family abroad" },
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, keywords: "support inbox conversations bot handoff templates contacts opt-out" },
    ],
  },
  {
    label: "Network",
    items: [
      { href: "/organisations", label: "Organisations", icon: Building2, keywords: "brokers insurers licence nic" },
      { href: "/users", label: "Users", icon: Users, keywords: "profiles members invite" },
      { href: "/routing", label: "Routing", icon: Network, keywords: "broker rules simulate" },
      { href: "/routing/integrations", label: "Integrations & offers", icon: Network, keywords: "insurer line level direct sales nominated brokers order routing offers" },
      { href: "/appointments", label: "Appointments", icon: Handshake, keywords: "insurer broker matrix" },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { href: "/categories", label: "Categories", icon: LayoutGrid, keywords: "launch gate risk schema availability" },
      { href: "/products", label: "Products", icon: Package, keywords: "versions approval review" },
      { href: "/bundles", label: "Bundles", icon: Package, keywords: "diaspora parents care pack product bundle discount" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { href: "/plans", label: "Plans", icon: Tags, keywords: "pricing saas" },
      { href: "/subscriptions", label: "Subscriptions", icon: ClipboardList, keywords: "trial billing" },
      { href: "/subscriptions/sponsors", label: "Sponsor subscriptions", icon: Wallet, keywords: "diaspora recurring premium collections past due retry sponsor card" },
      { href: "/instalments", label: "Instalments", icon: Wallet, keywords: "instalment premiums monthly quarterly momo collections grace lapse reinstatement micro cover" },
      { href: "/fx", label: "FX rates", icon: Globe2, keywords: "diaspora exchange rate gbp usd eur cad manual override margin display currency" },
      { href: "/invoices", label: "Invoices", icon: Receipt, keywords: "billing generate" },
      { href: "/commercial", label: "Commercial terms", icon: Scale, keywords: "revenue share commission ledger settlement statements splits" },
      { href: "/usage", label: "Usage", icon: Activity, keywords: "metering events" },
      { href: "/leads", label: "Leads", icon: Banknote, keywords: "marketing inbox contact" },
    ],
  },
  {
    label: "Partnerships",
    items: [
      { href: "/partners/crm", label: "CRM", icon: Kanban, keywords: "pipeline accounts insurers brokers embedded partners groups stages" },
      { href: "/partners/crm/tasks", label: "Tasks", icon: ListChecks, keywords: "follow-ups reminders overdue my tasks" },
      { href: "/partners/crm/dashboard", label: "Dashboard", icon: ChartNoAxesColumn, keywords: "pipeline time to go-live partners live revenue by partner rep" },
      { href: "/partners/applications", label: "Applications", icon: FileSignature, keywords: "registration self-service insurer broker verify nic licence approve return reject agreement" },
      { href: "/partners/appointments", label: "Appointment requests", icon: Handshake, keywords: "appointment letter broker insurer not on covva admin review" },
      { href: "/partners/remittance", label: "Remittance partners", icon: Banknote, keywords: "diaspora bank remittance embedded partner api placeholder" },
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

