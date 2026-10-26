import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USSD_MAX_CHARS,
  USSD_MAX_LIST,
  fitUssd,
  ghanaNetwork,
  isUssdRegistration,
  latestUssdInput,
  menuScreen,
  normaliseMsisdn,
  normaliseNetwork,
  parseUssdHistory,
  renderUssdScreen,
  routeUssd,
  stripDialExtension,
  ussdEnd,
  ussdMoney,
  ussdPolicyLabel,
  ussdReference,
  withFooter,
  type UssdContext,
  type UssdNode,
  type UssdViewData,
} from "./ussd";
import { createTranslator, en, type MessageKey } from "./i18n/index";

const tr = createTranslator("en");
const known: UssdContext = { known: true, policies: 3, instalments: 2 };
const stranger: UssdContext = { known: false, policies: 0, instalments: 0 };
const route = (text: string, ctx: UssdContext = known) => routeUssd(parseUssdHistory(text), ctx);

test("MSISDN normalisation and network detection (Ghana)", () => {
  assert.equal(normaliseMsisdn("0241234567"), "+233241234567");
  assert.equal(normaliseMsisdn("233241234567"), "+233241234567");
  assert.equal(normaliseMsisdn("+233 24 123 4567"), "+233241234567");
  assert.equal(normaliseMsisdn("241234567"), "+233241234567");
  assert.equal(normaliseMsisdn("12"), null);
  assert.equal(ghanaNetwork("0241234567"), "mtn");
  assert.equal(ghanaNetwork("0501234567"), "telecel");
  assert.equal(ghanaNetwork("+233271234567"), "airteltigo");
  assert.equal(ghanaNetwork("+447700900123"), "unknown");
  assert.equal(normaliseNetwork("Vodafone", null), "telecel");
  assert.equal(normaliseNetwork("AirtelTigo", null), "airteltigo");
  assert.equal(normaliseNetwork("", "0551234567"), "mtn");
});

test("history parsing: Africa's Talking `*` joined text", () => {
  assert.deepEqual(parseUssdHistory(""), []);
  assert.deepEqual(parseUssdHistory(null), []);
  assert.deepEqual(parseUssdHistory("1*1*GR 1234-24*2"), ["1", "1", "GR 1234-24", "2"]);
  assert.deepEqual(parseUssdHistory(" 1 ** 2 "), ["1", "2"]);
  assert.equal(latestUssdInput("1*2*3"), "3");
  assert.equal(latestUssdInput(""), "");
  assert.deepEqual(stripDialExtension(["44", "1"], "*44#"), ["1"]);
  assert.deepEqual(stripDialExtension(["44", "2", "1"], "44*2"), ["1"]);
  assert.deepEqual(stripDialExtension(["1"], "44"), ["1"]);
  assert.deepEqual(stripDialExtension(["1"], null), ["1"]);
});

test("navigation: main menu, quote flows and terminal actions", () => {
  assert.equal(route("").node, "main");
  assert.equal(route("1").node, "quote");
  assert.equal(route("1*1").node, "quote.motor.reg");
  const use = route("1*1*gr 1234 24");
  assert.equal(use.node, "quote.motor.use");
  assert.equal(use.params.registration, "GR 1234-24");
  const result = route("1*1*GR1234-24*2");
  assert.equal(result.node, "quote.motor.result");
  assert.equal(result.params.vehicleUse, "commercial");
  assert.equal(result.params.product, "motor");
  const sms = route("1*1*GR1234-24*2*1");
  assert.equal(sms.action, "quote.sms");
  assert.equal(sms.params.registration, "GR 1234-24");
  assert.equal(route("1*1*GR1234-24*2*2").action, "quote.callback");
  assert.equal(route("1*2*2").params.period, "week");
  assert.equal(route("1*2*3*1").action, "micro.buy");
  assert.equal(route("1*3*4").params.people, 4);
  assert.equal(route("1*3*4*1").action, "quote.sms");
  assert.equal(route("6*1").action, "talk.callback");
  assert.equal(route("6*2").action, "talk.sms");
});

