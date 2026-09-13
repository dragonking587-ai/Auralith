import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text, "utf8");
const replaceOnce = (text, from, to, label) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[rc49.3.8] missing ${label}`);
  return text.replace(from, to);
};

// Project model: overlay objects are saved with normal .auralith projects.
{
  const rel = "src/scene/types.ts";
  let s = read(rel);
  s = replaceOnce(
    s,
    '  reactions?: { enabled: boolean; slots: any[] };\n};',
    '  reactions?: { enabled: boolean; slots: any[] };\n  overlays?: import("./gamingOverlay").GamingOverlayItem[];\n};',
    "Project.overlays"
  );
  write(rel, s);
}

// Neon Glow: remove the hard-coded box SDF. The native point/stamp optical layer now
// renders a placement-scaled neon ring/field rather than a permanent rectangle.
{
  const rel = "src/render/threeLightOpticalLayer.ts";
  let s = read(rel);
  const old = `    } else if (uMode < 10.5) {\n      float d = abs(sdBox(q, vec2(0.52, 0.30))) - 0.018;\n      float tube = exp(-abs(d) * (78.0 + p1 * 52.0));\n      float gas = exp(-abs(d) * (12.0 + p2 * 8.0));\n      float hum = 0.91 + 0.09 * sin(t * (3.0 + p0 * 2.5)) + uHigh * 0.06;\n      intensity = (tube * 1.28 + gas * 0.32) * (0.22 + drive * 0.70) * hum;\n      hot = clamp(tube * 1.1, 0.0, 1.0);`;
  const next = `    } else if (uMode < 10.5) {\n      // Neon Glow follows the local effect footprint. Do not bake a rectangle into the shader.\n      float neonRadius = clamp(0.34 + p0 * 0.16, 0.24, 0.72);\n      float d = abs(r - neonRadius);\n      float tube = exp(-d * (72.0 + p1 * 58.0));\n      float gas = exp(-d * (10.0 + p2 * 10.0));\n      float innerGlow = exp(-r * (3.1 + p2 * 1.6)) * 0.16;\n      float broken = 0.94 + 0.06 * sin(ang * (5.0 + p1 * 4.0) + t * (1.2 + p0));\n      float hum = 0.91 + 0.09 * sin(t * (3.0 + p0 * 2.5)) + uHigh * 0.06;\n      intensity = (tube * 1.28 + gas * 0.32 + innerGlow) * (0.22 + drive * 0.70) * hum * broken;\n      hot = clamp(tube * 1.1 + innerGlow * 0.25, 0.0, 1.0);`;
  s = replaceOnce(s, old, next, "NeonGlow rectangle shader");
  write(rel, s);
}

