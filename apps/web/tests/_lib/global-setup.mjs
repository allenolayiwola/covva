// Global setup for `pnpm test:db`: sign each demo role in exactly once per run and cache the sessions
// (tests/.auth/sessions.json, gitignored). The test files read that cache through `signIn()`, so the
// whole suite makes six Auth sign-ins instead of one per role per file (which hit Supabase Auth's
// 429 over_request_rate_limit). Tokens are refreshed on every run.
import { ACCOUNTS, primeSessions } from "./supabase.mjs";

const n = await primeSessions(Object.values(ACCOUNTS));
console.log(`test:db global setup: signed in ${n} demo roles once`);
