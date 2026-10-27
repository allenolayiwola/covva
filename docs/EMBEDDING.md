# Embedding Covva — widget and partner API

For **distribution partners**: car dealers, banks and lenders, landlords and property managers, fleets and
ride-hailing operators, travel agents, remittance providers and employers who want to offer insurance quotes at
their point of sale (roadmap Phase 3, build prompt "Embedded distribution").

Covva is a technology platform — not an insurer or broker — and never holds client money. A distribution partner
**introduces** customers. It does not advise on cover, bind policies or collect premiums. Customers always continue
on Covva, where a licensed broker of record and the insurer handle advice, the binding quote, payment (straight to
the insurer) and the policy.

## 1. Getting set up

1. Covva partnerships creates your **distribution partner** profile (admin → *Distribution partners*): segment,
   categories you may quote, revenue share (a % of **Covva's platform fee**, never of the premium) and status.
   Your organisation is of type `distributor`; Covva issues your first referral code (the **widget code**).
2. Your team signs in to the partner workspace (`/partner`) and sees a reduced menu: **Dashboard** (referrals,
   conversions, revenue share), **Widget**, **Links**, **API keys**, **Statements**, **Team settings**.
3. On **Widget**, owners/admins set the **allowed domains** and **brand colour** (checked against WCAG AA: white text
   needs ≥ 4.5:1 contrast) and copy the snippet. On **Links** they create campaign links (QR codes, emails, showroom
   posters). On **Team settings → Developer** they create API keys with `distribution:*` scopes and webhooks.

## 2. The widget

```html
<script src="https://covva.com.gh/embed/widget.js" data-partner="ABCD2345" data-category="motor" async></script>
```

| Attribute | Meaning |
|---|---|
| `data-partner` | Your widget code (required). Any of your enabled codes works; conversions are attributed to it. |
| `data-category` | Default cover type slug: `motor`, `travel`, `home`, `health`, `life-funeral`, `personal-accident`, `sme-property`, … (only categories enabled for you are offered). |
| `data-target` | Optional CSS selector of an element to mount into (default: right after the script tag). |
| `data-max-width` | Optional, pixels (default 480). |

`widget.js` (vanilla JS, ~2.5 KB, no dependencies) injects a responsive `<iframe src="https://covva.com.gh/embed/quote?partner=…&category=…">`
with `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"`.

**Sizing.** The page inside the iframe posts `{ type: "covva:embed:height", height }` to the parent whenever its height
changes; `widget.js` accepts the message only when `event.origin` is the Covva origin the script was loaded from **and**
`event.source` is that iframe, and clamps the height to 120–4000 px. The message carries no other data. If you build
your own iframe, apply the same two checks.

**Flow.** Cover type → 3–5 rating questions from the category's risk schema (e.g. motor: cover type, vehicle value,
use, year, driver age) → indicative annual estimates from every participating insurer, **sorted by price only** →
**Continue on Covva**, which opens `https://covva.com.gh/get-started?category=…&ref=CODE&src=widget` in a new tab.
The customer signs up or signs in there. **No personal data is collected and nothing is ever paid inside the iframe.**

**Not available.** An unknown, disabled or inactive code renders a friendly "Quotes aren't available here right now"
card with a link to covva.com.gh.

## 3. Allowed domains and CSP

The site normally sends `X-Frame-Options: DENY`. `/embed/*` is exempt (`next.config.ts`) and instead gets
`Content-Security-Policy: frame-ancestors 'self' <your domains>` from `src/proxy.ts`, using the `widget_domains` of
the partner that owns the code (looked up with the public `embed_partner(code)` RPC, cached per server instance for
five minutes). With no domains, only Covva itself can frame the widget (the live preview in your workspace).

Domains are origins: `https://shop.example.com`, `https://*.bank.example` (wildcard sub-domains), or
`http://localhost:3000` for local testing. At most 20.

## 4. Partner API (build your own UI)

Base URL `https://covva.com.gh/api/v1`, header `x-api-key: imk_<prefix>_<secret>`. Distributor keys can only call
`/distribution/*`; every other endpoint answers `403`. Responses use the usual envelope `{ ok, data | error }`.

