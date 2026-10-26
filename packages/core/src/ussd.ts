/**
 * USSD channel (Phase 3) — pure, provider-agnostic pieces shared by the web handler, the admin
 * simulator and the tests: MSISDN normalisation, the menu tree and navigation from the input
 * history, and screen builders that guarantee every screen fits 160 characters.
 *
 * Nothing here touches the network or the database. The engine (apps/web/src/server/ussd)
 * loads the customer context (policies, instalments), calls `routeUssd` with the history and
 * renders the node with `menuScreen` / `ussdCon` / `ussdEnd` and catalogue strings.
 *
 * Conventions: `0` = back, `00` = main menu. CON keeps the session open, END closes it.
 */
import { normaliseWaPhone } from "./whatsapp";
import { normaliseRegistration } from "./vehicle";
import type { MessageKey, MessageVars } from "./i18n/index";

export const USSD_MAX_CHARS = 160;
/** Most list screens show at most this many items (the rest are in the app). */
export const USSD_MAX_LIST = 4;
export const USSD_PROVIDERS = ["africastalking", "hubtel", "arkesel", "simulator"] as const;
export type UssdProvider = (typeof USSD_PROVIDERS)[number];

export function isUssdProvider(v: unknown): v is UssdProvider {
  return typeof v === "string" && (USSD_PROVIDERS as readonly string[]).includes(v);
}

export interface UssdReply {
  type: "CON" | "END";
  text: string;
}

// ---------------------------------------------------------------------------
// Phone numbers and networks
// ---------------------------------------------------------------------------
/** MSISDN → E.164 (`+233…`). Ghana is the default country. Null when not a phone number. */
export function normaliseMsisdn(input: string | null | undefined): string | null {
  return normaliseWaPhone(input, "233");
}

export type GhanaNetwork = "mtn" | "telecel" | "airteltigo" | "unknown";
const NETWORK_PREFIXES: Record<Exclude<GhanaNetwork, "unknown">, string[]> = {
  mtn: ["24", "25", "53", "54", "55", "59"],
  telecel: ["20", "50"],
  airteltigo: ["26", "27", "56", "57"],
};

/** Mobile network from a Ghana number (prefix based; ported numbers may differ — aggregators send the real one). */
export function ghanaNetwork(msisdn: string | null | undefined): GhanaNetwork {
  const e164 = normaliseMsisdn(msisdn);
  if (!e164 || !e164.startsWith("+233") || e164.length !== 13) return "unknown";
  const prefix = e164.slice(4, 6);
  for (const [net, list] of Object.entries(NETWORK_PREFIXES) as [Exclude<GhanaNetwork, "unknown">, string[]][]) {
    if (list.includes(prefix)) return net;
  }
  return "unknown";
}

/** Normalise an aggregator's network label (`MTN`, `Vodafone`, `AirtelTigo`, `tigo`…). */
export function normaliseNetwork(label: string | null | undefined, msisdn?: string | null): GhanaNetwork {
  const v = (label ?? "").toLowerCase();
  if (v.includes("mtn")) return "mtn";
  if (v.includes("voda") || v.includes("telecel")) return "telecel";
  if (v.includes("airtel") || v.includes("tigo") || v === "at") return "airteltigo";
  return ghanaNetwork(msisdn);
}

// ---------------------------------------------------------------------------
// Input history
// ---------------------------------------------------------------------------
/**
 * Africa's Talking (and our simulator) send the whole session's input as `text`, joined with `*`:
 * `""` on the first request, then `"1"`, `"1*2"`, `"1*2*GR 1234-24"`. Returns the inputs, trimmed.
 */
