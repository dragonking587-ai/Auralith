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
const electrical = read("src", "render", "threeElectricalLayer.ts");
const distortion = read("src", "render", "threeDistortionLayer.ts");
const lightOptical = read("src", "render", "threeLightOpticalLayer.ts");
const pkg = JSON.parse(read("package.json"));

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
must(cinematic.includes("new CinematicPipelineV2(this.overlayCanvas, gl, canvas)"), "legacy canvas is not passed read-only to the isolated distortion layer");
must(pipeline.includes("float outAlpha = mix(c.a, glowAlpha, overlayMode);"), "cinematic overlay can still become opaque from post-processing alpha");
must(pipeline.includes("this.finishPass.uniforms.overlayMode.value = 1.0;"), "cinematic pipeline is not forced into effects-only alpha mode");
must(pkg.dependencies?.three === "0.185.1", "Three.js runtime dependency is missing or unpinned");

const electricalKinds = ["EnergyBeam", "LightningArc", "ElectricCrawl", "ThunderFlash", "Laser"];
for (const kind of electricalKinds) {
  must(electrical.includes(`\"${kind}\"`), `electrical module is missing ${kind}`);
  must(cinematic.includes(`\"${kind}\"`), `cinematic routing is missing ${kind}`);
}
must(pipeline.includes('import { ThreeElectricalLayer } from "./threeElectricalLayer";'), "electrical layer is not imported by cinematic pipeline");
must(pipeline.includes("this.electricalLayer = new ThreeElectricalLayer(this.scene);"), "electrical layer is not initialized");
must(pipeline.includes("this.electricalLayer.update(nativeProject"), "electrical layer is not updated each frame");
must(pipeline.includes("this.electricalLayer.dispose();"), "electrical layer is not disposed on shutdown");
must(electrical.includes("THREE.AdditiveBlending"), "electrical family is not using emissive additive blending");
must(electrical.includes("if (alpha < 0.002) discard;"), "electrical shader does not discard transparent pixels");
must(!electrical.includes("smoothstep(1.0, 0."), "electrical shader contains reversed smoothstep edges");

const distortionKinds = [
  "HeatDistortion", "Refraction", "WaterRipple", "Caustics", "WetReflection",
  "WaterReflection", "SpatialWarp", "HolographicDistortion"
];
for (const kind of distortionKinds) {
  must(distortion.includes(`\"${kind}\"`), `distortion module is missing ${kind}`);
  must(cinematic.includes(`\"${kind}\"`), `cinematic routing is missing ${kind}`);
}
must(pipeline.includes('import { ThreeDistortionLayer } from "./threeDistortionLayer";'), "distortion layer is not imported by cinematic pipeline");
must(pipeline.includes("this.distortionLayer = new ThreeDistortionLayer(this.scene, sourceCanvas);"), "distortion layer is not initialized with the read-only rc.49 canvas source");
must(pipeline.includes("this.distortionLayer.update(nativeProject"), "distortion layer is not updated each frame");
must(pipeline.includes("this.distortionLayer.dispose();"), "distortion layer is not disposed on shutdown");
must(distortion.includes("new THREE.CanvasTexture(sourceCanvas)"), "distortion layer does not sample the completed rc.49 canvas through a separate texture upload");
must(distortion.includes("this.sourceTexture.needsUpdate = true;"), "distortion source texture is not refreshed from the current rc.49 frame");
must(distortion.includes("THREE.NormalBlending"), "distortion family is not alpha-composited safely over rc.49");
must(distortion.includes("alpha = clamp(alpha") && distortion.includes("0.68"), "distortion overlay alpha is not capped for base-image safety");
must(distortion.includes("if (alpha < 0.003) discard;"), "distortion shader does not discard transparent pixels");
must(!distortion.includes("getContext("), "distortion module must not acquire or share a WebGL context");

const lightOpticalKinds = [
  "GlowBloom", "Halo", "LightRays", "GodRays", "LensFlare", "Starburst", "Spotlight",
  "Shimmer", "GlitterSparkle", "NeonGlow", "NeonChase", "PrismaticLight"
];
for (const kind of lightOpticalKinds) {
  must(lightOptical.includes(`\"${kind}\"`), `light/optical module is missing ${kind}`);
  must(cinematic.includes(`\"${kind}\"`), `cinematic routing is missing ${kind}`);
}
must(pipeline.includes('import { ThreeLightOpticalLayer } from "./threeLightOpticalLayer";'), "light/optical layer is not imported by cinematic pipeline");
must(pipeline.includes("this.lightOpticalLayer = new ThreeLightOpticalLayer(this.scene);"), "light/optical layer is not initialized");
must(pipeline.includes("this.lightOpticalLayer.update(nativeProject"), "light/optical layer is not updated each frame");
must(pipeline.includes("this.lightOpticalLayer.dispose();"), "light/optical layer is not disposed on shutdown");
must(lightOptical.includes("THREE.AdditiveBlending"), "light/optical family is not using emissive additive blending");
must(lightOptical.includes("if (alpha < 0.002) discard;"), "light/optical shader does not discard transparent pixels");
must(lightOptical.includes("0.0, 0.62"), "light/optical overlay alpha is not capped for base-image safety");
must(!lightOptical.includes("smoothstep(1.35, 0.10"), "light/optical shader contains reversed God Rays smoothstep edges");
must(!lightOptical.includes("getContext("), "light/optical module must not acquire or share a WebGL context");

console.log("[rc.49.x audit] PASS — image base, full effect fallback, isolated WebGL contexts, updater recovery, Three.js dependency, electrical, distortion/refraction and light/glow/optical families verified");
