import { clamp, lerp } from "./id.ts";
import type { Bands, FlameConfig, ImageRect, Region } from "./types.ts";
import { imageNormToCanvas, minSide } from "./coords.ts";
import { bandLevel } from "./envelope.ts";

interface Particle {
  live: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  heat: number;
}

const POOL = 640;
const MAX_SPAWNS = 36;

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

export class FlameSim {
  private particles: Particle[] = [];
  private heat: Float32Array;
  private hw: number;
  private hh: number;
  private rng = 1;
  private lastT = 0;
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
        life: 0,
        maxLife: 1,
        size: 4,
        heat: 0.5,
      });
    }
  }

  reset(): void {
    this.heat.fill(0);
    for (const p of this.particles) p.live = false;
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng & 2147483647) / 2147483647;
  }

  private stampHeat(nx: number, ny: number, radiusN: number, amount: number): void {
    const hw = this.hw;
    const hh = this.hh;
    const cx = nx * hw;
    const cy = ny * hh;
    const rad = Math.max(1.2, radiusN * Math.min(hw, hh) * 1.15);
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(hw - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(hh - 1, Math.ceil(cy + rad));
    const r2 = rad * rad;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const fall = 1 - d2 / r2;
        const add = amount * fall * fall;
        const i = y * hw + x;
        this.heat[i] = heatContribute(this.heat[i]!, add);
      }
    }
  }

  step(
    dt: number,
    regions: Region[],
    bands: Bands,
    flame: FlameConfig,
    master: number,
    time: number,
  ): void {
    const decay = Math.exp(-dt * (1.8 + (1 - flame.heat) * 0.8));
    for (let i = 0; i < this.heat.length; i++) this.heat[i]! *= decay;

    for (const region of regions) {
      if (region.effect !== "flame") continue;
      const level = bandLevel(bands, region.band) * region.intensity * master;
      if (level < 0.02) continue;
      const amount = clamp(level * (0.45 + flame.density * 0.55), 0, 1);
      if (region.kind === "stamp") {
        this.stampHeat(region.x, region.y, region.r * (0.9 + flame.density * 0.5), amount);
      } else {
        for (const p of region.points) {
          this.stampHeat(p.x, p.y, region.width * (1.2 + flame.density), amount * 0.85);
        }
      }
    }

    let spawned = 0;
    const budget = Math.round(MAX_SPAWNS * (0.35 + flame.density * 0.65));
    for (const region of regions) {
      if (region.effect !== "flame" || spawned >= budget) continue;
      const level = bandLevel(bands, region.band) * region.intensity * master;
      if (level < 0.04) continue;
      const n = Math.min(
        6,
        Math.ceil(level * (1 + flame.density * 3) * (region.kind === "trace" ? 1.4 : 1)),
      );
      for (let k = 0; k < n && spawned < budget; k++) {
        const p = this.alloc();
        if (!p) break;
        let nx: number;
        let ny: number;
        if (region.kind === "stamp") {
          const ang = this.rand() * Math.PI * 2;
          const rad = region.r * (0.15 + this.rand() * 0.75);
          nx = region.x + Math.cos(ang) * rad;
          ny = region.y + Math.sin(ang) * rad * 0.7;
        } else {
          const pts = region.points;
          const idx = Math.floor(this.rand() * (pts.length - 1));
          const a = pts[idx]!;
          const b = pts[idx + 1] ?? a;
          const t = this.rand();
          nx = lerp(a.x, b.x, t);
          ny = lerp(a.y, b.y, t);
        }
        p.live = true;
        p.x = nx;
        p.y = ny;
        p.vx = (this.rand() - 0.5) * 0.04 * flame.speed;
        p.vy = -0.05 * (0.4 + flame.speed) * (0.6 + this.rand() * 0.8);
        p.maxLife = 0.35 + this.rand() * 0.55 + flame.heat * 0.2;
        p.life = p.maxLife;
        p.size = 6 + this.rand() * 10 * (0.5 + flame.density);
        p.heat = clamp(0.35 + level * 0.4 + flame.heat * 0.3, 0, 1);
        spawned++;
      }
    }

    const lift = (0.35 + flame.speed) * dt;
    for (const p of this.particles) {
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.live = false;
        continue;
      }
      p.x += p.vx * (dt * 60);
      p.y += p.vy * (dt * 60) - lift * 0.35;
      p.vx *= 0.98;
      p.vy *= 0.99;
      p.vy -= 0.0008 * flame.speed;
    }
    this.lastT = time;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    rect: ImageRect,
    flame: FlameConfig,
    master: number,
  ): void {
    const side = minSide(rect);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = clamp(master * 0.95, 0, 1);

    if (this.heatCtx && this.pixels && this.heatCanvas) {
      const data = this.pixels.data;
      for (let i = 0; i < this.heat.length; i++) {
        const v = normalizeHeat(this.heat[i] ?? 0);
        const o = i * 4;
        if (v < 0.05) {
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 0;
          continue;
        }
        const col = flameColor(v, flame.heat);
        data[o] = col.r;
        data[o + 1] = col.g;
        data[o + 2] = col.b;
        data[o + 3] = Math.min(200, v * 210);
      }
      this.heatCtx.putImageData(this.pixels, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.heatCanvas as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
    }

    for (const p of this.particles) {
      if (!p.live) continue;
      const age = 1 - p.life / p.maxLife;
      const fade = Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI);
      const pos = imageNormToCanvas(p.x, p.y, rect);
      const col = flameColor(p.heat * (1 - age * 0.5), flame.heat);
      const radius = (p.size * (1 - age * 0.4) * side) / 420;
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, Math.max(1, radius));
      const a = fade * 0.55;
      g.addColorStop(0, `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${a})`);
      g.addColorStop(1, `rgba(${col.r | 0},16,0,0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(1, radius), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  liveCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.live) n++;
    return n;
  }

  private alloc(): Particle | null {
    for (const p of this.particles) if (!p.live) return p;
    return null;
  }
}
