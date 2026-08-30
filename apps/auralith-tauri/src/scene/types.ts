export type FitMode = "Fit" | "Fill" | "Stretch" | "Center";
export type ViewMode = "Edit" | "Preview" | "CleanCapture";
export type RegionKind = "Trace" | "Stamp" | "Emitter";
export type AudioMap = "Manual" | "Raw" | "Bass" | "Low" | "Mid" | "High" | "FullMix" | "Beat" | "Transient";

export type EffectKind =
  | "Pulse" | "Flicker" | "LightSurge" | "Strobe" | "GlowBloom" | "BreathingGlow" | "Afterglow" | "EchoPulse" | "WaveSweep" | "Spotlight"
  | "Halo" | "LightRays" | "GodRays" | "LensFlare" | "Starburst"
  | "EnergyFlow" | "EnergyRipple" | "Shockwave" | "MagicEnergy" | "Plasma" | "VoidEnergy" | "Portal" | "Vortex" | "EnergyBeam" | "EnergySparks"
  | "SpectralAura" | "LightningArc" | "ElectricCrawl" | "ThunderFlash" | "Laser"
  | "RealisticFlame" | "Embers" | "Sparks" | "HeatDistortion" | "SmokeFog" | "Mist"
  | "HueShift" | "ChromaticPulse" | "PrismaticLight" | "NeonGlow" | "NeonChase" | "Shimmer" | "GlitterSparkle" | "HolographicDistortion" | "GlitchLight"
  | "ShadowPulse" | "RoomDim" | "LocalDim" | "ContrastSurge"
  | "Rain" | "WetReflection" | "Snow" | "Ash" | "DustMotes" | "Aurora" | "AtmosphericHaze" | "WaterReflection" | "Caustics" | "WaterRipple" | "Refraction"
  | "FrostIce" | "CrystalGrowth" | "IceShimmer" | "FrozenBreath" | "Fireflies"
  | "BioluminescentSpores" | "RuneGlow" | "SigilActivation" | "ShadowTendrils" | "Eclipse"
  | "GravityWell" | "SpatialWarp" | "Kaleidoscope" | "MirrorFracture" | "PixelDissolve"
  | "ScanlinePulse" | "RgbSplit" | "FilmBurn" | "CelestialStars" | "CosmicNebula" | "SmartNeon";

export const ALL_EFFECTS: EffectKind[] = [
  "Pulse","Flicker","LightSurge","Strobe","GlowBloom","BreathingGlow","Afterglow","EchoPulse","WaveSweep","Spotlight",
  "Halo","LightRays","GodRays","LensFlare","Starburst",
  "EnergyFlow","EnergyRipple","Shockwave","MagicEnergy","Plasma","VoidEnergy","Portal","Vortex","EnergyBeam","EnergySparks",
  "SpectralAura","LightningArc","ElectricCrawl","ThunderFlash","Laser",
  "RealisticFlame","Embers","Sparks","HeatDistortion","SmokeFog","Mist",
  "HueShift","ChromaticPulse","PrismaticLight","NeonGlow","NeonChase","Shimmer","GlitterSparkle","HolographicDistortion","GlitchLight",
  "ShadowPulse","RoomDim","LocalDim","ContrastSurge",
  "Rain","WetReflection","Snow","Ash","DustMotes","Aurora","AtmosphericHaze","WaterReflection","Caustics","WaterRipple","Refraction",
  "FrostIce","CrystalGrowth","IceShimmer","FrozenBreath","Fireflies",
  "BioluminescentSpores","RuneGlow","SigilActivation","ShadowTendrils","Eclipse",
  "GravityWell","SpatialWarp","Kaleidoscope","MirrorFracture","PixelDissolve",
  "ScanlinePulse","RgbSplit","FilmBurn","CelestialStars","CosmicNebula"
];

