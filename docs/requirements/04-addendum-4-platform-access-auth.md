# Addendum 4 — Platform access by user type; authentication and roles

## PLATFORM ACCESS BY USER TYPE

1. Customers (individuals, diaspora sponsors, SME/group admins)
- Access: mobile app (iOS/Android) AND web app, with full feature parity, plus the WhatsApp and USSD channels already specified.
- One account works across mobile and web, with data synced in real time.

2. Brokers
- Access: mobile app AND web dashboard.
- Use the SAME mobile app as customers, with role-based login: after sign-in, broker users see a broker workspace instead of the customer experience. A user who is both a broker and a customer can switch between workspaces.
- Broker mobile features: new-order push notifications; view, accept and decline orders; order details; upload documents with the phone camera (policy schedules, certificates, IDs); client messaging; claims updates; renewal list; commission and settlement summary; profile and insurer links.
- Broker web dashboard: everything above, plus bulk client import, reports and statements, team/user management, insurer appointment management, subscription billing and full analytics.
- Keep WhatsApp/SMS alerts with one-tap accept links as a fallback for less technical brokers.

3. Insurers
- Access: web dashboard ONLY. No insurer features in the mobile app.
- All insurer functions (registration, product and rate management, order/issuance queue, broker appointment approvals, claims, SLA monitoring, reports, settlements, user management) live in the web portal.
- The web portal must still be responsive so it is usable on tablets and phones in a browser.
- Insurer users who try to sign in to the mobile app get a clear message directing them to the web portal.

4. Covva internal staff (admins, compliance, ops, partnerships reps)
- Access: web admin console.
- Partnerships reps also get a mobile-friendly web view for field work (as in Addendum 3). No native mobile app is needed for internal staff.

## AUTHENTICATION AND ROLES
- Single identity service across all apps, with role-based access control (customer, broker user roles, insurer user roles, internal roles).
- Enforce MFA for broker, insurer and internal users. Customers get OTP login by phone number, with optional biometrics on mobile.
- Organisation-level accounts for brokers and insurers, with multiple users and roles as defined in Addendum 3.
- Session management, device management and remote sign-out for broker and insurer accounts.
