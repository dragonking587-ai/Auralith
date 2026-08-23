import { SCHEMA_VERSION } from "./version.ts";
import {
  BANDS,
  DEFAULT_AUDIO,
  DEFAULT_FRAMING,
  EFFECTS,
  type BandId,
  type EffectId,
  type Point,
  type Region,
  type Scene,
  type StampRegion,
  type TraceRegion,
} from "./types.ts";
import { defaultOutput } from "./presets.ts";
import { uid } from "./id.ts";

export function emptyScene(name = "Untitled"): Scene {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    image: null,
    regions: [],
    framing: { ...DEFAULT_FRAMING },
    audio: { ...DEFAULT_AUDIO },
    output: defaultOutput(),
    defaultBand: "bass",
    defaultEffect: "pulse",
    defaultColor: "#e8c4a0",
  };
}

function isBand(v: unknown): v is BandId {
  return typeof v === "string" && (BANDS as string[]).includes(v);
}

function parseEffect(v: unknown): EffectId {
  if (v === "flame" || v === "magic") return "pulse";
  if (typeof v === "string" && (EFFECTS as string[]).includes(v)) return v as EffectId;
  return "pulse";
}

function num(v: unknown, fallback: number, lo?: number, hi?: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  if (lo !== undefined && n < lo) return lo;
  if (hi !== undefined && n > hi) return hi;
  return n;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function parsePoint(v: unknown): Point | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const x = num(p.x, NaN);
  const y = num(p.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function parseRegion(v: unknown): Region | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const band = isBand(r.band) ? r.band : "mid";
  const effect = parseEffect(r.effect);
  const color = str(r.color, "#e8c4a0");
  const intensity = num(r.intensity, 1, 0, 2);
  const id = str(r.id, uid("r"));
  if (r.kind === "trace" || Array.isArray(r.points)) {
    const pts = Array.isArray(r.points)
      ? (r.points.map(parsePoint).filter(Boolean) as Point[])
      : [];
    if (pts.length < 2) return null;
    const trace: TraceRegion = {
      id,
      kind: "trace",
      points: pts,
      width: num(r.width, 0.03, 0.004, 0.2),
      band,
      effect,
      color,
      intensity,
    };
    return trace;
  }
  const stamp: StampRegion = {
    id,
    kind: "stamp",
    x: num(r.x, 0.5, 0, 1),
    y: num(r.y, 0.5, 0, 1),
    r: num(r.r, 0.045, 0.008, 0.4),
    band,
    effect,
    color,
    intensity,
  };
  return stamp;
}

export function parseScene(raw: unknown): Scene | null {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") return null;
    const o = data as Record<string, unknown>;
    const version = num(o.schemaVersion ?? o.version, 1);
    if (version > SCHEMA_VERSION) {
      // Forward-unknown: still try to read known fields.
    }
    const framingIn = (o.framing ?? {}) as Record<string, unknown>;
    const audioIn = (o.audio ?? {}) as Record<string, unknown>;
    const outputIn = (o.output ?? {}) as Record<string, unknown>;
    const imageIn = o.image && typeof o.image === "object" ? (o.image as Record<string, unknown>) : null;
    const regions = Array.isArray(o.regions)
      ? (o.regions.map(parseRegion).filter(Boolean) as Region[])
      : [];
    const base = emptyScene(str(o.name, "Untitled"));
    const fit = framingIn.fit === "fit" || framingIn.fit === "stretch" || framingIn.fit === "fill" ? framingIn.fit : "fill";
    return {
      ...base,
      schemaVersion: SCHEMA_VERSION,
      name: str(o.name, "Untitled"),
      image: imageIn
        ? {
            id: str(imageIn.id, uid("img")),
            width: num(imageIn.width, 1920, 1, 8192),
            height: num(imageIn.height, 1080, 1, 8192),
            mime: str(imageIn.mime, "image/jpeg"),
          }
        : null,
      regions,
      framing: {
        fit,
        panX: num(framingIn.panX, 0.5, 0, 1),
        panY: num(framingIn.panY, 0.5, 0, 1),
      },
      audio: {
        sensitivity: num(audioIn.sensitivity, DEFAULT_AUDIO.sensitivity, 0.05, 4),
        masterIntensity: num(audioIn.masterIntensity, DEFAULT_AUDIO.masterIntensity, 0, 1.5),
        roomDim: num(audioIn.roomDim, DEFAULT_AUDIO.roomDim, 0, 1),
      },
      output: {
        ...base.output,
        width: num(outputIn.width, base.output.width, 16, 7680),
        height: num(outputIn.height, base.output.height, 16, 7680),
        fps: outputIn.fps === 30 ? 30 : 60,
        platform:
          outputIn.platform === "tiktok" ||
          outputIn.platform === "streamlabs" ||
          outputIn.platform === "custom"
            ? outputIn.platform
            : "obs",
        method: outputIn.method === "window" ? "window" : "browser",
        presetId: str(outputIn.presetId, base.output.presetId),
      },
      defaultBand: isBand(o.defaultBand) ? o.defaultBand : "bass",
      defaultEffect: parseEffect(o.defaultEffect),
      defaultColor: str(o.defaultColor, "#e8c4a0"),
    };
  } catch {
    return null;
  }
}

