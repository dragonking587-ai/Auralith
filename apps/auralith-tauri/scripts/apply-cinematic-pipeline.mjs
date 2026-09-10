import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const appPath = path.join(root, "src", "ui", "App.tsx");
const rendererPath = path.join(root, "src", "render", "renderer.ts");

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
fs.writeFileSync(appPath, app);

let renderer = fs.readFileSync(rendererPath, "utf8");
renderer = replaceOnce(
  renderer,
  'canvas.getContext("webgl2", { alpha: false, antialias: true, preserveDrawingBuffer: true })',
  'canvas.getContext("webgl2", { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance", premultipliedAlpha: false })',
  "WebGL2 context options"
);
renderer = replaceOnce(
  renderer,
  'canvas.getContext("webgl", { alpha: false, antialias: true, preserveDrawingBuffer: true })',
  'canvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance", premultipliedAlpha: false })',
  "WebGL fallback context options"
);
renderer = replaceOnce(
  renderer,
  'gl.clearColor(0.02, 0.02, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT);',
  'gl.clearColor(0.02, 0.02, 0.04, this.hasBackdrop ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);',
  "transparent outer clear"
);
renderer = replaceOnce(
  renderer,
  'gl.clearColor(0.05, 0.05, 0.07, 1); gl.clear(gl.COLOR_BUFFER_BIT);',
  'gl.clearColor(0.05, 0.05, 0.07, this.hasBackdrop ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);',
  "transparent scene clear"
);
fs.writeFileSync(rendererPath, renderer);

console.log("[cinematic] Three.js compositor wired; transparent capture enabled; rc.49 UI/layout source unchanged");
