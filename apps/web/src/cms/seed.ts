/**
 * CMS seed — `pnpm --filter @im/web cms:seed` (runs through `payload run`, so `.env` is loaded).
 *
 * 1. Creates the first admin from CMS_ADMIN_EMAIL / CMS_ADMIN_PASSWORD. This is the supported way
 *    to create the first CMS account: /cms and /cms-api stay closed while the users table is
 *    empty (cms/bootstrap.ts), so nobody can register through Payload's public first-user screen.
 *    When a user already exists the seed refuses to run (exit 3) unless CMS_SEED_FORCE=1 is set,
 *    so an unexpected account is noticed rather than silently kept.
 * 2. Imports today's typed marketing content (Learn articles, help-centre FAQs, illustrative
 *    testimonials, payment-method partners) as *published* documents, so the site renders exactly
 *    as before the switch-over.
 *
 * Idempotent: documents are matched by slug / key. Existing FAQ payment answers (what-is, cost,
 * methods) are corrected; all other existing content and FAQ metadata survive a re-run
 * (with CMS_SEED_FORCE=1 once the admin exists). Nothing here talks to the application schema
 * (`public`).
 */
import { getPayload } from "payload";
import { simpleBlocksToLexical } from "@im/core";
import config from "./payload.config";
import { cmsConfigured, cmsDisabledReason } from "./env";
import { ARTICLES } from "../components/marketing/articles";
import { FAQ_GROUPS, HOME_FAQ_IDS, PAYMENT_METHODS, TESTIMONIALS } from "../components/marketing/content";

import { HOME_HERO } from "../components/marketing/home-hero-content";

const PAYMENT_FAQ_IDS = new Set(["what-is", "cost", "methods"]);

const CLAIMS_FAQ_IDS = ["how-claim", "who-decides", "declined"];

