# Trust visibility and recovery controls

The home partner strip is off unless `HOME_PARTNER_STRIP_ENABLED` is exactly `true`.
Do not enable it until there are real partners. It also requires demo mode to be off
and at least one active organisation with `licence_status=verified`, a verification
timestamp and no `settings.demo=true` marker. Both brokers and insurers qualify.
CMS partner logos must match an eligible organisation slug; a CMS licence number
alone does not establish verification. Missing or unavailable data hides the strip.
No production environment or CMS changes are included in this change.

`feature_flags.legal_review_banner` controls the reusable notice on all five legal
pages. Missing or unavailable flag data defaults to showing the notice. Staff use
the existing admin `/flags` page and its existing write permissions. The migration
adds the flag enabled, without overwriting an existing choice.

Admin recovery starts at `/forgot-password`. Supabase sends its PKCE recovery link
to the current admin origin's `/reset-password`. The link must be opened in the
browser that requested it. The admin reset URL must be configured in the Supabase
Auth redirect allowlist by the deployment owner; no remote configuration is changed
here. A successful change proceeds to `/mfa`; existing MFA and staff membership
checks still guard admin data. Help directs staff to their Covva platform administrator.

Hero quote wording: “Start in minutes — sign in with your phone to see quotes.”
The quote flow allows anonymous answers and requests sign-in before broker selection
and submission. This wording lives in the English catalogue and home hero; the CMS
has no corresponding hero subtitle default or seed.

For local acceptance checks use `apps/web/e2e/trust-ux.spec.js` and
`apps/admin/e2e/password-recovery.spec.js` without auth-setup dependencies, against
local servers with test-only Supabase fixtures. The recovery tests intercept Auth
requests. Run the eligibility unit test with
`node --test apps/web/tests/partner-trust.test.mjs`. Browser tests attach screenshots
at 360, 390 and 1280 pixels to their report.
