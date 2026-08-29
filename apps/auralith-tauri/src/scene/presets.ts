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
  }
];