export function parseUssdHistory(text: string | null | undefined): string[] {
  if (!text) return [];
  return String(text)
    .split("*")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** The most recent input (what the customer just typed), or "" on the first screen. */
export function latestUssdInput(text: string | null | undefined): string {
  const h = parseUssdHistory(text);
  return h[h.length - 1] ?? "";
}

/**
 * Some aggregators prepend the dialled extension to the history: with base code `*920#`,
 * dialling `*920*44#` arrives as text "44". Pass the extension (`"44"`, `"*44#"` or `"44*2"`)
 * to strip it from the start of the history.
 */
export function stripDialExtension(history: string[], extension: string | null | undefined): string[] {
  if (!extension || !history.length) return history;
  const ext = extension.replace(/#/g, "").split("*").map((s) => s.trim()).filter(Boolean);
  if (!ext.length) return history;
  for (let i = 0; i < ext.length; i++) if (history[i] !== ext[i]) return history;
  return history.slice(ext.length);
}

// ---------------------------------------------------------------------------
// Menu tree
// ---------------------------------------------------------------------------
export type UssdNode =
  | "main"
  | "quote"
  | "quote.motor.reg"
  | "quote.motor.use"
  | "quote.motor.result"
  | "quote.micro.period"
  | "quote.micro.result"
  | "quote.funeral.people"
  | "quote.funeral.result"
  | "renew.list"
  | "renew.confirm"
  | "pay.list"
  | "pay.confirm"
  | "check.list"
  | "claim.list"
  | "claim.confirm"
  | "talk";

/** Terminal actions: the engine performs them and ENDs the session. */
export type UssdAction =
  | "quote.sms"
  | "quote.callback"
  | "micro.buy"
  | "renew.primary"
  | "renew.secondary"
  | "pay.momo"
  | "pay.link"
  | "check.detail"
  | "claim.callback"
  | "talk.callback"
  | "talk.sms"
  | "end.notFound"
  | "end.renew.none"
  | "end.pay.none"
  | "end.check.none";

export type VehicleUse = "private" | "commercial" | "motorbike";
export type MicroPeriod = "day" | "week" | "month";
export type QuoteProduct = "motor" | "micro" | "funeral";

export interface UssdParams {
  product?: QuoteProduct;
  registration?: string;
  vehicleUse?: VehicleUse;
  period?: MicroPeriod;
  people?: number;
  /** Zero-based index into the context's policy list (null = "not listed" on the claim menu). */
  policyIndex?: number | null;
  instalmentIndex?: number;
}

export interface UssdContext {
  /** A Covva profile matched the MSISDN. */
  known: boolean;
  /** Policies shown on lists (renew / check / claim), already ordered. */
  policies: number;
  /** Instalments due, already ordered. */
  instalments: number;
}

export interface UssdRoute {
  /** Screen to show (when `action` is null). */
  node: UssdNode;
  /** Terminal action, if the last input completed one. */
  action: UssdAction | null;
  params: UssdParams;
  /** The last input was not a valid choice at `node` (show `node` again with an error). */
  invalid: boolean;
  /** Which error to show for an invalid input. */
  error?: "option" | "registration" | "people";
  /** The effective path after back/home handling (for logs). */
  path: string[];
}

interface Frame {
  node: UssdNode;
  params: UssdParams;
  input?: string;
}

type Step = { node: UssdNode; params?: UssdParams } | { action: UssdAction; params?: UssdParams } | { error: NonNullable<UssdRoute["error"]> };

const listCount = (n: number) => Math.min(Math.max(0, n), USSD_MAX_LIST);

function choice(input: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(input)) return null;
  const n = Number(input);
  return n >= 1 && n <= max ? n : null;
}

/** Ghana plate check after normalisation (`GR 1234-24`). */
export function isUssdRegistration(input: string): boolean {
  return /^[A-Z]{1,3} \d{1,4}-\d{2}$/.test(normaliseRegistration(input));
}

function transition(frame: Frame, input: string, ctx: UssdContext): Step {
  const p = frame.params;
  switch (frame.node) {
    case "main":
      switch (input) {
        case "1":
          return { node: "quote" };
        case "2":
          if (!ctx.known) return { action: "end.notFound" };
          return ctx.policies > 0 ? { node: "renew.list" } : { action: "end.renew.none" };
        case "3":
          if (!ctx.known) return { action: "end.notFound" };
          return ctx.instalments > 0 ? { node: "pay.list" } : { action: "end.pay.none" };
        case "4":
          if (!ctx.known) return { action: "end.notFound" };
          return ctx.policies > 0 ? { node: "check.list" } : { action: "end.check.none" };
        case "5":
          return ctx.policies > 0 ? { node: "claim.list" } : { node: "claim.confirm", params: { policyIndex: null } };
        case "6":
          return { node: "talk" };
        default:
          return { error: "option" };
      }
    case "quote":
      if (input === "1") return { node: "quote.motor.reg", params: { product: "motor" } };
      if (input === "2") return { node: "quote.micro.period", params: { product: "micro" } };
      if (input === "3") return { node: "quote.funeral.people", params: { product: "funeral" } };
      return { error: "option" };
    case "quote.motor.reg":
      return isUssdRegistration(input) ? { node: "quote.motor.use", params: { registration: normaliseRegistration(input) } } : { error: "registration" };
    case "quote.motor.use": {
      const uses: VehicleUse[] = ["private", "commercial", "motorbike"];
      const n = choice(input, 3);
      return n ? { node: "quote.motor.result", params: { vehicleUse: uses[n - 1] } } : { error: "option" };
    }
    case "quote.motor.result":
    case "quote.funeral.result":
      if (input === "1") return { action: "quote.sms" };
      if (input === "2") return { action: "quote.callback" };
      return { error: "option" };
    case "quote.micro.period": {
      const periods: MicroPeriod[] = ["day", "week", "month"];
      const n = choice(input, 3);
      return n ? { node: "quote.micro.result", params: { period: periods[n - 1] } } : { error: "option" };
    }
    case "quote.micro.result":
      if (input === "1") return { action: "micro.buy" };
      if (input === "2") return { action: "quote.sms" };
      return { error: "option" };
    case "quote.funeral.people": {
      const n = /^\d{1,2}$/.test(input) ? Number(input) : NaN;
      return n >= 1 && n <= 10 ? { node: "quote.funeral.result", params: { people: n } } : { error: "people" };
    }
    case "renew.list": {
      const n = choice(input, listCount(ctx.policies));
      return n ? { node: "renew.confirm", params: { policyIndex: n - 1 } } : { error: "option" };
    }
    case "renew.confirm":
      if (input === "1") return { action: "renew.primary" };
      if (input === "2") return { action: "renew.secondary" };
      return { error: "option" };
    case "pay.list": {
      const n = choice(input, listCount(ctx.instalments));
      return n ? { node: "pay.confirm", params: { instalmentIndex: n - 1 } } : { error: "option" };
    }
    case "pay.confirm":
      if (input === "1") return { action: "pay.momo" };
      if (input === "2") return { action: "pay.link" };
      return { error: "option" };
    case "check.list": {
      const n = choice(input, listCount(ctx.policies));
      return n ? { action: "check.detail", params: { policyIndex: n - 1 } } : { error: "option" };
    }
    case "claim.list": {
      const shown = listCount(ctx.policies);
      const n = choice(input, shown + 1);
      if (!n) return { error: "option" };
      return { node: "claim.confirm", params: { policyIndex: n === shown + 1 ? null : n - 1 } };
    }
    case "claim.confirm":
      return input === "1" ? { action: "claim.callback" } : { error: "option" };
    case "talk":
      if (input === "1") return { action: "talk.callback" };
      if (input === "2") return { action: "talk.sms" };
      return { error: "option" };
  }
}

/**
 * Navigate the menu from the full input history. Pure and deterministic: the same history and
 * context always give the same screen, so providers that send the whole history (Africa's
 * Talking) and those that send one input at a time (Hubtel — the engine stores the history)
 * behave identically. `0` pops one screen, `00` returns to the main menu, invalid inputs are
 * ignored for navigation (flagged when they are the latest input).
 */
export function routeUssd(history: readonly string[], ctx: UssdContext): UssdRoute {
  const stack: Frame[] = [{ node: "main", params: {} }];
  let invalid = false;
  let error: UssdRoute["error"];
  for (let i = 0; i < history.length; i++) {
    const input = (history[i] ?? "").trim();
    const top = stack[stack.length - 1]!;
    invalid = false;
    error = undefined;
    if (input === "00") {
      stack.length = 1;
      continue;
    }
    if (input === "0" && top.node !== "main" && top.node !== "quote.funeral.people") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (input === "0" && top.node === "quote.funeral.people") {
      // "0 people" is not valid; treat 0 as back here too.
      stack.pop();
      continue;
    }
    const step = transition(top, input, ctx);
    if ("error" in step) {
      invalid = true;
      error = step.error;
      continue;
    }
    const params = { ...top.params, ...(step.params ?? {}) };
    if ("action" in step) {
      // A terminal action ends the session; any later input (it shouldn't arrive) is ignored.
      return { node: top.node, action: step.action, params, invalid: false, path: [...stack.slice(1).map((f) => f.input ?? ""), input] };
    }
    stack.push({ node: step.node, params, input });
  }
  const top = stack[stack.length - 1]!;
  return { node: top.node, action: null, params: top.params, invalid, error, path: stack.slice(1).map((f) => f.input ?? "") };
}

// ---------------------------------------------------------------------------
// Screen builders (≤ 160 characters, guaranteed)
// ---------------------------------------------------------------------------
/** Hard-fit `text` into `max` characters (ellipsis on the last line). */
export function fitUssd(text: string, max = USSD_MAX_CHARS): string {
  const clean = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function ussdCon(text: string): UssdReply {
  return { type: "CON", text: fitUssd(text) };
}

export function ussdEnd(text: string): UssdReply {
  return { type: "END", text: fitUssd(text) };
}

function shorten(s: string, n: number): string {
  const v = s.replace(/\s+/g, " ").trim();
  return v.length <= n ? v : `${v.slice(0, Math.max(1, n - 1)).trimEnd()}…`;
}

/**
 * A numbered menu: `title`, options `1 …`, `2 …`, then `footer` lines (e.g. "0 Back").
 * Option labels are shortened evenly until the whole screen fits; the title is shortened last.
 */
export function menuScreen(title: string, options: readonly string[], footer: readonly string[] = [], opts: { prefix?: string; startAt?: number } = {}): string {
  const start = opts.startAt ?? 1;
  const head = [opts.prefix, title].filter(Boolean).join(" ").trim();
  const build = (labelMax: number, titleMax: number) =>
    [shorten(head, titleMax), ...options.map((o, i) => `${start + i} ${shorten(o, labelMax)}`), ...footer].filter((l) => l !== "").join("\n");
  let labelMax = Math.max(...options.map((o) => o.length), 1);
  let titleMax = head.length || 1;
  let text = build(labelMax, titleMax);
  while (text.length > USSD_MAX_CHARS && labelMax > 8) {
    labelMax--;
    text = build(labelMax, titleMax);
  }
  while (text.length > USSD_MAX_CHARS && titleMax > 12) {
    titleMax--;
    text = build(labelMax, titleMax);
  }
  return fitUssd(text);
}

/** Append `footer` lines (e.g. "0 Back") to a catalogue screen, shortening the body if needed. */
export function withFooter(body: string, footer: readonly string[], prefix?: string): string {
  const tail = footer.filter(Boolean).join("\n");
  const head = [prefix, body].filter(Boolean).join(" ");
  const room = USSD_MAX_CHARS - (tail ? tail.length + 1 : 0);
  const fitted = head.length <= room ? head : `${head.slice(0, room - 1).trimEnd()}…`;
  return tail ? `${fitted}\n${tail}` : fitted;
}

/** Short label for a policy on a USSD list: "Motor GR 1234-24 to 12/11". */
export function ussdPolicyLabel(p: { title: string; coverEnd?: string | null }, max = 30): string {
  const end = p.coverEnd ? ` to ${p.coverEnd.slice(8, 10)}/${p.coverEnd.slice(5, 7)}` : "";
  return `${shorten(p.title, Math.max(8, max - end.length))}${end}`;
}

/** USSD-friendly money: "GHS 120" / "GHS 12.50" (the cedi sign doesn't render on many handsets). */
export function ussdMoney(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `GHS ${Number.isInteger(rounded) ? rounded.toLocaleString("en-GH") : rounded.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Short human reference for callbacks / claim callbacks: `CB-7K3Q9` (no 0/O/1/I). */
export function ussdReference(prefix: "CB" | "CL", random: () => number = Math.random): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return `${prefix}-${s}`;
}

// ---------------------------------------------------------------------------
// Rendering a route into a screen (catalogue strings; English today)
// ---------------------------------------------------------------------------
export interface UssdPolicyView {
  title: string;
  coverEnd?: string | null;
  /** Micro / on-demand policy: renew = pay the next period by MoMo. */
  micro?: boolean;
  renewPrice?: number | null;
}
export interface UssdInstalmentView {
  label: string;
  amount: number;
}
export interface UssdViewData {
  policies: readonly UssdPolicyView[];
  instalments: readonly UssdInstalmentView[];
  /** Indicative price for the quote result screens (annual for motor, per period for micro, monthly for funeral). */
  quotePrice?: number | null;
}

type Tr = (key: MessageKey, vars?: MessageVars) => string;

function listLines(items: readonly string[]): string[] {
  return items.slice(0, USSD_MAX_LIST);
}

/**
 * Render the screen for a (non-terminal) route. `invalid` routes get the error prefix.
 * Every result is ≤ 160 characters.
 */
export function renderUssdScreen(route: UssdRoute, data: UssdViewData, tr: Tr): UssdReply {
  const back = tr("ussd.back");
  // Input screens show their own validation message; menus get "Invalid choice." in front.
  const prefix = route.invalid && route.error === "option" ? tr("ussd.invalid") : undefined;
  const p = route.params;
  const policy = p.policyIndex != null ? data.policies[p.policyIndex] : undefined;
  switch (route.node) {
    case "main":
      return ussdCon(withFooter(tr("ussd.main"), [], prefix));
    case "quote":
      return ussdCon(withFooter(tr("ussd.quote.menu"), [back], prefix));
    case "quote.motor.reg":
      return ussdCon(withFooter(route.error === "registration" ? tr("ussd.quote.motor.regInvalid") : tr("ussd.quote.motor.reg"), [back]));
    case "quote.motor.use":
      return ussdCon(withFooter(tr("ussd.quote.motor.use"), [back], prefix));
    case "quote.motor.result":
      return ussdCon(
        withFooter(
          data.quotePrice != null && data.quotePrice > 0 ? tr("ussd.quote.motor.result", { reg: p.registration ?? "", price: ussdMoney(data.quotePrice) }) : tr("ussd.quote.unpriced"),
          [back],
          prefix,
        ),
      );
    case "quote.micro.period":
      return ussdCon(withFooter(tr("ussd.quote.micro.period"), [back], prefix));
    case "quote.micro.result":
      return ussdCon(
        withFooter(
          data.quotePrice != null && data.quotePrice > 0
            ? tr("ussd.quote.micro.result", { price: ussdMoney(data.quotePrice), period: tr(`ussd.period.${p.period ?? "day"}` as MessageKey) })
            : tr("ussd.quote.unpriced"),
          [back],
          prefix,
        ),
      );
    case "quote.funeral.people":
      return ussdCon(withFooter(route.error === "people" ? tr("ussd.quote.funeral.peopleInvalid") : tr("ussd.quote.funeral.people"), [back]));
    case "quote.funeral.result":
      return ussdCon(
        withFooter(
          data.quotePrice != null && data.quotePrice > 0 ? tr("ussd.quote.funeral.result", { people: p.people ?? 1, price: ussdMoney(data.quotePrice) }) : tr("ussd.quote.unpriced"),
          [back],
          prefix,
        ),
      );
    case "renew.list":
    case "check.list":
      return ussdCon(
        menuScreen(
          tr(route.node === "renew.list" ? "ussd.renew.list" : "ussd.check.list"),
          listLines(data.policies.map((x) => ussdPolicyLabel(x))),
          [back],
          { prefix },
        ),
      );
    case "claim.list": {
      const shown = listLines(data.policies.map((x) => ussdPolicyLabel(x)));
      return ussdCon(menuScreen(tr("ussd.claim.list"), [...shown, tr("ussd.claim.notListed")], [back], { prefix }));
    }
    case "renew.confirm": {
      const label = policy ? ussdPolicyLabel({ title: policy.title }, 40) : "";
      if (policy?.micro && policy.renewPrice) return ussdCon(withFooter(tr("ussd.renew.micro", { policy: label, price: ussdMoney(policy.renewPrice) }), [back], prefix));
      const ends = policy?.coverEnd ? `${policy.coverEnd.slice(8, 10)}/${policy.coverEnd.slice(5, 7)}/${policy.coverEnd.slice(0, 4)}` : "none";
      return ussdCon(withFooter(tr("ussd.renew.confirm", { policy: label, ends }), [back], prefix));
    }
    case "pay.list":
      return ussdCon(menuScreen(tr("ussd.pay.list"), listLines(data.instalments.map((i) => `${ussdMoney(i.amount)} ${i.label}`)), [back], { prefix }));
    case "pay.confirm": {
      const inst = p.instalmentIndex != null ? data.instalments[p.instalmentIndex] : undefined;
      return ussdCon(withFooter(tr("ussd.pay.confirm", { amount: ussdMoney(inst?.amount ?? 0), policy: shorten(inst?.label ?? "", 40) }), [back], prefix));
    }
    case "claim.confirm":
      return ussdCon(withFooter(tr("ussd.claim.confirm", { policy: policy ? ussdPolicyLabel({ title: policy.title }, 36) : "none" }), [back], prefix));
    case "talk":
      return ussdCon(withFooter(tr("ussd.talk.menu"), [back], prefix));
  }
}
