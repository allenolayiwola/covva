import { test } from "node:test";
import assert from "node:assert/strict";
import { PARTNER_AGREEMENT_V1, agreementHash, agreementText, currentAgreement } from "./agreements.ts";

test("both partner agreements exist with a version, title and sections", () => {
  for (const kind of ["insurer", "broker"] as const) {
    const a = currentAgreement(kind);
    assert.equal(a, PARTNER_AGREEMENT_V1[kind]);
    assert.ok(a.title.length > 5);
    assert.ok(a.version);
    assert.ok(a.sections.length >= 3, `${kind} agreement has sections`);
    for (const s of a.sections) {
      assert.ok(s.heading && s.body, "every section has a heading and body");
    }
  }
});

test("the agreement text is canonical: title, then heading/body pairs, no trailing whitespace", () => {
  const text = agreementText({ version: "test", title: "Test agreement", sections: [{ heading: "1. One", body: "Body one." }, { heading: "2. Two", body: "Body two." }] });
  assert.equal(text, "Test agreement\n\n1. One\nBody one.\n\n2. Two\nBody two.");
});

test("the hash is SHA-256 hex, stable for the same text and different for a changed clause", async () => {
  const insurer = agreementText(currentAgreement("insurer"));
  const h1 = await agreementHash(insurer);
  const h2 = await agreementHash(insurer);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h2);
  assert.notEqual(await agreementHash(`${insurer} `), h1, "a single character changes the hash the applicant signed");
  assert.notEqual(await agreementHash(agreementText(currentAgreement("broker"))), h1);
});

test("the platform never describes itself as a broker or an insurer in the agreements", () => {
  for (const kind of ["insurer", "broker"] as const) {
    const text = agreementText(currentAgreement(kind)).toLowerCase();
    assert.ok(!/covva (is|acts as) (a|an|the) (broker|insurer)/.test(text), `${kind}: no self-description as broker/insurer`);
    assert.ok(!/covva holds (client|customer) (funds|money)/.test(text), `${kind}: never holds client funds`);
  }
});
