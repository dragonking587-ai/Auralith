import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const must = (condition, message) => { if (!condition) throw new Error(`[rc.49.3.1 audit] ${message}`); };

const app = read("src", "ui", "App.tsx");
const renderer = read("src", "render", "renderer.ts");
const cinematic = read("src", "render", "cinematicRenderer.ts");
const pipeline = read("src", "render", "cinematicPipelineV2.ts");
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
must(pipeline.includes("float outAlpha = mix(c.a, glowAlpha, overlayMode);"), "cinematic overlay can still become opaque from post-processing alpha");
must(pipeline.includes("this.finishPass.uniforms.overlayMode.value = 1.0;"), "cinematic pipeline is not forced into effects-only alpha mode");
must(pkg.dependencies?.three === "0.185.1", "Three.js runtime dependency is missing or unpinned");

console.log("[rc.49.3.1 audit] PASS — image base, effect fallback, isolated WebGL contexts, overlay alpha, updater recovery and Three.js dependency verified");
