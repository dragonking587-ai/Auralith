import type { SCHEMA_VERSION } from "./version.ts";

export type BandId = "bass" | "low" | "mid" | "high";
export type EffectId = "pulse" | "hue" | "flicker" | "strobe";
export type ToolId = "stamp" | "trace" | "move" | "erase" | "pan";
export type FitMode = "fill" | "fit" | "stretch";
export type AudioSourceId = "none" | "demo" | "track" | "mic" | "system";
export type OutputMethod = "browser" | "window";
export type PlatformId = "obs" | "streamlabs" | "tiktok" | "custom";
export type FpsCap = 30 | 60;

export const BANDS: BandId[] = ["bass", "low", "mid", "high"];
export const EFFECTS: EffectId[] = ["pulse", "hue", "flicker", "strobe"];

export interface Point {
  x: number;
  y: number;
}

export interface StampRegion {
  id: string;
  kind: "stamp";
  x: number;
  y: number;
  r: number;
  band: BandId;
  effect: EffectId;
  color: string;
  intensity: number;
}

export interface TraceRegion {
  id: string;
  kind: "trace";
  points: Point[];
  width: number;
  band: BandId;
  effect: EffectId;
  color: string;
  intensity: number;
}

export type Region = StampRegion | TraceRegion;

export interface Framing {
  fit: FitMode;
  panX: number;
  panY: number;
}

export interface AudioSettings {
  sensitivity: number;
  masterIntensity: number;
  roomDim: number;
}

export interface OutputSettings {
  width: number;
  height: number;
  fps: FpsCap;
  platform: PlatformId;
  method: OutputMethod;
  presetId: string;
}

export interface SceneImage {
  id: string;
  width: number;
  height: number;
  mime: string;
}

export interface Scene {
  schemaVersion: typeof SCHEMA_VERSION;
  name: string;
  image: SceneImage | null;
  regions: Region[];
  framing: Framing;
  audio: AudioSettings;
  output: OutputSettings;
  defaultBand: BandId;
  defaultEffect: EffectId;
  defaultColor: string;
}

export interface SavedSceneMeta {
  id: string;
  name: string;
  updatedAt: number;
  thumbnail?: string;
}

export interface Bands {
  bass: number;
  low: number;
  mid: number;
  high: number;
}

export interface LiveBands extends Bands {
  t: number;
  seq: number;
  dim: number;
  intensity: number;
}

export interface ImageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_FRAMING: Framing = {
  fit: "fill",
  panX: 0.5,
  panY: 0.5,
};

export const DEFAULT_AUDIO: AudioSettings = {
  sensitivity: 1,
  masterIntensity: 0.85,
  roomDim: 0.12,
};

export const BAND_RANGES: Record<BandId, [number, number]> = {
  bass: [20, 80],
  low: [80, 250],
  mid: [250, 2000],
  high: [2000, 12000],
};

export const BAND_LABEL: Record<BandId, string> = {
  bass: "Bass",
  low: "Low",
  mid: "Mid",
  high: "High",
};

export const EFFECT_LABEL: Record<EffectId, string> = {
  pulse: "Pulse",
  hue: "Hue",
  flicker: "Flicker",
  strobe: "Strobe",
};

export const BAND_COLOR: Record<BandId, string> = {
  bass: "#d08a5c",
  low: "#c9a36a",
  mid: "#7e9e96",
  high: "#9bb4c9",
};
