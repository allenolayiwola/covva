import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_DISPLAY_CURRENCIES, convertFromGhs, convertToGhs, formatMoney, fxDisclosure, fxMargin, fxQuote, fxSummaryLine, parseDisplayCurrency, roundHalfUp } from "./fx.ts";

test("supported display currencies and parsing", () => {
  assert.deepEqual([...SUPPORTED_DISPLAY_CURRENCIES], ["GHS", "GBP", "USD", "EUR", "CAD"]);
  assert.equal(parseDisplayCurrency(" gbp "), "GBP");
  assert.equal(parseDisplayCurrency("NGN"), null);
  assert.equal(parseDisplayCurrency(42), null);
});

test("roundHalfUp rounds half up at 2 dp without float drift", () => {
  assert.equal(roundHalfUp(1.005), 1.01);
  assert.equal(roundHalfUp(2.675), 2.68);
  assert.equal(roundHalfUp(1.004), 1.0);
  assert.equal(roundHalfUp(-1.005), -1.01);
  assert.equal(roundHalfUp(20.5, 4), 20.5);
});

test("convertToGhs / convertFromGhs use GHS-per-unit rates and 2 dp", () => {
  assert.equal(convertToGhs(100, 20.5), 2050);
  assert.equal(convertFromGhs(2050, 20.5), 100);
  assert.equal(convertFromGhs(720, 20.5), 35.12); // 35.1219…
  assert.equal(convertFromGhs(1255.63, 15.6), 80.49); // 80.4891…
  assert.throws(() => convertFromGhs(10, 0), RangeError);
  assert.throws(() => convertToGhs(-1, 20.5), RangeError);
});

test("fxMargin lowers the GHS-per-unit rate so the foreign amount rises; 0 is identity", () => {
  assert.equal(fxMargin(20.5, 0), 20.5);
  assert.equal(roundHalfUp(fxMargin(20.5, 2), 6), roundHalfUp(20.5 / 1.02, 6));
  assert.ok(convertFromGhs(2050, fxMargin(20.5, 2)) > 100);
  assert.equal(fxMargin(20.5, 50), 20.5 / 1.1); // clamped to 10 %
});

test("fxQuote: GHS is the contract amount, the display is indicative", () => {
  const q = fxQuote({ ghsAmount: 2050, displayCurrency: "GBP", rate: 20.5, source: "manual", quotedAt: "2026-10-01T00:00:00Z" });
  assert.equal(q.ghsAmount, 2050);
  assert.equal(q.displayAmount, 100);
  assert.equal(q.rate, 20.5);
  assert.equal(q.indicative, true);
  assert.match(q.disclosure, /Indicative rate: 1 GBP/);
  assert.match(q.disclosure, /insurer receives GH₵ 2,050\.00/);
  assert.match(q.disclosure, /manual rate set by Covva operations, 1 Oct 2026/);
  const ghs = fxQuote({ ghsAmount: 2050.004, displayCurrency: "GHS" });
  assert.equal(ghs.displayAmount, 2050);
  assert.equal(ghs.rate, 1);
  assert.throws(() => fxQuote({ ghsAmount: 10, displayCurrency: "USD" }), RangeError);
});

test("fxQuote applies and discloses the platform margin", () => {
  const q = fxQuote({ ghsAmount: 2050, displayCurrency: "GBP", rate: 20.5, marginPct: 1.5, quotedAt: "2026-10-01T00:00:00Z" });
  assert.equal(q.displayAmount, 101.5);
  assert.equal(q.marginPct, 1.5);
  assert.match(q.disclosure, /1\.5% buffer/);
});

test("fxDisclosure and the checkout summary line", () => {
  assert.match(fxDisclosure("GHS", 1, "manual", "2026-10-01"), /Ghana cedis/);
  const d = fxDisclosure("USD", 15.6, "openexchangerates", "2026-10-26T09:00:00Z", { ghsAmount: 4200 });
  assert.match(d, /You pay ≈ \$269\.23; the insurer receives GH₵ 4,200\.00/);
  assert.match(d, /final exchange rate/);
  assert.equal(fxSummaryLine({ displayCurrency: "CAD", displayAmount: 108, ghsAmount: 1231.2 }), "You pay ≈ C$108.00 (indicative) · Insurer receives GH₵ 1,231.20");
  assert.equal(fxSummaryLine({ displayCurrency: "GHS", displayAmount: 10, ghsAmount: 10 }), "You pay GH₵ 10.00 · Insurer receives GH₵ 10.00");
});

test("formatMoney", () => {
  assert.equal(formatMoney(1234.5, "GHS"), "GH₵ 1,234.50");
  assert.equal(formatMoney(61.25, "GBP"), "£61.25");
  assert.equal(formatMoney(5, "NGN"), "NGN 5.00");
  assert.equal(formatMoney(-3, "EUR"), "−€3.00");
});
