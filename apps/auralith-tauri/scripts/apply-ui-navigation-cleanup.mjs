import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const repoRoot = path.resolve(root, "..", "..");
const appPath = path.join(root, "src/ui/App.tsx");
const stylesPath = path.join(root, "src/ui/styles.css");
const vitePath = path.join(root, "vite.config.ts");
const previewPath = path.join(repoRoot, ".github/workflows/tauri-preview.yml");
const lockPath = path.join(root, "scripts/verify-rc49-ui-lock.mjs");

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`[ui-cleanup] missing ${label}`);
  return text.replace(from, to);
}
function sliceRequired(text, startNeedle, endNeedle, label) {
  const start = text.indexOf(startNeedle);
  if (start < 0) throw new Error(`[ui-cleanup] missing ${label} start`);
  const end = text.indexOf(endNeedle, start);
  if (end < 0) throw new Error(`[ui-cleanup] missing ${label} end`);
  return { start, end, value: text.slice(start, end) };
}

let app = fs.readFileSync(appPath, "utf8");

app = replaceOnce(app,
  'const APP_VERSION = "1.0.0-rc.44";',
  'declare const __AURALITH_VERSION__: string;\nconst APP_VERSION = __AURALITH_VERSION__;',
  "APP_VERSION constant");
app = replaceOnce(app,
  'export function App() {',
  'type AppPage = "home" | "editor" | "audio" | "output" | "server" | "devices" | "settings";\n\nexport function App() {',
  "AppPage type");
app = replaceOnce(app,
  '  const [tab, setTab] = useState<"effects"|"audio"|"output"|"settings">("output");',
  '  const [tab, setTab] = useState<AppPage>("home");',
  "page state");
app = app.replaceAll('setTab("effects")', 'setTab("editor")');

app = replaceOnce(app,
  '  const clean = view === "CleanCapture";',
  '  const clean = view === "CleanCapture";\n  const managementPage = tab === "home" || tab === "server" || tab === "devices" || tab === "settings";',
  "management page state");
app = replaceOnce(app,
  '<div className="canvas-wrap" ref={wrapRef}',
  '<div className={`canvas-wrap ${managementPage ? "management-hidden" : ""}`} ref={wrapRef}',
  "management canvas class");
app = replaceOnce(app,
  '<aside className={`side ${clean ? "hidden" : ""}`}>',
  '<aside className={`side ${clean ? "hidden" : ""} ${managementPage ? "management-page" : ""}`}>',
  "management side class");

// Replace fake Home/Output/Server/Devices aliases with distinct page IDs.
{
  const navStartNeedle = '      <div className={`nav ${clean ? "hidden" : ""}`}>';
  const stageNeedle = '      <div className={`stage ${clean ? "clean" : ""}`}>';
  const nav = sliceRequired(app, navStartNeedle, stageNeedle, "top navigation");
  const replacement = `      <div className={\`nav \${clean ? "hidden" : ""}\`}>
        {([
          ["home","Home"],["editor","Editor"],["audio","Audio"],["output","Output"],
          ["server","Server"],["devices","Devices"],["settings","Settings"]
        ] as const).map(([id,label]) => (
          <button key={id} className={tab===id ? "on" : ""} onClick={()=>setTab(id)}>{label}</button>
        ))}
      </div>
`;
  app = app.slice(0, nav.start) + replacement + app.slice(nav.end);
}

// The top navigation is authoritative; replace the redundant second button row with a page heading.
{
  const aside = app.indexOf('<aside className={`side');
  const tabsStart = app.indexOf('          <div className="tabs">', aside);
  const firstPane = app.indexOf('\n\n          {tab===', tabsStart);
  if (tabsStart < 0 || firstPane < 0) throw new Error("[ui-cleanup] side tabs not found");
  const replacement = `          <div className="tabs page-title">
            <strong>{tab === "home" ? "HOME" : tab === "editor" ? "EDITOR" : tab === "audio" ? "AUDIO" : tab === "output" ? "OUTPUT" : tab === "server" ? "SERVER" : tab === "devices" ? "DEVICES" : "SETTINGS"}</strong>
          </div>`;
  app = app.slice(0, tabsStart) + replacement + app.slice(firstPane);
}

// Updates belong on Home, not Settings.
{
  const start = app.indexOf('              <h3>UPDATES</h3>');
  const end = app.indexOf('              <h3>HELP & TUTORIALS</h3>', start);
  if (start < 0 || end < 0) throw new Error("[ui-cleanup] Settings Updates section not found");
  app = app.slice(0, start) + app.slice(end);
}

// Host Identity belongs with paired devices.
let hostIdentity = "";
{
  const start = app.indexOf('              <h3>HOST IDENTITY</h3>');
  const end = app.indexOf('              <h3>ABOUT</h3>', start);
  if (start < 0 || end < 0) throw new Error("[ui-cleanup] Host Identity section not found");
  hostIdentity = app.slice(start, end);
  app = app.slice(0, start) + app.slice(end);
}

