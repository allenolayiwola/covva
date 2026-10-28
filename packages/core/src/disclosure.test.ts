import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_DISCLAIMER, DEFAULT_PLATFORM_NAME, DEMO_DISCLAIMER, ROLE_STATEMENTS, buildDisclosure } from "./disclosure.ts";

test("the mandatory disclosure names the platform, the broker with its licence and the insurer", () => {
  const text = buildDisclosure({ broker: { name: "Demo Broker", licence: "NIC/B/123" }, insurer: { name: "Coastline General" } });
  assert.equal(text, "Technology provided by Covva. Insurance broking services provided by Demo Broker, NIC licence NIC/B/123. This policy is underwritten and issued by Coastline General.");
  assert.equal(DEFAULT_PLATFORM_NAME, "Covva");
});

test("before an insurer is chosen the wording stays honest, and a missing licence is left out", () => {
  const text = buildDisclosure({ broker: { name: "Demo Broker", licence: null }, insurer: null });
  assert.equal(text, "Technology provided by Covva. Insurance broking services provided by Demo Broker. The policy will be underwritten and issued by the insurer you choose.");
  assert.match(buildDisclosure({ platform: "Other Co", broker: { name: "B" } }), /^Technology provided by Other Co\./);
});

test("role statements never call the platform a broker or an insurer, and never a holder of premiums", () => {
  assert.match(ROLE_STATEMENTS.platform, /not an insurer or broker/);
  assert.match(ROLE_STATEMENTS.platform, /never hold your premium/);
  assert.match(ROLE_STATEMENTS.payment, /directly to the insurer/);
  assert.match(ROLE_STATEMENTS.broker, /broker of record/);
  assert.match(ROLE_STATEMENTS.insurer, /decide and pay claims/);
  assert.match(CLAIM_DISCLAIMER, /does not mean approval/);
  assert.match(DEMO_DISCLAIMER, /Illustrative only/);
});
