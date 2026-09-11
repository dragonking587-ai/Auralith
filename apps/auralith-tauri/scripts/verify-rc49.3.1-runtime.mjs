import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const must = (condition, message) => { if (!condition) throw new Error(`[rc.49.x audit] ${message}`); };

const app = read("src", "ui", "App.tsx");
const renderer = read("src", "render", "renderer.ts");
const cinematic = read("src", "render", "cinematicRenderer.ts");
const pipeline = read("src", "render", "cinematicPipelineV2.ts");
const sceneTypes = read("src", "scene", "types.ts");
const particle = read("src", "render", "threeParticleLayer.ts");
const volumetric = read("src", "render", "threeVolumetricLayer.ts");
const electrical = read("src", "render", "threeElectricalLayer.ts");
const distortion = read("src", "render", "threeDistortionLayer.ts");
const lightOptical = read("src", "render", "threeLightOpticalLayer.ts");
const pulseEnergy = read("src", "render", "threePulseEnergyLayer.ts");
const colorDigital = read("src", "render", "threeColorDigitalLayer.ts");
const shadowDark = read("src", "render", "threeShadowDarkLayer.ts");
const iceSymbol = read("src", "render", "threeIceSymbolLayer.ts");
const environmentFinal = read("src", "render", "threeEnvironmentFinalLayer.ts");
const pkg = JSON.parse(read("package.json"));

// Core rc.49 application integrity must remain authoritative.
must(app.includes('import { GlRenderer } from "../render/cinematicRenderer";'), "cinematic wrapper is not wired into App");
must(app.includes("const recoveryProject = await serializeProject(project"), "updater recovery does not serialize the backdrop image");
must(renderer.includes('canvas.getContext("webgl2", { alpha: false, antialias: true, preserveDrawingBuffer: true })'), "rc.49 base WebGL2 context was not restored");
must(!renderer.includes("this.hasBackdrop ? 1 : 0"), "rc.49 base clear-alpha mutation is still present");
must(cinematic.includes('document.createElement("canvas")'), "cinematic renderer does not create an isolated canvas");
must(cinematic.includes('this.overlayCanvas.getContext("webgl2"'), "cinematic renderer is not using an isolated WebGL2 context");
must(!cinematic.includes('const gl = canvas.getContext("webgl2")'), "cinematic renderer still reuses the rc.49 canvas context");
must(cinematic.includes("this.legacy.draw(project, snapshot"), "complete rc.49 project is not rendered as the safety underlay");
must(!cinematic.includes("splitSource") && !cinematic.includes("splitCache"), "stale project-identity split cache is still present");
must(cinematic.includes('zIndex: "2"'), "cinematic overlay is not layered above the rc.49 canvas");
must(cinematic.includes("return base;"), "clean-frame readback has no rc.49 fallback");
must(cinematic.includes("new CinematicPipelineV2(this.overlayCanvas, gl, canvas)"), "legacy canvas is not passed read-only to isolated screen-space layers");
must(pipeline.includes("float outAlpha = mix(c.a, glowAlpha, overlayMode);"), "cinematic overlay can still become opaque from post-processing alpha");
must(pipeline.includes("this.finishPass.uniforms.overlayMode.value = 1.0;"), "cinematic pipeline is not forced into effects-only alpha mode");
must(pkg.dependencies?.three === "0.185.1", "Three.js runtime dependency is missing or unpinned");

const particleKinds = ["Sparks", "EnergySparks", "Embers", "Fireflies", "Snow", "Ash", "DustMotes", "BioluminescentSpores"];
const volumetricKinds = ["MagicEnergy", "Plasma", "VoidEnergy", "Portal", "Vortex", "SmokeFog", "Mist", "AtmosphericHaze", "Aurora", "CosmicNebula", "FrozenBreath", "SpectralAura"];
const electricalKinds = ["EnergyBeam", "LightningArc", "ElectricCrawl", "ThunderFlash", "Laser"];
const distortionKinds = ["HeatDistortion", "Refraction", "WaterRipple", "Caustics", "WetReflection", "WaterReflection", "SpatialWarp", "HolographicDistortion"];
const lightOpticalKinds = ["GlowBloom", "Halo", "LightRays", "GodRays", "LensFlare", "Starburst", "Spotlight", "Shimmer", "GlitterSparkle", "NeonGlow", "NeonChase", "PrismaticLight"];
const pulseEnergyKinds = ["Pulse", "Flicker", "LightSurge", "Strobe", "BreathingGlow", "Afterglow", "EchoPulse", "WaveSweep", "Shockwave", "EnergyFlow", "EnergyRipple"];
const colorDigitalKinds = ["HueShift", "ChromaticPulse", "GlitchLight", "Kaleidoscope", "MirrorFracture", "PixelDissolve", "ScanlinePulse", "RgbSplit", "FilmBurn"];
const shadowDarkKinds = ["ShadowPulse", "RoomDim", "LocalDim", "ContrastSurge", "ShadowTendrils", "Eclipse", "GravityWell"];
const iceSymbolKinds = ["FrostIce", "CrystalGrowth", "IceShimmer", "RuneGlow", "SigilActivation"];
const environmentFinalKinds = ["RealisticFlame", "Rain", "CelestialStars"];

