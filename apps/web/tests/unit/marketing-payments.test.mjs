import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { PAYMENTS_DISCLOSURE } from "../../src/components/marketing/payments-disclosure.ts";
import { FAQ_GROUPS, HOME_FAQ_IDS, PAYMENT_METHODS } from "../../src/components/marketing/content.ts";

const expected = "Payments are processed by Paystack. The partner's share goes directly to the partner. Covva receives a commission per policy sold. Rankings are not affected by commission.";
const targets = ["what-is", "cost", "methods"];
const faqs = FAQ_GROUPS.flatMap((group) => group.items);

test("payment FAQs retain methods and the exact commission and ranking disclosure", () => {
  assert.equal(PAYMENTS_DISCLOSURE, expected);
  for (const id of targets) {
    const answer = faqs.find((faq) => faq.id === id).a;
    assert.ok(answer.endsWith(expected));
    assert.match(answer, /Partners pay Covva a platform fee/);
    assert.match(answer, /neither commission nor fees affect rankings/);
    assert.match(answer, /Commission is taken via the Paystack split/);
    assert.match(answer, /Paystack, not Covva, holds customer funds/);
    assert.doesNotMatch(answer, /never hold|paid commission by|Paystack splits/i);
  }
  assert.match(faqs.find((faq) => faq.id === "methods").a, /mobile money or card/);
  assert.deepEqual(PAYMENT_METHODS.map((method) => method.label),
    ["MTN MoMo", "Telecel Cash", "AirtelTigo Money", "Visa", "Mastercard"]);
});

test("trust and disclosures retain the shared commission disclosure without broker commission copy", async () => {
  for (const [page, usage] of [
    ["trust", /title: "Commission disclosed", body: PAYMENTS_DISCLOSURE/],
    ["legal/disclosures", /<li>\{PAYMENTS_DISCLOSURE\}<\/li>/],
  ]) {
    const source = await readFile(new URL(`../../src/app/(site)/(marketing)/${page}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, /import \{ PAYMENTS_DISCLOSURE \} from "@\/components\/marketing\/payments-disclosure"/);
    assert.match(source, usage);
    assert.doesNotMatch(source, /broker.{0,20}commission|broker[^.\n]*(?:receives?|earns?|paid)[^.\n]*commission|commission[^.\n]*broker|paid commission by/i);
  }
});

for (const methodsExists of [false, true]) {
  test(`actual FAQ seed preserves records and is idempotent (methods exists: ${methodsExists})`, async () => {
    // Execute the seed's FAQ section with an in-memory Payload substitute, without a database.
    const source = await readFile(new URL("../../src/cms/seed.ts", import.meta.url), "utf8");
    const section = source.slice(source.indexOf("  // 3. FAQs"), source.indexOf("  // 4. Testimonials"));
    assert.ok(section.includes("for (const g of FAQ_GROUPS)"));
    const constants = source.match(/const (?:PAYMENT|CLAIMS)_FAQ_IDS = .*;/g).join("\n");
    const js = ts.transpileModule(constants + "\n" + section, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const run = new (Object.getPrototypeOf(async function () {}).constructor)(
      "payload", "FAQ_GROUPS", "HOME_FAQ_IDS", "tally", js,
    );
    const records = new Map(faqs.filter((faq) => methodsExists || faq.id !== "methods").map((faq) => [
      faq.id, { key: faq.id, answer: "Saved editorial answer", question: "Saved question",
        placements: ["support"], order: 99, _status: "draft" },
    ]));
    records.set("custom", { key: "custom", answer: "Custom answer" });
    const before = structuredClone(records);
    let writes = 0;
    const payload = {
      async count({ where }) { return { totalDocs: records.has(where.key.equals) ? 1 : 0 }; },
      async create({ data }) {
        assert.ok(!records.has(data.key));
        records.set(data.key, data);
        writes++;
      },
      async update({ collection, locale, where, data }) {
        assert.equal(collection, "faqs");
        assert.equal(locale, "en");
        assert.deepEqual(Object.keys(data), ["answer"]);
        const key = where.and[0].key.equals;
        assert.ok(targets.includes(key));
        const record = records.get(key);
        if (record.answer !== where.and[1].answer.not_equals) {
          Object.assign(record, data);
          writes++;
        }
      },
    };
    await run(payload, FAQ_GROUPS, HOME_FAQ_IDS, () => {});
    assert.equal(writes, 3);
    for (const [key, record] of before) {
      assert.deepEqual(records.get(key), targets.includes(key)
        ? { ...record, answer: faqs.find((faq) => faq.id === key).a } : record);
    }
    for (const id of targets) assert.ok(records.get(id).answer.endsWith(expected));
    assert.match(records.get("methods").answer, /mobile money or card/);
    const after = structuredClone(records);
    await run(payload, FAQ_GROUPS, HOME_FAQ_IDS, () => {});
    assert.equal(writes, 3);
    assert.deepEqual(records, after);
  });
}

test("partner marketing states the agreed platform fee without rendering price cards", async () => {
  for (const page of ["insurers", "brokers"]) {
    const source = await readFile(new URL(`../../src/app/(site)/(marketing)/${page}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, /Platform fee: set per partner agreement/);
    assert.doesNotMatch(source, /PlanCards|getPlans|No fixed fee/);
    if (page === "insurers") assert.match(source, /Portal \(Level 1\)/);
  }
});
