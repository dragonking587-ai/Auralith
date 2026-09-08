import type { Region } from "./types";

type Pt = { x: number; y: number };

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy || 1e-8;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function pointInPoly(px: number, py: number, pts: Pt[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    const hit = ((a.y > py) !== (b.y > py)) &&
      (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-8) + a.x);
    if (hit) inside = !inside;
  }
  return inside;
}

function rotatePoint(x: number, y: number, cx: number, cy: number, deg: number): Pt {
  if (!deg) return { x: cx + x, y: cy + y };
  const a = deg * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return { x: cx + x * c - y * s, y: cy + x * s + y * c };
}

function ellipse(cx: number, cy: number, rx: number, ry: number, deg: number, n = 64): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    pts.push(rotatePoint(Math.cos(a) * rx, Math.sin(a) * ry, cx, cy, deg));
  }
  return pts;
}

function polygon(cx: number, cy: number, rx: number, ry: number, deg: number, sides: number): Pt[] {
  const n = Math.max(3, Math.min(24, Math.round(sides)));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i / n * Math.PI * 2;
    pts.push(rotatePoint(Math.cos(a) * rx, Math.sin(a) * ry, cx, cy, deg));
  }
  return pts;
}

function roundedRect(cx: number, cy: number, w: number, h: number, radius: number, deg: number): Pt[] {
  const hw = w / 2, hh = h / 2;
  const r = Math.max(0, Math.min(radius, hw, hh));
  if (r < 1) {
    return [
      rotatePoint(-hw, -hh, cx, cy, deg), rotatePoint(hw, -hh, cx, cy, deg),
      rotatePoint(hw, hh, cx, cy, deg), rotatePoint(-hw, hh, cx, cy, deg),
    ];
  }
  const pts: Pt[] = [];
  const corners = [
    { x: hw - r, y: hh - r, a0: 0 },
    { x: -hw + r, y: hh - r, a0: Math.PI / 2 },
    { x: -hw + r, y: -hh + r, a0: Math.PI },
    { x: hw - r, y: -hh + r, a0: Math.PI * 1.5 },
  ];
  for (const c of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = c.a0 + i / 6 * Math.PI / 2;
      pts.push(rotatePoint(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, cx, cy, deg));
    }
  }
  return pts;
}

function contours(r: Region): { outer: Pt[]; inner?: Pt[] } {
  const w = Math.max(8, r.width || r.radius * 2 || 160);
  const h = Math.max(8, r.height || r.radius * 2 || 160);
  const hw = w / 2, hh = h / 2;
  const rot = Number(r.rotation || 0);
  const shape = r.shape || "rect";

  if (shape === "circle") {
    const rr = Math.min(hw, hh);
    return { outer: ellipse(r.x, r.y, rr, rr, rot) };
  }
  if (shape === "ellipse") return { outer: ellipse(r.x, r.y, hw, hh, rot) };
  if (shape === "roundrect") return { outer: roundedRect(r.x, r.y, w, h, Number(r.cornerRadius ?? Math.min(w, h) * 0.16), rot) };
  if (shape === "triangle") return { outer: polygon(r.x, r.y, hw, hh, rot, 3) };
  if (shape === "diamond") {
    const local: Pt[] = [{ x: 0, y: -hh }, { x: hw, y: 0 }, { x: 0, y: hh }, { x: -hw, y: 0 }];
    return { outer: local.map((p) => rotatePoint(p.x, p.y, r.x, r.y, rot)) };
  }
  if (shape === "polygon") return { outer: polygon(r.x, r.y, hw, hh, rot, Number(r.sides ?? 6)) };
  if (shape === "ring") {
    const outer = ellipse(r.x, r.y, hw, hh, rot);
    const maxInner = Math.max(2, Math.min(hw, hh) - 2);
    const innerR = Math.max(2, Math.min(maxInner, Number(r.innerRadius ?? maxInner * 0.55)));
    const ratio = hh / Math.max(hw, 1);
    return { outer, inner: ellipse(r.x, r.y, innerR, Math.max(2, innerR * ratio), rot) };
  }
  if (shape === "line") {
    const thick = Math.max(4, Math.min(h, 120));
    return { outer: roundedRect(r.x, r.y, w, thick, Math.min(thick / 2, Number(r.cornerRadius ?? thick / 2)), rot) };
  }
  return { outer: roundedRect(r.x, r.y, w, h, 0, rot) };
}

function contourMeta(pts: Pt[]) {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    lens.push(len); total += len;
  }
  return { lens, total: Math.max(total, 1e-8) };
}

function contourDistanceAlong(px: number, py: number, pts: Pt[], meta: ReturnType<typeof contourMeta>) {
  let best = Number.POSITIVE_INFINITY, along = 0, acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const vx = b.x - a.x, vy = b.y - a.y;
    const l2 = vx * vx + vy * vy || 1e-8;
    const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / l2));
    const qx = a.x + vx * t, qy = a.y + vy * t;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best) { best = d; along = (acc + t * meta.lens[i]!) / meta.total; }
    acc += meta.lens[i]!;
  }
  return { distance: best, along };
}

export function buildShapeField(region: Region, sceneW: number, sceneH: number, res = 256) {
  const data = new Uint8Array(res * res * 4);
  const { outer, inner } = contours(region);
  const outerMeta = contourMeta(outer);
  const innerMeta = inner ? contourMeta(inner) : null;
  const maxDist = Math.max(sceneW, sceneH) * 0.35;

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const sx = (x + 0.5) / res * sceneW;
      const sy = (y + 0.5) / res * sceneH;
      const insideOuter = pointInPoly(sx, sy, outer);
      const insideInner = inner ? pointInPoly(sx, sy, inner) : false;
      const inside = insideOuter && !insideInner;
      const outerHit = contourDistanceAlong(sx, sy, outer, outerMeta);
      let best = outerHit.distance;
      let along = outerHit.along;
      if (inner && innerMeta) {
        const innerHit = contourDistanceAlong(sx, sy, inner, innerMeta);
        if (innerHit.distance < best) { best = innerHit.distance; along = innerHit.along; }
      }
      const signed = inside ? -best : best;
      const rch = Math.max(0, Math.min(255, Math.round((signed / maxDist * 0.5 + 0.5) * 255)));
      const gch = Math.max(0, Math.min(255, Math.round(along * 255)));
      const i = (y * res + x) * 4;
      data[i] = rch;
      data[i + 1] = gch;
      data[i + 2] = inside ? 255 : 0;
      data[i + 3] = 255;
    }
  }
  return { data, res, maxDist };
}