const families = [
  ["particle", particle, particleKinds, "ThreeParticleLayer", "particleLayer"],
  ["volumetric", volumetric, volumetricKinds, "ThreeVolumetricLayer", "volumetricLayer"],
  ["electrical", electrical, electricalKinds, "ThreeElectricalLayer", "electricalLayer"],
  ["distortion", distortion, distortionKinds, "ThreeDistortionLayer", "distortionLayer"],
  ["light/optical", lightOptical, lightOpticalKinds, "ThreeLightOpticalLayer", "lightOpticalLayer"],
  ["pulse/energy", pulseEnergy, pulseEnergyKinds, "ThreePulseEnergyLayer", "pulseEnergyLayer"],
  ["color/digital", colorDigital, colorDigitalKinds, "ThreeColorDigitalLayer", "colorDigitalLayer"],
  ["shadow/dark", shadowDark, shadowDarkKinds, "ThreeShadowDarkLayer", "shadowDarkLayer"],
  ["ice/symbol", iceSymbol, iceSymbolKinds, "ThreeIceSymbolLayer", "iceSymbolLayer"],
  ["environment/final", environmentFinal, environmentFinalKinds, "ThreeEnvironmentFinalLayer", "environmentFinalLayer"],
];

for (const [label, source, kinds, className, propertyName] of families) {
  for (const kind of kinds) {
    must(source.includes(`\"${kind}\"`), `${label} module is missing ${kind}`);
    must(cinematic.includes(`\"${kind}\"`), `cinematic routing is missing ${kind}`);
  }
  must(pipeline.includes(`import { ${className} } from \"./${className.charAt(0).toLowerCase() + className.slice(1)}\";`) || pipeline.includes(`import { ${className} } from \"./three${className.replace(/^Three/, "")}\";`), `${label} layer is not imported by cinematic pipeline`);
  must(pipeline.includes(`this.${propertyName}`), `${label} layer is not wired into cinematic pipeline`);
  must(pipeline.includes(`this.${propertyName}.update(nativeProject`), `${label} layer is not updated each frame`);
  must(pipeline.includes(`this.${propertyName}.dispose();`), `${label} layer is not disposed on shutdown`);
  must(!source.includes("getContext("), `${label} module must not acquire or share a WebGL context`);
}

// Screen-space families must copy the completed base canvas, never share its WebGL objects.
for (const [label, source] of [["distortion", distortion], ["color/digital", colorDigital], ["shadow/dark", shadowDark]]) {
  must(source.includes("new THREE.CanvasTexture(sourceCanvas)"), `${label} layer is not using a read-only canvas texture`);
  must(source.includes("this.sourceTexture.needsUpdate = true;"), `${label} source texture is not refreshed each frame`);
  must(source.includes("THREE.NormalBlending"), `${label} layer is not alpha-composited safely over rc.49`);
  must(source.includes("if (alpha < 0.003) discard;"), `${label} shader does not discard transparent pixels`);
}

for (const [label, source] of [["electrical", electrical], ["light/optical", lightOptical], ["pulse/energy", pulseEnergy], ["ice/symbol", iceSymbol], ["environment/final", environmentFinal]]) {
  must(source.includes("THREE.AdditiveBlending"), `${label} family is not using emissive additive blending`);
  must(source.includes("if (alpha < 0.002) discard;"), `${label} shader does not discard transparent pixels`);
}

must(pulseEnergy.includes("uMemory"), "afterglow does not retain a decaying audio impulse envelope");
must(!electrical.includes("smoothstep(1.0, 0."), "electrical shader contains reversed smoothstep edges");
must(!pulseEnergy.includes("smoothstep(1.0, 0."), "pulse/energy shader contains reversed smoothstep edges");
must(!colorDigital.includes("smoothstep(1.0, 0."), "color/digital shader contains reversed smoothstep edges");
must(!shadowDark.includes("smoothstep(1.0, 0."), "shadow/dark shader contains reversed smoothstep edges");
must(!iceSymbol.includes("smoothstep(1.0, 0."), "ice/symbol shader contains reversed smoothstep edges");
must(!environmentFinal.includes("smoothstep(1.0, 0."), "environment/final shader contains reversed smoothstep edges");

// The selectable catalog must now be completely represented by migrated families.
const allBlock = sceneTypes.match(/export const ALL_EFFECTS:[\s\S]*?=\s*\[([\s\S]*?)\];/);
must(allBlock, "could not parse ALL_EFFECTS catalog");
const allEffects = [...allBlock[1].matchAll(/\"([^\"]+)\"/g)].map((m) => m[1]);
const migrated = new Set([
  ...particleKinds, ...volumetricKinds, ...electricalKinds, ...distortionKinds, ...lightOpticalKinds,
  ...pulseEnergyKinds, ...colorDigitalKinds, ...shadowDarkKinds, ...iceSymbolKinds, ...environmentFinalKinds,
]);
must(allEffects.length === 80, `expected 80 selectable effects, found ${allEffects.length}`);
must(migrated.size === 80, `expected 80 unique migrated effects, found ${migrated.size}`);
for (const kind of allEffects) must(migrated.has(kind), `selectable effect ${kind} is still legacy-only`);
must(!allEffects.includes("SmartNeon"), "SmartNeon unexpectedly returned to selectable catalog");

console.log("[rc.49.x audit] PASS — rc.49 base integrity preserved; isolated Three.js contexts verified; all 80 selectable effects are covered by migrated families for point/emitter/stamp placements");
