import { clamp, lerp } from "./id.ts";
import type { Bands, FlameConfig, ImageRect, Region, StampRegion } from "./types.ts";
import { imageNormToCanvas, minSide } from "./coords.ts";
import { bandLevel, stepEnvelope } from "./envelope.ts";

interface Particle {
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
  maxParticles: 420,
  maxSpawns: 16,
  maxVy: 0.85,
  maxTongues: 6,
  maxBright: 0.9,
} as const;

const POOL = FLAME_LIMITS.maxParticles;

export function flameColor(t: number, heat: number): { r: number; g: number; b: number } {
  const h = clamp(t * (0.65 + heat * 0.35), 0, 1);
  // Cap well below white so grouped flames never blow out.
  if (h < 0.25) {
    const k = h / 0.25;
    return { r: lerp(40, 160, k), g: lerp(8, 28, k), b: lerp(2, 6, k) };
  }
  if (h < 0.55) {
    const k = (h - 0.25) / 0.3;
    return { r: lerp(160, 230, k), g: lerp(28, 90, k), b: lerp(6, 18, k) };
  }
  if (h < 0.82) {
    const k = (h - 0.55) / 0.27;
    return { r: lerp(230, 240, k), g: lerp(90, 150, k), b: lerp(18, 40, k) };
  }
  const k = (h - 0.82) / 0.18;
  return { r: lerp(240, 248, k), g: lerp(150, 190, k), b: lerp(40, 88, k) };
}

