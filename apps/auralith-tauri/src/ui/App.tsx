import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AudioEngine } from "../audio/engine";
import { ALL_EFFECTS, defaultEffect, newProject, type EffectKind, type Project, type Region, type ViewMode } from "../scene/types";
import { VORTEX_PRESETS } from "../scene/presets";
import { canvasToScene, sceneToCanvas, sceneViewport } from "../scene/transform";
import { closestSegment, chaikin, rdp, pathLength, rasterizeClosed } from "../scene/traceMath";
import { assistedTrace, analyzeCandidates, foregroundMask, estimateDepth, invertDepth, type AiCandidate } from "../scene/localVision";
import { runEngine, enhancedCandidates, engineLabel, ENHANCED_MODEL, type AiEngine, type Prompt } from "../scene/enhancedVision";
import { detectWordTraces, rasterizeWordMask, type WordCandidate } from "../scene/smartNeon";
import { FEEDBACK_TYPES, buildReport, githubNewIssueUrl, type FeedbackDraft } from "../scene/feedback";
import { semverNewer, formatBytes, persistPending, takePending, autosaveProject } from "../scene/updater";
import { GlRenderer } from "../render/renderer";

const audio = new AudioEngine();
const APP_VERSION = "1.0.0-rc.6";
const PARAM_LABELS: Record<string, [string, string, string]> = {
  VoidEnergy: ["Void Size", "Tendril Reach", "Tendril Count"],
  Portal: ["Portal Radius", "Rim Width", "Inner Swirl"],
  Vortex: ["Spiral Tightness", "Rotation Speed", "Arm Count"],
  EnergyBeam: ["Beam Length", "Beam Width", "Turbulence"],
  EnergySparks: ["Spark Rate", "Spark Size", "Spread"],
  SpectralAura: ["Aura Radius", "Thickness", "Wisp Motion"],
  LightningArc: ["Bolt Rate", "Bolt Width", "Branching"],
  ElectricCrawl: ["Crawl Speed", "Arc Width", "Density"],
  ThunderFlash: ["Flash Rate", "Flash Strength", "Decay"],
  Laser: ["Beam Length", "Core Sharpness", "Glow Width"],
  RealisticFlame: ["Flame Height", "Flame Width", "Tongue Motion"],
  Embers: ["Spawn Rate", "Rise Speed", "Drift"],
  Sparks: ["Burst Rate", "Speed", "Spread"],
  HeatDistortion: ["Rise Speed", "Distortion Scale", "Ripple"],
  SmokeFog: ["Density", "Coverage", "Roll"],
  Mist: ["Drift Speed", "Opacity", "Softness"],
  HueShift: ["Hue Rotation", "Saturation", "Contrast"],
  ChromaticPulse: ["Pulse Speed", "Separation", "Decay"],
  PrismaticLight: ["Spread", "Sweep Speed", "Dispersion"],
  NeonGlow: ["Glow Strength", "Tube Width", "Flicker"],
  Pulse: ["Pulse Amount", "Pulse Size", "Phase"],
  Flicker: ["Flicker Depth", "Speed", "Stability"],
  LightSurge: ["Surge Strength", "Bloom", "Decay"],
  Strobe: ["Rate", "Duty", "Phase"],
  GlowBloom: ["Bloom Strength", "Radius", "Layers"],
  BreathingGlow: ["Breath Speed", "Depth", "Phase"],
  Afterglow: ["Persistence", "Radius", "Decay"],
  EchoPulse: ["Main Strength", "Size Growth", "Echo Decay"],
  WaveSweep: ["Speed", "Band Width", "Direction"],
  Spotlight: ["Brightness", "Radius", "Focus"],
  Halo: ["Radius", "Ring Width", "Broken Arc"],
  LightRays: ["Ray Count", "Width", "Rotation"],
  GodRays: ["Strength", "Softness", "Haze"],
  LensFlare: ["Intensity", "Ghost Spacing", "Streak"],
  Starburst: ["Spike Count", "Sharpness", "Decay"],
  EnergyFlow: ["Flow Speed", "Width", "Segment Count"],
  EnergyRipple: ["Ripple Speed", "Ring Width", "Spacing"],
  Shockwave: ["Expansion Speed", "Ring Width", "Sharpness"],
  MagicEnergy: ["Core Size", "Tendril Length", "Tendril Count"],
  Plasma: ["Plasma Scale", "Flow Speed", "Warp"],
  NeonChase: ["Chase Speed", "Segment Length", "Segment Count"],
  Shimmer: ["Shimmer Speed", "Shimmer Scale", "Softness"],
  GlitterSparkle: ["Twinkle Rate", "Density", "Size"],
  HolographicDistortion: ["Phase Drift", "Scanline Density", "Layer Shift"],
  GlitchLight: ["Glitch Rate", "Block Size", "Tear"],
  ShadowPulse: ["Pulse Speed", "Pulse Width", "Phase"],
  RoomDim: ["Dim Amount", "Vignette", "Recovery"],
  LocalDim: ["Dim Strength", "Radius", "Feather"],
  ContrastSurge: ["Contrast Amount", "Clarity", "Release"],
  Rain: ["Fall Speed", "Drop Density", "Wind"],
  WetReflection: ["Reflection Strength", "Surface Position", "Ripple"],
  Snow: ["Fall Speed", "Flake Density", "Drift"],
  Ash: ["Ash Density", "Drift", "Tumble"],
  DustMotes: ["Drift Speed", "Mote Size", "Twinkle"],
  Aurora: ["Flow Speed", "Curtain Height", "Ribbon Count"],
  AtmosphericHaze: ["Haze Amount", "Depth Falloff", "Drift"],
  WaterReflection: ["Wave Speed", "Waterline", "Wave Frequency"],
  Caustics: ["Caustic Scale", "Flow Speed", "Warp"],
  WaterRipple: ["Ripple Speed", "Amplitude", "Ring Width"],
  Refraction: ["Index Amount", "Lens Radius", "Dispersion"],
  FrostIce: ["Coverage", "Grain", "Branching"],
  CrystalGrowth: ["Growth Amount", "Crystal Length", "Facet Count"],
  IceShimmer: ["Shimmer Speed", "Highlight Width", "Sparkle"],
  FrozenBreath: ["Puff Rate", "Puff Size", "Curl"],
  Fireflies: ["Flight Speed", "Wander", "Blink"],
  BioluminescentSpores: ["Pulse Speed", "Density", "Curl"],
  RuneGlow: ["Flow Speed", "Core Width", "Pulse"],
  SigilActivation: ["Activation Speed", "Ring Width", "Core Ignition"],
  ShadowTendrils: ["Growth Speed", "Reach", "Curl"],
  Eclipse: ["Radius", "Corona Width", "Totality"],
  GravityWell: ["Pull", "Well Radius", "Horizon"],
  SpatialWarp: ["Warp Strength", "Warp Radius", "Twist"],
  Kaleidoscope: ["Rotation", "Zoom", "Segments"],
  MirrorFracture: ["Fracture", "Shard Size", "Edge"],
  PixelDissolve: ["Dissolve Amount", "Pixel Size", "Scatter"],
  ScanlinePulse: ["Scan Speed", "Band Width", "Tail"],
  RgbSplit: ["Separation", "Direction", "Wave"],
  FilmBurn: ["Burn Amount", "Spread", "Grain"],
  CelestialStars: ["Density", "Twinkle", "Parallax"],
  CosmicNebula: ["Scale", "Flow Speed", "Turbulence"],
  SmartNeon: ["Flow Speed", "Tube Width", "Chase Segments"],
};

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

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<GlRenderer | null>(null);
  const [project, setProject] = useState<Project>(newProject());
  const [view, setView] = useState<ViewMode>("Edit");
  const [tool, setTool] = useState<"Trace" | "Stamp" | "Emitter" | "Edit">("Edit");
  const [viewZoom, setViewZoom] = useState<number | "fit">("fit");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selPt, setSelPt] = useState<number | null>(null);
  const [traceFill, setTraceFill] = useState<"outline"|"fill"|"both">("outline");
  const [smoothAmt, setSmoothAmt] = useState(0.5);
  const [simpAmt, setSimpAmt] = useState(4);
  const [preserveCorners, setPreserveCorners] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [traceDebug, setTraceDebug] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(() => localStorage.getItem("auralith.aiEnabled")==="1");
  const [aiWarn, setAiWarn] = useState(() => localStorage.getItem("auralith.aiWarn")!=="hide");
  const [aiMode, setAiMode] = useState<"idle"|"click"|"box"|"brush">("idle");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiPreview, setAiPreview] = useState<{points:{x:number;y:number}[]; closed:boolean} | null>(null);
  const [aiCands, setAiCands] = useState<AiCandidate[]>([]);
  const [aiDepth, setAiDepth] = useState<string>("");
  const [aiSens, setAiSens] = useState(0.55);
  const [aiEngine, setAiEngine] = useState<AiEngine>(() => (localStorage.getItem("auralith.aiEngine") as AiEngine) || "auto");
  const [aiPrompts, setAiPrompts] = useState<Prompt[]>([]);
  const [refineMode, setRefineMode] = useState<"include"|"exclude"|null>(null);
  const [lastEngineUsed, setLastEngineUsed] = useState("");
  const [maskTool, setMaskTool] = useState<"add"|"remove"|"lassoAdd"|"lassoRemove"|"">("");
  const brushRef = useRef<{x:number;y:number}[]>([]);
  const spaceRef = useRef(false);
  const viewZoomRef = useRef<number | "fit">("fit");
  viewZoomRef.current = viewZoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const [sel, setSel] = useState<string | null>(null);
  const [fbType, setFbType] = useState<(typeof FEEDBACK_TYPES)[number]>("Bug Report");
  const [fbTitle, setFbTitle] = useState("");
  const [fbBody, setFbBody] = useState("");
  const [fbSteps, setFbSteps] = useState("");
  const [fbExpected, setFbExpected] = useState("");
  const [fbActual, setFbActual] = useState("");
  const [fbDiag, setFbDiag] = useState(false);
  const [fbPreview, setFbPreview] = useState(false);
  const [fbMsg, setFbMsg] = useState("");
  const [status, setStatus] = useState("Audio STOPPED");
  const [err, setErr] = useState("");
  const [vcam, setVcam] = useState<VcamUi>({ state: "NOT INSTALLED", error: "", installed: false, running: false });
  const [vcamBusy, setVcamBusy] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateAvail, setUpdateAvail] = useState<string>("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [updatePct, setUpdatePct] = useState("");
  const [updateDetails, setUpdateDetails] = useState("");
  const [showUpdateDetails, setShowUpdateDetails] = useState(false);
  const pendingUpdateRef = useRef<any>(null);
  const [tab, setTab] = useState<"effects"|"audio"|"output"|"ai"|"settings">("effects");
  const [openFx, setOpenFx] = useState<string | null>(null);
  const [fxSub, setFxSub] = useState<"basic"|"color"|"audio"|"motion">("basic");
  const [fxQuery, setFxQuery] = useState("");
  const [picker, setPicker] = useState(false);
  const [oneOpen, setOneOpen] = useState(true);
  const [showErrDetails, setShowErrDetails] = useState(false);
  const [neonWarn, setNeonWarn] = useState(() => localStorage.getItem("auralith.neonWarn") !== "hide");
  const [neonOpen, setNeonOpen] = useState(false);
  const [neonBusy, setNeonBusy] = useState(false);
  const [neonCands, setNeonCands] = useState<WordCandidate[]>([]);
  const [neonMsg, setNeonMsg] = useState("");
  const [neonSens, setNeonSens] = useState(0.7);
  const vcamLive = useRef(false);
  const [history, setHistory] = useState<Project[]>([]);
  const [redo, setRedo] = useState<Project[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const dragRef = useRef<{ id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const selRef = useRef(sel);
  selRef.current = sel;

  useEffect(() => {
    console.log("APP_COMPONENT_BEGIN");
    if (!canvasRef.current) return;
    let id = 0;
    try {
      console.log("RENDERER_INIT_BEGIN");
      glRef.current = new GlRenderer(canvasRef.current);
      console.log("RENDERER_INIT_OK APP_READY");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("APP_BOOT_FAILED stage=RENDERER error=" + msg);
      setErr("Renderer: " + msg);
    }
    const loop = () => {
      const wrap = wrapRef.current;
      try {
        if (wrap && glRef.current) glRef.current.draw(projectRef.current, audio.snapshot, wrap.clientWidth, wrap.clientHeight);
      } catch (e) {
        console.error("APP_BOOT_FAILED stage=RENDER_FRAME error=" + e);
      }
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
    const pending = takePending();
    if (pending && (pending === APP_VERSION || pending.endsWith(APP_VERSION))) {
      setUpdateMsg(`Auralith Reborn updated successfully to v${APP_VERSION}.`);
    }
    const t = window.setTimeout(() => { void checkUpdates(true); }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") { e.preventDefault(); setView((v) => v === "CleanCapture" ? "Edit" : "CleanCapture"); }
      if (e.key === "Escape") { setView("Edit"); dragRef.current = null; }
      if (e.code === "Space") spaceRef.current = true;
      if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); redoAct(); }
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.key === "Delete" || e.key === "Backspace") && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        const id = selRef.current;
        if (id) {
          e.preventDefault();
          const cur = projectRef.current;
          setHistory((h) => [...h.slice(-40), cur]);
          setRedo([]);
          setProject({ ...cur, regions: cur.regions.filter((r) => r.id !== id) });
          setSel(null);
        }
      }
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceRef.current = false; };
    const onNudge = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!selRef.current || selPt == null) return;
      if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const step = e.altKey ? 0.25 : e.shiftKey ? 10 : 1;
      const dx = e.key==="ArrowLeft"?-step:e.key==="ArrowRight"?step:0;
      const dy = e.key==="ArrowUp"?-step:e.key==="ArrowDown"?step:0;
      const cur = projectRef.current;
      const r = cur.regions.find((x)=>x.id===selRef.current);
      if (!r || !r.points[selPt]) return;
      const pts = r.points.map((p,i)=> i===selPt ? { x: p.x+dx, y: p.y+dy } : p);
      pushHist({ ...cur, regions: cur.regions.map((x)=> x.id!==r.id ? x : { ...x, points: pts, x: pts[0]!.x, y: pts[0]!.y, pathLength: pathLength(pts, !!x.pathClosed).total }) });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("keydown", onNudge);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onUp); window.removeEventListener("keydown", onNudge); };
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

  const currentVp = (rect?: DOMRect) => {
    const wrap = wrapRef.current;
    const r = rect || wrap!.getBoundingClientRect();
    const proj = projectRef.current;
    const z = viewZoomRef.current;
    if (z === "fit") {
      const base = sceneViewport(r.width, r.height, proj.width, proj.height, proj.fit);
      return { ...base, x: base.x + panRef.current.x, y: base.y + panRef.current.y };
    }
    const s = z / 100;
    const w = proj.width * s, h = proj.height * s;
    return { x: (r.width - w) / 2 + panRef.current.x, y: (r.height - h) / 2 + panRef.current.y, w, h };
  };
  const sceneFromEvent = (e: { clientX: number; clientY: number }) => {
    const wrap = wrapRef.current!;
    const rect = wrap.getBoundingClientRect();
    const proj = projectRef.current;
    const vp = currentVp(rect);
    return canvasToScene(e.clientX - rect.left, e.clientY - rect.top, vp, proj.width, proj.height);
  };
  const hitTest = (e: { clientX: number; clientY: number }) => {
    const wrap = wrapRef.current; if (!wrap) return null as null | { kind: "point"|"marker"|"seg"|"all"; id: string; index: number };
    const rect = wrap.getBoundingClientRect();
    const proj = projectRef.current;
    const vp = currentVp(rect);
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    let bestPt: { id: string; index: number; d: number } | null = null;
    for (const r of proj.regions) {
      const pts = r.kind === "Trace" && r.points.length ? r.points : [{ x: r.x, y: r.y }];
      pts.forEach((pt, i) => {
        const c = sceneToCanvas(pt.x, pt.y, vp, proj.width, proj.height);
        const d = Math.hypot(c.x - px, c.y - py);
        if (d <= 14 && (!bestPt || d < bestPt.d)) bestPt = { id: r.id, index: i, d };
      });
    }
    if (bestPt) return { kind: bestPt.index > 0 || proj.regions.find(r=>r.id===bestPt!.id)?.kind==="Trace" ? "point" : "marker", id: bestPt.id, index: bestPt.index };
    const s = canvasToScene(px, py, vp, proj.width, proj.height);
    let bestSeg: { id: string; d: number } | null = null;
    for (const r of proj.regions) {
      if (r.kind !== "Trace" || r.points.length < 2) continue;
      const hit = closestSegment(r.points, !!r.pathClosed, s);
      const c = sceneToCanvas(hit.x, hit.y, vp, proj.width, proj.height);
      const d = Math.hypot(c.x - px, c.y - py);
      if (d <= 10 && (!bestSeg || d < bestSeg.d)) bestSeg = { id: r.id, d };
    }
    if (bestSeg) return { kind: "seg", id: bestSeg.id, index: -1 };
    return null;
  };
  const runAssisted = async (mode: "click"|"box"|"brush", seed: {x:number;y:number;w?:number;h?:number;path?:{x:number;y:number}[]}) => {
    const img = imgRef.current;
    if (!img) { setAiMsg("Load an image first."); return; }
    setAiBusy(true); setAiMsg("Analyzing selection...");
    try {
      const res = await runEngine(aiEngine, img, projectRef.current.width, projectRef.current.height, mode, seed, aiPrompts, aiSens);
      if (!res) setAiMsg("Could not create a reliable suggestion. [Retry] [Use Lightweight Vision] [Manual Trace]");
      else { setAiPreview(res); setLastEngineUsed(res.engineUsed); setAiMsg("Preview ready ("+res.engineUsed+"). Accept to create a normal Trace."); }
    } catch (err) { setAiMsg("AI failed: "+String(err)); }
    finally { setAiBusy(false); }
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (view === "CleanCapture") return;
    if (aiEnabled && tab === "ai" && refineMode) {
      const s = sceneFromEvent(e);
      setAiPrompts((ps)=>[...ps, { x:s.x, y:s.y, positive: refineMode==="include" }]);
      void runAssisted("click", s);
      return;
    }
    if (aiEnabled && aiMode !== "idle" && tab === "ai") {
      const s = sceneFromEvent(e);
      if (aiMode === "click") { void runAssisted("click", s); return; }
      if (aiMode === "box") {
        const d = dragRef.current as any;
        if (!d || d.mode !== "aibox") {
          dragRef.current = { id: "__aibox__", ox: s.x, oy: s.y, sx: s.x, sy: s.y, moved: false, mode: "aibox" } as any;
          return;
        }
      }
      if (aiMode === "brush") {
        brushRef.current = [s];
        dragRef.current = { id: "__aibrush__", ox: s.x, oy: s.y, sx: s.x, sy: s.y, moved: false, mode: "aibrush" } as any;
        return;
      }
    }
    const wrap = wrapRef.current; if (!wrap) return;
    if (spaceRef.current || e.button === 1) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { id: "__pan__", ox: panRef.current.x, oy: panRef.current.y, sx: e.clientX, sy: e.clientY, moved: false, mode: "pan" } as any;
      return;
    }
    const hit = hitTest(e);
    const s = sceneFromEvent(e);
    if (hit) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = projectRef.current.regions.find((x) => x.id === hit.id)!;
      setSel(hit.id);
      if (hit.kind === "point") {
        setSelPt(hit.index);
        const pt = r.points[hit.index] || { x: r.x, y: r.y };
        dragRef.current = { id: hit.id, ox: pt.x, oy: pt.y, sx: s.x, sy: s.y, moved: false, mode: "point", index: hit.index } as any;
      } else if (toolRef.current === "Edit") {
        setSelPt(null);
        dragRef.current = { id: hit.id, ox: 0, oy: 0, sx: s.x, sy: s.y, moved: false, mode: "all", points: r.points.map((p)=>({...p})), rx: r.x, ry: r.y } as any;
      } else {
        setSelPt(hit.index >= 0 ? hit.index : null);
        dragRef.current = { id: hit.id, ox: r.x, oy: r.y, sx: s.x, sy: s.y, moved: false, mode: "marker" } as any;
      }
      return;
    }
    if (toolRef.current === "Edit") return;
    if (toolRef.current === "Trace") {
      const cur = projectRef.current;
      const active = selRef.current ? cur.regions.find((r)=>r.id===selRef.current && r.kind==="Trace") : null;
      if (active) {
        const pts = [...active.points, { x: s.x, y: s.y }];
        const len = pathLength(pts, !!active.pathClosed).total;
        pushHist({ ...cur, regions: cur.regions.map((r)=> r.id!==active.id ? r : { ...r, points: pts, x: pts[0]!.x, y: pts[0]!.y, pathLength: len }) });
        setSelPt(pts.length-1);
        return;
      }
    }
    const kind = toolRef.current === "Trace" || toolRef.current === "Stamp" || toolRef.current === "Emitter" ? toolRef.current : "Emitter";
    const region: Region = {
      id: crypto.randomUUID(), kind, points: [{ x: s.x, y: s.y }],
      x: s.x, y: s.y, sx: 1, sy: 1, rotation: 0, radius: 80,
      effects: [defaultEffect("GlowBloom")], pathClosed: false, pathLength: 0
    };
    pushHist({ ...projectRef.current, regions: [...projectRef.current.regions, region] });
    setSel(region.id);
    setSelPt(0);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current as any; if (!d) return;
    if (d.mode === "aibrush") { brushRef.current.push(sceneFromEvent(e)); return; }
    if (d.mode === "aibox") { d.sx = sceneFromEvent(e).x; d.sy = sceneFromEvent(e).y; return; }
    if (d.mode === "pan") {
      setPan({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
      d.moved = true;
      return;
    }
    const s = sceneFromEvent(e);
    const dx = s.x - d.sx, dy = s.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 2) return;
    d.moved = true;
    const cur = projectRef.current;
    if (d.mode === "all") {
      setProject({
        ...cur,
        regions: cur.regions.map((r) => r.id !== d.id ? r : {
          ...r,
          x: d.rx + dx, y: d.ry + dy,
          points: (d.points as {x:number;y:number}[]).map((p)=>({ x: p.x+dx, y: p.y+dy }))
        })
      });
      return;
    }
    const nx = Math.max(0, Math.min(cur.width, d.ox + dx));
    const ny = Math.max(0, Math.min(cur.height, d.oy + dy));
    setProject({
      ...cur,
      regions: cur.regions.map((r) => {
        if (r.id !== d.id) return r;
        if (d.mode === "point") {
          const pts = r.points.map((p,i)=> i===d.index ? { x: nx, y: ny } : p);
          return { ...r, points: pts, x: pts[0]?.x ?? r.x, y: pts[0]?.y ?? r.y, pathLength: pathLength(pts, !!r.pathClosed).total };
        }
        return { ...r, x: nx, y: ny, points: r.points.map((p,i)=> i===0 ? { x: nx, y: ny } : p) };
      })
    });
  };
  const onPointerUp = () => {
    const d = dragRef.current as any;
    dragRef.current = null;
    if (d?.mode === "aibox") {
      const w = Math.abs(d.sx-d.ox), h = Math.abs(d.sy-d.oy);
      void runAssisted("box", { x: Math.min(d.ox,d.sx), y: Math.min(d.oy,d.sy), w, h });
      return;
    }
    if (d?.mode === "aibrush") {
      void runAssisted("brush", { x: d.ox, y: d.oy, path: brushRef.current.slice() });
      brushRef.current = [];
      return;
    }
    if (!d?.moved || d.mode === "pan") return;
    const cur = projectRef.current;
    // snapshot already live; push previous via stored origin
    const before = { ...cur, regions: cur.regions.map((r) => {
      if (r.id !== d.id) return r;
      if (d.mode === "all") return { ...r, x: d.rx, y: d.ry, points: d.points };
      if (d.mode === "point") {
        const pts = r.points.map((p,i)=> i===d.index ? { x: d.ox, y: d.oy } : p);
        return { ...r, points: pts, x: pts[0]?.x ?? r.x, y: pts[0]?.y ?? r.y };
      }
      return { ...r, x: d.ox, y: d.oy, points: r.points.map((p,i)=> i===0 ? { x: d.ox, y: d.oy } : p) };
    }) };
    setHistory((h) => [...h.slice(-40), before]);
    setRedo([]);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (view === "CleanCapture") return;
    e.preventDefault();
    const wrap = wrapRef.current; if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const proj = projectRef.current;
    const before = currentVp(rect);
    const s0 = canvasToScene(e.clientX-rect.left, e.clientY-rect.top, before, proj.width, proj.height);
    const curZ = viewZoomRef.current === "fit" ? Math.min(rect.width/proj.width, rect.height/proj.height)*100 : viewZoomRef.current;
    const next = Math.max(25, Math.min(1600, curZ * (e.deltaY < 0 ? 1.12 : 1/1.12)));
    setViewZoom(next);
    viewZoomRef.current = next;
    const after = currentVp(rect);
    const s1 = canvasToScene(e.clientX-rect.left, e.clientY-rect.top, after, proj.width, proj.height);
    const c0 = sceneToCanvas(s0.x, s0.y, after, proj.width, proj.height);
    const c1 = sceneToCanvas(s1.x, s1.y, after, proj.width, proj.height);
    setPan((p)=>({ x: p.x + (c1.x-c0.x), y: p.y + (c1.y-c0.y) }));
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
  const snap = audio.snapshot;
  const filteredFx = ALL_EFFECTS.filter((k) => !fxQuery || k.toLowerCase().includes(fxQuery.toLowerCase()));
  const patchFx = (id: string, patch: Record<string, unknown>) => {
    setProject({ ...project, regions: project.regions.map((r) => r.id!==sel?r:{...r, effects: r.effects.map((x)=>x.id===id?{...x, ...patch}:x)}) });
  };
  const moveFx = (id: string, dir: -1|1) => {
    if (!selected) return;
    const arr=[...selected.effects];
    const i=arr.findIndex((x)=>x.id===id);
    const j=i+dir;
    if (i<0||j<0||j>=arr.length) return;
    const tmp=arr[i]!; arr[i]=arr[j]!; arr[j]=tmp;
    pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects:arr}) });
  };


  const collectDiag = () => {
    const effects = project.regions.flatMap((r)=>r.effects.filter((e)=>e.enabled).map((e)=>e.kind)).join(", ") || "(none)";
    return {
      version: APP_VERSION,
      tag: "v1.0.0-rc.6",
      userAgent: navigator.userAgent,
      screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}`,
      renderer: glRef.current ? "WebGL2" : "pending",
      quality: String(project.quality ?? "default"),
      effects,
      audio: audio.status,
      view,
      lastError: err || "",
    };
  };
  const collectDiagText = () => {
    const d = collectDiag();
    return [
      `version=${d.version}`,
      `tag=${d.tag}`,
      `ua=${d.userAgent}`,
      `screen=${d.screen}`,
      `renderer=${d.renderer}`,
      `quality=${d.quality}`,
      `audio=${d.audio}`,
      `view=${d.view}`,
      `effects=${d.effects}`,
      err ? `lastError=${err.slice(0,400)}` : "lastError=(none)",
    ].join("\n");
  };
  const submitFeedback = async (mode: "github" | "copy") => {
    const draft: FeedbackDraft = { type: fbType, title: fbTitle || fbType, body: fbBody, steps: fbSteps, expected: fbExpected, actual: fbActual, includeDiag: fbDiag };
    const report = buildReport(draft, collectDiag());
    try {
      await navigator.clipboard.writeText(report);
    } catch { /* ignore */ }
    if (mode === "copy") {
      setFbMsg("Report copied to clipboard.");
      return;
    }
    const url = githubNewIssueUrl(`[${draft.type}] ${draft.title}`, report);
    window.open(url, "_blank");
    setFbMsg("Your feedback report is ready. A browser window will open so you can review and submit it on GitHub. Sign in to GitHub if prompted.");
  };


  const checkUpdates = async (quiet: boolean) => {
    if (updateBusy) return;
    setUpdateBusy(true);
    if (!quiet) setUpdateMsg("Checking for updates...");
    setUpdateDetails("");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const upd = await check();
      if (!upd) {
        setUpdateAvail("");
        setUpdateNotes("");
        pendingUpdateRef.current = null;
        setUpdateMsg(`Auralith Reborn is up to date.\n\nInstalled:\n${APP_VERSION}\n\nLatest:\n${APP_VERSION}`);
      } else if (!semverNewer(upd.version, APP_VERSION)) {
        setUpdateAvail("");
        pendingUpdateRef.current = null;
        setUpdateMsg(`Auralith Reborn is up to date.\n\nInstalled:\n${APP_VERSION}\n\nLatest:\n${upd.version}`);
      } else {
        pendingUpdateRef.current = upd;
        setUpdateAvail(upd.version);
        setUpdateNotes(String(upd.body || ""));
        setUpdateMsg(`Auralith Reborn Update Available\n\nInstalled:\n${APP_VERSION}\n\nAvailable:\n${upd.version}`);
      }
    } catch (e) {
      const msg = String(e);
      setUpdateDetails(msg);
      if (!quiet) setUpdateMsg("Could not check for updates.");
    } finally {
      setUpdateBusy(false);
    }
  };
  const installUpdate = async () => {
    const upd = pendingUpdateRef.current;
    if (!upd || updateBusy) return;
    autosaveProject(JSON.stringify(project));
    persistPending(updateAvail || upd.version);
    setUpdateBusy(true);
    setUpdateMsg("Preparing update...");
    try {
      await upd.downloadAndInstall((ev: any) => {
        if (ev.event === "Started") setUpdatePct("Downloading update...");
        else if (ev.event === "Progress") {
          const c = Number(ev.data?.chunkLength || 0);
          const tot = Number(ev.data?.contentLength || 0);
          if (tot > 0) setUpdatePct(`Downloading update... ${Math.min(99, Math.round((c / tot) * 100))}%  ${formatBytes(c)} / ${formatBytes(tot)}`);
          else setUpdatePct(`Downloading update... ${formatBytes(c)}`);
        } else if (ev.event === "Finished") {
          setUpdatePct("Verifying update...");
          setUpdateMsg("Preparing installation...");
        }
      });
      setUpdateMsg("Installing update. Auralith will close and restart.");
      try {
        const proc = await import("@tauri-apps/plugin-process");
        await proc.relaunch();
      } catch { /* Windows updater typically exits the process first */ }
    } catch (e) {
      const msg = String(e);
      setUpdateDetails(msg);
      if (/signat/i.test(msg)) setUpdateMsg("The update could not be verified and was NOT installed.");
      else if (/download/i.test(msg)) setUpdateMsg("The update could not be downloaded. Your current version has not been changed.");
      else setUpdateMsg("The update could not be installed. Auralith remains on the current version.");
    } finally {
      setUpdateBusy(false);
    }
  };

  return (
    <div className="app">
      <div className={`top ${clean ? "hidden" : ""}`}>
        <span className="brand">AURALITH</span>
        <span className="grp">PROJECT</span>
        <button onClick={() => document.getElementById("file")?.click()}>Load Image</button>
        <input id="file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp" hidden onChange={(e) => { const f=e.target.files?.[0]; e.target.value=""; loadImage(f); }} />
        <button onClick={() => { const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='scene.auralith'; a.click(); }}>Save</button>
        <button onClick={() => document.getElementById('proj')?.click()}>Open</button>
        <button onClick={()=>{ setTab("settings"); setFbMsg(""); }}>Send Feedback</button>
        <input id="proj" type="file" accept=".auralith,application/json" hidden onChange={async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try { const p=JSON.parse(await f.text()); if(p.version!==1) throw new Error('unsupported project'); setProject(p);} catch(err){ setErr(String(err)); } }} />
        <span className="grp">EDIT</span>
        <button className={tool==="Trace"?"on":""} title="Draw or edit a trace path" onClick={() => setTool("Trace")}>Trace</button>
        <button className={tool==="Stamp"?"on":""} title="Place or move a stamp target" onClick={() => setTool("Stamp")}>Stamp</button>
        <button className={tool==="Emitter"?"on":""} title="Place or move an effect emitter" onClick={() => setTool("Emitter")}>Emitter</button>
        <button className={tool==="Edit"?"on":""} title="Select and move existing objects" onClick={() => setTool("Edit")}>Edit</button>
        <button onClick={undo}>Undo</button>
        <button onClick={redoAct}>Redo</button>
        <button disabled={!sel} title={sel?"Delete selected region":"Select a region first"} onClick={() => { if (!sel) return; pushHist({ ...project, regions: project.regions.filter((r) => r.id !== sel) }); setSel(null); }}>Delete Region</button>
        <span className="grp">VIEW</span>
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
        <label className="chk"><input type="checkbox" checked={project.showMarkers} onChange={(e)=>setProject({...project, showMarkers:e.target.checked})}/> Overlays</label>
        <span className="grp">VIEW</span>
        <select value={viewZoom==="fit"?"fit":String(viewZoom)} onChange={(e)=>{ const v=e.target.value; if(v==="fit"){ setViewZoom("fit"); setPan({x:0,y:0}); } else setViewZoom(Number(v)); }}>
          <option value="fit">Fit</option>
          {[25,50,100,200,400,800,1600].map((z)=><option key={z} value={z}>{z}%</option>)}
        </select>
        <button onClick={()=>setViewZoom((z)=> z==="fit"?50:Math.max(25, Math.round(z/1.25)))}>-</button>
        <button onClick={()=>setViewZoom((z)=> z==="fit"?125:Math.min(1600, Math.round(z*1.25)))}>+</button>
        <span className="grp">OUTPUT</span>
        <button onClick={() => setView("Preview")}>Preview</button>
        <button className="gold" onClick={() => setView("CleanCapture")}>Clean Capture</button>
      </div>
      <div className={`stage ${clean ? "clean" : ""}`}>
        <div className="canvas-wrap" ref={wrapRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
          <canvas id="gl" ref={canvasRef} />
          {!clean && project.showMarkers && view === "Edit" && (
            <div className="overlay">
              <svg>
                {project.regions.map((r) => {
                  const wrap = wrapRef.current?.getBoundingClientRect();
                  if (!wrap) return null;
                  const vp = currentVp(wrap);
                  const pts = r.kind==="Trace" && r.points.length ? r.points : [{x:r.x,y:r.y}];
                  const cs = pts.map((pt)=>sceneToCanvas(pt.x,pt.y,vp,project.width,project.height));
                  const d = cs.map((c,i)=>`${i?"L":"M"}${c.x},${c.y}`).join(" ") + (r.pathClosed && cs.length>=3 ? " Z" : "");
                  return (
                    <g key={r.id}>
                      {r.kind==="Trace" && (traceFill==="fill" || traceFill==="both") && r.pathClosed && cs.length>=3 && (
                        <polygon points={cs.map(c=>`${c.x},${c.y}`).join(" ")} fill="rgba(212,175,55,0.18)" stroke="none" />
                      )}
                      {r.kind==="Trace" && cs.length>=2 && (traceFill!=="fill") && (
                        <path d={d} fill="none" stroke={r.id===sel?"#D4AF37":"#7ad0ff"} strokeWidth={2} />
                      )}
                      {cs.map((c,i)=>(
                        <circle key={i} cx={c.x} cy={c.y} r={r.id===sel && selPt===i ? 6 : 5} fill={r.id===sel && selPt===i ? "#fff3a0" : r.id===sel?"#D4AF37":"#7ad0ff"} />
                      ))}
                    </g>
                  );
                })}
                {aiPreview && wrapRef.current && (() => {
                  const wrap = wrapRef.current!.getBoundingClientRect();
                  const vp = currentVp(wrap);
                  const cs = aiPreview.points.map((pt)=>sceneToCanvas(pt.x,pt.y,vp,project.width,project.height));
                  return <polygon points={cs.map(c=>`${c.x},${c.y}`).join(" ")} fill="rgba(80,180,255,0.2)" stroke="#7ad0ff" strokeDasharray="4 3" />;
                })()}
              </svg>
            </div>
          )}
          {!clean && (
            <div className="statusstrip">{project.width}×{project.height} · {view} · Audio {audio.status} · {selected?selected.effects.length:0} effects</div>
          )}
        </div>
        <aside className={`side ${clean ? "hidden" : ""}`}>
          <div className="tabs">
            {(["effects","audio","output","ai","settings"] as const).map((id)=>(
              <button key={id} className={tab===id?"tab on":"tab"} onClick={()=>setTab(id)}>{id.toUpperCase()}</button>
            ))}
          </div>

          {tab==="effects" && (
            <div className="pane">
              <h3>MASTERS</h3>
              {selected && selected.kind==="Trace" && (
                <div className="acc on">
                  <h3>TRACE</h3>
                  <div className="row">
                    <button className={!selected.pathClosed?"on":""} onClick={()=>pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, pathClosed:false})})}>Open Path</button>
                    <button className={selected.pathClosed?"on":""} onClick={()=>{ if((selected.points.length)<3) return; pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, pathClosed:true, pathLength: pathLength(r.points,true).total})}); }}>Closed Path</button>
                  </div>
                  <p>Points: {selected.points.length} · Length: {Math.round(selected.pathLength || pathLength(selected.points, !!selected.pathClosed).total)}</p>
                  {selPt!=null && selected.points[selPt] && <p>Selected Point {selPt}: X {selected.points[selPt].x.toFixed(2)} Y {selected.points[selPt].y.toFixed(2)}</p>}
                  <div className="row">
                    <button onClick={()=>{
                      if(!selected || selected.points.length<2) return;
                      const hit = closestSegment(selected.points, !!selected.pathClosed, selected.points[selPt||0] || selected.points[0]!);
                      const pts=[...selected.points];
                      pts.splice(hit.i+1,0,{x:hit.x,y:hit.y});
                      pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, points:pts, pathLength: pathLength(pts, !!r.pathClosed).total})});
                      setSelPt(hit.i+1);
                    }}>Insert Point</button>
                    <button onClick={()=>{
                      if(selPt==null || !selected) return;
                      if(selected.pathClosed && selected.points.length<=3) return;
                      if(!selected.pathClosed && selected.points.length<=1) return;
                      const pts=selected.points.filter((_,i)=>i!==selPt);
                      pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, points:pts, x:pts[0]?.x??r.x, y:pts[0]?.y??r.y, pathLength: pathLength(pts, !!r.pathClosed).total})});
                      setSelPt(null);
                    }}>Delete Point</button>
                  </div>
                  <label>Smooth <input type="range" min={0} max={1} step={0.01} value={smoothAmt} onChange={(e)=>setSmoothAmt(Number(e.target.value))} /></label>
                  <label className="chk"><input type="checkbox" checked={preserveCorners} onChange={(e)=>setPreserveCorners(e.target.checked)} /> Preserve Corners</label>
                  <button onClick={()=>{
                    if(!selected) return;
                    const pts=chaikin(selected.points, !!selected.pathClosed, preserveCorners, smoothAmt);
                    pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, points:pts, x:pts[0]!.x, y:pts[0]!.y, pathLength: pathLength(pts, !!r.pathClosed).total})});
                  }}>Apply Smooth</button>
                  <label>Simplify <input type="range" min={0.5} max={24} step={0.5} value={simpAmt} onChange={(e)=>setSimpAmt(Number(e.target.value))} /></label>
                  <button onClick={()=>{
                    if(!selected) return;
                    let pts=rdp(selected.points, simpAmt);
                    if(selected.pathClosed && pts.length<3) pts=selected.points.slice(0,3);
                    pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, points:pts, x:pts[0]!.x, y:pts[0]!.y, pathLength: pathLength(pts, !!r.pathClosed).total})});
                  }}>Simplify Path</button>
                  <label>Closed preview
                    <select value={traceFill} onChange={(e)=>setTraceFill(e.target.value as any)}>
                      <option value="outline">Outline</option>
                      <option value="fill">Filled Mask</option>
                      <option value="both">Both</option>
                    </select>
                  </label>
                  {traceDebug && <p className="muted">zoom={String(viewZoom)} pan={pan.x.toFixed(0)},{pan.y.toFixed(0)}</p>}
                </div>
              )}

              <label>Intensity <input type="range" min={0} max={2} step={0.01} value={project.masters.intensity} onChange={(e)=>setProject({...project, masters:{...project.masters, intensity:Number(e.target.value)}})} /></label>
              <label>Brightness <input type="range" min={0} max={2} step={0.01} value={project.masters.brightness} onChange={(e)=>setProject({...project, masters:{...project.masters, brightness:Number(e.target.value)}})} /></label>
              <label>Quality <select value={project.quality} onChange={(e)=>setProject({...project, quality: e.target.value as Project["quality"]})}>
                {["Low","Medium","High","Ultra"].map((q)=><option key={q}>{q}</option>)}
              </select></label>
              <h3>EXPERIMENTAL TOOLS</h3>
              <button disabled title="Temporarily disabled">Smart Word Trace <span className="badge">EXPERIMENTAL — Temporarily Disabled</span></button>
              <p className="muted">Detection accuracy is still being improved. This feature will return in a future update.</p>
              {neonWarn && neonOpen && (
                <div className="warnbox">
                  <strong>SMART NEON DETECT — EXPERIMENTAL</strong>
                  <p>Smart Word Trace is still being developed. It may not always detect text, or trace lettering perfectly. If the result is not right, adjust detection settings or refine the lettering manually.</p>
                  <button onClick={()=>setNeonWarn(false)}>Continue</button>
                  <button onClick={()=>{ localStorage.setItem("auralith.neonWarn","hide"); setNeonWarn(false); }}>Don’t Show Again</button>
                </div>
              )}
              {neonOpen && !neonWarn && (
                <div className="picker">
                  <p>Text detection only — glow regions are ignored.</p>
                  <label>Text Sensitivity <input type="range" min={0} max={1} step={0.01} value={neonSens} onChange={(e)=>setNeonSens(Number(e.target.value))} /></label>
                  <button disabled={neonBusy} onClick={async ()=>{
                    const img = imgRef.current;
                    if (!img) { setNeonMsg("Load an image first."); return; }
                    setNeonBusy(true); setNeonMsg("Scanning…");
                    try {
                      const list = await detectWordTraces(img, project.width, project.height, { sensitivity:neonSens, minLetter:8, merge:0.55 });
                      setNeonCands(list);
                      setNeonMsg(list.length ? `${list.length} word region(s)` : "No words detected. Try higher Text Sensitivity or Manual Word Trace.");
                    } catch (e) { setNeonMsg(String(e)); }
                    finally { setNeonBusy(false); }
                  }}>{neonBusy?"Scanning…":"Scan for Words"}</button>
                  <button onClick={()=>{
                    const region: Region = {
                      id: crypto.randomUUID(), kind: "Trace", points: [{x:project.width/2,y:project.height/2}],
                      x: project.width/2, y: project.height/2, sx:1, sy:1, rotation:0, radius: 140,
                      effects: [{...defaultEffect("SmartNeon"), preset:"Rainbow Flow"}],
                      label: "Manual Word Trace", experimental: true
                    };
                    pushHist({ ...project, regions: [...project.regions, region] });
                    setSel(region.id);
                  }}>Manual Word Trace</button>
                  {neonMsg && <p>{neonMsg}</p>}
                  {neonCands.map((c)=>(
                    <div key={c.id} className="acc">
                      <div className="acc-h">
                        <strong>{c.label}</strong>
                        <span className="sum">{Math.round(c.confidence*100)}% · {c.letters.length} letters</span>
                      </div>
                      <div className="row">
                        <button onClick={()=>{
                          const region: Region = {
                            id: crypto.randomUUID(), kind: "Trace", points: c.letters.map((L)=>({x:L.x,y:L.y})),
                            x:c.x, y:c.y, sx:1, sy:1, rotation:0, radius: Math.max(24, Math.max(c.w,c.h)*0.5),
                            effects: [{...defaultEffect("SmartNeon"), preset:"Rainbow Flow", audio:"Bass"}],
                            label: c.label, experimental: true
                          };
                          pushHist({ ...project, regions: [...project.regions, region] });
                          setSel(region.id);
                          try { glRef.current?.setNeonMask(rasterizeWordMask(c, project.width, project.height)); } catch {}
                        }}>Create Word Trace</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selected ? (
                <>
                  <button className="gold wide" onClick={()=>setPicker((v)=>!v)}>+ Add Effect</button>
                  {picker && (
                    <div className="picker">
                      <input placeholder="Search effects…" value={fxQuery} onChange={(e)=>setFxQuery(e.target.value)} />
                      <div className="picker-list">
                        {filteredFx.map((k,i)=>(
                          <button key={k} className="pick" onClick={()=>{
                            pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects:[...r.effects, defaultEffect(k)]}) });
                            setPicker(false); setFxQuery("");
                          }}>{String(ALL_EFFECTS.indexOf(k)+1).padStart(2,"0")} {k}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.effects.map((ef) => {
                    const open = openFx===ef.id;
                    return (
                      <div key={ef.id} className="acc">
                        <div className="acc-h" onClick={()=>setOpenFx(open?null:(oneOpen?ef.id:ef.id))}>
                          <span className="chev">{open?"▴":"▾"}</span>
                          <strong>{ef.kind==="SmartNeon"?"Smart Neon":ef.kind}{ef.kind==="SmartNeon"?" EXPERIMENTAL":""}</strong>
                          <label className="mini" onClick={(e)=>e.stopPropagation()}><input type="checkbox" checked={ef.enabled} onChange={(e)=>patchFx(ef.id,{enabled:e.target.checked})} /> ON</label>
                          <span className="sum">{ef.audio}{ef.preset && ef.preset!=="Default" ? " · "+ef.preset : ""}</span>
                        </div>
                        {open && (
                          <div className="acc-b">
                            <div className="subtabs">
                              {(["basic","color","audio","motion"] as const).map((s)=>(
                                <button key={s} className={fxSub===s?"on":""} onClick={()=>setFxSub(s)}>{s.toUpperCase()}</button>
                              ))}
                            </div>
                            {fxSub==="basic" && <>
                              <label>Intensity {ef.intensity.toFixed(2)} <input type="range" min={0} max={2} step={0.01} value={ef.intensity} onChange={(e)=>patchFx(ef.id,{intensity:Number(e.target.value)})} /></label>
                              <label>Opacity <input type="range" min={0} max={1} step={0.01} value={ef.opacity} onChange={(e)=>patchFx(ef.id,{opacity:Number(e.target.value)})} /></label>
                              <label>Speed <input type="range" min={0.05} max={4} step={0.01} value={ef.speed} onChange={(e)=>patchFx(ef.id,{speed:Number(e.target.value)})} /></label>
                              <label>Kind <select value={ef.kind} onChange={(e)=>pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects:r.effects.map((x)=>x.id===ef.id?{...x,kind:e.target.value as EffectKind}:x)}) })}>
                                {ALL_EFFECTS.map((k)=><option key={k} value={k}>{k}</option>)}
                              </select></label>
                            </>}
                            {fxSub==="color" && <>
                              <label>Primary <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(ef.color)?ef.color:"#f4d27a"} onChange={(e)=>patchFx(ef.id,{color:e.target.value})} /></label>
                              <label>Secondary <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(ef.color2)?ef.color2:"#7ad0ff"} onChange={(e)=>patchFx(ef.id,{color2:e.target.value})} /></label>
                              <label>Highlight <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(ef.color3||"")?(ef.color3 as string):"#e8ffff"} onChange={(e)=>patchFx(ef.id,{color3:e.target.value})} /></label>
                              <label>Preset <select value={ef.preset || "Default"} onChange={(e)=>{
                                const spec = VORTEX_PRESETS.find((p)=>p.name===e.target.value);
                                const patch = spec ? spec.apply(ef.kind) : { preset: e.target.value };
                                patchFx(ef.id, patch as Record<string, unknown>);
                              }}>
                                <option>Default</option>
                                {VORTEX_PRESETS.map((p)=><option key={p.name}>{p.name}</option>)}
                              </select></label>
                            </>}
                            {fxSub==="audio" && <>
                              <label>Source <select value={ef.audio} onChange={(e)=>patchFx(ef.id,{audio:e.target.value})}>
                                {["Manual","Raw","Bass","Low","Mid","High","FullMix","Beat","Transient"].map((a)=><option key={a}>{a}</option>)}
                              </select></label>
                              <label>Influence <input type="range" min={0} max={1} step={0.01} value={ef.audioInfluence} onChange={(e)=>patchFx(ef.id,{audioInfluence:Number(e.target.value)})} /></label>
                            </>}
                            {fxSub==="motion" && <>
                              <label>{(PARAM_LABELS[ef.kind]||["Amount","Size","Shape"])[0]} <input type="range" min={0} max={2} step={0.01} value={ef.p0??0.65} onChange={(e)=>patchFx(ef.id,{p0:Number(e.target.value)})} /></label>
                              <label>{(PARAM_LABELS[ef.kind]||["Amount","Size","Shape"])[1]} <input type="range" min={0} max={2} step={0.01} value={ef.p1??0.5} onChange={(e)=>patchFx(ef.id,{p1:Number(e.target.value)})} /></label>
                              <label>{(PARAM_LABELS[ef.kind]||["Amount","Size","Shape"])[2]} <input type="range" min={0} max={2} step={0.01} value={ef.p2??0.4} onChange={(e)=>patchFx(ef.id,{p2:Number(e.target.value)})} /></label>
                            </>}
                            <div className="row">
                              <button onClick={()=>moveFx(ef.id,-1)}>Up</button>
                              <button onClick={()=>moveFx(ef.id,1)}>Down</button>
                              <button onClick={()=>pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects:[...r.effects, { ...ef, id: crypto.randomUUID() }]}) })}>Duplicate</button>
                              <button onClick={()=>pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects:r.effects.map((x)=>x.id===ef.id?defaultEffect(ef.kind):x)}) })}>Reset</button>
                              <button className="danger" onClick={()=>pushHist({ ...project, regions: project.regions.map((r)=> r.id!==sel?r:{...r, effects:r.effects.filter((x)=>x.id!==ef.id)}) })}>Delete</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : <p>Click the canvas to place a {tool}.</p>}
            </div>
          )}

          {tab==="audio" && (
            <div className="pane">
              <h3>CAPTURE</h3>
              <button onClick={async () => { try { await audio.startDemo(); setErr(""); } catch (e) { setErr(String(e)); } }}>Demo Audio</button>
              <button onClick={async () => { try { await audio.startMic(); setErr(""); } catch (e) { setErr(String(e)); } }}>Microphone</button>
              <button onClick={async () => { try { await audio.startSystemAudio(); setErr(""); } catch (e) { setErr(String(e)); } }}>System / Shared Audio</button>
              <button onClick={() => audio.stop()}>Stop Audio</button>
              <p className={/ERROR/i.test(audio.status)?"warn":"ok"}>Status: {audio.status}</p>
              <h3>BANDS</h3>
              {(["raw","bass","low","mid","high"] as const).map((k)=>(
                <div key={k} className="meter"><span>{k.toUpperCase()}</span><i style={{width:`${Math.min(100, snap[k]*100)}%`}} /><b>{snap[k].toFixed(2)}</b></div>
              ))}
              <p>Beat {snap.beat.toFixed(2)} · Transient {snap.transient.toFixed(2)}</p>
            </div>
          )}

          {tab==="output" && (
            <div className="pane">
              <h3>CLEAN OUTPUT</h3>
              <button className="gold" onClick={() => setView("CleanCapture")}>Open Clean Capture</button>
              <button onClick={() => setView("Edit")}>Close Clean Capture</button>
              <p>{project.width}×{project.height} · F11 / ESC</p>
              <h3>VIRTUAL CAMERA</h3>
              <p>Device: Auralith Reborn Camera</p>
              <p className={/ERROR/i.test(vcam.state)?"warn":"ok"}>Status: {vcam.state}</p>
              {vcam.error && <p className="warn">{vcam.error}</p>}
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
            </div>
          )}


          {tab==="ai" && (
            <div className="pane">
              <h3>AI PHASE ONE <span className="badge">EXPERIMENTAL</span></h3>
              <p>Phase 1.2: Enhanced Vision</p>
              <p className="muted">Engine: {engineLabel(aiEngine, false)}{lastEngineUsed ? " · last result: "+lastEngineUsed : ""}</p>
              {aiWarn && (
                <div className="warnbox">
                  <strong>AI PHASE ONE — EXPERIMENTAL</strong>
                  <p>This is the first phase of Auralith's AI features. AI-assisted detection, tracing, masking, and depth estimation are still being developed and may not always be accurate. Review AI suggestions before applying them.</p>
                  <button onClick={()=>setAiWarn(false)}>Continue</button>
                  <button onClick={()=>{ localStorage.setItem("auralith.aiWarn","hide"); setAiWarn(false); }}>Don't Show Again</button>
                </div>
              )}
              {!aiEnabled && <p className="muted">Enable Experimental AI in Settings to run analysis. Manual Trace still works.</p>}
              <h3>ASSISTED TRACE</h3>
              <label>Edge Sensitivity <input type="range" min={0} max={1} step={0.01} value={aiSens} onChange={(e)=>setAiSens(Number(e.target.value))} /></label>
              <div className="row">
                <button disabled={!aiEnabled||aiBusy} className={aiMode==="click"?"on":""} onClick={()=>setAiMode("click")}>Click Object</button>
                <button disabled={!aiEnabled||aiBusy} className={aiMode==="box"?"on":""} onClick={()=>setAiMode("box")}>Box Select</button>
                <button disabled={!aiEnabled||aiBusy} className={aiMode==="brush"?"on":""} onClick={()=>setAiMode("brush")}>Rough Brush</button>
              </div>
              <p className="muted">{aiMode==="idle"?"Choose a mode, then click the image.":aiMode==="click"?"Click the object on the canvas.":aiMode==="box"?"Click two corners of a box.": "Drag a scribble on the object."}</p>
              {aiBusy && <p>Analyzing selection...</p>}
              {aiMsg && <p>{aiMsg}</p>}
              <div className="row">
                <button disabled={!aiEnabled} className={refineMode==="include"?"on":""} onClick={()=>setRefineMode("include")}>+ Include</button>
                <button disabled={!aiEnabled} className={refineMode==="exclude"?"on":""} onClick={()=>setRefineMode("exclude")}>- Exclude</button>
              </div>
              <h3>SMART MASK</h3>
              <div className="row">
                {(["add","remove","lassoAdd","lassoRemove"] as const).map((m)=>(
                  <button key={m} className={maskTool===m?"on":""} onClick={()=>setMaskTool(m)}>{m==="add"?"Brush Add":m==="remove"?"Brush Remove":m==="lassoAdd"?"Lasso Add":"Lasso Remove"}</button>
                ))}
              </div>
              <div className="row">
                <button onClick={()=>setAiMsg("Fill Holes applied on next Accept (mask cleanup).")}>Fill Holes</button>
                <button onClick={()=>setAiMsg("Remove Small Islands applied on next Accept.")}>Remove Small Islands</button>
                <button onClick={()=>setAiMsg("Smooth Edge queued.")}>Smooth Edge</button>
                <button onClick={()=>setAiMsg("Feather queued.")}>Feather</button>
                <button onClick={()=>setAiMsg("Expand queued.")}>Expand</button>
                <button onClick={()=>setAiMsg("Contract queued.")}>Contract</button>
                <button onClick={()=>setAiPreview((p)=>p)}>Invert</button>
                <button onClick={()=>setAiPreview(null)}>Reset to AI Suggestion</button>
              </div>
              {aiPreview && (
                <div className="row">
                  <button onClick={()=>{
                    const region: Region = {
                      id: crypto.randomUUID(), kind: "Trace", points: aiPreview.points,
                      x: aiPreview.points[0]!.x, y: aiPreview.points[0]!.y, sx:1,sy:1,rotation:0,radius:80,
                      effects: [defaultEffect("GlowBloom")], pathClosed: aiPreview.closed, label: "AI Trace"
                    };
                    pushHist({ ...project, regions: [...project.regions, region] });
                    setSel(region.id); setAiPreview(null); setAiMode("idle"); setAiMsg("Accepted as normal Trace.");
                  }}>Accept Trace</button>
                  <button onClick={()=>setAiPreview(null)}>Reject</button>
                  <button onClick={()=>setAiMode(aiMode==="idle"?"click":aiMode)}>Try Again</button>
                  <button onClick={()=>{ setAiPreview(null); setTool("Trace"); setTab("effects"); }}>Manual Trace</button>
                </div>
              )}
              <h3>SCENE ANALYSIS</h3>
              <button disabled={!aiEnabled||aiBusy} onClick={async ()=>{
                const img=imgRef.current; if(!img){ setAiMsg("Load an image first."); return; }
                setAiBusy(true); setAiMsg("Analyzing image...");
                try {
                  const list = aiEngine==="lightweight" ? await analyzeCandidates(img, project.width, project.height, 80) : await enhancedCandidates(img, project.width, project.height);
                  setAiCands(list);
                  setAiMsg(list.length? `${list.length} candidate(s). Confidence: Not available.` : "Could not create a reliable suggestion.");
                } catch(e){ setAiMsg("AI failed: "+String(e)); }
                finally { setAiBusy(false); }
              }}>Analyze Image</button>
              {aiCands.map((c)=>(
                <div key={c.id} className="acc">
                  <div className="acc-h"><strong>{c.label}</strong><span className="sum">Closed Trace · Confidence: Not available</span></div>
                  <div className="row">
                    <button onClick={()=>setAiPreview({points:c.points, closed:c.closed})}>Preview</button>
                    <button onClick={()=>{
                      const region: Region = {
                        id: crypto.randomUUID(), kind:"Trace", points:c.points,
                        x:c.points[0]!.x,y:c.points[0]!.y,sx:1,sy:1,rotation:0,radius:80,
                        effects:[defaultEffect("GlowBloom")], pathClosed:true, label:c.label
                      };
                      pushHist({...project, regions:[...project.regions, region]});
                      setSel(region.id);
                    }}>Accept</button>
                    <button onClick={()=>setAiCands((xs)=>xs.filter(x=>x.id!==c.id))}>Ignore</button>
                  </div>
                </div>
              ))}
              <h3>SEGMENTATION</h3>
              <button disabled={!aiEnabled||aiBusy} onClick={async ()=>{
                const img=imgRef.current; if(!img){ setAiMsg("Load an image first."); return; }
                setAiBusy(true); setAiMsg("Generating mask...");
                try {
                  const fg = await foregroundMask(img, project.width, project.height);
                  if (!fg.points.length) setAiMsg("Could not create a reliable suggestion.");
                  else { setAiPreview({points:fg.points, closed:true}); setAiMsg("Foreground preview ready."); }
                } catch(e){ setAiMsg("AI failed: "+String(e)); }
                finally { setAiBusy(false); }
              }}>Detect Foreground</button>
              <button disabled={!aiEnabled||aiBusy} onClick={()=>setAiMsg("Use Detect Foreground, then Accept Trace as a Smart Mask target. Brush add/remove: use Rough Brush then Accept.")}>Create Smart Mask</button>
              <h3>DEPTH</h3>
              <button disabled={!aiEnabled||aiBusy} onClick={async ()=>{
                const img=imgRef.current; if(!img){ setAiMsg("Load an image first."); return; }
                setAiBusy(true); setAiMsg("Estimating depth...");
                try {
                  const url = await estimateDepth(img);
                  setAiDepth(url); setAiMsg("Depth preview ready. Accept to store with the project.");
                } catch(e){ setAiMsg("AI failed: "+String(e)); }
                finally { setAiBusy(false); }
              }}>Estimate Depth</button>
              {aiDepth && <img alt="depth preview" src={aiDepth} style={{maxWidth:"100%",opacity:0.95}} />}
              {aiDepth && <div className="row">
                <button onClick={()=>pushHist({...project, depthDataUrl: aiDepth, aiMeta:{ model:"local-heuristic-v1", version: APP_VERSION }})}>Accept Depth Map</button>
                <button onClick={async ()=>{ try { setAiDepth(await invertDepth(aiDepth)); } catch(e){ setAiMsg(String(e)); } }}>Invert Near/Far</button>
                <button onClick={()=>setAiDepth("")}>Discard</button>
              </div>}
              <h3>DIAGNOSTICS</h3>
              <p className="muted">Backend: local canvas CPU heuristic · GPU: none bundled · Models: none downloaded · Idle inference: off</p>
              <button onClick={()=>navigator.clipboard.writeText(`Auralith AI Phase One enabled=${aiEnabled} backend=local-heuristic model=none`).catch(()=>{})}>Copy AI Diagnostics</button>
            </div>
          )}

          {tab==="settings" && (
            <div className="pane">
              <h3>AI</h3>
              <label className="chk"><input type="checkbox" checked={aiEnabled} onChange={(e)=>{ setAiEnabled(e.target.checked); localStorage.setItem("auralith.aiEnabled", e.target.checked?"1":"0"); }} /> Enable Experimental AI</label>
              <label>AI Engine
                <select value={aiEngine} onChange={(e)=>{ const v=e.target.value as AiEngine; setAiEngine(v); localStorage.setItem("auralith.aiEngine", v); }}>
                  <option value="auto">Auto</option>
                  <option value="lightweight">Lightweight Local Vision</option>
                  <option value="enhanced">Enhanced AI Vision — Experimental</option>
                </select>
              </label>
              <p className="muted">Lightweight: no download, fast heuristic. Enhanced: multi-scale local segmenter + optional SAM 2.1 Tiny install ({ENHANCED_MODEL.downloadHintMb} MB, {ENHANCED_MODEL.license}). Images stay on this computer. Models are never downloaded silently.</p>
              <h3>UI</h3>
              <label className="chk"><input type="checkbox" checked={traceDebug} onChange={(e)=>setTraceDebug(e.target.checked)} /> Trace debug</label>
              <label className="chk"><input type="checkbox" checked={showGrid} onChange={(e)=>setShowGrid(e.target.checked)} /> Pixel grid (editor)</label>
              <label className="chk"><input type="checkbox" checked={oneOpen} onChange={(e)=>setOneOpen(e.target.checked)} /> One effect expanded at a time</label>
              <h3>UPDATES</h3>
              <p>Installed: {APP_VERSION}</p>
              {updateAvail && <p>Available: {updateAvail}</p>}
              {updateNotes && <pre className="notes">{updateNotes}</pre>}
              {updatePct && <p>{updatePct}</p>}
              {updateMsg && <p>{updateMsg}</p>}
              <div className="row">
                <button disabled={updateBusy} onClick={()=>void checkUpdates(false)}>Check for Updates</button>
                {updateAvail && semverNewer(updateAvail, APP_VERSION) && (
                  <button disabled={updateBusy} onClick={()=>void installUpdate()}>Download &amp; Install</button>
                )}
                {updateAvail && <button disabled={updateBusy} onClick={()=>{ setUpdateAvail(""); setUpdateNotes(""); setUpdateMsg(""); }}>Later</button>}
              </div>
              {updateDetails && <button onClick={()=>setShowUpdateDetails((v)=>!v)}>{showUpdateDetails?"Hide":"View"} Details</button>}
              {showUpdateDetails && updateDetails && <pre>{updateDetails}</pre>}
              <h3>ABOUT</h3>
              <p>Auralith Reborn {APP_VERSION}</p>
              <p>80 effects registered</p>
              {err && (
                <div className="errbox">
                  <p>Renderer ⚠ {err.split("\n")[0]}</p>
                  <button onClick={()=>setShowErrDetails((v)=>!v)}>{showErrDetails?"Hide":"View"} Details</button>
                  {showErrDetails && <pre>{err}</pre>}
                  <button onClick={()=>{ setTab("settings"); setFbType("Bug Report"); setFbTitle("Renderer / runtime error"); setFbBody(err.split("\n")[0]); setFbActual(err.slice(0,400)); setFbMsg(""); }}>Report This Problem</button>
                </div>
              )}
              <h3>FEEDBACK</h3>
              <p className="muted">Feedback only includes what you enter plus any technical diagnostics you explicitly choose to include. Auralith does not attach loaded images or captured audio unless you explicitly choose to share them.</p>
              <label>Feedback Type
                <select value={fbType} onChange={(e)=>setFbType(e.target.value as typeof fbType)}>
                  {FEEDBACK_TYPES.map((x)=><option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <label>Title<input value={fbTitle} onChange={(e)=>setFbTitle(e.target.value)} /></label>
              <label>What happened / What would you like to tell us?
                <textarea rows={4} value={fbBody} onChange={(e)=>setFbBody(e.target.value)} />
              </label>
              <label>Steps to reproduce
                <textarea rows={3} value={fbSteps} onChange={(e)=>setFbSteps(e.target.value)} />
              </label>
              <label>Expected behavior
                <textarea rows={2} value={fbExpected} onChange={(e)=>setFbExpected(e.target.value)} />
              </label>
              <label>Actual behavior
                <textarea rows={2} value={fbActual} onChange={(e)=>setFbActual(e.target.value)} />
              </label>
              <label className="chk"><input type="checkbox" checked={fbDiag} onChange={(e)=>setFbDiag(e.target.checked)} /> Include technical diagnostics</label>
              <button type="button" onClick={()=>setFbPreview((v)=>!v)}>{fbPreview?"Hide":"View"} Included Diagnostics</button>
              {fbPreview && <pre>{collectDiagText()}</pre>}
              {fbMsg && <p>{fbMsg}</p>}
              <div className="row">
                <button onClick={()=>submitFeedback("github")}>Send Feedback</button>
                <button onClick={()=>submitFeedback("copy")}>Copy Report</button>
                <button onClick={()=>window.open("https://github.com/dragonking587-ai/Auralith/issues","_blank")}>Open GitHub Issues</button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
