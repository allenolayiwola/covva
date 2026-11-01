/** Run against a locally built server with test data:
 * SEO_TEST_BASE_URL=http://localhost:3100 NEXT_PUBLIC_SITE_URL=https://example.test node tests/seo-rendered.mjs
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const base = process.env.SEO_TEST_BASE_URL;
const origin = process.env.NEXT_PUBLIC_SITE_URL;
assert(base && origin, 'Set SEO_TEST_BASE_URL and NEXT_PUBLIC_SITE_URL');
const decode = s => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const attr = (tag, key) => decode(tag.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? '');
const get = async path => { const r = await fetch(new URL(path, base), { headers: { 'user-agent': 'Googlebot' } }); assert.equal(r.status, 200, path); return r; };
const types = new Set(['Organization', 'ContactPoint', 'Country', 'Service', 'BreadcrumbList', 'ListItem', 'FAQPage', 'Question', 'Answer', 'CollectionPage', 'Article', 'WebPage', 'WebSite', 'Person', 'ImageObject']);
let blocks = 0;
function validate(node) {
  if (!node || typeof node !== 'object') return;
  if (node['@type']) assert(types.has(node['@type']), `Unexpected schema type ${node['@type']}`);
  if (node['@type'] === 'FAQPage') {
    assert(node.mainEntity.length > 0);
    for (const q of node.mainEntity) { assert.equal(q['@type'], 'Question'); assert(q.name); assert.equal(q.acceptedAnswer['@type'], 'Answer'); assert(q.acceptedAnswer.text); }
  }
  if (node['@type'] === 'BreadcrumbList') node.itemListElement.forEach((item, i) => { assert.equal(item.position, i + 1); assert(item.name); if (item.item) assert(item.item.startsWith(origin)); });
  if (node.name === 'Covva') assert.equal(node['@type'], 'Organization');
  for (const child of Object.values(node)) if (typeof child === 'object') validate(child);
}
const xml = await (await get('/sitemap.xml')).text();
const sitemapPaths = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(([, url]) => { assert(url.startsWith(origin), url); return new URL(url).pathname; });
assert(!xml.includes('covva.com.gh'));
const robots = await (await get('/robots.txt')).text();
assert(robots.includes(`${origin}/sitemap.xml`)); assert(!robots.includes('covva.com.gh'));
const marketing = new URL('../src/app/(site)/(marketing)/', import.meta.url);
const staticPaths = (await readdir(marketing, { recursive: true })).filter(p => /(^|\/)page.tsx$/.test(p) && !p.includes('[')).map(p => '/' + p.replace(/(^|\/)page.tsx$/, ''));
const paths = [...new Set([...staticPaths, ...sitemapPaths])];
const titles = new Map(), descriptions = new Map(), imageUrls = new Set();
const failures = [];
for (const path of paths) {
  try {
    const response = await get(path);
    // Redirect aliases (for example /quote) use their destination's metadata.
    if (new URL(response.url).pathname !== path) continue;
    const html = await response.text();
    const title = decode(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? '');
    const metas = [...html.matchAll(/<meta\b[^>]*>/g)].map(m => m[0]);
    const description = attr(metas.find(m => attr(m, 'name') === 'description') ?? '', 'content');
    assert(title && description, `${path}: title and description required`);
    assert(!titles.has(title), `${path}: title duplicates ${titles.get(title)}`); titles.set(title, path);
    assert(!descriptions.has(description), `${path}: description duplicates ${descriptions.get(description)}`); descriptions.set(description, path);
    assert.equal((title.match(/Covva/g) ?? []).length, 1, `${path}: one brand suffix`);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${path}: one h1`);
    const canonical = [...html.matchAll(/<link\b[^>]*>/g)].map(m => m[0]).find(m => attr(m, 'rel') === 'canonical');
    assert.equal(new URL(attr(canonical ?? '', 'href')).href, new URL(path, origin).href, `${path}: canonical`);
    for (const meta of metas.filter(m => attr(m, 'property') === 'og:image')) { const url = attr(meta, 'content'); assert(url.startsWith(origin + '/'), `${path}: absolute OG image ${url}`); imageUrls.add(url); }
    assert(metas.some(m => attr(m, 'property') === 'og:image'), `${path}: OG image required`);
    assert(!/https?:\/\/covva\.com\.gh/.test(html), `${path}: stale website origin`);
    const visibleText = decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' '));
    for (const [, payload] of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(payload); blocks++; assert.equal(data['@context'], 'https://schema.org'); validate(data);
      if (data['@type'] === 'FAQPage') for (const q of data.mainEntity) { assert(visibleText.includes(decode(q.name)), `${path}: FAQ question must render`); assert(visibleText.includes(decode(q.acceptedAnswer.text)), `${path}: FAQ answer must render`); }
    }
    console.log(`PASS ${path}`);
  } catch (error) { failures.push(`${path}: ${error.message}`); }
}

for (const url of imageUrls) {
  const u = new URL(url); const r = await get(u.pathname + u.search);
  assert.match(r.headers.get('content-type'), /^image\/png/);
  const bytes = new Uint8Array(await r.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 8)], [137,80,78,71,13,10,26,10]);
}
assert.deepEqual(failures, [], "Rendered SEO failures");
assert(blocks > paths.length, 'Organization and page structured data were parsed');
// Every cover must have a generated card even when absent from a test catalogue.
const products = await readFile(new URL('../src/components/marketing/products-content.ts', import.meta.url), 'utf8');
for (const [, slug] of products.matchAll(/^    slug: "([^"]+)"/gm)) { const r = await get(`/insurance/${slug}/opengraph-image`); assert.match(r.headers.get('content-type'), /^image\/png/); }
console.log(`PASS: ${titles.size} pages, ${blocks} JSON-LD blocks, ${imageUrls.size} OG images`);
