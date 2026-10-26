/**
 * Consent-gated analytics for the marketing site (Addendum 5: GA4, Meta/TikTok pixels, Act 843 consent).
 *
 * Nothing non-essential loads until the visitor chooses in the consent banner. The choice is a first-party
 * cookie (`covva_consent`, 180 days) with one of three values:
 *   essential  — strictly necessary only (nothing loads)
 *   analytics  — GA4 only
 *   all        — GA4 plus the Meta and TikTok pixels (only when their ids are configured)
 *
 * Vendors are read from NEXT_PUBLIC_* env at build time; an unset id disables that vendor entirely, so a
 * deployment without pixel ids keeps the "no advertising pixels" promise in the cookie notice.
 *
 * `track()` is the single entry point for conversion events. It forwards to whichever vendors are loaded,
 * so calling it before consent is a safe no-op (events are not buffered: without consent, no tracking).
 */

export const CONSENT_COOKIE = "covva_consent";
export const CONSENT_EVENT = "covva:consent";
const CONSENT_MAX_AGE = 60 * 60 * 24 * 180;

export const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID || "";
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || "";
export const TIKTOK_PIXEL_ID = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID || "";
/** True when at least one advertising pixel is configured for this build. */
export const PIXELS_CONFIGURED = !!(META_PIXEL_ID || TIKTOK_PIXEL_ID);

export type ConsentChoice = "essential" | "analytics" | "all";
export interface Consent { analytics: boolean; marketing: boolean }

export function consentFromChoice(choice: ConsentChoice): Consent {
  return { analytics: choice !== "essential", marketing: choice === "all" };
}
export function choiceFromConsent(c: Consent): ConsentChoice {
  return c.marketing ? "all" : c.analytics ? "analytics" : "essential";
}

/** The stored choice, or "" when the visitor has not chosen yet. */
export function readConsent(): ConsentChoice | "" {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)covva_consent=(all|analytics|essential)(?:;|$)/);
  return (m?.[1] as ConsentChoice | undefined) ?? "";
}

export function writeConsent(choice: ConsentChoice) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

/** Forgets the stored choice so the banner is shown again (used by "Change your cookie choices"). */
export function clearConsent() {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

export function subscribeConsent(cb: () => void) {
  window.addEventListener(CONSENT_EVENT, cb);
  return () => window.removeEventListener(CONSENT_EVENT, cb);
}

/* ----------------------------------------------------------------------------
 * Vendor loaders
 * ------------------------------------------------------------------------- */
type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; callMethod?: unknown; loaded?: boolean; version?: string; push?: unknown };
type Ttq = { track: (name: string, params?: Record<string, unknown>) => void; page: () => void; load: (id: string) => void; _loaded?: boolean };
interface VendorWindow extends Window {
  dataLayer?: unknown[];
  gtag?: Gtag;
  fbq?: Fbq;
  _fbq?: Fbq;
  ttq?: Ttq & Record<string, unknown>;
}
const win = () => window as unknown as VendorWindow;

