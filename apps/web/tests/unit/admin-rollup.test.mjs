import { after, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const state = { allowed: false, calls: [], permissions: [], clients: 0 };
globalThis.__covvaRollupTest = state;
const actions = `
export async function authorize(permission) {
  const s = globalThis.__covvaRollupTest;
  s.permissions.push(permission);
  return s.allowed ? { ok: true } : { ok: false, error: 'denied' };
}
export const fail = error => ({ ok: false, error });
export const done = message => ({ ok: true, message });
export const formObject = fd => Object.fromEntries(fd);
export const zodError = () => ({ ok: false, error: 'invalid' });
export const dbMessage = error => error.message;
`;
const service = `export function createServiceClient() {
  const s = globalThis.__covvaRollupTest;
  s.clients++;
  return { rpc: async (...args) => { s.calls.push(args); return { data: { days: 1, rows: 0, ms: 1 } }; } };
}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = specifier === "@/lib/actions" ? actions : specifier === "@/lib/supabase/server" ? service : null;
    if (stub) return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { runRollup } = await import("../../../admin/src/app/(admin)/analytics/actions.ts");
after(() => { hooks.deregister(); delete globalThis.__covvaRollupTest; });
const form = () => {
  const fd = new FormData();
  fd.set("from", "2026-10-31"); fd.set("to", "2026-10-31"); fd.set("dry_run", "1");
  return fd;
};
test("admin rollup checks platform authorization before constructing a service client", async () => {
  assert.deepEqual(await runRollup({}, form()), { ok: false, error: "denied" });
  assert.deepEqual(state.permissions, ["platform"]);
  assert.equal(state.clients, 0);
  state.allowed = true;
  assert.equal((await runRollup({}, new FormData())).ok, false);
  assert.equal(state.clients, 0);
  assert.equal((await runRollup({}, form())).ok, true);
  assert.equal(state.clients, 1);
  assert.deepEqual(state.calls, [["analytics_rollup", { p_from: "2026-10-31", p_to: "2026-10-31", p_dry_run: true }]]);
});
