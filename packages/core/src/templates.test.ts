import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultTemplate, interpolate, renderTemplate, validateTemplate, type StructuredTemplate } from "./templates.ts";

const ctx = {
  kind: "schedule",
  policy: { policy_number: "CG-2026-000123", cover_start: "2026-11-01", cover_end: "2027-10-31", premium: 1234.5 },
  customer: { full_name: "Ama <Mensah>" },
  insurer: { name: "Coastline General" },
  product: { name: "Motor Comprehensive Plus" },
};

test("interpolate: dotted paths, escaping and unknown placeholders", () => {
  assert.equal(interpolate("Hello {{ customer.full_name }}", ctx), "Hello Ama &lt;Mensah&gt;");
  assert.equal(interpolate("No {{missing.path}} here", ctx), "No  here");
  assert.equal(interpolate("{{policy.premium}}", ctx), "1234.5");
});

test("renderTemplate: structured template → semantic HTML with formatted fields", () => {
  const t: StructuredTemplate = {
    title: "Schedule for {{product.name}}",
    fields: [
      { key: "no", label: "Policy number", path: "policy.policy_number" },
      { key: "prem", label: "Premium", path: "policy.premium", format: "money" },
      { key: "start", label: "Starts", path: "policy.cover_start", format: "date" },
    ],
    blocks: [
      { type: "heading", text: "{{insurer.name}}", level: 2 },
      { type: "paragraph", text: "Insured: {{customer.full_name}}" },
      { type: "fields", fields: ["no", "prem", "start", "unknown"], columns: 3 },
      { type: "table", rows: [{ label: "Product", value: "{{product.name}}" }] },
      { type: "divider" },
      { type: "signature", label: "For Coastline" },
    ],
    footer: "Wording applies.",
  };
  const html = renderTemplate(t, ctx);
  assert.ok(html.startsWith('<article class="doc">'));
  assert.ok(html.includes('<h1 class="doc-title">Schedule for Motor Comprehensive Plus</h1>'));
  assert.ok(html.includes('<h2 class="doc-heading">Coastline General</h2>'));
  assert.ok(html.includes("Insured: Ama &lt;Mensah&gt;"));
  assert.ok(html.includes("<dt>Policy number</dt><dd>CG-2026-000123</dd>"));
  assert.ok(html.includes("<dd>GH₵ 1,234.50</dd>"));
  assert.ok(html.includes("<dd>01 Nov 2026</dd>"));
  assert.ok(!html.includes("unknown"), "unknown field keys are skipped");
  assert.ok(html.includes('<th scope="row">Product</th><td>Motor Comprehensive Plus</td>'));
  assert.ok(html.includes('<hr class="doc-divider" />'));
  assert.ok(html.includes("For Coastline"));
  assert.ok(html.includes('<footer class="doc-footer">Wording applies.</footer>'));
  assert.ok(html.includes("doc-cols-3"));
});

test("renderTemplate: raw HTML templates interpolate too", () => {
  assert.equal(renderTemplate({ html: "<p>{{policy.policy_number}}</p>" }, ctx), "<p>CG-2026-000123</p>");
});

test("validateTemplate: catches structural problems and lists placeholders", () => {
  const ok = validateTemplate(defaultTemplate("certificate"));
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.ok(ok.placeholders.includes("policy.policy_number"));
  for (const kind of ["schedule", "sticker", "receipt"] as const) assert.equal(validateTemplate(defaultTemplate(kind)).ok, true);

  const bad = validateTemplate({
    fields: [{ key: "a", label: "A", path: "x.y" }, { key: "a", label: "", path: "bad path!" }],
    blocks: [{ type: "fields", fields: ["a", "zzz"] }, { type: "paragraph", text: "Hi {{ customer.name" }, { type: "nope" }, { type: "table", rows: [] }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /used twice/.test(e)));
  assert.ok(bad.errors.some((e) => /needs a label/.test(e)));
  assert.ok(bad.errors.some((e) => /data path/.test(e)));
  assert.ok(bad.errors.some((e) => /unknown field "zzz"/.test(e)));
  assert.ok(bad.errors.some((e) => /Unbalanced/.test(e)));
  assert.ok(bad.errors.some((e) => /unknown type/.test(e)));
  assert.ok(bad.errors.some((e) => /has no rows/.test(e)));

  assert.equal(validateTemplate({ blocks: [] }).ok, false);
  assert.equal(validateTemplate("nope").ok, false);
  assert.equal(validateTemplate({ html: "<script>alert(1)</script>" }).ok, false);
  assert.equal(validateTemplate({ html: "<p>{{policy.policy_number}}</p>" }).ok, true);
});
