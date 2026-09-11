import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const appPath = path.join(root, "src", "ui", "App.tsx");
const rendererPath = path.join(root, "src", "render", "renderer.ts");
const cinematicPath = path.join(root, "src", "render", "cinematicRenderer.ts");
const pipelinePath = path.join(root, "src", "render", "cinematicPipelineV2.ts");

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[cinematic] missing ${label}`);
  return text.replace(from, to);
}

let app = fs.readFileSync(appPath, "utf8");
app = replaceOnce(
  app,
  'import { GlRenderer } from "../render/renderer";',
  'import { GlRenderer } from "../render/cinematicRenderer";',
  "renderer import"
);

app = replaceOnce(
  app,
  '    autosaveProject(JSON.stringify({ ...project, reactions: rxEngine.persist() }));',
  `    try {\n      const recoveryProject = await serializeProject(project, {\n        backdropImage: imgRef.current,\n        poll: persistablePoll(pollCfg),\n        reactions: rxEngine.persist()\n      });\n      autosaveProject(JSON.stringify(recoveryProject));\n    } catch {\n      autosaveProject(JSON.stringify({ ...project, reactions: rxEngine.persist() }));\n    }`,
  "durable updater recovery snapshot"
);
fs.writeFileSync(appPath, app);

let renderer = fs.readFileSync(rendererPath, "utf8");
renderer = renderer.replace(
  'canvas.getContext("webgl2", { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance", premultipliedAlpha: false })',
  'canvas.getContext("webgl2", { alpha: false, antialias: true, preserveDrawingBuffer: true })'
);
renderer = renderer.replace(
  'canvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance", premultipliedAlpha: false })',
  'canvas.getContext("webgl", { alpha: false, antialias: true, preserveDrawingBuffer: true })'
);
renderer = renderer.replace(
  'gl.clearColor(0.02, 0.02, 0.04, this.hasBackdrop ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);',
  'gl.clearColor(0.02, 0.02, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT);'
);
renderer = renderer.replace(
  'gl.clearColor(0.05, 0.05, 0.07, this.hasBackdrop ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);',
  'gl.clearColor(0.05, 0.05, 0.07, 1); gl.clear(gl.COLOR_BUFFER_BIT);'
);
fs.writeFileSync(rendererPath, renderer);

let pipeline = fs.readFileSync(pipelinePath, "utf8");
pipeline = replaceOnce(
  pipeline,
  '      float outAlpha = mix(c.a, max(c.a, glowAlpha), overlayMode);',
  '      float outAlpha = mix(c.a, glowAlpha, overlayMode);',
  "overlay alpha composition"
);
pipeline = replaceOnce(
  pipeline,
  '    this.finishPass.uniforms.overlayMode.value = project.backdropDataUrl ? 0.0 : 1.0;',
  '    this.finishPass.uniforms.overlayMode.value = 1.0;',
  "effects-only overlay mode"
);

// Pulse / Energy Motion family. Skip these intermediate transforms if the final
// all-family wiring is already present. Tauri invokes the frontend build twice
// during packaging, so this script must be safely repeatable.
const finalPipelineAlreadyWired = pipeline.includes('private colorDigitalLayer: ThreeColorDigitalLayer;');
if (!finalPipelineAlreadyWired) {
  pipeline = replaceOnce(
    pipeline,
    'import { ThreeParticleLayer } from "./threeParticleLayer";',
    'import { ThreeParticleLayer } from "./threeParticleLayer";\nimport { ThreePulseEnergyLayer } from "./threePulseEnergyLayer";',
    "pulse/energy import"
  );
  pipeline = replaceOnce(
    pipeline,
    '  private lightOpticalLayer: ThreeLightOpticalLayer;',
    '  private lightOpticalLayer: ThreeLightOpticalLayer;\n  private pulseEnergyLayer: ThreePulseEnergyLayer;',
    "pulse/energy property"
  );
  pipeline = replaceOnce(
    pipeline,
    '    this.lightOpticalLayer = new ThreeLightOpticalLayer(this.scene);',
    '    this.lightOpticalLayer = new ThreeLightOpticalLayer(this.scene);\n    this.pulseEnergyLayer = new ThreePulseEnergyLayer(this.scene);',
    "pulse/energy initialization"
  );
  pipeline = replaceOnce(
    pipeline,
    '    console.log("CINEMATIC_PIPELINE_V2_OK engine=three.js layers=distortion,volumetric,particle,electrical,light-optical passes=bloom,chromatic,vignette,grain,color-output");',
    '    console.log("CINEMATIC_PIPELINE_V2_OK engine=three.js layers=distortion,volumetric,particle,electrical,light-optical,pulse-energy passes=bloom,chromatic,vignette,grain,color-output");',
    "pulse/energy status"
  );
  pipeline = replaceOnce(
    pipeline,
    '  "LightSurge", "GlowBloom", "Afterglow", "Halo", "LightRays", "GodRays", "LensFlare", "Starburst", "Spotlight",',
    '  "Pulse", "Flicker", "LightSurge", "Strobe", "BreathingGlow", "Afterglow", "EchoPulse", "WaveSweep", "Shockwave", "EnergyFlow", "EnergyRipple", "GlowBloom", "Halo", "LightRays", "GodRays", "LensFlare", "Starburst", "Spotlight",',
    "pulse/energy bloom routing"
  );
  pipeline = replaceOnce(
    pipeline,
    '    this.lightOpticalLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);',
    '    this.lightOpticalLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);\n    this.pulseEnergyLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);',
    "pulse/energy frame update"
  );
  pipeline = replaceOnce(
    pipeline,
    '    this.lightOpticalLayer.dispose();',
    '    this.lightOpticalLayer.dispose();\n    this.pulseEnergyLayer.dispose();',
    "pulse/energy dispose"
  );
}

// Final 24 selectable effects, split into four dedicated families.
pipeline = replaceOnce(
  pipeline,
  'import { ThreeParticleLayer } from "./threeParticleLayer";\nimport { ThreePulseEnergyLayer } from "./threePulseEnergyLayer";',
  'import { ThreeParticleLayer } from "./threeParticleLayer";\nimport { ThreePulseEnergyLayer } from "./threePulseEnergyLayer";\nimport { ThreeColorDigitalLayer } from "./threeColorDigitalLayer";\nimport { ThreeShadowDarkLayer } from "./threeShadowDarkLayer";\nimport { ThreeIceSymbolLayer } from "./threeIceSymbolLayer";\nimport { ThreeEnvironmentFinalLayer } from "./threeEnvironmentFinalLayer";',
  "final family imports"
);
pipeline = replaceOnce(
  pipeline,
  '  private lightOpticalLayer: ThreeLightOpticalLayer;\n  private pulseEnergyLayer: ThreePulseEnergyLayer;',
  '  private lightOpticalLayer: ThreeLightOpticalLayer;\n  private pulseEnergyLayer: ThreePulseEnergyLayer;\n  private colorDigitalLayer: ThreeColorDigitalLayer;\n  private shadowDarkLayer: ThreeShadowDarkLayer;\n  private iceSymbolLayer: ThreeIceSymbolLayer;\n  private environmentFinalLayer: ThreeEnvironmentFinalLayer;',
  "final family properties"
);
pipeline = replaceOnce(
  pipeline,
  '    this.lightOpticalLayer = new ThreeLightOpticalLayer(this.scene);\n    this.pulseEnergyLayer = new ThreePulseEnergyLayer(this.scene);',
  '    this.lightOpticalLayer = new ThreeLightOpticalLayer(this.scene);\n    this.pulseEnergyLayer = new ThreePulseEnergyLayer(this.scene);\n    this.colorDigitalLayer = new ThreeColorDigitalLayer(this.scene, sourceCanvas);\n    this.shadowDarkLayer = new ThreeShadowDarkLayer(this.scene, sourceCanvas);\n    this.iceSymbolLayer = new ThreeIceSymbolLayer(this.scene);\n    this.environmentFinalLayer = new ThreeEnvironmentFinalLayer(this.scene);',
  "final family initialization"
);
pipeline = replaceOnce(
  pipeline,
  '    console.log("CINEMATIC_PIPELINE_V2_OK engine=three.js layers=distortion,volumetric,particle,electrical,light-optical,pulse-energy passes=bloom,chromatic,vignette,grain,color-output");',
  '    console.log("CINEMATIC_PIPELINE_V2_OK engine=three.js layers=distortion,volumetric,particle,electrical,light-optical,pulse-energy,color-digital,shadow-dark,ice-symbol,environment-final passes=bloom,chromatic,vignette,grain,color-output");',
  "final family status"
);
pipeline = replaceOnce(
  pipeline,
  '    this.lightOpticalLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);\n    this.pulseEnergyLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);',
  '    this.lightOpticalLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);\n    this.pulseEnergyLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);\n    this.colorDigitalLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);\n    this.shadowDarkLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);\n    this.iceSymbolLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);\n    this.environmentFinalLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);',
  "final family frame updates"
);
pipeline = replaceOnce(
  pipeline,
  '    this.lightOpticalLayer.dispose();\n    this.pulseEnergyLayer.dispose();',
  '    this.lightOpticalLayer.dispose();\n    this.pulseEnergyLayer.dispose();\n    this.colorDigitalLayer.dispose();\n    this.shadowDarkLayer.dispose();\n    this.iceSymbolLayer.dispose();\n    this.environmentFinalLayer.dispose();',
  "final family dispose"
);
fs.writeFileSync(pipelinePath, pipeline);

let cinematic = fs.readFileSync(cinematicPath, "utf8");
const finalCinematicAlreadyWired = cinematic.includes('const THREE_COLOR_DIGITAL_KINDS = new Set<EffectKind>([');
if (!finalCinematicAlreadyWired) {
  cinematic = replaceOnce(
    cinematic,
    'const THREE_LIGHT_OPTICAL_KINDS = new Set<EffectKind>([',
    'const THREE_PULSE_ENERGY_KINDS = new Set<EffectKind>([\n  "Pulse", "Flicker", "LightSurge", "Strobe", "BreathingGlow", "Afterglow",\n  "EchoPulse", "WaveSweep", "Shockwave", "EnergyFlow", "EnergyRipple"\n]);\n\nconst THREE_LIGHT_OPTICAL_KINDS = new Set<EffectKind>([',
    "pulse/energy native kind set"
  );
  cinematic = replaceOnce(
    cinematic,
    '    THREE_LIGHT_OPTICAL_KINDS.has(kind);',
    '    THREE_LIGHT_OPTICAL_KINDS.has(kind) ||\n    THREE_PULSE_ENERGY_KINDS.has(kind);',
    "pulse/energy native routing"
  );
}
cinematic = replaceOnce(
  cinematic,
  'const THREE_PULSE_ENERGY_KINDS = new Set<EffectKind>([\n  "Pulse", "Flicker", "LightSurge", "Strobe", "BreathingGlow", "Afterglow",\n  "EchoPulse", "WaveSweep", "Shockwave", "EnergyFlow", "EnergyRipple"\n]);\n\nconst THREE_LIGHT_OPTICAL_KINDS = new Set<EffectKind>([',
  'const THREE_PULSE_ENERGY_KINDS = new Set<EffectKind>([\n  "Pulse", "Flicker", "LightSurge", "Strobe", "BreathingGlow", "Afterglow",\n  "EchoPulse", "WaveSweep", "Shockwave", "EnergyFlow", "EnergyRipple"\n]);\n\nconst THREE_COLOR_DIGITAL_KINDS = new Set<EffectKind>([\n  "HueShift", "ChromaticPulse", "GlitchLight", "Kaleidoscope", "MirrorFracture",\n  "PixelDissolve", "ScanlinePulse", "RgbSplit", "FilmBurn"\n]);\n\nconst THREE_SHADOW_DARK_KINDS = new Set<EffectKind>([\n  "ShadowPulse", "RoomDim", "LocalDim", "ContrastSurge", "ShadowTendrils", "Eclipse", "GravityWell"\n]);\n\nconst THREE_ICE_SYMBOL_KINDS = new Set<EffectKind>([\n  "FrostIce", "CrystalGrowth", "IceShimmer", "RuneGlow", "SigilActivation"\n]);\n\nconst THREE_ENVIRONMENT_FINAL_KINDS = new Set<EffectKind>([\n  "RealisticFlame", "Rain", "CelestialStars"\n]);\n\nconst THREE_LIGHT_OPTICAL_KINDS = new Set<EffectKind>([',
  "final native kind sets"
);
cinematic = replaceOnce(
  cinematic,
  '    THREE_LIGHT_OPTICAL_KINDS.has(kind) ||\n    THREE_PULSE_ENERGY_KINDS.has(kind);',
  '    THREE_LIGHT_OPTICAL_KINDS.has(kind) ||\n    THREE_PULSE_ENERGY_KINDS.has(kind) ||\n    THREE_COLOR_DIGITAL_KINDS.has(kind) ||\n    THREE_SHADOW_DARK_KINDS.has(kind) ||\n    THREE_ICE_SYMBOL_KINDS.has(kind) ||\n    THREE_ENVIRONMENT_FINAL_KINDS.has(kind);',
  "final native routing"
);
fs.writeFileSync(cinematicPath, cinematic);

console.log("[cinematic] isolated Three.js overlay wired; rc.49 base renderer restored; durable image recovery enabled; all 80 selectable effects routed to migrated families for point/emitter/stamp placements");
