// Second site server for e2e/site-gate.spec.js: the same build with the pre-launch gate on (lib/site-gate.ts).
// It waits for the main server (which may be building first, E2E_BUILD=1), then serves the build on GATED_PORT
// with the gate limited to "localhost", so http://127.0.0.1:<port> shows what an ungated host sees.
import { spawn } from "node:child_process";

const main = process.env.E2E_MAIN_URL ?? "http://localhost:3100";
const port = process.env.E2E_GATED_PORT ?? "3104";

for (;;) {
  try {
    if ((await fetch(`${main}/robots.txt`)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const child = spawn("pnpm", ["exec", "next", "start", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, SITE_GATE: "waitlist", SITE_GATE_HOSTS: "localhost", SITE_GATE_BYPASS_TOKEN: process.env.E2E_GATE_TOKEN ?? "e2e-preview-token-0123456789" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
