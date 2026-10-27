# Policy explainer

The "Explain my policy" panel on `/account/policies/{id}` answers questions about one policy, using only that policy's
schedule and wording. Every answer cites the clause it comes from. Questions that need advice go to the broker of
record. Addendum 6.3, roadmap Phase 4.

| Piece | Where |
|---|---|
| Pure logic: grounding, clause splitting, classification, prompts, citation checks, hand-off text | `packages/core/src/policy-explainer.ts` (+ `.test.ts`) |
| Request schema | `PolicyExplainInput` in `packages/core/src/api.ts` |
| Server: loading, AI calls, cache, Q&A log, hand-off | `apps/web/src/server/ai/policy-explainer.ts` |
| API | `POST /api/v1/me/policies/{id}/explain` (`apps/web/src/app/api/v1/me/policies/[id]/explain/route.ts`, documented in `docs/api/openapi.yaml`) |
| UI | `components/customer/policy-explainer-section.tsx` (server) and `policy-explainer.tsx` (client) |
| Storage | `supabase/migrations/20261031100200_policy_explainer.sql` |

## Grounding

`loadExplainerContext` reads the policy with the caller's RLS client. The caller must be on the policyholder side: the
customer, the sponsor or the linked beneficiary. Brokers, insurers, staff and business admins get a 404, because they
have the wording itself. After that check, the wording is read with the service client, limited to the ids on that
policy:

- **Schedule** (`policies`): status, product, insurer, broker, cover dates, premium, sum insured, main excess, waiting
  period, and the safe scalar fields of `insured_items` (for example vehicle make or plan level).
- **Terms**: the quote's `coverage`, `limits`, `excesses`, `exclusions`, `key_exclusion`, `optional_benefits` and
  `conditions`, falling back to the product version when there is no quote. `claims_process` comes from the product
  version. This is the same order the policy page uses.
- **Issued documents**: the schedule and certificate, when they have been issued under `policies/<id>/`. Their text is
  re-rendered from the insurer's approved `document_templates`, or from the default template the PDF was built with
  (see `server/pdf.ts` and `server/issuance.ts`). PDFs are not parsed. The full insurer wording PDF
  (`product_versions.wording_url`) is linked, not read.

`buildGrounding` turns all of this into clauses, each with a stable id, a heading, a group and its exact text:

- schedule fields: `schedule.excess`, `schedule.cover_end`, `schedule.insured.vehicle-make`
- terms: `cover.theft`, `limit.third-party-property`, `excess.own-damage`, `exclusion.mechanical-breakdown`,
  `benefit.excess-protector`
- free-text wording: `conditions.4-2` for numbered sections, `conditions.general-exclusions` for headed sections, and
  `conditions.p1` for paragraphs without a heading
- documents: `doc.schedule.*`

The same input always gives the same ids. `versionKey` is a hash of the clauses the model sees, so it changes when the
schedule or the wording changes.

## Citations

The model returns `{ status, statements: [{ text, citations, quote }], needsBroker }`. `validateCitations` then checks
the answer on the server:

- citation ids that aren't in the grounding set are dropped and counted (`dropped_ids` in the log);
- a statement left with no valid citation is removed;
- a `quote` must appear word for word in the cited clause; otherwise the whole clause is shown instead;
- an answer left with no statements becomes `not_in_wording`.

The UI shows each citation as a chip. Opening a chip shows the exact clause text taken from the grounding set, never
text the model wrote. When the wording doesn't answer the question, the panel says so ("we won't guess") and offers
the broker.

## Advice boundary

`classifyQuestion` flags these questions as advisory:

- "should I…"
- "which is better…" and "is it worth…"
- "do I need more cover…"
- "will they pay…"
- "am I covered if I…" when it describes a situation that needs a judgement
- "can I claim…" for a specific incident

The model can also flag a question with `needsBroker`. For advisory questions the explainer gives only the factual part
and offers **Ask your broker**.

The hand-off is a customer message on the existing request thread with the broker of record. It uses an open request
about the policy, or else the request the policy came from: the same thread as "Message your broker". The message
holds the question, the policy reference and the clauses shown. The customer sees a preview before sending, and the
broker is notified (`message.new`). If there is no broker of record or no thread (an external policy, or a sponsor or
beneficiary who isn't the request's customer), the panel explains why and points to the broker's contact details.

Every view shows the disclaimer: "This explains your policy wording. It isn't advice. Your policy documents decide
what's covered." The shared `BASE_INSTRUCTIONS` (role statements, no claim outcomes, no recommendations) come before
the task prompt.

## Without an AI key

`aiFlagOn("ai_assistant")` checks both the flag and the gateway credentials. It is false in local dev and CI without
`AI_GATEWAY_API_KEY`. When it is false:

- the panel still shows the clause browser;
- "Your cover in plain words" lists the key schedule facts, each with its citation (`fallbackSummary`);
- a question returns keyword matches (`searchClauses`, `mode: "clauses_only"`) and the hand-off.

No model is called and nothing crashes. A model error at run time falls back the same way.

## Privacy and safety

- **What reaches the model.** Only the clauses go into the prompt. The customer's name, contact details, Ghana Card,
  registration, chassis and engine numbers, addresses and member lists are never in the grounding set
  (`safeInsuredFields`). Issued documents are re-rendered with "the policyholder" in place of the name. The policy
  number is shown in the clause browser but is never sent to the model (`localOnly`). Questions pass through
  `redactPII`.
- **Prompt injection.** Wording and the question are fenced in `<policy_wording>` and `<question>` and HTML-escaped,
  so they can't close a fence. Tags in free-text wording are stripped. The instructions say that text inside the fences
  is data and must never be obeyed.
- **Metering.** Every model call is logged with `logAiUsage` (`policy_explainer`, `policy_explainer_summary`) in
  `ai_usage`. The route uses `RATE_LIMITS.ai`.

## Storage and retention

- `policy_explainer_summaries` holds one plain-words summary per `(policy_id, wording_hash)`. It is generated once,
  then served from the cache. A new wording version generates a new row.
- `policy_explainer_logs` is the Q&A log for quality review. It holds:
  - the redacted question (at most 500 characters);
  - the classification and the outcome;
  - the answer statements;
  - the cited and dropped ids;
  - whether the question was handed off.

  No prompts or wording are stored.
- **RLS.** The policyholder side and platform staff can read the summaries. Each user can read only their own log
  rows; staff can read all of them. Brokers, insurers and other customers can read neither table. Only the service role
  writes. This was checked on a local Postgres 16 replay of every migration.
- **Retention (to do).** Explainer logs are personal data under Act 843. They must join the data-subject request and
  retention configuration being built separately (proposal: 180 days for logs; summaries are removed with the policy).
  This feature deletes nothing itself.

## Still to do by a person

- Apply `20261031100200_policy_explainer.sql` with the normal migration process. CI doesn't apply it. Until it is
  applied, the panel still works, but questions aren't logged and the summary isn't cached, so it is generated again
  on every view. Apply the migration before switching AI on in production.
- Add the two tables to the retention jobs and the data-subject export/delete when that work lands.
- Review a sample of `policy_explainer_logs`, especially `dropped_ids` and `not_in_wording`, once the feature is live.
