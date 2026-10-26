import { test } from "node:test";
import assert from "node:assert/strict";
import { SHARE_TOKEN_RE, shareText, whatsappShareLink } from "./share.ts";

test("shareText lists quotes cheapest first, flags estimates and is honest about one insurer", () => {
  const text = shareText({
    categoryName: "Motor",
    riskTitle: "Toyota Corolla 2020",
    url: "https://covva.com.gh/q/abc",
    quotes: [
      { insurerName: "Coastline", premium: 1500, excess: 500, status: "ready_to_accept" },
      { insurerName: "Harbour", premium: 1200, status: "estimate" },
    ],
  });
  const lines = text.split("\n");
  assert.equal(lines[0], "Motor quotes · Toyota Corolla 2020");
  assert.equal(lines[1], "• Harbour: GH₵ 1,200/yr, estimate");
  assert.equal(lines[2], "• Coastline: GH₵ 1,500/yr, excess GH₵ 500");
  assert.equal(lines[3], "2 insurers compared on Covva.");
  assert.equal(lines[4], "See the full comparison: https://covva.com.gh/q/abc");
  assert.doesNotMatch(text, /Ama|REQ-/);

  const one = shareText({ url: "u", quotes: [{ insurerName: "Coastline", premium: 100, status: "ready_to_accept" }] });
  assert.match(one, /1 insurer compared on Covva — every licensed insurer that quoted for this risk\./);
});

test("shareText caps the list and whatsappShareLink encodes the text", () => {
  const quotes = Array.from({ length: 7 }, (_, i) => ({ insurerName: `I${i}`, premium: 100 + i, status: "ready_to_accept" }));
  assert.match(shareText({ url: "u", quotes }), /• \+2 more/);
  const link = whatsappShareLink("Hello & welcome\nline 2", "+233 24 123 4567");
  assert.equal(link, "https://wa.me/233241234567?text=Hello%20%26%20welcome%0Aline%202");
  assert.equal(whatsappShareLink("x"), "https://wa.me/?text=x");
  assert.ok(SHARE_TOKEN_RE.test("a".repeat(48)));
  assert.ok(!SHARE_TOKEN_RE.test("zz"));
});
