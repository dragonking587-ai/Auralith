import type { FitMode, ImageRect, Point } from "./types.ts";

export function computeImageRect(
  imageW: number,
  imageH: number,
  canvasW: number,
  canvasH: number,
  fit: FitMode,
  panX: number,
  panY: number,
): ImageRect {
  if (imageW <= 0 || imageH <= 0 || canvasW <= 0 || canvasH <= 0) {
    return { x: 0, y: 0, w: canvasW, h: canvasH };
  }
  if (fit === "stretch") {
    return { x: 0, y: 0, w: canvasW, h: canvasH };
  }
  const scale =
    fit === "fill"
      ? Math.max(canvasW / imageW, canvasH / imageH)
      : Math.min(canvasW / imageW, canvasH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  const x = (canvasW - w) * panX;
  const y = (canvasH - h) * panY;
  return { x, y, w, h };
}

/** Integer destination so the source photograph cannot subpixel-crawl between frames. */
export function snapRect(rect: ImageRect): ImageRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.max(1, Math.round(rect.w)),
    h: Math.max(1, Math.round(rect.h)),
  };
}

export function imageNormToCanvas(nx: number, ny: number, rect: ImageRect): Point {
  return { x: rect.x + nx * rect.w, y: rect.y + ny * rect.h };
}

export function canvasToImageNorm(cx: number, cy: number, rect: ImageRect): Point | null {
  if (rect.w === 0 || rect.h === 0) return null;
  const x = (cx - rect.x) / rect.w;
  const y = (cy - rect.y) / rect.h;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  return { x, y };
}

export function canvasToImageNormUnclamped(cx: number, cy: number, rect: ImageRect): Point {
  return {
    x: rect.w === 0 ? 0 : (cx - rect.x) / rect.w,
    y: rect.h === 0 ? 0 : (cy - rect.y) / rect.h,
  };
}

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) return dist(p, a);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export function minSide(rect: ImageRect): number {
  return Math.min(rect.w, rect.h);
}
