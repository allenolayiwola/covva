import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAQ_CATEGORIES,
  estimateReadMinutes,
  findProhibitedClaims,
  groupFaqs,
  isCmsLocale,
  isValidSlug,
  lexicalToRichNodes,
  preferCms,
  richNodesToPlainText,
  richTextToPlainText,
  safeHref,
  simpleBlocksToLexical,
  simpleBlocksToRichNodes,
  sortByOrder,
  testimonialPublishable,
  validateCompliantCopy,
  validatePageSlug,
  type SimpleContentBlock,
} from "./cms.ts";

test("slugs: validation and reserved routes", () => {
  assert.ok(isValidSlug("diaspora-care-pack"));
  assert.ok(isValidSlug("a1"));
  assert.ok(!isValidSlug("Diaspora Care"));
  assert.ok(!isValidSlug("-leading"));
  assert.ok(!isValidSlug("double--hyphen"));
  assert.ok(!isValidSlug(""));
  assert.ok(!isValidSlug("x".repeat(97)));
  assert.equal(validatePageSlug("campaign-2026"), true);
  assert.match(String(validatePageSlug("learn")), /already serves/);
  assert.match(String(validatePageSlug("cms")), /already serves/);
  assert.match(String(validatePageSlug("Bad Slug")), /lower-case/);
});

test("locales: the CMS codes match the site (Ga is gaa)", () => {
  assert.ok(isCmsLocale("en") && isCmsLocale("tw") && isCmsLocale("gaa") && isCmsLocale("ee"));
  assert.ok(!isCmsLocale("ga"));
  assert.ok(!isCmsLocale("fr"));
});

test("compliance: Covva may never be described as an insurer or a broker", () => {
  assert.equal(findProhibitedClaims("Covva is not an insurer or a broker, and we never hold your premium.").length, 0);
  assert.equal(findProhibitedClaims("Licensed brokers advise you and licensed insurers underwrite your policy.").length, 0);
  assert.equal(findProhibitedClaims("Your broker is paid commission by the insurer.").length, 0);
  assert.equal(findProhibitedClaims("Covva is a technology platform.").length, 0);

  const role = findProhibitedClaims("Covva is a licensed broker you can trust.");
  assert.equal(role.length, 1);
  assert.equal(role[0]!.reason, "role");
  assert.equal(findProhibitedClaims("As Ghana's leading insurer, we are the insurance company for you")[0]?.reason, "role");
  assert.equal(findProhibitedClaims("Covva acts as your broker for every policy.").length, 1);

  const funds = findProhibitedClaims("Pay us and we hold your premium until the insurer confirms.");
  assert.equal(funds.length, 1);
  assert.equal(funds[0]!.reason, "funds");
  assert.equal(findProhibitedClaims("We never hold your premium.").length, 0);

  assert.equal(validateCompliantCopy("We compare products from participating insurers only."), true);
  assert.match(String(validateCompliantCopy("Covva is an insurer.")), /not an insurer or a broker/);
  assert.match(String(validateCompliantCopy("Covva holds your money safely.")), /never holds premiums/);
  assert.equal(validateCompliantCopy(null), true);
  assert.equal(validateCompliantCopy(undefined), true);
});

test("compliance: rich text is checked through its plain text", () => {
  const state = simpleBlocksToLexical([{ type: "p", text: "Covva is your insurer." }]);
  assert.match(String(validateCompliantCopy(state)), /not an insurer or a broker/);
});

test("testimonials: genuine quotes need consent on file; illustrative ones do not", () => {
  assert.equal(testimonialPublishable({ illustrative: true, consentOnFile: false }), true);
  assert.equal(testimonialPublishable({ illustrative: false, consentOnFile: true }), true);
  assert.match(String(testimonialPublishable({ illustrative: false, consentOnFile: false })), /Consent on file/);
  assert.match(String(testimonialPublishable({})), /illustrative/);
});

test("safeHref: only http(s), mailto, tel, relative and fragment links survive", () => {
  assert.equal(safeHref("https://nic.gov.gh"), "https://nic.gov.gh");
  assert.equal(safeHref("/learn/understanding-excess"), "/learn/understanding-excess");
  assert.equal(safeHref("#quote"), "#quote");
  assert.equal(safeHref("mailto:support@covva.com.gh"), "mailto:support@covva.com.gh");
  assert.equal(safeHref("tel:+233501234567"), "tel:+233501234567");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("JAVASCRIPT:alert(1)"), null);
  assert.equal(safeHref("data:text/html,hi"), null);
  assert.equal(safeHref("//evil.example"), null);
  assert.equal(safeHref("java\nscript:x"), null);
  assert.equal(safeHref(42), null);
});

