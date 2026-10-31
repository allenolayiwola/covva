import { after, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Import the actual handler and constant-time comparator; replace only job side effects.
const calls = [];
globalThis.__covvaCronTest = { calls, ok: true };
const stub = `export const CRON_JOBS = { 'offer-expiry': true, 'webhook-retry': true };
export async function runCron(...args) {
  globalThis.__covvaCronTest.calls.push(args);
  return { ok: globalThis.__covvaCronTest.ok };
}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/cron") return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { GET } = await import("../../src/app/api/cron/[job]/route.ts");
const original = process.env.CRON_SECRET;
after(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
  delete globalThis.__covvaCronTest;
  hooks.deregister();
});
const invoke = (auth, job = "offer-expiry", query = "") => GET(
  new Request(`http://localhost/api/cron/${job}${query}`, { headers: auth == null ? {} : { authorization: auth } }),
  { params: Promise.resolve({ job }) },
);

test("unset and empty cron secrets fail closed before dispatch", async () => {
  for (const value of [undefined, ""]) {
    if (value === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = value;
    for (const auth of [null, "Bearer undefined", "Bearer ", "Bearer test-only"]) {
      assert.equal((await invoke(auth)).status, 401);
    }
  }
  assert.equal(calls.length, 0);
});
test("missing, wrong and malformed bearer headers never dispatch jobs", async () => {
  process.env.CRON_SECRET = "test-only-cron-secret";
  for (const auth of [null, "test-only-cron-secret", "Bearer wrong", "bearer test-only-cron-secret"]) {
    assert.equal((await invoke(auth)).status, 401);
  }
  assert.equal((await invoke(null, "unknown")).status, 401);
  assert.equal(calls.length, 0);
});
test("valid bearer dispatches both scheduled jobs and preserves status and dry-run behavior", async () => {
  process.env.CRON_SECRET = "test-only-cron-secret";
  for (const job of ["offer-expiry", "webhook-retry"]) {
    assert.equal((await invoke("Bearer test-only-cron-secret", job, "?dry_run=1")).status, 200);
    assert.deepEqual(calls.at(-1), [job, { dryRun: "1" }]);
  }
  assert.equal((await invoke("Bearer test-only-cron-secret", "unknown")).status, 404);
  assert.equal(calls.length, 2);
  globalThis.__covvaCronTest.ok = false;
  assert.equal((await invoke("Bearer test-only-cron-secret")).status, 500);
});
