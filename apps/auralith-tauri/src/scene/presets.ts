import type { EffectInstance, EffectKind } from "./types";
import { defaultEffect } from "./types";

export type NamedPreset = { name: string; apply: (kind: EffectKind) => Partial<EffectInstance> };

export const VORTEX_PRESETS: NamedPreset[] = [
  {
    name: "Auralith Vortex",
    apply: () => ({
      color: "#c000ff", color2: "#19d4ff", color3: "#e8ffff",
      intensity: 1.15, opacity: 1, speed: 1.05, scale: 1.2,
      p0: 0.85, p1: 0.7, p2: 0.75, audio: "FullMix", audioInfluence: 0.85, preset: "Auralith Vortex"
    })
  },
  {
    name: "Infernal Vortex",
    apply: () => ({
      color: "#ff3b00", color2: "#ffd166", color3: "#fff4c2",
      intensity: 1.2, p0: 0.9, p1: 0.65, p2: 0.55, audio: "Bass", audioInfluence: 0.9, preset: "Infernal Vortex"
    })
  },
  {
    name: "Holy Vortex",
    apply: () => ({
      color: "#fff6d0", color2: "#7ad0ff", color3: "#ffffff",
      intensity: 1.0, p0: 0.6, p1: 0.5, p2: 0.4, audio: "High", audioInfluence: 0.7, preset: "Holy Vortex"
    })
  },
  {
    name: "Void Vortex",
    apply: () => ({
      color: "#2a0052", color2: "#7b2cff", color3: "#d7b3ff",
      intensity: 1.1, p0: 1.0, p1: 0.8, p2: 0.9, audio: "Low", audioInfluence: 0.8, preset: "Void Vortex"
    })
  },
  {
    name: "Custom Vortex",
    apply: (kind) => ({ ...defaultEffect(kind), preset: "Custom Vortex", intensity: 1 })
  },
  {
    name: "Candle",
    apply: () => ({ color: "#ffd27a", color2: "#ff6a00", color3: "#fff4c2", p0: 0.35, p1: 0.25, p2: 0.4, speed: 0.7, preset: "Candle" })
  },
  {
    name: "Inferno",
    apply: () => ({ color: "#ff3b00", color2: "#ffd000", color3: "#fff0c0", p0: 1.2, p1: 0.9, p2: 0.8, intensity: 1.2, preset: "Inferno" })
  },
  {
    name: "Blue Flame",
    apply: () => ({ color: "#7ad0ff", color2: "#2a6bff", color3: "#e8ffff", p0: 0.8, p1: 0.55, p2: 0.5, preset: "Blue Flame" })
  },
  {
    name: "Natural Fire",
    apply: () => ({ color: "#fff4c2", color2: "#ff8a1a", color3: "#7a1200", p0: 0.72, p1: 0.48, p2: 0.62, speed: 1.0, audio: "Bass", audioInfluence: 0.85, preset: "Natural Fire" })
  },
  {
    name: "Torch Flame",
    apply: () => ({ color: "#fff1a8", color2: "#ff7a12", color3: "#5a0c00", p0: 0.55, p1: 0.32, p2: 0.7, speed: 0.85, audio: "Mid", audioInfluence: 0.7, preset: "Torch Flame" })
  },
  {
    name: "Roaring Fire",
    apply: () => ({ color: "#fff8d6", color2: "#ff5a00", color3: "#3a0600", p0: 1.15, p1: 0.82, p2: 0.88, intensity: 1.25, speed: 1.2, audio: "Bass", audioInfluence: 1.0, preset: "Roaring Fire" })
  },
  {
    name: "Arcane Flame",
    apply: () => ({ color: "#e8d0ff", color2: "#7b2cff", color3: "#120428", p0: 0.8, p1: 0.5, p2: 0.75, audio: "High", audioInfluence: 0.8, preset: "Arcane Flame" })
  },
  {
    name: "Infernal Red",
    apply: () => ({ color: "#ffd0a0", color2: "#ff1e00", color3: "#2a0000", p0: 0.95, p1: 0.7, p2: 0.65, intensity: 1.15, audio: "Bass", audioInfluence: 0.95, preset: "Infernal Red" })
  },
  {
    name: "White Hot",
    apply: () => ({ color: "#ffffff", color2: "#ffe08a", color3: "#ff6a00", p0: 0.85, p1: 0.45, p2: 0.4, intensity: 1.3, preset: "White Hot" })
  }
];