async function main() {
  if (!cmsConfigured()) {
    console.error(`CMS seed skipped: ${cmsDisabledReason()}. Set DATABASE_URI and PAYLOAD_SECRET (docs/CMS.md).`);
    process.exit(2);
  }
  const payload = await getPayload({ config });
  const summary: Record<string, { created: number; existing: number }> = {};
  const tally = (k: string, created: boolean) => {
    summary[k] ??= { created: 0, existing: 0 };
    summary[k][created ? "created" : "existing"] += 1;
  };

  // 1. First admin -------------------------------------------------------------------------------
  const { totalDocs: userCount } = await payload.count({ collection: "users" });
  if (userCount > 0 && process.env.CMS_SEED_FORCE?.trim() !== "1") {
    const { docs } = await payload.find({ collection: "users", limit: 5, sort: "createdAt", depth: 0 });
    const who = docs.map((u) => `${u.email} (${u.role})`).join(", ") + (userCount > docs.length ? ", …" : "");
    console.error(
      `CMS seed refused: ${userCount} CMS user${userCount === 1 ? " already exists" : "s already exist"} (${who}). ` +
        "The first admin is only created on an empty users table. If that account is expected and you want to (re)import the typed content, run again with CMS_SEED_FORCE=1; " +
        "if it is not, remove it before seeding (docs/CMS.md §5).",
    );
    process.exit(3);
  }
  if (userCount === 0) {
    const email = process.env.CMS_ADMIN_EMAIL?.trim();
    const password = process.env.CMS_ADMIN_PASSWORD;
    if (!email || !password) {
      console.error("No CMS user exists yet: set CMS_ADMIN_EMAIL and CMS_ADMIN_PASSWORD (12+ characters) to create the first admin.");
      process.exit(2);
    }
    if (password.length < 12) {
      console.error("CMS_ADMIN_PASSWORD must be at least 12 characters.");
      process.exit(2);
    }
    await payload.create({ collection: "users", data: { email, password, name: process.env.CMS_ADMIN_NAME?.trim() || "Covva admin", role: "admin" } });
    tally("users", true);
  } else {
    tally("users", false);
  }

  // 2. Learn articles ----------------------------------------------------------------------------
  for (const a of ARTICLES) {
    const { totalDocs } = await payload.count({ collection: "articles", where: { slug: { equals: a.slug } } });
    if (totalDocs > 0) {
      tally("articles", false);
      continue;
    }
    await payload.create({
      collection: "articles",
      draft: false,
      data: {
        title: a.title,
        slug: a.slug,
        summary: a.summary,
        topic: a.topic,
        author: "Covva",
        readMinutes: a.readMinutes,
        publishedAt: `${a.published}T09:00:00.000Z`,
        body: simpleBlocksToLexical(a.body) as never,
        related: a.related.map((r) => ({ label: r.label, href: r.href })),
        _status: "published",
      },
    });
    tally("articles", true);
  }

  // 3. FAQs ----------------------------------------------------------------------------------------
  for (const g of FAQ_GROUPS) {
    let order = 10;
    for (const it of g.items) {
      const { totalDocs } = await payload.count({ collection: "faqs", where: { key: { equals: it.id } } });
      if (totalDocs === 0) {
        const placements: ("support" | "home" | "claims")[] = ["support"];
        if (HOME_FAQ_IDS.includes(it.id)) placements.push("home");
        if (CLAIMS_FAQ_IDS.includes(it.id)) placements.push("claims");
        await payload.create({
          collection: "faqs",
          draft: false,
          data: { key: it.id, question: it.q, answer: it.a, category: g.id as never, order: HOME_FAQ_IDS.includes(it.id) ? HOME_FAQ_IDS.indexOf(it.id) + 1 : order, placements, _status: "published" },
        });
        tally("faqs", true);
      } else {
        // Correct only these English answers; preserve questions, placements, order and status.
        // The answer predicate makes repeated seeds a no-op once the correction is applied.
        if (PAYMENT_FAQ_IDS.has(it.id)) {
          await payload.update({
            collection: "faqs",
            locale: "en",
            where: { and: [{ key: { equals: it.id } }, { answer: { not_equals: it.a } }] },
            data: { answer: it.a },
          });
        }
        tally("faqs", false);
      }
      order += 10;
    }
  }

  // 4. Testimonials (illustrative, as today) ------------------------------------------------------
  let tOrder = 10;
  for (const t of TESTIMONIALS) {
    const { totalDocs } = await payload.count({ collection: "testimonials", where: { key: { equals: t.id } } });
    if (totalDocs === 0) {
      await payload.create({
        collection: "testimonials",
        draft: false,
        data: { key: t.id, quote: t.quote, name: t.name, context: t.context, illustrative: true, consentOnFile: false, order: tOrder, _status: "published" },
      });
      tally("testimonials", true);
    } else tally("testimonials", false);
    tOrder += 10;
  }

  // 5. Partners: the payment methods shown in the trust bar (no logo files exist in code today; the
  //    insurer / broker strip keeps reading the partner directory until staff add logos here).
  let pOrder = 10;
  for (const m of PAYMENT_METHODS) {
    const { totalDocs } = await payload.count({ collection: "partners", where: { slug: { equals: m.id } } });
    if (totalDocs === 0) {
      await payload.create({
        collection: "partners",
        draft: false,
        data: { name: m.label, slug: m.id, type: "payment", brandColor: m.tone, order: pOrder, showOnSite: true, _status: "published" },
      });
      tally("partners", true);
    } else tally("partners", false);
    pOrder += 10;
  }

  // Home hero: create only. Never replace an editor's page or remove legacy content.
  const { totalDocs: heroPages } = await payload.count({ collection: "pages", where: { slug: { equals: "home-hero" } } });
  if (heroPages === 0) {
    await payload.create({ collection: "pages", draft: false, data: {
      title: "Home hero", slug: "home-hero", layout: [HOME_HERO],
      seo: { noIndex: true }, _status: "published",
    } });
  }
  tally("home-hero", heroPages === 0);

  console.log("CMS seed complete:");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(13)} created ${v.created}, already present ${v.existing}`);
  process.exit(0);
}

// Top-level await: `payload run` exits as soon as the module has evaluated.
try {
  await main();
} catch (err) {
  console.error("CMS seed failed:", err);
  process.exit(1);
}
