import { useEffect, useRef, useState } from "react";
import { AudioEngine } from "../audio/engine";
import { ALL_EFFECTS, defaultEffect, newProject, type EffectKind, type Project, type Region, type ViewMode } from "../scene/types";
import { canvasToScene, sceneToCanvas, sceneViewport } from "../scene/transform";
import { GlRenderer } from "../render/renderer";

const audio = new AudioEngine();

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

  const loadImage = async (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { imgRef.current = img; glRef.current?.setBackdrop(img); setProject((p) => ({ ...p, backdropDataUrl: url })); };
    img.src = url;
  };

  const selected = project.regions.find((r) => r.id === sel);
  const clean = view === "CleanCapture";

  return (
    <div className="app">
      <div className={`top ${clean ? "hidden" : ""}`}>
        <span className="brand">AURALITH</span>
        <button onClick={() => document.getElementById("file")?.click()}>Load Image</button>
        <input id="file" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files && loadImage(e.target.files[0]!)} />
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
        <button onClick={async () => { try { await audio.startDemo(); setErr(""); } catch (e) { setErr(String(e)); } }}>Demo Audio</button>
        <button onClick={async () => { try { await audio.startMic(); setErr(""); } catch (e) { setErr(String(e)); } }}>Microphone</button>
        <button onClick={async () => { try { await audio.startSystemAudio(); setErr(""); } catch (e) { setErr(String(e)); } }}>System / Shared Audio</button>
        <button onClick={() => audio.stop()}>Stop Audio</button>
        <span>{status}</span>
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
          <h3>AUDIO</h3>
          <div className="meters">{status}{"\n"}{err}</div>
          <h3>EFFECT STACK</h3>
          {selected ? selected.effects.map((ef) => (
            <div key={ef.id}>
              <select value={ef.kind} onChange={(e) => {
                const kind = e.target.value as EffectKind;
                pushHist({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,kind}:x)}) });
              }}>
                {ALL_EFFECTS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <label>Intensity <input type="range" min={0} max={1} step={0.01} value={ef.intensity} onChange={(e) => {
                const v = Number(e.target.value);
                setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===ef.id?{...x,intensity:v}:x)}) });
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
          <p>F11 Clean Capture · ESC Edit · 80 effects registered · markers never disable effects</p>
        </aside>
      </div>
    </div>
  );
}
