import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Inspect content nodes, not TS array syntax or Tailwind arbitrary-value classes.
// The browser acceptance test separately checks the rendered legal documents.
for (const slug of ["terms", "privacy", "cookies", "complaints", "disclosures"]) {
  test(`${slug} legal content uses the launch notice instead of bracket placeholders`, () => {
    const url = new URL(`../../src/app/(site)/(marketing)/legal/${slug}/page.tsx`, import.meta.url);
    const source = ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const content = [];
    function visit(node) {
      if (ts.isJsxText(node) || (ts.isStringLiteral(node) && !ts.isJsxAttribute(node.parent))) {
        content.push(node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.doesNotMatch(content.join("\n"), /\[[^\]]+\]/);
    assert.doesNotMatch(content.join(" "), /(?:within|after|generally|until submitted or|operated by|in writing to|office at|registration number)\s+to be confirmed before launch|to be confirmed before launch\s+(?:working days|days|years)|Act 843\s+to be confirmed/i);
    assert.match(content.join("\n"), /to be confirmed before launch/i);
  });
}
