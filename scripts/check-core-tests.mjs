#!/usr/bin/env node
// Tests-with-every-feature gate (Roadmap cross-cutting): a pull request that changes a `@im/core` module
// (`packages/core/src/<name>.ts`) must also change its unit tests (`packages/core/src/<name>.test.ts`).
//
// Usage:  node scripts/check-core-tests.mjs <base-ref> <head-ref> ["<pr title>"]
// Exit 1 lists the modules without a matching test change. Escape hatch: put `[skip-test-check]` in the
// PR title (for pure refactors, comment-only or type-only changes) — the skip is printed so reviewers see it.
// `index.ts`, the i18n catalogues (`src/i18n/*`) and test files themselves are not checked.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const [base, head, title = ""] = process.argv.slice(2);
if (!base || !head) {
  console.error("usage: check-core-tests.mjs <base-ref> <head-ref> [pr-title]");
  process.exit(2);
}
if (/\[skip-test-check\]/i.test(title)) {
  console.log("[skip-test-check] found in the PR title — core test coverage check skipped.");
  process.exit(0);
}

const changed = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { encoding: "utf8" })
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const CORE = "packages/core/src/";
const modules = changed.filter((f) => f.startsWith(CORE) && f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts") && !f.slice(CORE.length).includes("/") && f !== `${CORE}index.ts`);
const changedSet = new Set(changed);
const missing = [];
for (const mod of modules) {
  const test = mod.replace(/\.ts$/, ".test.ts");
  // A deleted module needs no test; a module whose test file does not exist at all must get one.
  const deleted = !existsSync(resolve(process.cwd(), mod));
  if (deleted) continue;
  if (!changedSet.has(test)) missing.push({ mod, test });
}

if (!modules.length) {
  console.log("No @im/core modules changed — nothing to check.");
  process.exit(0);
}
if (!missing.length) {
  console.log(`OK: every changed @im/core module has a matching test change (${modules.length} module${modules.length === 1 ? "" : "s"}).`);
  process.exit(0);
}
console.error("Tests are added with every feature. These @im/core modules changed without their unit tests:");
for (const m of missing) console.error(`  - ${m.mod}  →  expected a change in ${m.test}${existsSync(resolve(process.cwd(), m.test)) ? "" : " (file does not exist yet)"}`);
console.error("\nAdd or update the test file, or put [skip-test-check] in the PR title for a change that genuinely needs no test (say why in the description).");
process.exit(1);
