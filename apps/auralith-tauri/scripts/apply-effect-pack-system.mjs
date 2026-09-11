import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const appPath = path.join(root, "src", "ui", "App.tsx");
const cssPath = path.join(root, "src", "ui", "styles.css");
const pkgPath = path.join(root, "package.json");

const marker = "AURALITH_EFFECT_PACKS_V1";
const replaceOnce = (text, from, to, label) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[effect-packs] missing ${label}`);
  return text.replace(from, to);
};

let app = fs.readFileSync(appPath, "utf8").replace(/\r\n/g, "\n");
if (!app.includes(marker)) {
  app = replaceOnce(
    app,
    'import { HelpOverlay, Hint, setTutorialDone, tutorialDone } from "./HelpOverlay";',
    `import { HelpOverlay, Hint, setTutorialDone, tutorialDone } from "./HelpOverlay";\nimport {\n  BUILTIN_EFFECT_PACKS, createPackFromStack, installEffectPack, instantiatePackEffects,\n  loadInstalledEffectPacks, parseEffectPack, serializeEffectPack, uninstallEffectPack,\n  type EffectPack\n} from "../scene/effectPacks";`,
    "effect pack import"
  );

  app = replaceOnce(
    app,
    '  const [oneOpen, setOneOpen] = useState(true);',
    `  const [oneOpen, setOneOpen] = useState(true);\n  // ${marker}: data-only downloadable effect stacks.\n  const [installedEffectPacks, setInstalledEffectPacks] = useState<EffectPack[]>(() => loadInstalledEffectPacks());\n  const [effectPackMsg, setEffectPackMsg] = useState("");\n  const effectPackInputRef = useRef<HTMLInputElement>(null);`,
    "effect pack state"
  );

  app = replaceOnce(
    app,
    '\n\n  const collectDiag = () => {',
    `\n\n  const downloadEffectPack = (pack: EffectPack) => {\n    const blob = new Blob([serializeEffectPack(pack)], { type: "application/json" });\n    const a = document.createElement("a");\n    const safeName = pack.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "auralith-effect";\n    a.href = URL.createObjectURL(blob);\n    a.download = safeName + ".aurapack";\n    a.click();\n    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);\n  };\n\n  const applyEffectPack = (pack: EffectPack, mode: "replace" | "append") => {\n    if (!selected) { setEffectPackMsg("Select a Trace, Stamp, Emitter, Shape, or Prop first."); return; }\n    const stack = instantiatePackEffects(pack);\n    pushHist({\n      ...project,\n      regions: project.regions.map((r) => r.id !== selected.id ? r : { ...r, effects: mode === "replace" ? stack : [...r.effects, ...stack] })\n    });\n    setEffectPackMsg((mode === "replace" ? "Applied " : "Added ") + pack.manifest.name + " · " + stack.length + " stacked effects.");\n  };\n\n  const saveSelectedStackAsPack = () => {\n    if (!selected || !selected.effects.length) { setEffectPackMsg("Select a region with at least one effect first."); return; }\n    const name = window.prompt("Effect pack name:", selected.label ? selected.label + " Stack" : "My Auralith Effect");\n    if (!name?.trim()) return;\n    const description = window.prompt("Short description:", "Custom stacked effect created in Auralith.") || "Custom stacked effect created in Auralith.";\n    const category = window.prompt("Category:", "Custom") || "Custom";\n    try {\n      const pack = createPackFromStack({\n        name: name.trim(), author: "Obsidian Wolf", description, category,\n        tags: ["custom", "stacked"], collection: "My Effects", minAuralithVersion: APP_VERSION,\n        recommendedQuality: project.quality, effects: selected.effects\n      });\n      setInstalledEffectPacks(installEffectPack(pack));\n      downloadEffectPack(pack);\n      setEffectPackMsg(`Saved and installed ${pack.manifest.name}. A .aurapack copy was downloaded.`);\n    } catch (e) { setEffectPackMsg("Could not save effect pack: " + String(e)); }\n  };\n\n  const importEffectPackFile = async (file: File | undefined) => {\n    if (!file) return;\n    try {\n      const pack = parseEffectPack(await file.text());\n      if (pack.manifest.minAuralithVersion && semverNewer(pack.manifest.minAuralithVersion, APP_VERSION)) {\n        throw new Error(`Requires Auralith ${pack.manifest.minAuralithVersion} or newer.`);\n      }\n      setInstalledEffectPacks(installEffectPack(pack));\n      setEffectPackMsg(`Installed ${pack.manifest.name} by ${pack.manifest.author}.`);\n    } catch (e) { setEffectPackMsg("Could not install effect pack: " + String(e)); }\n  };\n\n  const removeInstalledEffectPack = (id: string) => {\n    setInstalledEffectPacks(uninstallEffectPack(id));\n    setEffectPackMsg("Custom effect pack uninstalled.");\n  };\n\n  const collectDiag = () => {`,
    "effect pack actions"
  );

  const packUiAnchor = '              {selected ? (\n                <>\n                  <button className="gold wide" onClick={()=>setPicker((v)=>!v)}>+ Add Effect</button>';
  const packUi = `              <div className="acc on effect-pack-manager">\n                <h3>EFFECT PACKS</h3>\n                <p className="muted">Install carefully stacked Auralith effects as one reusable recipe. Packs contain data only — no scripts, DLLs, or executable shader code.</p>\n                <div className="row">\n                  <button className="gold" disabled={!selected || !selected.effects.length} onClick={saveSelectedStackAsPack}>Save Current Stack as Pack</button>\n                  <button onClick={()=>effectPackInputRef.current?.click()}>Install .aurapack</button>\n                  <input ref={effectPackInputRef} type="file" accept=".aurapack,application/json" hidden onChange={(e)=>{ const f=e.target.files?.[0]; e.target.value=""; void importEffectPackFile(f); }} />\n                </div>\n                {effectPackMsg && <p className="coach">{effectPackMsg}</p>}\n                <h4>OBSIDIAN WOLF EFFECTS COLLECTION</h4>\n                <div className="effect-pack-list">\n                  {BUILTIN_EFFECT_PACKS.map((pack)=>(\n                    <div className="card effect-pack-card" key={pack.manifest.id}>\n                      <div className="effect-pack-title"><strong>{pack.manifest.name}</strong><span>{pack.effects.length} layers · {pack.manifest.recommendedQuality || "High"}</span></div>\n                      <p>{pack.manifest.description}</p>\n                      <p className="muted">{pack.effects.map((e)=>e.kind).join(" + ")}</p>\n                      <div className="row">\n                        <button className="gold" disabled={!selected} onClick={()=>applyEffectPack(pack,"replace")}>Apply Pack</button>\n                        <button disabled={!selected} onClick={()=>applyEffectPack(pack,"append")}>Add Stack</button>\n                        <button onClick={()=>downloadEffectPack(pack)}>Export</button>\n                      </div>\n                    </div>\n                  ))}\n                </div>\n                <h4>INSTALLED CUSTOM PACKS</h4>\n                {installedEffectPacks.length ? (\n                  <div className="effect-pack-list">\n                    {installedEffectPacks.map((pack)=>(\n                      <div className="card effect-pack-card" key={pack.manifest.id}>\n                        <div className="effect-pack-title"><strong>{pack.manifest.name}</strong><span>{pack.manifest.author} · {pack.effects.length} layers</span></div>\n                        <p>{pack.manifest.description}</p>\n                        <p className="muted">{pack.effects.map((e)=>e.kind).join(" + ")}</p>\n                        <div className="row">\n                          <button className="gold" disabled={!selected} onClick={()=>applyEffectPack(pack,"replace")}>Apply Pack</button>\n                          <button disabled={!selected} onClick={()=>applyEffectPack(pack,"append")}>Add Stack</button>\n                          <button onClick={()=>downloadEffectPack(pack)}>Export</button>\n                          <button className="danger" onClick={()=>removeInstalledEffectPack(pack.manifest.id)}>Uninstall</button>\n                        </div>\n                      </div>\n                    ))}\n                  </div>\n                ) : <p className="muted">No custom packs installed yet.</p>}\n              </div>\n\n${packUiAnchor}`;
  app = replaceOnce(app, packUiAnchor, packUi, "effect pack editor UI");
  fs.writeFileSync(appPath, app, "utf8");
  console.log("[effect-packs] App.tsx patched");
} else {
  console.log("[effect-packs] App.tsx already patched");
}

let css = fs.readFileSync(cssPath, "utf8").replace(/\r\n/g, "\n");
if (!css.includes("AURALITH_EFFECT_PACKS_STYLE_V1")) {
  css += `\n\n/* AURALITH_EFFECT_PACKS_STYLE_V1 */\n.effect-pack-manager{margin-top:14px}\n.effect-pack-list{display:grid;gap:10px;margin:8px 0 16px}\n.effect-pack-card{padding:12px}\n.effect-pack-title{display:flex;justify-content:space-between;gap:12px;align-items:baseline}\n.effect-pack-title span{font-size:11px;opacity:.72;text-align:right}\n.effect-pack-card p{margin:7px 0}\n.effect-pack-card .row{flex-wrap:wrap}\n`;
  fs.writeFileSync(cssPath, css, "utf8");
  console.log("[effect-packs] styles.css patched");
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (!String(pkg.scripts?.build || "").includes("verify-effect-pack-system.mjs")) {
  pkg.scripts.build = String(pkg.scripts.build).replace(" && vite build", " && node scripts/verify-effect-pack-system.mjs && vite build");
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log("[effect-packs] build audit wired");
}
