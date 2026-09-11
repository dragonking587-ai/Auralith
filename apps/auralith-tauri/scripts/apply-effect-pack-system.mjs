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
    [
      'import { HelpOverlay, Hint, setTutorialDone, tutorialDone } from "./HelpOverlay";',
      'import {',
      '  BUILTIN_EFFECT_PACKS, createPackFromStack, installEffectPack, instantiatePackEffects,',
      '  loadInstalledEffectPacks, parseEffectPack, serializeEffectPack, uninstallEffectPack,',
      '  type EffectPack',
      '} from "../scene/effectPacks";',
    ].join("\n"),
    "effect pack import"
  );

  app = replaceOnce(
    app,
    '  const [oneOpen, setOneOpen] = useState(true);',
    [
      '  const [oneOpen, setOneOpen] = useState(true);',
      `  // ${marker}: data-only downloadable effect stacks.`,
      '  const [installedEffectPacks, setInstalledEffectPacks] = useState<EffectPack[]>(() => loadInstalledEffectPacks());',
      '  const [effectPackMsg, setEffectPackMsg] = useState("");',
      '  const effectPackInputRef = useRef<HTMLInputElement>(null);',
    ].join("\n"),
    "effect pack state"
  );

  const actions = [
    '',
    '  const downloadEffectPack = (pack: EffectPack) => {',
    '    const blob = new Blob([serializeEffectPack(pack)], { type: "application/json" });',
    '    const a = document.createElement("a");',
    '    const safeName = pack.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "auralith-effect";',
    '    a.href = URL.createObjectURL(blob);',
    '    a.download = safeName + ".aurapack";',
    '    a.click();',
    '    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);',
    '  };',
    '',
    '  const applyEffectPack = (pack: EffectPack, mode: "replace" | "append") => {',
    '    if (!selected) { setEffectPackMsg("Select a Trace, Stamp, Emitter, Shape, or Prop first."); return; }',
    '    const stack = instantiatePackEffects(pack);',
    '    pushHist({',
    '      ...project,',
    '      regions: project.regions.map((r) => r.id !== selected.id ? r : { ...r, effects: mode === "replace" ? stack : [...r.effects, ...stack] })',
    '    });',
    '    setEffectPackMsg((mode === "replace" ? "Applied " : "Added ") + pack.manifest.name + " · " + stack.length + " stacked effects.");',
    '  };',
    '',
    '  const saveSelectedStackAsPack = () => {',
    '    if (!selected || !selected.effects.length) { setEffectPackMsg("Select a region with at least one effect first."); return; }',
    '    const name = window.prompt("Effect pack name:", selected.label ? selected.label + " Stack" : "My Auralith Effect");',
    '    if (!name?.trim()) return;',
    '    const description = window.prompt("Short description:", "Custom stacked effect created in Auralith.") || "Custom stacked effect created in Auralith.";',
    '    const category = window.prompt("Category:", "Custom") || "Custom";',
    '    try {',
    '      const pack = createPackFromStack({',
    '        name: name.trim(), author: "Obsidian Wolf", description, category,',
    '        tags: ["custom", "stacked"], collection: "My Effects", minAuralithVersion: APP_VERSION,',
    '        recommendedQuality: project.quality, effects: selected.effects',
    '      });',
    '      setInstalledEffectPacks(installEffectPack(pack));',
    '      downloadEffectPack(pack);',
    '      setEffectPackMsg("Saved and installed " + pack.manifest.name + ". A .aurapack copy was downloaded.");',
    '    } catch (e) { setEffectPackMsg("Could not save effect pack: " + String(e)); }',
    '  };',
    '',
    '  const importEffectPackFile = async (file: File | undefined) => {',
    '    if (!file) return;',
    '    try {',
    '      const pack = parseEffectPack(await file.text());',
    '      if (pack.manifest.minAuralithVersion && semverNewer(pack.manifest.minAuralithVersion, APP_VERSION)) {',
    '        throw new Error("Requires Auralith " + pack.manifest.minAuralithVersion + " or newer.");',
    '      }',
    '      setInstalledEffectPacks(installEffectPack(pack));',
    '      setEffectPackMsg("Installed " + pack.manifest.name + " by " + pack.manifest.author + ".");',
    '    } catch (e) { setEffectPackMsg("Could not install effect pack: " + String(e)); }',
    '  };',
    '',
    '  const removeInstalledEffectPack = (id: string) => {',
    '    setInstalledEffectPacks(uninstallEffectPack(id));',
    '    setEffectPackMsg("Custom effect pack uninstalled.");',
    '  };',
    '',
    '  const collectDiag = () => {',
  ].join("\n");
  app = replaceOnce(app, '\n\n  const collectDiag = () => {', '\n' + actions, "effect pack actions");

  const packUiAnchor = '              {selected ? (\n                <>\n                  <button className="gold wide" onClick={()=>setPicker((v)=>!v)}>+ Add Effect</button>';
  const packUi = [
    '              <div className="acc on effect-pack-manager">',
    '                <h3>EFFECT PACKS</h3>',
    '                <p className="muted">Install carefully stacked Auralith effects as one reusable recipe. Packs contain data only — no scripts, DLLs, or executable shader code.</p>',
    '                <div className="row">',
    '                  <button className="gold" disabled={!selected || !selected.effects.length} onClick={saveSelectedStackAsPack}>Save Current Stack as Pack</button>',
    '                  <button onClick={()=>effectPackInputRef.current?.click()}>Install .aurapack</button>',
    '                  <input ref={effectPackInputRef} type="file" accept=".aurapack,application/json" hidden onChange={(e)=>{ const f=e.target.files?.[0]; e.target.value=""; void importEffectPackFile(f); }} />',
    '                </div>',
    '                {effectPackMsg && <p className="coach">{effectPackMsg}</p>}',
    '                <h4>OBSIDIAN WOLF EFFECTS COLLECTION</h4>',
    '                <div className="effect-pack-list">',
    '                  {BUILTIN_EFFECT_PACKS.map((pack)=>(',
    '                    <div className="card effect-pack-card" key={pack.manifest.id}>',
    '                      <div className="effect-pack-title"><strong>{pack.manifest.name}</strong><span>{pack.effects.length} layers · {pack.manifest.recommendedQuality || "High"}</span></div>',
    '                      <p>{pack.manifest.description}</p>',
    '                      <p className="muted">{pack.effects.map((e)=>e.kind).join(" + ")}</p>',
    '                      <div className="row">',
    '                        <button className="gold" disabled={!selected} onClick={()=>applyEffectPack(pack,"replace")}>Apply Pack</button>',
    '                        <button disabled={!selected} onClick={()=>applyEffectPack(pack,"append")}>Add Stack</button>',
    '                        <button onClick={()=>downloadEffectPack(pack)}>Export</button>',
    '                      </div>',
    '                    </div>',
    '                  ))}',
    '                </div>',
    '                <h4>INSTALLED CUSTOM PACKS</h4>',
    '                {installedEffectPacks.length ? (',
    '                  <div className="effect-pack-list">',
    '                    {installedEffectPacks.map((pack)=>(',
    '                      <div className="card effect-pack-card" key={pack.manifest.id}>',
    '                        <div className="effect-pack-title"><strong>{pack.manifest.name}</strong><span>{pack.manifest.author} · {pack.effects.length} layers</span></div>',
    '                        <p>{pack.manifest.description}</p>',
    '                        <p className="muted">{pack.effects.map((e)=>e.kind).join(" + ")}</p>',
    '                        <div className="row">',
    '                          <button className="gold" disabled={!selected} onClick={()=>applyEffectPack(pack,"replace")}>Apply Pack</button>',
    '                          <button disabled={!selected} onClick={()=>applyEffectPack(pack,"append")}>Add Stack</button>',
    '                          <button onClick={()=>downloadEffectPack(pack)}>Export</button>',
    '                          <button className="danger" onClick={()=>removeInstalledEffectPack(pack.manifest.id)}>Uninstall</button>',
    '                        </div>',
    '                      </div>',
    '                    ))}',
    '                  </div>',
    '                ) : <p className="muted">No custom packs installed yet.</p>}',
    '              </div>',
    '',
    packUiAnchor,
  ].join("\n");
  app = replaceOnce(app, packUiAnchor, packUi, "effect pack editor UI");
  fs.writeFileSync(appPath, app, "utf8");
  console.log("[effect-packs] App.tsx patched");
} else {
  console.log("[effect-packs] App.tsx already patched");
}

let css = fs.readFileSync(cssPath, "utf8").replace(/\r\n/g, "\n");
if (!css.includes("AURALITH_EFFECT_PACKS_STYLE_V1")) {
  css += [
    '',
    '/* AURALITH_EFFECT_PACKS_STYLE_V1 */',
    '.effect-pack-manager{margin-top:14px}',
    '.effect-pack-list{display:grid;gap:10px;margin:8px 0 16px}',
    '.effect-pack-card{padding:12px}',
    '.effect-pack-title{display:flex;justify-content:space-between;gap:12px;align-items:baseline}',
    '.effect-pack-title span{font-size:11px;opacity:.72;text-align:right}',
    '.effect-pack-card p{margin:7px 0}',
    '.effect-pack-card .row{flex-wrap:wrap}',
    '',
  ].join("\n");
  fs.writeFileSync(cssPath, css, "utf8");
  console.log("[effect-packs] styles.css patched");
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (!String(pkg.scripts?.build || "").includes("verify-effect-pack-system.mjs")) {
  pkg.scripts.build = String(pkg.scripts.build).replace(" && vite build", " && node scripts/verify-effect-pack-system.mjs && vite build");
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log("[effect-packs] build audit wired");
}
