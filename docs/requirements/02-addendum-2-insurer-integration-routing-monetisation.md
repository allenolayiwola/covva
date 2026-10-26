# Addendum 2 — Insurer integration, catalogue ownership, broker onboarding, routing, broker experience, monetisation, transparency

Where this conflicts with the original prompt (for example, "orders routed to brokers only"), this addendum takes precedence.

## A. INSURER INTEGRATION — THREE LEVELS
Build all three integration levels. Store each insurer's level per product line, and allow an insurer to move between levels over time without code changes.

**Level 1 – Insurer Portal (manual)**
- Insurer staff log in to an insurer dashboard.
- Paid orders appear in a queue; staff review, approve or decline, and upload the policy schedule, certificate and sticker.
- The customer receives the documents in the app automatically.

**Level 2 – Delegated Issuance (instant)**
- For products that fit agreed underwriting rules, Covva issues the policy instantly on the insurer's behalf.
- Use policy-number blocks or sequences allocated by the insurer, with document templates approved by the insurer.
- The insurer sees all issued policies in real time and can audit, endorse or cancel within a configurable review window.
- Support registration of motor policies/stickers on the NIC motor insurance database (or a hand-off to the insurer to do so), with status tracking.
- Quotes that fall outside the rules are referred to Level 1 review automatically.

**Level 3 – API Integration**
- Adapter framework to connect to an insurer's core system for quoting, issuance, endorsements, renewals and claims.
- One adapter per insurer, built behind a common interface.

**Customer expectation and SLA guardrails (all levels)**
- Each product shows its issuance type before payment: "Instant" or "Issued within X hours".
- SLA timers per insurer and product. Escalate to insurer contacts, then Covva ops, when breached.
- If the final SLA is breached, the customer can choose an automatic refund or a reroute to an alternative insurer or broker.
- Customers never see an open-ended "processing" state; always show the stage and the expected time.

## B. PRODUCT CATALOGUE OWNERSHIP
- There is one shared catalogue. Products belong to insurers, never to brokers.
- Covva (or the insurer, via the insurer portal) loads products, rate tables, underwriting rules and document templates, with versioning and effective dates.
- Brokers can submit rate tables for an insurer not yet on Covva. These stay "pending" until the insurer confirms and Covva activates them.

## C. BROKER ONBOARDING
1. Registration: company details, NIC licence number, principal officer, contact details, and settlement account (bank or mobile money).
2. Verification: Covva admins verify the NIC licence against the NIC register; store licence expiry and auto-suspend on expiry.
3. Insurer appointments: the broker selects the insurers and product lines they are appointed for. Appointments must be verified, either by uploading an appointment letter (admin-reviewed) or by the insurer approving it in the insurer portal.
4. Only verified appointments make a broker eligible to receive orders for that insurer and line.
5. Brokers can bring their existing clients and policies onto Covva (bulk import and assisted onboarding).

## D. ORDER ROUTING RULES
Implement a configurable routing engine:
1. If the selected insurer is connected directly (Level 2 or 3, or Level 1 sales direct), the order goes to the insurer. No broker is involved.
2. If the insurer is available only through brokers, the order goes to brokers with a verified appointment for that insurer and line. The first broker to accept claims it, with a configurable acceptance timeout and re-routing on expiry. Broker scorecards can influence routing priority.
3. If the customer requests advice ("talk to an expert") or the risk is complex (e.g. fleets above a threshold, commercial property, marine, large SME/group schemes), route to a broker regardless of insurer.
4. Insurer-nominated broker option: an insurer can choose to have all its Covva sales routed through one or more brokers it nominates.
5. Clients a broker brings onto the platform stay assigned to that broker for renewals and servicing.
6. Log every routing decision for audit.

## E. BROKER EXPERIENCE (TECH-SAVVY AND OLD-SCHOOL)
- Full web dashboard and API access for tech-savvy brokers.
- Lightweight mode for less technical brokers: new-order alerts by WhatsApp and SMS with a one-tap accept link; simple mobile view; no training needed for the core flow.
- "Assisted service" flag: Covva ops can do the paperwork for a broker (document uploads, data entry) on request.
- Account-manager assignment per broker; assisted onboarding, including loading the broker's existing client list.
- Broker-facing renewal dashboard showing upcoming renewals and lapse risk, and the renewals Covva has recovered for them.

## F. BROKER MONETISATION AND SETTLEMENT
Support both models, selectable per broker:
1. Revenue share: Covva takes a configurable percentage of the broker's commission on leads Covva generated, deducted automatically at checkout via split payment.
2. Subscription: a monthly fee for back-office tools covering the broker's own book (clients not sourced from Covva); no revenue share on self-sourced clients.
- Distinguish "Covva-sourced" from "broker-sourced" clients for every policy.
- For direct insurer sales, Covva's fee or commission comes from the insurer, via split payment where possible or periodic settlement otherwise.
- Statements and reconciliation reports per broker and insurer per period; invoice generation for subscriptions.

## G. TRANSPARENCY
- On every quote and policy, show the insurer and, where applicable, the broker handling it.
- Show the issuance type and expected time before payment.
- Clear complaints and escalation contacts for insurer, broker and Covva.
