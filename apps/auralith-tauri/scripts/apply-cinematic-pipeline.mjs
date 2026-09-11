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

// Preserve a durable image-backed recovery project before the updater restarts
// the app. Raw blob: URLs are process-local and must not be written directly to
// the recovery slot.
app = replaceOnce(
  app,
  '    autosaveProject(JSON.stringify({ ...project, reactions: rxEngine.persist() }));',
  `    try {\n      const recoveryProject = await serializeProject(project, {\n        backdropImage: imgRef.current,\n        poll: persistablePoll(pollCfg),\n        reactions: rxEngine.persist()\n      });\n      autosaveProject(JSON.stringify(recoveryProject));\n    } catch {\n      autosaveProject(JSON.stringify({ ...project, reactions: rxEngine.persist() }));\n    }`,
  "durable updater recovery snapshot"
);
fs.writeFileSync(appPath, app);

// rc.49.3 accidentally let the cinematic layer rewrite the proven rc.49 base
// context. rc.49.3.1 restores those exact base-context semantics. Three.js now
// renders on its own isolated transparent canvas, so the legacy renderer no
// longer needs alpha/context mutations.
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

// The isolated Three.js overlay must derive alpha from visible cinematic light,
// never from post-processing passes that may write opaque alpha into black
// pixels. This prevents a transparent effect canvas from covering the backdrop.
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

// Pulse / Energy Motion family: add a dedicated Three.js GPU layer without
// changing the rc.49 source renderer. Point/Emitter/Stamp placements are routed
// through this layer; trace/path placements continue using the legacy SDF path.
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
fs.writeFileSync(pipelinePath, pipeline);

let cinematic = fs.readFileSync(cinematicPath, "utf8");
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
fs.writeFileSync(cinematicPath, cinematic);

console.log("[cinematic] isolated Three.js overlay wired; rc.49 base renderer restored; durable image recovery enabled; pulse/energy motion family active");