// Realistic Flame: replace the single central column with a broad fire bed and nine
// independent tongues. Keep the existing audio uniforms and environment layer routing.
{
  const rel = "src/render/threeEnvironmentFinalLayer.ts";
  let s = read(rel);
  const old = `    if (uMode < 1.5) {\n      vec2 p = q;\n      p.y += 0.42;\n      float rise = uTime * (0.55 + p0 * 1.25 + uBass * 0.16);\n      float warpA = fbm(vec2(p.x * (2.4 + p1 * 1.5), p.y * 2.1 - rise));\n      float warpB = fbm(vec2(p.x * 4.2 + 7.0, p.y * 3.5 - rise * 1.55));\n      float width = 0.46 + (1.0 - clamp((p.y + 1.0) * 0.5, 0.0, 1.0)) * 0.16;\n      float taper = max(0.05, width * (1.0 - clamp((p.y + 0.70) * 0.46, 0.0, 0.86)));\n      float body = 1.0 - smoothstep(taper * 0.48, taper, abs(p.x + (warpA - 0.5) * (0.34 + p2 * 0.18)));\n      float vertical = smoothstep(-1.0, -0.35, p.y) * (1.0 - smoothstep(0.42, 1.04, p.y));\n      float tongues = smoothstep(0.42, 0.80, warpA * 0.72 + warpB * 0.38 + (0.45 - p.y) * 0.16);\n      float core = body * vertical * smoothstep(0.52, 0.92, warpB + (0.18 - abs(p.x)) * 0.45);\n      float flame = body * vertical * (0.32 + tongues * 0.88);\n      float flick = 0.86 + 0.14 * sin(uTime * (4.0 + p0 * 3.2) + warpB * 8.0) + uTransient * 0.08;\n      intensity = (flame * 0.76 + core * 0.72) * flick * (0.24 + drive * 0.78 + uBass * 0.10 + uMid * 0.08);\n      hot = clamp(core * 1.25 + tongues * 0.18, 0.0, 1.0);\n      col = mix(uColorB, uColorA, clamp(flame + tongues * 0.22, 0.0, 1.0));\n      col = mix(col, uColorC, hot);\n    } else if (uMode < 2.5) {`;
  const next = `    if (uMode < 1.5) {\n      vec2 p = q;\n      p.y += 0.10;\n      float rise = uTime * (0.48 + p0 * 1.05 + uBass * 0.12);\n      float fire = 0.0;\n      float core = 0.0;\n      float tipWisps = 0.0;\n\n      // Broad open-fire bed: dense near the fuel line rather than a single nozzle/jet.\n      float bedNoise = fbm(vec2(p.x * (3.2 + p1), p.y * 4.0 - rise * 0.65));\n      float bedX = 1.0 - smoothstep(0.58, 0.94, abs(p.x));\n      float bedY = exp(-pow((p.y + 0.72) * 4.2, 2.0));\n      float bed = bedX * bedY * (0.72 + bedNoise * 0.55);\n      fire += bed * 0.92;\n      core += bed * (0.46 + 0.28 * (1.0 - abs(p.x)));\n\n      // Nine independently moving tongues. Each has its own base, height, curl and breakup.\n      for (int i = 0; i < 9; i++) {\n        float fi = float(i);\n        float seed = hash21(vec2(fi * 7.13 + 2.1, fi * 3.71 + 9.4));\n        float seed2 = hash21(vec2(fi * 2.37 + 5.8, fi * 8.19 + 1.2));\n        float baseX = mix(-0.68, 0.68, fi / 8.0) + (seed - 0.5) * 0.10;\n        float height = 0.72 + seed * 0.58 + p0 * 0.20 + uBass * 0.10;\n        float localY = (p.y + 0.76) / max(height, 0.25);\n        float alive = smoothstep(-0.03, 0.07, localY) * (1.0 - smoothstep(0.78, 1.04, localY));\n        float turbulence = fbm(vec2(fi * 2.7 + p.y * (2.8 + p1), p.y * 4.4 - rise * (0.82 + seed * 0.44)));\n        float curl = sin(uTime * (1.55 + seed * 1.55) + fi * 1.73 + p.y * (2.1 + p2 * 1.8));\n        float center = baseX + curl * (0.025 + localY * 0.075) + (turbulence - 0.5) * (0.10 + localY * 0.15);\n        float width = mix(0.145 + seed2 * 0.055, 0.018 + seed * 0.024, clamp(localY, 0.0, 1.0));\n        float dist = abs(p.x - center);\n        float body = 1.0 - smoothstep(width * 0.42, width, dist);\n        float breakup = smoothstep(0.22, 0.82, turbulence + (1.0 - clamp(localY, 0.0, 1.0)) * 0.22);\n        float tongue = body * alive * (0.48 + breakup * 0.78);\n        fire += tongue * (0.66 + seed * 0.42);\n\n        float coreWidth = width * mix(0.45, 0.20, clamp(localY, 0.0, 1.0));\n        float coreBody = 1.0 - smoothstep(coreWidth * 0.35, coreWidth, dist);\n        core += coreBody * alive * (1.0 - smoothstep(0.42, 0.86, localY)) * (0.46 + breakup * 0.30);\n\n        float tipBand = smoothstep(0.62, 0.84, localY) * (1.0 - smoothstep(0.88, 1.05, localY));\n        tipWisps += body * tipBand * smoothstep(0.48, 0.82, turbulence) * (0.12 + seed * 0.12);\n      }\n\n      fire = clamp(fire, 0.0, 1.55);\n      core = clamp(core, 0.0, 1.20);\n      float edgeFlicker = 0.88 + 0.12 * sin(uTime * (4.1 + p0 * 2.8) + bedNoise * 7.0) + uTransient * 0.07;\n      float audioBody = 0.48 + drive * 0.62 + uBass * 0.12 + uLow * 0.07;\n      float detail = 1.0 + uMid * 0.07 + uHigh * 0.04;\n      intensity = (fire * 0.84 + core * 0.90 + tipWisps) * edgeFlicker * audioBody * detail;\n      hot = clamp(core * 1.12 + bed * 0.28 + uTransient * 0.04, 0.0, 1.0);\n      float bodyMix = clamp(fire * 0.72 + bed * 0.30, 0.0, 1.0);\n      col = mix(uColorB, uColorA, bodyMix);\n      col = mix(col, uColorC, hot);\n    } else if (uMode < 2.5) {`;
  s = replaceOnce(s, old, next, "RealisticFlame single-column shader");
  s = replaceOnce(
    s,
    '    float alpha = clamp(intensity * uOpacity, 0.0, 0.62);',
    '    float alphaCap = uMode < 1.5 ? 0.94 : 0.62;\n    float alpha = clamp(intensity * uOpacity, 0.0, alphaCap);',
    "environment alpha cap"
  );
  s = replaceOnce(
    s,
    '      uOpacity: { value: 0.42 }, uColorA: { value: new THREE.Color("#ff9a24") }, uColorB: { value: new THREE.Color("#4c8cff") }, uColorC: { value: new THREE.Color("#ffffff") },',
    '      uOpacity: { value: kind === "RealisticFlame" ? 0.88 : 0.42 }, uColorA: { value: new THREE.Color("#ff9a24") }, uColorB: { value: new THREE.Color("#4c8cff") }, uColorC: { value: new THREE.Color("#ffffff") },',
    "flame material opacity"
  );
  s = replaceOnce(
    s,
    '    blending: THREE.AdditiveBlending,',
    '    blending: kind === "RealisticFlame" ? THREE.NormalBlending : THREE.AdditiveBlending,',
    "flame normal blending"
  );
  s = replaceOnce(
    s,
    '    u.uOpacity.value = Math.max(0, Math.min(0.60, effect.opacity * effect.brightness * project.masters.brightness * 0.48));',
    '    u.uOpacity.value = effect.kind === "RealisticFlame"\n      ? Math.max(0, Math.min(0.92, effect.opacity * effect.brightness * project.masters.brightness * 0.88))\n      : Math.max(0, Math.min(0.60, effect.opacity * effect.brightness * project.masters.brightness * 0.48));',
    "flame runtime opacity"
  );
  write(rel, s);
}

