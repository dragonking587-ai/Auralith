import type { ImageRect, Region } from "./types";
import { imageNormToCanvas, minSide } from "./coords";

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function boostForLight(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const max = Math.max(r, g, b, 1);
  const sat = 1.25;
  const avg = (r + g + b) / 3;
  let nr = avg + (r - avg) * sat;
  let ng = avg + (g - avg) * sat;
  let nb = avg + (b - avg) * sat;
  const lift = 1.15;
  nr *= lift;
  ng *= lift;
  nb *= lift;
  const peak = Math.max(nr, ng, nb, 1);
  if (peak > 255) {
    const k = 255 / peak;
    nr *= k;
    ng *= k;
    nb *= k;
  }
  return { r: nr, g: ng, b: nb };
}

export function sampleRegionColor(
  ctx: CanvasRenderingContext2D,
  region: Region,
  rect: ImageRect,
): string | null {
  const side = minSide(rect);
  let sx: number;
  let sy: number;
  let rad: number;
  if (region.kind === "stamp") {
    const p = imageNormToCanvas(region.x, region.y, rect);
    sx = p.x;
    sy = p.y;
    rad = region.r * side;
  } else {
    const pts = region.points;
    const mid = pts[Math.floor(pts.length / 2)] ?? pts[0];
    if (!mid) return null;
    const p = imageNormToCanvas(mid.x, mid.y, rect);
    sx = p.x;
    sy = p.y;
    rad = region.width * side * 1.4;
  }
  const s = Math.max(4, Math.min(48, rad * 0.9));
  const x = Math.max(0, Math.floor(sx - s / 2));
  const y = Math.max(0, Math.floor(sy - s / 2));
  const w = Math.min(ctx.canvas.width - x, Math.ceil(s));
  const h = Math.min(ctx.canvas.height - y, Math.ceil(s));
  if (w < 2 || h < 2) return null;
  try {
    const data = ctx.getImageData(x, y, w, h).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] ?? 0;
      if (a < 8) continue;
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
      n++;
    }
    if (n === 0) return null;
    const col = boostForLight(r / n, g / n, b / n);
    return rgbToHex(col.r, col.g, col.b);
  } catch {
    return null;
  }
}

export function matchPhotoColors(
  image: CanvasImageSource,
  imageW: number,
  imageH: number,
  regions: Region[],
): Region[] {
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(640, imageW);
  canvas.height = Math.max(1, Math.round((canvas.width * imageH) / imageW));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return regions;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const rect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  return regions.map((region) => {
    const color = sampleRegionColor(ctx, region, rect);
    return color ? { ...region, color } : region;
  });
}
