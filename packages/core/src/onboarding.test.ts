import { test } from "node:test";
import assert from "node:assert/strict";
import { agreementHash, agreementText, currentAgreement, PARTNER_AGREEMENT_V1 } from "./agreements.ts";
import {
  applicationCompleteness,
  applicationSchema,
  licenceStatusFor,
  nextStep,
  normalisePhone,
  parseClientImportCsv,
  parseCsvLines,
  stepsFor,
  type PartnerApplicationInput,
} from "./onboarding.ts";

const signed = {
  version: "broker-v1",
  signed_name: "Kofi Mensah",
  signed_at: "2026-10-26T10:00:00Z",
  hash: "a".repeat(64),
};

const brokerApp: PartnerApplicationInput = {
  type: "broker",
  company_name: "Accra Risk Partners",
  address: "12 Independence Ave, Accra",
  region: "Greater Accra",
  nic_licence_number: "NIC/BR/2026/001",
  nic_licence_class: "broker",
  nic_licence_expires_on: "2030-01-01",
  primary_contact: { name: "Kofi Mensah", email: "kofi@example.com", phone: "0241234567" },
  principal_officer: { name: "Ama Owusu", email: "ama@example.com" },
  settlement_account: { type: "momo", account_name: "Accra Risk Partners", momo_network: "MTN", momo_number: "0241234567" },
  commercial_model: "revenue_share",
  documents: [
    { kind: "nic_licence", storage_path: "partner-applications/x/licence.pdf", name: "licence.pdf", uploaded_at: "2026-10-26T10:00:00Z" },
    { kind: "incorporation", storage_path: "partner-applications/x/inc.pdf", name: "inc.pdf", uploaded_at: "2026-10-26T10:00:00Z" },
  ],
  agreement: signed,
};

test("stepsFor: insurers choose integration levels, brokers a commercial model", () => {
  assert.deepEqual(stepsFor("insurer"), ["company", "licence", "contacts", "settlement", "documents", "integration", "agreement", "review"]);
  assert.deepEqual(stepsFor("broker"), ["company", "licence", "contacts", "settlement", "documents", "commercial", "agreement", "review"]);
});

test("applicationSchema accepts a stored application and rejects a bad licence class", () => {
  assert.ok(applicationSchema.safeParse(brokerApp).success);
  assert.equal(applicationSchema.safeParse({ ...brokerApp, nic_licence_class: "motor" }).success, false);
});

test("a complete broker application has no missing steps and goes to review", () => {
  const c = applicationCompleteness(brokerApp);
  assert.deepEqual(c.missing, []);
  assert.equal(c.complete, true);
  assert.equal(nextStep(brokerApp), "review");
});

test("an empty draft lists every step in order; nextStep walks forward from the current step", () => {
  const empty: PartnerApplicationInput = { type: "insurer" };
  const c = applicationCompleteness(empty);
  assert.equal(c.complete, false);
  assert.deepEqual([...new Set(c.missing.map((m) => m.step))], ["company", "licence", "contacts", "settlement", "documents", "integration", "agreement"]);
  assert.equal(nextStep(empty), "company");
  assert.equal(nextStep(empty, "company"), "licence");
  assert.equal(nextStep(empty, "agreement"), "review");
});

test("completeness enforces the licence class per type, an unexpired licence, both documents and the signature", () => {
  const wrongClass = applicationCompleteness({ ...brokerApp, nic_licence_class: "non_life" });
  assert.ok(wrongClass.missing.some((m) => m.step === "licence" && /broker-class/.test(m.reason)));
  const expired = applicationCompleteness({ ...brokerApp, nic_licence_expires_on: "2020-01-01" });
  assert.ok(expired.missing.some((m) => m.step === "licence" && /expired/.test(m.reason)));
  const oneDoc = applicationCompleteness({ ...brokerApp, documents: brokerApp.documents!.slice(0, 1) });
  assert.deepEqual(oneDoc.missing.map((m) => m.step), ["documents"]);
  const unsigned = applicationCompleteness({ ...brokerApp, agreement: { version: "broker-v1" } });
  assert.deepEqual(unsigned.missing.map((m) => m.step), ["agreement"]);
  const insurer = applicationCompleteness({ ...brokerApp, type: "insurer", nic_licence_class: "composite", compliance_contact: brokerApp.primary_contact, integration_levels: [{ category_slug: "motor", level: "L2" }] });
  assert.deepEqual(insurer.missing, []);
  const noLines = applicationCompleteness({ ...brokerApp, type: "insurer", nic_licence_class: "life", compliance_contact: brokerApp.primary_contact });
  assert.deepEqual(noLines.missing.map((m) => m.step), ["integration"]);
});

