import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const appPath = path.join(root, "src", "ui", "App.tsx");
const rendererPath = path.join(root, "src", "render", "renderer.ts");
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
fs.writeFileSync(pipelinePath, pipeline);

console.log("[cinematic] isolated Three.js overlay wired; rc.49 base renderer restored; durable image recovery enabled");
