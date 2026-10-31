import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransitionPartnerInvoice, transitionPartnerInvoice } from "./partner-billing";

const states = ["draft", "issued", "paid", "void", "overdue", "invalid"];
for (const from of states) {
  for (const to of states) {
    test(`partner invoice ${from} -> ${to}`, () => {
      const allowed = (from === "draft" && ["issued", "paid", "void"].includes(to)) ||
        (from === "issued" && ["paid", "void"].includes(to));
      assert.equal(canTransitionPartnerInvoice(from, to), allowed);
      if (allowed) assert.equal(transitionPartnerInvoice(from, to), to);
      else assert.throws(() => transitionPartnerInvoice(from, to), /Cannot move/);
    });
  }
}
