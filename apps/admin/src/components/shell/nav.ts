import {
  Activity, AppWindow, Award, BadgeCheck, Banknote, BarChart3, Bot, Briefcase, Building2, CalendarClock, ChartNoAxesColumn,
  ClipboardCheck, ClipboardList, CreditCard, FileCheck2, FileClock, FileSignature, FileText, Flag, FolderTree, Gauge, Gift, Globe2, Handshake,
  HeartPulse, Inbox, Kanban, Landmark, Languages, LayoutDashboard, ListChecks, LockKeyhole, MailOpen, MessageCircle, MessageSquareWarning,
  MessagesSquare, Network, Package, PackagePlus, PlugZap, Receipt, Repeat, Scale, ScrollText, Settings, ShieldAlert, ShieldCheck, Smartphone,
  Star, Store, Tags, Users, Wallet, Wrench, type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon; keywords?: string }
/** A sidebar section. `id` keys the remembered open/closed state; an empty label renders the items ungrouped. */
export interface NavGroup { id: string; label: string; items: NavItem[] }

/**
 * Admin navigation, grouped by job-to-be-done. Every admin route reachable from the sidebar is listed here once;
 * the command palette (Ctrl/Cmd+K) searches the same list by label and keywords.
 */
export const NAV: NavGroup[] = [
  { id: "top", label: "", items: [{ href: "/", label: "Overview", icon: LayoutDashboard, keywords: "dashboard kpi metrics home" }] },
  {
    id: "sales",
    label: "Sales & policies",
    items: [
      { href: "/requests", label: "Requests", icon: Inbox, keywords: "queue sla reassign quotes" },
      { href: "/policies", label: "Policies", icon: FileCheck2, keywords: "book issued" },
      { href: "/issuance", label: "Issuance", icon: FileClock, keywords: "delegated L2 jobs sla timers escalation retry nic" },
      { href: "/payments", label: "Payments", icon: CreditCard, keywords: "reconciliation exceptions paystack" },
      { href: "/instalments", label: "Instalments", icon: CalendarClock, keywords: "instalment premiums monthly quarterly momo collections grace lapse reinstatement micro cover" },
    ],
  },
  {
    id: "claims",
    label: "Claims",
    items: [
      { href: "/claims", label: "Claims", icon: HeartPulse, keywords: "insurer decisions" },
      { href: "/claims/fraud", label: "Fraud review", icon: ShieldAlert, keywords: "claim fraud flags duplicate identity late report review" },
      { href: "/inspections", label: "Inspections", icon: ClipboardCheck, keywords: "property cover diaspora site inspection partner assign home being built" },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    items: [
      { href: "/kyc", label: "KYC review", icon: BadgeCheck, keywords: "ghana card verify identity" },
      { href: "/complaints", label: "Complaints", icon: MessageSquareWarning, keywords: "nic escalation sla" },
      { href: "/privacy-requests", label: "Privacy requests", icon: LockKeyhole, keywords: "act 843 data protection subject access export correction deletion erasure anonymise objection marketing opt-out retention" },
      { href: "/diaspora", label: "Diaspora", icon: Globe2, keywords: "sponsors beneficiaries consent gifts family abroad" },
      { href: "/business", label: "Business accounts", icon: Briefcase, keywords: "sme group scheme employer fleet census members statements consolidated billing enterprise" },
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, keywords: "support inbox conversations bot handoff templates contacts opt-out" },
      { href: "/leads", label: "Leads", icon: MailOpen, keywords: "marketing inbox contact" },
    ],
  },
  {
    id: "service-network",
    label: "Service network",
    items: [
      { href: "/service-partners", label: "Service partners", icon: Wrench, keywords: "garages towing hospitals clinics pharmacies assessors direct billing network" },
      { href: "/service-partners/applications", label: "Applications", icon: FileSignature, keywords: "service partner applications self-onboarding garage towing hospital apply join network approve" },
      { href: "/service-partners/reviews", label: "Reviews", icon: MessagesSquare, keywords: "service partner reviews ratings stars moderation hide" },
    ],
  },
  {
    id: "brokers-insurers",
    label: "Brokers & insurers",
    items: [
      { href: "/organisations", label: "Organisations", icon: Building2, keywords: "brokers insurers licence nic" },
      { href: "/appointments", label: "Appointments", icon: Handshake, keywords: "insurer broker matrix" },
      { href: "/routing", label: "Routing", icon: Network, keywords: "broker rules simulate" },
      { href: "/routing/integrations", label: "Integrations & offers", icon: PlugZap, keywords: "insurer line level direct sales nominated brokers order routing offers" },
      { href: "/scorecards", label: "Broker scorecards", icon: Award, keywords: "scorecard score response fulfilment claims sla ratings routing weight" },
      { href: "/scorecards/reviews", label: "Broker reviews", icon: Star, keywords: "broker ratings stars moderation approve hide reviews customers scorecard" },
    ],
  },
  {
    id: "partnerships",
    label: "Partnerships",
    items: [
      { href: "/partners/crm", label: "CRM", icon: Kanban, keywords: "pipeline accounts insurers brokers embedded partners groups stages" },
      { href: "/partners/crm/tasks", label: "Tasks", icon: ListChecks, keywords: "follow-ups reminders overdue my tasks crm" },
      { href: "/partners/crm/dashboard", label: "Pipeline dashboard", icon: ChartNoAxesColumn, keywords: "crm pipeline time to go-live partners live revenue by partner rep dashboard" },
      { href: "/partners/applications", label: "Insurer & broker applications", icon: FileText, keywords: "partner applications registration self-service insurer broker verify nic licence approve return reject agreement" },
      { href: "/partners/appointments", label: "Appointment requests", icon: ClipboardList, keywords: "appointment letter broker insurer not on covva admin review" },
      { href: "/distribution", label: "Distribution partners", icon: Store, keywords: "embedded widget dealers banks landlords fleets travel agents revenue share api" },
      { href: "/partners/remittance", label: "Remittance partners", icon: Landmark, keywords: "diaspora bank remittance embedded partner api placeholder" },
      { href: "/referrals", label: "Referrals & rewards", icon: Gift, keywords: "referral attribution credits reward ledger rules loyalty nic approval" },
      { href: "/loyalty", label: "Loyalty & telematics", icon: Gauge, keywords: "loyalty rules engine no-claims bundle discount renewal perks safe driver telematics driving score platform fallback" },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue",
    items: [
      { href: "/categories", label: "Categories", icon: FolderTree, keywords: "launch gate risk schema availability" },
      { href: "/products", label: "Products", icon: Package, keywords: "versions approval review rate tables templates compliance" },
      { href: "/bundles", label: "Bundles", icon: PackagePlus, keywords: "diaspora parents care pack product bundle discount" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { href: "/commercial", label: "Commercial terms", icon: Scale, keywords: "revenue share commission ledger settlement statements splits" },
      { href: "/invoices", label: "Invoices", icon: Receipt, keywords: "billing generate" },
      { href: "/accounting", label: "Accounting", icon: Banknote, keywords: "exports vat nhil getfund levy tax rules xero quickbooks sage platform revenue insurer statement commission report" },
      { href: "/fx", label: "FX rates", icon: Repeat, keywords: "diaspora exchange rate gbp usd eur cad manual override margin display currency" },
      { href: "/plans", label: "Plans", icon: Tags, keywords: "pricing saas" },
      { href: "/subscriptions", label: "Subscriptions", icon: AppWindow, keywords: "trial billing" },
      { href: "/subscriptions/sponsors", label: "Sponsor subscriptions", icon: Wallet, keywords: "diaspora recurring premium collections past due retry sponsor card" },
      { href: "/usage", label: "Usage", icon: Activity, keywords: "metering events" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3, keywords: "warehouse facts funnel pricing renewals claims by category region partner rollup backfill insight" },
      { href: "/ai", label: "AI", icon: Bot, keywords: "usage cost models insights" },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [
      { href: "/users", label: "Users", icon: Users, keywords: "profiles members invite staff" },
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

function matches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The nav item for a path: the most specific (longest) matching href, so /claims/fraud highlights only
 * "Fraud review" and /service-partners/applications only "Applications", not their parents.
 */
export function activeItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (matches(pathname, item.href) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

/** The group holding the active item (used to auto-expand it and for the top-bar breadcrumb). */
export function activeGroup(pathname: string): NavGroup | undefined {
  const item = activeItem(pathname);
  return item ? NAV.find((g) => g.items.includes(item)) : undefined;
}

export function isActive(pathname: string, href: string): boolean {
  return activeItem(pathname)?.href === href;
}

