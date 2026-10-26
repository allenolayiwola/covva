import { test } from "node:test";
import assert from "node:assert/strict";
import { DEEP_LINK_SCHEME, webPathToDeepLink } from "./api.ts";
import { CLAIM_DISCLAIMER, ROLE_STATEMENTS, buildDisclosure } from "./disclosure.ts";

test("webPathToDeepLink maps customer paths and falls back to the inbox", () => {
  const inbox = { url: `${DEEP_LINK_SCHEME}://notifications`, path: "/notifications" };
  assert.equal(DEEP_LINK_SCHEME, "covva");
  assert.deepEqual(webPathToDeepLink(null), inbox);
  assert.deepEqual(webPathToDeepLink(undefined), inbox);
  assert.deepEqual(webPathToDeepLink(""), inbox);
  assert.deepEqual(webPathToDeepLink("/account"), { url: "covva://home", path: "/home" });
  assert.deepEqual(webPathToDeepLink("/account/"), { url: "covva://home", path: "/home" });
  assert.deepEqual(webPathToDeepLink("/account/requests/123/quotes"), { url: "covva://requests/123/quotes", path: "/requests/123/quotes" });
  assert.deepEqual(webPathToDeepLink("/account/requests/abc/confirmation"), { url: "covva://requests/abc", path: "/requests/abc" }, "confirmation screens collapse to the request");
  assert.deepEqual(webPathToDeepLink("/account/policies/p1?tab=docs"), { url: "covva://policies/p1?tab=docs", path: "/policies/p1?tab=docs" });
});

test("webPathToDeepLink handles absolute URLs and non-customer paths", () => {
  const inbox = webPathToDeepLink(null);
  assert.deepEqual(webPathToDeepLink("https://covva.com.gh/account/claims/c1"), { url: "covva://claims/c1", path: "/claims/c1" });
  assert.deepEqual(webPathToDeepLink("http://localhost:3000/account/requests/r1/confirmation?new=1"), { url: "covva://requests/r1?new=1", path: "/requests/r1?new=1" });
  assert.deepEqual(webPathToDeepLink("/partner/requests/1"), inbox, "partner screens have no mobile equivalent");
  assert.deepEqual(webPathToDeepLink("/partner/offers"), { url: "covva://offers", path: "/offers" }, "broker offers are the exception (one-tap accept)");
  assert.deepEqual(webPathToDeepLink("/partner/offers/accept/abc123"), { url: "covva://offers/accept/abc123", path: "/offers/accept/abc123" });
  assert.deepEqual(webPathToDeepLink("/admin"), inbox);
  assert.deepEqual(webPathToDeepLink("/accounts/x"), inbox, "prefix must be exactly /account/");
  assert.deepEqual(webPathToDeepLink("https://"), inbox, "malformed URL → fallback");
});

test("disclosure builder handles missing licence and insurer", () => {
  assert.equal(
    buildDisclosure({ broker: { name: "Demo Broker" } }),
    "Technology provided by Covva. Insurance broking services provided by Demo Broker. The policy will be underwritten and issued by the insurer you choose.",
  );
  assert.equal(
    buildDisclosure({ platform: "Platform X", broker: { name: "B", licence: null }, insurer: null }),
    "Technology provided by Platform X. Insurance broking services provided by B. The policy will be underwritten and issued by the insurer you choose.",
  );
  assert.match(ROLE_STATEMENTS.platform, /not an insurer or broker/);
  assert.match(ROLE_STATEMENTS.payment, /directly to the insurer/);
  assert.match(CLAIM_DISCLAIMER, /does not mean approval/);
});
