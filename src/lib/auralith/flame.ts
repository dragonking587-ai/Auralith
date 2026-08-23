import { clamp, lerp } from "./id.ts";
import type { Bands, FlameConfig, ImageRect, Region, StampRegion } from "./types.ts";
import { imageNormToCanvas, minSide } from "./coords.ts";
import { bandLevel, stepEnvelope } from "./envelope.ts";

interface Ember {
  live: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ox: number;
  oy: number;
  life: number;
  maxLife: number;
  maxDist: number;
  size: number;
  heat: number;
}

interface Body {
  env: number;
  roar: number;
  height: number;
  width: number;
  seed: number;
}

export const FLAME_LIMITS = {
  minHeight: 1.15,
  maxHeight: 5.4,
  minWidth: 0.75,
  maxWidth: 2.7,
  maxLife: 0.58,
  minLife: 0.12,
  maxTravelScale: 1.1,
  maxGlowScale: 1.65,
  maxParticles: 72,
  maxSpawns: 5,
  maxVy: 0.85,
  maxTongues: 6,
  maxBright: 0.9,
} as const;

const POOL = FLAME_LIMITS.maxParticles;


function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x: number, y: number): number {
  let s = 0;
  let a = 0.52;
  let f = 1;
  s += valueNoise(x * f, y * f) * a;
  f *= 2.03;
  a *= 0.5;
  s += valueNoise(x * f + 19.1, y * f + 8.4) * a;
  f *= 2.11;
  a *= 0.5;
  s += valueNoise(x * f + 41.2, y * f + 27.7) * a;
  return s;
}

