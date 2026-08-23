import { computeImageRect, imageNormToCanvas, minSide } from "./coords";
import { bandLevel, overallEnergy } from "./envelope";
import { MagicSim } from "./magic";
import { clamp } from "./id";
import type {
  Bands,
  EffectId,
  ImageRect,
  LiveBands,
  Region,
  Scene,
  StampRegion,
  TraceRegion,
} from "./types";

export interface DrawGuides {
  selectedId: string | null;
  tool: string;
  draftTrace: { x: number; y: number }[] | null;
  hoverId: string | null;
}

export interface Renderer {
  drawFrame: (args: {
    scene: Scene;
    image: CanvasImageSource | null;
    bands: LiveBands | Bands;
    now: number;
    guides?: DrawGuides | null;
  }) => void;
  resize: (w: number, h: number) => void;
  setSize: (w: number, h: number) => void;
  dispose: () => void;
  canvas: HTMLCanvasElement;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

function hueShift(hex: string, deg: number): string {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToCss(((h + deg / 360) % 1 + 1) % 1, s, l);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

function hslToCss(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c);
  };
  return `rgb(${f(0)},${f(8)},${f(4)})`;
}

function strobeOn(level: number, now: number): boolean {
  if (level < 0.42) return false;
  const period = 90;
  return now % period < period * (0.35 + level * 0.25);
}

function flickerMul(level: number, now: number, id: string): number {
  const seed = id.charCodeAt(id.length - 1) || 1;
  const n = Math.sin(now * 0.041 * seed) * 0.5 + Math.sin(now * 0.11 + seed) * 0.5;
  const drop = n > 0.72 ? 0.15 : 1;
  return level * (0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 0.05 * seed))) * drop;
}

function levelFor(region: Region, bands: Bands, master: number): number {
  return clamp(bandLevel(bands, region.band) * region.intensity * master, 0, 1.4);
}

function drawStampGlow(
  ctx: CanvasRenderingContext2D,
  region: StampRegion,
  rect: ImageRect,
  color: string,
  alpha: number,
  scale: number,
): void {
  if (alpha < 0.015) return;
  const p = imageNormToCanvas(region.x, region.y, rect);
  const rad = region.r * minSide(rect) * scale;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
  g.addColorStop(0, rgba(color, Math.min(0.82, alpha)));
  g.addColorStop(0.35, rgba(color, alpha * 0.4));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
  ctx.fill();
}

function tracePath(ctx: CanvasRenderingContext2D, region: TraceRegion, rect: ImageRect): void {
  const pts = region.points;
  if (pts.length < 2) return;
  ctx.beginPath();
  const first = imageNormToCanvas(pts[0]!.x, pts[0]!.y, rect);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = imageNormToCanvas(pts[i]!.x, pts[i]!.y, rect);
    ctx.lineTo(p.x, p.y);
  }
}

