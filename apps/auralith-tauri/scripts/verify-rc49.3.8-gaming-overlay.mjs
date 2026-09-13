import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const must = (text, needle, label) => { if (!text.includes(needle)) throw new Error(`[rc49.3.8-audit] missing ${label}: ${needle}`); };
const mustNot = (text, needle, label) => { if (text.includes(needle)) throw new Error(`[rc49.3.8-audit] forbidden ${label}: ${needle}`); };

const optical = read("src/render/threeLightOpticalLayer.ts");
const env = read("src/render/threeEnvironmentFinalLayer.ts");
const types = read("src/scene/types.ts");
const overlay = read("src/scene/gamingOverlay.ts");
const surface = read("src/ui/GamingOverlaySurface.tsx");
const designer = read("src/ui/GamingOverlayDesigner.tsx");
const app = read("src/ui/App.tsx");
const styles = read("src/ui/styles.css");

must(optical, "float neonRadius", "placement-scaled Neon Glow");
mustNot(optical, "abs(sdBox(q, vec2(0.52, 0.30)))", "hard-coded Neon Glow rectangle");

must(env, "for (int i = 0; i < 9; i++)", "nine independent flame tongues");
must(env, "Broad open-fire bed", "broad natural flame bed");
must(env, 'kind === "RealisticFlame" ? THREE.NormalBlending : THREE.AdditiveBlending', "dense flame blend mode");
must(env, "float alphaCap = uMode < 1.5 ? 0.94 : 0.62", "flame opacity headroom");
must(env, "Math.min(0.92", "flame runtime opacity");

must(types, 'overlays?: import("./gamingOverlay").GamingOverlayItem[];', "project overlay persistence");
must(overlay, 'export type GamingOverlayKind = "web" | "panel" | "text";', "overlay kinds");
must(overlay, 'if (u.protocol === "https:")', "HTTPS web overlay gate");
must(overlay, "normalizeGamingOverlays", "overlay load sanitizer");
must(overlay, "slice(0, 64)", "overlay item safety limit");

must(surface, "perspective(${item.perspective}px)", "perspective transform");
must(surface, "rotateX(${item.rotateX}deg)", "X tilt");
must(surface, "rotateY(${item.rotateY}deg)", "Y tilt");
must(surface, "skewX(${item.skewX}deg)", "X skew");
must(surface, "hue-rotate", "web color matching");
must(surface, "sandbox=\"allow-scripts allow-forms allow-popups allow-same-origin allow-presentation\"", "iframe sandbox");

must(designer, "+ Web / Song Card", "web card creation");
must(designer, "+ Frame / Panel", "gaming frame creation");
must(designer, "+ Text", "overlay text creation");
must(designer, "ANGLE / PERSPECTIVE", "angle controls");
must(designer, "WEB COLOR MATCH", "web theme controls");
must(designer, "Gaming Mode foundation", "gaming mode foundation copy");

must(app, '"overlay" | "audio"', "overlay page route");
must(app, '["overlay","Overlay"]', "overlay nav button");
must(app, "<GamingOverlaySurface", "overlay stage rendering");
must(app, "edit={!clean && tab === \"overlay\"", "clean capture without edit handles");
must(app, "<GamingOverlayDesigner", "overlay designer page");
must(app, "normalizeGamingOverlays(p.overlays", "project load overlay validation");
must(styles, "AURALITH_GAMING_OVERLAY_RC4938", "overlay styles");

for (const forbidden of ["eval(", "new Function(", "javascript:", "file:"]) {
  if (overlay.includes(forbidden) || surface.includes(forbidden)) throw new Error(`[rc49.3.8-audit] unsafe overlay capability found: ${forbidden}`);
}

console.log("[rc49.3.8-audit] PASS — Neon rectangle removed, Realistic Flame uses broad nine-tongue fire, and Gaming Overlay web/panel/text design is project-persistent and perspective-transformable.");
