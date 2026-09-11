import { ALL_EFFECTS, defaultEffect, type AudioMap, type EffectInstance, type EffectKind, type Project } from "./types";

export type EffectPackManifest = {
  format: 1;
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  collection?: string;
  minAuralithVersion?: string;
  recommendedQuality?: Project["quality"];
};

export type EffectPack = {
  manifest: EffectPackManifest;
  effects: EffectInstance[];
};

const STORAGE_KEY = "auralith.effectPacks.v1";
const MAX_EFFECTS_PER_PACK = 32;
const SAFE_AUDIO = new Set<AudioMap>(["Manual", "Raw", "Bass", "Low", "Mid", "High", "FullMix", "Beat", "Transient"]);
const SAFE_QUALITY = new Set<Project["quality"]>(["Low", "Medium", "High", "Ultra"]);
const SAFE_REALISM = new Set(["Performance", "High", "Cinematic"]);
const SAFE_GEOM = new Set(["point", "path", "mask"]);
const SAFE_APPLY = new Set(["inside", "boundary", "outside"]);

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

const cleanText = (value: unknown, fallback = "", max = 160) => {
  const s = typeof value === "string" ? value.trim() : fallback;
  return (s || fallback).slice(0, max);
};

const cleanColor = (value: unknown, fallback: string) => {
  const s = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
};

function sanitizeEffect(raw: unknown, index: number): EffectInstance {
  if (!raw || typeof raw !== "object") throw new Error(`Effect ${index + 1} is invalid.`);
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind || "") as EffectKind;
  if (!ALL_EFFECTS.includes(kind)) throw new Error(`Effect ${index + 1} uses unsupported kind: ${String(r.kind || "unknown")}`);
  const d = defaultEffect(kind);
  const audio = SAFE_AUDIO.has(r.audio as AudioMap) ? (r.audio as AudioMap) : d.audio;
  const realismQuality = SAFE_REALISM.has(String(r.realismQuality || "")) ? (r.realismQuality as EffectInstance["realismQuality"]) : d.realismQuality;
  const geomMode = SAFE_GEOM.has(String(r.geomMode || "")) ? (r.geomMode as EffectInstance["geomMode"]) : d.geomMode;
  const applyMode = SAFE_APPLY.has(String(r.applyMode || "")) ? (r.applyMode as EffectInstance["applyMode"]) : d.applyMode;
  return {
    id: cleanText(r.id, `pack-${index + 1}`, 96),
    kind,
    enabled: r.enabled !== false,
    intensity: clamp(r.intensity, d.intensity, 0, 2),
    brightness: clamp(r.brightness, d.brightness, 0, 2),
    opacity: clamp(r.opacity, d.opacity, 0, 1),
    speed: clamp(r.speed, d.speed, 0.01, 8),
    scale: clamp(r.scale, d.scale, 0.05, 20),
    audio,
    audioInfluence: clamp(r.audioInfluence, d.audioInfluence, 0, 1),
    color: cleanColor(r.color, d.color),
    color2: cleanColor(r.color2, d.color2),
    color3: cleanColor(r.color3, d.color3 || "#ffffff"),
    realismQuality,
    bassInfluence: r.bassInfluence == null ? d.bassInfluence : clamp(r.bassInfluence, d.bassInfluence ?? 1, 0, 2),
    lowMidPlasma: r.lowMidPlasma == null ? d.lowMidPlasma : clamp(r.lowMidPlasma, d.lowMidPlasma ?? 1, 0, 2),
    midMotion: r.midMotion == null ? d.midMotion : clamp(r.midMotion, d.midMotion ?? 1, 0, 2),
    highSparkDensity: r.highSparkDensity == null ? d.highSparkDensity : clamp(r.highSparkDensity, d.highSparkDensity ?? 1, 0, 2),
    transientStrength: r.transientStrength == null ? d.transientStrength : clamp(r.transientStrength, d.transientStrength ?? 1, 0, 2),
    beatPulse: r.beatPulse == null ? d.beatPulse : clamp(r.beatPulse, d.beatPulse ?? 0.8, 0, 2),
    responseSpeed: r.responseSpeed == null ? d.responseSpeed : clamp(r.responseSpeed, d.responseSpeed ?? 1, 0.1, 4),
    decay: r.decay == null ? d.decay : clamp(r.decay, d.decay ?? 0.7, 0.01, 4),
    p0: clamp(r.p0, d.p0 ?? 0.65, 0, 4),
    p1: clamp(r.p1, d.p1 ?? 0.5, 0, 4),
    p2: clamp(r.p2, d.p2 ?? 0.4, 0, 4),
    preset: cleanText(r.preset, d.preset || "Default", 80),
    geomMode,
    applyMode,
    boundaryWidth: r.boundaryWidth == null ? d.boundaryWidth : clamp(r.boundaryWidth, d.boundaryWidth ?? 0.35, 0.01, 4),
    fxW: r.fxW == null ? d.fxW : clamp(r.fxW, d.fxW ?? 0, 0, 8000),
    fxH: r.fxH == null ? d.fxH : clamp(r.fxH, d.fxH ?? 0, 0, 8000),
    fxScaleX: r.fxScaleX == null ? d.fxScaleX : clamp(r.fxScaleX, d.fxScaleX ?? 1, 0.05, 20),
    fxScaleY: r.fxScaleY == null ? d.fxScaleY : clamp(r.fxScaleY, d.fxScaleY ?? 1, 0.05, 20),
    expansion: r.expansion == null ? d.expansion : clamp(r.expansion, d.expansion ?? 0, 0, 4000),
    offsetX: r.offsetX == null ? d.offsetX : clamp(r.offsetX, d.offsetX ?? 0, -4000, 4000),
    offsetY: r.offsetY == null ? d.offsetY : clamp(r.offsetY, d.offsetY ?? 0, -4000, 4000),
    spread: r.spread == null ? d.spread : clamp(r.spread, d.spread ?? 0, 0, 4000),
    feather: r.feather == null ? d.feather : clamp(r.feather, d.feather ?? 0, 0, 1),
  };
}

