import type { BandId } from "./types.ts";
import { BANDS } from "./types.ts";
import type { DetectedLight } from "./detect-lights.ts";

export interface Lab {
  L: number;
  a: number;
  b: number;
}

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function chroma(lab: Lab): number {
  return Math.hypot(lab.a, lab.b);
}

/** Hue-weighted OKLab distance. Neutrals compare mainly on lightness. */
export function labDist(a: Lab, b: Lab): number {
  const ca = chroma(a);
  const cb = chroma(b);
  const dL = Math.abs(a.L - b.L);
  const dH = Math.hypot(a.a - b.a, a.b - b.b);
  const dC = Math.abs(ca - cb);
  if (ca < 0.045 && cb < 0.045) return dL * 1.6 + dC * 0.4;
  return dH * 1.2 + dL * 0.32 + dC * 0.22;
}

function meanLab(labs: Lab[]): Lab {
  const n = Math.max(1, labs.length);
  return {
    L: labs.reduce((s, x) => s + x.L, 0) / n,
    a: labs.reduce((s, x) => s + x.a, 0) / n,
    b: labs.reduce((s, x) => s + x.b, 0) / n,
  };
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - m) * (x - m), 0) / values.length;
  return Math.sqrt(v);
}

interface Feat {
  lab: Lab;
  size: number;
  strength: number;
  lum: number;
}

function features(light: DetectedLight): Feat {
  const rgb = hexToRgb(light.color);
  const lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
  return {
    lab,
    size: light.r,
    strength: light.strength,
    lum: lab.L,
  };
}

function clusterIndices(feats: Feat[], thresh: number): number[][] {
  const clusters: number[][] = feats.map((_, i) => [i]);
  const cents = feats.map((f) => f.lab);
  const refresh = (ci: number) => {
    cents[ci] = meanLab(clusters[ci]!.map((i) => feats[i]!.lab));
  };
  while (clusters.length > 1) {
    let best = Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = labDist(cents[i]!, cents[j]!);
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (best > thresh) break;
    clusters[bi]!.push(...clusters[bj]!);
    clusters.splice(bj, 1);
    cents.splice(bj, 1);
    refresh(bi);
  }
  return clusters;
}

function dominance(members: number[], feats: Feat[]): number {
  let s = 0;
  for (const i of members) {
    const f = feats[i]!;
    s += f.size * 1.3 + f.strength * 1.05 + f.lum * 0.15;
  }
  return s;
}

function splitBySize(members: number[], feats: Feat[]): number[][] {
  if (members.length < 3) return [members];
  const scores = members.map((i) => feats[i]!.size * 1.2 + feats[i]!.strength * 0.75);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const cv = mean > 1e-6 ? stdev(scores) / mean : 0;
  if (cv < 0.16) return [members];

  const ranked = members
    .map((i, k) => ({ i, s: scores[k]! }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const range = ranked[0]!.s - ranked[ranked.length - 1]!.s;
  if (range < 1e-6) return [members];
  const k = members.length >= 8 ? 4 : members.length >= 6 ? 3 : 2;
  const gaps: { g: number; at: number }[] = [];
  for (let i = 0; i < ranked.length - 1; i++) {
    gaps.push({ g: ranked[i]!.s - ranked[i + 1]!.s, at: i });
  }
  gaps.sort((a, b) => b.g - a.g || a.at - b.at);
  const cuts = gaps
    .filter((g) => g.g > range * 0.28)
    .slice(0, k - 1)
    .map((g) => g.at)
    .sort((a, b) => a - b);
  if (!cuts.length) return [members];
  const groups: number[][] = [];
  let start = 0;
  for (const cut of cuts) {
    const slice = ranked.slice(start, cut + 1).map((x) => x.i);
    if (slice.length) groups.push(slice);
    start = cut + 1;
  }
  const tail = ranked.slice(start).map((x) => x.i);
  if (tail.length) groups.push(tail);
  return groups.filter((g) => g.length);
}

const COLOR_THRESH = 0.118;

/**
 * Cluster detections in OKLab and assign Bass / Low / Mid / High.
 * Similar colors stay together. Size splits only when color is nearly uniform
 * and the lights actually differ in scale. Deterministic for the same input.
 */
export function assignBands(lights: DetectedLight[]): BandId[] {
  const n = lights.length;
  if (!n) return [];
  if (n === 1) return ["bass"];

  const order = lights.map((_, i) => i).sort((a, b) => {
    const la = lights[a]!;
    const lb = lights[b]!;
    if (la.color !== lb.color) return la.color < lb.color ? -1 : 1;
    if (la.y !== lb.y) return la.y - lb.y;
    if (la.x !== lb.x) return la.x - lb.x;
    return a - b;
  });
  const feats = lights.map(features);
  let groups = clusterIndices(
    order.map((i) => feats[i]!),
    COLOR_THRESH,
  ).map((g) => g.map((local) => order[local]!));

  if (groups.length === 1) {
    groups = splitBySize(groups[0]!, feats);
  } else if (groups.length > 4) {
    const ranked = groups
      .map((g) => ({ g, d: dominance(g, feats) }))
      .sort((a, b) => b.d - a.d);
    const keep = ranked.slice(0, 4);
    const extra = ranked.slice(4);
    const cents = keep.map((k) => meanLab(k.g.map((i) => feats[i]!.lab)));
    for (const ex of extra) {
      const c = meanLab(ex.g.map((i) => feats[i]!.lab));
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < cents.length; i++) {
        const d = labDist(c, cents[i]!);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      keep[best]!.g.push(...ex.g);
    }
    groups = keep.map((k) => k.g);
  }

  const ranked = groups
    .map((g) => ({ g, d: dominance(g, feats) }))
    .sort((a, b) => b.d - a.d || a.g[0]! - b.g[0]!);

  const out: BandId[] = Array(n).fill("bass");
  ranked.forEach((cl, rank) => {
    const band = BANDS[Math.min(rank, BANDS.length - 1)]!;
    for (const i of cl.g) out[i] = band;
  });
  return out;
}

export function withAssignedBands(lights: DetectedLight[]): Array<DetectedLight & { band: BandId }> {
  const bands = assignBands(lights);
  return lights.map((l, i) => ({ ...l, band: bands[i] ?? "bass" }));
}

export function bandCounts(bands: BandId[]): Record<BandId, number> {
  const c: Record<BandId, number> = { bass: 0, low: 0, mid: 0, high: 0 };
  for (const b of bands) c[b]++;
  return c;
}