export function heatContribute(existing: number, add: number): number {
  // Max (lighten) so overlapping stamps grow area, not stacked brightness.
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
  private particles: Particle[] = [];
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

  constructor(heatW = 160, heatH = 90) {
    this.hw = heatW;
    this.hh = heatH;
    this.heat = new Float32Array(heatW * heatH);
    if (typeof OffscreenCanvas !== "undefined") {
      this.heatCanvas = new OffscreenCanvas(heatW, heatH);
    } else if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = heatW;
      c.height = heatH;
      this.heatCanvas = c;
    }
    this.heatCtx = this.heatCanvas
      ? (this.heatCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null)
      : null;
    if (this.heatCtx) this.pixels = this.heatCtx.createImageData(heatW, heatH);
    for (let i = 0; i < POOL; i++) {
      this.particles.push({
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
        size: 4,
        heat: 0.5,
      });
    }
  }

  reset(): void {
    this.heat.fill(0);
    this.bodies.clear();
    this.lastT = 0;
    for (const p of this.particles) p.live = false;
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng & 2147483647) / 2147483647;
  }

  /** Vertical teardrop kernel — size is the current envelope, not an accumulator. */
  private stampTeardrop(nx: number, ny: number, halfW: number, height: number, amount: number): void {
    const hw = this.hw;
    const hh = this.hh;
    const cx = nx * hw;
    const cy = ny * hh;
    const rise = Math.max(2, height * hh);
    const base = Math.max(1.1, halfW * hw);
    const x0 = Math.max(0, Math.floor(cx - base * 1.15));
    const x1 = Math.min(hw - 1, Math.ceil(cx + base * 1.15));
    const y0 = Math.max(0, Math.floor(cy - rise));
    const y1 = Math.min(hh - 1, Math.ceil(cy + base * 0.35));
    const add = clamp(amount, 0, 1);
    for (let y = y0; y <= y1; y++) {
      const t = clamp((cy - (y + 0.5)) / rise, -0.2, 1);
      const flare = t < 0 ? 1 + t * 2 : Math.pow(1 - t, 0.65);
      const rad = base * Math.max(0.08, flare);
      const r2 = rad * rad;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx;
        if (d2 > r2) continue;
        const fall = 1 - d2 / r2;
        const vertical = t < 0 ? 0.35 : Math.pow(1 - t, 0.45);
        const i = y * hw + x;
        this.heat[i] = heatContribute(this.heat[i]!, add * fall * fall * vertical);
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

    const heat = clamp(flame.heat, 0, 1);
    const density = clamp(flame.density, 0, 1);
    const speed = clamp(flame.speed, 0, 1);

    const decay = Math.exp(-dt * (2.4 + (1 - heat) * 0.7));
    for (let i = 0; i < this.heat.length; i++) this.heat[i]! *= decay;

    const seen = new Set<string>();
    const flameRegions = regions.filter((r) => r.effect === "flame");
    this.activeRegions = flameRegions;
    for (const region of flameRegions) {
      seen.add(region.id);
      const level = clamp(bandLevel(bands, region.band) * region.intensity * master, 0, 1);
      const b = this.bodyFor(region.id);
      b.env = stepEnvelope(b.env, level, dt, 0.045, 0.26);
      const roarTarget = b.env > 0.58 ? clamp((b.env - 0.5) / 0.5, 0, 1) : 0;
      b.roar = stepEnvelope(b.roar, roarTarget, dt, 0.22, 0.38);
      const t = flameTargets(b.env, b.roar, heat);
      b.height = stepEnvelope(b.height, t.height, dt, 0.05, 0.22);
      b.width = stepEnvelope(b.width, t.width, dt, 0.055, 0.24);
      b.height = clamp(b.height, FLAME_LIMITS.minHeight, FLAME_LIMITS.maxHeight);
      b.width = clamp(b.width, FLAME_LIMITS.minWidth, FLAME_LIMITS.maxWidth);

      const amount = clamp(b.env * (0.4 + density * 0.35) * (0.7 + b.roar * 0.3), 0, 0.92);
      if (region.kind === "stamp") {
        this.stampTeardrop(region.x, region.y, region.r * b.width, region.r * b.height, amount);
      } else {
        const pts = region.points;
        const step = Math.max(1, Math.ceil(pts.length / 8));
        for (let i = 0; i < pts.length; i += step) {
          const p = pts[i]!;
          this.stampTeardrop(p.x, p.y, region.width * b.width * 0.9, region.width * b.height * 1.6, amount * 0.75);
        }
      }
    }
    for (const id of [...this.bodies.keys()]) {
      if (!seen.has(id)) this.bodies.delete(id);
    }

    let spawned = 0;
    const budget = Math.round(FLAME_LIMITS.maxSpawns * (0.3 + density * 0.7));
    for (const region of flameRegions) {
      if (spawned >= budget) break;
      const b = this.bodies.get(region.id);
      if (!b || b.env < 0.03) continue;
      const n = Math.min(
        4,
        Math.ceil(b.env * (1 + density * 2.4) * (0.55 + b.roar * 0.7) * (region.kind === "trace" ? 1.3 : 1)),
      );
      const heightN =
        region.kind === "stamp" ? region.r * b.height : region.width * b.height * 1.6;
      const widthN = region.kind === "stamp" ? region.r * b.width : region.width * b.width;
      for (let k = 0; k < n && spawned < budget; k++) {
        const p = this.alloc();
        if (!p) break;
        let nx: number;
        let ny: number;
        if (region.kind === "stamp") {
          const ang = (this.rand() - 0.5) * Math.PI;
          const rad = widthN * (0.1 + this.rand() * 0.55);
          nx = region.x + Math.cos(ang) * rad;
          ny = region.y + Math.sin(ang) * rad * 0.25;
        } else {
          const pts = region.points;
          const idx = Math.floor(this.rand() * Math.max(1, pts.length - 1));
          const a = pts[idx]!;
          const c = pts[idx + 1] ?? a;
          const t = this.rand();
          nx = lerp(a.x, c.x, t);
          ny = lerp(a.y, c.y, t);
        }
        const maxDist = clamp(heightN * FLAME_LIMITS.maxTravelScale, 0.02, 0.45);
        const rise = clamp((0.12 + b.env * 0.22 + speed * 0.18) * (0.7 + this.rand() * 0.5), 0.04, FLAME_LIMITS.maxVy);
        p.live = true;
        p.x = nx;
        p.y = ny;
        p.ox = nx;
        p.oy = ny;
        p.vx = (this.rand() - 0.5) * (0.04 + b.roar * 0.05) * (0.4 + speed);
        p.vy = -rise;
        p.maxLife = clamp(0.16 + b.env * 0.18 + heat * 0.08 + this.rand() * 0.12, FLAME_LIMITS.minLife, FLAME_LIMITS.maxLife);
        p.life = p.maxLife;
        p.maxDist = maxDist;
        p.size = 3 + this.rand() * 5 * (0.45 + density * 0.55);
        p.heat = clamp(0.35 + b.env * 0.35 + heat * 0.25, 0, 1);
        spawned++;
      }
    }

    const turb = clamp(0.35 + heat * 0.4 + speed * 0.35, 0, 1);
    const tSec = time * 0.001;
    for (const p of this.particles) {
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
      p.x += Math.sin(tSec * (5 + speed * 7) + p.heat * 14 + p.ox * 20) * turb * 0.012 * dt;
      p.vx *= Math.max(0, 1 - 0.55 * dt);
      p.vy *= Math.max(0, 1 - 0.35 * dt);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) p.live = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, rect: ImageRect, flame: FlameConfig, master: number): void {
    const side = minSide(rect);
    const heatAmt = clamp(flame.heat, 0, 1);
    const density = clamp(flame.density, 0, 1);
    const speed = clamp(flame.speed, 0, 1);
    const bright = clamp(master * (0.72 + heatAmt * 0.22), 0, FLAME_LIMITS.maxBright);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = bright;

    if (this.heatCtx && this.pixels && this.heatCanvas) {
      const data = this.pixels.data;
      for (let i = 0; i < this.heat.length; i++) {
        const v = normalizeHeat(this.heat[i] ?? 0);
        const o = i * 4;
        if (v < 0.04) {
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
        data[o + 3] = Math.min(165, v * 175);
      }
      this.heatCtx.putImageData(this.pixels, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = bright * 0.55;
      ctx.drawImage(this.heatCanvas as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = bright;
    }

    const tSec = this.lastT * 0.001;
    const cluster = this.clusterScale();

    for (const [id, body] of this.bodies) {
      const region = this.findRegion(id);
      if (!region) continue;
      const share = cluster.get(id) ?? 1;
      this.drawRegionFlames(ctx, rect, side, region, body, heatAmt, density, speed, tSec, share);
    }

    for (const p of this.particles) {
      if (!p.live) continue;
      const age = 1 - p.life / p.maxLife;
      const fade = Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI);
      const pos = imageNormToCanvas(p.x, p.y, rect);
      const col = flameColor(p.heat * (1 - age * 0.55), heatAmt);
      const radius = (p.size * (1 - age * 0.35) * side) / 520;
      ctx.globalAlpha = bright * fade * 0.45;
      ctx.fillStyle = `rgba(${col.r | 0},${col.g | 0},${col.b | 0},1)`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(0.8, radius), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private findRegion(id: string): Region | null {
    for (const r of this.activeRegions) if (r.id === id) return r;
    return null;
  }

  private alloc(): Particle | null {
    for (const p of this.particles) if (!p.live) return p;
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
        if (d < (a.r + b.r) * 2.2) neighbors++;
      }
      if (neighbors > 0) scale.set(a.id, clamp(1 / (1 + neighbors * 0.45), 0.42, 0.78));
    }
    return scale;
  }

  liveCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.live) n++;
    return n;
  }

  /** Test helper: particle Y stays near the spawn base. */
  extents(): { live: number; minY: number; maxY: number } {
    let live = 0;
    let minY = 1;
    let maxY = 0;
    for (const p of this.particles) {
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

  private drawRegionFlames(
    ctx: CanvasRenderingContext2D,
    rect: ImageRect,
    side: number,
    region: Region,
    body: Body,
    heatAmt: number,
    density: number,
    speed: number,
    tSec: number,
    share: number,
  ): void {
    const tongues = clamp(2 + Math.round(density * 3 + body.roar * 2), 2, FLAME_LIMITS.maxTongues);
    const turb = clamp(0.25 + heatAmt * 0.4 + speed * 0.35 + body.roar * 0.25, 0, 1);
    const flicker = 0.93 + 0.07 * Math.sin(tSec * (7 + speed * 9) + body.seed * 12);

    const drawAt = (nx: number, ny: number, baseR: number, glowShare: number) => {
      const origin = imageNormToCanvas(nx, ny, rect);
      const rPx = baseR * side;
      const hPx = clamp(body.height * rPx * flicker, 4, rPx * FLAME_LIMITS.maxHeight);
      const wPx = clamp(body.width * rPx, 3, rPx * FLAME_LIMITS.maxWidth);
      const glowR = clamp(wPx * (1.15 + body.env * 0.35), 4, rPx * FLAME_LIMITS.maxGlowScale);

      ctx.save();
      const g0 = flameColor(0.55, heatAmt);
      const glow = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, glowR);
      glow.addColorStop(0, `rgba(${g0.r},${g0.g},${Math.min(g0.b, 70)},${0.42 * glowShare * (0.45 + body.env * 0.55)})`);
      glow.addColorStop(1, `rgba(${g0.r},16,0,0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < tongues; i++) {
        const u = tongues === 1 ? 0 : i / (tongues - 1) - 0.5;
        const lean =
          Math.sin(tSec * (3.2 + speed * 5) + body.seed * 20 + i * 1.7) * turb * wPx * 0.42 + u * wPx * 0.55;
        const h = hPx * (0.72 + 0.28 * (0.5 + 0.5 * Math.sin(body.seed * 9 + i * 2.1))) * (i === 0 ? 1 : 0.82);
        const w = wPx * (0.55 + (1 - Math.abs(u)) * 0.5) * (0.85 + body.roar * 0.2);
        drawTongue(ctx, origin.x, origin.y, w, h, lean, heatAmt, 0.55 + body.env * 0.35, false);
      }
      const coreH = hPx * 0.62;
      const coreW = wPx * 0.38;
      const coreLean = Math.sin(tSec * (4 + speed * 6) + body.seed * 8) * turb * wPx * 0.12;
      drawTongue(ctx, origin.x, origin.y, coreW, coreH, coreLean, heatAmt, 0.8, true);
      ctx.restore();
    };

    if (region.kind === "stamp") {
      drawAt(region.x, region.y, region.r, share);
    } else {
      const pts = region.points;
      if (pts.length < 2) return;
      const step = Math.max(1, Math.ceil(pts.length / 6));
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i]!;
        drawAt(p.x, p.y, region.width * 0.9, share * 0.85);
      }
    }
  }
}

function drawTongue(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lean: number,
  heatAmt: number,
  alpha: number,
  core: boolean,
): void {
  const tipX = x + lean;
  const tipY = y - h;
  const left = x - w;
  const right = x + w;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.bezierCurveTo(left - w * 0.12, y - h * 0.28, tipX - w * 0.42, y - h * 0.62, tipX, tipY);
  ctx.bezierCurveTo(tipX + w * 0.42, y - h * 0.62, right + w * 0.12, y - h * 0.28, right, y);
  ctx.closePath();
  const g = ctx.createLinearGradient(x, y, tipX, tipY);
  const c0 = flameColor(core ? 0.98 : 0.78, heatAmt);
  const c1 = flameColor(core ? 0.7 : 0.48, heatAmt);
  const c2 = flameColor(core ? 0.4 : 0.18, heatAmt);
  const a = clamp(alpha, 0, 0.92);
  g.addColorStop(0, `rgba(${c0.r},${c0.g},${c0.b},${a})`);
  g.addColorStop(0.42, `rgba(${c1.r},${c1.g},${c1.b},${a * 0.7})`);
  g.addColorStop(1, `rgba(${c2.r},${c2.g},${Math.min(c2.b, 40)},0)`);
  ctx.fillStyle = g;
  ctx.fill();
}
