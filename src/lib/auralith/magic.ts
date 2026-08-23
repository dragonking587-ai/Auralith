import { clamp, lerp } from "./id.ts";
import type { Bands, ImageRect, MagicConfig, Region, StampRegion } from "./types.ts";
import { imageNormToCanvas, minSide } from "./coords.ts";
import { bandLevel, stepEnvelope } from "./envelope.ts";

interface Spark {
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
  color: string;
}

interface Body {
  env: number;
  prevEnv: number;
  surge: number;
  impulse: number;
  aura: number;
  reach: number;
  seed: number;
  color: string;
}

export const MAGIC_LIMITS = {
  minAura: 0.85,
  maxAura: 2.45,
  minReach: 0.7,
  maxReach: 2.85,
  maxSparks: 64,
  maxSpawns: 4,
  maxTendrils: 48,
  maxBright: 0.88,
  maxLife: 0.55,
  minLife: 0.12,
} as const;

const SPARK_POOL = MAGIC_LIMITS.maxSparks;

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
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), u), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u), v);
}

function fbm(x: number, y: number): number {
  return valueNoise(x, y) * 0.52 + valueNoise(x * 2.09 + 11, y * 2.09 + 4) * 0.32 + valueNoise(x * 4.13 + 27, y * 4.13 + 19) * 0.16;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (!Number.isFinite(n)) return { r: 232, g: 180, b: 80 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * clamp(c, 0, 1));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/** Hue-shifted variant of a region color. Never blows out to pure white. */
export function magicTint(hex: string, shiftDeg: number, lift = 0): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const nh = ((h + shiftDeg / 360) % 1 + 1) % 1;
  const ns = clamp(s * 0.92 + 0.12, 0.25, 0.95);
  const nl = clamp(l * 0.9 + 0.08 + lift * 0.12, 0.18, 0.78);
  return hslToRgb(nh, ns, nl);
}

/**
 * Fluid energy palette: deep tint → saturated mid → small pale highlight.
 * White only in the hottest sliver, never a large core.
 */
export function plasmaColor(hex: string, heat: number): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  const t = clamp(heat, 0, 1);
  const nh = ((h - 0.02 * (1 - t)) % 1 + 1) % 1;
  if (t < 0.32) {
    const k = t / 0.32;
    return hslToRgb(nh, clamp(s * 0.9 + 0.18, 0.5, 0.95), lerp(0.14, 0.36, k));
  }
  if (t < 0.7) {
    const k = (t - 0.32) / 0.38;
    return hslToRgb(nh, clamp(s * 0.88 + 0.16, 0.48, 0.92), lerp(0.36, 0.58, k));
  }
  if (t < 0.9) {
    const k = (t - 0.7) / 0.2;
    return hslToRgb(nh, clamp(s * 0.7 + 0.18, 0.4, 0.82), lerp(0.58, 0.74, k));
  }
  const k = (t - 0.9) / 0.1;
  return hslToRgb(nh, clamp(s * 0.45 + 0.16, 0.28, 0.62), lerp(0.74, 0.86, k));
}

export function energyContribute(existing: number, add: number): number {
  return existing > add ? existing : add;
}

function shadeDye(r: number, g: number, b: number, heat: number): { r: number; g: number; b: number } {
  const [h, s] = rgbToHsl(r, g, b);
  const t = clamp(heat, 0, 1);
  if (t < 0.35) return hslToRgb(h, clamp(s * 0.95 + 0.1, 0.45, 0.95), lerp(0.16, 0.4, t / 0.35));
  if (t < 0.75) return hslToRgb(h, clamp(s * 0.85 + 0.12, 0.42, 0.9), lerp(0.4, 0.62, (t - 0.35) / 0.4));
  return hslToRgb(h, clamp(s * 0.55 + 0.18, 0.32, 0.72), lerp(0.62, 0.82, (t - 0.75) / 0.25));
}

