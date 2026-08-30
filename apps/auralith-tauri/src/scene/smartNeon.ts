export type Point = { x: number; y: number };

export type LetterTrace = {
  id: string;
  contour: Point[];
  holes: Point[][];
  centerline: Point[];
  x: number; y: number; w: number; h: number;
};

export type WordCandidate = {
  id: string;
  label: string;
  confidence: number;
  letters: LetterTrace[];
  x: number; y: number; w: number; h: number;
};

export type DetectOpts = {
  sensitivity: number;
  minLetter: number;
  merge: number;
};

function grayAt(data: Uint8ClampedArray, i: number) {
  return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
}

function adaptiveInk(lum: Float32Array, w: number, h: number, sensitivity: number) {
  const win = 15;
  const k = 0.28 - sensitivity * 0.12;
  const ink = new Uint8Array(w * h);
  const mean = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -win; dy <= win; dy += 3) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -win; dx <= win; dx += 3) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          s += lum[yy * w + xx]!;
          n++;
        }
      }
      mean[y * w + x] = s / n;
    }
  }
  for (let i = 0; i < w * h; i++) {
    const local = mean[i]!;
    const l = lum[i]!;
    const contrast = Math.abs(l - local);
    if (contrast < 0.08 + (1 - sensitivity) * 0.06) continue;
    const darkInk = l < local * (1 - k);
    const brightInk = l > local + 0.18 && contrast > 0.16;
    if (darkInk || brightInk) ink[i] = 1;
  }
  return ink;
}

function components(mask: Uint8Array, w: number, h: number, minPix: number) {
  const seen = new Uint8Array(w * h);
  const out: { cells: number[]; x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const s = y * w + x;
      if (!mask[s] || seen[s]) continue;
      stack.push(s); seen[s] = 1;
      const cells: number[] = [];
      let x0 = x, y0 = y, x1 = x, y1 = y;
      while (stack.length) {
        const i = stack.pop()!;
        cells.push(i);
        const px = i % w, py = (i / w) | 0;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy;
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      if (cells.length < minPix) continue;
      out.push({ cells, x0, y0, x1, y1 });
    }
  }
  return out;
}

function edgeDensity(mask: Uint8Array, w: number, cc: { cells: number[] }) {
  let e = 0;
  for (const i of cc.cells) {
    if (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) e++;
  }
  return e / Math.max(1, cc.cells.length);
}

function contour(w: number, x0: number, y0: number, x1: number, y1: number, cells: Set<number>) {
  let sx = -1, sy = -1;
  outer: for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (cells.has(i) && (!cells.has(i - 1) || x === x0)) { sx = x; sy = y; break outer; }
    }
  }
  if (sx < 0) return [] as Point[];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts: Point[] = [];
  let x = sx, y = sy, dir = 0;
  for (let step = 0; step < 4000; step++) {
    pts.push({ x, y });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (dir + 6 + k) % 8;
      const nx = x + dirs[nd]![0]!, ny = y + dirs[nd]![1]!;
      if (cells.has(ny * w + nx)) { x = nx; y = ny; dir = nd; found = true; break; }
    }
    if (!found) break;
    if (x === sx && y === sy && pts.length > 8) break;
  }
  const simp: Point[] = [];
  for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 80))) simp.push(pts[i]!);
  return simp;
}

function holes(w: number, cc: { cells: number[]; x0: number; y0: number; x1: number; y1: number }) {
  const cell = new Set(cc.cells);
  const seen = new Set<number>();
  const res: Point[][] = [];
  for (let y = cc.y0 + 1; y < cc.y1; y++) {
    for (let x = cc.x0 + 1; x < cc.x1; x++) {
      const i = y * w + x;
      if (cell.has(i) || seen.has(i)) continue;
      const stack = [i];
      seen.add(i);
      const blob: number[] = [];
      let touch = false;
      while (stack.length) {
        const j = stack.pop()!;
        blob.push(j);
        const px = j % w, py = (j / w) | 0;
        if (px <= cc.x0 || py <= cc.y0 || px >= cc.x1 || py >= cc.y1) touch = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy;
          if (nx < cc.x0 || ny < cc.y0 || nx > cc.x1 || ny > cc.y1) continue;
          const k = ny * w + nx;
          if (cell.has(k) || seen.has(k)) continue;
          seen.add(k);
          stack.push(k);
        }
      }
      if (touch || blob.length < 8) continue;
      const hs = new Set(blob);
      let hx0 = 1e9, hy0 = 1e9, hx1 = 0, hy1 = 0;
      for (const j of blob) {
        const px = j % w, py = (j / w) | 0;
        if (px < hx0) hx0 = px; if (px > hx1) hx1 = px;
        if (py < hy0) hy0 = py; if (py > hy1) hy1 = py;
      }
      const c = contour(w, hx0, hy0, hx1, hy1, hs);
      if (c.length > 6) res.push(c);
    }
  }
  return res;
}