// Split the old combined Output mega-pane into Output, Server and Devices while preserving every handler.
{
  const startToken = '          {tab==="output" && (\n            <div className="pane dash">\n';
  const start = app.indexOf(startToken);
  const next = app.indexOf('\n          {false && tab==="ai"', start);
  if (start < 0 || next < 0) throw new Error("[ui-cleanup] combined output pane not found");
  const block = app.slice(start, next);
  const closing = '\n            </div>\n          )}\n\n';
  let inner = block.slice(startToken.length);
  if (!inner.endsWith(closing)) throw new Error("[ui-cleanup] combined output pane closing changed");
  inner = inner.slice(0, -closing.length);

  const marker = (value) => {
    const i = inner.indexOf(value);
    if (i < 0) throw new Error(`[ui-cleanup] missing output section ${value}`);
    return i;
  };
  const clean = marker('<h3>CLEAN OUTPUT</h3>');
  const host = marker('<h3>HOST INSTANCE</h3>');
  const live = marker('<h3>LIVE CONTROL</h3>');
  const remote = marker('<h4>HOST REMOTE</h4>');
  const audience = marker('<h4>AUDIENCE REACTIONS</h4>');
  const vcam = marker('<h3>VIRTUAL CAMERA</h3>');
  if (!(clean < host && host < live && live < remote && remote < audience && audience < vcam)) {
    throw new Error("[ui-cleanup] output section order changed");
  }

  const outputContent = inner.slice(clean, host) + inner.slice(vcam);
  const serverContent = inner.slice(live, remote) + inner.slice(audience, vcam);
  const deviceContent = inner.slice(host, live) + inner.slice(remote, audience) + hostIdentity;
  const replacement = `          {tab==="output" && (
            <div className="pane dash">
${outputContent}
            </div>
          )}

          {tab==="server" && (
            <div className="pane dash">
${serverContent}
            </div>
          )}

          {tab==="devices" && (
            <div className="pane dash">
${deviceContent}
            </div>
          )}

`;
  app = app.slice(0, start) + replacement + app.slice(next);
}

// Create a real Home page focused on current and upcoming product updates.
{
  const editorToken = '          {tab==="effects" && (';
  const at = app.indexOf(editorToken);
  if (at < 0) throw new Error("[ui-cleanup] editor pane marker missing");
  const home = `          {tab==="home" && (
            <div className="pane home-pane">
              <div className="home-hero">
                <h2>AURALITH REBORN</h2>
                <p>Installed {APP_VERSION} · 80 reactive effects</p>
                <div className="row">
                  <button className="gold" onClick={()=>setTab("editor")}>Open Editor</button>
                  <button onClick={()=>setHelpMode("tour")}>Start Tutorial</button>
                  <button onClick={()=>{ setTab("settings"); setFbMsg(""); }}>Send Feedback</button>
                </div>
              </div>
              <div className="home-grid">
                <div className="card">
                  <h3>WHAT'S NEW</h3>
                  <p><strong>Complete 80-effect renderer coverage.</strong> All selectable effects are now covered by the current Reborn rendering stack with the rc.49 compatibility path retained.</p>
                  <p>Particle, volumetric, electrical, optical, pulse/energy, digital, shadow, ice/symbol and environmental effect families are integrated.</p>
                  <p className="muted">Effect visual tuning found during real-world testing can be corrected independently without redesigning the app.</p>
                </div>
                <div className="card">
                  <h3>UPCOMING</h3>
                  <p><strong>Next:</strong> Audio source and routing reliability.</p>
                  <p>Planned: Loudman.live DJ-board bridge · transformable browser/web surfaces · Overlay Creator · custom wave visualizers · reactive image regions · optional Unreal Engine bridge.</p>
                  <p className="muted">Upcoming items are roadmap targets, not promises that a feature is already installed.</p>
                </div>
                <div className="card">
                  <h3>UPDATES</h3>
                  <p>Installed: {APP_VERSION}</p>
                  {updateAvail && <p>Available: {updateAvail}</p>}
                  {updateNotes && <pre className="notes">{updateNotes}</pre>}
                  {updatePct && <p>{updatePct}</p>}
                  {updateMsg && <p>{updateMsg}</p>}
                  <div className="row">
                    <button disabled={updateBusy} onClick={()=>void checkUpdates(false)}>Check for Updates</button>
                    {updateAvail && semverNewer(updateAvail, APP_VERSION) && (
                      <button className="gold" disabled={updateBusy} onClick={()=>void installUpdate()}>Download &amp; Install</button>
                    )}
                    {updateAvail && <button disabled={updateBusy} onClick={()=>{ setUpdateAvail(""); setUpdateNotes(""); setUpdateMsg(""); }}>Later</button>}
                    <button onClick={()=>window.open("https://github.com/dragonking587-ai/Auralith/releases","_blank")}>View Releases</button>
                  </div>
                  {updateDetails && <button onClick={()=>setShowUpdateDetails((v)=>!v)}>{showUpdateDetails?"Hide":"View"} Details</button>}
                  {showUpdateDetails && updateDetails && <pre>{updateDetails}</pre>}
                </div>
              </div>
            </div>
          )}

`;
  app = app.slice(0, at) + home + app.slice(at);
  app = app.replace(editorToken, '          {tab==="editor" && (');
}