function sanitizeManifest(raw: unknown): EffectPackManifest {
  if (!raw || typeof raw !== "object") throw new Error("Effect pack manifest is missing.");
  const m = raw as Record<string, unknown>;
  if (Number(m.format) !== 1) throw new Error("Unsupported effect pack format.");
  const quality = SAFE_QUALITY.has(m.recommendedQuality as Project["quality"]) ? (m.recommendedQuality as Project["quality"]) : "High";
  const tags = Array.isArray(m.tags) ? m.tags.slice(0, 12).map((x) => cleanText(x, "", 32)).filter(Boolean) : [];
  return {
    format: 1,
    id: cleanText(m.id, `custom.${Date.now()}`, 120).replace(/[^a-zA-Z0-9._-]/g, "-"),
    name: cleanText(m.name, "Untitled Effect Pack", 80),
    author: cleanText(m.author, "Auralith Creator", 80),
    version: cleanText(m.version, "1.0.0", 32),
    description: cleanText(m.description, "Stacked Auralith effect pack.", 500),
    category: cleanText(m.category, "Custom", 48),
    tags,
    collection: m.collection ? cleanText(m.collection, "", 80) : undefined,
    minAuralithVersion: m.minAuralithVersion ? cleanText(m.minAuralithVersion, "", 40) : undefined,
    recommendedQuality: quality,
  };
}

export function sanitizeEffectPack(raw: unknown): EffectPack {
  if (!raw || typeof raw !== "object") throw new Error("Invalid effect pack file.");
  const p = raw as Record<string, unknown>;
  const effectsRaw = Array.isArray(p.effects) ? p.effects : [];
  if (!effectsRaw.length) throw new Error("Effect pack does not contain any effects.");
  if (effectsRaw.length > MAX_EFFECTS_PER_PACK) throw new Error(`Effect pack exceeds the ${MAX_EFFECTS_PER_PACK}-effect safety limit.`);
  return {
    manifest: sanitizeManifest(p.manifest),
    effects: effectsRaw.map((e, i) => sanitizeEffect(e, i)),
  };
}

export function serializeEffectPack(pack: EffectPack) {
  return JSON.stringify(sanitizeEffectPack(pack), null, 2);
}

export function parseEffectPack(text: string) {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("This .aurapack file is not valid JSON."); }
  return sanitizeEffectPack(raw);
}

export function instantiatePackEffects(pack: EffectPack): EffectInstance[] {
  return sanitizeEffectPack(pack).effects.map((effect) => ({ ...effect, id: crypto.randomUUID() }));
}

