import type { OutputSettings, PlatformId } from "./types.ts";

export interface ResolutionPreset {
  id: string;
  label: string;
  group: string;
  platform: PlatformId;
  width: number;
  height: number;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: "tiktok-p-1080", label: "1080 × 1920", group: "TikTok Portrait", platform: "tiktok", width: 1080, height: 1920 },
  { id: "tiktok-p-720", label: "720 × 1280", group: "TikTok Portrait", platform: "tiktok", width: 720, height: 1280 },
  { id: "tiktok-l-1080", label: "1920 × 1080", group: "TikTok Landscape", platform: "tiktok", width: 1920, height: 1080 },
  { id: "tiktok-l-720", label: "1280 × 720", group: "TikTok Landscape", platform: "tiktok", width: 1280, height: 720 },
  { id: "obs-l-1080", label: "1920 × 1080", group: "OBS Landscape", platform: "obs", width: 1920, height: 1080 },
  { id: "obs-l-720", label: "1280 × 720", group: "OBS Landscape", platform: "obs", width: 1280, height: 720 },
  { id: "obs-l-1440", label: "2560 × 1440", group: "OBS Landscape", platform: "obs", width: 2560, height: 1440 },
  { id: "obs-l-4k", label: "3840 × 2160", group: "OBS Landscape", platform: "obs", width: 3840, height: 2160 },
  { id: "obs-p-1080", label: "1080 × 1920", group: "OBS Portrait", platform: "obs", width: 1080, height: 1920 },
  { id: "obs-p-720", label: "720 × 1280", group: "OBS Portrait", platform: "obs", width: 720, height: 1280 },
  { id: "obs-p-1440", label: "1440 × 2560", group: "OBS Portrait", platform: "obs", width: 1440, height: 2560 },
  { id: "sl-l-1080", label: "1920 × 1080", group: "Streamlabs Landscape", platform: "streamlabs", width: 1920, height: 1080 },
  { id: "sl-l-720", label: "1280 × 720", group: "Streamlabs Landscape", platform: "streamlabs", width: 1280, height: 720 },
  { id: "sl-p-1080", label: "1080 × 1920", group: "Streamlabs Portrait", platform: "streamlabs", width: 1080, height: 1920 },
  { id: "sl-p-720", label: "720 × 1280", group: "Streamlabs Portrait", platform: "streamlabs", width: 720, height: 1280 },
  { id: "custom", label: "Custom", group: "Custom", platform: "custom", width: 1920, height: 1080 },
];

export const DEFAULT_PRESET_ID = "obs-l-1080";

export function presetById(id: string): ResolutionPreset {
  return RESOLUTION_PRESETS.find((p) => p.id === id) ?? RESOLUTION_PRESETS[4]!;
}

export function defaultOutput(): OutputSettings {
  const p = presetById(DEFAULT_PRESET_ID);
  return {
    width: p.width,
    height: p.height,
    fps: 60,
    platform: p.platform,
    method: "browser",
    presetId: p.id,
  };
}

export function groupedPresets(): { group: string; items: ResolutionPreset[] }[] {
  const map = new Map<string, ResolutionPreset[]>();
  for (const p of RESOLUTION_PRESETS) {
    const list = map.get(p.group) ?? [];
    list.push(p);
    map.set(p.group, list);
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
}