function drawTraceGlow(
  ctx: CanvasRenderingContext2D,
  region: TraceRegion,
  rect: ImageRect,
  color: string,
  alpha: number,
  widthScale: number,
): void {
  if (alpha < 0.015 || region.points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = rgba(color, Math.min(0.9, alpha));
  ctx.lineWidth = region.width * minSide(rect) * widthScale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = rgba(color, Math.min(0.7, alpha));
  ctx.shadowBlur = region.width * minSide(rect) * 1.8;
  tracePath(ctx, region, rect);
  ctx.stroke();
  ctx.restore();
}

function drawEffect(
  ctx: CanvasRenderingContext2D,
  region: Region,
  rect: ImageRect,
  bands: Bands,
  master: number,
  now: number,
  effect: EffectId,
): void {
  const base = levelFor(region, bands, master);
  if (effect === "magic") return;

  let alpha = base;
  let color = region.color;
  let scale = 1.15 + base * 0.55;

  if (effect === "pulse") {
    alpha = base;
  } else if (effect === "hue") {
    color = hueShift(region.color, -18 + base * 64);
    alpha = 0.25 + base * 0.7;
    scale = 1.1 + base * 0.35;
  } else if (effect === "flicker") {
    alpha = flickerMul(base, now, region.id);
    scale = 1.05 + alpha * 0.4;
  } else if (effect === "strobe") {
    alpha = strobeOn(base, now) ? Math.min(1, 0.55 + base * 0.5) : base * 0.08;
    scale = strobeOn(base, now) ? 1.35 : 1.05;
  }

  if (region.kind === "stamp") drawStampGlow(ctx, region, rect, color, alpha, scale);
  else drawTraceGlow(ctx, region, rect, color, alpha, 0.85 + alpha * 0.5);
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  rect: ImageRect,
  guides: DrawGuides,
): void {
  const side = minSide(rect);
  for (const region of scene.regions) {
    const selected = region.id === guides.selectedId;
    const hover = region.id === guides.hoverId;
    ctx.save();
    ctx.strokeStyle = selected ? "rgba(244,244,245,0.95)" : hover ? "rgba(200,204,212,0.7)" : "rgba(200,204,212,0.35)";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.setLineDash(selected ? [] : [5, 4]);
    if (region.kind === "stamp") {
      const p = imageNormToCanvas(region.x, region.y, rect);
      const rad = region.r * side;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.fillStyle = region.color;
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "rgba(244,244,245,0.9)";
        ctx.beginPath();
        ctx.arc(p.x + rad, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#0a0a0b";
        ctx.fill();
        ctx.stroke();
      }
    } else {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, region.width * side * 0.35);
      tracePath(ctx, region, rect);
      ctx.stroke();
      if (selected) {
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(244,244,245,0.9)";
        for (const pt of region.points) {
          const p = imageNormToCanvas(pt.x, pt.y, rect);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
  if (guides.draftTrace && guides.draftTrace.length) {
    ctx.save();
    ctx.strokeStyle = "rgba(232,196,160,0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    const first = imageNormToCanvas(guides.draftTrace[0]!.x, guides.draftTrace[0]!.y, rect);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < guides.draftTrace.length; i++) {
      const p = imageNormToCanvas(guides.draftTrace[i]!.x, guides.draftTrace[i]!.y, rect);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export function createRenderer(canvas: HTMLCanvasElement, opts?: { stream?: boolean }): Renderer {
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  const magic = new MagicSim();
  let cw = canvas.width;
  let ch = canvas.height;
  const stream = opts?.stream ?? false;

  const resize = (w: number, h: number) => {
    if (w < 1 || h < 1) return;
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    cw = w;
    ch = h;
  };

  const drawFrame: Renderer["drawFrame"] = ({ scene, image, bands, now, guides }) => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#050506";
    ctx.fillRect(0, 0, w, h);

    const imgW = scene.image?.width ?? (image as HTMLImageElement | null)?.naturalWidth ?? w;
    const imgH = scene.image?.height ?? (image as HTMLImageElement | null)?.naturalHeight ?? h;
    const rect = computeImageRect(imgW, imgH, w, h, scene.framing.fit, scene.framing.panX, scene.framing.panY);

    if (image) {
      ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    }

    const energy = overallEnergy(bands);
    const dim = clamp(scene.audio.roomDim * (1 - energy * 0.75), 0, 0.85);
    if (dim > 0.01) {
      ctx.fillStyle = `rgba(4,4,6,${dim})`;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    const master = scene.audio.masterIntensity;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const region of scene.regions) {
      if (region.effect === "magic") continue;
      drawEffect(ctx, region, rect, bands, master, now, region.effect);
    }
    ctx.restore();

    magic.step(Math.min(0.05, 1 / 60), scene.regions, bands, scene.magic, master, now);
    magic.draw(ctx, rect, scene.magic, master);

    if (guides && !stream) {
      drawGuides(ctx, scene, rect, guides);
    }
    cw = w;
    ch = h;
  };

  return {
    canvas,
    drawFrame,
    resize,
    setSize: resize,
    dispose: () => magic.reset(),
  };
}

export function hitTest(scene: Scene, nx: number, ny: number): Region | null {
  const p = { x: nx, y: ny };
  for (let i = scene.regions.length - 1; i >= 0; i--) {
    const r = scene.regions[i]!;
    if (r.kind === "stamp") {
      const dx = r.x - p.x;
      const dy = r.y - p.y;
      if (Math.hypot(dx, dy) <= r.r) return r;
    } else {
      for (let k = 1; k < r.points.length; k++) {
        const a = r.points[k - 1]!;
        const b = r.points[k]!;
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const len2 = vx * vx + vy * vy || 1e-8;
        let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
        t = clamp(t, 0, 1);
        const d = Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
        if (d <= r.width * 0.9) return r;
      }
    }
  }
  return null;
}

export function stampHandleHit(region: StampRegion, nx: number, ny: number): boolean {
  const hx = region.x + region.r;
  const hy = region.y;
  return Math.hypot(nx - hx, ny - hy) < Math.max(0.012, region.r * 0.22);
}
