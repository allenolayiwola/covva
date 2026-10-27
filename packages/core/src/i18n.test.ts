import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOGUES,
  LOCALES,
  MESSAGE_KEYS,
  catalogueCoverage,
  createTranslator,
  effectiveStatus,
  en,
  formatMessage,
  localeNotice,
  matchAcceptLanguage,
  mergeCatalogue,
  messageArgs,
  normaliseLocale,
  onMissingKey,
  parseTranslationCsv,
  pluralise,
  resolveLocale,
  t,
  toTranslationCsv,
  type MissingKeyEvent,
} from "./i18n/index";

test("locales: en, tw, gaa, ee with honest statuses", () => {
  assert.deepEqual(LOCALES.map((l) => l.code), ["en", "tw", "gaa", "ee"]);
  assert.equal(LOCALES[0].status, "complete");
  for (const l of LOCALES.slice(1)) assert.notEqual(l.status, "complete", `${l.code} is not complete`);
});

test("non-English catalogues contain only human-supplied strings (none yet) and only known keys", () => {
  for (const [code, cat] of Object.entries(CATALOGUES)) {
    if (code === "en") continue;
    for (const key of Object.keys(cat)) assert.ok(key in en, `${code} has unknown key ${key}`);
    // Guard against bulk machine translation sneaking in: anything here must be reviewed.
    assert.ok(Object.keys(cat).length < MESSAGE_KEYS.length, `${code} claims a full catalogue — needs a translator review record`);
  }
});

test("normaliseLocale accepts aliases and regions", () => {
  assert.equal(normaliseLocale("en-GH"), "en");
  assert.equal(normaliseLocale("ga"), "gaa");
  assert.equal(normaliseLocale("GAA"), "gaa");
  assert.equal(normaliseLocale("twi"), "tw");
  assert.equal(normaliseLocale("ak-GH"), "tw");
  assert.equal(normaliseLocale("ee_TG"), "ee");
  assert.equal(normaliseLocale("fr"), null);
  assert.equal(normaliseLocale(""), null);
  assert.equal(normaliseLocale(null), null);
});

test("Accept-Language matching respects q-values and falls through unknown languages", () => {
  assert.equal(matchAcceptLanguage("fr-FR,fr;q=0.9,ee;q=0.8,en;q=0.7"), "ee");
  assert.equal(matchAcceptLanguage("en-GB,en;q=0.9"), "en");
  assert.equal(matchAcceptLanguage("de, ak;q=0.5"), "tw");
  assert.equal(matchAcceptLanguage("de,fr"), null);
  assert.equal(matchAcceptLanguage("*"), null);
  assert.equal(matchAcceptLanguage(undefined), null);
});

test("resolveLocale: explicit cookie → profile → Accept-Language → English", () => {
  assert.equal(resolveLocale({ explicit: "tw", profile: "ee", acceptLanguage: "gaa" }), "tw");
  assert.equal(resolveLocale({ explicit: "xx", profile: "ee", acceptLanguage: "gaa" }), "ee");
  assert.equal(resolveLocale({ profile: "en-GH", acceptLanguage: "gaa" }), "en");
  assert.equal(resolveLocale({ acceptLanguage: "ga-GH" }), "gaa");
  assert.equal(resolveLocale({}), "en");
});

test("t: English is returned unchanged; other locales fall back to English", () => {
  assert.equal(t("en", "nav.claims"), "Claims");
  assert.equal(t("tw", "nav.claims"), "Claims");
  assert.equal(t("gaa", "header.myAccount"), "My account");
  assert.equal(t("nope", "header.myAccount"), "My account", "unknown locale → English");
});

test("t: runtime (approved DB) strings win over the code catalogue", () => {
  const msgs = { "nav.claims": "Claim-test-tw" };
  assert.equal(t("tw", "nav.claims", undefined, { messages: msgs }), "Claim-test-tw");
  assert.equal(t("en", "nav.claims", undefined, { messages: msgs }), "Claims", "English is never overridden");
  const tr = createTranslator("tw", msgs);
  assert.equal(tr.locale, "tw");
  assert.equal(tr("nav.claims"), "Claim-test-tw");
  assert.equal(tr("nav.learn"), "Learn");
});

test("missing keys and fallbacks are reported once", () => {
  const events: MissingKeyEvent[] = [];
  const prev = onMissingKey((e) => events.push(e));
  try {
    assert.equal(t("en", "no.such.key"), "no.such.key");
    t("en", "no.such.key");
    t("ee", "nav.about");
    t("ee", "nav.about");
    t("en", "request.forPolicy", {});
  } finally {
    onMissingKey(prev);
  }
  assert.deepEqual(
    events.map((e) => `${e.kind}:${e.locale}:${e.key}${e.arg ? `:${e.arg}` : ""}`),
    ["key:en:no.such.key", "translation:ee:nav.about", "arg:en:request.forPolicy:policy"],
  );
});