### `POST /distribution/quotes` — scope `distribution:quote`

```bash
curl -s https://covva.com.gh/api/v1/distribution/quotes \
  -H "x-api-key: $COVVA_KEY" -H "content-type: application/json" \
  -d '{ "categorySlug": "motor", "risk": { "cover_type": "comprehensive", "vehicle_value": 120000, "use": "private", "vehicle_year": 2019, "driver_age": 35 } }'
```

Returns `{ category, estimates: [{ insurerName, productName, premium }], range, insurersCompared, fields, continueUrl, disclosure, note }`.
Estimates are indicative and never binding; nothing is stored. Show them sorted as returned (price only) with the
`disclosure` and `note`, and send the customer to `continueUrl`.

### `POST /distribution/leads` — scope `distribution:lead`

Hand a customer over **with their consent** (they agreed to be contacted by Covva about this cover):

```json
{
  "categorySlug": "motor",
  "customer": { "name": "Ama Mensah", "phone": "+233241234567" },
  "risk": { "vehicle_value": 120000 },
  "consent": { "contact": true, "capturedAt": "2026-10-27T10:15:00Z", "method": "in_person" },
  "externalRef": "DEAL-1043",
  "sendLink": "sms"
}
```

Creates a lead and an attribution (`source: api`) and texts/emails the customer a link to continue on Covva
(`/get-started?…&ref=CODE&src=api&lead=<id>`). When they create their request, the attribution is completed. Returns
`201 { leadId, attributionId, code, continueUrl, sent }`.

### `GET /distribution/referrals?from=YYYY-MM-DD&to=YYYY-MM-DD` — scope `distribution:read`

Your attributions, conversions and revenue share. Customer details are limited to the **first name and a masked
phone** (`+233*******67`) — produced by the `partner_referral_report` database function; partners never read customer
profiles.

### Webhooks

Subscribe to `referral.converted` (the referred customer's policy is active) and `referral.rewarded` (revenue share
accrued after the holding period). See `docs/WEBHOOKS.md` for signing and retries.

## 5. Attribution, conversion and revenue share

* `?ref=CODE` on **any** page sets the first-party `covva_ref` cookie for 30 days (first touch wins; a partner-API
  continue link replaces an older touch). The next request the customer creates gets one `referral_attributions` row.
* When the insurer issues the policy, the attribution is marked converted and `referral.converted` is sent.
* The daily `referral-rewards` job (04:00) posts to the append-only `reward_ledger` once the policy has stayed active
  for the holding period (14 days by default): `revenue_share_pct` × Covva's net `platform_fee` ledger entries for
  that policy. **Never a share of the premium.** Cancelled cover earns nothing. Statements are under *Statements*.

## 6. Disclosure requirements

Every embedded surface — the widget, your own UI built on the API, emails and SMS you send — must show:

> Technology provided by Covva. Insurance provided by licensed insurers and brokers.

You must not describe yourself as the insurer or broker, recommend a product, re-order or filter the estimates by
anything other than price, or take payment for cover. Paid placements never influence comparison order.

## 7. Data handling

* The widget collects only rating facts (vehicle value, trip length…), no names or contact details, and stores nothing.
* Leads you send carry the customer's name and phone/email plus your consent record (`consent.capturedAt`, `method`),
  stored in `leads.metadata` for audit. Only send customers who agreed to be contacted.
* Partner reports expose first name + masked phone only. Covva processes personal data under the Data Protection Act,
  2012 (Act 843) as described in the privacy notice.
* API keys are stored hashed (sha256); a key is shown once at creation. Revoke compromised keys in *API keys*.

## 8. Customer referrals (for reference)

Customers have their own link at `/account/referrals` (and `GET/POST /api/v1/me/referrals`). The seeded
`customer_referral` rule (GHS 20 to the referrer and GHS 20 to the friend after the friend's first policy has been active
for 14 days) is **off by default**: inducements to buy insurance need the National Insurance Commission's position and
each insurer's written approval before it is switched on (admin → *Referrals & rewards*). Credits are not cash; they
only reduce Covva's platform fees, or a future premium where the insurer funds the discount.
