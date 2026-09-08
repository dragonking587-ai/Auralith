import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const appPath = path.join(root, "src", "ui", "App.tsx");
const rendererPath = path.join(root, "src", "render", "renderer.ts");

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[rc.49.1 hotfix] could not find ${label}`);
  return text.replace(from, to);
}

function replaceRegexOnce(text, re, to, label) {
  if (typeof to === "string" && text.includes(to)) return text;
  if (!re.test(text)) throw new Error(`[rc.49.1 hotfix] could not find ${label}`);
  return text.replace(re, to);
}

let app = fs.readFileSync(appPath, "utf8");
const appCRLF = app.includes("\r\n");
app = app.replace(/\r\n/g, "\n");
if (!app.includes("RC49_HOTFIX_SHAPES")) {
  app = replaceOnce(
    app,
    'import { ALL_EFFECTS, defaultEffect, newProject, type EffectKind, type Project, type Region, type ViewMode } from "../scene/types";',
    'import { ALL_EFFECTS, defaultEffect, newProject, type EffectKind, type Project, type Region, type ShapeKind, type ViewMode } from "../scene/types";',
    "ShapeKind import"
  );

  app = replaceOnce(
    app,
    'const APP_VERSION = "1.0.0-rc.44";',
    'const APP_VERSION = "1.0.0-rc.49.1";',
    "runtime version"
  );

  app = replaceOnce(
    app,
    '\n\ntype VcamUi = { state: string; error: string; installed: boolean; running: boolean };',
    `\n\n// RC49_HOTFIX_SHAPES: real shape selection/editing for the official rc.49 hotfix.\nconst SHAPE_OPTIONS: { value: ShapeKind; label: string }[] = [\n  { value: "circle", label: "Circle" },\n  { value: "ellipse", label: "Ellipse" },\n  { value: "rect", label: "Rectangle" },\n  { value: "roundrect", label: "Rounded Rectangle" },\n  { value: "triangle", label: "Triangle" },\n  { value: "diamond", label: "Diamond" },\n  { value: "polygon", label: "Polygon" },\n  { value: "ring", label: "Ring" },\n  { value: "line", label: "Line" },\n];\nconst shapeLabel = (shape: ShapeKind) => SHAPE_OPTIONS.find((x) => x.value === shape)?.label || "Shape";\n\ntype VcamUi = { state: string; error: string; installed: boolean; running: boolean };`,
    "shape options"
  );

  app = replaceOnce(
    app,
    '  const [tool, setTool] = useState<"Trace" | "Stamp" | "Emitter" | "Edit" | "Shape" | "Prop">("Edit");',
    '  const [tool, setTool] = useState<"Trace" | "Stamp" | "Emitter" | "Edit" | "Shape" | "Prop">("Edit");\n  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");',
    "shape state"
  );

  app = replaceOnce(
    app,
    '        <button className={tool==="Shape"?"on":""} title="Add a shape target" onClick={() => setTool("Shape")}>Shape</button>',
    `        <button className={tool==="Shape"?"on":""} title="Add a shape target" onClick={() => setTool("Shape")}>Shape</button>\n        {tool==="Shape" && <select title="Shape type" value={shapeKind} onChange={(e)=>setShapeKind(e.target.value as ShapeKind)}>\n          {SHAPE_OPTIONS.map((s)=><option key={s.value} value={s.value}>{s.label}</option>)}\n        </select>}`,
    "shape toolbar selector"
  );

  app = replaceOnce(
    app,
    '      width: kind==="Shape" ? 360 : 80, height: kind==="Shape" ? 360 : 80,\n      shape: kind==="Shape" ? "rect" : undefined,\n      effects: [defaultEffect("GlowBloom")], pathClosed: kind==="Shape", pathLength: 0,\n      label: kind==="Shape" ? "Rectangle" : kind',
    `      width: kind==="Shape" ? 360 : 80, height: kind==="Shape" ? (shapeKind==="line" ? 24 : 360) : 80,\n      shape: kind==="Shape" ? shapeKind : undefined,\n      cornerRadius: kind==="Shape" && (shapeKind==="roundrect" || shapeKind==="line") ? 48 : undefined,\n      innerRadius: kind==="Shape" && shapeKind==="ring" ? 100 : undefined,\n      sides: kind==="Shape" && shapeKind==="polygon" ? 6 : undefined,\n      effects: [defaultEffect("GlowBloom")], pathClosed: kind==="Shape", pathLength: 0,\n      label: kind==="Shape" ? shapeLabel(shapeKind) : kind`,
    "shape creation"
  );

  app = replaceOnce(
    app,
    '              {selected ? (\n',
    `              {selected?.kind==="Shape" && (\n                <div className="picker">\n                  <h3>SHAPE GEOMETRY</h3>\n                  <label>Shape Type <select value={selected.shape||"rect"} onChange={(e)=>{\n                    const shape=e.target.value as ShapeKind; setShapeKind(shape);\n                    setProject({...project, regions:project.regions.map((r)=>r.id!==selected.id?r:{...r,shape,label:shapeLabel(shape),height:shape==="line"?Math.min(r.height||24,48):(r.height||360),cornerRadius:shape==="roundrect"?(r.cornerRadius??48):r.cornerRadius,innerRadius:shape==="ring"?(r.innerRadius??100):r.innerRadius,sides:shape==="polygon"?(r.sides??6):r.sides})});\n                  }}>\n                    {SHAPE_OPTIONS.map((s)=><option key={s.value} value={s.value}>{s.label}</option>)}\n                  </select></label>\n                  <label>{selected.shape==="circle"?"Diameter":selected.shape==="line"?"Length":"Width"} <input type="range" min={24} max={2000} step={1} value={selected.width||selected.radius*2} onChange={(e)=>{const w=Number(e.target.value);setProject({...project,regions:project.regions.map((r)=>r.id!==selected.id?r:{...r,width:w,height:r.shape==="circle"?w:r.height,radius:Math.max(w,r.height||w)/2})})}} /></label>\n                  {selected.shape!=="circle" && selected.shape!=="line" && <label>Height <input type="range" min={24} max={2000} step={1} value={selected.height||selected.radius*2} onChange={(e)=>{const h=Number(e.target.value);setProject({...project,regions:project.regions.map((r)=>r.id!==selected.id?r:{...r,height:h,radius:Math.max(r.width||h,h)/2})})}} /></label>}\n                  {selected.shape==="line" && <label>Thickness <input type="range" min={4} max={160} step={1} value={selected.height||24} onChange={(e)=>{const h=Number(e.target.value);setProject({...project,regions:project.regions.map((r)=>r.id!==selected.id?r:{...r,height:h})})}} /></label>}\n                  {selected.shape==="roundrect" && <label>Corner Radius <input type="range" min={0} max={500} step={1} value={selected.cornerRadius??48} onChange={(e)=>setProject({...project,regions:project.regions.map((r)=>r.id!==selected.id?r:{...r,cornerRadius:Number(e.target.value)})})} /></label>}\n                  {selected.shape==="ring" && <label>Inner Radius <input type="range" min={2} max={900} step={1} value={selected.innerRadius??100} onChange={(e)=>setProject({...project,regions:project.regions.map((r)=>r.id!==selected.id?r:{...r,innerRadius:Number(e.target.value)})})} /></label>}\n                  {selected.shape==="polygon" && <label>Sides <input type="range" min={3} max={24} step={1} value={selected.sides??6} onChange={(e)=>setProject({...project,regions:project.regions.map((r)=>r.id!==selected.id?r:{...r,sides:Number(e.target.value)})})} /></label>}\n                  <label>Rotation {Math.round(selected.rotation||0)}° <input type="range" min={-180} max={180} step={1} value={selected.rotation||0} onChange={(e)=>setProject({...project,regions:project.regions.map((r)=>r.id!==selected.id?r:{...r,rotation:Number(e.target.value)})})} /></label>\n                </div>\n              )}\n\n              {selected ? (\n`,
    "shape inspector"
  );

  app = replaceOnce(
    app,
    '                              {ef.kind==="MagicEnergy" && <>',
    `                              {ef.kind==="RealisticFlame" && <>\n                                <div className="hint"><b>REALISTIC FIRE MOTION</b><br/>1.00 is calibrated to natural flame movement. Lower it for slow fire or raise it for more aggressive fire.</div>\n                                <label>Fire Motion Speed {ef.speed.toFixed(2)} <input type="range" min={0.15} max={2} step={0.01} value={ef.speed} onChange={(e)=>patchFx(ef.id,{speed:Number(e.target.value)})} /></label>\n                              </>}\n                              {ef.kind==="MagicEnergy" && <>`,
    "realistic flame motion control"
  );

  fs.writeFileSync(appPath, appCRLF ? app.replace(/\n/g, "\r\n") : app);
  console.log("[rc.49.1 hotfix] patched App.tsx");
} else {
  console.log("[rc.49.1 hotfix] App.tsx already patched");
}

