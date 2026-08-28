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
  | "RuneGlow" | "RuneSequence" | "TraceChase" | "TracePulse" | "OutlineEnergy"
  | "ParticleBurst" | "ParticleFountain" | "OrbitingParticles" | "GravityParticles" | "ReverseGravity" | "Swarm" | "Trail"
  | "BeatFlash" | "TransientBurst" | "BassExpansion" | "FrequencyGradient" | "SpectrumSweep" | "AudioRipple" | "PeakHoldGlow" | "RhythmChase";

export const ALL_EFFECTS: EffectKind[] = [
  "Pulse","Flicker","LightSurge","Strobe","GlowBloom","BreathingGlow","Afterglow","EchoPulse","WaveSweep","Spotlight",
  "Halo","LightRays","GodRays","LensFlare","Starburst",
  "EnergyFlow","EnergyRipple","Shockwave","MagicEnergy","Plasma","VoidEnergy","Portal","Vortex","EnergyBeam","EnergySparks",
  "SpectralAura","LightningArc","ElectricCrawl","ThunderFlash","Laser",
  "RealisticFlame","Embers","Sparks","HeatDistortion","SmokeFog","Mist",
  "HueShift","ChromaticPulse","PrismaticLight","NeonGlow","NeonChase","Shimmer","GlitterSparkle","HolographicDistortion","GlitchLight",
  "ShadowPulse","RoomDim","LocalDim","ContrastSurge",
  "Rain","WetReflection","Snow","Ash","DustMotes","Aurora","AtmosphericHaze","WaterReflection","Caustics","WaterRipple","Refraction",
  "RuneGlow","RuneSequence","TraceChase","TracePulse","OutlineEnergy",
  "ParticleBurst","ParticleFountain","OrbitingParticles","GravityParticles","ReverseGravity","Swarm","Trail",
  "BeatFlash","TransientBurst","BassExpansion","FrequencyGradient","SpectrumSweep","AudioRipple","PeakHoldGlow","RhythmChase"
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
    speed: 1, scale: 1, audio: "Manual", audioInfluence: 0.7, color: "#f4d27a", color2: "#7ad0ff"
  };
}
