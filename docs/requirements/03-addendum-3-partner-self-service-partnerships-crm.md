# Addendum 3 — Open self-service registration for insurers and brokers; partnerships team tools

Where this conflicts with earlier documents, this addendum takes precedence. Covva must support open self-service registration for insurers and brokers at launch, alongside an internal partnerships team that onboards them in person.

## A. PUBLIC PARTNER PAGES
- Public "Partner with Covva" pages for insurers and for brokers: benefits, how it works, integration levels, commercial models, FAQs.
- Clear calls to action: "Register as an Insurer", "Register as a Broker", and "Request a call from our partnerships team".
- Callback/demo request form, which creates a lead in the partnerships CRM (section D).

## B. INSURER SELF-SERVICE REGISTRATION AND PRODUCT MANAGEMENT
1. Registration
- Company details, NIC licence number and class (life / non-life), registered address, and primary and compliance contacts.
- Settlement account details (bank / mobile money) for split payments.
- Document uploads: NIC licence, certificate of incorporation, signed partner agreement (e-signature supported).
- Covva admin verification against the NIC register before going live. Track licence expiry and auto-suspend when it lapses.
- Choice of integration level (Portal / Delegated Issuance / API), per product line, as defined in Addendum 2.

2. Multi-user insurer accounts
- Roles: Admin, Product Manager, Underwriter, Claims, Finance, Read-only.
- Invite users, enforce MFA, keep audit logs of every action.

3. Product listing and updates (self-service)
- Create products by line (motor, home, health, travel, life/funeral, SME, etc.): name, description, benefits, exclusions, limits, excesses, add-ons, policy wording PDF.
- Rate table builder: manual entry, or CSV/Excel upload with templates and validation. Rating factors and underwriting rules (e.g. vehicle age, use, value, location) via a rules editor.
- Document templates for the schedule, certificate and sticker.
- Quote preview/simulator so the insurer can test pricing before publishing.
- Versioning with effective dates and scheduled price changes. Existing quotes and policies keep their original version.
- Approval workflow: Draft, Submitted, Covva compliance review, Published. Covva can return a submission with comments.
- Ability to pause or withdraw a product; changes apply to new quotes only.
- Bulk update tools and change history.

4. Broker appointment management
- The insurer sees broker requests to link to them and approves or declines each, per product line.
- The insurer can revoke an appointment, which removes that broker's eligibility for new orders immediately.
- Option to nominate preferred brokers for routing (Addendum 2, D4).

5. Insurer dashboard
- Sales, conversions, policies issued, renewals, lapses, claims, SLA performance, and settlements/statements.

## C. BROKER SELF-SERVICE REGISTRATION
1. Registration
- Company details, NIC licence number, principal officer, contacts, settlement account, and document uploads (NIC licence, incorporation, signed partner agreement via e-signature).
- Covva admin verification against the NIC register; licence expiry tracking and auto-suspend.
- Choice of commercial model: revenue share or subscription (Addendum 2, F).

2. Linking to insurers
- Browse the list of insurers live on Covva and select the insurers and product lines they are appointed with.
- Each link request goes to the insurer for approval in the insurer portal. If the insurer is not yet active on Covva, the broker uploads an appointment letter for Covva admin review.
- Only approved links make the broker eligible for orders for that insurer and line.
- "Suggest an insurer": the broker can nominate an insurer not yet on Covva (and optionally upload its rate tables). This creates a lead for the partnerships team.

3. Multi-user broker accounts
- Roles: Admin, Account Executive, Claims, Finance, Read-only. MFA and audit logs.

4. Onboarding modes
- Self-service for tech-savvy brokers.
- Assisted onboarding for less technical brokers: a partnerships rep can register and set up the account on their behalf, with the broker confirming via OTP or e-signature.

## D. INTERNAL PARTNERSHIPS TEAM (FIELD SALES) TOOLS
- Internal role: Partnerships Rep / Account Manager, plus Partnerships Lead.
- Partnerships CRM inside the admin console: leads and accounts for insurers and brokers; pipeline stages (Lead, Contacted, Meeting, Proposal, Agreement Signed, Onboarding, Live); notes, meetings, tasks and follow-up reminders; file attachments; owner assignment.
- Leads created automatically from the website callback forms and broker "suggest an insurer" requests.
- Assisted onboarding: a rep can create and pre-fill an insurer or broker account, upload product data and rate tables on their behalf, and send an invite for the partner to review, approve and activate.
- Onboarding checklist per partner (documents, verification, agreement, products, test quote, go-live), with progress tracking.
- A mobile-friendly view so reps can work in the field.
- Dashboards: pipeline by stage, time to go-live, partners live, and revenue by partner and by rep.

## E. GOVERNANCE AND COMPLIANCE
- No insurer product or broker goes live without Covva admin verification and a signed partner agreement.
- Full audit trail of registrations, product changes, approvals, and appointment links/revocations.
- Feature flags so self-service registration can be opened or restricted depending on NIC approval status.
- Notifications (email, SMS, WhatsApp) at every onboarding step for partners and the assigned rep.