export type EffectInstance = {
  id: string;
  kind: EffectKind;
  enabled: boolean;
  intensity: number;
  brightness: number;
  opacity: number;
  speed: number;
  scale: number;
  audio: AudioMap;
  audioInfluence: number;
  color: string;
  color2: string;
  color3?: string;
  p0?: number;
  p1?: number;
  p2?: number;
  preset?: string;
};

export type Region = {
  id: string;
  kind: RegionKind;
  points: { x: number; y: number }[];
  x: number; y: number;
  sx: number; sy: number;
  rotation: number;
  radius: number;
  effects: EffectInstance[];
  label?: string;
  experimental?: boolean;
};

export type Project = {
  version: 1;
  width: number;
  height: number;
  fit: FitMode;
  backdropDataUrl?: string;
  regions: Region[];
  masters: { intensity: number; brightness: number; sensitivity: number; density: number; motion: number };
  quality: "Low" | "Medium" | "High" | "Ultra";
  showMarkers: boolean;
};

export function newProject(): Project {
  return {
    version: 1, width: 1920, height: 1080, fit: "Fit", regions: [],
    masters: { intensity: 1, brightness: 1, sensitivity: 1, density: 1, motion: 1 },
    quality: "High", showMarkers: true
  };
}

export function defaultEffect(kind: EffectKind): EffectInstance {
  return {
    id: crypto.randomUUID(), kind, enabled: true, intensity: 0.8, brightness: 1, opacity: 1,
    speed: 1, scale: 1, audio: "Manual", audioInfluence: 0.7, color: "#f4d27a", color2: "#7ad0ff",
    color3: "#ffffff", p0: 0.65, p1: 0.5, p2: 0.4, preset: "Default"
  };
}

const KIND_ALIASES: Record<string, EffectKind> = {
  RuneSequence: "SigilActivation",
  TraceChase: "NeonChase",
  TracePulse: "Pulse",
  OutlineEnergy: "EnergyFlow",
  ParticleBurst: "EnergySparks",
  ParticleFountain: "Embers",
  OrbitingParticles: "Fireflies",
  GravityParticles: "GravityWell",
  ReverseGravity: "Embers",
  Swarm: "Fireflies",
  Trail: "Afterglow",
  BeatFlash: "ThunderFlash",
  TransientBurst: "Sparks",
  BassExpansion: "Pulse",
  FrequencyGradient: "HueShift",
  SpectrumSweep: "PrismaticLight",
  AudioRipple: "EnergyRipple",
  PeakHoldGlow: "Afterglow",
  RhythmChase: "NeonChase"
};

export function normalizeEffect(e: Partial<EffectInstance> & { kind: string }): EffectInstance {
  const kind = (KIND_ALIASES[e.kind] || (e.kind === "SmartNeon" || ALL_EFFECTS.includes(e.kind as EffectKind) ? e.kind : "Pulse")) as EffectKind;
  const d = defaultEffect(kind);
  return {
    ...d,
    ...e,
    id: e.id || d.id,
    enabled: e.enabled !== false,
    intensity: Number.isFinite(e.intensity as number) ? (e.intensity as number) : d.intensity,
    brightness: Number.isFinite(e.brightness as number) ? (e.brightness as number) : d.brightness,
    opacity: Number.isFinite(e.opacity as number) ? (e.opacity as number) : d.opacity,
    speed: Number.isFinite(e.speed as number) ? (e.speed as number) : d.speed,
    scale: Number.isFinite(e.scale as number) ? (e.scale as number) : d.scale,
    audioInfluence: Number.isFinite(e.audioInfluence as number) ? (e.audioInfluence as number) : d.audioInfluence,
    color: e.color || d.color,
    color2: e.color2 || d.color2,
    color3: e.color3 || d.color3,
    p0: Number.isFinite(e.p0 as number) ? e.p0 : d.p0,
    p1: Number.isFinite(e.p1 as number) ? e.p1 : d.p1,
    p2: Number.isFinite(e.p2 as number) ? e.p2 : d.p2,
  };
}
