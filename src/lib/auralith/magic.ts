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
  hueShift: number;
  color: string;
}

interface Body {
  env: number;
  surge: number;
  aura: number;
  reach: number;
  seed: number;
  color: string;
}

interface Tendril {
  live: boolean;
  regionId: string;
  lean: number;
  phase: number;
  hueShift: number;
  color: string;
  forks: number;
}

export const MAGIC_LIMITS = {
  minAura: 0.85,
  maxAura: 2.45,
  minReach: 0.7,
  maxReach: 2.85,
  maxSparks: 64,
  maxSpawns: 4,
  maxTendrils: 48,
  maxBright: 0.9,
  maxLife: 0.55,
  minLife: 0.12,
} as const;

const SPARK_POOL = MAGIC_LIMITS.maxSparks;
const TENDRIL_POOL = MAGIC_LIMITS.maxTendrils;

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
 * Plasma palette along a tendril: dark rim → saturated mid → near-white core.
 * Heat 1 is a bright tinted core, never RGB 255,255,255.
 */
export function plasmaColor(hex: string, heat: number): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  const t = clamp(heat, 0, 1);
  const nh = ((h - 0.018 * (1 - t) + 0.01 * t) % 1 + 1) % 1;
  if (t < 0.35) {
    const k = t / 0.35;
    return hslToRgb(nh, clamp(s * 0.95 + 0.12, 0.45, 0.95), lerp(0.18, 0.42, k));
  }
  if (t < 0.72) {
    const k = (t - 0.35) / 0.37;
    return hslToRgb(nh, clamp(s * 0.85 + 0.18, 0.4, 0.92), lerp(0.42, 0.68, k));
  }
  const k = (t - 0.72) / 0.28;
  return hslToRgb(nh, clamp(s * 0.62 + 0.22, 0.38, 0.78), lerp(0.66, 0.86, k));
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
  private tendrils: Tendril[] = [];
  private field: Float32Array;
  private cr: Uint8Array;
  private cg: Uint8Array;
  private cb: Uint8Array;
  private hw: number;
  private hh: number;
  private rng = 1;
  private lastT = 0;
  private timeSec = 0;
  private bodies = new Map<string, Body>();
  private active: Region[] = [];
  private fieldCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private fieldCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private pixels: ImageData | null = null;
  private peak = 0;

  constructor(w = 220, h = 160) {
    this.hw = w;
    this.hh = h;
    this.field = new Float32Array(w * h);
    this.cr = new Uint8Array(w * h);
    this.cg = new Uint8Array(w * h);
    this.cb = new Uint8Array(w * h);
    if (typeof OffscreenCanvas !== "undefined") {
      this.fieldCanvas = new OffscreenCanvas(w, h);
    } else if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      this.fieldCanvas = c;
    }
    this.fieldCtx = this.fieldCanvas
      ? (this.fieldCanvas.getContext("2d", { alpha: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null)
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
        size: 1.2,
        hueShift: 0,
        color: "#e8c47a",
      });
    }
    for (let i = 0; i < TENDRIL_POOL; i++) {
      this.tendrils.push({ live: false, regionId: "", lean: 0, phase: 0, hueShift: 0, color: "#e8c47a", forks: 1 });
    }
  }

  reset(): void {
    this.field.fill(0);
    this.cr.fill(0);
    this.cg.fill(0);
    this.cb.fill(0);
    this.bodies.clear();
    this.lastT = 0;
    this.peak = 0;
    for (const p of this.sparks) p.live = false;
    for (const t of this.tendrils) t.live = false;
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng & 2147483647) / 2147483647;
  }

  /**
   * Rising forked plasma kernel: dense anchored base, jagged vertical
   * filaments, transparent gaps. Matches the lightning-wisp reference.
   */
  private stampPlasma(
    nx: number,
    ny: number,
    halfW: number,
    height: number,
    amount: number,
    seed: number,
    turb: number,
    flow: number,
    color: string,
  ): void {
    const hw = this.hw;
    const hh = this.hh;
    const cx = nx * hw;
    const cy = ny * hh;
    const rise = Math.max(4, height * hh);
    const base = Math.max(1.6, halfW * hw);
    const x0 = Math.max(0, Math.floor(cx - base * 1.55));
    const x1 = Math.min(hw - 1, Math.ceil(cx + base * 1.55));
    const y0 = Math.max(0, Math.floor(cy - rise * 1.08));
    const y1 = Math.min(hh - 1, Math.ceil(cy + base * 0.22));
    const add = clamp(amount, 0, 1);
    const t = this.timeSec * (0.45 + flow * 1.55);
    const coreCol = plasmaColor(color, 0.92);
    const midCol = plasmaColor(color, 0.55);
    const rimCol = plasmaColor(color, 0.18);

    for (let y = y0; y <= y1; y++) {
      const v = (cy - (y + 0.5)) / rise;
      if (v < -0.12 || v > 1.12) continue;
      const vy = v < 0 ? 0 : v;
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5 - cx) / base;
        let best = 0;
        for (let k = 0; k < 6; k++) {
          const ph = seed * 11 + k * 1.63;
          let center = (fbm(ph, vy * 2.6 - t * 1.15) - 0.5) * (0.18 + vy * 1.7) * turb;
          center += (fbm(ph + 9.1, vy * 8.4 - t * 2.6) - 0.5) * vy * vy * 0.95 * turb;
          const d = Math.abs(u - center);
          const thick = (0.045 + 0.11 * (1 - vy) * (1 - vy)) * (1.08 - k * 0.08);
          const fil = Math.exp(-(d * d) / Math.max(0.003, thick * thick * 0.48));
          const flick = 0.28 + 0.72 * fbm(ph + t * 0.7, vy * 3.2);
          if (fil * flick > best) best = fil * flick;
        }
        const bloom = Math.exp(-(u * u) / (0.55 + vy * 0.2) - Math.max(0, vy) * 1.35) * (0.34 * (1 - vy * 0.82));
        const energy = clamp(best * (0.5 + 0.5 * Math.exp(-vy * 0.55)) * add + bloom * add * 0.5, 0, 1);
        if (energy < 0.03) continue;
        const i = y * hw + x;
        const prev = this.field[i]!;
        this.field[i] = energyContribute(prev, energy);
        if (energy >= prev) {
          const col = energy > 0.72 ? coreCol : energy > 0.32 ? midCol : rimCol;
          this.cr[i] = col.r;
          this.cg[i] = col.g;
          this.cb[i] = col.b;
        }
      }
    }
  }

  private bodyFor(id: string, color: string): Body {
    let b = this.bodies.get(id);
    if (!b) {
      b = {
        env: 0,
        surge: 0,
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

    const decay = Math.exp(-dt * (3.6 + (1 - energy) * 0.5));
    for (let i = 0; i < this.field.length; i++) this.field[i]! *= decay;

    const magRegions = regions.filter((r) => r.effect === "magic");
    this.active = magRegions;
    const seen = new Set<string>();
    const cluster = this.clusterScale();

    let tendrilNeed = 0;
    for (const region of magRegions) {
      seen.add(region.id);
      const level = clamp(bandLevel(bands, region.band) * region.intensity * master, 0, 1);
      const b = this.bodyFor(region.id, region.color);
      const respond = 0.55 + energy * 0.45;
      b.env = stepEnvelope(b.env, level * respond, dt, 0.05, 0.28);
      const surgeTarget = b.env > 0.55 ? clamp((b.env - 0.48) / 0.52, 0, 1) : 0;
      b.surge = stepEnvelope(b.surge, surgeTarget, dt, 0.2, 0.36);
      const tgt = magicTargets(b.env, b.surge, spread);
      b.aura = clamp(stepEnvelope(b.aura, tgt.aura, dt, 0.055, 0.24), MAGIC_LIMITS.minAura, MAGIC_LIMITS.maxAura);
      b.reach = clamp(stepEnvelope(b.reach, tgt.reach, dt, 0.05, 0.22), MAGIC_LIMITS.minReach, MAGIC_LIMITS.maxReach);

      const share = cluster.get(region.id) ?? 1;
      const amount = clamp(b.env * (0.55 + intensity * 0.5) * share, 0, 0.96);
      const turb = clamp(0.42 + energy * 0.55 + b.surge * 0.4, 0, 1.25);
      const halfW = region.kind === "stamp" ? region.r * b.aura * 0.85 : region.width * b.aura;
      const height = region.kind === "stamp" ? region.r * b.reach * 2.15 : region.width * b.reach * 2.4;
      if (region.kind === "stamp") {
        this.stampPlasma(region.x, region.y, halfW, height, amount, b.seed, turb, flow, region.color);
      } else {
        const pts = region.points;
        const stepN = Math.max(1, Math.ceil(pts.length / 8));
        for (let i = 0; i < pts.length; i += stepN) {
          const p = pts[i]!;
          this.stampPlasma(p.x, p.y, halfW * 0.9, height * 0.9, amount * 0.82, b.seed + i * 0.02, turb, flow, region.color);
        }
      }
      tendrilNeed += 4 + Math.round(energy * 4 + b.surge * 4 + spread * 2);
    }
    for (const id of [...this.bodies.keys()]) if (!seen.has(id)) this.bodies.delete(id);

    this.syncTendrils(magRegions, tendrilNeed, energy, spread);

    this.peak = 0;
    for (let i = 0; i < this.field.length; i++) if (this.field[i]! > this.peak) this.peak = this.field[i]!;

    let spawned = 0;
    const budget = Math.round(MAGIC_LIMITS.maxSpawns * (0.15 + energy * 0.5 + (this.peak > 0.4 ? 0.2 : 0)));
    for (const region of magRegions) {
      if (spawned >= budget) break;
      const b = this.bodies.get(region.id);
      if (!b || b.env < 0.12) continue;
      if (this.rand() > 0.22 + b.env * 0.3 + energy * 0.2) continue;
      const p = this.allocSpark();
      if (!p) break;
      const heightN = region.kind === "stamp" ? region.r * b.reach * 2.15 : region.width * b.reach * 2.4;
      const widthN = region.kind === "stamp" ? region.r * b.aura : region.width * b.aura;
      const nx = region.kind === "stamp" ? region.x : region.points[Math.floor(this.rand() * Math.max(1, region.points.length - 1))]!.x;
      const ny = region.kind === "stamp" ? region.y : region.points[0]!.y;
      p.live = true;
      p.x = nx + (this.rand() - 0.5) * widthN * 0.7;
      p.y = ny - heightN * (0.2 + this.rand() * 0.25);
      p.ox = nx;
      p.oy = ny;
      p.vx = (this.rand() - 0.5) * 0.05;
      p.vy = -clamp(0.05 + b.env * 0.1 + flow * 0.08, 0.03, 0.28);
      p.maxDist = clamp(heightN * 0.35, 0.02, 0.18);
      p.maxLife = clamp(0.14 + this.rand() * 0.24, MAGIC_LIMITS.minLife, MAGIC_LIMITS.maxLife);
      p.life = p.maxLife;
      p.size = 0.8 + this.rand() * 1.4;
      p.hueShift = (this.rand() - 0.5) * 18;
      p.color = region.color;
      spawned++;
    }

    for (const p of this.sparks) {
      if (!p.live) continue;
      p.life -= dt;
      const dist = Math.hypot(p.x - p.ox, p.y - p.oy);
      if (p.life <= 0 || dist >= p.maxDist || p.y < p.oy - p.maxDist) {
        p.live = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.x += Math.sin(this.timeSec * (5 + flow * 6) + p.ox * 20) * 0.008 * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, rect: ImageRect, magic: MagicConfig, master: number): void {
    if (this.peak < 0.02 && this.liveCount() === 0) return;
    const side = minSide(rect);
    const intensity = clamp(magic.intensity, 0, 1);
    const flow = clamp(magic.flow, 0, 1);
    const energy = clamp(magic.energy, 0, 1);
    const bright = clamp(master * (0.72 + intensity * 0.28), 0, MAGIC_LIMITS.maxBright);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    this.drawBaseBloom(ctx, rect, side, bright);

    if (this.fieldCtx && this.pixels && this.fieldCanvas) {
      const data = this.pixels.data;
      for (let i = 0; i < this.field.length; i++) {
        const v = clamp(this.field[i] ?? 0, 0, 1);
        const o = i * 4;
        if (v < 0.035) {
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 0;
          continue;
        }
        data[o] = this.cr[i] || 232;
        data[o + 1] = this.cg[i] || 180;
        data[o + 2] = this.cb[i] || 70;
        data[o + 3] = Math.min(205, v * 230 * bright);
      }
      this.fieldCtx.putImageData(this.pixels, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 1;
      ctx.drawImage(this.fieldCanvas as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
    }

    this.drawTendrils(ctx, rect, side, flow, energy, bright);
    this.drawSparks(ctx, rect, side, bright);
    ctx.restore();
  }

  private drawBaseBloom(ctx: CanvasRenderingContext2D, rect: ImageRect, side: number, bright: number): void {
    const cluster = this.clusterScale();
    for (const region of this.active) {
      const body = this.bodies.get(region.id);
      if (!body || body.env < 0.04) continue;
      const origin =
        region.kind === "stamp"
          ? imageNormToCanvas(region.x, region.y, rect)
          : imageNormToCanvas(region.points[0]!.x, region.points[0]!.y, rect);
      const baseR = (region.kind === "stamp" ? region.r : region.width) * side;
      const share = cluster.get(region.id) ?? 1;
      const rx = clamp(baseR * body.aura * 1.35, 6, baseR * MAGIC_LIMITS.maxAura);
      const ry = clamp(baseR * body.reach * 1.1, 8, baseR * MAGIC_LIMITS.maxReach);
      const col = plasmaColor(body.color, 0.45);
      ctx.save();
      ctx.translate(origin.x, origin.y - ry * 0.15);
      ctx.scale(1, Math.max(1.15, ry / Math.max(1, rx)));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(${col.r},${col.g},${col.b},${0.32 * body.env * share * bright})`);
      g.addColorStop(0.45, `rgba(${col.r},${col.g},${col.b},${0.12 * body.env * share * bright})`);
      g.addColorStop(1, `rgba(${col.r},${col.g},${col.b},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawTendrils(
    ctx: CanvasRenderingContext2D,
    rect: ImageRect,
    side: number,
    flow: number,
    energy: number,
    bright: number,
  ): void {
    const t = this.timeSec;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const tr of this.tendrils) {
      if (!tr.live) continue;
      const region = this.active.find((r) => r.id === tr.regionId);
      const body = this.bodies.get(tr.regionId);
      if (!region || !body || body.env < 0.04) continue;
      const origin =
        region.kind === "stamp"
          ? imageNormToCanvas(region.x, region.y, rect)
          : imageNormToCanvas(region.points[0]!.x, region.points[0]!.y, rect);
      const baseR = (region.kind === "stamp" ? region.r : region.width) * side;
      const len = clamp(baseR * body.reach * (1.55 + body.surge * 0.7), 10, baseR * MAGIC_LIMITS.maxReach * 2.1);
      const jagAmp = (0.12 + energy * 0.22 + body.surge * 0.12) * len;
      const steps = 14;
      const core = plasmaColor(tr.color, 0.88);
      const glow = plasmaColor(tr.color, 0.4);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const kink = (hash2(i * 3 + (tr.phase * 17) | 0, (tr.phase * 9) | 0) - 0.5) * 2;
        const wob = Math.sin(t * (3.4 + flow * 5) + tr.phase + u * 9) * 0.22;
        const x = origin.x + tr.lean * len * u * 0.55 + (kink + wob) * jagAmp * u;
        const y = origin.y - len * u * (0.92 + 0.08 * hash2(i, (tr.phase * 5) | 0));
        pts.push({ x, y });
      }
      ctx.strokeStyle = `rgba(${glow.r},${glow.g},${glow.b},${0.22 + body.env * 0.28 * bright})`;
      ctx.lineWidth = Math.max(2.4, (4.5 + energy * 3.2) * (side / 720) * (1 - 0.15));
      this.strokePts(ctx, pts);
      ctx.strokeStyle = `rgba(${core.r},${core.g},${core.b},${0.55 + body.env * 0.4 * bright})`;
      ctx.lineWidth = Math.max(0.8, (1.15 + energy * 0.7) * (side / 900));
      this.strokePts(ctx, pts);

      for (let f = 1; f <= tr.forks; f++) {
        const start = 5 + f * 2;
        if (start >= pts.length - 2) continue;
        const root = pts[start]!;
        const dir = tr.lean >= 0 ? 1 : -1;
        const flen = len * (0.28 + 0.12 * f);
        const fpts: { x: number; y: number }[] = [root];
        const n = 7;
        for (let i = 1; i <= n; i++) {
          const u = i / n;
          const kink = (hash2(i + f * 11, (tr.phase * 13) | 0) - 0.5) * 2;
          fpts.push({
            x: root.x + dir * flen * u * (0.55 + 0.2 * f) + kink * jagAmp * 0.45 * u,
            y: root.y - flen * u * 0.85,
          });
        }
        ctx.strokeStyle = `rgba(${glow.r},${glow.g},${glow.b},${0.16 + body.env * 0.22 * bright})`;
        ctx.lineWidth = Math.max(1.6, 3 * (side / 800));
        this.strokePts(ctx, fpts);
        ctx.strokeStyle = `rgba(${core.r},${core.g},${core.b},${0.45 + body.env * 0.3 * bright})`;
        ctx.lineWidth = Math.max(0.7, 1.05 * (side / 900));
        this.strokePts(ctx, fpts);
      }
    }
  }

  private strokePts(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.stroke();
  }

  private drawSparks(ctx: CanvasRenderingContext2D, rect: ImageRect, side: number, bright: number): void {
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.sparks) {
      if (!p.live) continue;
      const fade = Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI);
      const pos = imageNormToCanvas(p.x, p.y, rect);
      const col = plasmaColor(p.color, 0.8);
      const radius = Math.max(0.45, (p.size * side) / 1200);
      ctx.globalAlpha = bright * fade * 0.75;
      ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},1)`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private syncTendrils(regions: Region[], want: number, energy: number, spread: number): void {
    const cap = clamp(Math.round(want * (0.55 + energy * 0.5)), 0, TENDRIL_POOL);
    const live = this.tendrils.filter((t) => t.live);
    if (live.length > cap) {
      for (let i = cap; i < live.length; i++) live[i]!.live = false;
    }
    for (const region of regions) {
      const body = this.bodies.get(region.id);
      if (!body) continue;
      const n = 4 + Math.round(energy * 4 + body.surge * 3 + spread * 2);
      let have = 0;
      for (const t of this.tendrils) if (t.live && t.regionId === region.id) have++;
      for (let k = have; k < n; k++) {
        const slot = this.tendrils.find((t) => !t.live);
        if (!slot) return;
        const u = n <= 1 ? 0 : k / (n - 1) - 0.5;
        slot.live = true;
        slot.regionId = region.id;
        slot.lean = u * (0.7 + spread * 0.7) + (body.seed - 0.5) * 0.15;
        slot.phase = body.seed * 14 + k * 1.9;
        slot.hueShift = (k % 2 === 0 ? 8 : -10);
        slot.color = region.color;
        slot.forks = energy + body.surge > 0.7 ? 2 : energy > 0.35 ? 1 : 0;
      }
    }
    for (const t of this.tendrils) {
      if (!t.live) continue;
      if (!regions.some((r) => r.id === t.regionId)) t.live = false;
      else {
        const r = regions.find((x) => x.id === t.regionId);
        if (r) t.color = r.color;
      }
    }
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
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 2.3) n++;
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