function centerline(contourPts: Point[]) {
  if (contourPts.length < 4) return contourPts.slice();
  const out: Point[] = [];
  const n = contourPts.length;
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 24))) {
    const a = contourPts[i]!;
    const b = contourPts[(i + Math.floor(n / 2)) % n]!;
    out.push({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
  }
  return out;
}

export async function detectWordTraces(
  img: HTMLImageElement,
  sceneW: number,
  sceneH: number,
  opts: DetectOpts
): Promise<WordCandidate[]> {
  const maxW = 480;
  const scale = Math.min(1, maxW / Math.max(img.naturalWidth, 1));
  const w = Math.max(24, Math.floor(img.naturalWidth * scale));
  const h = Math.max(24, Math.floor(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = grayAt(data, i * 4);
  const ink = adaptiveInk(lum, w, h, opts.sensitivity);
  const ccs = components(ink, w, h, Math.max(8, opts.minLetter * 4));
  const lettersRaw = ccs.filter((cc) => {
    const bw = cc.x1 - cc.x0 + 1, bh = cc.y1 - cc.y0 + 1;
    const fill = cc.cells.length / Math.max(1, bw * bh);
    const ar = bw / Math.max(1, bh);
    const ed = edgeDensity(ink, w, cc);
    if (bw > w * 0.85 && bh > h * 0.5) return false;
    if (fill > 0.92) return false;
    if (ed < 0.12) return false;
    if (bh < opts.minLetter) return false;
    if (ar > 4.5 && bh < h * 0.08) return false;
    if (ar < 0.12) return false;
    return true;
  });
  lettersRaw.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  const groups: typeof lettersRaw[] = [];
  for (const L of lettersRaw) {
    const last = groups[groups.length - 1];
    if (!last) { groups.push([L]); continue; }
    const ref = last[last.length - 1]!;
    const hRef = ref.y1 - ref.y0 + 1;
    const gap = L.x0 - ref.x1;
    const sameRow = Math.abs(((L.y0 + L.y1) / 2) - ((ref.y0 + ref.y1) / 2)) < hRef * 0.65;
    const close = gap < Math.max(4, hRef * (0.45 + opts.merge));
    if (sameRow && close && gap > -hRef * 0.2) last.push(L);
    else groups.push([L]);
  }
  const sx = sceneW / w, sy = sceneH / h;
  return groups.slice(0, 16).map((g, gi) => {
    const letters: LetterTrace[] = g.map((cc, li) => {
      const cell = new Set(cc.cells);
      const ctr = contour(w, cc.x0, cc.y0, cc.x1, cc.y1, cell).map((p) => ({ x: p.x * sx, y: p.y * sy }));
      const hs = holes(w, cc).map((hpts) => hpts.map((p) => ({ x: p.x * sx, y: p.y * sy })));
      return {
        id: `L${gi}-${li}`,
        contour: ctr,
        holes: hs,
        centerline: centerline(ctr),
        x: ((cc.x0 + cc.x1) * 0.5) * sx,
        y: ((cc.y0 + cc.y1) * 0.5) * sy,
        w: (cc.x1 - cc.x0 + 1) * sx,
        h: (cc.y1 - cc.y0 + 1) * sy
      };
    });
    const x0 = Math.min(...g.map((c) => c.x0)), y0 = Math.min(...g.map((c) => c.y0));
    const x1 = Math.max(...g.map((c) => c.x1)), y1 = Math.max(...g.map((c) => c.y1));
    return {
      id: "word-" + gi + "-" + Date.now().toString(36),
      label: letters.length >= 2 ? `Detected Text ${gi + 1}` : `Detected Letter ${gi + 1}`,
      confidence: Math.max(0.5, Math.min(0.93, 0.55 + letters.length * 0.04)),
      letters,
      x: ((x0 + x1) * 0.5) * sx,
      y: ((y0 + y1) * 0.5) * sy,
      w: (x1 - x0 + 1) * sx,
      h: (y1 - y0 + 1) * sy
    };
  });
}

export function rasterizeWordMask(word: WordCandidate, sceneW: number, sceneH: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(64, Math.min(1024, Math.round(sceneW / 2)));
  c.height = Math.max(64, Math.min(1024, Math.round(sceneH / 2)));
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  const sx = c.width / sceneW, sy = c.height / sceneH;
  ctx.fillStyle = "#fff";
  for (const L of word.letters) {
    if (L.contour.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(L.contour[0]!.x * sx, L.contour[0]!.y * sy);
    for (const p of L.contour) ctx.lineTo(p.x * sx, p.y * sy);
    ctx.closePath();
    for (const hole of L.holes) {
      if (hole.length < 3) continue;
      ctx.moveTo(hole[0]!.x * sx, hole[0]!.y * sy);
      for (const p of hole) ctx.lineTo(p.x * sx, p.y * sy);
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  return c;
}
