import { clamp } from "./id.ts";

export type DetectMode = "strict" | "balanced" | "sensitive";

export const DETECT_MODES: DetectMode[] = ["strict", "balanced", "sensitive"];

export const DETECT_MODE_LABEL: Record<DetectMode, string> = {
  strict: "Strict",
  balanced: "Balanced",
  sensitive: "Sensitive",
};

export interface DetectedLight {
  x: number;
  y: number;
  r: number;
  color: string;
  confidence: number;
  strength: number;
}

const MODE: Record<DetectMode, { thresh: number; minArea: number; maxFrac: number; merge: number; cap: number }> = {
  strict: { thresh: 0.58, minArea: 8, maxFrac: 0.1, merge: 1.35, cap: 12 },
  balanced: { thresh: 0.46, minArea: 5, maxFrac: 0.14, merge: 1.2, cap: 18 },
  sensitive: { thresh: 0.34, minArea: 3, maxFrac: 0.18, merge: 1.05, cap: 24 },
};

function lum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function sat(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  if (mx < 0.02) return 0;
  return (mx - mn) / mx;
}

function boxMean(integral: Float64Array, w: number, h: number, x: number, y: number, rad: number): number {
  const x0 = Math.max(0, x - rad);
  const y0 = Math.max(0, y - rad);
  const x1 = Math.min(w - 1, x + rad);
  const y1 = Math.min(h - 1, y + rad);
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  const A = y0 > 0 && x0 > 0 ? integral[(y0 - 1) * w + (x0 - 1)]! : 0;
  const B = y0 > 0 ? integral[(y0 - 1) * w + x1]! : 0;
  const C = x0 > 0 ? integral[y1 * w + (x0 - 1)]! : 0;
  const D = integral[y1 * w + x1]!;
  return (D - B - C + A) / Math.max(1, area);
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

interface Blob {
  x: number;
  y: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  score: number;
  yMean: number;
  contrast: number;
  r: number;
  g: number;
  b: number;
}

/** Detect likely lamps/windows from RGBA pixels. Coordinates are 0–1 in image space. */
export function detectLights(data: Uint8ClampedArray, width: number, height: number, mode: DetectMode = "balanced"): DetectedLight[] {
  if (width < 8 || height < 8 || data.length < width * height * 4) return [];
  const cfg = MODE[mode] ?? MODE.balanced;
  const n = width * height;
  const Y = new Float32Array(n);
  const S = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    Y[i] = lum(data[o]!, data[o + 1]!, data[o + 2]!);
    S[i] = sat(data[o]!, data[o + 1]!, data[o + 2]!);
  }
  const integ = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += Y[y * width + x]!;
      integ[y * width + x] = row + (y > 0 ? integ[(y - 1) * width + x]! : 0);
    }
  }

  const mask = new Uint8Array(n);
  const scores = new Float32Array(n);
  const contrastA = new Float32Array(n);
  let globalY = 0;
  for (let i = 0; i < n; i++) globalY += Y[i]!;
  globalY /= n;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const yi = Y[i]!;
      if (yi < 0.26) continue;
      const surround = boxMean(integ, width, height, x, y, 8);
      const local = boxMean(integ, width, height, x, y, 2);
      const contrast = yi - surround;
      contrastA[i] = contrast;
      if (contrast < 0.035) continue;
      if (yi < globalY + 0.08 && contrast < 0.08) continue;
      const sc =
        clamp(yi * 1.05, 0, 1) * 0.32 +
        clamp(contrast * 2.4, 0, 1) * 0.46 +
        clamp(S[i]! * 0.9, 0, 1) * 0.12 +
        (yi > surround + 0.14 ? 0.1 : 0);
      scores[i] = sc;
      if (sc >= cfg.thresh) mask[i] = 1;
    }
  }

  const blobs: Blob[] = [];
  const seen = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);

  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const si = sy * width + sx;
      if (!mask[si] || seen[si]) continue;
      let qh = 0;
      let qt = 0;
      qx[qt] = sx;
      qy[qt] = sy;
      qt++;
      seen[si] = 1;
      let area = 0;
      let sxSum = 0;
      let sySum = 0;
      let scSum = 0;
      let ySum = 0;
      let cSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let minX = sx;
      let maxX = sx;
      let minY = sy;
      let maxY = sy;
      while (qh < qt) {
        const x = qx[qh]!;
        const y = qy[qh]!;
        qh++;
        const i = y * width + x;
        area++;
        sxSum += x;
        sySum += y;
        scSum += scores[i]!;
        ySum += Y[i]!;
        cSum += contrastA[i]!;
        const o = i * 4;
        rSum += data[o]!;
        gSum += data[o + 1]!;
        bSum += data[o + 2]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const neigh = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          qx[qt] = nx;
          qy[qt] = ny;
          qt++;
        }
      }
      if (area < cfg.minArea) continue;
      if (area > cfg.maxFrac * n) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw / width > 0.85 && bh / height > 0.25) continue;
      if (bh / height > 0.85 && bw / width > 0.25) continue;
      const fill = area / Math.max(1, bw * bh);
      if (fill < 0.18 && area > 40) continue;
      blobs.push({
        x: sxSum / area,
        y: sySum / area,
        minX,
        minY,
        maxX,
        maxY,
        area,
        score: scSum / area,
        yMean: ySum / area,
        contrast: cSum / area,
        r: rSum / area,
        g: gSum / area,
        b: bSum / area,
      });
    }
  }

  blobs.sort((a, b) => b.score - a.score);
  const merged: Blob[] = [];
  const used = new Uint8Array(blobs.length);
  for (let i = 0; i < blobs.length; i++) {
    if (used[i]) continue;
    const a = blobs[i]!;
    let ax = a.x * a.area;
    let ay = a.y * a.area;
    let area = a.area;
    let score = a.score * a.area;
    let yMean = a.yMean * a.area;
    let contrast = a.contrast * a.area;
    let r = a.r * a.area;
    let g = a.g * a.area;
    let b = a.b * a.area;
    let minX = a.minX;
    let minY = a.minY;
    let maxX = a.maxX;
    let maxY = a.maxY;
    used[i] = 1;
    const ra = Math.hypot(a.maxX - a.minX, a.maxY - a.minY) * 0.5;
    for (let j = i + 1; j < blobs.length; j++) {
      if (used[j]) continue;
      const c = blobs[j]!;
      const rb = Math.hypot(c.maxX - c.minX, c.maxY - c.minY) * 0.5;
      const d = Math.hypot(ax / area - c.x, ay / area - c.y);
      if (d > (ra + rb) * cfg.merge + 1.5) continue;
      used[j] = 1;
      ax += c.x * c.area;
      ay += c.y * c.area;
      area += c.area;
      score += c.score * c.area;
      yMean += c.yMean * c.area;
      contrast += c.contrast * c.area;
      r += c.r * c.area;
      g += c.g * c.area;
      b += c.b * c.area;
      if (c.minX < minX) minX = c.minX;
      if (c.minY < minY) minY = c.minY;
      if (c.maxX > maxX) maxX = c.maxX;
      if (c.maxY > maxY) maxY = c.maxY;
    }
    merged.push({
      x: ax / area,
      y: ay / area,
      minX,
      minY,
      maxX,
      maxY,
      area,
      score: score / area,
      yMean: yMean / area,
      contrast: contrast / area,
      r: r / area,
      g: g / area,
      b: b / area,
    });
  }

  const out: DetectedLight[] = [];
  merged.sort((a, b) => b.score - a.score);
  for (const blob of merged) {
    if (out.length >= cfg.cap) break;
    const bw = blob.maxX - blob.minX + 1;
    const bh = blob.maxY - blob.minY + 1;
    const rx = (Math.max(bw, bh) * 0.55) / Math.min(width, height);
    const r = clamp(rx * 1.15, 0.012, 0.16);
    const compactness = blob.area / Math.max(1, bw * bh);
    const confidence = clamp(
      (blob.score - cfg.thresh) / Math.max(0.08, 1 - cfg.thresh) * 0.55 + clamp(blob.contrast * 2, 0, 1) * 0.28 + compactness * 0.17,
      0.05,
      0.99,
    );
    const strength = clamp(0.28 + blob.yMean * 0.42 + clamp(blob.contrast, 0, 0.5) * 0.5, 0.25, 0.95);
    out.push({
      x: blob.x / (width - 1),
      y: blob.y / (height - 1),
      r,
      color: toHex(blob.r, blob.g, blob.b),
      confidence,
      strength,
    });
  }
  return out;
}

const ANALYSIS_MAX = 280;

export function analyzeImage(image: CanvasImageSource & { width?: number; naturalWidth?: number; naturalHeight?: number; height?: number }, mode: DetectMode = "balanced"): DetectedLight[] {
  const srcW = (image as HTMLImageElement).naturalWidth || (image as HTMLImageElement).width || 0;
  const srcH = (image as HTMLImageElement).naturalHeight || (image as HTMLImageElement).height || 0;
  if (srcW < 8 || srcH < 8) return [];
  const scale = Math.min(1, ANALYSIS_MAX / Math.max(srcW, srcH));
  const w = Math.max(32, Math.round(srcW * scale));
  const h = Math.max(32, Math.round(srcH * scale));
  const canvas =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!canvas) return [];
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) return [];
  ctx.drawImage(image as CanvasImageSource, 0, 0, w, h);
  const pix = ctx.getImageData(0, 0, w, h);
  return detectLights(pix.data, w, h, mode);
}
