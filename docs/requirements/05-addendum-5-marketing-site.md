# Addendum 5 — Marketing site

> **CORRECTION TO ADDENDUM 5 – BRAND AND COLOURS**
> - Ignore the "Colour" bullet in the Design Direction section, and any other colour, typeface or brand suggestions in Addendum 5.
> - Covva already has an established brand and colour palette. Use the existing brand colours, logo, typography and brand guidelines found in the current codebase and marketing site (`docs/design/brand/`). Do not introduce new brand colours or fonts.
> - Where Addendum 5 refers to "primary" or "accent" colours (e.g. for CTAs, highlights or badges), map these to the existing brand palette (primary → Covva Teal `#00796E`; accent → Harvest Gold `#D9B36A`, highlights only, never text).
> - All other parts of Addendum 5 still apply: site structure, page content, conversion features, imagery approach, performance, accessibility, technical requirements and launch extras.

## GOAL
The marketing site must sell three audiences at once (customers, diaspora sponsors, and partners: insurers and brokers) and convert visitors into quotes, app downloads and partner registrations. It must feel trustworthy, modern, fast and distinctly Ghanaian, not like a generic template.

## DESIGN DIRECTION
- ~~Colour: blue as the primary brand colour (deep trust blue for headers and CTAs, lighter blues for sections); orange as the accent for highlights, badges and key buttons; white backgrounds; plenty of white space.~~ *(Overridden — see correction above.)*
- ~~Typography: one clean modern sans-serif (e.g. Inter, Manrope or Plus Jakarta Sans); large, confident headlines; short sentences.~~ *(Typeface overridden — Outfit headings / Inter body per brand guide; "large, confident headlines; short sentences" still applies.)*
- Imagery: real Ghanaian people and settings: drivers, families, traders, homes, Accra and Kumasi streets, and diaspora families connecting across countries. Avoid generic stock imagery. Use custom illustrations for "how it works" steps.
- UI style: rounded cards, soft shadows, simple icons, subtle motion (scroll reveals, animated counters). No heavy animation that slows mobile.
- Mobile-first: most Ghanaian visitors will be on phones over mobile data, so pages must be lightweight, fast (target Lighthouse 90+), with compressed images and lazy loading.
- Accessibility: WCAG AA contrast, keyboard navigation, alt text.
- Tone of voice: warm, plain-English, confident and reassuring. Avoid insurance jargon; explain terms simply.

## SITE STRUCTURE
1. Home
- Hero: headline along the lines of "Compare, buy and manage insurance in minutes", with an instant quote widget right in the hero (choose insurance type, e.g. motor, then enter a car registration or a few details, then "Get quotes").
- Trust bar: partner insurer logos, "Licensed partners only", payment logos (MTN MoMo, Telecel Cash, Visa/Mastercard), security badges.
- How it works: three steps (Compare, Pay by MoMo or card, Get your policy instantly).
- Product tiles: motor, home, health, travel, life/funeral, business, micro-insurance.
- Key benefits: instant policies, instalment payments, renewal reminders, in-app claims, digital policy wallet with QR verification.
- Diaspora section: "Protect your family back home", with a CTA to the diaspora page.
- App download section: App Store and Google Play badges plus a QR code.
- Testimonials and ratings (once available), plus a stats counter (policies issued, customers, partners).
- Partner CTA strip: "Are you an insurer or broker? Grow with Covva."
- FAQ preview and footer.

2. Product pages (one per line)
- What it covers, what it doesn't, example prices ("from GHS X/month"), instalment options, an embedded quote form, FAQs, and claims info.
- Motor page: explain third party vs comprehensive simply; sticker and QR verification.

3. Diaspora page (high priority, build out fully)
- Headline along the lines of "Look after your family in Ghana from anywhere".
- Pay in GBP, USD, EUR or CAD; add parents and relatives as beneficiaries; family dashboard; dual notifications; gift a policy; bundles such as the "Parents' Care Pack"; property cover for homes being built; group plans for churches and associations.
- Currency switcher and localised pricing display.
- Stories and use cases (e.g. "Ama in London insures her mum's home in Kumasi").
- Group/association enquiry form.

4. Business/SME page
- Staff group health and life, fleet motor, property and liability; a central dashboard; bulk enrolment; a "Talk to our team" form.

5. Claims page
- How to make a claim step by step, typical timelines, the partner garage and hospital network, and a link to start a claim in the app.

6. Verify a policy page
- Public QR / policy-number lookup so police, landlords or partners can confirm a policy is valid.

7. Partner pages (from Addendum 3)
- For Insurers: benefits (new customers, diaspora reach, lower acquisition cost, instant digital issuance, data insights), integration levels explained simply, commercial model summary, onboarding steps, CTAs "Register as an Insurer" and "Book a meeting".
- For Brokers: benefits (free qualified leads, faster payment, renewals on autopilot, free digital office, works on WhatsApp and mobile), commercial models (revenue share or subscription), onboarding steps, CTAs "Register as a Broker" and "Request a call".
- For Embedded Partners (dealers, banks, landlords, fleets, travel agents): API/widget overview and an enquiry form.

8. Learn / Insurance Guide (content hub)
- Plain-language articles and short videos: "What does comprehensive motor cover?", "How to make a claim", "Insurance for diaspora families", and so on, available in English, Twi, Ga and Ewe.
- SEO-optimised for Ghana-specific searches.

9. About, Trust and Legal
- About Covva and the team; how Covva works (clearly stating Covva is a technology platform, and that policies are provided by licensed insurers and brokers); regulatory status; data protection and privacy (Act 843); terms; complaints process; contact.

## CONVERSION FEATURES
- Quote widget on the homepage and every product page; save a quote and resume later; send quote by WhatsApp or email.
- WhatsApp chat button on every page, plus an AI assistant for FAQs with handoff to a human or broker.
- Callback request forms that feed the partnerships CRM or the customer support queue.
- Renewal reminder sign-up: "Tell us when your current policy expires and we'll remind you with better quotes." This captures leads even before purchase.
- Price comparison teaser: show the range of prices across insurers to demonstrate savings.
- Referral programme page.
- Language switcher (English, Twi, Ga, Ewe) and a currency switcher on diaspora pages.
- Smart app banners on mobile to drive downloads.
- Trust signals everywhere: insurer logos, licensed partner statements, secure payment badges, reviews.

## TECHNICAL
- Build with a modern framework (e.g. Next.js) with server-side rendering/static generation for SEO and speed.
- Headless CMS so the marketing team can edit pages, articles, FAQs, testimonials and partner logos without developers.
- SEO: metadata, schema markup (FAQ, Organisation, Product), sitemap, Open Graph images, local SEO for Ghana.
- Analytics and conversion tracking (GA4 or similar, Meta/TikTok pixels), consent banner compliant with Act 843, A/B testing support.
- Shared design system and component library with the web app so the brand is consistent.

## LAUNCH EXTRAS
- Pre-launch waitlist page with early-access sign-up for customers and an "Become a launch partner" form for insurers and brokers.
- Press/media kit page.