// App wiring and Overlay page.
{
  const rel = "src/ui/App.tsx";
  let s = read(rel);
  s = replaceOnce(
    s,
    '} from "../scene/effectPackLibrary";\n',
    '} from "../scene/effectPackLibrary";\nimport { normalizeGamingOverlays, type GamingOverlayItem } from "../scene/gamingOverlay";\nimport { GamingOverlaySurface } from "./GamingOverlaySurface";\nimport { GamingOverlayDesigner } from "./GamingOverlayDesigner";\n',
    "gaming overlay imports"
  );
  s = replaceOnce(
    s,
    'type AppPage = "home" | "editor" | "audio" | "output" | "server" | "devices" | "settings";',
    'type AppPage = "home" | "editor" | "overlay" | "audio" | "output" | "server" | "devices" | "settings";',
    "overlay page type"
  );
  s = replaceOnce(
    s,
    '  const [sel, setSel] = useState<string | null>(null);',
    '  const [sel, setSel] = useState<string | null>(null);\n  const [overlaySel, setOverlaySel] = useState<string | null>(null);',
    "overlay selection state"
  );
  s = replaceOnce(
    s,
    '    setProject({ ...p, quality: validQuality });',
    '    setProject({ ...p, quality: validQuality, overlays: normalizeGamingOverlays(p.overlays, p.width, p.height) });',
    "overlay load normalization"
  );
  s = replaceOnce(
    s,
    '  const selected = project.regions.find((r) => r.id === sel);\n  const clean = view === "CleanCapture";',
    '  const selected = project.regions.find((r) => r.id === sel);\n  const gamingOverlays = normalizeGamingOverlays(project.overlays, project.width, project.height);\n  const setGamingOverlays = (items: GamingOverlayItem[]) => setProject({ ...project, overlays: normalizeGamingOverlays(items, project.width, project.height) });\n  const patchGamingOverlay = (id: string, patch: Partial<GamingOverlayItem>) => {\n    setProject((cur) => ({ ...cur, overlays: normalizeGamingOverlays(cur.overlays, cur.width, cur.height).map((item) => item.id === id ? { ...item, ...patch } : item) }));\n  };\n  const clean = view === "CleanCapture";',
    "overlay project helpers"
  );
  s = replaceOnce(
    s,
    '<label className="chk"><input type="checkbox" checked={project.showMarkers} onChange={(e)=>setProject({...project, showMarkers:e.target.checked})}/> Overlays</label>',
    '<label className="chk"><input type="checkbox" checked={project.showMarkers} onChange={(e)=>setProject({...project, showMarkers:e.target.checked})}/> Editor Markers</label>',
    "marker label"
  );
  s = replaceOnce(
    s,
    '["home","Home"],["editor","Editor"],["audio","Audio"],["output","Output"],',
    '["home","Home"],["editor","Editor"],["overlay","Overlay"],["audio","Audio"],["output","Output"],',
    "overlay nav"
  );
  s = replaceOnce(
    s,
    '          <canvas id="gl" ref={canvasRef} />\n          {!clean && project.showMarkers && view === "Edit" && (',
    '          <canvas id="gl" ref={canvasRef} />\n          {wrapRef.current && (\n            <GamingOverlaySurface\n              items={gamingOverlays}\n              viewport={currentVp(wrapRef.current.getBoundingClientRect())}\n              projectWidth={project.width}\n              projectHeight={project.height}\n              edit={!clean && tab === "overlay" && view === "Edit"}\n              previewInteractive={!clean && view === "Preview"}\n              selectedId={overlaySel}\n              onSelect={(id)=>setOverlaySel(id)}\n              onPatch={patchGamingOverlay}\n            />\n          )}\n          {!clean && project.showMarkers && view === "Edit" && (',
    "overlay stage surface"
  );
  s = replaceOnce(
    s,
    '<strong>{tab === "home" ? "HOME" : tab === "editor" ? "EDITOR" : tab === "audio" ? "AUDIO" : tab === "output" ? "OUTPUT" : tab === "server" ? "SERVER" : tab === "devices" ? "DEVICES" : "SETTINGS"}</strong>',
    '<strong>{tab === "home" ? "HOME" : tab === "editor" ? "EDITOR" : tab === "overlay" ? "GAMING OVERLAY" : tab === "audio" ? "AUDIO" : tab === "output" ? "OUTPUT" : tab === "server" ? "SERVER" : tab === "devices" ? "DEVICES" : "SETTINGS"}</strong>',
    "overlay page title"
  );
  s = replaceOnce(
    s,
    '          {tab==="editor" && (\n            <div className="pane">',
    '          {tab==="overlay" && (\n            <GamingOverlayDesigner\n              items={gamingOverlays}\n              selectedId={overlaySel}\n              projectWidth={project.width}\n              projectHeight={project.height}\n              onChange={setGamingOverlays}\n              onSelect={setOverlaySel}\n            />\n          )}\n\n          {tab==="editor" && (\n            <div className="pane">',
    "overlay designer page"
  );
  s = replaceOnce(
    s,
    '<p><strong>Complete 80-effect renderer coverage.</strong> All selectable effects are now covered by the current Reborn rendering stack with the rc.49 compatibility path retained.</p>',
    '<p><strong>Gaming Overlay foundation.</strong> Create frames, text, and transformable web/song cards directly over your scene, including perspective and angle matching.</p>',
    "home whats new"
  );
  s = replaceOnce(
    s,
    '<p><strong>Next:</strong> Audio source and routing reliability.</p>\n                  <p>Planned: Loudman.live DJ-board bridge · transformable browser/web surfaces · Overlay Creator · custom wave visualizers · reactive image regions · optional Unreal Engine bridge.</p>',
    '<p><strong>Also improved:</strong> Neon Glow no longer carries a fixed center rectangle, and Realistic Flame now uses a natural broad multi-tongue fire model.</p>\n                  <p>Planned next: Loudman.live DJ-board bridge · custom wave visualizers · reactive image regions · gaming-event reactions · optional Unreal Engine bridge.</p>',
    "home upcoming"
  );
  write(rel, s);
}

