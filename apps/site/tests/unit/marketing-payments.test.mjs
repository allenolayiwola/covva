import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PAYMENTS_DISCLOSURE } from "../../src/components/marketing/payments-disclosure.ts";
import { FAQ_GROUPS, PAYMENT_METHODS } from "../../src/components/marketing/content.ts";

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

test("partner marketing states the agreed platform fee without rendering price cards", async () => {
  for (const page of ["insurers", "brokers"]) {
    const source = await readFile(new URL(`../../src/app/(site)/(marketing)/${page}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, /Platform fee: set per partner agreement/);
    assert.doesNotMatch(source, /PlanCards|getPlans|No fixed fee/);
    if (page === "insurers") assert.match(source, /Portal \(Level 1\)/);
  }
});
