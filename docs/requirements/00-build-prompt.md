# Covva build prompt

You are extending Covva, an insurance marketplace for Ghana (web + mobile). Review the existing codebase first, summarise the current architecture, data model and what is already built, then propose a phased implementation plan before writing code. Do not rewrite working parts unnecessarily.

## PRODUCT CONTEXT
- Covva is a technology platform, not an insurer or broker. All policies are placed and fulfilled by NIC-licensed brokers working with licensed insurers. Covva must never hold client funds.
- Customers compare quotes across insurers for all general lines (motor, home, travel, health, life/funeral, business/SME, etc.) and buy through the app.
- Brokers use a back-office dashboard. An order is routed only to brokers who are placed with the insurer the customer picked. The first eligible broker to claim the order fulfils it, and there is a configurable claim time limit with re-routing if it expires. *(Superseded in part by Addendum 2, section D.)*
- Launch partner: one insurer whose full product catalogue is loaded first. The data model must support many insurers, products, rate tables and underwriting rules from day one. UI copy must stay honest when only one insurer is quoting.
- Revenue: Covva fee/commission. Use split payments at checkout (e.g. Paystack or Hubtel subaccounts) so the broker/insurer share goes to them directly and Covva's share is deducted automatically. Also support a reconciliation and settlement report per broker per period.

## CORE MODULES
1. Insurer & product catalogue: insurers, products, packages, features/benefits, exclusions, rate tables, rating factors, underwriting rules, versioning with effective dates. Admin CSV/Excel import for rate tables, and an optional insurer self-service portal later. Pluggable adapters for insurers that expose APIs.
2. Quote engine: rule-based premium calculation per product; side-by-side comparison with clear feature/benefit differences; save and share quotes.
3. Broker dashboard: broker onboarding (NIC licence details, insurer appointments), order queue filtered by eligibility, claim/assign, status workflow, document upload (policy schedule, certificate, sticker), and customer messaging.
4. Admin console: manage insurers, brokers, products, fees, disputes, audit logs and reports.

## PAYMENTS
- Mobile money first: MTN MoMo, Telecel Cash, AirtelTigo Money; plus cards and bank transfer.
- Instalment premiums (monthly/quarterly) with automated collections, retries, grace periods, and lapse/reinstatement handling that follows insurer rules.
- Split settlement so Covva never holds premiums. Store full payment ledgers for reconciliation.

## FAST ONBOARDING
- Ghana Card (NIA) identity verification / KYC.
- Vehicle lookup by registration number (DVLA where available) to prefill motor quotes.
- Target: a motor quote in under 2 minutes.

## CHANNELS
- Responsive web app and mobile app (iOS/Android).
- WhatsApp Business channel: quotes, payment links, renewal reminders, policy documents.
- USSD flow for basic quote, renew and pay on feature phones.

## POLICY WALLET
- Every active policy, certificate and motor sticker in one place.
- QR code per policy that police/third parties can verify against a public verification page.
- Downloadable PDFs, family/household view.

## CLAIMS
- File a claim in-app: incident details, photo/video upload, location, police report upload.
- Claim routed to the fulfilling broker/insurer; status tracking with notifications at every stage; in-claim messaging.

## RENEWALS & RETENTION
- Automated reminders (push, SMS, WhatsApp, email) at configurable intervals before expiry.
- One-tap renewal with refreshed quotes and the option to switch insurer.
- Underinsurance nudges when asset values change (e.g. vehicle value, home contents).

## DIASPORA (PRIORITY — build this out fully)
- Diaspora sponsors (UK, US, EU, Canada, etc.) buy and manage cover for family in Ghana: health, home, motor, funeral/life, travel for visiting relatives, and school/student cover.
- Multi-currency checkout (GBP, USD, EUR, CAD) with card/Apple Pay/Google Pay, with transparent FX conversion to GHS; settlement still flows directly to broker/insurer.
- Sponsor–beneficiary model: a sponsor adds beneficiaries (parents, siblings, children) with consent captured from the beneficiary in Ghana via SMS/WhatsApp OTP.
- Family dashboard: all policies the sponsor pays for, renewal dates, payment schedule, claims status.
- Dual notifications: both sponsor and beneficiary get reminders, documents and claim updates.
- Recurring sponsor payments (monthly subscription for premiums).
- Gift a policy: buy cover as a gift with a personal message.
- Claims by proxy: sponsor can start or follow a claim on behalf of a beneficiary, with beneficiary consent.
- Diaspora bundles: curated packages (e.g. "Parents' Care Pack": health + home + funeral cover).
- Diaspora property cover: insure homes being built or owned in Ghana, with optional inspection/verification by partners and photo updates.
- Group diaspora plans for associations, churches and alumni groups abroad.
- Design for future partner integrations (remittance providers, diaspora banks) via APIs.

## EMBEDDED DISTRIBUTION
- Partner API and embeddable widgets so car dealers, banks/lenders, landlords, ride-hailing fleets and travel agents can offer Covva quotes at point of sale.
- Partner portal with referral tracking and revenue share reporting.
- Referral programme for customers.

## BROKER SCORECARDS
- Track response time, fulfilment time, claim support and customer ratings/reviews. Use scores in order routing priority and show them to customers.

## SME & GROUP
- Business accounts with multiple users: staff group health/life, fleet motor, property, liability.
- Bulk member/vehicle upload, centralised billing, and an admin dashboard for the business.

## DATA & INSIGHTS
- Analytics warehouse for quotes, conversions, pricing, renewals and claims.
- Internal dashboards; later, anonymised insight reports for insurers.

## COMPLIANCE, SECURITY, PRIVACY
- Ghana Data Protection Act (Act 843) compliance: consent capture, data minimisation, retention, data subject requests.
- Clear disclosures: Covva is a technology platform; show the licensed broker and insurer on every quote and policy; show fees transparently.
- Do not use regulated terms (e.g. "broker", "insurer") for Covva itself.
- Role-based access control, audit logging, encryption in transit and at rest, secure document storage, rate limiting, and fraud checks (duplicate claims, identity mismatch).
- Keep a configurable feature-flag system so features can be switched on per regulatory approval.

## NON-FUNCTIONAL
- Multi-tenant broker model, scalable, with an API-first backend.
- Notification service abstraction (push, SMS, WhatsApp, email).
- Payment provider abstraction so providers can be swapped.
- Automated tests for quote calculations, payment splits and routing logic.
- Seed data for the launch insurer.

## DELIVERY
1. Audit the existing code and report back.
2. Propose a phased roadmap (Phase 1: catalogue, quote, broker routing, MoMo + split payments, policy wallet, renewals; Phase 2: claims, diaspora core, WhatsApp; Phase 3: instalments, USSD, embedded partners, SME; Phase 4: scorecards, analytics, advanced diaspora).
3. Flag any assumptions, regulatory dependencies or third-party integrations needing credentials before building them.
4. Implement phase by phase, with tests, and summarise changes after each phase.