export function createPackFromStack(input: {
  name: string;
  author?: string;
  description?: string;
  category?: string;
  tags?: string[];
  collection?: string;
  minAuralithVersion?: string;
  recommendedQuality?: Project["quality"];
  effects: EffectInstance[];
}): EffectPack {
  const slug = cleanText(input.name, "custom-effect", 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom-effect";
  return sanitizeEffectPack({
    manifest: {
      format: 1,
      id: `custom.${slug}.${Date.now()}`,
      name: input.name,
      author: input.author || "Auralith Creator",
      version: "1.0.0",
      description: input.description || "Custom stacked Auralith effect.",
      category: input.category || "Custom",
      tags: input.tags || [],
      collection: input.collection,
      minAuralithVersion: input.minAuralithVersion,
      recommendedQuality: input.recommendedQuality || "High",
    },
    effects: input.effects,
  });
}

export function loadInstalledEffectPacks(): EffectPack[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map((p) => { try { return sanitizeEffectPack(p); } catch { return null; } }).filter((p): p is EffectPack => !!p);
  } catch { return []; }
}

function persistInstalledEffectPacks(packs: EffectPack[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs.map(sanitizeEffectPack)));
}

export function installEffectPack(pack: EffectPack): EffectPack[] {
  const safe = sanitizeEffectPack(pack);
  const list = loadInstalledEffectPacks().filter((p) => p.manifest.id !== safe.manifest.id);
  list.push(safe);
  persistInstalledEffectPacks(list);
  return list;
}

export function uninstallEffectPack(id: string): EffectPack[] {
  const list = loadInstalledEffectPacks().filter((p) => p.manifest.id !== id);
  persistInstalledEffectPacks(list);
  return list;
}

function built(kind: EffectKind, id: string, patch: Partial<EffectInstance>): EffectInstance {
  return { ...defaultEffect(kind), id, ...patch };
}

const COLLECTION = "Obsidian Wolf Effects Collection";

