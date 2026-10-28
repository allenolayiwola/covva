#!/usr/bin/env node
// Removes rows the automated suites leave behind in the shared demo project: everything tagged `E2E-…`
// (E2E-DBRULES, E2E-PLAYWRIGHT, E2E-WELFARE, E2E-DIASPORA, E2E-SME, E2E-SCORE, E2E-LOYAL, …). Needs SUPABASE_SECRET_KEY.
//
// Run: pnpm --filter @im/web test:purge   (also: the db-rules / catalogue suites' teardown, the integration
// workflow's final step and the on-demand purge workflow, .github/workflows/purge.yml).
//
// Every step runs on its own: a failure is logged with its PostgREST status and the purge carries on, so one
// table that cannot be deleted never leaves every later table untouched (that is how E2E policies and requests
// survived earlier runs: the loop threw on the first 409 — a policy still referenced by an endorsement or a
// claim — and stopped). Children without ON DELETE CASCADE are deleted by parent id before their parents.
//
// Tables whose DELETE is revoked from the service role by design (privacy_requests*, welfare_*, group_schemes /
// scheme_members / fleet_vehicles) are moved to their designed terminal state instead (withdrawn / cancelled /
// removed / ended / offboarded). Append-only tables (audit_events, ledger_entries, reward_ledger, tax_entries) and
// rows the suites deliberately keep auditable (retired products, deactivated policy-number blocks, superseded
// loyalty rule-set versions, consent history) are left alone.
import { hasServiceKey, service } from "./_lib/supabase.mjs";

/** PostgREST `like` uses `*` as the wildcard; matches every suite's prefix. */
const LIKE = "like.E2E-*";
const CHUNK = 100; // ids per `in.(…)` filter: keeps the query string short

/** Statuses from which a privacy request may still be withdrawn (private.privacy_transition_allowed). */
const PRIVACY_WITHDRAWABLE = "in.(submitted,identity_verified,approved)";

const chunks = (ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
};

