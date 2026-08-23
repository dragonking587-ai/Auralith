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
  angle: number;
  phase: number;
  hueShift: number;
  color: string;
}

export const MAGIC_LIMITS = {
  minAura: 0.85,
  maxAura: 2.45,
  minReach: 0.7,
  maxReach: 2.85,
  maxSparks: 64,
  maxSpawns: 4,
  maxTendrils: 36,
  maxBright: 0.86,
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
  return valueNoise(x, y) * 0.55 + valueNoise(x * 2.07 + 11, y * 2.07 + 4) * 0.3 + valueNoise(x * 4.1 + 27, y * 4.1 + 19) * 0.15;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (!Number.isFinite(n)) return { r: 180, g: 160, b: 255 };
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

  constructor(w = 192, h = 108) {
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
        size: 1.4,
        hueShift: 0,
        color: "#c8b8ff",
      });
    }
    for (let i = 0; i < TENDRIL_POOL; i++) {
      this.tendrils.push({ live: false, regionId: "", angle: 0, phase: 0, hueShift: 0, color: "#c8b8ff" });
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

  /** Radial, gapped energy kernel — wisps, not a filled disc. */
  private stampAura(
    nx: number,
    ny: number,
    radiusN: number,
    amount: number,
    seed: number,
    turb: number,
    flow: number,
    hueShift: number,
    color: string,
  ): void {
    const hw = this.hw;
    const hh = this.hh;
    const cx = nx * hw;
    const cy = ny * hh;
    const rad = Math.max(2.2, radiusN * Math.min(hw, hh));
    const x0 = Math.max(0, Math.floor(cx - rad * 1.25));
    const x1 = Math.min(hw - 1, Math.ceil(cx + rad * 1.25));
    const y0 = Math.max(0, Math.floor(cy - rad * 1.25));
    const y1 = Math.min(hh - 1, Math.ceil(cy + rad * 1.25));
    const add = clamp(amount, 0, 1);
    const t = this.timeSec * (0.35 + flow * 1.4);
    const tint = magicTint(color, hueShift, 0.08);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rad;
        const dy = (y + 0.5 - cy) / rad;
        const dist = Math.hypot(dx, dy);
        if (dist > 1.28) continue;
        const ang = Math.atan2(dy, dx);
        const n = fbm(Math.cos(ang) * 1.4 + seed * 9 + t * 0.6, dist * 2.3 - t + seed * 4);
        const n2 = fbm(ang * 0.9 + t * 0.85 + seed * 3, dist * 3.1 - t * 1.3);
        const spokes = 0.22 + 0.78 * Math.abs(Math.sin(ang * 3.5 + n2 * 2.8 + seed * 6.1));
        const radiusMod = 0.55 + 0.55 * n * turb + 0.2 * spokes;
        if (dist > radiusMod * 1.05) continue;
        const fall = 1 - dist / Math.max(0.12, radiusMod);
        const gaps = Math.pow(spokes, 1.15);
        const core = Math.exp(-dist * dist * 5.2);
        const energy = clamp(fall * gaps * 0.72 + core * 0.38, 0, 1) * add;
        if (energy < 0.02) continue;
        const i = y * hw + x;
        const prev = this.field[i]!;
        this.field[i] = energyContribute(prev, energy);
        if (energy >= prev) {
          this.cr[i] = tint.r;
          this.cg[i] = tint.g;
          this.cb[i] = tint.b;
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

    const decay = Math.exp(-dt * (3.4 + (1 - energy) * 0.6));
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
      const t = magicTargets(b.env, b.surge, spread);
      b.aura = clamp(stepEnvelope(b.aura, t.aura, dt, 0.055, 0.24), MAGIC_LIMITS.minAura, MAGIC_LIMITS.maxAura);
      b.reach = clamp(stepEnvelope(b.reach, t.reach, dt, 0.05, 0.22), MAGIC_LIMITS.minReach, MAGIC_LIMITS.maxReach);

      const share = cluster.get(region.id) ?? 1;
      const amount = clamp(b.env * (0.5 + intensity * 0.5) * share, 0, 0.94);
      const turb = clamp(0.35 + energy * 0.55 + b.surge * 0.35, 0, 1.2);
      const hueJitter = (b.seed - 0.5) * 28;
      if (region.kind === "stamp") {
        this.stampAura(region.x, region.y, region.r * b.aura, amount, b.seed, turb, flow, hueJitter, region.color);
      } else {
        const pts = region.points;
        const stepN = Math.max(1, Math.ceil(pts.length / 9));
        for (let i = 0; i < pts.length; i += stepN) {
          const p = pts[i]!;
          this.stampAura(p.x, p.y, region.width * b.aura * 1.15, amount * 0.8, b.seed + i * 0.02, turb, flow, hueJitter, region.color);
        }
      }
      tendrilNeed += 3 + Math.round(energy * 3 + b.surge * 2);
    }
    for (const id of [...this.bodies.keys()]) if (!seen.has(id)) this.bodies.delete(id);

    this.syncTendrils(magRegions, tendrilNeed, energy);

    this.peak = 0;
    for (let i = 0; i < this.field.length; i++) if (this.field[i]! > this.peak) this.peak = this.field[i]!;

    let spawned = 0;
    const budget = Math.round(MAGIC_LIMITS.maxSpawns * (0.2 + energy * 0.55 + (this.peak > 0.35 ? 0.15 : 0)));
    for (const region of magRegions) {
      if (spawned >= budget) break;
      const b = this.bodies.get(region.id);
      if (!b || b.env < 0.1) continue;
      if (this.rand() > 0.28 + b.env * 0.35 + energy * 0.2) continue;
      const p = this.allocSpark();
      if (!p) break;
      const baseR = region.kind === "stamp" ? region.r * b.reach : region.width * b.reach;
      const ang = this.rand() * Math.PI * 2;
      const nx = region.kind === "stamp" ? region.x : region.points[Math.floor(this.rand() * Math.max(1, region.points.length - 1))]!.x;
      const ny = region.kind === "stamp" ? region.y : region.points[0]!.y;
      p.live = true;
      p.x = nx + Math.cos(ang) * baseR * 0.15;
      p.y = ny + Math.sin(ang) * baseR * 0.15;
      p.ox = nx;
      p.oy = ny;
      const speed = (0.04 + b.env * 0.08 + flow * 0.06) * (0.6 + this.rand() * 0.6);
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed;
      p.maxDist = clamp(baseR * 0.9, 0.02, 0.28);
      p.maxLife = clamp(0.16 + this.rand() * 0.28, MAGIC_LIMITS.minLife, MAGIC_LIMITS.maxLife);
      p.life = p.maxLife;
      p.size = 1 + this.rand() * 1.6;
      p.hueShift = (this.rand() - 0.5) * 50;
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
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const swirl = (0.8 + flow * 1.6) * dt;
      const rx = p.x - p.ox;
      const ry = p.y - p.oy;
      p.x += -ry * swirl * 0.35;
      p.y += rx * swirl * 0.35;
    }
  }

  draw(ctx: CanvasRenderingContext2D, rect: ImageRect, magic: MagicConfig, master: number): void {
    if (this.peak < 0.02 && this.liveCount() === 0) return;
    const side = minSide(rect);
    const intensity = clamp(magic.intensity, 0, 1);
    const flow = clamp(magic.flow, 0, 1);
    const energy = clamp(magic.energy, 0, 1);
    const bright = clamp(master * (0.7 + intensity * 0.28), 0, MAGIC_LIMITS.maxBright);

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    if (this.fieldCtx && this.pixels && this.fieldCanvas) {
      const data = this.pixels.data;
      for (let i = 0; i < this.field.length; i++) {
        const v = clamp(this.field[i] ?? 0, 0, 1);
        const o = i * 4;
        if (v < 0.04) {
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 0;
          continue;
        }
        const col = { r: this.cr[i] || 180, g: this.cg[i] || 160, b: this.cb[i] || 255 };
        data[o] = col.r;
        data[o + 1] = col.g;
        data[o + 2] = col.b;
        data[o + 3] = Math.min(190, v * 210 * bright);
      }
      this.fieldCtx.putImageData(this.pixels, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 1;
      ctx.drawImage(this.fieldCanvas as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
    }

    this.drawTendrils(ctx, rect, side, flow, energy, bright);
    this.drawSparks(ctx, rect, side, bright);
    ctx.restore();
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
      const baseR = (region.kind === "stamp" ? region.r : region.width) * minSide(rect);
      const len = clamp(baseR * body.reach * (0.9 + body.surge * 0.55), 8, baseR * MAGIC_LIMITS.maxReach);
      const steps = 9;
      const col = magicTint(tr.color, tr.hueShift + Math.sin(t * 1.4 + tr.phase) * 12, body.env * 0.2);
      ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${0.28 + body.env * 0.45 * bright})`;
      ctx.lineWidth = Math.max(1.1, (1.6 + energy * 1.4) * (side / 900));
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const spin = t * (0.7 + flow * 2.2) * (0.6 + body.seed);
        const ang = tr.angle + spin * 0.35 + Math.sin(t * (1.6 + flow * 2) + tr.phase + u * 5) * (0.18 + energy * 0.35) * u;
        const rad = len * Math.pow(u, 0.82);
        const wob = Math.sin(tr.phase * 6 + u * 9 + t * (3 + flow * 4)) * len * 0.08 * energy * u;
        const x = origin.x + Math.cos(ang) * rad + Math.cos(ang + 1.57) * wob;
        const y = origin.y + Math.sin(ang) * rad + Math.sin(ang + 1.57) * wob;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawSparks(ctx: CanvasRenderingContext2D, rect: ImageRect, side: number, bright: number): void {
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.sparks) {
      if (!p.live) continue;
      const fade = Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI);
      const pos = imageNormToCanvas(p.x, p.y, rect);
      const col = magicTint(p.color, p.hueShift, 0.25);
      const radius = Math.max(0.5, (p.size * side) / 1100);
      ctx.globalAlpha = bright * fade * 0.7;
      ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},1)`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private syncTendrils(regions: Region[], want: number, energy: number): void {
    const cap = clamp(Math.round(want * (0.5 + energy * 0.5)), 0, TENDRIL_POOL);
    const live = this.tendrils.filter((t) => t.live);
    if (live.length > cap) {
      for (let i = cap; i < live.length; i++) live[i]!.live = false;
    }
    for (const region of regions) {
      const body = this.bodies.get(region.id);
      if (!body) continue;
      const n = 2 + Math.round(energy * 2 + body.surge * 2);
      let have = 0;
      for (const t of this.tendrils) if (t.live && t.regionId === region.id) have++;
      for (let k = have; k < n; k++) {
        const slot = this.tendrils.find((t) => !t.live);
        if (!slot) return;
        slot.live = true;
        slot.regionId = region.id;
        slot.angle = ((k + body.seed * 7) / Math.max(1, n)) * Math.PI * 2 + body.seed * 4;
        slot.phase = body.seed * 12 + k * 1.7;
        slot.hueShift = (k % 2 === 0 ? 1 : -1) * (18 + energy * 22);
        slot.color = region.color;
      }
    }
    for (const t of this.tendrils) {
      if (!t.live) continue;
      if (!regions.some((r) => r.id === t.regionId)) t.live = false;
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
      if (n > 0) scale.set(a.id, clamp(1 / (1 + n * 0.18), 0.62, 0.92));
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
