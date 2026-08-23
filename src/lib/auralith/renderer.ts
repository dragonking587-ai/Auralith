import { computeImageRect, imageNormToCanvas, minSide, snapRect } from "./coords";
import { bandLevel, overallEnergy, stepEnvelope } from "./envelope";
import { clamp } from "./id";
import type {
  Bands,
  EffectId,
  ImageRect,
  LightSuggestion,
  LiveBands,
  Region,
  Scene,
  StampRegion,
  SurgeConfig,
  TraceRegion,
} from "./types";

export interface DrawGuides {
  selectedId: string | null;
  tool: string;
  draftTrace: { x: number; y: number }[] | null;
  hoverId: string | null;
  suggestions?: LightSuggestion[];
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
  image: CanvasImageSource | null,
  surge: SurgeConfig,
  envMap: Map<string, number>,
  dt: number,
): void {
  const base = levelFor(region, bands, master);

  if (effect === "surge") {
    drawSurge(ctx, region, rect, base, image, surge, envMap, dt);
    return;
  }

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

function drawSurge(
  ctx: CanvasRenderingContext2D,
  region: Region,
  rect: ImageRect,
  level: number,
  image: CanvasImageSource | null,
  surge: SurgeConfig,
  envMap: Map<string, number>,
  dt: number,
): void {
  const strength = clamp(region.strength ?? 0.6, 0.15, 1);
  const attack = 0.055 + (1 - surge.response) * 0.08;
  const release = 0.16 + surge.decay * 0.42;
  const target = level < 0.08 ? 0 : Math.pow(clamp(level, 0, 1), 0.82);
  const prev = envMap.get(region.id) ?? 0;
  const env = clamp(stepEnvelope(prev, target, dt, attack, release), 0, 1);
  envMap.set(region.id, env);
  const amount = clamp(env * surge.intensity * strength * (0.55 + surge.response * 0.55), 0, 0.92);
  if (amount < 0.02) return;

  const side = minSide(rect);

  if (region.kind === "stamp") {
    const p = imageNormToCanvas(region.x, region.y, rect);
    const rad = region.r * side;
    const spillR = rad * (1.35 + surge.spread * 2.4 * amount);
    const bloomR = rad * (1.05 + surge.bloom * 1.8 * amount);

    if (image && spillR > 2) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, spillR, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = amount * 0.42;
      ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, bloomR);
    g.addColorStop(0, rgba(region.color, Math.min(0.55, amount * 0.62)));
    g.addColorStop(0.4, rgba(region.color, amount * 0.22));
    g.addColorStop(1, rgba(region.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, bloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 0.7);
    core.addColorStop(0, rgba(region.color, Math.min(0.38, amount * 0.4)));
    core.addColorStop(1, rgba(region.color, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const pts = region.points;
  if (pts.length < 2) return;
  if (image) {
    const stepN = Math.max(1, Math.ceil(pts.length / 8));
    for (let i = 0; i < pts.length; i += stepN) {
      const p = imageNormToCanvas(pts[i]!.x, pts[i]!.y, rect);
      const rr = region.width * side * (1.2 + surge.spread * 1.8 * amount);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = amount * 0.34;
      ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
  }
  drawTraceGlow(ctx, region, rect, region.color, amount * 0.68, 0.9 + amount * 0.65 + surge.bloom * 0.35);
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
  if (guides.suggestions?.length) drawSuggestions(ctx, rect, guides.suggestions);
}

function drawSuggestions(ctx: CanvasRenderingContext2D, rect: ImageRect, suggestions: LightSuggestion[]): void {
  const side = minSide(rect);
  suggestions.forEach((s, i) => {
    const p = imageNormToCanvas(s.x, s.y, rect);
    const rad = s.r * side;
    ctx.save();
    ctx.strokeStyle = s.picked ? "rgba(232, 196, 160, 0.95)" : "rgba(180, 186, 196, 0.55)";
    ctx.lineWidth = s.picked ? 2 : 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = String(i + 1);
    ctx.fillStyle = s.picked ? "rgba(18, 16, 14, 0.85)" : "rgba(18, 16, 14, 0.55)";
    ctx.beginPath();
    ctx.arc(p.x, p.y - rad - 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.picked ? "#f4e6d4" : "#c8ccd4";
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, p.x, p.y - rad - 8);
    ctx.restore();
  });
}

export function createRenderer(canvas: HTMLCanvasElement, opts?: { stream?: boolean }): Renderer {
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: false });
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  let cw = canvas.width;
  let ch = canvas.height;
  const stream = opts?.stream ?? false;
  const surgeEnv = new Map<string, number>();
  let lastNow = 0;

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
    const rect = snapRect(computeImageRect(imgW, imgH, w, h, scene.framing.fit, scene.framing.panX, scene.framing.panY));

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
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
    const dt = lastNow ? clamp((now - lastNow) / 1000, 0.001, 0.05) : 1 / 60;
    lastNow = now;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const region of scene.regions) {
      drawEffect(ctx, region, rect, bands, master, now, region.effect, image, scene.surge, surgeEnv, dt);
    }
    ctx.restore();

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
    dispose: () => {
      surgeEnv.clear();
    },
  };
}

export function suggestionHit(suggestions: LightSuggestion[], nx: number, ny: number): LightSuggestion | null {
  for (let i = suggestions.length - 1; i >= 0; i--) {
    const s = suggestions[i]!;
    if (Math.hypot(s.x - nx, s.y - ny) <= s.r) return s;
  }
  return null;
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
