import type { AudioSnapshot } from "../audio/engine";
import type { GamingOverlayItem } from "./gamingOverlay";

export type OverlayEffectState = { borderColor: string; glowColor: string; glow: number; chaseOpacity: number; angle: number };
const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

function channels(color: string): number[] {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : "#8b6cff";
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

export function overlayRgba(color: string, opacity: number): string {
  return "rgba(" + channels(color).join(", ") + ", " + clamp(opacity, 0, 1) + ")";
}

export function overlayAudioLevel(item: GamingOverlayItem, audio?: AudioSnapshot): number {
  if (!item.audioReactive || !audio) return 0;
  return clamp(Number(audio[item.audioBand || "bass"]) * (item.audioSensitivity ?? 1), 0, 1);
}

// Separate envelopes for each box keep beat/transient response smooth without
// changing the shared analyzer or updating React state every animation frame.
export function smoothOverlayAudio(previous: number, target: number, dt: number): number {
  const seconds = clamp(dt, 0, 0.1);
  const tau = target > previous ? 0.025 : 0.22;
  return clamp(previous + (target - previous) * (1 - Math.exp(-seconds / tau)), 0, 1);
}

export function overlayEffectState(item: GamingOverlayItem, seconds: number, audioLevel = 0): OverlayEffectState {
  const time = Number.isFinite(seconds) ? seconds : 0;
  const speed = clamp(item.effectSpeed ?? 0.35, 0.05, 3);
  const intensity = clamp(item.effectIntensity ?? 1, 0, 2);
  const pulse = item.effect === "pulse" ? (1 - Math.cos(time * speed * Math.PI * 2)) * 0.5 : 0;
  const activity = clamp((pulse * 0.7 + clamp(audioLevel, 0, 1) * 0.8) * intensity, 0, 1);
  const primary = channels(item.borderColor || "#8b6cff");
  const accent = channels(item.effectColor || "#31d8ef");
  const mixed = primary.map((value, i) => Math.round(value + (accent[i] - value) * activity));
  const glow = clamp((item.glow ?? 0) * intensity * (1 + activity * 1.5), 0, 160);
  return {
    borderColor: "rgb(" + mixed.join(", ") + ")",
    glowColor: item.effect && item.effect !== "none" ? (item.effectColor || "#31d8ef") : (item.borderColor || "#8b6cff"),
    glow,
    chaseOpacity: item.effect === "chase" ? clamp((0.55 + activity * 0.45) * intensity, 0, 1) : 0,
    angle: ((time * speed * 360) % 360 + 360) % 360,
  };
}

export const OVERLAY_STYLE_PRESETS: { name: string; style: Partial<GamingOverlayItem> }[] = [
  { name: "Obsidian", style: { borderColor: "#8b6cff", effectColor: "#31d8ef", fillColor: "#0d0f14", fillOpacity: 0.14, borderWidth: 3, glow: 18, effect: "glow" } },
  { name: "Ice", style: { borderColor: "#45d8ff", effectColor: "#e5fcff", fillColor: "#071623", fillOpacity: 0.12, borderWidth: 2, glow: 16, effect: "pulse" } },
  { name: "Crimson", style: { borderColor: "#f24c73", effectColor: "#ffa05b", fillColor: "#190a13", fillOpacity: 0.14, borderWidth: 3, glow: 18, effect: "chase" } },
  { name: "Gold", style: { borderColor: "#d4af37", effectColor: "#fff0ba", fillColor: "#17120a", fillOpacity: 0.14, borderWidth: 3, glow: 16, effect: "glow" } },
];