const qualityOld = `              <label>Quality <select value={project.quality} onChange={(e)=>setProject({...project, quality: e.target.value as Project["quality"]})}>
                {["Low","Medium","High","Ultra"].map((q)=><option key={q}>{q}</option>)}
              </select></label>`;
app = replaceOnce(app, qualityOld, qualityOld + '\n              <p className="muted">Low = lightest workload · Medium = balanced · High = full detail · Ultra = maximum detail. Quality is saved with the project.</p>', "quality selector help");

app = replaceOnce(app,
  `  const applyLoadedProject = (p: Project) => {
    if (p.version !== 1) throw new Error("unsupported project");
    setProject(p);`,
  `  const applyLoadedProject = (p: Project) => {
    if (p.version !== 1) throw new Error("unsupported project");
    const validQuality: Project["quality"] = (["Low","Medium","High","Ultra"] as const).includes(p.quality as any) ? p.quality : "High";
    setProject({ ...p, quality: validQuality });`,
  "loaded project quality normalization");

fs.writeFileSync(appPath, app);

let vite = fs.readFileSync(vitePath, "utf8");
vite = replaceOnce(vite,
  'import { resolve } from "node:path";',
  'import { dirname, resolve } from "node:path";\nimport { readFileSync } from "node:fs";\nimport { fileURLToPath } from "node:url";',
  "vite imports");
vite = replaceOnce(vite,
  'export default defineConfig({',
  'const configDir = dirname(fileURLToPath(import.meta.url));\nconst packageJson = JSON.parse(readFileSync(resolve(configDir, "package.json"), "utf8"));\n\nexport default defineConfig({',
  "vite package version");
vite = replaceOnce(vite,
  '  clearScreen: false,',
  '  clearScreen: false,\n  define: { __AURALITH_VERSION__: JSON.stringify(packageJson.version) },',
  "vite version define");
fs.writeFileSync(vitePath, vite);

let styles = fs.readFileSync(stylesPath, "utf8");
if (!styles.includes("/* UI_NAV_CLEANUP_V1 */")) {
  styles += `

/* UI_NAV_CLEANUP_V1 */
.canvas-wrap.management-hidden { display: none !important; }
.side.management-page { flex: 1 1 auto; width: 100%; max-width: none; border-left: 0; }
.page-title { justify-content: flex-start; padding: 10px 14px; letter-spacing: .08em; }
.home-pane { padding: 18px; }
.home-hero { margin-bottom: 16px; }
.home-hero h2 { margin: 0 0 6px; }
.home-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; align-items: start; }
.home-grid .card { min-width: 0; }
@media (max-width: 760px) { .home-grid { grid-template-columns: 1fr; } }
`;
}
fs.writeFileSync(stylesPath, styles);

let preview = fs.readFileSync(previewPath, "utf8");
preview = replaceOnce(preview,
  '      - name: Install frontend\n        run: npm install\n      - name: Build frontend\n',
  '      - name: Install frontend\n        run: npm install\n      - name: Audit UI navigation and quality tiers\n        run: |\n          node scripts/verify-ui-navigation.mjs\n          node scripts/verify-quality-system.mjs\n      - name: Build frontend\n',
  "preview audit step");
fs.writeFileSync(previewPath, preview);

// Preserve the UI lock by advancing only the two explicitly authorized UI baselines.
let lock = fs.readFileSync(lockPath, "utf8");
for (const rel of ["src/ui/App.tsx", "src/ui/styles.css"]) {
  const digest = execFileSync("git", ["hash-object", rel], { cwd: root, encoding: "utf8" }).trim();
  const re = new RegExp(`("${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}": ")[0-9a-f]{40}(" )?`);
  const simple = new RegExp(`("${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}": ")[0-9a-f]{40}(\")`);
  if (!simple.test(lock)) throw new Error(`[ui-cleanup] UI lock entry missing for ${rel}`);
  lock = lock.replace(simple, `$1${digest}$2`);
}
fs.writeFileSync(lockPath, lock);

console.log("[ui-cleanup] navigation and quality cleanup applied");
