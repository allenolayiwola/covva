/**
 * Tiny dependency-free QR encoder (byte mode, error-correction level M, versions 1–10).
 * Enough for short URLs such as the app-download link. Returns a boolean module matrix that
 * `QrCode` renders as inline SVG. Algorithm follows ISO/IEC 18004 (mask selection by the
 * standard penalty rules); verified against a reference encoder in development.
 */

const EC_LEVEL_M_BITS = 0b00;

/** Per version (index = version): [ecCodewordsPerBlock, [blocks, dataCodewordsPerBlock][]] for level M. */
const BLOCKS: Record<number, [number, [number, number][]]> = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};

function dataCapacityBytes(version: number): number {
  const [, groups] = BLOCKS[version]!;
  return groups.reduce((s, [n, k]) => s + n * k, 0);
}

function sizeOf(version: number) {
  return version * 4 + 17;
}

/* ---------------------------------------------------------------- GF(256) / Reed–Solomon */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, gen: Uint8Array): Uint8Array {
  const res = new Uint8Array(gen.length - 1);
  for (const b of data) {
    const factor = b ^ res[0]!;
    res.copyWithin(0, 1);
    res[res.length - 1] = 0;
    for (let i = 0; i < res.length; i++) res[i] ^= gfMul(gen[i + 1]!, factor);
  }
  return res;
}

/* ---------------------------------------------------------------- bit stream */
class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

function encodeData(text: string): { version: number; codewords: Uint8Array } {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 10) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCapacityBytes(version) * 8) break;
    version++;
  }
  if (version > 10) throw new Error("QR payload too long for this encoder (max 213 bytes).");

  const buf = new BitBuffer();
  buf.push(0b0100, 4);
  buf.push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) buf.push(b, 8);
  const capacity = dataCapacityBytes(version) * 8;
  buf.push(0, Math.min(4, capacity - buf.bits.length));
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);
  for (let pad = 0xec; buf.bits.length < capacity; pad ^= 0xec ^ 0x11) buf.push(pad, 8);

  const data = new Uint8Array(capacity / 8);
  for (let i = 0; i < buf.bits.length; i++) data[i >>> 3] = data[i >>> 3]! | (buf.bits[i]! << (7 - (i & 7)));

  // Split into blocks, compute EC, interleave.
  const [ecLen, groups] = BLOCKS[version]!;
  const gen = rsGenerator(ecLen);
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let offset = 0;
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      const slice = data.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: slice, ec: rsRemainder(slice, gen) });
    }
  }
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  const out: number[] = [];
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]!);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]!);
  return { version, codewords: Uint8Array.from(out) };
}

/* ---------------------------------------------------------------- matrix */
export interface QrMatrix {
  size: number;
  /** modules[row][col] — true = dark */
  modules: boolean[][];
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = sizeOf(version);
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function buildMatrix(version: number, codewords: Uint8Array, forcedMask?: number): QrMatrix {
  const size = sizeOf(version);
  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const set = (r: number, c: number, dark: boolean) => {
    modules[r]![c] = dark;
    isFunction[r]![c] = true;
  };

  // Finder patterns + separators
  const finder = (r0: number, c0: number) => {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const d = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(3, size - 4);
  finder(size - 4, 3);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      const r0 = align[i]!;
      const c0 = align[j]!;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r0 + dr, c0 + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }

  // Reserve format info areas (values written later) and the dark module.
  const formatCells: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      formatCells.push([8, i], [i, 8]);
    }
  }
  for (let i = 0; i < 8; i++) formatCells.push([size - 1 - i, 8], [8, size - 8 + i]);
  for (const [r, c] of formatCells) set(r, c, false);
  set(size - 8, 8, true);

  // Version info (v ≥ 7)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(b, a, bit);
      set(a, b, bit);
    }
  }

  // Data placement (zigzag)
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunction[r]![c] && bitIndex < totalBits) {
          modules[r]![c] = ((codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!isFunction[r]![c] && maskBit(mask, r, c)) modules[r]![c] = !modules[r]![c];
  };

  const writeFormat = (mask: number) => {
    const data = (EC_LEVEL_M_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
    set(7, 8, bit(6));
    set(8, 8, bit(7));
    set(8, 7, bit(8));
    for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i));
    set(size - 8, 8, true);
  };

  const penalty = () => {
    let score = 0;
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    const countPatterns = (h: number[]) => {
      const n = h[1]!;
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0]! >= n * 4 && h[6]! >= n ? 1 : 0) + (core && h[6]! >= n * 4 && h[0]! >= n ? 1 : 0);
    };
    const addHistory = (len: number, h: number[]) => {
      if (h[0] === 0) len += size;
      h.pop();
      h.unshift(len);
    };
    const terminate = (color: boolean, len: number, h: number[]) => {
      if (color) {
        addHistory(len, h);
        len = 0;
      }
      len += size;
      addHistory(len, h);
      return countPatterns(h);
    };
    const line = (get: (i: number) => boolean) => {
      let runColor = false;
      let run = 0;
      const h = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < size; i++) {
        const v = get(i);
        if (v === runColor) {
          run++;
          if (run === 5) score += N1;
          else if (run > 5) score++;
        } else {
          addHistory(run, h);
          if (!runColor) score += countPatterns(h) * N3;
          runColor = v;
          run = 1;
        }
      }
      score += terminate(runColor, run, h) * N3;
    };
    for (let r = 0; r < size; r++) line((i) => modules[r]![i]!);
    for (let c = 0; c < size; c++) line((i) => modules[i]![c]!);
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = modules[r]![c];
      if (v === modules[r]![c + 1] && v === modules[r + 1]![c] && v === modules[r + 1]![c + 1]) score += N2;
    }
    let dark = 0;
    for (const row of modules) for (const v of row) if (v) dark++;
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * N4;
    return score;
  };

  let best = forcedMask ?? -1;
  if (best < 0) {
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      writeFormat(m);
      const s = penalty();
      applyMask(m);
      if (s < bestScore) {
        bestScore = s;
        best = m;
      }
    }
  }
  applyMask(best);
  writeFormat(best);
  return { size, modules };
}

/** Encode text into a QR module matrix. */
export function encodeQr(text: string, forcedMask?: number): QrMatrix {
  const { version, codewords } = encodeData(text);
  return buildMatrix(version, codewords, forcedMask);
}

/** SVG path data (one rect per dark module, merged into a single path) for the matrix. */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) if (matrix.modules[r]![c]) parts.push(`M${c} ${r}h1v1h-1z`);
  }
  return parts.join("");
}
