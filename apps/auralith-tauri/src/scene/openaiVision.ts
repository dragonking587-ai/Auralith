import { ALL_EFFECTS, defaultEffect, normalizePortalComponents, type AudioMap, type EffectKind, type Region } from "./types";

export type VisionPoint = { x: number; y: number };
export type VisionObject = {
  label: string; effect: EffectKind; color: string; audio: AudioMap;
  placement: "mask" | "point"; anchor: VisionPoint; outline: VisionPoint[];
};
export type VisionResult = { summary: string; objects: VisionObject[] };
const audioSources = ["Manual", "Bass", "Low", "Mid", "High", "FullMix", "Raw", "Beat", "Transient"];

function point(value: unknown): VisionPoint {
  const p = value as VisionPoint | undefined;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1000 || p.y < 0 || p.y > 1000) {
    throw new Error("OpenAI returned an outline outside the image. Please retry.");
  }
  return { x: p.x, y: p.y };
}

export function validateVisionResult(value: unknown): VisionResult {
  const result = value as VisionResult | undefined;
  if (!result || typeof result.summary !== "string" || !Array.isArray(result.objects) || result.objects.length > 12) {
    throw new Error("OpenAI returned invalid object detections.");
  }
  return {
    summary: result.summary.slice(0, 800),
    objects: result.objects.map((obj) => {
      if (!obj || typeof obj.label !== "string" || !ALL_EFFECTS.includes(obj.effect) ||
          !audioSources.includes(obj.audio) || !/^#[0-9a-f]{6}$/i.test(obj.color) ||
          !["mask", "point"].includes(obj.placement) || !Array.isArray(obj.outline) ||
          obj.outline.length < 4 || obj.outline.length > 32) {
        throw new Error("OpenAI returned an invalid object or effect. Please retry.");
      }
      const outline = obj.outline.map(point);
      const area = Math.abs(outline.reduce((sum, p, i) => {
        const next = outline[(i + 1) % outline.length];
        return sum + p.x * next.y - next.x * p.y;
      }, 0)) / 2;
      if (area < 4) throw new Error("An object outline was too small to use. Please retry.");
      return { label: obj.label.slice(0, 100), effect: obj.effect, color: obj.color,
        audio: obj.audio, placement: obj.placement, anchor: point(obj.anchor), outline };
    }),
  };
}

export function visionRegions(objects: VisionObject[], width: number, height: number): Region[] {
  return objects.map((obj) => {
    const points = obj.outline.map((p) => ({ x: p.x * width / 1000, y: p.y * height / 1000 }));
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const effect = defaultEffect(obj.effect);
    effect.color = obj.color;
    effect.audio = obj.audio;
    effect.geomMode = obj.placement;
    effect.applyMode = "inside";
    effect.feather = 0.12;
    if (effect.kind === "EmeraldBolt") effect.boltColors = { Bass: obj.color, Low: obj.color, Mid: obj.color, High: obj.color };
    if (effect.kind === "Portal") {
      effect.portalComponents = normalizePortalComponents(undefined).map(() => ({ color: obj.color, audio: obj.audio }));
    }
    const center = obj.placement === "point"
      ? { x: obj.anchor.x * width / 1000, y: obj.anchor.y * height / 1000 }
      : { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const fireHeight = obj.placement === "point" && effect.kind === "RealisticFlame" ? Math.max(h, w * 1.4) : h;
    if (fireHeight !== h) center.y -= fireHeight * 0.39;
    return { id: crypto.randomUUID(), kind: obj.placement === "point" ? "Emitter" : "Trace",
      label: obj.label, experimental: true, points, ...center, sx: 1, sy: 1, rotation: 0,
      width: Math.max(12, w), height: Math.max(12, fireHeight),
      radius: Math.max(12, Math.max(w, h) / 2), pathClosed: true, effects: [effect] };
  });
}
