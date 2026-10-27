import {
  Languages, Smartphone,
  Activity, BadgeCheck, Banknote, Bot, Building2, ChartNoAxesColumn, ClipboardList, FileCheck2, FileSignature, Flag, Gauge, Globe2, Handshake,
  HeartPulse, Inbox, Kanban, LayoutGrid, ListChecks, LockKeyhole, MessageCircle, MessageSquareWarning, Network, Package, Receipt, Scale, ScrollText, Settings, ShieldCheck,
  Tags, Users, Wallet, Wrench, Gift, Star, Store, type LucideIcon,
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
      { href: "/service-partners/applications", label: "Partner applications", icon: FileSignature, keywords: "service partner self-onboarding garage towing hospital apply join network approve" },
      { href: "/service-partners/reviews", label: "Partner reviews", icon: Wrench, keywords: "ratings stars moderation hide reviews service partners" },
      { href: "/scorecards/reviews", label: "Broker reviews", icon: Star, keywords: "broker ratings stars moderation approve hide reviews customers scorecard" },
      { href: "/complaints", label: "Complaints", icon: MessageSquareWarning, keywords: "nic escalation sla" },
      { href: "/kyc", label: "KYC review", icon: BadgeCheck, keywords: "ghana card verify identity" },
      { href: "/privacy-requests", label: "Privacy requests", icon: LockKeyhole, keywords: "act 843 data protection subject access export correction deletion erasure anonymise objection marketing opt-out retention" },
      { href: "/inspections", label: "Inspections", icon: Building2, keywords: "property cover diaspora site inspection partner assign home being built" },
      { href: "/diaspora", label: "Diaspora", icon: Globe2, keywords: "sponsors beneficiaries consent gifts family abroad" },
      { href: "/business", label: "Business accounts", icon: Building2, keywords: "sme group scheme employer fleet census members statements consolidated billing enterprise" },
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
      { href: "/scorecards", label: "Broker scorecards", icon: Star, keywords: "scorecard score response fulfilment claims sla ratings routing weight" },
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
      { href: "/accounting", label: "Accounting", icon: Receipt, keywords: "exports vat nhil getfund levy tax rules xero quickbooks sage platform revenue insurer statement commission report" },
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
      { href: "/distribution", label: "Distribution partners", icon: Store, keywords: "embedded widget dealers banks landlords fleets travel agents revenue share api" },
      { href: "/referrals", label: "Referrals & rewards", icon: Gift, keywords: "referral attribution credits reward ledger rules loyalty nic approval" },
      { href: "/loyalty", label: "Loyalty & telematics", icon: Gauge, keywords: "loyalty rules engine no-claims bundle discount renewal perks safe driver telematics driving score platform fallback" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/analytics", label: "Analytics", icon: ChartNoAxesColumn, keywords: "warehouse facts funnel pricing renewals claims by category region partner rollup backfill insight" },
      { href: "/ai", label: "AI", icon: Bot, keywords: "usage cost models insights" },
      { href: "/translations", label: "Translations", icon: Languages, keywords: "i18n locale twi ga ewe translator review approve csv import coverage language" },
      { href: "/ussd", label: "USSD", icon: Smartphone, keywords: "short code simulator feature phone sessions aggregator africastalking hubtel arkesel" },
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

