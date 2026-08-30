import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AudioEngine } from "../audio/engine";
import { ALL_EFFECTS, defaultEffect, newProject, type EffectKind, type Project, type Region, type ViewMode } from "../scene/types";
import { VORTEX_PRESETS } from "../scene/presets";
import { canvasToScene, sceneToCanvas, sceneViewport } from "../scene/transform";
import { detectWordTraces, rasterizeWordMask, type WordCandidate } from "../scene/smartNeon";
import { FEEDBACK_TYPES, buildReport, githubNewIssueUrl, type FeedbackDraft } from "../scene/feedback";
import { semverNewer, formatBytes, persistPending, takePending, autosaveProject } from "../scene/updater";
import { GlRenderer } from "../render/renderer";

const audio = new AudioEngine();
const APP_VERSION = "1.0.0-rc.3";
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
  const [tab, setTab] = useState<"effects"|"audio"|"output"|"settings">("effects");
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
      if (e.key === "Escape") setView("Edit");
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

  const sceneFromEvent = (e: { clientX: number; clientY: number }) => {
    const wrap = wrapRef.current!;
    const rect = wrap.getBoundingClientRect();
    const proj = projectRef.current;
    const vp = sceneViewport(rect.width, rect.height, proj.width, proj.height, proj.fit);
    return canvasToScene(e.clientX - rect.left, e.clientY - rect.top, vp, proj.width, proj.height);
  };
  const hitRegion = (e: { clientX: number; clientY: number }) => {
    const wrap = wrapRef.current; if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const proj = projectRef.current;
    const vp = sceneViewport(rect.width, rect.height, proj.width, proj.height, proj.fit);
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const r of proj.regions) {
      const c = sceneToCanvas(r.x, r.y, vp, proj.width, proj.height);
      const d = Math.hypot(c.x - px, c.y - py);
      if (d <= 16 && (!best || d < best.d)) best = { id: r.id, d };
    }
    return best?.id ?? null;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (view === "CleanCapture") return;
    const wrap = wrapRef.current; if (!wrap) return;
    const hit = hitRegion(e);
    if (hit) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const s = sceneFromEvent(e);
      const r = projectRef.current.regions.find((x) => x.id === hit)!;
      dragRef.current = { id: hit, ox: r.x, oy: r.y, sx: s.x, sy: s.y, moved: false };
      setSel(hit);
      return;
    }
    if (toolRef.current === "Edit") return;
    const s = sceneFromEvent(e);
    const kind = toolRef.current === "Trace" || toolRef.current === "Stamp" || toolRef.current === "Emitter" ? toolRef.current : "Emitter";
    const region: Region = {
      id: crypto.randomUUID(), kind, points: [{ x: s.x, y: s.y }],
      x: s.x, y: s.y, sx: 1, sy: 1, rotation: 0, radius: 80,
      effects: [defaultEffect("GlowBloom")]
    };
    pushHist({ ...projectRef.current, regions: [...projectRef.current.regions, region] });
    setSel(region.id);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const s = sceneFromEvent(e);
    const dx = s.x - d.sx, dy = s.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    const nx = Math.max(0, Math.min(projectRef.current.width, d.ox + dx));
    const ny = Math.max(0, Math.min(projectRef.current.height, d.oy + dy));
    setProject({
      ...projectRef.current,
      regions: projectRef.current.regions.map((r) => r.id !== d.id ? r : { ...r, x: nx, y: ny, points: r.points.map((p, i) => i === 0 ? { x: nx, y: ny } : p) })
    });
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.moved) return;
    const cur = projectRef.current;
    const before = { ...cur, regions: cur.regions.map((r) => r.id !== d.id ? r : { ...r, x: d.ox, y: d.oy, points: r.points.map((p, i) => i === 0 ? { x: d.ox, y: d.oy } : p) }) };
    setHistory((h) => [...h.slice(-40), before]);
    setRedo([]);
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
      tag: "v1.0.0-rc.3",
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
        <span className="grp">OUTPUT</span>
        <button onClick={() => setView("Preview")}>Preview</button>
        <button className="gold" onClick={() => setView("CleanCapture")}>Clean Capture</button>
      </div>
      <div className={`stage ${clean ? "clean" : ""}`}>
        <div className="canvas-wrap" ref={wrapRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
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
          {!clean && (
            <div className="statusstrip">{project.width}×{project.height} · {view} · Audio {audio.status} · {selected?selected.effects.length:0} effects</div>
          )}
        </div>
        <aside className={`side ${clean ? "hidden" : ""}`}>
          <div className="tabs">
            {(["effects","audio","output","settings"] as const).map((id)=>(
              <button key={id} className={tab===id?"tab on":"tab"} onClick={()=>setTab(id)}>{id.toUpperCase()}</button>
            ))}
          </div>

          {tab==="effects" && (
            <div className="pane">
              <h3>MASTERS</h3>
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

          {tab==="settings" && (
            <div className="pane">
              <h3>UI</h3>
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