test("lexicalToRichNodes: paragraphs, headings, lists, marks, links and tip blocks; unknown nodes dropped", () => {
  const state = {
    root: {
      type: "root",
      children: [
        { type: "heading", tag: "h2", children: [{ type: "text", text: "What it includes" }] },
        {
          type: "paragraph",
          children: [
            { type: "text", text: "Bold", format: 1 },
            { type: "text", text: " and " },
            { type: "text", text: "italic", format: 2 },
            { type: "linebreak" },
            { type: "link", fields: { url: "https://nic.gov.gh", newTab: true }, children: [{ type: "text", text: "NIC" }] },
            { type: "link", fields: { url: "javascript:alert(1)" }, children: [{ type: "text", text: "bad link" }] },
            { type: "link", fields: { linkType: "internal", doc: { relationTo: "articles", value: { slug: "understanding-excess" } } }, children: [{ type: "text", text: "excess" }] },
          ],
        },
        { type: "paragraph", children: [] },
        { type: "list", listType: "number", children: [{ type: "listitem", children: [{ type: "text", text: "one" }] }, { type: "listitem", children: [{ type: "text", text: "two" }] }] },
        { type: "quote", children: [{ type: "text", text: "quoted" }] },
        { type: "horizontalrule" },
        { type: "block", fields: { blockType: "tip", text: "  Compare the excess too.  " } },
        { type: "block", fields: { blockType: "unknown", html: "<script>alert(1)</script>" } },
        { type: "relationship", value: 1 },
        { type: "heading", tag: "h1", children: [{ type: "text", text: "demoted" }] },
      ],
    },
  };
  const nodes = lexicalToRichNodes(state);
  assert.deepEqual(nodes[0], { type: "heading", level: 2, children: [{ type: "text", text: "What it includes" }] });
  assert.equal(nodes[1]!.type, "paragraph");
  const para = nodes[1] as Extract<(typeof nodes)[number], { type: "paragraph" }>;
  assert.deepEqual(para.children[0], { type: "text", text: "Bold", bold: true });
  assert.deepEqual(para.children[2], { type: "text", text: "italic", italic: true });
  assert.deepEqual(para.children[3], { type: "break" });
  assert.deepEqual(para.children[4], { type: "link", href: "https://nic.gov.gh", newTab: true, children: [{ type: "text", text: "NIC" }] });
  // The unsafe link keeps its text but loses the href.
  assert.deepEqual(para.children[5], { type: "text", text: "bad link" });
  assert.deepEqual(para.children[6], { type: "link", href: "/learn/understanding-excess", children: [{ type: "text", text: "excess" }] });
  assert.deepEqual(nodes[2], { type: "list", ordered: true, items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] });
  assert.deepEqual(nodes[3], { type: "quote", children: [{ type: "text", text: "quoted" }] });
  assert.deepEqual(nodes[4], { type: "rule" });
  assert.deepEqual(nodes[5], { type: "tip", text: "Compare the excess too." });
  assert.deepEqual(nodes[6], { type: "heading", level: 2, children: [{ type: "text", text: "demoted" }] });
  assert.equal(nodes.length, 7);
  assert.equal(JSON.stringify(nodes).includes("<script>"), false);
  assert.deepEqual(lexicalToRichNodes(null), []);
  assert.deepEqual(lexicalToRichNodes({ root: null }), []);
});

test("typed blocks ↔ Lexical round-trip keeps the article identical", () => {
  const blocks: SimpleContentBlock[] = [
    { type: "p", text: "Comprehensive motor insurance pays for damage to your own vehicle." },
    { type: "h2", text: "What it includes" },
    { type: "ul", items: ["Accident damage", "Theft"] },
    { type: "ol", items: ["First", "Second"] },
    { type: "tip", text: "Look past the premium." },
  ];
  const viaLexical = lexicalToRichNodes(simpleBlocksToLexical(blocks));
  assert.deepEqual(viaLexical, simpleBlocksToRichNodes(blocks));
  const text = richNodesToPlainText(viaLexical);
  assert.match(text, /^Comprehensive motor insurance/);
  assert.match(text, /Accident damage\nTheft/);
  assert.equal(richTextToPlainText(simpleBlocksToLexical(blocks)), text);
});

test("estimateReadMinutes: ~200 words a minute, at least one", () => {
  assert.equal(estimateReadMinutes(""), 1);
  assert.equal(estimateReadMinutes("word ".repeat(150)), 1);
  assert.equal(estimateReadMinutes("word ".repeat(900)), 5);
});

test("preferCms, sortByOrder and groupFaqs", () => {
  assert.deepEqual(preferCms([], ["code"]), { items: ["code"], source: "code" });
  assert.deepEqual(preferCms(null, ["code"]), { items: ["code"], source: "code" });
  assert.deepEqual(preferCms(["cms"], ["code"]), { items: ["cms"], source: "cms" });

  const sorted = sortByOrder([{ id: "c", order: null }, { id: "b", order: 2 }, { id: "a", order: 1 }], (t) => t.id);
  assert.deepEqual(sorted.map((s) => s.id), ["a", "b", "c"]);

  const groups = groupFaqs(
    [
      { id: "x", category: "paying", order: 2 },
      { id: "y", category: "quotes", order: 1 },
      { id: "z", category: "paying", order: 1 },
      { id: "w", category: "unknown", order: 1 },
    ],
    FAQ_CATEGORIES,
  );
  assert.deepEqual(groups.map((g) => [g.id, g.title, g.items.map((i) => i.id)]), [
    ["quotes", "Getting quotes", ["y"]],
    ["paying", "Paying", ["z", "x"]],
    ["unknown", "unknown", ["w"]],
  ]);
});
