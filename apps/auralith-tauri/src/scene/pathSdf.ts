import type { Region } from "./types";

export type GeomMode = "point" | "path" | "mask";
export type ApplyMode = "inside" | "boundary" | "outside";

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy || 1e-8;
  let t = ((px - ax) * vx + (py - ay) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + vx * t, y = ay + vy * t;
  return Math.hypot(px - x, py - y);
}

function pointInPoly(px: number, py: number, pts: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]!.x, yi = pts[i]!.y, xj = pts[j]!.x, yj = pts[j]!.y;
    const inter = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-8) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}

export function regionGeomMode(r: Region, fallback?: GeomMode): GeomMode {
  if (fallback) return fallback;
  if (r.kind === "Prop" || r.kind === "Shape") return "mask";
  if (r.kind === "Trace" && r.points.length >= 2) return r.pathClosed ? "mask" : "path";
  return "point";
}

export function buildPropAlphaField(
  pixels: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  region: Region,
  sceneW: number,
  sceneH: number,
  res = 256
) {
  const data = new Uint8Array(res * res * 4);
  const pw = Math.max(1, region.width || region.radius * 2);
  const ph = Math.max(1, region.height || region.radius * 2);
  const x0 = region.x - pw / 2;
  const y0 = region.y - ph / 2;
  const thresh = Math.max(1, Math.min(254, Math.round((region.alphaThreshold ?? 0.15) * 255)));
  const occ = new Uint8Array(res * res);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const sx = (x + 0.5) / res * sceneW;
      const sy = (y + 0.5) / res * sceneH;
      const u = (sx - x0) / pw;
      const v = (sy - y0) / ph;
      let inside = 0;
      if (u >= 0 && v >= 0 && u < 1 && v < 1) {
        const ix = Math.min(imgW - 1, Math.max(0, Math.floor(u * imgW)));
        const iy = Math.min(imgH - 1, Math.max(0, Math.floor(v * imgH)));
        const a = pixels[(iy * imgW + ix) * 4 + 3] || 0;
        inside = a >= thresh ? 1 : 0;
      }
      occ[y * res + x] = inside;
    }
  }
  const maxDist = Math.max(sceneW, sceneH) * 0.35;
  const cell = Math.max(sceneW, sceneH) / res;
  const rad = 18;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const inside = occ[y * res + x] === 1;
      let best = rad + 1;
      for (let oy = -rad; oy <= rad && best > 1; oy++) {
        const yy = y + oy; if (yy < 0 || yy >= res) continue;
        for (let ox = -rad; ox <= rad; ox++) {
          const xx = x + ox; if (xx < 0 || xx >= res) continue;
          if ((occ[yy * res + xx] === 1) !== inside) {
            const d = Math.hypot(ox, oy);
            if (d < best) best = d;
          }
        }
      }
      const distPx = best * cell;
      const signed = inside ? -distPx : distPx;
      const rch = Math.max(0, Math.min(255, Math.round((signed / maxDist * 0.5 + 0.5) * 255)));
      const i = (y * res + x) * 4;
      data[i] = rch; data[i + 1] = 0; data[i + 2] = inside ? 255 : 0; data[i + 3] = 255;
    }
  }
  return { data, res, maxDist };
}

export function buildPathField(
  pts: { x: number; y: number }[],
  closed: boolean,
  sceneW: number,
  sceneH: number,
  res = 256
) {
  const data = new Uint8Array(res * res * 4);
  if (pts.length < 2) return { data, res, maxDist: 1, total: 0 };
  const segs: { ax: number; ay: number; bx: number; by: number; acc: number; len: number }[] = [];
  let total = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, acc: total, len });
    total += len;
  }
  const maxDist = Math.max(sceneW, sceneH) * 0.35;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const sx = (x + 0.5) / res * sceneW;
      const sy = (y + 0.5) / res * sceneH;
      let best = 1e12, along = 0;
      for (const s of segs) {
        const d = distSeg(sx, sy, s.ax, s.ay, s.bx, s.by);
        if (d < best) {
          best = d;
          const vx = s.bx - s.ax, vy = s.by - s.ay;
          const l2 = vx * vx + vy * vy || 1e-8;
          const t = Math.max(0, Math.min(1, ((sx - s.ax) * vx + (sy - s.ay) * vy) / l2));
          along = total > 0 ? (s.acc + t * s.len) / total : 0;
        }
      }
      const inside = closed && pts.length >= 3 ? pointInPoly(sx, sy, pts) : false;
      const signed = inside ? -best : best;
      const rch = Math.max(0, Math.min(255, Math.round((signed / maxDist * 0.5 + 0.5) * 255)));
      const gch = Math.max(0, Math.min(255, Math.round(along * 255)));
      const bch = inside ? 255 : 0;
      const i = (y * res + x) * 4;
      data[i] = rch; data[i + 1] = gch; data[i + 2] = bch; data[i + 3] = 255;
    }
  }
  return { data, res, maxDist, total };
}

export function fieldKey(r: Region, w: number, h: number) {
  const pts = r.points.map((p) => `${p.x|0},${p.y|0}`).join(";");
  return `${r.id}|${r.kind}|${r.pathClosed ? 1 : 0}|${w}x${h}|${r.x|0},${r.y|0},${r.width|0},${r.height|0}|${r.alphaThreshold||0}|${pts}`;
}
