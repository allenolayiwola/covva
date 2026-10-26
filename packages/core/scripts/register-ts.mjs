// Test-runner helper: lets core modules import each other without an extension (as the
// Next.js apps bundle them) while `node --experimental-strip-types --test` runs them.
import { register } from "node:module";
register("./resolve-ts.mjs", import.meta.url);
