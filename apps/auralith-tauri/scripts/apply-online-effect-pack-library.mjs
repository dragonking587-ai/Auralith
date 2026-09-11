import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const appPath = path.join(root, "src", "ui", "App.tsx");
const pkgPath = path.join(root, "package.json");
const marker = "AURALITH_ONLINE_EFFECT_LIBRARY_V1";

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[online-effect-library] missing ${label}`);
  return text.replace(from, to);
}

let app = fs.readFileSync(appPath, "utf8").replace(/\r\n/g, "\n");
if (!app.includes(marker)) {
  const effectPackImport = `import {\n  BUILTIN_EFFECT_PACKS, createPackFromStack, installEffectPack, instantiatePackEffects,\n  loadInstalledEffectPacks, parseEffectPack, serializeEffectPack, uninstallEffectPack,\n  type EffectPack\n} from "../scene/effectPacks";`;
  app = replaceOnce(
    app,
    effectPackImport,
    `${effectPackImport}\nimport {\n  downloadAndInstallOfficialEffectPack, fetchOfficialEffectPackCatalog,\n  type OnlineEffectPackEntry\n} from "../scene/effectPackLibrary";`,
    "effect pack imports"
  );

  app = replaceOnce(
    app,
    `  const [effectPackMsg, setEffectPackMsg] = useState("");\n  const effectPackInputRef = useRef<HTMLInputElement>(null);`,
    `  const [effectPackMsg, setEffectPackMsg] = useState("");\n  const effectPackInputRef = useRef<HTMLInputElement>(null);\n  // ${marker}: trusted online catalog with one-click download + install.\n  const [onlineEffectPacks, setOnlineEffectPacks] = useState<OnlineEffectPackEntry[]>([]);\n  const [onlineEffectPackLoading, setOnlineEffectPackLoading] = useState(false);\n  const [onlineEffectPackInstallingId, setOnlineEffectPackInstallingId] = useState("");\n  const [onlineEffectPackUpdated, setOnlineEffectPackUpdated] = useState("");`,
    "online library state"
  );

  app = replaceOnce(
    app,
    `  const downloadEffectPack = (pack: EffectPack) => {`,
    `  const refreshOnlineEffectPackLibrary = async () => {\n    setOnlineEffectPackLoading(true);\n    try {\n      const catalog = await fetchOfficialEffectPackCatalog();\n      setOnlineEffectPacks(catalog.packs);\n      setOnlineEffectPackUpdated(catalog.updated);\n      setEffectPackMsg(\`Online library loaded · \${catalog.packs.length} packs available.\`);\n    } catch (e) {\n      setEffectPackMsg("Could not load online Effect Pack Library: " + String(e));\n    } finally {\n      setOnlineEffectPackLoading(false);\n    }\n  };\n\n  const downloadInstallOnlineEffectPack = async (entry: OnlineEffectPackEntry) => {\n    if (entry.minAuralithVersion && semverNewer(entry.minAuralithVersion, APP_VERSION)) {\n      setEffectPackMsg(\`\${entry.name} requires Auralith \${entry.minAuralithVersion} or newer.\`);\n      return;\n    }\n    setOnlineEffectPackInstallingId(entry.id);\n    try {\n      const result = await downloadAndInstallOfficialEffectPack(entry);\n      setInstalledEffectPacks(result.installed);\n      setEffectPackMsg(\`Downloaded and installed \${result.pack.manifest.name} by \${result.pack.manifest.author}.\`);\n    } catch (e) {\n      setEffectPackMsg("Could not download/install effect pack: " + String(e));\n    } finally {\n      setOnlineEffectPackInstallingId("");\n    }\n  };\n\n  useEffect(() => { void refreshOnlineEffectPackLibrary(); }, []);\n\n  const downloadEffectPack = (pack: EffectPack) => {`,
    "online library actions"
  );

  const heading = `                <h4>OBSIDIAN WOLF EFFECTS COLLECTION</h4>`;
  const onlineUi = `                <h4>ONLINE EFFECT PACK LIBRARY</h4>\n                <div className="row">\n                  <button onClick={()=>void refreshOnlineEffectPackLibrary()} disabled={onlineEffectPackLoading}>{onlineEffectPackLoading ? "Refreshing…" : "Refresh Library"}</button>\n                  {onlineEffectPackUpdated && <span className="muted">Catalog updated {onlineEffectPackUpdated}</span>}\n                </div>\n                {onlineEffectPacks.length ? (\n                  <div className="effect-pack-list">\n                    {onlineEffectPacks.map((pack)=>{\n                      const installed = installedEffectPacks.some((p)=>p.manifest.id===pack.id && p.manifest.version===pack.version);\n                      const incompatible = !!pack.minAuralithVersion && semverNewer(pack.minAuralithVersion, APP_VERSION);\n                      return (\n                        <div className="card effect-pack-card" key={pack.id}>\n                          <div className="effect-pack-title"><strong>{pack.name}</strong><span>{pack.author} · v{pack.version}</span></div>\n                          <p>{pack.description}</p>\n                          <p className="muted">{pack.collection || pack.category} · Recommended {pack.recommendedQuality || "High"}</p>\n                          <div className="row">\n                            <button className="gold" disabled={installed || incompatible || onlineEffectPackInstallingId===pack.id} onClick={()=>void downloadInstallOnlineEffectPack(pack)}>\n                              {onlineEffectPackInstallingId===pack.id ? "Installing…" : installed ? "Installed" : incompatible ? "Update Auralith First" : "Download & Install"}\n                            </button>\n                          </div>\n                        </div>\n                      );\n                    })}\n                  </div>\n                ) : <p className="muted">{onlineEffectPackLoading ? "Loading official packs…" : "No online packs loaded. Use Refresh Library to try again."}</p>}\n\n                <h4>BUILT-IN OBSIDIAN WOLF EFFECTS COLLECTION</h4>`;
  app = replaceOnce(app, heading, onlineUi, "online effect pack UI");
  fs.writeFileSync(appPath, app, "utf8");
  console.log("[online-effect-library] App.tsx patched");
} else {
  console.log("[online-effect-library] App.tsx already patched");
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const build = String(pkg.scripts?.build || "");
if (!build.includes("verify-online-effect-pack-library.mjs")) {
  if (!build.includes("node scripts/verify-effect-pack-system.mjs")) throw new Error("[online-effect-library] effect pack build audit anchor missing");
  pkg.scripts.build = build.replace(
    "node scripts/verify-effect-pack-system.mjs",
    "node scripts/verify-effect-pack-system.mjs && node scripts/verify-online-effect-pack-library.mjs"
  );
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  console.log("[online-effect-library] online library build audit wired");
}