export function magicTargets(energy: number, surge: number, spread = 0.6): { aura: number; reach: number } {
  const e = clamp(energy, 0, 1);
  const s = clamp(surge, 0, 1);
  const sp = 0.75 + clamp(spread, 0, 1) * 0.55;
  const aura = clamp((MAGIC_LIMITS.minAura + e * 1.05 + s * 0.42) * sp, MAGIC_LIMITS.minAura, MAGIC_LIMITS.maxAura);
  const reach = clamp((MAGIC_LIMITS.minReach + e * 1.35 + s * 0.55) * sp, MAGIC_LIMITS.minReach, MAGIC_LIMITS.maxReach);
  return { aura, reach };
}

function sampleScalar(arr: Float32Array, x: number, y: number, w: number, h: number): number {
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return 0;
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  const a = arr[i] ?? 0;
  const b = arr[i + 1] ?? 0;
  const c = arr[i + w] ?? 0;
  const d = arr[i + w + 1] ?? 0;
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

export class MagicSim {
  private sparks: Spark[] = [];
  private deep: Float32Array;
  private near: Float32Array;
  private buf: Float32Array;
  private cr: Float32Array;
  private cg: Float32Array;
  private cb: Float32Array;
  private cbufR: Float32Array;
  private cbufG: Float32Array;
  private cbufB: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private hw: number;
  private hh: number;
  private vw: number;
  private vh: number;
  private rng = 1;
  private lastT = 0;
  private timeSec = 0;
  private bodies = new Map<string, Body>();
  private active: Region[] = [];
  private fieldCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private fieldCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private pixels: ImageData | null = null;
  private shimmer: OffscreenCanvas | HTMLCanvasElement | null = null;
  private shimmerCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private peak = 0;
  private flowBoost = 0.5;

  constructor(w = 200, h = 140) {
    this.hw = w;
    this.hh = h;
    this.vw = 48;
    this.vh = 48;
    this.deep = new Float32Array(w * h);
    this.near = new Float32Array(w * h);
    this.buf = new Float32Array(w * h);
    this.cr = new Float32Array(w * h);
    this.cg = new Float32Array(w * h);
    this.cb = new Float32Array(w * h);
    this.cbufR = new Float32Array(w * h);
    this.cbufG = new Float32Array(w * h);
    this.cbufB = new Float32Array(w * h);
    this.vx = new Float32Array(this.vw * this.vh);
    this.vy = new Float32Array(this.vw * this.vh);
    if (typeof OffscreenCanvas !== "undefined") {
      this.fieldCanvas = new OffscreenCanvas(w, h);
      this.shimmer = new OffscreenCanvas(160, 96);
    } else if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      this.fieldCanvas = c;
      const s = document.createElement("canvas");
      s.width = 160;
      s.height = 96;
      this.shimmer = s;
    }
    this.fieldCtx = this.fieldCanvas
      ? (this.fieldCanvas.getContext("2d", { alpha: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null)
      : null;
    this.shimmerCtx = this.shimmer
      ? (this.shimmer.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null)
      : null;
    if (this.fieldCtx) this.pixels = this.fieldCtx.createImageData(w, h);
    for (let i = 0; i < SPARK_POOL; i++) {
      this.sparks.push({
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
        size: 1.1,
        color: "#e8c47a",
      });
    }
  }

  reset(): void {
    this.deep.fill(0);
    this.near.fill(0);
    this.cr.fill(0);
    this.cg.fill(0);
    this.cb.fill(0);
    this.bodies.clear();
    this.lastT = 0;
    this.peak = 0;
    for (const p of this.sparks) p.live = false;
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng & 2147483647) / 2147483647;
  }

  private bodyFor(id: string, color: string): Body {
    let b = this.bodies.get(id);
    if (!b) {
      b = {
        env: 0,
        prevEnv: 0,
        surge: 0,
        impulse: 0,
        aura: MAGIC_LIMITS.minAura,
        reach: MAGIC_LIMITS.minReach,
        seed: hashId(id),
        color,
      };
      this.bodies.set(id, b);
    }
    b.color = color;
    return b;
  }

  private updateVelocity(flow: number, energy: number): void {
    const t = this.timeSec * (0.12 + flow * 0.35);
    const vw = this.vw;
    const vh = this.vh;
    const scaleA = 0.085;
    const scaleB = 0.19;
    const turb = 0.55 + energy * 0.55;
    for (let y = 0; y < vh; y++) {
      for (let x = 0; x < vw; x++) {
        const psiA = (xx: number, yy: number) => fbm(xx * scaleA + 3.1, yy * scaleA - t);
        const psiB = (xx: number, yy: number) => fbm(xx * scaleB + 17.4, yy * scaleB - t * 1.45 + 8);
        const dA = psiA(x, y + 1) - psiA(x, y - 1);
        const dB = psiB(x, y + 1) - psiB(x, y - 1);
        const eA = psiA(x - 1, y) - psiA(x + 1, y);
        const eB = psiB(x - 1, y) - psiB(x + 1, y);
        const i = y * vw + x;
        this.vx[i] = (dA * 0.72 + dB * 0.38) * turb;
        this.vy[i] = (eA * 0.72 + eB * 0.38) * turb;
      }
    }
  }

  private velAt(nx: number, ny: number): { x: number; y: number } {
    const x = ((nx * this.vw) % this.vw + this.vw) % this.vw;
    const y = ((ny * this.vh) % this.vh + this.vh) % this.vh;
    const x0 = x | 0;
    const y0 = y | 0;
    const x1 = (x0 + 1) % this.vw;
    const y1 = (y0 + 1) % this.vh;
    const fx = x - x0;
    const fy = y - y0;
    const i00 = y0 * this.vw + x0;
    const i10 = y0 * this.vw + x1;
    const i01 = y1 * this.vw + x0;
    const i11 = y1 * this.vw + x1;
    const vx = lerp(lerp(this.vx[i00]!, this.vx[i10]!, fx), lerp(this.vx[i01]!, this.vx[i11]!, fx), fy);
    const vy = lerp(lerp(this.vy[i00]!, this.vy[i10]!, fx), lerp(this.vy[i01]!, this.vy[i11]!, fx), fy);
    return { x: vx, y: vy };
  }

  private advect(src: Float32Array, dst: Float32Array, dt: number, speed: number): void {
    const w = this.hw;
    const h = this.hh;
    const dist = speed * dt;
    for (let y = 0; y < h; y++) {
      const ny = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5) / w;
        const v = this.velAt(nx, ny);
        const sx = x - v.x * dist;
        const sy = y - v.y * dist;
        dst[y * w + x] = sampleScalar(src, sx, sy, w, h);
      }
    }
  }

  private advectColor(dt: number, speed: number): void {
    const w = this.hw;
    const h = this.hh;
    const dist = speed * dt;
    for (let y = 0; y < h; y++) {
      const ny = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5) / w;
        const v = this.velAt(nx, ny);
        const sx = x - v.x * dist;
        const sy = y - v.y * dist;
        const i = y * w + x;
        this.cbufR[i] = sampleScalar(this.cr, sx, sy, w, h);
        this.cbufG[i] = sampleScalar(this.cg, sx, sy, w, h);
        this.cbufB[i] = sampleScalar(this.cb, sx, sy, w, h);
      }
    }
    this.cr.set(this.cbufR);
    this.cg.set(this.cbufG);
    this.cb.set(this.cbufB);
  }

  private diffuse(field: Float32Array, amount: number): void {
    const w = this.hw;
    const h = this.hh;
    const keep = 1 - amount;
    const corner = amount * 0.05;
    const edge = amount * 0.2;
    const dst = this.buf;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        dst[i] =
          field[i]! * keep +
          (field[i - 1]! + field[i + 1]! + field[i - w]! + field[i + w]!) * edge +
          (field[i - w - 1]! + field[i - w + 1]! + field[i + w - 1]! + field[i + w + 1]!) * corner;
      }
    }
    field.set(dst);
  }

  /** Blotchy, noise-warped dye — never a hard circle. */
  private splat(
    field: Float32Array,
    nx: number,
    ny: number,
    radX: number,
    radY: number,
    amount: number,
    seed: number,
    color: string,
  ): void {
    const w = this.hw;
    const h = this.hh;
    const cx = nx * w;
    const cy = ny * h;
    const rx = Math.max(1.8, radX * Math.min(w, h));
    const ry = Math.max(1.8, radY * Math.min(w, h));
    const x0 = Math.max(1, (cx - rx * 1.7) | 0);
    const x1 = Math.min(w - 2, (cx + rx * 1.7) | 0);
    const y0 = Math.max(1, (cy - ry * 1.7) | 0);
    const y1 = Math.min(h - 2, (cy + ry * 1.7) | 0);
    const add = clamp(amount, 0, 1);
    const t = this.timeSec * 0.35;
    const tint = plasmaColor(color, 0.55);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5 - cx) / rx;
        const v = (y + 0.5 - cy) / ry;
        const n1 = fbm(u * 1.6 + seed * 8, v * 1.6 - t + seed * 3);
        const n2 = fbm(u * 2.8 + 9 + seed, v * 2.4 + t * 0.7);
        const wu = u + (n1 - 0.5) * 1.15;
        const wv = v + (n2 - 0.5) * 1.15;
        const d2 = wu * wu * 0.85 + wv * wv * 1.15;
        if (d2 > 1.55) continue;
        const fall = clamp(1 - d2, 0, 1);
        const blot = 0.18 + 0.82 * n2;
        const dye = fall * fall * blot * add;
        if (dye < 0.02) continue;
        const i = y * w + x;
        const prev = field[i]!;
        field[i] = energyContribute(prev, dye);
        if (dye >= prev * 0.92) {
          const a = clamp(dye, 0.15, 1);
          this.cr[i] = lerp(this.cr[i]!, tint.r, a);
          this.cg[i] = lerp(this.cg[i]!, tint.g, a);
          this.cb[i] = lerp(this.cb[i]!, tint.b, a);
        }
      }
    }
  }

  step(dtHint: number, regions: Region[], bands: Bands, magic: MagicConfig, master: number, time: number): void {
    let dt = this.lastT > 0 ? (time - this.lastT) / 1000 : dtHint;
    if (!Number.isFinite(dt) || dt <= 0) dt = dtHint || 1 / 60;
    dt = clamp(dt, 0.001, 0.05);
    this.lastT = time;
    this.timeSec = time * 0.001;

    const intensity = clamp(magic.intensity, 0, 1);
    const flow = clamp(magic.flow, 0, 1);
    const spread = clamp(magic.spread, 0, 1);
    const energy = clamp(magic.energy, 0, 1);

    const magRegions = regions.filter((r) => r.effect === "magic");
    this.active = magRegions;
    const seen = new Set<string>();
    const cluster = this.clusterScale();

    let avgEnv = 0;
    let avgImpulse = 0;
    for (const region of magRegions) {
      seen.add(region.id);
      const level = clamp(bandLevel(bands, region.band) * region.intensity * master, 0, 1);
      const b = this.bodyFor(region.id, region.color);
      const respond = 0.55 + energy * 0.45;
      b.env = stepEnvelope(b.env, level * respond, dt, 0.05, 0.28);
      const dEnv = b.env - b.prevEnv;
      const impulseTarget = dEnv > 0.035 ? clamp(dEnv * 6, 0, 1) : 0;
      b.impulse = stepEnvelope(b.impulse, impulseTarget, dt, 0.02, 0.16);
      b.prevEnv = b.env;
      const surgeTarget = b.env > 0.55 ? clamp((b.env - 0.48) / 0.52, 0, 1) : 0;
      b.surge = stepEnvelope(b.surge, surgeTarget, dt, 0.2, 0.36);
      const tgt = magicTargets(b.env, b.surge, spread);
      b.aura = clamp(stepEnvelope(b.aura, tgt.aura, dt, 0.055, 0.24), MAGIC_LIMITS.minAura, MAGIC_LIMITS.maxAura);
      b.reach = clamp(stepEnvelope(b.reach, tgt.reach, dt, 0.05, 0.22), MAGIC_LIMITS.minReach, MAGIC_LIMITS.maxReach);
      avgEnv += b.env;
      avgImpulse += b.impulse;
    }
    const nR = Math.max(1, magRegions.length);
    avgEnv /= nR;
    avgImpulse /= nR;
    for (const id of [...this.bodies.keys()]) if (!seen.has(id)) this.bodies.delete(id);

    this.flowBoost = clamp(0.45 + flow * 1.15 + avgEnv * 0.7 + avgImpulse * 0.9 + (avgEnv > 0.55 ? 0.35 : 0), 0.3, 2.4);
    this.updateVelocity(flow, energy);

    const pxSpeed = clamp(28 + this.flowBoost * 30 + energy * 14, 12, 96);
    this.advect(this.deep, this.buf, dt, pxSpeed * 0.48);
    this.deep.set(this.buf);
    this.advect(this.near, this.buf, dt, pxSpeed);
    this.near.set(this.buf);
    this.advectColor(dt, pxSpeed * 0.7);

    const decayDeep = Math.exp(-dt * (1.15 + (1 - energy) * 0.35));
    const decayNear = Math.exp(-dt * (1.55 + (1 - energy) * 0.45));
    for (let i = 0; i < this.deep.length; i++) {
      this.deep[i]! *= decayDeep;
      this.near[i]! *= decayNear;
    }
    this.diffuse(this.deep, 0.22);
    this.diffuse(this.near, 0.16);

    for (const region of magRegions) {
      const b = this.bodies.get(region.id);
      if (!b) continue;
      const share = cluster.get(region.id) ?? 1;
      const amount = clamp((0.26 + b.impulse * 0.32 + b.surge * 0.12) * b.env * (0.6 + intensity * 0.5) * share, 0, 0.7);
      const rad = region.kind === "stamp" ? region.r * b.aura * (0.85 + spread * 0.4) : region.width * b.aura * 1.1;
      const radY = rad * (0.9 + b.reach * 0.06 + b.surge * 0.08);
      if (region.kind === "stamp") {
        this.splat(this.deep, region.x, region.y, rad * 1.35, radY * 1.25, amount * 0.85, b.seed, region.color);
        this.splat(this.near, region.x, region.y, rad * 0.9, radY * 0.85, amount * (0.7 + b.impulse * 0.5), b.seed + 0.17, region.color);
      } else {
        const pts = region.points;
        const stepN = Math.max(1, Math.ceil(pts.length / 8));
        for (let i = 0; i < pts.length; i += stepN) {
          const p = pts[i]!;
          this.splat(this.deep, p.x, p.y, rad * 1.1, radY * 1.05, amount * 0.62, b.seed + i * 0.03, region.color);
          this.splat(this.near, p.x, p.y, rad * 0.7, radY * 0.68, amount * 0.9, b.seed + i * 0.05, region.color);
        }
      }
    }

    this.peak = 0;
    for (let i = 0; i < this.near.length; i++) {
      const v = this.near[i]! * 0.65 + this.deep[i]! * 0.45;
      if (v > this.peak) this.peak = v;
    }

    let spawned = 0;
    const budget = Math.round(MAGIC_LIMITS.maxSpawns * (0.12 + energy * 0.4 + avgImpulse * 0.25));
    for (const region of magRegions) {
      if (spawned >= budget) break;
      const b = this.bodies.get(region.id);
      if (!b || b.env < 0.14) continue;
      if (this.rand() > 0.18 + b.env * 0.22 + energy * 0.15) continue;
      const p = this.allocSpark();
      if (!p) break;
      const nx = region.kind === "stamp" ? region.x : region.points[Math.floor(this.rand() * Math.max(1, region.points.length - 1))]!.x;
      const ny = region.kind === "stamp" ? region.y : region.points[0]!.y;
      const rad = region.kind === "stamp" ? region.r * b.reach : region.width * b.reach;
      const vel = this.velAt(nx, ny);
      p.live = true;
      p.x = nx + (this.rand() - 0.5) * rad * 0.5;
      p.y = ny + (this.rand() - 0.5) * rad * 0.5;
      p.ox = nx;
      p.oy = ny;
      p.vx = vel.x * 0.015;
      p.vy = vel.y * 0.015;
      p.maxDist = clamp(rad * 1.1, 0.02, 0.22);
      p.maxLife = clamp(0.18 + this.rand() * 0.28, MAGIC_LIMITS.minLife, MAGIC_LIMITS.maxLife);
      p.life = p.maxLife;
      p.size = 0.7 + this.rand() * 1.1;
      p.color = region.color;
      spawned++;
    }

    for (const p of this.sparks) {
      if (!p.live) continue;
      p.life -= dt;
      const dist = Math.hypot(p.x - p.ox, p.y - p.oy);
      if (p.life <= 0 || dist >= p.maxDist) {
        p.live = false;
        continue;
      }
      const vel = this.velAt(p.x, p.y);
      p.x += vel.x * dt * 0.09 * this.flowBoost;
      p.y += vel.y * dt * 0.09 * this.flowBoost;
    }
  }

  draw(ctx: CanvasRenderingContext2D, rect: ImageRect, magic: MagicConfig, master: number): void {
    if (this.peak < 0.02 && this.liveCount() === 0) return;
    const side = minSide(rect);
    const intensity = clamp(magic.intensity, 0, 1);
    const bright = clamp(master * (0.7 + intensity * 0.28), 0, MAGIC_LIMITS.maxBright);
    const w = this.hw;
    const h = this.hh;

    this.drawRefraction(ctx, rect, bright);

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    if (this.fieldCtx && this.pixels && this.fieldCanvas) {
      const data = this.pixels.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const deep = this.deep[i] ?? 0;
          const near = this.near[i] ?? 0;
          const gx = (this.near[i + 1] ?? near) - (this.near[i - 1] ?? near);
          const gy = (this.near[i + w] ?? near) - (this.near[i - w] ?? near);
          const ridge = Math.min(0.35, Math.hypot(gx, gy) * 2.8);
          const v = clamp(deep * 0.48 + near * 0.7 + ridge, 0, 1);
          const o = i * 4;
          if (v < 0.03) {
            data[o] = 0;
            data[o + 1] = 0;
            data[o + 2] = 0;
            data[o + 3] = 0;
            continue;
          }
          const heat = clamp(v * 0.82 + ridge * 0.25, 0, 0.94);
          const dyeR = this.cr[i] || 200;
          const dyeG = this.cg[i] || 140;
          const dyeB = this.cb[i] || 40;
          const col = shadeDye(dyeR, dyeG, dyeB, heat);
          data[o] = col.r;
          data[o + 1] = col.g;
          data[o + 2] = col.b;
          const a = v < 0.12 ? v * 380 : 70 + v * 145;
          data[o + 3] = Math.min(188, a * bright);
        }
      }
      this.fieldCtx.putImageData(this.pixels, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 0.42;
      ctx.drawImage(this.fieldCanvas as CanvasImageSource, rect.x - 6, rect.y - 6, rect.w + 12, rect.h + 12);
      ctx.globalAlpha = 1;
      ctx.drawImage(this.fieldCanvas as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
    }

    this.drawSparks(ctx, rect, side, bright);
    ctx.restore();
  }

  private drawRefraction(ctx: CanvasRenderingContext2D, rect: ImageRect, bright: number): void {
    if (!this.shimmer || !this.shimmerCtx || this.peak < 0.16) return;
    const box = this.fieldAabb();
    if (!box) return;
    const x = rect.x + box.x0 * rect.w;
    const y = rect.y + box.y0 * rect.h;
    const w = (box.x1 - box.x0) * rect.w;
    const h = (box.y1 - box.y0) * rect.h;
    if (w < 10 || h < 10) return;
    const sw = 160;
    const sh = 96;
    const amp = 1.2 + bright * 1.6;
    try {
      this.shimmerCtx.clearRect(0, 0, sw, sh);
      this.shimmerCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
      ctx.save();
      ctx.globalAlpha = 0.16 + this.peak * 0.12;
      const slices = 10;
      for (let i = 0; i < slices; i++) {
        const t = i / slices;
        const vel = this.velAt(box.x0 + 0.5 * (box.x1 - box.x0), box.y0 + t * (box.y1 - box.y0));
        const ox = vel.x * amp;
        const sliceH = sh / slices;
        ctx.drawImage(
          this.shimmer as CanvasImageSource,
          0,
          i * sliceH,
          sw,
          sliceH + 0.5,
          x + ox,
          y + (i * h) / slices,
          w,
          h / slices + 0.5,
        );
      }
      ctx.restore();
    } catch {
      /* tainted canvas */
    }
  }

  private fieldAabb(): { x0: number; y0: number; x1: number; y1: number } | null {
    const w = this.hw;
    const h = this.hh;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let found = false;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if ((this.near[row + x] ?? 0) + (this.deep[row + x] ?? 0) < 0.12) continue;
        found = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (!found) return null;
    return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  }

  private drawSparks(ctx: CanvasRenderingContext2D, rect: ImageRect, side: number, bright: number): void {
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.sparks) {
      if (!p.live) continue;
      const fade = Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI);
      const pos = imageNormToCanvas(p.x, p.y, rect);
      const col = plasmaColor(p.color, 0.72);
      const radius = Math.max(0.4, (p.size * side) / 1400);
      ctx.globalAlpha = bright * fade * 0.45;
      ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},1)`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private allocSpark(): Spark | null {
    for (const p of this.sparks) if (!p.live) return p;
    return null;
  }

  private clusterScale(): Map<string, number> {
    const scale = new Map<string, number>();
    const stamps = this.active.filter((r): r is StampRegion => r.kind === "stamp" && r.effect === "magic");
    for (const r of this.active) scale.set(r.id, 1);
    for (let i = 0; i < stamps.length; i++) {
      const a = stamps[i]!;
      let n = 0;
      for (let j = 0; j < stamps.length; j++) {
        if (i === j) continue;
        const b = stamps[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 2.4) n++;
      }
      if (n > 0) scale.set(a.id, clamp(1 / (1 + n * 0.16), 0.64, 0.92));
    }
    return scale;
  }

  liveCount(): number {
    let n = 0;
    for (const p of this.sparks) if (p.live) n++;
    return n;
  }

  fieldCoverage(): number {
    let n = 0;
    for (let i = 0; i < this.near.length; i++) {
      if ((this.near[i] ?? 0) + (this.deep[i] ?? 0) > 0.1) n++;
    }
    return n;
  }

  extents(): { live: number; minY: number; maxY: number } {
    let live = 0;
    let minY = 1;
    let maxY = 0;
    for (const p of this.sparks) {
      if (!p.live) continue;
      live++;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { live, minY, maxY };
  }

  bodyScale(id: string): { aura: number; reach: number; env: number; surge: number } | null {
    const b = this.bodies.get(id);
    if (!b) return null;
    return { aura: b.aura, reach: b.reach, env: b.env, surge: b.surge };
  }
}