function smooth01(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

export function flameColor(t: number, heat: number): { r: number; g: number; b: number } {
  const h = clamp(t * (0.68 + heat * 0.32), 0, 1);
  if (h < 0.16) {
    const k = h / 0.16;
    return { r: lerp(48, 178, k), g: lerp(4, 22, k), b: lerp(0, 4, k) };
  }
  if (h < 0.4) {
    const k = (h - 0.16) / 0.24;
    return { r: lerp(178, 232, k), g: lerp(22, 72, k), b: lerp(4, 10, k) };
  }
  if (h < 0.72) {
    const k = (h - 0.4) / 0.32;
    return { r: lerp(232, 246, k), g: lerp(72, 148, k), b: lerp(10, 32, k) };
  }
  const k = (h - 0.72) / 0.28;
  return { r: lerp(246, 252, k), g: lerp(148, 198, k), b: lerp(32, 78, k) };
}

export function heatContribute(existing: number, add: number): number {
  return existing > add ? existing : add;
}

export function normalizeHeat(value: number): number {
  return clamp(value, 0, 1);
}

/** Map CURRENT energy + roar to bounded height/width scales (relative to region radius). Never integrates. */
export function flameTargets(energy: number, roar: number, heat = 0.5): { height: number; width: number } {
  const e = clamp(energy, 0, 1);
  const r = clamp(roar, 0, 1);
  const heatMul = 1 + clamp(heat, 0, 1) * 0.08;
  const height = clamp((FLAME_LIMITS.minHeight + 0.08 + e * 3.05 + r * 1.05) * heatMul, FLAME_LIMITS.minHeight, FLAME_LIMITS.maxHeight);
  const width = clamp(FLAME_LIMITS.minWidth + 0.07 + e * 1.28 + r * 0.78, FLAME_LIMITS.minWidth, FLAME_LIMITS.maxWidth);
  return { height, width };
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export class FlameSim {
  private embers: Ember[] = [];
  private heat: Float32Array;
  private hw: number;
  private hh: number;
  private rng = 1;
  private lastT = 0;
  private bodies = new Map<string, Body>();
  private activeRegions: Region[] = [];
  private heatCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private heatCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private pixels: ImageData | null = null;
  private shimmer: HTMLCanvasElement | OffscreenCanvas | null = null;
  private shimmerCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private timeSec = 0;
  private peakHeat = 0;

  constructor(heatW = 240, heatH = 136) {
    this.hw = heatW;
    this.hh = heatH;
    this.heat = new Float32Array(heatW * heatH);
    if (typeof OffscreenCanvas !== "undefined") {
      this.heatCanvas = new OffscreenCanvas(heatW, heatH);
      this.shimmer = new OffscreenCanvas(160, 96);
    } else if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = heatW;
      c.height = heatH;
      this.heatCanvas = c;
      const s = document.createElement("canvas");
      s.width = 160;
      s.height = 96;
      this.shimmer = s;
    }
    this.heatCtx = this.heatCanvas
      ? (this.heatCanvas.getContext("2d", { alpha: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null)
      : null;
    this.shimmerCtx = this.shimmer
      ? (this.shimmer.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null)
      : null;
    if (this.heatCtx) this.pixels = this.heatCtx.createImageData(heatW, heatH);
    for (let i = 0; i < POOL; i++) {
      this.embers.push({
        live: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        ox: 0,
        oy: 0,
        life: 0,
        maxLife: 1,
        maxDist: 0.1,
        size: 2,
        heat: 0.5,
      });
    }
  }

  reset(): void {
    this.heat.fill(0);
    this.bodies.clear();
    this.lastT = 0;
    this.peakHeat = 0;
    for (const p of this.embers) p.live = false;
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng & 2147483647) / 2147483647;
  }

  /**
   * Procedural fire kernel: broad anchored base, tapering body, noise-warped
   * tongues. Deposits into the shared heat field with max-blend.
   */
  private stampFlame(
    nx: number,
    ny: number,
    halfW: number,
    height: number,
    amount: number,
    seed: number,
    turb: number,
    speed: number,
    roar: number,
  ): void {
    const hw = this.hw;
    const hh = this.hh;
    const cx = nx * hw;
    const cy = ny * hh;
    const rise = Math.max(3, height * hh);
    const base = Math.max(1.4, halfW * hw);
    const pad = 1.35 + turb * 0.25 + roar * 0.2;
    const x0 = Math.max(0, Math.floor(cx - base * pad));
    const x1 = Math.min(hw - 1, Math.ceil(cx + base * pad));
    const y0 = Math.max(0, Math.floor(cy - rise * 1.08));
    const y1 = Math.min(hh - 1, Math.ceil(cy + base * 0.28));
    const add = clamp(amount, 0, 1);
    const t = this.timeSec * (0.55 + speed * 1.15);
    const s1 = seed * 13.7;
    const s2 = seed * 27.3;

    for (let y = y0; y <= y1; y++) {
      const v = (cy - (y + 0.5)) / rise;
      if (v < -0.18 || v > 1.14) continue;
      const vy = v < 0 ? 0 : v;
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5 - cx) / base;
        const n1 = fbm(u * 2.15 + s1, vy * 1.55 - t * 1.35 + s1);
        const n2 = fbm(u * 4.8 + s2, vy * 3.4 - t * 2.2 + s2);
        const warp = (n1 - 0.5) * (0.18 + vy * 0.95) * turb;
        const split = vy > 0.58 ? (n2 - 0.5) * (vy - 0.58) * (0.9 + roar * 0.85) * turb : 0;
        const curl = (n2 - 0.5) * vy * vy * 0.35 * turb;
        const uw = u + warp + split + curl;
        let half = Math.pow(Math.max(0, 1 - vy), 0.56) * (0.88 + roar * 0.55);
        half *= 0.72 + 0.4 * n1;
        if (v < 0) half *= Math.max(0.15, 1 + v * 2.4);
        half = Math.max(0.07, half);
        const edge = 1 - Math.abs(uw) / half;
        if (edge <= 0) continue;
        const mask = smooth01(0, 0.38, edge);
        const core = Math.exp(-uw * uw * 4.4) * Math.exp(-vy * 1.05) * mask;
        const shell = mask * Math.exp(-vy * 0.85);
        const halo = Math.exp(-(uw * uw) / (half * half * 3.4) - Math.max(0, vy) * 2.4) * 0.22;
        const energy = clamp(shell * 0.8 + core * 0.88 + halo, 0, 1);
        const i = y * hw + x;
        this.heat[i] = heatContribute(this.heat[i]!, add * energy);
      }
    }
  }

  private bodyFor(id: string): Body {
    let b = this.bodies.get(id);
    if (!b) {
      const seed = hashId(id);
      b = { env: 0, roar: 0, height: FLAME_LIMITS.minHeight, width: FLAME_LIMITS.minWidth, seed };
      this.bodies.set(id, b);
    }
    return b;
  }

  step(
    dtHint: number,
    regions: Region[],
    bands: Bands,
    flame: FlameConfig,
    master: number,
    time: number,
  ): void {
    let dt = this.lastT > 0 ? (time - this.lastT) / 1000 : dtHint;
    if (!Number.isFinite(dt) || dt <= 0) dt = dtHint || 1 / 60;
    dt = clamp(dt, 0.001, 0.05);
    this.lastT = time;
    this.timeSec = time * 0.001;

    const heatAmt = clamp(flame.heat, 0, 1);
    const density = clamp(flame.density, 0, 1);
    const speed = clamp(flame.speed, 0, 1);

    const decay = Math.exp(-dt * (3.1 + (1 - heatAmt) * 0.8));
    for (let i = 0; i < this.heat.length; i++) this.heat[i]! *= decay;

    const seen = new Set<string>();
    const flameRegions = regions.filter((r) => r.effect === "flame");
    this.activeRegions = flameRegions;
    const cluster = this.clusterScale();

    for (const region of flameRegions) {
      seen.add(region.id);
      const level = clamp(bandLevel(bands, region.band) * region.intensity * master, 0, 1);
      const b = this.bodyFor(region.id);
      b.env = stepEnvelope(b.env, level, dt, 0.045, 0.26);
      const roarTarget = b.env > 0.58 ? clamp((b.env - 0.5) / 0.5, 0, 1) : 0;
      b.roar = stepEnvelope(b.roar, roarTarget, dt, 0.22, 0.38);
      const t = flameTargets(b.env, b.roar, heatAmt);
      b.height = stepEnvelope(b.height, t.height, dt, 0.05, 0.22);
      b.width = stepEnvelope(b.width, t.width, dt, 0.055, 0.24);
      b.height = clamp(b.height, FLAME_LIMITS.minHeight, FLAME_LIMITS.maxHeight);
      b.width = clamp(b.width, FLAME_LIMITS.minWidth, FLAME_LIMITS.maxWidth);

      const share = cluster.get(region.id) ?? 1;
      const amount = clamp(b.env * (0.55 + density * 0.4) * (0.72 + b.roar * 0.38) * share, 0, 0.96);
      const turb = clamp(0.32 + heatAmt * 0.35 + speed * 0.28 + b.roar * 0.45 + density * 0.12, 0, 1.15);
      if (region.kind === "stamp") {
        this.stampFlame(
          region.x,
          region.y,
          region.r * b.width,
          region.r * b.height,
          amount,
          b.seed,
          turb,
          speed,
          b.roar,
        );
      } else {
        const pts = region.points;
        const stepN = Math.max(1, Math.ceil(pts.length / 10));
        for (let i = 0; i < pts.length; i += stepN) {
          const p = pts[i]!;
          this.stampFlame(
            p.x,
            p.y,
            region.width * b.width * 0.95,
            region.width * b.height * 1.55,
            amount * 0.82,
            b.seed + i * 0.017,
            turb,
            speed,
            b.roar,
          );
        }
      }
    }
    for (const id of [...this.bodies.keys()]) {
      if (!seen.has(id)) this.bodies.delete(id);
    }

    this.peakHeat = 0;
    for (let i = 0; i < this.heat.length; i++) {
      const v = this.heat[i]!;
      if (v > this.peakHeat) this.peakHeat = v;
    }

    let spawned = 0;
    const budget = Math.round(FLAME_LIMITS.maxSpawns * (0.15 + density * 0.45 + (this.peakHeat > 0.4 ? 0.2 : 0)));
    for (const region of flameRegions) {
      if (spawned >= budget) break;
      const b = this.bodies.get(region.id);
      if (!b || b.env < 0.12) continue;
      const n = b.roar > 0.35 && this.rand() < 0.55 + density * 0.3 ? 1 : this.rand() < 0.35 + b.env * 0.25 ? 1 : 0;
      if (!n) continue;
      const heightN = region.kind === "stamp" ? region.r * b.height : region.width * b.height * 1.55;
      const widthN = region.kind === "stamp" ? region.r * b.width : region.width * b.width;
      const p = this.alloc();
      if (!p) break;
      let nx: number;
      let ny: number;
      if (region.kind === "stamp") {
        nx = region.x + (this.rand() - 0.5) * widthN * 0.45;
        ny = region.y - heightN * (0.55 + this.rand() * 0.25);
      } else {
        const pts = region.points;
        const idx = Math.floor(this.rand() * Math.max(1, pts.length - 1));
        const a = pts[idx]!;
        nx = a.x + (this.rand() - 0.5) * region.width * 0.3;
        ny = a.y - heightN * (0.4 + this.rand() * 0.3);
      }
      const maxDist = clamp(heightN * 0.55, 0.015, 0.22);
      const rise = clamp((0.08 + b.env * 0.12 + speed * 0.12) * (0.7 + this.rand() * 0.4), 0.03, 0.42);
      p.live = true;
      p.x = nx;
      p.y = ny;
      p.ox = nx;
      p.oy = ny;
      p.vx = (this.rand() - 0.5) * (0.03 + b.roar * 0.04);
      p.vy = -rise;
      p.maxLife = clamp(0.18 + this.rand() * 0.22, FLAME_LIMITS.minLife, FLAME_LIMITS.maxLife);
      p.life = p.maxLife;
      p.maxDist = maxDist;
      p.size = 1.1 + this.rand() * 1.8;
      p.heat = clamp(0.45 + b.env * 0.25 + heatAmt * 0.2, 0, 1);
      spawned++;
    }

    const turb = clamp(0.35 + heatAmt * 0.4 + speed * 0.35, 0, 1);
    for (const p of this.embers) {
      if (!p.live) continue;
      p.life -= dt;
      const dx = p.x - p.ox;
      const dy = p.y - p.oy;
      const dist = Math.hypot(dx, dy);
      if (p.life <= 0 || dist >= p.maxDist || p.y < p.oy - p.maxDist) {
        p.live = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.x += Math.sin(this.timeSec * (4 + speed * 5) + p.ox * 18) * turb * 0.01 * dt;
      p.vx *= Math.max(0, 1 - 0.7 * dt);
      p.vy *= Math.max(0, 1 - 0.28 * dt);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) p.live = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, rect: ImageRect, flame: FlameConfig, master: number): void {
    if (this.peakHeat < 0.02 && this.liveCount() === 0) return;
    const side = minSide(rect);
    const heatAmt = clamp(flame.heat, 0, 1);
    const bright = clamp(master * (0.78 + heatAmt * 0.2), 0, FLAME_LIMITS.maxBright);

    this.drawShimmer(ctx, rect, heatAmt, bright);

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    if (this.heatCtx && this.pixels && this.heatCanvas) {
      const data = this.pixels.data;
      for (let i = 0; i < this.heat.length; i++) {
        const v = normalizeHeat(this.heat[i] ?? 0);
        const o = i * 4;
        if (v < 0.035) {
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 0;
          continue;
        }
        const col = flameColor(v, heatAmt);
        data[o] = col.r;
        data[o + 1] = col.g;
        data[o + 2] = col.b;
        const a = v < 0.18 ? v * 420 : 110 + v * 120;
        data[o + 3] = Math.min(210, a * bright);
      }
      this.heatCtx.putImageData(this.pixels, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 1;
      ctx.drawImage(this.heatCanvas as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
    }

    ctx.globalCompositeOperation = "lighter";
    for (const p of this.embers) {
      if (!p.live) continue;
      const age = 1 - p.life / p.maxLife;
      const fade = Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI);
      const pos = imageNormToCanvas(p.x, p.y, rect);
      const col = flameColor(p.heat * (1 - age * 0.7), heatAmt);
      const radius = Math.max(0.6, (p.size * (1 - age * 0.4) * side) / 900);
      ctx.globalAlpha = bright * fade * 0.55;
      ctx.fillStyle = `rgba(${col.r | 0},${col.g | 0},${col.b | 0},1)`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /** Subtle local warp of the already-drawn plate, only above active flame. */
  private drawShimmer(ctx: CanvasRenderingContext2D, rect: ImageRect, heatAmt: number, bright: number): void {
    if (!this.shimmer || !this.shimmerCtx || this.peakHeat < 0.12) return;
    const box = this.heatAabb();
    if (!box) return;
    const x = rect.x + box.x0 * rect.w;
    const y = rect.y + box.y0 * rect.h;
    const w = (box.x1 - box.x0) * rect.w;
    const h = (box.y1 - box.y0) * rect.h;
    if (w < 8 || h < 8) return;
    const top = y - h * 0.12;
    const regionH = h * 0.55;
    const regionY = Math.max(0, top);
    const sw = 160;
    const sh = 96;
    const amp = (1.6 + heatAmt * 2.4) * (0.45 + bright * 0.55);
    try {
      this.shimmerCtx.clearRect(0, 0, sw, sh);
      this.shimmerCtx.drawImage(ctx.canvas, x, regionY, w, regionH, 0, 0, sw, sh);
      ctx.save();
      ctx.globalAlpha = 0.22 + heatAmt * 0.18;
      const slices = 12;
      const sliceH = sh / slices;
      for (let i = 0; i < slices; i++) {
        const t = i / slices;
        const ox = Math.sin(this.timeSec * 7.2 + i * 0.85 + box.x0 * 8) * amp * (1 - t);
        ctx.drawImage(
          this.shimmer as CanvasImageSource,
          0,
          i * sliceH,
          sw,
          sliceH + 0.6,
          x + ox,
          regionY + (i * regionH) / slices,
          w,
          regionH / slices + 0.6,
        );
      }
      ctx.restore();
    } catch {
      /* canvas read can fail on tainted images; skip haze */
    }
  }

  private heatAabb(): { x0: number; y0: number; x1: number; y1: number } | null {
    const hw = this.hw;
    const hh = this.hh;
    let x0 = hw;
    let y0 = hh;
    let x1 = 0;
    let y1 = 0;
    let found = false;
    for (let y = 0; y < hh; y++) {
      const row = y * hw;
      for (let x = 0; x < hw; x++) {
        if ((this.heat[row + x] ?? 0) < 0.1) continue;
        found = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (!found) return null;
    return { x0: x0 / hw, y0: y0 / hh, x1: (x1 + 1) / hw, y1: (y1 + 1) / hh };
  }

  private alloc(): Ember | null {
    for (const p of this.embers) if (!p.live) return p;
    return null;
  }

  private clusterScale(): Map<string, number> {
    const scale = new Map<string, number>();
    const stamps = this.activeRegions.filter((r): r is StampRegion => r.kind === "stamp" && r.effect === "flame");
    for (const r of this.activeRegions) scale.set(r.id, 1);
    for (let i = 0; i < stamps.length; i++) {
      const a = stamps[i]!;
      let neighbors = 0;
      for (let j = 0; j < stamps.length; j++) {
        if (i === j) continue;
        const b = stamps[j]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < (a.r + b.r) * 2.4) neighbors++;
      }
      if (neighbors > 0) scale.set(a.id, clamp(0.82 + Math.min(neighbors, 8) * 0.03, 0.82, 1));
    }
    return scale;
  }

  liveCount(): number {
    let n = 0;
    for (const p of this.embers) if (p.live) n++;
    return n;
  }

  heatCoverage(): number {
    let n = 0;
    for (let i = 0; i < this.heat.length; i++) if ((this.heat[i] ?? 0) > 0.12) n++;
    return n;
  }

  /** Test helper: ember Y stays near the spawn base. */
  extents(): { live: number; minY: number; maxY: number } {
    let live = 0;
    let minY = 1;
    let maxY = 0;
    for (const p of this.embers) {
      if (!p.live) continue;
      live++;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { live, minY, maxY };
  }

  bodyScale(id: string): { height: number; width: number; env: number; roar: number } | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    return { height: b.height, width: b.width, env: b.env, roar: b.roar };
  }
}
