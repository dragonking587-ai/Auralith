export type Pt = { x: number; y: number };

export function pathLength(pts: Pt[], closed: boolean) {
  if (pts.length < 2) return { segs: [] as number[], cum: [0], total: 0 };
  const segs: number[] = [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - pts[i-1]!.x, pts[i]!.y - pts[i-1]!.y);
    segs.push(d); cum.push(cum[cum.length-1]! + d);
  }
  if (closed && pts.length >= 3) {
    const d = Math.hypot(pts[0]!.x - pts[pts.length-1]!.x, pts[0]!.y - pts[pts.length-1]!.y);
    segs.push(d); cum.push(cum[cum.length-1]! + d);
  }
  return { segs, cum, total: cum[cum.length-1]! };
}

export function pointOnPath(pts: Pt[], closed: boolean, t: number): Pt {
  const { cum, total } = pathLength(pts, closed);
  if (total <= 0) return pts[0] || { x: 0, y: 0 };
  const d = ((t % 1) + 1) % 1 * total;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i+1)%pts.length]!;
    const aC = cum[i]!, bC = cum[i+1]!;
    if (d <= bC || i === n-1) {
      const u = (bC - aC) > 1e-6 ? (d - aC) / (bC - aC) : 0;
      return { x: a.x + (b.x-a.x)*u, y: a.y + (b.y-a.y)*u };
    }
  }
  return pts[0]!;
}

export function closestPointOnSeg(p: Pt, a: Pt, b: Pt) {
  const vx = b.x-a.x, vy = b.y-a.y;
  const len2 = vx*vx+vy*vy || 1;
  let t = ((p.x-a.x)*vx + (p.y-a.y)*vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x+vx*t, y: a.y+vy*t, t, d: Math.hypot(p.x-(a.x+vx*t), p.y-(a.y+vy*t)) };
}

export function closestSegment(pts: Pt[], closed: boolean, p: Pt) {
  let best = { i: 0, t: 0, d: Infinity, x: p.x, y: p.y };
  const n = closed ? pts.length : Math.max(0, pts.length-1);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i+1)%pts.length]!;
    const hit = closestPointOnSeg(p, a, b);
    if (hit.d < best.d) best = { i, t: hit.t, d: hit.d, x: hit.x, y: hit.y };
  }
  return best;
}

export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length-1] = true;
  const stack: [number, number][] = [[0, pts.length-1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxd = -1, idx = -1;
    const a = pts[s]!, b = pts[e]!;
    for (let i = s+1; i < e; i++) {
      const d = closestPointOnSeg(pts[i]!, a, b).d;
      if (d > maxd) { maxd = d; idx = i; }
    }
    if (maxd > eps && idx >= 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function chaikin(pts: Pt[], closed: boolean, preserveCorners: boolean, amount: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const out: Pt[] = [];
  const n = pts.length;
  const corner = (i: number) => {
    if (!preserveCorners) return false;
    const a = pts[(i-1+n)%n]!, b = pts[i]!, c = pts[(i+1)%n]!;
    const ang = Math.abs(Math.atan2(c.y-b.y,c.x-b.x) - Math.atan2(a.y-b.y,a.x-b.x));
    const wrap = Math.min(ang, Math.abs(ang-Math.PI*2));
    return wrap > 0.9 && wrap < Math.PI - 0.4;
  };
  const start = closed ? 0 : 0;
  const end = closed ? n : n-1;
  if (!closed) out.push(pts[0]!);
  for (let i = start; i < end; i++) {
    const a = pts[i]!, b = pts[(i+1)%n]!;
    if (preserveCorners && corner(i)) { if (closed || i>0) out.push(a); continue; }
    const t = 0.25 + 0.2 * (1-amount);
    out.push({ x: a.x*(1-t)+b.x*t, y: a.y*(1-t)+b.y*t });
    out.push({ x: a.x*t+b.x*(1-t), y: a.y*t+b.y*(1-t) });
  }
  if (!closed) out.push(pts[n-1]!);
  return out.slice(0, 400);
}

export function rasterizeClosed(pts: Pt[], w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.min(1024, w));
  c.height = Math.max(2, Math.min(1024, h));
  const g = c.getContext("2d")!;
  g.clearRect(0,0,c.width,c.height);
  if (pts.length < 3) return c;
  const sx = c.width / w, sy = c.height / h;
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(pts[0]!.x*sx, pts[0]!.y*sy);
  for (let i=1;i<pts.length;i++) g.lineTo(pts[i]!.x*sx, pts[i]!.y*sy);
  g.closePath();
  g.fill();
  return c;
}
