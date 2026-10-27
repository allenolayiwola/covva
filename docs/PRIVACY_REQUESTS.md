# Data-subject requests and retention (Act 843)

Ghana's Data Protection Act 2012 (Act 843) gives people the right to access their data, have it corrected, have it
deleted where lawful, object to processing and stop direct marketing. This document describes how Covva handles those
requests and how long it keeps data it does not need.

> **Status:** built and tested on a local Postgres. The migration
> `supabase/migrations/20261031100100_data_subject_requests.sql` **has not been applied** to the Supabase project yet;
> apply it with the normal migration process. Until then the customer page, the admin queue and the cron job have no
> tables to read.

## Main files

| Area | Files |
|---|---|
| Database | `supabase/migrations/20261031100100_data_subject_requests.sql` (tables, guard trigger, RPCs, RLS, retention function) |
| Rules (pure) | `packages/core/src/privacy.ts` + `privacy.test.ts` (transitions, due date, retention plan, scope, export shape and redaction) |
| Customer | `apps/web/src/app/(customer)/account/privacy/` (page, form, actions, `[id]/download/route.ts`); linked from the account nav and Profile → Your data |
| Staff | `apps/admin/src/app/(admin)/privacy-requests/` (queue, detail, actions), `apps/admin/src/server/privacy.ts` (export assembly) |
| Cron | `apps/web/src/server/privacy.ts`, job `privacy-retention` in `apps/web/src/server/cron.ts`, schedule in `apps/web/vercel.json` |
| Tests | `packages/core/src/privacy.test.ts` (unit), `apps/web/tests/privacy-rules.test.mjs` (database rules against Supabase; not run by CI) |

## Workflow

| Type | Customer sees | Steps (staff = platform admin, operations or compliance; support is read-only) |
|---|---|---|
| Access / export | "Get a copy of my data" | Submitted → **verify identity** → **generate export** (JSON, private bucket) → customer downloads → closed (or closed automatically when the link expires) |
| Correction | "Correct something that's wrong" (note required) | Submitted → verify identity → approve → staff make the change → **mark as done** with what changed (shown to the customer) → close |
| Deletion | "Delete my account and data" | Submitted → verify identity → approve → **preview** (dry run) → **run the anonymisation** → fulfilled with a retention note → close |
| Objection | "Object to how my data is used" (note required) | Submitted → verify identity → approve → mark as done (what was stopped, or why processing continues) → close |
| Marketing opt-out | "Stop marketing messages" | **Fulfilled immediately**: a `consents` row `marketing = false` is recorded and `profiles.notification_prefs.marketing = false`. No identity check is needed to stop marketing. |

Any pending request can be **refused** with a reason (shown to the customer). Customers can **withdraw** a request until
it is carried out. One open request per type per person; a short abuse limit (10 requests in 30 days) applies to real
accounts.

Statuses: `submitted`, `identity_verified`, `approved`, `export_ready`, `fulfilled`, `refused`, `closed`, `withdrawn`.
Allowed transitions live in `PRIVACY_TRANSITIONS` (`@im/core`) and `private.privacy_transition_allowed` (SQL); a unit test
checks the two tables agree for every type × from × to. The trigger `privacy_requests_guard` enforces them for every
writer, including the service role.

**Due date:** `created_at + platform_settings.privacy_request_due_days` (default **30**, clamped to 1–90). The queue has an
"Overdue" filter. *The statutory response deadline under Act 843 is to be confirmed with counsel* — the customer copy
only states the configured number of days.

**Every action is audited.** `privacy_requests`, `privacy_request_events` and `privacy_retention_runs` have the standard
`write_audit` triggers, so each step lands in the hash-chained `audit_events` with the staff member as actor (RPCs are
called with the staff session, not the service key). The request's own timeline (`privacy_request_events`) has
customer-visible steps and internal staff notes (`visible_to_customer = false`).

### Access: the export

* Built in the admin console (`apps/admin/src/server/privacy.ts`): rows are read with the service client and shaped by
  `buildPrivacyExport()` in `@im/core` — format `covva.personal-data-export` v1, with sections: profile, privacy
  requests, consents, requests, quotes, applications, policies, payments (metadata only), claims and their customer-visible
  timeline, complaints, documents (file details), households, beneficiaries, sponsorships, request and claim messages,
  WhatsApp messages, AI chats, notifications, identity checks (status only), saved cards (brand / last 4), voice-note
  transcripts and needs-assessment answers.
* **Redaction rules** (`redactExportRow`): internal notes (`internal = true`) and staff-only timeline rows are dropped;
  secrets and internals are removed (payment provider tokens and raw events, idempotency keys, consent code hashes,
  share tokens, checksums, hash-chain fields, storage paths, fraud scores, AI extraction); staff / partner user ids are
  removed (the organisation and `*_party` columns say who acted). Payments, documents, identity checks, saved cards,
  notifications and voice notes are exported through an allow-list of columns.
