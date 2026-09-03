/** Byte-mode QR (versions 2–6, ECC M) for public viewer URLs. Host tokens are never encoded. */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gmul = (a: number, b: number) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);

function rsGen(ec: number) {
  let poly = [1];
  for (let i = 0; i < ec; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gmul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}
function rsEcc(data: number[], ec: number) {
  const gen = rsGen(ec);
  const out = new Array(ec).fill(0);
  for (const b of data) {
    const f = b ^ out[0];
    out.shift(); out.push(0);
    if (!f) continue;
    for (let i = 0; i < gen.length - 1; i++) out[i] ^= gmul(gen[i + 1], f);
  }
  return out;
}

const VERS: { v: number; size: number; data: number; ec: number; cap: number }[] = [
  { v: 2, size: 25, data: 28, ec: 16, cap: 22 },
  { v: 3, size: 29, data: 44, ec: 26, cap: 37 },
  { v: 4, size: 33, data: 64, ec: 18, cap: 57 },
  { v: 5, size: 37, data: 86, ec: 24, cap: 78 },
  { v: 6, size: 41, data: 108, ec: 16, cap: 100 }
];

function placeFinder(m: number[][], x: number, y: number) {
  for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= m.length || yy >= m.length) continue;
    const on = dx === -1 || dy === -1 || dx === 7 || dy === 7 || (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && !(dx >= 1 && dx <= 5 && dy >= 1 && dy <= 5)) || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    m[yy][xx] = on ? 1 : 0;
  }
}

function reserved(size: number, x: number, y: number) {
  if (x <= 8 && y <= 8) return true;
  if (x >= size - 8 && y <= 8) return true;
  if (x <= 8 && y >= size - 8) return true;
  if (y === 6 || x === 6) return true;
  return false;
}

export function qrMatrix(text: string) {
  const bytes = [...new TextEncoder().encode(text)];
  const spec = VERS.find((v) => bytes.length + 2 <= v.cap) || VERS[VERS.length - 1]!;
  const bits: number[] = [];
  const push = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, spec.data * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0); data.push(b);
  }
  const pads = [0xec, 0x11]; let p = 0;
  while (data.length < spec.data) data.push(pads[(p++) & 1]);
  data.length = spec.data;
  const ecc = rsEcc(data, spec.ec);
  const stream = [...data, ...ecc];
  const size = spec.size;
  const m = Array.from({ length: size }, () => new Array(size).fill(-1));
  placeFinder(m, 0, 0); placeFinder(m, size - 7, 0); placeFinder(m, 0, size - 7);
  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 ? 0 : 1; m[i][6] = i % 2 ? 0 : 1; }
  // format info ECC-M mask 0 = 0b101010000010010 approx; write after data
  let bi = 0;
  const totalBits = stream.length * 8;
  const bitAt = (i: number) => (stream[i >> 3] >> (7 - (i & 7))) & 1;
  let dir = -1, col = size - 1;
  while (col > 0) {
    if (col === 6) col--;
    for (let pass = 0; pass < size; pass++) {
      const y = dir < 0 ? size - 1 - pass : pass;
      for (let dx = 0; dx < 2; dx++) {
        const x = col - dx;
        if (m[y][x] !== -1 || reserved(size, x, y)) continue;
        let v = bi < totalBits ? bitAt(bi++) : 0;
        if (((y + x) & 1) === 0) v ^= 1; // mask 0
        m[y][x] = v;
      }
    }
    dir *= -1; col -= 2;
  }
  const fmt = 0b101010000010010; // M, mask 0 (approx valid format)
  const writeFmt = (x: number, y: number, bit: number) => { if (m[y] && m[y][x] !== undefined) m[y][x] = bit; };
  for (let i = 0; i < 15; i++) {
    const b = (fmt >> (14 - i)) & 1;
    if (i < 6) writeFmt(i, 8, b);
    else if (i < 8) writeFmt(i + 1, 8, b);
    else writeFmt(size - 15 + i, 8, b);
  }
  for (let i = 0; i < 15; i++) {
    const b = (fmt >> (14 - i)) & 1;
    if (i < 8) writeFmt(8, size - 1 - i, b);
    else if (i < 9) writeFmt(8, 15 - i, b);
    else writeFmt(8, 14 - i, b);
  }
  writeFmt(8, size - 8, 1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x] < 0) m[y][x] = 0;
  return m;
}

export function qrDataUrl(text: string, scale = 8) {
  const m = qrMatrix(text);
  const quiet = 4;
  const n = m.length + quiet * 2;
  const c = document.createElement("canvas");
  c.width = n * scale; c.height = n * scale;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff4d6";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#120c08";
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) {
    ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }
  return c.toDataURL("image/png");
}