test("navigation: back (0), home (00) and invalid inputs", () => {
  assert.equal(route("1*0").node, "main");
  assert.equal(route("1*1*0").node, "quote");
  assert.equal(route("1*1*GR1234-24*00").node, "main");
  assert.equal(route("1*00*6").node, "talk");
  const bad = route("9");
  assert.equal(bad.node, "main");
  assert.equal(bad.invalid, true);
  assert.equal(bad.error, "option");
  // An invalid input is skipped for navigation: the next valid one still works.
  assert.equal(route("9*1").node, "quote");
  assert.equal(route("9*1").invalid, false);
  const reg = route("1*1*hello");
  assert.equal(reg.node, "quote.motor.reg");
  assert.equal(reg.error, "registration");
  assert.equal(route("1*3*0").node, "quote", "0 is back on the people prompt");
  assert.equal(route("1*3*11").error, "people");
});

test("navigation: customer journeys use the context counts", () => {
  assert.equal(route("2").node, "renew.list");
  const confirm = route("2*3");
  assert.equal(confirm.node, "renew.confirm");
  assert.equal(confirm.params.policyIndex, 2);
  assert.equal(route("2*4").invalid, true, "only 3 policies");
  assert.equal(route("2*3*1").action, "renew.primary");
  assert.equal(route("2*3*2").action, "renew.secondary");
  assert.equal(route("3*2").params.instalmentIndex, 1);
  assert.equal(route("3*2*1").action, "pay.momo");
  assert.equal(route("3*1*2").action, "pay.link");
  assert.equal(route("4*1").action, "check.detail");
  assert.equal(route("5*4").params.policyIndex, null, "last option = policy not listed");
  assert.equal(route("5*2*1").action, "claim.callback");
  assert.equal(route("5*2*1").params.policyIndex, 1);
  // Unknown numbers.
  assert.equal(route("2", stranger).action, "end.notFound");
  assert.equal(route("3", stranger).action, "end.notFound");
  assert.equal(route("4", stranger).action, "end.notFound");
  assert.equal(route("5", stranger).node, "claim.confirm", "anyone can request a claim callback");
  assert.equal(route("5*1", stranger).action, "claim.callback");
  // Known customer without policies / instalments.
  const empty = { known: true, policies: 0, instalments: 0 };
  assert.equal(route("2", empty).action, "end.renew.none");
  assert.equal(route("3", empty).action, "end.pay.none");
  assert.equal(route("4", empty).action, "end.check.none");
  // Lists cap at USSD_MAX_LIST.
  const many = { known: true, policies: 9, instalments: 9 };
  assert.equal(route(`2*${USSD_MAX_LIST}`, many).node, "renew.confirm");
  assert.equal(route(`2*${USSD_MAX_LIST + 1}`, many).invalid, true);
});

test("registration validation", () => {
  assert.ok(isUssdRegistration("GR 1234-24"));
  assert.ok(isUssdRegistration("as123422"));
  assert.ok(!isUssdRegistration("1234"));
  assert.ok(!isUssdRegistration("hello world"));
});

const LONG = "Comprehensive Motor Insurance Toyota Land Cruiser Prado 2021 GR 99999-24 extra long";
const worst: UssdViewData = {
  policies: Array.from({ length: 6 }, (_, i) => ({ title: `${LONG} ${i}`, coverEnd: "2026-12-31", micro: i === 1, renewPrice: 12345.67 })),
  instalments: Array.from({ length: 6 }, (_, i) => ({ label: `${LONG} instalment ${i}`, amount: 123456.78 })),
  quotePrice: 1234567.89,
};