* Stored in the **private** `documents` bucket at `privacy-exports/<user id>/<reference>-<timestamp>.json`. Customers
  cannot sign objects under that prefix; `record_privacy_export()` refuses any other path.
* Downloaded only through the authenticated route `GET /account/privacy/{id}/download`: it checks the session, calls
  `record_privacy_export_download()` **as the customer** (ownership, status and expiry are checked in the database and the
  download is counted on the timeline), then streams the file with `Cache-Control: no-store`. There is no public link.
* Available for `platform_settings.privacy_export_ttl_days` (default 7). The retention job then deletes the file and
  closes the request. Generating a fresh export replaces (and deletes) the previous file.

### Deletion: anonymisation, not row deletion

`public.fulfil_privacy_deletion()` → `private.anonymise_subject()`. Nothing that law or contract requires us to keep is
changed, no row that other records point at is deleted, and the audit chain is never touched. A dry run returns the
same counts without changing anything. After the database step the admin action removes the listed Storage objects,
**soft-deletes the Supabase Auth user** (`auth.admin.deleteUser(id, true)`: the `auth.users` row and therefore every
foreign key stay, sign-in stops) and emails a confirmation to the address captured beforehand. *Check on the first real
deletion that the soft-deleted `auth.users` row no longer shows the email / phone; if it does, clear them in the Auth
dashboard.* If any of these steps fails, the console says so and an internal note is added to the request.

**Erased or scrubbed**

| Table | What happens |
|---|---|
| `profiles` | Email, phone, date of birth, Ghana Card number, region, city, avatar, time zone, preferred name and active workspace cleared; notifications and WhatsApp switched off; `anonymised_at` set. The **name is kept only if insurance records are retained** (it identifies the policyholder on them); otherwise it becomes "Deleted customer". |
| `consents` (marketing, AI help only) | IP address and user agent removed; a final `granted = false` row recorded. |
| `leads` | Enquiries matching the email or phone: name, email, phone, organisation, message, notes, UTM cleared; `metadata.erased_at` set. |
| `ai_threads` | Deleted. `ai_usage` rows are detached (`user_id = null`; costs only). |
| `wa_messages`, `wa_contacts` | Message text and payload erased. The contact is opted out and unlinked; the number stays **only as a suppression entry** so we never message it again. |
| `requests` (drafts), `claims` (drafts) | Unsent drafts: answers erased, draft cancelled / withdrawn. |
| `needs_assessments` | Answers cleared. |
| `notifications`, `device_tokens` | Deleted. |
| `voice_notes` | Notes **not attached to a claim** deleted (audio removed from Storage). |
| `ussd_sessions` | Sessions with the person's id or number deleted. |
| `payment_methods`, `sponsor_subscriptions` | Saved cards revoked and provider tokens removed; recurring sponsor payments cancelled. |
| `quote_shares`, `referral_links` | Share links expired; referral links disabled. |
| `beneficiaries`, `households` | Family members not on any policy, request or sponsorship deleted (their consents and household memberships cascade); household names cleared. |
| `privacy_requests` | Earlier export files deleted. |

**Retained (unchanged)**

| Records | Why |
|---|---|
| Policies, quotes, applications, submitted requests, broker disclosures | Insurance contracts and the advice / placement record, needed by the insurer, the broker and the NIC. |
| Claims, claim events, claim messages, claim-linked voice notes | Claims records; may be needed for later claims or disputes. |
| Payments, payment splits, ledger entries, instalments | Financial and tax records. |
| Documents (schedules, certificates, receipts, evidence) | Issued documents and evidence are part of the insurance record. |
| Request messages, complaints | Correspondence about advice, cover and complaints is part of the regulated record. |
| KYC verifications | Identity checks kept under anti-money-laundering rules. |
| Consents for terms, privacy and data sharing | Evidence of the lawful basis for the records we keep. |
| `audit_events` | Tamper-evident, append-only, hash-chained. While a scrub runs (`app.privacy_scrub = '1'`) `write_audit` records **which** columns changed but not their values, so erasing data never copies it into the log. Rows written before the request keep what they recorded — they cannot be edited without breaking the chain. |
| `privacy_requests` and their events | Evidence the request was honoured (with the counts of what was erased and retained). |

The customer is told what was kept and why: `privacy_requests.retention_note` plus the counts in
`anonymisation_summary.retained` (shown as "Kept: 2 policies, 1 claim, …" on `/account/privacy`).

Brokers and insurers hold their own records of the cover they arranged or issued; the customer copy and the export say
so. Partnership CRM accounts created from **partner** leads are business contacts and are not touched.

## Retention jobs

Cron `GET /api/cron/privacy-retention` (daily 03:50 UTC, `CRON_SECRET` bearer). It:

1. deletes export files whose download window ended and closes their requests (`privacy_request_action(…, 'expire_export')`);
2. computes a plan with `retentionPlan()` (`@im/core`) from `platform_settings.privacy_retention` and calls
   `public.run_privacy_retention(plan, dry_run)`, which applies each data class in its own sub-transaction and logs the
   run (plan, per-class counts, errors) in `privacy_retention_runs`. The cron result is also in
   `platform_settings['cron_last_run:privacy-retention']`.

**Dry run** — counts only, nothing changes — when the URL has `?dry_run=1`, **or** whenever
`privacy_retention.mode` is not `"enforce"`. The migration seeds `{"mode": "dry_run", "periods": {}}`, so the job only
reports until someone deliberately switches it on (after the periods are confirmed). Staff can trigger a dry run from the
admin queue; enforcing is only possible from the scheduled job (service role).

**Idempotent** — erased rows no longer match (markers, emptied fields or deleted rows), so a second run touches nothing.
**Excluded** — rows tagged `E2E-…` and demo accounts (`*.example` emails); they are purged by
`apps/web/tests/purge-e2e-data.mjs`. **Guard** — cutoffs newer than 30 days ago are refused; overrides shorter than 30
days or longer than 10 years are ignored with a warning.

| Data class | Default | Action |
|---|---|---|
| `unconverted_leads` — customer / other / press enquiries never matched to an account, not `qualified` | 730 days | scrub |
| `ai_chat_logs` — AI assistant threads with no activity | 365 days | delete |
| `whatsapp_transcripts` — message text in WhatsApp conversations with no activity (contacts and opt-outs kept) | 365 days | scrub |
| `abandoned_drafts` — quote-request drafts not touched | 180 days | scrub + cancel |
| `anonymous_needs_assessments` — needs checks made without signing in | 180 days | scrub |
| `ussd_sessions` — finished USSD sessions | 90 days | delete |
| `stale_device_tokens` — push tokens of devices not seen | 400 days | delete |

Override per class with `platform_settings.privacy_retention.periods`, e.g.
`{"mode": "enforce", "periods": {"ai_chat_logs": 180}}`. Insurance records (policies, claims, payments, documents,
ledger, audit) have **no** erase rule here: they are kept, and their own retention period still has to be set (below).

## Settings

| Key | Default | Meaning |
|---|---|---|
| `privacy_request_due_days` | `30` | Days to answer a request (1–90). |
| `privacy_export_ttl_days` | `7` | Days an export stays downloadable (1–30). |
| `privacy_retention` | `{"mode": "dry_run", "periods": {}}` | Retention mode and period overrides. |

## Open legal questions (to confirm with counsel)

1. **Statutory response deadline** under Act 843 for access / correction / deletion requests (the 30-day default is a
   working assumption), and whether any extension or fee is allowed.
2. **Retention periods for insurance records** held by Covva as a platform: policies, claims, payments and issued
   documents (insurer / NIC record-keeping rules, Insurance Act 2021 (Act 1061) and NIC guidance), financial and tax
   records, and KYC records under the Anti-Money Laundering Act 2020 (Act 1044). Today they are retained indefinitely;
   a purge rule needs the confirmed durations and the trigger date (policy end, claim closure, last payment).
3. Whether the **name** may stay on retained records after a deletion (current rule: kept only when insurance records
   are retained), and whether Ghana Card numbers in `kyc_verifications` should be masked after a deletion.
4. The default **retention periods** in the table above for leads, chats, drafts and sessions.
5. Whether objections to processing based on contract or legal obligation can be refused, and the wording of refusals.
6. Registration of Covva as a data controller with the Data Protection Commission, and the DPO contact shown to customers.

## Testing

* Unit: `pnpm --filter @im/core test` (`privacy.test.ts`: transitions mirror the SQL table, due dates, retention plan
  and config validation, export shape and redaction, scope catalogue, customer copy).
* Database rules: `apps/web/tests/privacy-rules.test.mjs` runs against the shared Supabase project as each role. It
  never runs a real anonymisation on the shared demo customer (deletion is previewed, then withdrawn) and restores the
  demo customer's marketing consent afterwards. Not run in CI.
* The migration was replayed on a throwaway local Postgres 16 with all earlier migrations and checked per role:
  customers see and create only their own requests; another customer and a broker partner see nothing; staff see
  everything and support cannot act; invalid transitions are refused (also for the service role); the export path is
  pinned to the subject's folder; downloads are counted and expire; marketing opt-out is immediate; the anonymisation
  scrubs the listed fields, keeps the retained records unchanged, writes no erased values into the audit log and
  `verify_audit_chain()` stays ok; the retention job is dry-run-safe, idempotent, logs its runs and leaves E2E / demo /
  recent rows alone.
