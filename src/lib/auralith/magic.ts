import { clamp, lerp } from "./id.ts";
import type { Bands, ImageRect, MagicConfig, MagicStyleId, Region, StampRegion } from "./types.ts";
import { imageNormToCanvas, minSide } from "./coords.ts";
import { bandLevel, stepEnvelope } from "./envelope.ts";
import { MagicGL, type MagicEmitterGPU } from "./magic-gl.ts";

interface Spark {
  live: boolean;
  x: number;
  y: number;
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

interface Wisp {
  live: boolean;
  regionId: string;
  xs: Float32Array;
  ys: Float32Array;
  len: number;
  life: number;
  maxLife: number;
  width: number;
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
const WISP_POOL = 28;
const WISP_LEN = 18;

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
  if (!Number.isFinite(n)) return { r: 160, g: 140, b: 255 };
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

export function magicTint(hex: string, shiftDeg: number, lift = 0): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const nh = ((h + shiftDeg / 360) % 1 + 1) % 1;
  const ns = clamp(s * 0.92 + 0.12, 0.25, 0.95);
  const nl = clamp(l * 0.9 + 0.08 + lift * 0.12, 0.18, 0.78);
  return hslToRgb(nh, ns, nl);
}

export function plasmaColor(hex: string, heat: number): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  const t = clamp(heat, 0, 1);
  const nh = ((h - 0.02 * (1 - t)) % 1 + 1) % 1;
  if (t < 0.32) return hslToRgb(nh, clamp(s * 0.9 + 0.18, 0.5, 0.95), lerp(0.14, 0.36, t / 0.32));
  if (t < 0.7) return hslToRgb(nh, clamp(s * 0.88 + 0.16, 0.48, 0.92), lerp(0.36, 0.58, (t - 0.32) / 0.38));
  if (t < 0.9) return hslToRgb(nh, clamp(s * 0.7 + 0.18, 0.4, 0.82), lerp(0.58, 0.74, (t - 0.7) / 0.2));
  return hslToRgb(nh, clamp(s * 0.45 + 0.16, 0.28, 0.62), lerp(0.74, 0.86, (t - 0.9) / 0.1));
}

export function energyContribute(existing: number, add: number): number {
  return existing > add ? existing : add;
}

export function magicTargets(energy: number, surge: number, spread = 0.6): { aura: number; reach: number } {
  const e = clamp(energy, 0, 1);
  const s = clamp(surge, 0, 1);
  const sp = 0.75 + clamp(spread, 0, 1) * 0.55;
  const aura = clamp((MAGIC_LIMITS.minAura + e * 1.05 + s * 0.42) * sp, MAGIC_LIMITS.minAura, MAGIC_LIMITS.maxAura);
  const reach = clamp((MAGIC_LIMITS.minReach + e * 1.35 + s * 0.55) * sp, MAGIC_LIMITS.minReach, MAGIC_LIMITS.maxReach);
  return { aura, reach };
}

export class MagicSim {
  private sparks: Spark[] = [];
  private wisps: Wisp[] = [];
  private field: Float32Array;
  private cr: Uint8Array;
  private cg: Uint8Array;
  private cb: Uint8Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private hw: number;
  private hh: number;
  private vw = 32;
  private vh = 32;
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
  private gl: MagicGL | null | undefined;
  private peak = 0;
  private flowBoost = 0.5;
  private avgEnv = 0;
  private avgImpulse = 0;
  private style: MagicStyleId = "flowing";
  private density = 0.65;

