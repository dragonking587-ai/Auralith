export type NeonCandidate = {
  id: string;
  label: string;
  type: "Text" | "Glow" | "Glyph";
  confidence: number;
  x: number; y: number; w: number; h: number;
};

export type DetectOpts = {
  sensitivity: number;
  glow: number;
  brightness: number;
  minSize: number;
  merge: number;
};

export async function detectNeonCandidates(
  img: HTMLImageElement,
  sceneW: number,
  sceneH: number,
  opts: DetectOpts
): Promise<NeonCandidate[]> {
  const maxSide = 320;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(16, Math.floor(img.naturalWidth * scale));
  const h = Math.max(16, Math.floor(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    lum[i] = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
  }
  const thr = 0.35 + (1 - opts.brightness) * 0.35;
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = lum[i]!;
      const neigh = (lum[i - 1]! + lum[i + 1]! + lum[i - w]! + lum[i + w]!) * 0.25;
      const glow = Math.max(0, l - neigh);
      const edge = Math.abs(lum[i + 1]! - lum[i - 1]!) + Math.abs(lum[i + w]! - lum[i - w]!);
      if (l > thr * (1.15 - opts.sensitivity * 0.4) || glow > 0.08 * opts.glow || (l > 0.45 && edge > 0.35)) {
        mask[i] = 1;
      }
    }
  }
  const seen = new Uint8Array(w * h);
  const blobs: { x0: number; y0: number; x1: number; y1: number; n: number; glow: number }[] = [];
  const stack: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const s = y * w + x;
      if (!mask[s] || seen[s]) continue;
      stack.push(s);
      seen[s] = 1;
      let x0 = x, y0 = y, x1 = x, y1 = y, n = 0, g = 0;
      while (stack.length) {
        const i = stack.pop()!;
        const px = i % w, py = (i / w) | 0;
        n++;
        g += lum[i]!;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
          const nx = px + dx, ny = py + dy;
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (n < opts.minSize * 8) continue;
      if (bw < 4 || bh < 4) continue;
      blobs.push({ x0, y0, x1, y1, n, glow: g / n });
    }
  }
  blobs.sort((a, b) => b.n - a.n);
  const merged: typeof blobs = [];
  const used = new Set<number>();
  const mergePx = 6 + opts.merge * 18;
  for (let i = 0; i < blobs.length; i++) {
    if (used.has(i)) continue;
    let cur = { ...blobs[i]! };
    used.add(i);
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < blobs.length; j++) {
        if (used.has(j)) continue;
        const o = blobs[j]!;
        const gapX = Math.max(0, Math.max(cur.x0, o.x0) > Math.min(cur.x1, o.x1) ? Math.max(cur.x0, o.x0) - Math.min(cur.x1, o.x1) : 0);
        const gapY = Math.max(0, Math.max(cur.y0, o.y0) > Math.min(cur.y1, o.y1) ? Math.max(cur.y0, o.y0) - Math.min(cur.y1, o.y1) : 0);
        if (gapX < mergePx && gapY < mergePx * 0.7) {
          used.add(j);
          cur = {
            x0: Math.min(cur.x0, o.x0), y0: Math.min(cur.y0, o.y0),
            x1: Math.max(cur.x1, o.x1), y1: Math.max(cur.y1, o.y1),
            n: cur.n + o.n, glow: (cur.glow * cur.n + o.glow * o.n) / (cur.n + o.n)
          };
          grew = true;
        }
      }
    }
    merged.push(cur);
  }
  const sx = sceneW / w, sy = sceneH / h;
  return merged.slice(0, 12).map((b, i) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const aspect = bw / Math.max(1, bh);
    const type: NeonCandidate["type"] = b.glow > 0.72 ? "Glow" : aspect > 2.2 ? "Text" : "Glyph";
    const confidence = Math.max(0.45, Math.min(0.96, 0.5 + b.glow * 0.35 + Math.min(0.15, b.n / 4000)));
    return {
      id: "neon-" + i + "-" + Date.now().toString(36),
      label: type === "Text" ? "Unknown Sign Text" : type === "Glow" ? "Glowing Sign" : "Unknown Sign Shape",
      type,
      confidence,
      x: ((b.x0 + b.x1) * 0.5) * sx,
      y: ((b.y0 + b.y1) * 0.5) * sy,
      w: bw * sx,
      h: bh * sy
    };
  });
}
