import type { UssdProvider, UssdReply } from "@im/core";

/** A provider-neutral USSD hop, produced by each adapter from the aggregator's request. */
export interface UssdRequest {
  provider: UssdProvider;
  sessionId: string;
  msisdn: string;
  serviceCode?: string | null;
  network?: string | null;
  /** Full `*`-joined input history (Africa's Talking, Arkesel, simulator). */
  text?: string | null;
  /** Only the latest input (Hubtel): the engine keeps the history in `ussd_sessions.state`. */
  input?: string | null;
  /** The aggregator says this is the first hop of the session. */
  isNew?: boolean;
  /** The aggregator reports the session ended (timeout / user cancelled): log only. */
  isRelease?: boolean;
}

export type { UssdReply };