export const OBSIDIAN_WOLF_EFFECT_PACKS: EffectPack[] = [
  {
    manifest: {
      format: 1,
      id: "obsidianwolf.inferno-aura",
      name: "Inferno Aura",
      author: "Obsidian Wolf",
      version: "1.0.0",
      description: "Natural fire, heat shimmer, embers, bloom and transient sparks layered into one aggressive fire aura.",
      category: "Fire",
      tags: ["fire", "embers", "heat", "aura"],
      collection: COLLECTION,
      recommendedQuality: "High",
    },
    effects: [
      built("RealisticFlame", "ow-inferno-flame", { intensity: 0.95, opacity: 0.92, audio: "Bass", audioInfluence: 0.72, p0: 0.86, p1: 0.82, p2: 0.58, color: "#ffb000", color2: "#ff3d00", color3: "#fff0b0" }),
      built("HeatDistortion", "ow-inferno-heat", { intensity: 0.42, opacity: 0.62, audio: "Low", audioInfluence: 0.48, speed: 0.78, p0: 0.58, p1: 0.44, p2: 0.36 }),
      built("Embers", "ow-inferno-embers", { intensity: 0.52, opacity: 0.86, audio: "Mid", audioInfluence: 0.55, speed: 0.72, p0: 0.48, p1: 0.62, p2: 0.44, color: "#ff7a00", color2: "#ffcf5c" }),
      built("GlowBloom", "ow-inferno-bloom", { intensity: 0.38, opacity: 0.72, audio: "Bass", audioInfluence: 0.36, color: "#ff6500", color2: "#ffb000" }),
      built("Sparks", "ow-inferno-sparks", { intensity: 0.32, opacity: 0.92, audio: "Transient", audioInfluence: 0.86, speed: 1.15, p0: 0.42, p1: 0.58, p2: 0.52, color: "#ffd36a", color2: "#ffffff" }),
    ],
  },
  {
    manifest: {
      format: 1,
      id: "obsidianwolf.void-howl",
      name: "Void Howl",
      author: "Obsidian Wolf",
      version: "1.0.0",
      description: "Deep violet void energy surrounded by spectral aura, shadow breathing and reactive energy sparks.",
      category: "Dark Magic",
      tags: ["void", "dark", "magic", "wolf"],
      collection: COLLECTION,
      recommendedQuality: "High",
    },
    effects: [
      built("VoidEnergy", "ow-void-core", { intensity: 0.92, opacity: 0.9, audio: "Bass", audioInfluence: 0.68, color: "#5a18a8", color2: "#12001f", color3: "#c778ff", p0: 0.76, p1: 0.72, p2: 0.62 }),
      built("SpectralAura", "ow-void-aura", { intensity: 0.58, opacity: 0.72, audio: "Low", audioInfluence: 0.48, color: "#8b35ff", color2: "#311057", color3: "#d7b0ff" }),
      built("ShadowPulse", "ow-void-shadow", { intensity: 0.36, opacity: 0.54, audio: "Bass", audioInfluence: 0.42, speed: 0.62 }),
      built("EnergySparks", "ow-void-sparks", { intensity: 0.34, opacity: 0.86, audio: "High", audioInfluence: 0.74, color: "#b96cff", color2: "#e9d0ff" }),
    ],
  },
  {
    manifest: {
      format: 1,
      id: "obsidianwolf.storm-fang",
      name: "Storm Fang",
      author: "Obsidian Wolf",
      version: "1.0.0",
      description: "Layered lightning, electric crawl, thunder flashes and cold bloom for a violent storm-charged effect.",
      category: "Electric",
      tags: ["lightning", "storm", "electric", "impact"],
      collection: COLLECTION,
      recommendedQuality: "High",
    },
    effects: [
      built("LightningArc", "ow-storm-arc", { intensity: 0.9, opacity: 0.96, audio: "Transient", audioInfluence: 0.9, color: "#bde8ff", color2: "#5a7dff", color3: "#ffffff", p0: 0.7, p1: 0.48, p2: 0.78 }),
      built("ElectricCrawl", "ow-storm-crawl", { intensity: 0.66, opacity: 0.86, audio: "High", audioInfluence: 0.72, speed: 1.18, color: "#77cfff", color2: "#2c5cff" }),
      built("ThunderFlash", "ow-storm-flash", { intensity: 0.5, opacity: 0.72, audio: "Beat", audioInfluence: 0.82, color: "#e8f8ff", color2: "#9ddcff" }),
      built("GlowBloom", "ow-storm-bloom", { intensity: 0.34, opacity: 0.62, audio: "High", audioInfluence: 0.4, color: "#69bfff", color2: "#bfeaff" }),
    ],
  },
  {
    manifest: {
      format: 1,
      id: "obsidianwolf.blood-moon-ritual",
      name: "Blood Moon Ritual",
      author: "Obsidian Wolf",
      version: "1.0.0",
      description: "A dark eclipse and rune stack with red atmospheric haze and living shadow tendrils.",
      category: "Ritual",
      tags: ["blood moon", "eclipse", "runes", "dark"],
      collection: COLLECTION,
      recommendedQuality: "High",
    },
    effects: [
      built("Eclipse", "ow-blood-eclipse", { intensity: 0.82, opacity: 0.9, audio: "Bass", audioInfluence: 0.52, color: "#170003", color2: "#7a0505", color3: "#ff3a24" }),
      built("RuneGlow", "ow-blood-rune", { intensity: 0.62, opacity: 0.82, audio: "Mid", audioInfluence: 0.62, color: "#ff2b20", color2: "#7d0000", color3: "#ffb08a" }),
      built("AtmosphericHaze", "ow-blood-haze", { intensity: 0.3, opacity: 0.42, audio: "Low", audioInfluence: 0.28, speed: 0.48, color: "#360005", color2: "#6b0b10" }),
      built("ShadowTendrils", "ow-blood-tendrils", { intensity: 0.42, opacity: 0.58, audio: "Bass", audioInfluence: 0.44, speed: 0.7, color: "#160006", color2: "#4d0508" }),
    ],
  },
  {
    manifest: {
      format: 1,
      id: "obsidianwolf.frostbite-wolf",
      name: "Frostbite Wolf",
      author: "Obsidian Wolf",
      version: "1.0.0",
      description: "Layered frost growth, crystalline shimmer and frozen breath with sharp high-frequency sparkle.",
      category: "Ice",
      tags: ["ice", "frost", "crystal", "cold"],
      collection: COLLECTION,
      recommendedQuality: "High",
    },
    effects: [
      built("FrostIce", "ow-frost-base", { intensity: 0.72, opacity: 0.84, audio: "Low", audioInfluence: 0.42, color: "#b9efff", color2: "#4d9cff", color3: "#ffffff" }),
      built("CrystalGrowth", "ow-frost-crystal", { intensity: 0.52, opacity: 0.72, audio: "Mid", audioInfluence: 0.5, speed: 0.52, color: "#9de7ff", color2: "#6ab3ff" }),
      built("IceShimmer", "ow-frost-shimmer", { intensity: 0.38, opacity: 0.82, audio: "High", audioInfluence: 0.78, color: "#dff8ff", color2: "#95dfff", color3: "#ffffff" }),
      built("FrozenBreath", "ow-frost-breath", { intensity: 0.34, opacity: 0.5, audio: "Low", audioInfluence: 0.34, speed: 0.6, color: "#c8f3ff", color2: "#7abfe0" }),
    ],
  },
].map(sanitizeEffectPack);

export const BUILTIN_EFFECT_PACKS = OBSIDIAN_WOLF_EFFECT_PACKS;