function addScript(id: string, src: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/**
 * GA4 with Consent Mode v2: defaults are "denied" and are updated to the visitor's choice before the
 * config call, so Google never receives ad-storage signals the visitor has not agreed to.
 */
function loadGa4(consent: Consent) {
  if (!GA4_ID) return;
  const w = win();
  w.dataLayer = w.dataLayer ?? [];
  if (!w.gtag) {
    w.gtag = function gtag(...args: unknown[]) {
      w.dataLayer!.push(args);
    };
    w.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied", wait_for_update: 500 });
  }
  w.gtag("consent", "update", {
    analytics_storage: consent.analytics ? "granted" : "denied",
    ad_storage: consent.marketing ? "granted" : "denied",
    ad_user_data: consent.marketing ? "granted" : "denied",
    ad_personalization: consent.marketing ? "granted" : "denied",
  });
  if (!document.getElementById("ga4-src")) {
    w.gtag("js", new Date());
    w.gtag("config", GA4_ID, { anonymize_ip: true });
    addScript("ga4-src", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`);
  }
}

/** Meta pixel bootstrap (the official snippet, written out so it can be reviewed). */
function loadMetaPixel() {
  if (!META_PIXEL_ID) return;
  const w = win();
  if (!w.fbq) {
    const fbq = function fbq(...args: unknown[]) {
      const self = fbq as Fbq;
      if (self.callMethod) (self.callMethod as (...a: unknown[]) => void).apply(self, args);
      else self.queue!.push(args);
    } as Fbq;
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.push = fbq;
    w.fbq = fbq;
    w._fbq = fbq;
    addScript("meta-pixel-src", "https://connect.facebook.net/en_US/fbevents.js");
  }
  w.fbq!("init", META_PIXEL_ID);
  w.fbq!("track", "PageView");
}

/** TikTok pixel bootstrap (the official snippet, written out so it can be reviewed). */
function loadTikTokPixel() {
  if (!TIKTOK_PIXEL_ID) return;
  const w = win();
  if (w.ttq?._loaded) return;
  const methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
  const ttq: Record<string, unknown> & { methods?: string[]; _i?: Record<string, unknown[]>; _t?: Record<string, number>; _o?: Record<string, unknown> } = (w.ttq as Record<string, unknown>) ?? [];
  ttq.methods = methods;
  const setAndDefer = (target: Record<string, unknown>, method: string) => {
    target[method] = (...args: unknown[]) => (target as unknown as unknown[]).push([method, ...args]);
  };
  for (const m of methods) setAndDefer(ttq, m);
  ttq.instance = (id: string) => {
    const inst = (ttq._i?.[id] as unknown as Record<string, unknown>) ?? [];
    for (const m of methods) setAndDefer(inst, m);
    return inst;
  };
  ttq.load = (id: string) => {
    ttq._i = ttq._i ?? {};
    ttq._i[id] = [];
    ttq._t = ttq._t ?? {};
    ttq._t[id] = Date.now();
    ttq._o = ttq._o ?? {};
    addScript("tiktok-pixel-src", `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`);
  };
  ttq._loaded = true;
  w.ttq = ttq as unknown as VendorWindow["ttq"];
  w.ttq!.load(TIKTOK_PIXEL_ID);
  w.ttq!.page();
}

let applied: ConsentChoice | "" = "";
/** Fired after `applyConsent()` has loaded the vendors, so listeners can send events that were waiting on consent. */
export const CONSENT_APPLIED_EVENT = "covva:consent-applied";
/** Loads (or updates) vendors to match the visitor's choice. Idempotent; call whenever the choice changes. */
export function applyConsent(choice: ConsentChoice) {
  if (typeof window === "undefined") return;
  const consent = consentFromChoice(choice);
  if (consent.analytics) loadGa4(consent);
  if (consent.marketing) {
    loadMetaPixel();
    loadTikTokPixel();
  }
  applied = choice;
  window.dispatchEvent(new Event(CONSENT_APPLIED_EVENT));
}
export function appliedConsent(): Consent | null {
  return applied ? consentFromChoice(applied) : null;
}

/* ----------------------------------------------------------------------------
 * Events
 * ------------------------------------------------------------------------- */
export type TrackEvent =
  | "quote_start" // instant-quote widget submitted (category, has_reg)
  | "generate_lead" // enquiry / partner / waitlist / renewal-reminder form succeeded (kind, tag)
  | "app_store_click" // App Store / Google Play badge
  | "whatsapp_click" // floating WhatsApp button
  | "experiment_exposure"; // A/B variant shown (experiment, variant)

/** Vendor-specific names for the standard events (Meta and TikTok use their own vocabularies). */
const META_EVENTS: Partial<Record<TrackEvent, string>> = { quote_start: "Search", generate_lead: "Lead" };
const TIKTOK_EVENTS: Partial<Record<TrackEvent, string>> = { quote_start: "Search", generate_lead: "SubmitForm" };

/**
 * Sends a conversion event to every vendor the visitor has consented to. Safe to call anywhere on the
 * client: with no consent (or no ids configured) it does nothing. Params must never contain personal data.
 * Returns true when analytics consent was in force (the event went to every configured analytics vendor).
 */
export function track(event: TrackEvent, params: Record<string, string | number | boolean | undefined> = {}): boolean {
  if (typeof window === "undefined") return false;
  const w = win();
  const consent = appliedConsent();
  if (!consent) return false;
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) clean[k] = v;
  if (consent.analytics && w.gtag) w.gtag("event", event, { ...clean, transport_type: "beacon" });
  if (consent.marketing && event !== "experiment_exposure") {
    const meta = META_EVENTS[event];
    if (w.fbq) w.fbq(meta ? "track" : "trackCustom", meta ?? event, clean);
    const tiktok = TIKTOK_EVENTS[event];
    if (w.ttq?.track) w.ttq.track(tiktok ?? event, clean);
  }
  return consent.analytics;
}