test("settlement account must be a bank or mobile money account (never cards)", () => {
  const card = applicationCompleteness({ ...brokerApp, settlement_account: { type: "card", card_number: "4111" } as never });
  assert.deepEqual(card.missing.map((m) => m.step), ["settlement"]);
  const bank = applicationCompleteness({ ...brokerApp, settlement_account: { type: "bank", bank_name: "GCB", account_name: "ARP Ltd", account_number: "1234567890" } });
  assert.deepEqual(bank.missing, []);
});

test("licenceStatusFor: unverified / lapsed / expiring / verified", () => {
  const today = "2026-10-26";
  assert.equal(licenceStatusFor(null, today), "unverified");
  assert.equal(licenceStatusFor("2026-10-25", today), "lapsed");
  assert.equal(licenceStatusFor("2026-10-26", today), "expiring");
  assert.equal(licenceStatusFor("2026-11-25", today), "expiring");
  assert.equal(licenceStatusFor("2026-11-26", today), "verified");
  assert.equal(licenceStatusFor(new Date("2027-06-01T00:00:00Z"), new Date("2026-10-26T12:00:00Z")), "verified");
  assert.equal(licenceStatusFor("not-a-date", today), "unverified");
});

test("agreement text hashes deterministically and differs per kind", async () => {
  const broker = agreementText(currentAgreement("broker"));
  const insurer = agreementText(PARTNER_AGREEMENT_V1.insurer);
  const h1 = await agreementHash(broker);
  const h2 = await agreementHash(broker);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, await agreementHash(insurer));
  assert.ok(broker.includes("Covva is not an insurer and not a broker"));
});

test("parseCsvLines handles quotes, embedded commas, CRLF and keeps blank lines for row numbering", () => {
  const rows = parseCsvLines('a,b\r\n"Mensah, Ama","say ""hi"""\n\nc,d\n');
  assert.deepEqual(rows, [["a", "b"], ["Mensah, Ama", 'say "hi"'], [""], ["c", "d"]]);
  const r = parseClientImportCsv("name,phone\n\nAma,0241234567\n,0241234568");
  assert.equal(r.rows[0]!.row, 3);
  assert.equal(r.errors[0]!.row, 4);
});

test("normalisePhone converts Ghanaian local numbers to E.164", () => {
  assert.equal(normalisePhone("024 123 4567"), "+233241234567");
  assert.equal(normalisePhone("+233 24 123 4567"), "+233241234567");
  assert.equal(normalisePhone("233241234567"), "+233241234567");
});

test("parseClientImportCsv maps header aliases, validates rows and numbers errors by line", () => {
  const csv = [
    "Client Name,Mobile,E-mail,Policy No,Insurer,Product line,Expiry date",
    "Ama Mensah,0241234567,ama@example.com,POL-1,Star Assurance,Motor,31/03/2027",
    "Kwame Boateng,,kwame@example,,,,",
    ",0551112222,,,,,",
    "Yaa Asantewaa,0241234567,,POL-2,,,2027-02-30",
    "Esi Dadzie,0201112223,,POL-3,Enterprise Insurance,Home,2027-05-01",
  ].join("\n");
  const r = parseClientImportCsv(csv);
  assert.deepEqual(r.columns, ["name", "phone", "email", "policy_number", "insurer_name", "category", "cover_end"]);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { row: 2, name: "Ama Mensah", phone: "+233241234567", email: "ama@example.com", policy_number: "POL-1", insurer_name: "Star Assurance", category_slug: "motor", cover_end: "2027-03-31" });
  assert.equal(r.rows[1]!.row, 6);
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4, 5]);
  assert.match(r.errors[0]!.message, /email "kwame@example" is not valid/);
  assert.match(r.errors[1]!.message, /name is missing/);
  assert.match(r.errors[2]!.message, /insurer_name is required/);
  assert.match(r.errors[2]!.message, /duplicate of row 2/);
  assert.match(r.errors[2]!.message, /not a date/);
});

test("parseClientImportCsv rejects files without a name column or any contact column", () => {
  assert.match(parseClientImportCsv("phone,email\n024,a@b.c").errors[0]!.message, /"name" column is required/);
  assert.match(parseClientImportCsv("name\nAma").errors[0]!.message, /"phone" or "email" column is required/);
  assert.match(parseClientImportCsv("").errors[0]!.message, /empty/);
});
