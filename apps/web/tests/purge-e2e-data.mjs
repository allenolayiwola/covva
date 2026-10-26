#!/usr/bin/env node
// Deletes rows the automated suites left behind (anything tagged `E2E-…`). Needs SUPABASE_SECRET_KEY.
// Run: node apps/web/tests/purge-e2e-data.mjs   (also called by the db-rules suite's teardown in CI)
import { hasServiceKey, service } from "./_lib/supabase.mjs";

const LIKE = "like.E2E-*";

/** Dependency order matters: children before parents, payments before requests (FK without cascade). */
const PLAN = [
  ["claims", `description=${LIKE}`],
  ["payments", `idempotency_key=${LIKE}`],
  ["policies", `or=(nickname.like.E2E-*,policy_number.like.E2E-*)`],
  ["requests", `title=${LIKE}`], // cascades: quotes, submissions, disclosures, applications, tasks, messages, events
  ["leads", `or=(message.like.E2E-*,name.like.E2E-*)`],
  ["rate_tables", `name=${LIKE}`], // cascades: rate_rows
  ["underwriting_rules", `name=${LIKE}`],
  ["document_templates", `name=${LIKE}`],
];

export async function purgeE2EData({ log = console.log } = {}) {
  if (!hasServiceKey()) {
    log("purge skipped: no SUPABASE_SECRET_KEY");
    return null;
  }
  const svc = service();
  const counts = {};
  for (const [table, filter] of PLAN) {
    const r = await svc.delete(`${table}?${filter}`);
    if (r.status >= 300) throw new Error(`purge ${table} failed: ${r.status} ${JSON.stringify(r.body)}`);
    counts[table] = Array.isArray(r.body) ? r.body.length : 0;
  }
  log(`purged E2E rows: ${JSON.stringify(counts)}`);
  return counts;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  purgeE2EData().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