  constructor(w = 120, h = 80) {
    this.hw = w;
    this.hh = h;
    this.field = new Float32Array(w * h);
    this.cr = new Uint8Array(w * h);
    this.cg = new Uint8Array(w * h);
    this.cb = new Uint8Array(w * h);
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
        live: false, x: 0, y: 0, ox: 0, oy: 0, life: 0, maxLife: 1, maxDist: 0.1, size: 1, color: "#88a0ff",
      });
    }
    for (let i = 0; i < WISP_POOL; i++) {
      this.wisps.push({
        live: false, regionId: "", xs: new Float32Array(WISP_LEN), ys: new Float32Array(WISP_LEN),
        len: WISP_LEN, life: 0, maxLife: 1, width: 1, color: "#88a0ff",
      });
    }
  }

  reset(): void {
    this.field.fill(0);
    this.bodies.clear();
    this.lastT = 0;
    this.peak = 0;
    for (const p of this.sparks) p.live = false;
    for (const w of this.wisps) w.live = false;
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng & 2147483647) / 2147483647;
  }

  private bodyFor(id: string, color: string): Body {
    let b = this.bodies.get(id);
    if (!b) {
      b = {
        env: 0, prevEnv: 0, surge: 0, impulse: 0,
        aura: MAGIC_LIMITS.minAura, reach: MAGIC_LIMITS.minReach, seed: hashId(id), color,
      };
      this.bodies.set(id, b);
    }
    b.color = color;
    return b;
  }

  private updateCurl(flow: number, energy: number): void {
    const t = this.timeSec * (0.1 + flow * 0.28);
    const vw = this.vw;
    const vh = this.vh;
    const sc = 0.11;
    for (let y = 0; y < vh; y++) {
      for (let x = 0; x < vw; x++) {
        const psi = (xx: number, yy: number) => fbm(xx * sc + 2.2, yy * sc - t);
        const i = y * vw + x;
        this.vx[i] = (psi(x, y + 1) - psi(x, y - 1)) * (0.7 + energy * 0.5);
        this.vy[i] = (psi(x - 1, y) - psi(x + 1, y)) * (0.7 + energy * 0.5);
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
    return {
      x: lerp(lerp(this.vx[i00]!, this.vx[i10]!, fx), lerp(this.vx[i01]!, this.vx[i11]!, fx), fy),
      y: lerp(lerp(this.vy[i00]!, this.vy[i10]!, fx), lerp(this.vy[i01]!, this.vy[i11]!, fx), fy),
    };
  }

  private splat(nx: number, ny: number, rad: number, amount: number, seed: number, color: string): void {
    const w = this.hw;
    const h = this.hh;
    const cx = nx * w;
    const cy = ny * h;
    const r = Math.max(2, rad * Math.min(w, h));
    const x0 = Math.max(0, (cx - r * 1.6) | 0);
    const x1 = Math.min(w - 1, (cx + r * 1.6) | 0);
    const y0 = Math.max(0, (cy - r * 1.6) | 0);
    const y1 = Math.min(h - 1, (cy + r * 1.6) | 0);
    const add = clamp(amount, 0, 1);
    const t = this.timeSec * 0.25;
    const tint = plasmaColor(color, 0.5);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5 - cx) / r;
        const v = (y + 0.5 - cy) / r;
        const n1 = fbm(u * 1.7 + seed * 7, v * 1.7 - t);
        const n2 = fbm(u * 3.1 + 8, v * 2.6 + t * 0.6);
        const wu = u + (n1 - 0.5) * 1.05;
        const wv = v + (n2 - 0.5) * 1.05;
        const d2 = wu * wu * 0.8 + wv * wv * 1.1;
        if (d2 > 1.5) continue;
        const dye = clamp(1 - d2, 0, 1) * (0.25 + 0.75 * n2) * add;
        if (dye < 0.02) continue;
        const i = y * w + x;
        this.field[i] = energyContribute(this.field[i]!, dye);
        if (dye >= 0.08) {
          this.cr[i] = tint.r;
          this.cg[i] = tint.g;
          this.cb[i] = tint.b;
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
    this.style = magic.style === "dense" ? "dense" : "flowing";
    this.density = clamp(magic.density ?? 0.65, 0, 1);
    const dense = this.style === "dense";

    const decay = Math.exp(-dt * (1.4 + (1 - energy) * 0.4));
    for (let i = 0; i < this.field.length; i++) this.field[i]! *= decay;

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
      b.impulse = stepEnvelope(b.impulse, dEnv > 0.035 ? clamp(dEnv * 6, 0, 1) : 0, dt, 0.018, 0.16);
      b.prevEnv = b.env;
      const surgeTarget = b.env > 0.55 ? clamp((b.env - 0.48) / 0.52, 0, 1) : 0;
      b.surge = stepEnvelope(b.surge, surgeTarget, dt, 0.2, 0.36);
      const tgt = magicTargets(b.env, b.surge, spread);
      b.aura = clamp(stepEnvelope(b.aura, tgt.aura, dt, 0.055, 0.24), MAGIC_LIMITS.minAura, MAGIC_LIMITS.maxAura);
      b.reach = clamp(stepEnvelope(b.reach, tgt.reach, dt, 0.05, 0.22), MAGIC_LIMITS.minReach, MAGIC_LIMITS.maxReach);
      avgEnv += b.env;
      avgImpulse += b.impulse;

      const share = cluster.get(region.id) ?? 1;
      const amount = clamp(b.env * (0.35 + intensity * 0.4) * share * (dense ? 0.82 + this.density * 0.28 : 1), 0, 0.85);
      const rad0 = region.kind === "stamp" ? region.r * b.aura * (0.9 + spread * 0.35) : region.width * b.aura;
      const rad = rad0 * (dense ? 1.18 + this.density * 0.32 + b.surge * 0.16 : 1);
      if (region.kind === "stamp") {
        this.splat(region.x, region.y, rad, amount, b.seed, region.color);
      } else {
        const pts = region.points;
        const stepN = Math.max(1, Math.ceil(pts.length / 8));
        for (let i = 0; i < pts.length; i += stepN) {
          const p = pts[i]!;
          this.splat(p.x, p.y, rad * 0.95, amount * 0.75, b.seed + i * 0.03, region.color);
        }
      }
    }
    const nR = Math.max(1, magRegions.length);
    this.avgEnv = avgEnv / nR;
    this.avgImpulse = avgImpulse / nR;
    for (const id of [...this.bodies.keys()]) if (!seen.has(id)) this.bodies.delete(id);

    this.flowBoost = clamp(0.4 + flow * 1.2 + this.avgEnv * 0.65 + this.avgImpulse * 0.85, 0.25, 2.3);
    this.updateCurl(flow, energy);
    this.syncWisps(magRegions, energy, flow, dt);
    this.stepWisps(dt, flow);

    this.peak = 0;
    for (let i = 0; i < this.field.length; i++) if (this.field[i]! > this.peak) this.peak = this.field[i]!;

    let spawned = 0;
    const budget = Math.round(MAGIC_LIMITS.maxSpawns * (0.12 + energy * 0.35 + this.avgImpulse * 0.2));
    for (const region of magRegions) {
      if (spawned >= budget) break;
      const b = this.bodies.get(region.id);
      if (!b || b.env < 0.12) continue;
      if (this.rand() > 0.16 + b.env * 0.2) continue;
      const p = this.allocSpark();
      if (!p) break;
      const nx = region.kind === "stamp" ? region.x : region.points[Math.floor(this.rand() * Math.max(1, region.points.length - 1))]!.x;
      const ny = region.kind === "stamp" ? region.y : region.points[0]!.y;
      const rad = region.kind === "stamp" ? region.r * b.reach : region.width * b.reach;
      p.live = true;
      p.x = nx + (this.rand() - 0.5) * rad * 0.6;
      p.y = ny + (this.rand() - 0.5) * rad * 0.6;
      p.ox = nx;
      p.oy = ny;
      p.maxDist = clamp(rad * 1.05, 0.02, 0.22);
      p.maxLife = clamp(0.2 + this.rand() * 0.3, MAGIC_LIMITS.minLife, MAGIC_LIMITS.maxLife);
      p.life = p.maxLife;
      p.size = 0.6 + this.rand() * 0.9;
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
      p.x += vel.x * dt * 0.08 * this.flowBoost;
      p.y += vel.y * dt * 0.08 * this.flowBoost;
    }
  }

  draw(ctx: CanvasRenderingContext2D, rect: ImageRect, magic: MagicConfig, master: number): void {
    if (this.peak < 0.015 && this.liveCount() === 0 && !this.wisps.some((w) => w.live)) return;
    const side = minSide(rect);
    const intensity = clamp(magic.intensity, 0, 1);
    const flow = clamp(magic.flow, 0, 1);
    const energy = clamp(magic.energy, 0, 1);
    const bright = clamp(master * (0.72 + intensity * 0.26), 0, MAGIC_LIMITS.maxBright);

    this.drawRefraction(ctx, rect, bright);

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    const usedGl = this.drawVolume(ctx, rect, magic, bright);
    if (!usedGl) this.drawFieldFallback(ctx, rect, bright);

    this.drawWisps(ctx, rect, side, flow, energy, bright);
    this.drawSparks(ctx, rect, side, bright);
    ctx.restore();
  }

  private drawVolume(ctx: CanvasRenderingContext2D, rect: ImageRect, magic: MagicConfig, bright: number): boolean {
    if (this.gl === undefined) this.gl = MagicGL.tryCreate();
    if (!this.gl) return false;
    const emitters = this.gpuEmitters();
    if (!emitters.length) return false;
    const ok = this.gl.render(
      emitters,
      {
        time: this.timeSec,
        flow: clamp(magic.flow, 0, 1),
        energy: clamp(magic.energy, 0, 1),
        intensity: clamp(magic.intensity, 0, 1) * (0.75 + this.avgEnv * 0.45),
        bright,
        style: this.style,
        density: clamp(this.density * (0.5 + this.avgEnv * 0.45 + this.avgImpulse * 0.18), 0, 1),
      },
      rect.w,
      rect.h,
    );
    if (!ok) return false;
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.gl.canvas, rect.x, rect.y, rect.w, rect.h);
    return true;
  }

  private gpuEmitters(): MagicEmitterGPU[] {
    const out: MagicEmitterGPU[] = [];
    for (const region of this.active) {
      if (out.length >= 16) break;
      const b = this.bodies.get(region.id);
      if (!b || b.env < 0.03) continue;
      const rgb = hexToRgb(region.color);
      const grow = this.style === "dense" ? 1.18 + this.density * 0.38 + b.surge * 0.16 : 1;
      const rad = (region.kind === "stamp" ? region.r * b.aura * 0.95 : region.width * b.aura * 1.1) * grow;
      if (region.kind === "stamp") {
        out.push({
          x: region.x, y: region.y, rx: rad * 0.85, ry: rad * 0.9,
          env: b.env, surge: b.surge, seed: b.seed, r: rgb.r, g: rgb.g, b: rgb.b,
        });
      } else {
        const pts = region.points;
        const stepN = Math.max(1, Math.ceil(pts.length / 5));
        for (let i = 0; i < pts.length && out.length < 16; i += stepN) {
          const p = pts[i]!;
          out.push({
            x: p.x, y: p.y, rx: rad * 0.7, ry: rad * 0.75,
            env: b.env * 0.9, surge: b.surge, seed: b.seed + i * 0.02,
            r: rgb.r, g: rgb.g, b: rgb.b,
          });
        }
      }
    }
    return out;
  }

  private drawFieldFallback(ctx: CanvasRenderingContext2D, rect: ImageRect, bright: number): void {
    if (!this.fieldCtx || !this.pixels || !this.fieldCanvas) return;
    const data = this.pixels.data;
    for (let i = 0; i < this.field.length; i++) {
      const v = this.field[i] ?? 0;
      const o = i * 4;
      if (v < 0.04) {
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0;
        continue;
      }
      const col = plasmaColor(
        `#${((1 << 24) + (this.cr[i]! << 16) + (this.cg[i]! << 8) + this.cb[i]!).toString(16).slice(1)}`,
        clamp(v * 0.8, 0, 0.9),
      );
      data[o] = col.r;
      data[o + 1] = col.g;
      data[o + 2] = col.b;
      data[o + 3] = Math.min(170, v * 200 * bright);
    }
    this.fieldCtx.putImageData(this.pixels, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.fieldCanvas as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
  }

  private syncWisps(regions: Region[], energy: number, flow: number, dt: number): void {
    void dt;
    void flow;
    for (const region of regions) {
      const b = this.bodies.get(region.id);
      if (!b || b.env < 0.06) continue;
      const want =
        this.style === "dense"
          ? 1 + Math.round(this.density * 2 + b.surge * 2 + b.env)
          : 2 + Math.round(energy * 3 + b.surge * 3 + b.env * 2);
      let have = 0;
      for (const w of this.wisps) if (w.live && w.regionId === region.id) have++;
      for (let k = have; k < want; k++) {
        const slot = this.wisps.find((w) => !w.live);
        if (!slot) return;
        const nx = region.kind === "stamp" ? region.x : region.points[0]!.x;
        const ny = region.kind === "stamp" ? region.y : region.points[0]!.y;
        const rad = region.kind === "stamp" ? region.r : region.width;
        const ox = nx + (this.rand() - 0.5) * rad * 0.8;
        const oy = ny + (this.rand() - 0.5) * rad * 0.8;
        slot.live = true;
        slot.regionId = region.id;
        slot.color = region.color;
        slot.life = 0;
        slot.maxLife = 1.4 + this.rand() * 1.8;
        slot.width = this.style === "dense" ? 1.35 + this.rand() * 1.05 : 0.7 + this.rand() * 0.8;
        for (let i = 0; i < WISP_LEN; i++) {
          slot.xs[i] = ox;
          slot.ys[i] = oy;
        }
      }
    }
    for (const w of this.wisps) {
      if (w.live && !regions.some((r) => r.id === w.regionId)) w.live = false;
    }
  }

  private stepWisps(dt: number, flow: number): void {
    for (const w of this.wisps) {
      if (!w.live) continue;
      w.life += dt;
      if (w.life >= w.maxLife) {
        w.live = false;
        continue;
      }
      const hx = w.xs[0]!;
      const hy = w.ys[0]!;
      const vel = this.velAt(hx, hy);
      const speed = (0.018 + flow * 0.04) * this.flowBoost;
      const nx = clamp(hx + vel.x * speed, 0.02, 0.98);
      const ny = clamp(hy + vel.y * speed, 0.02, 0.98);
      for (let i = WISP_LEN - 1; i > 0; i--) {
        w.xs[i] = w.xs[i - 1]!;
        w.ys[i] = w.ys[i - 1]!;
      }
      w.xs[0] = nx;
      w.ys[0] = ny;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < WISP_LEN - 1; i++) {
          w.xs[i] = w.xs[i]! * 0.5 + w.xs[i - 1]! * 0.25 + w.xs[i + 1]! * 0.25;
          w.ys[i] = w.ys[i]! * 0.5 + w.ys[i - 1]! * 0.25 + w.ys[i + 1]! * 0.25;
        }
      }
    }
  }

  private drawWisps(
    ctx: CanvasRenderingContext2D,
    rect: ImageRect,
    side: number,
    flow: number,
    energy: number,
    bright: number,
  ): void {
    void flow;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const w of this.wisps) {
      if (!w.live) continue;
      const body = this.bodies.get(w.regionId);
      if (!body || body.env < 0.04) continue;
      const fade = Math.sin(Math.min(1, w.life / w.maxLife) * Math.PI);
      const col = plasmaColor(w.color, 0.55 + energy * 0.15);
      const hi = plasmaColor(w.color, 0.82);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < WISP_LEN; i++) {
        const p = imageNormToCanvas(w.xs[i]!, w.ys[i]!, rect);
        pts.push(p);
      }
      const draw = (width: number, rgb: { r: number; g: number; b: number }, a: number) => {
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${a * fade * bright})`;
        ctx.lineWidth = Math.max(0.8, width * (side / 720) * w.width * (0.85 + body.env * 0.4));
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length - 1; i += 1) {
          const nx = (pts[i]!.x + pts[i + 1]!.x) * 0.5;
          const ny = (pts[i]!.y + pts[i + 1]!.y) * 0.5;
          ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, nx, ny);
        }
        ctx.lineTo(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y);
        ctx.stroke();
      };
      if (this.style === "dense") {
        draw(28, col, 0.08);
        draw(13, col, 0.15);
        draw(4.4, hi, 0.28);
      } else {
        draw(14, col, 0.07);
        draw(5.5, col, 0.18);
        draw(1.6, hi, 0.38);
      }
    }
  }

  private drawSparks(ctx: CanvasRenderingContext2D, rect: ImageRect, side: number, bright: number): void {
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.sparks) {
      if (!p.live) continue;
      const fade = Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI);
      const pos = imageNormToCanvas(p.x, p.y, rect);
      const col = plasmaColor(p.color, 0.78);
      ctx.globalAlpha = bright * fade * 0.4;
      ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},1)`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(0.35, (p.size * side) / 1500), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawRefraction(ctx: CanvasRenderingContext2D, rect: ImageRect, bright: number): void {
    if (!this.shimmer || !this.shimmerCtx || this.peak < 0.14) return;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0, found = false;
    const w = this.hw, h = this.hh;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((this.field[y * w + x] ?? 0) < 0.12) continue;
        found = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (!found) return;
    const rx = rect.x + (x0 / w) * rect.w;
    const ry = rect.y + (y0 / h) * rect.h;
    const rw = ((x1 - x0 + 1) / w) * rect.w;
    const rh = ((y1 - y0 + 1) / h) * rect.h;
    if (rw < 12 || rh < 12) return;
    try {
      this.shimmerCtx.clearRect(0, 0, 160, 96);
      this.shimmerCtx.drawImage(ctx.canvas, rx, ry, rw, rh, 0, 0, 160, 96);
      ctx.save();
      ctx.globalAlpha = 0.14 + bright * 0.08;
      const slices = 8;
      for (let i = 0; i < slices; i++) {
        const vel = this.velAt((x0 + x1) / 2 / w, (y0 + (i / slices) * (y1 - y0)) / h);
        const ox = vel.x * (1.1 + bright);
        ctx.drawImage(this.shimmer as CanvasImageSource, 0, (i * 96) / slices, 160, 96 / slices + 0.5, rx + ox, ry + (i * rh) / slices, rw, rh / slices + 0.5);
      }
      ctx.restore();
    } catch { /* tainted */ }
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
        if (Math.hypot(a.x - stamps[j]!.x, a.y - stamps[j]!.y) < (a.r + stamps[j]!.r) * 2.4) n++;
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
    for (let i = 0; i < this.field.length; i++) if ((this.field[i] ?? 0) > 0.1) n++;
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