// Overlay editor/surface styling. Keep this as a self-contained extension.
{
  const rel = "src/ui/styles.css";
  let s = read(rel);
  if (!s.includes("AURALITH_GAMING_OVERLAY_RC4938")) {
    s += `\n\n/* AURALITH_GAMING_OVERLAY_RC4938 */\n.gaming-overlay-surface{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:18}\n.gaming-overlay-surface.editing{pointer-events:none}\n.gaming-overlay-item{position:absolute;overflow:visible;pointer-events:none;will-change:transform}\n.gaming-overlay-item.selected .gaming-overlay-edit-hit{outline:2px solid #d4af37;box-shadow:0 0 0 1px rgba(0,0,0,.65),0 0 18px rgba(212,175,55,.45)}\n.gaming-overlay-web,.gaming-overlay-panel,.gaming-overlay-text{display:block;width:100%;height:100%;box-sizing:border-box;border:0;overflow:hidden}\n.gaming-overlay-web{background:transparent}\n.gaming-overlay-panel{pointer-events:none}\n.gaming-overlay-text{display:flex;align-items:center;justify-content:center;padding:10px;line-height:1.05;white-space:pre-wrap;overflow:hidden;text-shadow:0 2px 8px rgba(0,0,0,.65)}\n.gaming-overlay-edit-hit{position:absolute;inset:0;pointer-events:auto;cursor:move;border-radius:inherit;background:rgba(0,0,0,.015);outline:1px dashed rgba(212,175,55,.55)}\n.gaming-overlay-edit-hit span{position:absolute;left:6px;top:6px;padding:3px 6px;border-radius:4px;background:rgba(10,10,12,.82);color:#f4d27a;font-size:10px;letter-spacing:.04em;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.gaming-overlay-designer .overlay-list-item{display:flex;align-items:center;gap:8px;margin:5px 0;padding:5px;border:1px solid rgba(255,255,255,.08);border-radius:6px}\n.gaming-overlay-designer .overlay-list-item.on{border-color:#d4af37;background:rgba(212,175,55,.08)}\n.gaming-overlay-designer .overlay-select{flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.gaming-overlay-designer textarea{min-height:70px;resize:vertical}\n.gaming-overlay-designer .warn{color:#ffcf73;font-size:12px}\n.overlay-properties h4{margin:14px 0 6px;color:#d4af37;letter-spacing:.06em}\n`;
  }
  write(rel, s);
}

// Normal preview builds should audit the new system too.
{
  const rel = "../..//.github/workflows/tauri-preview.yml";
  const full = path.resolve(root, rel);
  let s = fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n");
  s = replaceOnce(
    s,
    '          node scripts/verify-quality-system.mjs\n',
    '          node scripts/verify-quality-system.mjs\n          node scripts/verify-rc49.3.8-gaming-overlay.mjs\n',
    "preview gaming overlay audit"
  );
  fs.writeFileSync(full, s, "utf8");
}

console.log("[rc49.3.8] PASS — staged Neon Glow, natural multi-tongue flame, and Gaming Overlay foundation.");