let renderer = fs.readFileSync(rendererPath, "utf8");
const rendererCRLF = renderer.includes("\r\n");
renderer = renderer.replace(/\r\n/g, "\n");
if (!renderer.includes("RC49_HOTFIX_FIRE_MOTION")) {
  renderer = replaceOnce(
    renderer,
    'import { buildPathField, buildPropAlphaField, fieldKey, regionGeomMode } from "../scene/pathSdf";',
    'import { buildPathField, buildPropAlphaField, fieldKey, regionGeomMode } from "../scene/pathSdf";\nimport { buildShapeField } from "../scene/shapeSdf";',
    "shape SDF import"
  );

  renderer = replaceOnce(
    renderer,
    '        gl.uniform1f(gl.getUniformLocation(this.prog, "uTime"), t * e.speed * project.masters.motion);',
    '        // RC49_HOTFIX_FIRE_MOTION: speed 1.00 is now calibrated to natural fire motion.\n        const naturalTimeScale = e.kind === "RealisticFlame" ? 0.68 : 1.0;\n        gl.uniform1f(gl.getUniformLocation(this.prog, "uTime"), t * e.speed * project.masters.motion * naturalTimeScale);',
    "natural flame timing"
  );

  renderer = replaceOnce(
    renderer,
    '          const key = fieldKey(r, project.width, project.height);',
    '          const baseKey = fieldKey(r, project.width, project.height);\n          const key = r.kind === "Shape" ? `${baseKey}|shape:${r.shape||"rect"}|rot:${r.rotation||0}|corner:${r.cornerRadius||0}|inner:${r.innerRadius||0}|sides:${r.sides||0}` : baseKey;',
    "shape cache key"
  );

  renderer = replaceRegexOnce(
    renderer,
    /            \} else if \(r\.kind === "Shape"\) \{[\s\S]*?\n            \} else \{\n              field = buildPathField/,
    `            } else if (r.kind === "Shape") {\n              field = buildShapeField(r, project.width, project.height, 256);\n            } else {\n              field = buildPathField`,
    "shape field renderer"
  );

  fs.writeFileSync(rendererPath, rendererCRLF ? renderer.replace(/\n/g, "\r\n") : renderer);
  console.log("[rc.49.1 hotfix] patched renderer.ts");
} else {
  console.log("[rc.49.1 hotfix] renderer.ts already patched");
}