test("every screen fits 160 characters (worst-case data)", () => {
  const paths = [
    "", "9", "1", "1*9", "1*1", "1*1*bad", "1*1*GR1234-24", "1*1*GR1234-24*9", "1*1*GR1234-24*1", "1*2", "1*2*1", "1*2*1*9", "1*3", "1*3*99", "1*3*10",
    "2", "2*9", "2*1", "2*2", "3", "3*1", "4", "5", "5*5", "5*1", "6",
  ];
  const ctx = { known: true, policies: worst.policies.length, instalments: worst.instalments.length };
  const seen = new Set<UssdNode>();
  for (const p of paths) {
    const r = routeUssd(parseUssdHistory(p), ctx);
    assert.equal(r.action, null, `${p} is a screen`);
    seen.add(r.node);
    for (const data of [worst, { ...worst, quotePrice: null }]) {
      const screen = renderUssdScreen(r, data, tr);
      assert.equal(screen.type, "CON");
      assert.ok(screen.text.length <= USSD_MAX_CHARS, `${p || "(start)"} is ${screen.text.length} chars:\n${screen.text}`);
      assert.ok(screen.text.length > 10);
    }
  }
  assert.equal(seen.size, 17, "all nodes rendered");
  // Stranger claim screen.
  const s = renderUssdScreen(routeUssd(["5"], stranger), { policies: [], instalments: [] }, tr);
  assert.match(s.text, /^Report a claim\. We'll call you back/);
});

test("main menu and list screens read correctly", () => {
  const main = renderUssdScreen(route(""), worst, tr);
  assert.equal(main.text, en["ussd.main"]);
  const bad = renderUssdScreen(route("9"), worst, tr);
  assert.ok(bad.text.startsWith("Invalid choice. Covva insurance"));
  const list = renderUssdScreen(route("4", { known: true, policies: 2, instalments: 0 }), { policies: [{ title: "Motor GR 1234-24", coverEnd: "2026-11-12" }, { title: "Funeral cover" }], instalments: [] }, tr);
  assert.equal(list.text, "Which policy?\n1 Motor GR 1234-24 to 12/11\n2 Funeral cover\n0 Back");
  const motor = renderUssdScreen(route("1*1*GR1234-24*1"), { policies: [], instalments: [], quotePrice: 350 }, tr);
  assert.equal(motor.text, "Third-party for GR 1234-24 from GHS 350/yr (indicative).\n1 SMS me a link to buy\n2 Call me back\n0 Back");
  const renew = renderUssdScreen(route("2*1", { known: true, policies: 1, instalments: 0 }), { policies: [{ title: "Motor GR 1234-24", coverEnd: "2026-11-12" }], instalments: [] }, tr);
  assert.equal(renew.text, "Renew Motor GR 1234-24 (ends 12/11/2026)?\n1 SMS me a renewal link\n2 Call me back\n0 Back");
});

test("END screens from the catalogue fit with long values", () => {
  const vars = { ref: "CB-ABCDE", policy: LONG.slice(0, 40), amount: ussdMoney(123456.78), end: "31 Dec 2026", status: "Pending", insurer: "Coastline General Insurance Company Ltd", start: "1 Jan 2026" };
  const endKeys = (Object.keys(en) as MessageKey[]).filter((k) => /^ussd\.(sms\.sent|callback\.done|notFound|renew\.(none|requested)|pay\.(none|prompted|linkSent)|check\.(none|detail)|claim\.done|talk\.sms|error)$/.test(k));
  assert.ok(endKeys.length >= 12);
  for (const k of endKeys) {
    const reply = ussdEnd(tr(k, vars));
    assert.equal(reply.type, "END");
    assert.ok(reply.text.length <= USSD_MAX_CHARS, `${k}: ${reply.text.length}`);
  }
  // Raw catalogue text for these END screens fits without truncation for typical values.
  for (const k of endKeys) assert.ok(!ussdEnd(tr(k, { ref: "CB-ABCDE", policy: "Motor GR 1234-24", amount: "GHS 120", end: "12 Nov 2026", status: "Active", insurer: "Coastline General", start: "12 Nov 2025" })).text.endsWith("…"), `${k} truncated`);
});

test("builders: fit, menus, footers, labels, money, references", () => {
  assert.equal(fitUssd("a".repeat(200)).length, USSD_MAX_CHARS);
  assert.ok(fitUssd("a".repeat(200)).endsWith("…"));
  const m = menuScreen("Title", Array.from({ length: 8 }, () => "x".repeat(40)), ["0 Back"]);
  assert.ok(m.length <= USSD_MAX_CHARS);
  assert.ok(m.endsWith("\n0 Back"));
  assert.ok(withFooter("y".repeat(300), ["0 Back"]).endsWith("…\n0 Back"));
  assert.equal(ussdPolicyLabel({ title: "Motor", coverEnd: "2026-01-09" }), "Motor to 09/01");
  assert.equal(ussdMoney(120), "GHS 120");
  assert.equal(ussdMoney(12.5), "GHS 12.50");
  assert.equal(ussdMoney(1234.5), "GHS 1,234.50");
  let i = 0;
  assert.equal(ussdReference("CB", () => (i++ % 32) / 32), "CB-23456");
  assert.match(ussdReference("CL"), /^CL-[2-9A-HJ-NP-Z]{5}$/);
});
