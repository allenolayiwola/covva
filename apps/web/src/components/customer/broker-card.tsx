import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Avatar, Card, Pill, buttonClass, cn } from "@im/ui";

export interface BrokerOrgLite {
  id: string;
  name: string;
  nic_licence_number?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  settings?: unknown;
}

/**
 * The person customers see for a broker. Adviser profiles are private (RLS), so we use the
 * broker's published primary contact from organisation settings, falling back to the firm.
 */
export function brokerContact(org: BrokerOrgLite | null | undefined) {
  if (!org) return null;
  const s = (org.settings ?? {}) as { primary_contact?: string; service_hours?: string; demo?: boolean };
  const person = s.primary_contact?.trim() || null;
  return {
    demo: s.demo === true,
    person,
    displayName: person ?? org.name,
    firstName: person ? person.split(/\s+/)[0]! : org.name,
    firm: org.name,
    hours: s.service_hours ?? null,
    licence: org.nic_licence_number ?? null,
    email: org.contact_email ?? null,
    phone: org.contact_phone ?? null,
  };
}

/** Inline broker row ("Kofi Owusu, your broker · Demo Broker · Replies within working hours"). */
export function BrokerRow({ broker, messageHref, className }: { broker: BrokerOrgLite; messageHref?: string; className?: string }) {
  const c = brokerContact(broker)!;
  return (
    <div className={cn("flex flex-wrap items-center gap-4", className)}>
      <Avatar name={c.displayName} size={44} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{c.person ? `${c.person}, your broker` : `${c.firm}, your broker`}</p>
        <p className="text-sm text-muted">
          {c.person ? `${c.firm} · ` : ""}Replies within working hours
        </p>
      </div>
      {messageHref && (
        <Link href={messageHref} className={buttonClass("secondary", "md")}>
          Message {c.firstName}
        </Link>
      )}
    </div>
  );
}

/** Card version used on the request tracker. */
export function BrokerCard({ broker, messageHref, quote, className }: { broker: BrokerOrgLite | null; messageHref?: string; quote?: string; className?: string }) {
  if (!broker) {
    return (
      <Card className={cn("p-5", className)}>
        <p className="text-sm text-muted">Your broker</p>
        <p className="mt-2 font-medium text-ink">We are assigning a licensed broker to your request.</p>
        <p className="mt-1 text-sm text-muted">You will see their name here before you apply for any cover.</p>
      </Card>
    );
  }
  const c = brokerContact(broker)!;
  return (
    <Card className={cn("p-5", className)}>
      <p className="text-sm text-muted">Your broker</p>
      <div className="mt-3 flex items-center gap-3">
        <Avatar name={c.displayName} size={48} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">{c.displayName}{c.demo && <Pill tone="wait">DEMO</Pill>}</p>
          <p className="text-sm text-muted">{c.person ? `${c.firm} · Service team` : "Broker of record"}</p>
        </div>
      </div>
      {quote && <p className="mt-4 text-sm leading-relaxed text-ink-2">“{quote}”</p>}
      <p className="mt-3 text-xs text-subtle">
        NIC licence {c.licence ?? "NIC/BR/0000"}
        {c.demo && <span className="ml-1 rounded-full bg-amber-bg px-1.5 py-0.5 font-medium text-amber">placeholder</span>}
        {c.hours ? ` · ${c.hours}` : ""}
      </p>
      {messageHref && (
        <Link href={messageHref} className={buttonClass("secondary", "md", "mt-4 w-full")}>
          <MessageSquare aria-hidden className="size-4" /> Message your broker
        </Link>
      )}
    </Card>
  );
}