export function sceneWithoutImageBlob(scene: Scene): Scene {
  return scene;
}

export const DEMO_STAGE_URL = "/demo/stage.jpg";

export function demoRegions(): Region[] {
  const bulb = (id: string, x: number, y: number, band: BandId): StampRegion => ({
    id,
    kind: "stamp",
    x,
    y,
    r: 0.055,
    band,
    effect: "pulse",
    color: "#f0c48a",
    intensity: 1,
  });
  return [
    bulb("demo_bulb_l", 0.2, 0.18, "bass"),
    bulb("demo_bulb_c", 0.5, 0.16, "low"),
    bulb("demo_bulb_r", 0.8, 0.18, "mid"),
    {
      id: "demo_window",
      kind: "stamp",
      x: 0.08,
      y: 0.42,
      r: 0.08,
      band: "high",
      effect: "hue",
      color: "#b7c8d8",
      intensity: 0.85,
    },
    {
      id: "demo_neon",
      kind: "trace",
      points: [
        { x: 0.28, y: 0.48 },
        { x: 0.5, y: 0.465 },
        { x: 0.72, y: 0.48 },
      ],
      width: 0.028,
      band: "mid",
      effect: "flicker",
      color: "#e8b86a",
      intensity: 1,
    },
    {
      id: "demo_led",
      kind: "trace",
      points: [
        { x: 0.12, y: 0.78 },
        { x: 0.36, y: 0.795 },
        { x: 0.64, y: 0.79 },
        { x: 0.88, y: 0.78 },
      ],
      width: 0.018,
      band: "high",
      effect: "strobe",
      color: "#d9c39a",
      intensity: 0.7,
    },
    {
      id: "demo_light_a",
      kind: "stamp",
      x: 0.22,
      y: 0.8,
      r: 0.04,
      band: "bass",
      effect: "pulse",
      color: "#7ec8ff",
      intensity: 1,
    },
    {
      id: "demo_light_b",
      kind: "stamp",
      x: 0.28,
      y: 0.81,
      r: 0.038,
      band: "bass",
      effect: "pulse",
      color: "#b48cff",
      intensity: 1,
    },
    {
      id: "demo_light_c",
      kind: "stamp",
      x: 0.34,
      y: 0.8,
      r: 0.036,
      band: "low",
      effect: "pulse",
      color: "#7ec8ff",
      intensity: 1,
    },
    {
      id: "demo_candle_r",
      kind: "stamp",
      x: 0.78,
      y: 0.8,
      r: 0.042,
      band: "low",
      effect: "pulse",
      color: "#e8c47a",
      intensity: 1,
    },
  ];
}

export function createDemoScene(): Scene {
  const scene = emptyScene("Demo Scene");
  scene.image = {
    id: "demo-stage",
    width: 1920,
    height: 1080,
    mime: "image/jpeg",
  };
  scene.regions = demoRegions();
  scene.defaultEffect = "pulse";
  scene.defaultBand = "bass";
  return scene;
}