test("interpolation: simple args, plural and select", () => {
  assert.equal(t("en", "request.forPolicy", { policy: "Toyota Corolla" }), "For Toyota Corolla");
  assert.equal(t("en", "wallet.renewalIn", { days: 1 }), "Renewal in 1 day");
  assert.equal(t("en", "wallet.renewalIn", { days: 14 }), "Renewal in 14 days");
  assert.equal(formatMessage("en", "{n, plural, =0 {none} one {# item} other {# items}}", { n: 0 }), "none");
  assert.equal(formatMessage("en", "{n, plural, one {# item} other {# items}}", { n: 1200 }), "1,200 items");
  assert.equal(formatMessage("en", "{who, select, broker {Your broker {name}} other {Covva}}", { who: "broker", name: "Kofi" }), "Your broker Kofi");
  assert.equal(formatMessage("en", "{who, select, broker {Your broker} other {Covva}}", { who: "x" }), "Covva");
  assert.equal(formatMessage("en", "Hello {name}", {}), "Hello ", "missing args render empty, never throw");
  assert.equal(formatMessage("en", "Unbalanced {name", { name: "x" }), "Unbalanced {name");
  assert.equal(formatMessage("en", "No braces"), "No braces");
});

test("pluralise and messageArgs", () => {
  assert.equal(pluralise("en", 1, { one: "# policy", other: "# policies" }), "1 policy");
  assert.equal(pluralise("en", 3, { one: "# policy", other: "# policies" }), "3 policies");
  assert.equal(pluralise("ee", 2, { one: "# x", other: "# xs" }), "2 xs");
  assert.equal(pluralise("tw", 0, { "=0": "none", other: "#" }), "none");
  assert.deepEqual(messageArgs(en["ussd.renew.confirm"]), ["ends", "policy"]);
  assert.deepEqual(messageArgs("{a} {b, plural, one {# {c}} other {x}} {d, select, k {Covva} other {}}"), ["a", "b", "c", "d"]);
});

test("mergeCatalogue keeps approved, known, non-empty rows only; coverage is measured", () => {
  const rows = [
    { key: "nav.claims", value: "A", status: "approved" },
    { key: "nav.learn", value: "B", status: "draft" },
    { key: "unknown.key", value: "C", status: "approved" },
    { key: "nav.about", value: "  ", status: "approved" },
  ];
  const merged = mergeCatalogue("tw", rows);
  assert.deepEqual(merged, { "nav.claims": "A" });
  assert.deepEqual(mergeCatalogue("en", rows), {}, "English is never merged");
  const cov = catalogueCoverage("tw", merged);
  assert.equal(cov.total, MESSAGE_KEYS.length);
  assert.equal(cov.translated, 1);
  assert.equal(cov.status, "partial");
  assert.ok(cov.missing.includes("nav.learn"));
  assert.equal(catalogueCoverage("gaa", {}).status, "planned");
  assert.equal(effectiveStatus("gaa", {}), "planned");
  assert.equal(effectiveStatus("tw", merged), "partial");
  assert.equal(effectiveStatus("en", {}), "complete");
});

test("honest notice for partial / planned locales", () => {
  assert.equal(localeNotice("en"), null);
  assert.equal(localeNotice("tw"), "Twi translations are in progress — untranslated text is shown in English.");
  assert.equal(localeNotice("gaa", "partial"), "Ga translations are in progress — untranslated text is shown in English.");
  assert.equal(localeNotice("ee", "complete"), null);
});

test("translator CSV import/export round-trips and rejects unknown keys", () => {
  const known = (k: string) => k in en;
  const csv = 'key,value\nnav.claims,"Claims, tw"\nnav.learn,"He said ""hi"""\nbogus.key,x\nnav.claims,dup\nnav.about,\n';
  const r = parseTranslationCsv(csv, known);
  assert.deepEqual(r.rows, [
    { key: "nav.claims", value: "Claims, tw" },
    { key: "nav.learn", value: 'He said "hi"' },
  ]);
  assert.deepEqual(r.errors.map((e) => e.line), [4, 5]);
  const out = toTranslationCsv(r.rows);
  assert.deepEqual(parseTranslationCsv(out, known).rows, r.rows);
  // Headerless files work too.
  assert.equal(parseTranslationCsv("nav.claims,X", known).rows.length, 1);
});

test("every English template parses (balanced braces) and has no leading/trailing whitespace", () => {
  for (const [k, v] of Object.entries(en)) {
    let depth = 0;
    for (const c of v) {
      if (c === "{") depth++;
      if (c === "}") depth--;
      assert.ok(depth >= 0, `${k}: unbalanced braces`);
    }
    assert.equal(depth, 0, `${k}: unbalanced braces`);
    // Fragments that sit next to markup (a highlighted span, a link) may carry one edge space.
    if (!k.startsWith("footer.") && !k.endsWith("Lead")) assert.equal(v, v.trim(), `${k}: stray whitespace`);
  }
});
