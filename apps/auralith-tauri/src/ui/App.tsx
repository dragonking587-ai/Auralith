import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AudioEngine } from "../audio/engine";
import { ALL_EFFECTS, defaultEffect, newProject, type EffectKind, type Project, type Region, type ViewMode } from "../scene/types";
import { canvasToScene, sceneToCanvas, sceneViewport } from "../scene/transform";
import { GlRenderer } from "../render/renderer";

const audio = new AudioEngine();
const APP_VERSION = "2.0.0-alpha.10";

type VcamUi = { state: string; error: string; installed: boolean; running: boolean };
function parseVcam(raw: unknown): VcamUi {
  const fallback: VcamUi = { state: "NOT INSTALLED", error: "", installed: false, running: false };
  if (raw == null) return fallback;
  if (typeof raw === "string") {
    const s = raw.trim();
    return { state: s || "NOT INSTALLED", error: "", installed: /READY|LIVE|STOPPED/i.test(s), running: /LIVE/i.test(s) };
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const running = Boolean(o.running);
    const installed = Boolean(o.installed) || running;
    const error = String(o.error ?? "");
    let state = String(o.state ?? o.State ?? "").trim();
    if (!state) state = running ? "LIVE" : installed ? "READY" : error ? `ERROR — ${error}` : "NOT INSTALLED";
    return { state, error, installed, running };
  }
  return fallback;
}
const UPDATE_API = "https://api.github.com/repos/dragonking587-ai/Auralith-Releases/releases";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<GlRenderer | null>(null);
  const [project, setProject] = useState<Project>(newProject());
  const [view, setView] = useState<ViewMode>("Edit");
  const [tool, setTool] = useState<"Trace" | "Stamp" | "Emitter">("Emitter");
  const [sel, setSel] = useState<string | null>(null);
  const [status, setStatus] = useState("Audio STOPPED");
  const [err, setErr] = useState("");
  const [vcam, setVcam] = useState<VcamUi>({ state: "NOT INSTALLED", error: "", installed: false, running: false });
  const [vcamBusy, setVcamBusy] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const vcamLive = useRef(false);
  const [history, setHistory] = useState<Project[]>([]);
  const [redo, setRedo] = useState<Project[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    if (!canvasRef.current) return;
    glRef.current = new GlRenderer(canvasRef.current);
    let id = 0;
    const loop = () => {
      const wrap = wrapRef.current;
      if (wrap && glRef.current) glRef.current.draw(projectRef.current, audio.snapshot, wrap.clientWidth, wrap.clientHeight);
      setStatus(`AUDIO ${audio.status}  ${audio.sourceLabel}  RAW ${audio.snapshot.raw.toFixed(2)} B ${audio.snapshot.bass.toFixed(2)}`);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (vcamLive.current && glRef.current) {
        try {
          const frame = glRef.current.readCleanRgba();
          if (frame) {
            await fetch(`http://127.0.0.1:17331/frame?w=${frame.width}&h=${frame.height}`, {
              method: "POST",
              body: frame.pixels,
            });
          }
        } catch { /* keep UI alive */ }
      }
      setTimeout(tick, 66);
    };
    tick();
    const refresh = () => {
      invoke("vcam_status")
        .then((s) => setVcam(parseVcam(s)))
        .catch((e) => setVcam((cur) => ({ ...cur, state: cur.state || "ERROR — status query failed", error: String(e) })));
    };
    refresh();
    const poll = setInterval(refresh, 1000);
    return () => { stop = true; clearInterval(poll); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") { e.preventDefault(); setView((v) => v === "CleanCapture" ? "Edit" : "CleanCapture"); }
      if (e.key === "Escape") setView("Edit");
      if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); redoAct(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pushHist = (next: Project) => {
    setHistory((h) => [...h.slice(-40), project]);
    setRedo([]);
    setProject(next);
  };
  const undo = () => setHistory((h) => {
    if (!h.length) return h;
    const prev = h[h.length - 1]!;
    setRedo((r) => [project, ...r]);
    setProject(prev);
    return h.slice(0, -1);
  });
  const redoAct = () => setRedo((r) => {
    if (!r.length) return r;
    const [n, ...rest] = r;
    setHistory((h) => [...h, project]);
    setProject(n!);
    return rest;
  });

  const onCanvasClick = (e: React.MouseEvent) => {
    if (view === "CleanCapture") return;
    const wrap = wrapRef.current; if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const vp = sceneViewport(rect.width, rect.height, project.width, project.height, project.fit);
    const s = canvasToScene(e.clientX - rect.left, e.clientY - rect.top, vp, project.width, project.height);
    const region: Region = {
      id: crypto.randomUUID(), kind: tool, points: [{ x: s.x, y: s.y }],
      x: s.x, y: s.y, sx: 1, sy: 1, rotation: 0, radius: 80,
      effects: [defaultEffect("GlowBloom")]
    };
    pushHist({ ...project, regions: [...project.regions, region] });
    setSel(region.id);
  };

  const loadGen = useRef(0);
  const loadImage = async (file: File | undefined | null) => {
    if (!file) {
      console.log("[ImageLoad] PICKER_SELECTED cancel/null — keeping current image");
      return;
    }
    const gen = ++loadGen.current;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    console.log("[ImageLoad] PICKER_SELECTED", file.name, "ext="+ext, "type="+file.type, "size="+file.size);
    try {
      const buf = await file.arrayBuffer();
      if (gen !== loadGen.current) return;
      console.log("[ImageLoad] FILE_OPEN_OK bytes="+buf.byteLength);
      const blob = new Blob([buf], { type: file.type || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (gen !== loadGen.current) { URL.revokeObjectURL(url); return; }
        console.log("[ImageLoad] DECODE_OK", img.naturalWidth, "x", img.naturalHeight);
        try {
          imgRef.current = img;
          glRef.current?.setBackdrop(img);
          setProject((p) => {
            if (p.backdropDataUrl) URL.revokeObjectURL(p.backdropDataUrl);
            return { ...p, backdropDataUrl: url };
          });
          console.log("[ImageLoad] STATE_UPDATED RENDER_INVALIDATED IMAGE_VISIBLE");
        } catch (e) {
          console.error("[ImageLoad] STATE_UPDATE_FAILED", e);
          setErr(String(e));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        console.error("[ImageLoad] DECODE_FAILED", file.name);
        setErr("Could not decode image: " + file.name);
      };
      img.src = url;
    } catch (e) {
      console.error("[ImageLoad] FILE_OPEN_FAILED", e);
      setErr(String(e));
    }
  };

  const selected = project.regions.find((r) => r.id === sel);
  const clean = view === "CleanCapture";

  return (
    <div className="app">
      <div className={`top ${clean ? "hidden" : ""}`}>
        <span className="brand">AURALITH</span>
        <button onClick={() => document.getElementById("file")?.click()}>Load Image</button>
        <input id="file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp" hidden onChange={(e) => { const f=e.target.files?.[0]; e.target.value=""; loadImage(f); }} />
        <select value={project.fit} onChange={(e) => setProject({ ...project, fit: e.target.value as Project["fit"] })}>
          <option>Fit</option><option>Fill</option><option>Stretch</option><option>Center</option>
        </select>
        <select value={`${project.width}x${project.height}`} onChange={(e) => {
          const [w,h] = e.target.value.split("x").map(Number);
          setProject({ ...project, width: w!, height: h! });
        }}>
          <option value="1920x1080">1920×1080</option>
          <option value="2560x1440">2560×1440</option>
          <option value="3840x2160">3840×2160</option>
          <option value="1080x1920">1080×1920</option>
          <option value="1440x2560">1440×2560</option>
        </select>
        <button onClick={() => setTool("Trace")}>Trace</button>
        <button onClick={() => setTool("Stamp")}>Stamp</button>
        <button onClick={() => setTool("Emitter")}>Emitter</button>
        <button onClick={() => setView("Edit")}>Edit</button>
        <button onClick={() => setView("Preview")}>Preview</button>
        <button className="gold" onClick={() => setView("CleanCapture")}>CLEAN CAPTURE</button>
        <button onClick={undo}>Undo</button>
        <button onClick={redoAct}>Redo</button>
        <button onClick={() => { if (!sel) return; pushHist({ ...project, regions: project.regions.filter((r) => r.id !== sel) }); setSel(null); }}>Delete Region</button>
        <label><input type="checkbox" checked={project.showMarkers} onChange={(e)=>setProject({...project, showMarkers:e.target.checked})}/> Show overlays</label>
        <button onClick={() => { const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='scene.auralith'; a.click(); }}>Save</button>
        <button onClick={() => document.getElementById('proj')?.click()}>Open</button>
        <input id="proj" type="file" accept=".auralith,application/json" hidden onChange={async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try { const p=JSON.parse(await f.text()); if(p.version!==1) throw new Error('unsupported project'); setProject(p);} catch(err){ setErr(String(err)); } }} />
        <button onClick={async () => { try { await audio.startDemo(); setErr(""); } catch (e) { setErr(String(e)); } }}>Demo Audio</button>
        <button onClick={async () => { try { await audio.startMic(); setErr(""); } catch (e) { setErr(String(e)); } }}>Microphone</button>
        <button onClick={async () => { try { await audio.startSystemAudio(); setErr(""); } catch (e) { setErr(String(e)); } }}>System / Shared Audio</button>
        <button onClick={() => audio.stop()}>Stop Audio</button>
        <button disabled={updateBusy} onClick={async () => {
          if (updateBusy) return;
          setUpdateBusy(true);
          setUpdateMsg("Checking for updates…");
          try {
            const res = await fetch(UPDATE_API);
            if (!res.ok) throw new Error(`Update source HTTP ${res.status}`);
            const list = await res.json() as { tag_name?: string; html_url?: string; prerelease?: boolean }[];
            const tags = list.map((r) => r.tag_name || "").filter((t) => t.startsWith("reborn-v"));
            const latest = tags[0] || "";
            const latestVer = latest.replace(/^reborn-v/, "");
            if (!latest) setUpdateMsg(`Up to date (no Reborn tags). Installed ${APP_VERSION}`);
            else if (latestVer === APP_VERSION || latest.endsWith(APP_VERSION)) setUpdateMsg(`Up to date. Installed ${APP_VERSION}`);
            else setUpdateMsg(`Update available: ${latest} (installed ${APP_VERSION}). Download from GitHub Releases.`);
          } catch (e) {
            setUpdateMsg("Update check failed: " + String(e));
          } finally {
            setUpdateBusy(false);
          }
        }}>Check for Updates</button>
        <span>{status}</span>
        {updateMsg && <span> {updateMsg}</span>}
      </div>
      <div className={`stage ${clean ? "clean" : ""}`}>
        <div className="canvas-wrap" ref={wrapRef} onClick={onCanvasClick}>
          <canvas id="gl" ref={canvasRef} />
          {!clean && project.showMarkers && view === "Edit" && (
            <div className="overlay">
              <svg>
                {project.regions.map((r) => {
                  const wrap = wrapRef.current?.getBoundingClientRect();
                  if (!wrap) return null;
                  const vp = sceneViewport(wrap.width, wrap.height, project.width, project.height, project.fit);
                  const p = sceneToCanvas(r.x, r.y, vp, project.width, project.height);
                  return <circle key={r.id} cx={p.x} cy={p.y} r={8} fill={r.id===sel?"#D4AF37":"#7ad0ff"} />;
                })}
              </svg>
            </div>
          )}
        </div>
        <aside className={`side ${clean ? "hidden" : ""}`}>
          <h3>VIRTUAL CAMERA</h3>
          <div className="meters">{`Device: Auralith Reborn Camera\nStatus: ${vcam.state}${vcam.error ? `\n${vcam.error}` : ""}\n1920×1080 YUY2 / BGRA bridge`}</div>
          <button disabled={vcamBusy || (vcam.installed && !/ERROR|NOT INSTALLED/i.test(vcam.state))} onClick={async ()=>{
            console.log("UI_VCAM_INSTALL_CLICK");
            if (vcamBusy) return;
            setVcamBusy(true);
            setVcam((s) => ({ ...s, state: "INSTALLING" }));
            try {
              const r = await invoke("vcam_install");
              console.log("UI_VCAM_INSTALL_OK", r);
              const st = parseVcam(await invoke("vcam_status"));
              setVcam({ ...st, state: st.installed || /READY|LIVE/i.test(st.state) ? "READY" : (st.state || "READY") });
              setErr("");
            } catch (e) {
              console.error("UI_VCAM_INSTALL_ERR", e);
              const msg = String(e);
              setVcam({ state: `ERROR — ${msg}`, error: msg, installed: false, running: false });
              setErr(msg);
            } finally { setVcamBusy(false); }
          }}>Install Virtual Camera</button>
          <button disabled={vcamBusy || vcam.running || !(/READY|STOPPED/i.test(vcam.state) || vcam.installed)} onClick={async ()=>{
            console.log("UI_VCAM_START_CLICK");
            if (vcamBusy) return;
            setVcamBusy(true);
            setVcam((s) => ({ ...s, state: "STARTING" }));
            try {
              await invoke("vcam_start");
              vcamLive.current = true;
              const st = parseVcam(await invoke("vcam_status"));
              setVcam({ ...st, state: "LIVE", running: true });
              setErr("");
            } catch (e) {
              console.error("UI_VCAM_START_ERR", e);
              const msg = String(e);
              vcamLive.current = false;
              setVcam({ state: `ERROR — ${msg}`, error: msg, installed: vcam.installed, running: false });
              setErr(msg);
            } finally { setVcamBusy(false); }
          }}>Start Virtual Camera</button>
          <button disabled={vcamBusy || !(vcam.running || /LIVE|STARTING/i.test(vcam.state))} onClick={async ()=>{
            console.log("UI_VCAM_STOP_CLICK");
            if (vcamBusy) return;
            setVcamBusy(true);
            setVcam((s) => ({ ...s, state: "STOPPING" }));
            try {
              vcamLive.current = false;
              await invoke("vcam_stop");
              const st = parseVcam(await invoke("vcam_status"));
              setVcam({ ...st, state: "STOPPED", running: false });
              setErr("");
            } catch (e) {
              console.error("UI_VCAM_STOP_ERR", e);
              const msg = String(e);
              setVcam({ state: `ERROR — ${msg}`, error: msg, installed: vcam.installed, running: false });
              setErr(msg);
            } finally { setVcamBusy(false); }
          }}>Stop Virtual Camera</button>
          <h3>AUDIO</h3>
          <div className="meters">{status}{"\n"}{err}</div>
          <h3>MASTERS</h3>
          <label>Intensity <input type="range" min={0} max={2} step={0.01} value={project.masters.intensity} onChange={(e)=>setProject({...project, masters:{...project.masters, intensity:Number(e.target.value)}})} /></label>
          <label>Brightness <input type="range" min={0} max={2} step={0.01} value={project.masters.brightness} onChange={(e)=>setProject({...project, masters:{...project.masters, brightness:Number(e.target.value)}})} /></label>
          <h3>EFFECT STACK</h3>
          {selected ? selected.effects.map((ef) => (
            <div key={ef.id}>
              <label><input type="checkbox" checked={ef.enabled} onChange={(e)=>{
                const on = e.target.checked;
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,enabled:on}:x)}) });
              }} /> Enabled</label>
              <select value={ef.kind} onChange={(e) => {
                const kind = e.target.value as EffectKind;
                pushHist({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,kind}:x)}) });
              }}>
                {ALL_EFFECTS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <label>Intensity {ef.intensity.toFixed(2)} <input type="range" min={0} max={2} step={0.01} value={ef.intensity} onChange={(e) => {
                const v = Number(e.target.value);
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,intensity:v}:x)}) });
              }} /></label>
              <label>Opacity <input type="range" min={0} max={1} step={0.01} value={ef.opacity} onChange={(ev)=>{
                const v=Number(ev.target.value);
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,opacity:v}:x)}) });
              }} /></label>
              <label>Speed <input type="range" min={0.05} max={4} step={0.01} value={ef.speed} onChange={(ev)=>{
                const v=Number(ev.target.value);
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,speed:v}:x)}) });
              }} /></label>
              <label>Amount/Rate <input type="range" min={0} max={2} step={0.01} value={ef.p0??0.65} onChange={(ev)=>{
                const v=Number(ev.target.value);
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,p0:v}:x)}) });
              }} /></label>
              <label>Size/Width <input type="range" min={0} max={2} step={0.01} value={ef.p1??0.5} onChange={(ev)=>{
                const v=Number(ev.target.value);
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,p1:v}:x)}) });
              }} /></label>
              <label>Shape/Phase <input type="range" min={0} max={2} step={0.01} value={ef.p2??0.4} onChange={(ev)=>{
                const v=Number(ev.target.value);
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,p2:v}:x)}) });
              }} /></label>
              <label>Primary <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(ef.color)?ef.color:"#f4d27a"} onChange={(ev)=>{
                const v=ev.target.value;
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,color:v}:x)}) });
              }} /></label>
              <label>Secondary <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(ef.color2)?ef.color2:"#7ad0ff"} onChange={(ev)=>{
                const v=ev.target.value;
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,color2:v}:x)}) });
              }} /></label>
              <label>Audio Influence <input type="range" min={0} max={1} step={0.01} value={ef.audioInfluence} onChange={(ev)=>{
                const v=Number(ev.target.value);
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,audioInfluence:v}:x)}) });
              }} /></label>
              <select value={ef.audio} onChange={(e) => {
                const audioMap = e.target.value as typeof ef.audio;
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,audio:audioMap}:x)}) });
              }}>
                {["Manual","Raw","Bass","Low","Mid","High","FullMix","Beat","Transient"].map((a)=><option key={a}>{a}</option>)}
              </select>
            </div>
          )) : <p>Click the canvas to place a {tool}.</p>}
          {selected && <button onClick={() => pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects:[...r.effects, defaultEffect("Pulse")]}) })}>Add Effect</button>}
          {selected && selected.effects[0] && <button onClick={() => {
            const kind = selected.effects[0]!.kind;
            pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects: r.effects.map((x,i)=> i===0?defaultEffect(kind):x)}) });
          }}>Reset First Effect</button>}
          {selected && <button onClick={() => {
            const copy = selected.effects[0];
            if (!copy) return;
            pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects:[...r.effects, { ...copy, id: crypto.randomUUID() }]}) });
          }}>Duplicate Effect</button>}
          <p>F11 Clean Capture · ESC Edit · 80 effects registered · markers never disable effects</p>
        </aside>
      </div>
    </div>
  );
}