function makeOps(svc, log) {
  const failures = [];
  const counts = {};

  const record = (table, n) => {
    counts[table] = (counts[table] ?? 0) + n;
  };
  const failed = (table, what, r) => {
    const msg = `${table}: ${what} failed: ${r.status} ${typeof r.body === "string" ? r.body : JSON.stringify(r.body)}`;
    failures.push(msg);
    log(`  ! ${msg}`);
  };

  /** ids of `table` rows matching `filter` (column `id` unless given). */
  async function ids(table, filter, column = "id") {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await svc.get(`${table}?select=${column}&${filter}&limit=1000&offset=${offset}`);
      if (r.status >= 300) {
        failed(table, "lookup", r);
        return out;
      }
      const page = Array.isArray(r.body) ? r.body.map((row) => row[column]).filter(Boolean) : [];
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  /** DELETE table?filter, counting the rows removed. */
  async function del(table, filter) {
    const r = await svc.delete(`${table}?${filter}`);
    if (r.status >= 300) {
      failed(table, `delete ${filter}`, r);
      return 0;
    }
    const n = Array.isArray(r.body) ? r.body.length : 0;
    record(table, n);
    return n;
  }

  /** DELETE rows of `table` whose `column` is one of `parentIds` (chunked). */
  async function delByIds(table, column, parentIds) {
    let n = 0;
    for (const chunk of chunks(parentIds)) n += await del(table, `${column}=in.(${chunk.join(",")})`);
    return n;
  }

  /** PATCH rows into a terminal state where DELETE is revoked by design. Counted under `table (→state)`. */
  async function patch(table, filter, body, label) {
    const r = await svc.update(`${table}?${filter}`, body);
    if (r.status >= 300) {
      failed(table, `update ${filter}`, r);
      return 0;
    }
    const n = Array.isArray(r.body) ? r.body.length : 0;
    record(`${table} (→${label})`, n);
    return n;
  }

  return { ids, del, delByIds, patch, counts, failures };
}

/**
 * The plan, in dependency order (children before parents; payments before requests; claims before policies and
 * service partners). Each entry is `[name, async (ops) => void]`.
 */
const PLAN = [
  // ------------------------------------------------------------------ claims (claim_* children cascade)
  [
    "service_partner_reviews",
    async ({ ids, delByIds, del }) => {
      // Reviews hang off claim_jobs without cascade: delete the reviews of jobs on tagged claims first.
      const claims = await ids("claims", `description=${LIKE}`);
      for (const chunk of chunks(claims)) {
        const jobs = await ids("claim_jobs", `claim_id=in.(${chunk.join(",")})`);
        if (jobs.length) await delByIds("service_partner_reviews", "claim_job_id", jobs);
      }
      await del("service_partner_reviews", `comment=${LIKE}`);
    },
  ],
  ["claims", ({ del }) => del("claims", `description=${LIKE}`)],

  // ------------------------------------------------------------------ policies and their non-cascading children
  [
    "policy children",
    async ({ ids, delByIds, del }) => {
      const policies = await ids("policies", "or=(nickname.like.E2E-*,policy_number.like.E2E-*)");
      if (policies.length) {
        for (const table of ["endorsements", "property_inspections", "property_updates", "sponsor_subscriptions", "micro_sessions", "telematics_enrolments", "instalment_schedules", "issuance_jobs"]) {
          await delByIds(table, "policy_id", policies);
        }
      }
      // Instalment fixtures are tagged in their metadata, not by policy.
      await del("instalment_schedules", `metadata->>tag=${LIKE}`); // instalments cascade
    },
  ],
  [
    "telematics",
    async ({ ids, delByIds, del }) => {
      await del("telematics_trips", `trip_id=${LIKE}`);
      const enrolments = await ids("telematics_enrolments", `device_id=${LIKE}`);
      if (enrolments.length) {
        await delByIds("telematics_scores", "enrolment_id", enrolments); // cascade would do it; explicit for the count
        await delByIds("telematics_trips", "enrolment_id", enrolments);
        await delByIds("telematics_enrolments", "id", enrolments);
      }
    },
  ],
  ["payments", ({ del }) => del("payments", `idempotency_key=${LIKE}`)], // FK to requests without cascade
  ["policies", ({ del }) => del("policies", "or=(nickname.like.E2E-*,policy_number.like.E2E-*)")],

  // ------------------------------------------------------------------ requests (quotes, submissions, applications, disclosures,
  // tasks, messages, events, order_routing, order_offers and quote_shares cascade)
  [
    "broker_reviews",
    async ({ ids, delByIds, del }) => {
      // subject_id is a plain reference (no FK), so reviews of tagged requests must go explicitly.
      const requests = await ids("requests", `title=${LIKE}`);
      if (requests.length) await delByIds("broker_reviews", "subject_id", requests);
      await del("broker_reviews", `comment=${LIKE}`);
    },
  ],
  ["customer_broker_assignments", ({ del }) => del("customer_broker_assignments", `note=${LIKE}`)],
  ["requests", ({ del }) => del("requests", `title=${LIKE}`)],

  // ------------------------------------------------------------------ family (sponsorships, consents, household_members cascade)
  ["beneficiaries", ({ del }) => del("beneficiaries", "or=(notes.like.E2E-*,full_name.like.E2E-*)")],

  // ------------------------------------------------------------------ partners, CRM, leads, catalogue
  ["service_partners", ({ del }) => del("service_partners", `name=${LIKE}`)], // after claims (claim_jobs reference them)
  ["wa_contacts", ({ del }) => del("wa_contacts", `display_name=${LIKE}`)], // cascades: wa_conversations, wa_messages, wa_handoffs
  ["crm_accounts", ({ del }) => del("crm_accounts", `name=${LIKE}`)], // cascades: crm_notes, crm_tasks, crm_meetings, crm_attachments, crm_stage_events
  ["leads", ({ del }) => del("leads", "or=(message.like.E2E-*,name.like.E2E-*)")], // contact form, renewal reminders
  ["partner_applications", ({ del }) => del("partner_applications", `company_name=${LIKE}`)],
  ["appointment_requests", ({ del }) => del("appointment_requests", "or=(decision_note.like.E2E-*,proposed_insurer_name.like.E2E-*)")],
  ["rate_tables", ({ del }) => del("rate_tables", `name=${LIKE}`)], // cascades: rate_rows
  ["underwriting_rules", ({ del }) => del("underwriting_rules", `name=${LIKE}`)],
  ["document_templates", ({ del }) => del("document_templates", `name=${LIKE}`)],
  ["quote_discounts", ({ del }) => del("quote_discounts", "or=(label.like.E2E-*,rule_key.like.e2e_*)")],
  ["vehicle_lookups", ({ del }) => del("vehicle_lookups", "registration=like.E2E*")], // "E2E-DBRULES-…" and "E2E 9999-99"
  ["invitations", ({ del }) => del("invitations", "or=(team.like.E2E-*,email.like.e2e-*)")],
  ["ussd_sessions", ({ del }) => del("ussd_sessions", "session_id=like.E2E-*")],
  ["voice_notes", ({ del }) => del("voice_notes", "storage_path=like.*E2E-*")],
  ["translations", ({ del }) => del("translations", "key=like.E2E-*")],
  ["fx_rates", ({ del }) => del("fx_rates", `note=${LIKE}`)],

  // ------------------------------------------------------------------ business accounts (DELETE revoked on the SME tables by design)
  [
    "business accounts",
    async ({ ids, patch, delByIds }) => {
      const schemes = await ids("group_schemes", `name=${LIKE}`);
      if (schemes.length) {
        for (const chunk of chunks(schemes)) {
          await patch("scheme_members", `scheme_id=in.(${chunk.join(",")})&status=neq.removed`, { status: "removed" }, "removed");
          await patch("group_schemes", `id=in.(${chunk.join(",")})&status=neq.cancelled`, { status: "cancelled" }, "cancelled");
        }
      }
      await patch("scheme_members", `full_name=${LIKE}&status=neq.removed`, { status: "removed" }, "removed");
      await patch("fleet_vehicles", "registration=ilike.e2e*&status=neq.removed", { status: "removed" }, "removed"); // registrations are normalised on insert
      // The business organisation itself: offboard it (group_schemes still reference it, so it cannot be deleted);
      // its memberships are removed so it disappears from the demo customer's account switcher.
      const orgs = await ids("organizations", `name=${LIKE}&type=eq.enterprise`);
      if (orgs.length) {
        await delByIds("memberships", "org_id", orgs);
        for (const chunk of chunks(orgs)) await patch("organizations", `id=in.(${chunk.join(",")})&status=neq.offboarded`, { status: "offboarded" }, "offboarded");
      }
    },
  ],

  // ------------------------------------------------------------------ welfare groups (DELETE revoked by design: cancel instead)
  [
    "welfare groups",
    async ({ ids, patch }) => {
      const groups = await ids("welfare_groups", `name=${LIKE}`);
      for (const chunk of chunks(groups)) {
        const inGroups = `group_id=in.(${chunk.join(",")})`;
        await patch("welfare_sponsors", `${inGroups}&status=neq.ended`, { status: "ended" }, "ended");
        await patch("welfare_members", `${inGroups}&status=neq.left`, { status: "left" }, "left");
        await patch("welfare_groups", `id=in.(${chunk.join(",")})&status=neq.cancelled`, { status: "cancelled", invite_enabled: false }, "cancelled");
      }
    },
  ],

  // ------------------------------------------------------------------ privacy requests (DELETE revoked by design: withdraw instead)
  [
    "privacy_requests",
    ({ patch }) => patch("privacy_requests", `note=like.E2E-*&status=${PRIVACY_WITHDRAWABLE}`, { status: "withdrawn" }, "withdrawn"),
  ],
  // Left alone on purpose: audit_events, ledger_entries, reward_ledger, tax_entries (append-only); products tagged
  // E2E-BULK (the suite retires them so history stays auditable); policy_number_blocks E2E-ISSUANCE (deactivated by the
  // suite); loyalty_rule_sets E2E-LOYAL (versioned history; the suite publishes a reset version); consents (a log).
];

/**
 * Runs the whole plan. Never throws part-way: returns `{ counts, failures }` and logs one line per table.
 * `strict` (the CLI) exits non-zero when any step failed so a workflow run shows it.
 */
export async function purgeE2EData({ log = console.log } = {}) {
  if (!hasServiceKey()) {
    log("purge skipped: no SUPABASE_SECRET_KEY");
    return null;
  }
  const ops = makeOps(service(), log);
  for (const [name, run] of PLAN) {
    try {
      await run(ops);
    } catch (err) {
      const msg = `${name}: ${err instanceof Error ? err.message : String(err)}`;
      ops.failures.push(msg);
      log(`  ! ${msg}`);
    }
  }
  const touched = Object.entries(ops.counts).filter(([, n]) => n > 0);
  log(`purged E2E rows: ${touched.length ? touched.map(([t, n]) => `${t}=${n}`).join(", ") : "none"}`);
  if (ops.failures.length) log(`purge: ${ops.failures.length} step${ops.failures.length === 1 ? "" : "s"} failed (see above)`);
  return { counts: ops.counts, failures: ops.failures };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  purgeE2EData()
    .then((result) => {
      if (result?.failures.length) process.exit(1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
