import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeQr, qrMatrix, qrPath, qrSvg } from "./qr.ts";

function finderOk(m: boolean[][], r0: number, c0: number) {
  // 7×7 finder: dark ring, light ring, dark 3×3 centre.
  for (let dr = 0; dr < 7; dr++) {
    for (let dc = 0; dc < 7; dc++) {
      const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      const expected = d !== 2;
      if (m[r0 + dr]![c0 + dc] !== expected) return false;
    }
  }
  return true;
}

test("qrMatrix: version and size follow the payload length", () => {
  const short = qrMatrix("HELLO");
  assert.equal(short.version, 1);
  assert.equal(short.size, 21);
  assert.equal(short.modules.length, 21);
  assert.ok(short.modules.every((row) => row.length === 21));

  const url = qrMatrix("https://covva.com.gh/verify?q=ABCDEFGHJK");
  assert.ok(url.version >= 2 && url.version <= 4, `version ${url.version}`);
  assert.equal(url.size, url.version * 4 + 17);

  const long = qrMatrix("x".repeat(200));
  assert.equal(long.version, 10);
  assert.equal(long.size, 57);
  assert.throws(() => qrMatrix("x".repeat(220)), /too long/);
});

test("qrMatrix: finder patterns sit in three corners and the dark module is set", () => {
  for (const text of ["A", "https://covva.com.gh/verify?q=ABCDEFGHJK", "x".repeat(120)]) {
    const { size, modules } = qrMatrix(text);
    assert.ok(finderOk(modules, 0, 0), "top-left finder");
    assert.ok(finderOk(modules, 0, size - 7), "top-right finder");
    assert.ok(finderOk(modules, size - 7, 0), "bottom-left finder");
    assert.equal(modules[size - 8]![8], true, "dark module");
    // Timing patterns alternate between the finders.
    for (let i = 8; i < size - 8; i++) {
      assert.equal(modules[6]![i], i % 2 === 0);
      assert.equal(modules[i]![6], i % 2 === 0);
    }
  }
});

test("encoder is deterministic and the SVG/path outputs match the matrix", () => {
  const a = qrMatrix("https://covva.com.gh/verify?q=TEST123456");
  const b = qrMatrix("https://covva.com.gh/verify?q=TEST123456");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.modules, qrMatrix("https://covva.com.gh/verify?q=TEST123457").modules);

  const path = qrPath(encodeQr("HELLO"));
  const dark = encodeQr("HELLO").modules.flat().filter(Boolean).length;
  assert.equal(path.split("h1v1h-1z").length - 1, dark, "one rect per dark module");

  const svg = qrSvg("HELLO", { size: 96, quiet: 4, label: "Verify policy" });
  assert.equal(svg, qrSvg("HELLO", { size: 96, quiet: 4, label: "Verify policy" }));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" role="img" aria-label="Verify policy" viewBox="0 0 29 29" width="96" height="96"/);
  assert.match(svg, /translate\(4 4\)/);
  assert.match(qrSvg("HELLO"), /aria-hidden="true"/);
  assert.match(qrSvg("<x>", { label: 'a"b' }), /aria-label="a&quot;b"/);
});
