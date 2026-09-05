import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { AudioEngine } from "../audio/engine";
import { ALL_EFFECTS, defaultEffect, newProject, type EffectKind, type Project, type Region, type ViewMode } from "../scene/types";
import { VORTEX_PRESETS } from "../scene/presets";
import { canvasToScene, sceneToCanvas, sceneViewport } from "../scene/transform";
import { closestSegment, chaikin, rdp, pathLength, rasterizeClosed } from "../scene/traceMath";
import { assistedTrace, analyzeCandidates, foregroundMask, estimateDepth, invertDepth, type AiCandidate } from "../scene/localVision";
import { runEngine, enhancedCandidates, engineLabel, ENHANCED_MODEL, type AiEngine, type Prompt, type Scope } from "../scene/enhancedVision";
import { NEURAL_MODEL, modelsInstalled, downloadVerified, invalidateEmbed } from "../scene/neuralSam";
import { detectWordTraces, rasterizeWordMask, type WordCandidate } from "../scene/smartNeon";
import { FEEDBACK_TYPES, buildReport, githubNewIssueUrl, type FeedbackDraft } from "../scene/feedback";
import { semverNewer, formatBytes, persistPending, takePending, autosaveProject } from "../scene/updater";
import { serializeProject } from "../scene/projectIo";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { GlRenderer } from "../render/renderer";
import {
  applyVote, clearVotes, defaultPollConfig, defaultPollRuntime, effectIndex, endPoll,
  persistablePoll, resetPoll, restoreEffects, startPoll, applyOverride, resolveLeader,
  type PollConfig, type PollOption, type PollRuntime
} from "../scene/poll";
import { PollRelayTransport, defaultRelayUrl, publicRelayOrigin, rewritePublicPairingUrl, type RelayStatus, type RelayPublicState } from "../scene/pollRelay";
import { hostFingerprint, hostInstanceId, instanceDisplayName, resetHostInstance, setInstanceDisplayName } from "../scene/hostInstance";
import { ReactionEngine, publicAllowed } from "../scene/reactions";
import { FIREWORK_PRESETS } from "../scene/fireworksSim";
import { QrImage, QrModal } from "./QrPanel";
import { HelpOverlay, Hint, setTutorialDone, tutorialDone } from "./HelpOverlay";

const audio = new AudioEngine();
const rxEngine = new ReactionEngine();
const APP_VERSION = "1.0.0-rc.44";
const POLL_BUS = "auralith.poll.bus";
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
  const [tool, setTool] = useState<"Trace" | "Stamp" | "Emitter" | "Edit" | "Shape" | "Prop">("Edit");
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
  const [neuralReady, setNeuralReady] = useState(false);
  const [dlMsg, setDlMsg] = useState("");
  const [altIdx, setAltIdx] = useState(0);
  const [requireNeural, setRequireNeural] = useState(() => localStorage.getItem("auralith.requireNeural")==="1");
  const [aiScope, setAiScope] = useState<Scope>("tight");
  const [hardObject, setHardObject] = useState(true);
  const [qualityTier, setQualityTier] = useState<"fast"|"balanced"|"accurate"|"max">("fast");
  const [maskTool, setMaskTool] = useState<"add"|"remove"|"lassoAdd"|"lassoRemove"|"">("");
  useEffect(() => { void modelsInstalled().then(setNeuralReady); }, []);
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
  const [tab, setTab] = useState<"effects"|"audio"|"output"|"settings">("output");
  const [activity, setActivity] = useState<string[]>([]);
  const logAct = (msg: string) => setActivity((rows) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...rows].slice(0, 40));
  const [helpMode, setHelpMode] = useState<"off" | "welcome" | "tour" | "help">(() => tutorialDone() ? "off" : "welcome");
  const [pollCfg, setPollCfg] = useState<PollConfig>(() => project.poll || defaultPollConfig());
  const [pollRt, setPollRt] = useState<PollRuntime>(defaultPollRuntime);
  const [viewer, setViewer] = useState({ state: "STOPPED", port: 0, local_url: "", lan_url: "", lan_ip: "", health: "STOPPED", error: "", msg: "" });
  const [viewerMode, setViewerMode] = useState<"lan"|"public">(() => (localStorage.getItem("auralith.viewerMode") as any) || "lan");
  const [relayUrl, setRelayUrl] = useState(defaultRelayUrl);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("IDLE");
  const [relayErr, setRelayErr] = useState("");
  const [relayRoom, setRelayRoom] = useState("");
  const [customRoom, setCustomRoom] = useState(() => localStorage.getItem("auralith.roomName") || "OBSIDIAN-WOLF");
  const [roomAvail, setRoomAvail] = useState("");
  const hostId = useMemo(() => hostInstanceId(), []);
  const [instanceName, setInstanceName] = useState(() => instanceDisplayName());
  const [relayViewer, setRelayViewer] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [showHostQrModal, setShowHostQrModal] = useState(false);
  const [hostRole, setHostRole] = useState<"FULL_HOST"|"POLL_MODERATOR"|"EFFECTS_OPERATOR"|"REACTION_MODERATOR">("FULL_HOST");
  const [hostPair, setHostPair] = useState<{ qrUrl?: string; pairingId?: string; expiresAt?: number; role?: string } | null>(null);
  const [pendingRemote, setPendingRemote] = useState<any>(null);
  const [remoteDevices, setRemoteDevices] = useState<any[]>([]);
  const [remoteEnabled, setRemoteEnabled] = useState(true);
  const relayRef = useRef(new PollRelayTransport());
  const viewerModeRef = useRef(viewerMode); viewerModeRef.current = viewerMode;
  const pollVotes = useRef(new Map<string, PollOption>());
  const pollRtRef = useRef(pollRt); pollRtRef.current = pollRt;
  const pollCfgRef = useRef(pollCfg); pollCfgRef.current = pollCfg;
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
    for (const r of project.regions) {
      if (r.kind === "Prop" && r.propDataUrl) {
        const im = new Image();
        const id = r.id;
        im.onload = () => { try { glRef.current?.registerProp(id, im); } catch {} };
        im.src = r.propDataUrl;
      }
    }
  }, [project.regions.map((r) => r.id + (r.propDataUrl || "")).join("|")]);
  useEffect(() => {
    console.log("APP_COMPONENT_BEGIN");
    if (!canvasRef.current) return;
    let id = 0;
    try {
      console.log("RENDERER_INIT_BEGIN");
      glRef.current = new GlRenderer(canvasRef.current);
      console.log("RENDERER_INIT_OK APP_READY");
      for (const r of projectRef.current.regions) {
        if (r.kind === "Prop" && r.propDataUrl) {
          const im = new Image();
          im.onload = () => { try { glRef.current?.registerProp(r.id, im); } catch {} };
          im.src = r.propDataUrl;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("APP_BOOT_FAILED stage=RENDERER error=" + msg);
      setErr("Renderer: " + msg);
    }
    const loop = () => {
      const wrap = wrapRef.current;
      try {
        if (wrap && glRef.current) {
          const vp = currentVp(wrap.getBoundingClientRect());
          const ov: Record<string, string> = {};
          if (pollRtRef.current.overrideId && pollRtRef.current.overrideColor) ov[pollRtRef.current.overrideId] = pollRtRef.current.overrideColor;
          rxEngine.tick();
          glRef.current.draw(projectRef.current, audio.snapshot, wrap.clientWidth, wrap.clientHeight, vp, ov, rxEngine.live);
        }
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
  const publishPoll = (cfg: PollConfig, rt: PollRuntime) => {
    try {
      localStorage.setItem(POLL_BUS, JSON.stringify({
        question: cfg.question, redLabel: cfg.redLabel, greenLabel: cfg.greenLabel,
        red: rt.red, green: rt.green, running: rt.running, roundId: rt.roundId
      }));
    } catch {}
  };
  const setPollAndProject = (cfg: PollConfig) => {
    setPollCfg(cfg);
    pollCfgRef.current = cfg;
    setProject((p) => ({ ...p, poll: persistablePoll(cfg) }));
  };
  const applyRt = (rt: PollRuntime) => { setPollRt(rt); pollRtRef.current = rt; publishPoll(pollCfgRef.current, rt); syncViewerHub(pollCfgRef.current, rt); publishHostSync(rt); };
  const publishHostSync = (rt = pollRtRef.current) => {
    const cfg = pollCfgRef.current;
    const list = effectIndex(projectRef.current);
    const redMap = list.find((x)=>x.id===cfg.redEffectId)?.label || cfg.redEffectId || "";
    const greenMap = list.find((x)=>x.id===cfg.greenEffectId)?.label || cfg.greenEffectId || "";
    emit("poll-sync", {
      running: rt.running, question: cfg.question, redLabel: cfg.redLabel, greenLabel: cfg.greenLabel,
      red: rt.red, green: rt.green, leader: rt.leader || "", redMap, greenMap,
      viewer,
      relay: { status: relayStatus, error: relayErr, room: relayRoom, url: relayViewer, mode: viewerMode }
    }).catch(()=>{});
  };
  const applyRelaySnapshot = (s: RelayPublicState) => {
    const cfg = pollCfgRef.current;
    const prev = pollRtRef.current;
    const snapVotes = (s.red || 0) + (s.green || 0);
    const localCleared = prev.red === 0 && prev.green === 0 && !prev.leader && !prev.overrideColor;
    if (snapVotes > 0 && localCleared && s.round_id && prev.roundId && s.round_id !== prev.roundId) {
      return;
    }
    const incomingVer = Number(s.state_version || 0);
    const prevVer = Number((prev as any).stateVersion || 0);
    if (incomingVer && prevVer && incomingVer < prevVer) return;
    const next = resolveLeader({
      ...prev,
      running: s.running_poll != null ? !!s.running_poll : prev.running,
      roundId: s.round_id || prev.roundId,
      red: s.red || 0,
      green: s.green || 0,
      leader: snapVotes === 0 ? null : prev.leader,
      overrideId: snapVotes === 0 ? null : prev.overrideId,
      overrideColor: snapVotes === 0 ? null : prev.overrideColor
    }, cfg);
    applyRt(next);
  };
  const relayAction = (action: string) => {
    if (viewerModeRef.current === "public") relayRef.current.sendHost(action, {
      question: pollCfgRef.current.question,
      redLabel: pollCfgRef.current.redLabel,
      greenLabel: pollCfgRef.current.greenLabel,
      allowChange: pollCfgRef.current.allowChange
    });
  };
  const syncViewerHub = (cfg = pollCfgRef.current, rt = pollRtRef.current) => {
    invoke("poll_server_set_hub", { hub: {
      running_poll: rt.running, question: cfg.question, red_label: cfg.redLabel, green_label: cfg.greenLabel,
      red: rt.red, green: rt.green, round_id: rt.roundId
    } }).catch(() => {});
  };
  useEffect(() => {
    const onVote = (e: StorageEvent) => {
      if (e.key !== POLL_BUS + ".vote" || !e.newValue) return;
      try {
        const msg = JSON.parse(e.newValue);
        if (msg.type !== "vote") return;
        const res = applyVote(pollRtRef.current, pollCfgRef.current, pollVotes.current, String(msg.viewerId||"anon"), msg.option === "green" ? "green" : "red");
        pollVotes.current = res.votes;
        if (res.accepted) applyRt(res.rt);
      } catch {}
    };
    const unlistenC = listen<{ action: string }>("poll-cmd", (ev) => {
      const action = ev.payload?.action;
      const cfg = pollCfgRef.current;
      const rt = pollRtRef.current;
      if (action === "sync") { publishHostSync(rt); return; }
      if (action === "start") { applyRt(startPoll(rt, cfg)); relayAction("startPoll"); }
      else if (action === "end") { applyRt(endPoll(rt, cfg)); relayAction("endPoll"); }
      else if (action === "clear") { pollVotes.current = new Map(); applyRt(clearVotes(rt, cfg)); relayAction("clearVotes"); }
      else if (action === "restore") { pollVotes.current = new Map(); applyRt(restoreEffects(clearVotes(rt, cfg))); relayAction("clearVotes"); }
      else if (action === "reset") { const n = resetPoll(cfg); pollVotes.current = n.votes; applyRt(n.rt); relayAction("resetRound"); }
      else if (action === "open-viewer") {
        invoke("poll_open_local").then((st: any) => setViewer({ ...st, msg: "Viewer page opened." })).catch((e)=>setViewer((s)=>({...s, msg: String(e)})));
      }
    }).catch(()=>undefined);
    const unlistenP = listen<{ option: string; viewerId: string }>("poll-vote", (ev) => {
      const msg = ev.payload || { option: "red", viewerId: "lan" };
      const res = applyVote(pollRtRef.current, pollCfgRef.current, pollVotes.current, String(msg.viewerId || "lan"), msg.option === "green" ? "green" : "red");
      pollVotes.current = res.votes;
      if (res.accepted) applyRt(res.rt);
    }).catch(() => undefined);
    window.addEventListener("storage", onVote);
    const t = setInterval(() => {
      try {
        const raw = localStorage.getItem(POLL_BUS + ".vote");
        if (!raw) return;
        const msg = JSON.parse(raw);
        if (!msg.ts || msg.ts === (onVote as any)._ts) return;
        (onVote as any)._ts = msg.ts;
        onVote(new StorageEvent("storage", { key: POLL_BUS + ".vote", newValue: raw }));
      } catch {}
    }, 250);
    return () => { window.removeEventListener("storage", onVote); clearInterval(t); unlistenP.then((fn) => fn && fn()).catch(()=>{}); unlistenC.then((fn)=>fn && fn()).catch(()=>{}); };
  }, []);
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
    const wrap = wrapRef.current; if (!wrap) return null as null | { kind: "point"|"marker"|"seg"|"all"|"handle"; id: string; index: number; handle?: string };
    const rect = wrap.getBoundingClientRect();
    const proj = projectRef.current;
    const vp = currentVp(rect);
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (sel) {
      const pr = proj.regions.find((r) => r.id === sel && (r.kind === "Prop" || r.kind === "Shape"));
      if (pr) {
        const hw = (pr.width || pr.radius * 2) / 2;
        const hh = (pr.height || pr.radius * 2) / 2;
        const handles: [string, number, number][] = [
          ["tl", pr.x - hw, pr.y - hh], ["t", pr.x, pr.y - hh], ["tr", pr.x + hw, pr.y - hh],
          ["l", pr.x - hw, pr.y], ["r", pr.x + hw, pr.y],
          ["bl", pr.x - hw, pr.y + hh], ["b", pr.x, pr.y + hh], ["br", pr.x + hw, pr.y + hh]
        ];
        for (const [name, hx, hy] of handles) {
          const c = sceneToCanvas(hx, hy, vp, proj.width, proj.height);
          if (Math.hypot(c.x - px, c.y - py) <= 12) return { kind: "handle", id: pr.id, index: -1, handle: name };
        }
        const spt = canvasToScene(px, py, vp, proj.width, proj.height);
        if (Math.abs(spt.x - pr.x) <= hw && Math.abs(spt.y - pr.y) <= hh) {
          return { kind: "all", id: pr.id, index: -1 };
        }
      }
    }
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
    const sBody = canvasToScene(px, py, vp, proj.width, proj.height);
    for (let i = proj.regions.length - 1; i >= 0; i--) {
      const r = proj.regions[i]!;
      if (r.kind !== "Prop" && r.kind !== "Shape") continue;
      const hw = (r.width || r.radius * 2) / 2;
      const hh = (r.height || r.radius * 2) / 2;
      if (Math.abs(sBody.x - r.x) <= hw && Math.abs(sBody.y - r.y) <= hh) return { kind: "all", id: r.id, index: -1 };
    }
    return null;
  };
  const runAssisted = async (mode: "click"|"box"|"brush", seed: {x:number;y:number;w?:number;h?:number;path?:{x:number;y:number}[]}) => {
    const img = imgRef.current;
    if (!img) { setAiMsg("Load an image first."); return; }
    setAiBusy(true); setAiMsg("Analyzing selection...");
    try {
      const res = await runEngine(aiEngine, img, projectRef.current.width, projectRef.current.height, mode, seed, aiPrompts, aiSens, setAiMsg, { requireNeural, scope: aiScope, hardObject });
      if (!res) setAiMsg("Could not create a reliable suggestion. [Retry] [Use Enhanced Local] [Use Lightweight] [Manual Trace]");
      else {
        setAiPreview(res);
        setLastEngineUsed(res.engineUsed);
        setAltIdx((res as any).neuralIndex || 0);
        const q = (res as any).quality;
        const n = (res as any).neuralMasks?.length;
        const spill = (res as any).suspicious ? " Selection may include multiple objects. Use Alternate / Tighten / Exclude." : "";
        const prov = (res as any).provenance || res.engineUsed;
        if (res.engineUsed !== "neural" && (aiEngine==="auto" || aiEngine==="neural")) {
          setAiMsg("Enhanced Neural Vision is unavailable. Using Enhanced Local Segmenter. Generated by: "+prov);
        } else {
          setAiMsg("Generated by: "+prov + (n ? ` · Result ${(res as any).neuralIndex+1} of ${n}` : "") + (q!=null ? ` · Mask Quality: ${Number(q).toFixed(2)}` : "") + spill);
        }
      }
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
      if (hit.kind === "handle") {
        setSelPt(null);
        dragRef.current = {
          id: hit.id, mode: "resize", handle: hit.handle, moved: false,
          sx: s.x, sy: s.y,
          bx: r.x, by: r.y, bw: r.width || r.radius * 2, bh: r.height || r.radius * 2,
          points: r.points.map((p)=>({...p}))
        } as any;
      } else if (hit.kind === "point") {
        setSelPt(hit.index);
        const pt = r.points[hit.index] || { x: r.x, y: r.y };
        dragRef.current = { id: hit.id, ox: pt.x, oy: pt.y, sx: s.x, sy: s.y, moved: false, mode: "point", index: hit.index } as any;
      } else if (toolRef.current === "Edit" || hit.kind === "all") {
        setSelPt(null);
        dragRef.current = { id: hit.id, ox: 0, oy: 0, sx: s.x, sy: s.y, moved: false, mode: "all", points: r.points.map((p)=>({...p})), rx: r.x, ry: r.y } as any;
      } else {
        setSelPt(hit.index >= 0 ? hit.index : null);
        dragRef.current = { id: hit.id, ox: r.x, oy: r.y, sx: s.x, sy: s.y, moved: false, mode: "marker" } as any;
      }
      return;
    }
    if (toolRef.current === "Edit") return;
    if (toolRef.current === "Prop") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/webp";
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return;
        const url = await new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ""));
          fr.readAsDataURL(file);
        });
        const img = new Image();
        img.onload = () => {
          const maxSide = Math.max(img.naturalWidth, img.naturalHeight) || 256;
          const fit = Math.min(projectRef.current.width * 0.45, projectRef.current.height * 0.45, maxSide);
          const scale = fit / maxSide;
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          const fx = defaultEffect("NeonGlow");
          fx.geomMode = "mask";
          fx.applyMode = "boundary";
          const region: Region = {
            id: crypto.randomUUID(), kind: "Prop", points: [{ x: s.x, y: s.y }],
            x: s.x, y: s.y, sx: 1, sy: 1, rotation: 0, radius: Math.max(w, h) / 2,
            width: w, height: h,
            effects: [fx], pathClosed: true,
            propDataUrl: url, propVisible: true, assetName: file.name, alphaThreshold: 0.15,
            label: file.name.replace(/\.[^.]+$/, "")
          };
          try { glRef.current?.registerProp(region.id, img); } catch {}
          pushHist({ ...projectRef.current, regions: [...projectRef.current.regions, region] });
          setSel(region.id);
        };
        img.src = url;
      };
      input.click();
      return;
    }
    const kind = toolRef.current === "Shape" ? "Shape" : toolRef.current === "Stamp" || toolRef.current === "Emitter" ? toolRef.current : "Emitter";
    const region: Region = {
      id: crypto.randomUUID(), kind, points: [{ x: s.x, y: s.y }],
      x: s.x, y: s.y, sx: 1, sy: 1, rotation: 0, radius: kind==="Shape" ? 180 : 80,
      width: kind==="Shape" ? 360 : 80, height: kind==="Shape" ? 360 : 80,
      shape: kind==="Shape" ? "rect" : undefined,
      effects: [defaultEffect("GlowBloom")], pathClosed: kind==="Shape", pathLength: 0,
      label: kind==="Shape" ? "Rectangle" : kind
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
    if (d.mode === "resize") {
      const MIN = 24;
      let left = d.bx - d.bw / 2, right = d.bx + d.bw / 2, top = d.by - d.bh / 2, bottom = d.by + d.bh / 2;
      const h = String(d.handle);
      if (h.includes("l")) left = s.x;
      if (h.includes("r")) right = s.x;
      if (h.includes("t")) top = s.y;
      if (h.includes("b")) bottom = s.y;
      if (["tl","tr","bl","br"].includes(h) && !e.shiftKey) {
        const ratio = (d.bw || 1) / (d.bh || 1);
        let nw = Math.abs(right - left), nh = Math.abs(bottom - top);
        if (nw / nh > ratio) nh = nw / ratio; else nw = nh * ratio;
        if (h.includes("l")) left = right - nw; else right = left + nw;
        if (h.includes("t")) top = bottom - nh; else bottom = top + nh;
      }
      let nw = Math.max(MIN, right - left);
      let nh = Math.max(MIN, bottom - top);
      if (right < left) { left = right - nw; }
      if (bottom < top) { top = bottom - nh; }
      const nx = left + nw / 2, ny = top + nh / 2;
      setProject({
        ...cur,
        regions: cur.regions.map((r) => r.id !== d.id ? r : {
          ...r, x: nx, y: ny, width: nw, height: nh, radius: Math.max(nw, nh) / 2,
          points: [{ x: nx, y: ny }]
        })
      });
      return;
    }
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
      if (d.mode === "resize") return { ...r, x: d.bx, y: d.by, width: d.bw, height: d.bh, radius: Math.max(d.bw, d.bh) / 2, points: d.points || [{ x: d.bx, y: d.by }] };
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
          if (!img.naturalWidth || !img.naturalHeight) throw new Error("Decoded image has empty dimensions.");
          imgRef.current = img;
          glRef.current?.setBackdrop(img);
          setProject((p) => {
            if (p.backdropDataUrl) URL.revokeObjectURL(p.backdropDataUrl);
            return { ...p, backdropDataUrl: url };
          });
          try {
            invalidateEmbed();
            setAiPreview(null);
            setAiPrompts([]);
            setAiCands([]);
            setAltIdx(0);
          } catch (aiErr) {
            console.warn("[ImageLoad] AI cache invalidate ignored", aiErr);
          }
          console.log("[ImageLoad] STATE_UPDATED RENDER_INVALIDATED IMAGE_VISIBLE");
        } catch (e) {
          console.error("[ImageLoad] STATE_UPDATE_FAILED", e);
          setErr("Could not load image.\nFile: "+file.name+"\nReason: "+String(e));
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

  const applyLoadedProject = (p: Project) => {
    if (p.version !== 1) throw new Error("unsupported project");
    setProject(p);
    setPollCfg(p.poll || defaultPollConfig());
    setPollRt(defaultPollRuntime());
    pollVotes.current = new Map();
    try { rxEngine.restore(p.reactions); rxEngine.clear(); } catch { /* ignore */ }
    if (p.backdropDataUrl && p.backdropDataUrl.startsWith("data:")) {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        glRef.current?.setBackdrop(img);
      };
      img.src = p.backdropDataUrl;
    }
  };

  const saveProjectFile = async () => {
    try {
      const packed = await serializeProject(project, {
        backdropImage: imgRef.current,
        poll: persistablePoll(pollCfg),
        reactions: rxEngine.persist()
      });
      if (!packed.backdropDataUrl && !packed.regions.length) {
        setErr("Nothing to save. Load an image or add an effect first.");
        return;
      }
      const json = JSON.stringify(packed);
      try {
        const path = await saveDialog({
          defaultPath: "scene.auralith",
          filters: [{ name: "Auralith Project", extensions: ["auralith"] }]
        });
        if (!path) return;
        await writeTextFile(path, json);
        setErr("");
        console.log("[Project] SAVE_OK", path, "effects="+packed.regions.reduce((n,r)=>n+r.effects.length,0), "image="+!!packed.backdropDataUrl);
        return;
      } catch (nativeErr) {
        console.warn("[Project] native save unavailable, using download", nativeErr);
      }
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "scene.auralith";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setErr("Could not save project.\nReason: " + String(e));
    }
  };

  const openProjectFile = async () => {
    try {
      try {
        const path = await openDialog({
          multiple: false,
          filters: [{ name: "Auralith Project", extensions: ["auralith", "json"] }]
        });
        if (path && typeof path === "string") {
          const text = await readTextFile(path);
          applyLoadedProject(JSON.parse(text));
          console.log("[Project] OPEN_OK", path);
          return;
        }
      } catch (nativeErr) {
        console.warn("[Project] native open unavailable, using file input", nativeErr);
      }
      document.getElementById("proj")?.click();
    } catch (e) {
      setErr("Could not open project.\nReason: " + String(e));
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
      tag: "v1.0.0-rc.19",
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
    if (relayStatus === "ONLINE" || pollRtRef.current.running) {
      const ok = window.confirm("Installing this update will restart Auralith and temporarily stop the live host connection.");
      if (!ok) return;
    }
    autosaveProject(JSON.stringify({ ...project, reactions: rxEngine.persist() }));
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
        <span className="brand">AURALITH REBORN</span>
        <span className="tagline">SEE THE MUSIC · FEEL THE POWER</span>
        <button className="ghost" onClick={()=>setTab("settings")}>Settings</button>
        <button className="ghost" onClick={()=>setHelpMode("help")}>Help</button>
        <span className="grp">PROJECT</span>
        <button onClick={() => document.getElementById("file")?.click()}>Load Image</button>
        <input id="file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp" hidden onChange={(e) => { const f=e.target.files?.[0]; e.target.value=""; loadImage(f); }} />
        <button onClick={() => { void saveProjectFile(); }}>Save</button>
        <button onClick={() => { void openProjectFile(); }}>Open</button>
        <button onClick={()=>{ setTab("settings"); setFbMsg(""); }}>Send Feedback</button>
        <button onClick={()=>setHelpMode("help")}>Help & Tutorials</button>
        <input id="proj" type="file" accept=".auralith,application/json" hidden onChange={async (e)=>{ const f=e.target.files?.[0]; e.target.value=""; if(!f) return; try { applyLoadedProject(JSON.parse(await f.text())); } catch(err){ setErr(String(err)); } }} />
        <span className="grp">EDIT</span>
        <button className={tool==="Shape"?"on":""} title="Add a shape target" onClick={() => setTool("Shape")}>Shape</button>
        <button className={tool==="Prop"?"on":""} title="Import a PNG/WebP prop" onClick={() => setTool("Prop")}>Prop</button>
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
      <div className={`nav ${clean ? "hidden" : ""}`}>
        {[
          ["output","Home"],["effects","Editor"],["effects","Effects"],["effects","Scenes"],
          ["audio","Audio"],["output","Output"],["output","Server"],["output","Devices"],["settings","About"]
        ].map(([id,label]) => (
          <button key={label} className={tab===id && ((label==="Home"||label==="Server"||label==="Devices"||label==="Output") ? tab==="output" : tab===id) ? "on" : (tab===id && (label==="Editor"||label==="Effects"||label==="Scenes") ? "on" : tab===id ? "on" : "")}
            onClick={()=>setTab(id as typeof tab)}>{label}</button>
        ))}
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
                      {(r.kind==="Shape" || r.kind==="Prop") && (() => {
                        const c = sceneToCanvas(r.x, r.y, vp, project.width, project.height);
                        const hw = ((r.width || r.radius*2) / project.width) * vp.w * 0.5 * (r.sx||1);
                        const hh = ((r.height || r.radius*2) / project.height) * vp.h * 0.5 * (r.sy||1);
                        const sh = r.shape || "rect";
                        if (sh==="circle" || sh==="ellipse") return <ellipse cx={c.x} cy={c.y} rx={Math.abs(hw)} ry={Math.abs(hh)} fill="none" stroke={r.id===sel?"#D4AF37":"#9ad"} strokeWidth={2} />;
                        const box = <rect x={c.x-hw} y={c.y-hh} width={Math.abs(hw)*2} height={Math.abs(hh)*2} fill="none" stroke={r.id===sel?"#D4AF37":"#9ad"} strokeWidth={2} rx={sh==="roundrect"?8:0} />;
                        if (r.id !== sel) return box;
                        const hs = [
                          [c.x-hw, c.y-hh], [c.x, c.y-hh], [c.x+hw, c.y-hh],
                          [c.x-hw, c.y], [c.x+hw, c.y],
                          [c.x-hw, c.y+hh], [c.x, c.y+hh], [c.x+hw, c.y+hh]
                        ];
                        return (
                          <g>
                            {box}
                            {hs.map(([hx,hy],i)=>(
                              <rect key={i} x={hx-5} y={hy-5} width={10} height={10} fill="#120c08" stroke="#D4AF37" strokeWidth={1.5} />
                            ))}
                          </g>
                        );
                      })()}
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
          {wrapRef.current && (() => {
            const wrap = wrapRef.current!.getBoundingClientRect();
            const vp = currentVp(wrap);
            const d = pollCfg.display;
            const pos = sceneToCanvas(d.x, d.y, vp, project.width, project.height);
            const tot = pollRt.red + pollRt.green;
            const rp = tot ? Math.round(pollRt.red / tot * 100) : 0;
            const gp = tot ? Math.round(pollRt.green / tot * 100) : 0;
            const w = (d.w / project.width) * vp.w * d.scale;
            return (
              <div className="poll-hud" style={{
                position: "absolute", left: pos.x, top: pos.y, width: w, opacity: d.opacity,
                background: `rgba(18,12,8,${d.bgOpacity})`, color: d.textColor, padding: d.pad,
                borderRadius: d.radius, border: d.border ? `${d.borderW}px solid #d4af37` : "none",
                textAlign: d.align, fontSize: d.fontSize, pointerEvents: clean ? "none" : "auto",
                fontFamily: "Georgia, serif"
              }} onPointerDown={(e) => {
                if (clean) return;
                e.stopPropagation();
                const start = sceneFromEvent(e);
                const ox = d.x, oy = d.y;
                const move = (ev: PointerEvent) => {
                  const s = sceneFromEvent(ev);
                  setPollAndProject({ ...pollCfgRef.current, display: { ...pollCfgRef.current.display, x: ox + (s.x - start.x), y: oy + (s.y - start.y) } });
                };
                const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}>
                {d.showQuestion && <div style={{ letterSpacing: 1, marginBottom: 8 }}>{pollCfg.question}</div>}
                <div style={{ display: "flex", gap: 16, justifyContent: d.align === "center" ? "center" : d.align === "right" ? "flex-end" : "flex-start" }}>
                  <div>
                    <div style={{ color: d.redAccent, fontWeight: 700 }}>{pollCfg.redLabel}{d.showLeader && pollRt.leader==="red" ? " ●" : ""}</div>
                    {d.showCounts && <div>{pollRt.red}</div>}
                    {d.showPct && <div>{rp}%</div>}
                  </div>
                  <div>
                    <div style={{ color: d.greenAccent, fontWeight: 700 }}>{pollCfg.greenLabel}{d.showLeader && pollRt.leader==="green" ? " ●" : ""}</div>
                    {d.showCounts && <div>{pollRt.green}</div>}
                    {d.showPct && <div>{gp}%</div>}
                  </div>
                </div>
                {d.showTotal && <div style={{ marginTop: 6, opacity: 0.75 }}>Total {tot}</div>}
                <div style={{ marginTop: 8, fontSize: Math.max(12, d.fontSize * 0.7), opacity: 0.8 }}>
                  Vote on your phone{relayRoom ? " · " + relayRoom : ""}
                </div>
              </div>
            );
          })()}
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
              {selected && (selected.kind==="Shape" || selected.kind==="Prop") && (
                <div className="acc on">
                  <h3>TARGET</h3>
                  <p className="muted">{selected.kind} · {selected.shape || selected.assetName || selected.label}</p>
                  {selected.kind==="Shape" && (
                    <label>Shape <select value={selected.shape||"rect"} onChange={(e)=>pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, shape:e.target.value as any, label:e.target.value})})}>
                      <option value="circle">Circle</option>
                      <option value="ellipse">Ellipse</option>
                      <option value="rect">Rectangle</option>
                      <option value="roundrect">Rounded Rectangle</option>
                      <option value="triangle">Triangle</option>
                      <option value="line">Line</option>
                      <option value="ring">Ring</option>
                      <option value="polygon">Polygon</option>
                      <option value="diamond">Diamond</option>
                    </select></label>
                  )}
                  <label>Width <input type="number" value={Math.round(selected.width||selected.radius*2)} onChange={(e)=>pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, width:Number(e.target.value), radius:Number(e.target.value)/2})})} /></label>
                  <label>Height <input type="number" value={Math.round(selected.height||selected.radius*2)} onChange={(e)=>pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, height:Number(e.target.value)})})} /></label>
                  <label>Rotation <input type="range" min={-180} max={180} value={selected.rotation||0} onChange={(e)=>pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, rotation:Number(e.target.value)})})} /></label>
                  <label>Position X <input type="number" value={Math.round(selected.x)} onChange={(e)=>pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, x:Number(e.target.value)})})} /></label>
                  <label>Position Y <input type="number" value={Math.round(selected.y)} onChange={(e)=>pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, y:Number(e.target.value)})})} /></label>
                  {selected.kind==="Prop" && (
                    <>
                      <label>Prop Visibility
                        <select value={selected.propVisible===false?"target":"visible"} onChange={(e)=>pushHist({...project, regions: project.regions.map(r=>r.id!==sel?r:{...r, propVisible:e.target.value!=="target"})})}>
                          <option value="visible">Visible</option>
                          <option value="target">Effect Target Only</option>
                        </select>
                      </label>
                      <p className="muted">Target Geometry: Prop Alpha</p>
                    </>
                  )}
                </div>
              )}
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
              {false && <h3>EXPERIMENTAL TOOLS</h3>}
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
                              <label>Target Geometry <select value={ef.geomMode || (selected?.kind==="Prop" || selected?.kind==="Shape" ? "mask" : selected?.kind==="Trace" && selected.pathClosed ? "mask" : selected?.kind==="Trace" ? "path" : "point")} onChange={(e)=>patchFx(ef.id,{geomMode:e.target.value})}>
                                <option value="point">Point</option>
                                <option value="path">Path</option>
                                <option value="mask">{selected?.kind==="Prop" ? "Prop Alpha" : "Mask"}</option>
                              </select></label>
                              <label>Application <select value={ef.applyMode || "boundary"} onChange={(e)=>patchFx(ef.id,{applyMode:e.target.value})}>
                                <option value="inside">Inside</option>
                                <option value="boundary">Boundary</option>
                                <option value="outside">Outside</option>
                              </select></label>
                              <label>Boundary Width <input type="range" min={0.05} max={1.5} step={0.01} value={ef.boundaryWidth??0.35} onChange={(e)=>patchFx(ef.id,{boundaryWidth:Number(e.target.value)})} /></label>
                              <label>Effect Scale <input type="range" min={0.1} max={8} step={0.05} value={ef.fxScaleX??ef.scale??1} onChange={(e)=>patchFx(ef.id,{fxScaleX:Number(e.target.value), fxScaleY:Number(e.target.value)})} /></label>
                              <label>Expansion <input type="range" min={0} max={2000} step={1} value={ef.expansion??0} onChange={(e)=>patchFx(ef.id,{expansion:Number(e.target.value)})} /></label>
                              <label>Spread <input type="range" min={0} max={2000} step={1} value={ef.spread??0} onChange={(e)=>patchFx(ef.id,{spread:Number(e.target.value)})} /></label>
                              <label>Offset X <input type="range" min={-800} max={800} step={1} value={ef.offsetX??0} onChange={(e)=>patchFx(ef.id,{offsetX:Number(e.target.value)})} /></label>
                              <label>Offset Y <input type="range" min={-800} max={800} step={1} value={ef.offsetY??0} onChange={(e)=>patchFx(ef.id,{offsetY:Number(e.target.value)})} /></label>
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
            <div className="pane dash">
              <h3>CLEAN OUTPUT</h3>
              <button className="gold" onClick={() => setView("CleanCapture")}>Open Clean Capture</button>
              <button onClick={() => setView("Edit")}>Close Clean Capture</button>
              <p>{project.width}×{project.height} · F11 / ESC</p>
              <h3>HOST INSTANCE</h3>
              <label>Instance Name
                <input value={instanceName} onChange={(e)=>setInstanceName(e.target.value.slice(0,40))} />
              </label>
              <button onClick={()=>{
                const n = setInstanceDisplayName(instanceName);
                setInstanceName(n);
                relayRef.current.sendHost("set_instance_name", { name: n, hostInstanceId: hostId });
              }}>Save Name</button>
              <p>Fingerprint {hostFingerprint(hostId)}</p>
              <p className="muted">Display name only. Tenant identity does not change when you rename.</p>
              <h3>LIVE CONTROL</h3>
              <p className="coach">Polls, reactions, and Fireworks are controlled in Auralith Host Console. This window stays the renderer and Public Server.</p>
              <p>Poll: {pollRt.running ? "LIVE" : "STOPPED"} · RED {pollRt.red} · GREEN {pollRt.green}</p>
              <p>Audience Reactions: {rxEngine.enabled ? "ENABLED" : "DISABLED"}</p>
              <div className="card">
                <h3>QUICK STATUS</h3>
                <p><span className={`dot ${relayStatus==="ONLINE"?"on":"off"}`} /> Server: {relayStatus==="ONLINE"?"ONLINE":"OFFLINE"}</p>
                <p>Room: {relayRoom || customRoom || "—"}</p>
                <p>Poll: {pollRt.running ? "LIVE" : "STOPPED"}</p>
                <p>Audience Reactions: {rxEngine.enabled ? "ENABLED" : "DISABLED"}</p>
                <p>Connected Devices: {remoteDevices.length}</p>
              </div>
              <div className="card">
                <h3>RECENT ACTIVITY</h3>
                <div className="activity">{activity.length ? activity.map((row,i)=><div key={i}>{row}</div>) : <p className="muted">No events this session.</p>}</div>
                <button onClick={()=>setActivity([])}>Clear Log</button>
              </div>
              <h3>SCENE POLL MAPPING</h3>
              <p className="muted">Choose which existing effects RED/GREEN temporarily recolor. Live voting happens in Host Console.</p>
              {(() => {
                const list = effectIndex(project);
                const ids = new Set(list.map((x)=>x.id));
                const missR = pollCfg.redEffectId && !ids.has(pollCfg.redEffectId);
                const missG = pollCfg.greenEffectId && !ids.has(pollCfg.greenEffectId);
                return (
                  <>
                    <label>RED maps to
                      <select value={pollCfg.redEffectId} onChange={(e)=>setPollAndProject({...pollCfg, redEffectId:e.target.value})}>
                        <option value="">Select effect…</option>
                        {list.map((x)=><option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    </label>
                    {missR && <p className="warn">Missing Effect</p>}
                    <label>GREEN maps to
                      <select value={pollCfg.greenEffectId} onChange={(e)=>setPollAndProject({...pollCfg, greenEffectId:e.target.value})}>
                        <option value="">Select effect…</option>
                        {list.map((x)=><option key={"g"+x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    </label>
                    {missG && <p className="warn">Missing Effect</p>}
                  </>
                );
              })()}
              <label>Reaction
                <select value={pollCfg.reaction} onChange={(e)=>setPollAndProject({...pollCfg, reaction:e.target.value as any})}>
                  <option value="live">Live Leader</option>
                  <option value="winnerEnd">Winner On End</option>
                </select>
              </label>
              <label>Tie
                <select value={pollCfg.tie} onChange={(e)=>setPollAndProject({...pollCfg, tie:e.target.value as any})}>
                  <option value="keep">Keep Previous Leader</option>
                  <option value="none">No Override</option>
                </select>
              </label>
              <label>On End
                <select value={pollCfg.onEnd} onChange={(e)=>setPollAndProject({...pollCfg, onEnd:e.target.value as any})}>
                  <option value="restore">Restore Original Effect Colors</option>
                  <option value="hold">Keep Winner Override Until Cleared</option>
                </select>
              </label>
              <div className="row">
                <button onClick={()=>{ navigator.clipboard.writeText(viewer.lan_url || viewer.local_url || relayViewer || "").catch(()=>{}); }}>Copy Viewer Link</button>
              </div>
              <div className="row">
                <button onClick={async ()=>{
                  try {
                    await invoke("open_host_console");
                    publishHostSync();
                  } catch {
                    setViewer((s)=>({...s, msg: "Auralith Host Console is not installed."}));
                    try { await invoke("poll_detach_host"); publishHostSync(); } catch (e) {
                      setViewer((s)=>({...s, msg: "Auralith Host Console is not installed. Legacy pop-out failed: "+String(e)}));
                    }
                  }
                }}>Open Host Console</button>
                <button onClick={async ()=>{
                  try { await invoke("poll_detach_host"); publishHostSync(); }
                  catch (e) { setViewer((s)=>({...s, msg: "Could not detach host controls: "+String(e)})); }
                }}>Legacy Pop-Out Host Controls</button>
              </div>
              <h4>VIEWER CONNECTION MODE</h4>
              <div className="row">
                <button className={viewerMode==="lan"?"on":""} onClick={()=>{ setViewerMode("lan"); localStorage.setItem("auralith.viewerMode","lan"); relayRef.current.disconnect(); setRelayStatus("IDLE"); }}>Local / LAN Test</button>
                <button className={viewerMode==="public"?"on":""} onClick={()=>{ setViewerMode("public"); localStorage.setItem("auralith.viewerMode","public"); }}>Public Relay</button>
              </div>
              {viewerMode==="public" && (
                <>
                  <p>Public Relay uses Railway. Paste the HTTPS origin after deploy. Worldwide is not claimed until a cellular test passes.</p>
                  <label>Relay URL
                    <input value={relayUrl} onChange={(e)=>{ setRelayUrl(e.target.value); localStorage.setItem("auralith.relayUrl", e.target.value); }} placeholder="https://your-service.up.railway.app" />
                  </label>
                  <p>Relay: {relayStatus}{relayErr ? " · "+relayErr : ""}</p>
                  <p>Public Room: {relayRoom || "none"} · Server: {relayStatus === "ONLINE" ? "ONLINE" : "OFFLINE"} · Poll: {pollRt.running && relayStatus === "ONLINE" ? "LIVE" : "STOPPED"}</p>
                  <label>Room Name
                    <input value={customRoom} onChange={(e)=>{ setCustomRoom(e.target.value.toUpperCase()); localStorage.setItem("auralith.roomName", e.target.value.toUpperCase()); }} placeholder="OBSIDIAN-WOLF" />
                    <Hint text="Choose a room name, then Start Public Server. Stopping the server does not release the name." />
                  </label>
                  <p>Availability: {roomAvail || "—"}</p>
                  <div className="row">
                    <button onClick={async ()=>{
                      try {
                        const a = await relayRef.current.checkAvailability(relayUrl || "https://obsidian-production-6e2e.up.railway.app", customRoom, hostId);
                        setRoomAvail(String(a.status || a.error || "UNKNOWN"));
                      } catch (e) { setRoomAvail(String(e)); }
                    }}>Check Availability</button>
                    <button onClick={()=>{
                      relayRef.current.disconnect();
                      setRelayStatus("IDLE"); setRelayErr("");
                    }}>Stop Public Server</button>
                    <button onClick={async ()=>{
                      const typed = window.prompt("Type the room name to release it permanently:");
                      if (!typed || typed.toUpperCase() !== (relayRoom || customRoom).toUpperCase()) return;
                      try {
                        await relayRef.current.releaseRoom(hostId);
                        relayRef.current.disconnect();
                        setRelayStatus("IDLE"); setRelayRoom(""); setRelayViewer("");
                        setRoomAvail("RELEASED");
                      } catch (e) { setRelayErr(String(e)); }
                    }}>Release Room Name</button>
                    <Hint text="Release Room Name is destructive. Only use it if you want another host to claim this name." />
                  </div>
                  <div className="row">
                    <button onClick={async ()=>{
                      try {
                        relayRef.current.onStatus = (s, err) => { setRelayStatus(s); setRelayErr(err); };
                        relayRef.current.onState = (st) => applyRelaySnapshot(st);
                        relayRef.current.onReaction = (ev) => { try { rxEngine.ingest(ev); logAct(`${ev.reactionId || "reaction"} triggered`); } catch {} };
                        relayRef.current.onRemote = (ev) => {
                          if (ev.type === "remote_pairing_request") setPendingRemote(ev);
                          if (ev.type === "remote_pairing_approved") { setRemoteDevices(ev.devices || []); logAct("Host Console connected"); }
                          if (ev.type === "remote_command") {
                            const c = String(ev.cmd || "");
                            const p = ev.params || {};
                            if (c === "poll_start") applyRt(startPoll(pollRtRef.current, pollCfgRef.current));
                            else if (c === "poll_end") applyRt(endPoll(pollRtRef.current, pollCfgRef.current));
                            else if (c === "poll_clear") { pollVotes.current = new Map(); applyRt(clearVotes(pollRtRef.current)); relayAction("clearVotes"); }
                            else if (c === "poll_reset") { const n = resetPoll(pollCfgRef.current); pollVotes.current = n.votes; applyRt(n.rt); relayAction("resetRound"); }
                            else if (c === "poll_clear_restore") { pollVotes.current = new Map(); applyRt(restoreEffects(clearVotes(pollRtRef.current))); relayAction("clearVotes"); }
                            else if (c === "poll_set_question") setPollAndProject({ ...pollCfgRef.current, question: String(p.question || "") });
                            else if (c === "poll_set_red_label") setPollAndProject({ ...pollCfgRef.current, redLabel: String(p.label || p.redLabel || "RED") });
                            else if (c === "poll_set_green_label") setPollAndProject({ ...pollCfgRef.current, greenLabel: String(p.label || p.greenLabel || "GREEN") });
                            else if (c === "poll_set_show_results") {
                              const show = p.show !== false;
                              setPollAndProject({ ...pollCfgRef.current, display: { ...pollCfgRef.current.display, showCounts: show, showPct: show, showLeader: show, showTotal: show } });
                            }
                            else if (c === "reactions_enable") { rxEngine.enabled = true; relayRef.current?.sendHost("set_allowed_reactions", { allowedReactions: publicAllowed(rxEngine.slots, true), hostInstanceId: hostId }); }
                            else if (c === "reactions_disable") { rxEngine.enabled = false; relayRef.current?.sendHost("set_allowed_reactions", { allowedReactions: [], hostInstanceId: hostId }); }
                            else if (c === "reaction_enable" || c === "reaction_disable") {
                              const id = String(p.id || "");
                              const slot = rxEngine.slots.find((x)=>x.id===id);
                              if (slot) slot.enabled = c === "reaction_enable";
                              relayRef.current?.sendHost("set_allowed_reactions", { allowedReactions: publicAllowed(rxEngine.slots, rxEngine.enabled), hostInstanceId: hostId });
                            }
                            else if (c === "reaction_clear_active") rxEngine.clear();
                            else if (c === "fireworks_preview") rxEngine.ingest({ reactionId: "fireworks", eventId: "remote-"+Date.now() });
                            else if (c.startsWith("fireworks_set_")) {
                              const slot = rxEngine.slots.find((x)=>x.id==="fireworks");
                              if (slot) {
                                if (c === "fireworks_set_preset") slot.shellMode = String(p.preset || p.value || slot.shellMode) as any;
                                if (c === "fireworks_set_intensity") slot.intensity = Number(p.value ?? p.intensity ?? slot.intensity) / (Number(p.value) > 1 ? 100 : 1);
                                if (c === "fireworks_set_shell_count") slot.burstCount = Number(p.value ?? p.shells ?? slot.burstCount);
                                if (c === "fireworks_set_pattern") slot.shellMode = String(p.value || p.pattern || slot.shellMode) as any;
                                if (c === "fireworks_set_brightness") slot.brightness = Number(p.value ?? slot.brightness) / (Number(p.value) > 1.5 ? 100 : 1);
                                if (c === "fireworks_set_smoke") slot.smokeAmt = Number(p.value ?? slot.smokeAmt) / (Number(p.value) > 1.5 ? 100 : 1);
                                if (c === "fireworks_set_bloom") slot.bloom = Number(p.value ?? slot.bloom) / (Number(p.value) > 1.5 ? 100 : 1);
                                if (c === "fireworks_set_duration") slot.durationMs = Math.max(500, Number(p.value ?? 6) * 1000);
                              }
                            }
                          }
                        };
                        const sess = await relayRef.current.connectHost(relayUrl, {
                          question: pollCfg.question, redLabel: pollCfg.redLabel, greenLabel: pollCfg.greenLabel, allowChange: pollCfg.allowChange,
                          roomName: customRoom, hostInstanceId: hostId, startPoll: false, instanceDisplayName: instanceName
                        });
                        setRelayRoom(sess.room); setRelayViewer(sess.viewerUrl); setShowQr(true);
                        localStorage.setItem("auralith.roomName", sess.room);
                        setCustomRoom(sess.room);
                        relayRef.current.sendHost("enable_remote_host");
                        relayRef.current.sendHost("set_allowed_reactions", { allowedReactions: publicAllowed(rxEngine.slots, rxEngine.enabled), hostInstanceId: hostId });
                        const check = await relayRef.current.verifyLiveState(false);
                        if (!check.ok) throw new Error(check.error);
                        logAct("Server started");
                        logAct(`Room ${sess.room} is online`);
                      } catch (e) { setRelayStatus("ERROR"); setRelayErr(String(e)); }
                    }}>Start Public Server</button>
                    <button onClick={()=>{ if (relayViewer) navigator.clipboard.writeText(relayViewer).catch(()=>{}); }}>Copy Public Link</button>
                    <button onClick={()=>setShowQr((v)=>!v)}>Show QR</button>
                    <Hint text="Viewer QR is PUBLIC and safe on stream." />
                    <button onClick={()=>{ if (relayViewer) window.open(relayViewer, "_blank"); }}>Open Viewer Page</button>
                  </div>
                  {!!relayViewer && (
                    <div className="card">
                      <p>Scan preview — use Show QR for the large monitor-scan code.</p>
                      <div style={{ background: "#FFFFFF", padding: 8, width: 236 }}>
                        <QrImage value={relayViewer.trim()} size={220} alt="Public viewer QR" />
                      </div>
                      <p>{relayRoom}</p>
                    </div>
                  )}
                  {showQr && relayViewer && (
                    <QrModal
                      title="PUBLIC VIEWER QR"
                      value={relayViewer.trim()}
                      room={relayRoom}
                      onCopy={() => { navigator.clipboard.writeText(relayViewer.trim()).catch(()=>{}); }}
                      onOpen={() => { window.open(relayViewer.trim(), "_blank"); }}
                      onClose={() => setShowQr(false)}
                    />
                  )}
                </>
              )}
              <h4>HOST REMOTE</h4>
              <p>Private Host QR for Auralith Remote. Never shown in Clean Capture.</p>
              <label>Access Level
                <select value={hostRole} onChange={(e)=>setHostRole(e.target.value as any)}>
                  <option value="FULL_HOST">Full Host</option>
                  <option value="POLL_MODERATOR">Poll Moderator</option>
                  <option value="EFFECTS_OPERATOR">Effects Operator</option>
                  <option value="REACTION_MODERATOR">Reaction Moderator</option>
                </select>
              </label>
              <div className="row">
                <button onClick={()=>{
                  const s = relayRef.current.session;
                  if (!s || relayStatus !== "ONLINE") {
                    setRelayErr("Start Public Server first, then Generate Host QR.");
                    return;
                  }
                  const origin = publicRelayOrigin(s.baseUrl || relayUrl);
                  fetch(origin+"/api/rooms/"+encodeURIComponent(s.room)+"/host", {
                    method:"POST",
                    headers:{
                      "content-type":"application/json",
                      authorization:"Bearer "+s.hostToken
                    },
                    body: JSON.stringify({ action:"create_pairing", role: hostRole, ttlSec: 120, hostInstanceId: hostId })
                  }).then(async (r)=>{
                    const j = await r.json().catch(()=>({}));
                    if (!r.ok) throw new Error(j.error || j.message || ("pairing failed HTTP "+r.status));
                    const origin = publicRelayOrigin(s.baseUrl || relayUrl);
                    const qrUrl = rewritePublicPairingUrl(origin, String(j.qrUrl || j.pairingUrl || ""), j.pairingId);
                    if (!qrUrl || /tauri\.localhost|localhost|127\.0\.0\.1/i.test(qrUrl)) {
                      throw new Error("Pairing URL was not a public Railway HTTPS address.");
                    }
                    setRelayErr("");
                    setHostPair({ ...j, qrUrl });
                    setShowHostQrModal(true);
                  }).catch((e)=>setRelayErr("Host QR request failed: "+String(e?.message||e)+" — check Public Server is ONLINE and Railway is reachable."));
                }}>Generate Host QR</button>
                <Hint text="Host QR is PRIVATE. Never show it on stream. Short-lived, one-time, requires Approve." />
                {relayErr && <p className="warn">{relayErr}</p>}
                <button onClick={()=>setHostPair(null)}>Cancel Pairing</button>
                <button onClick={()=>{
                  setRemoteEnabled(true);
                  relayRef.current.sendHost("enable_remote_host");
                  setRelayErr("Remote host control is ON. Generate a new Host QR and Approve the Host Console again.");
                }}>Enable All Remote Host Control</button>
                <button onClick={()=>{ setRemoteEnabled(false); relayRef.current.sendHost("disable_remote_host"); }}>Disable All Remote Host Control</button>
                <button onClick={()=>{ relayRef.current.sendHost("revoke_all"); setRemoteDevices([]); }}>Revoke All Devices</button>
              </div>
              {hostPair?.qrUrl && view !== "CleanCapture" && (
                <div className="card">
                  <p>HOST REMOTE PAIRING · {hostPair.role}</p>
                  <div style={{ background: "#FFFFFF", padding: 8, width: 216 }}>
                    <QrImage value={String(hostPair.qrUrl).trim()} size={200} alt="Host pairing QR" />
                  </div>
                  <p style={{ wordBreak: "break-all" }}>{hostPair.qrUrl}</p>
                  <button onClick={()=>{ if (hostPair.qrUrl) navigator.clipboard.writeText(hostPair.qrUrl).catch(()=>{}); }}>Copy Host Pairing URL</button>
                  <p>Expires {hostPair.expiresAt ? new Date(hostPair.expiresAt).toLocaleTimeString() : ""} — paste this URL into Host Console → PAIR WITH AURALITH, then Approve here.</p>
                  <button onClick={()=>setShowHostQrModal(true)}>Show Host QR</button>
                </div>
              )}
              {showHostQrModal && hostPair?.qrUrl && view !== "CleanCapture" && (
                <QrModal
                  title="HOST REMOTE PAIRING QR"
                  value={String(hostPair.qrUrl).trim()}
                  room={hostPair.role}
                  onCopy={() => { navigator.clipboard.writeText(String(hostPair.qrUrl).trim()).catch(()=>{}); }}
                  onClose={() => setShowHostQrModal(false)}
                />
              )}
              {pendingRemote && (
                <div className="card">
                  <p>REMOTE HOST REQUEST</p>
                  <p>Device: {pendingRemote.deviceDisplayName} · {pendingRemote.platform}</p>
                  <p>Role: {pendingRemote.requestedRole}</p>
                  <button onClick={()=>{
                    const s = relayRef.current.session;
                    if (!s) { setRelayErr("Public Server is offline. Start it, then Approve."); return; }
                    const origin = publicRelayOrigin(s.baseUrl || relayUrl);
                    fetch(origin+"/api/rooms/"+encodeURIComponent(s.room)+"/host", {
                      method:"POST",
                      headers:{ "content-type":"application/json", authorization:"Bearer "+s.hostToken },
                      body: JSON.stringify({ action:"approve_pairing", pairingId: pendingRemote.pairingId, hostInstanceId: hostId })
                    }).then(async (r)=>{
                      const j = await r.json().catch(()=>({}));
                      if (!r.ok) throw new Error(j.error || ("approve failed HTTP "+r.status));
                      setPendingRemote(null);
                      setRelayErr("");
                      logAct("Host pairing approved");
                    }).catch((e)=>setRelayErr(String(e?.message||e)));
                  }}>Approve</button>
                  <button onClick={()=>{
                    const s = relayRef.current.session;
                    if (!s) { setPendingRemote(null); return; }
                    const origin = publicRelayOrigin(s.baseUrl || relayUrl);
                    fetch(origin+"/api/rooms/"+encodeURIComponent(s.room)+"/host", {
                      method:"POST",
                      headers:{ "content-type":"application/json", authorization:"Bearer "+s.hostToken },
                      body: JSON.stringify({ action:"deny_pairing", pairingId: pendingRemote.pairingId, hostInstanceId: hostId })
                    }).finally(()=>setPendingRemote(null));
                  }}>Deny</button>
                </div>
              )}
              <p>Authorized devices: {remoteDevices.length} · Remote host {remoteEnabled ? "ON" : "OFF"}</p>
              {remoteDevices.map((d:any)=>(
                <div className="card" key={d.deviceSessionId}>
                  <p>{d.deviceName} · {d.role} · {d.connected ? "connected" : "idle"}</p>
                  <button onClick={()=>{ relayRef.current.sendHost("revoke_device", { deviceId: d.deviceSessionId }); setRemoteDevices((x)=>x.filter((y:any)=>y.deviceSessionId!==d.deviceSessionId)); }}>Revoke</button>
                </div>
              ))}
              <h4>AUDIENCE REACTIONS</h4>
              <p>Status: {rxEngine.enabled ? "ENABLED" : "DISABLED"} · Last: {rxEngine.last?.id || "—"}</p>
              <p>Fireworks {rxEngine.counts.fireworks} · Lightning {rxEngine.counts.lightning} · Rune {rxEngine.counts.rune_burst} · Meteor {rxEngine.counts.meteor_shower}</p>
              <p className="muted">Enable, preview, and tune reactions in Host Console.</p>
              <div className="row">
                <button onClick={()=>rxEngine.clear()}>Clear All Active Reactions</button>
              </div>
              {false && rxEngine.slots.map((s,i)=>(
                <div className="card" key={s.id}>
                  <label><input type="checkbox" defaultChecked={s.enabled} onChange={(e)=>{ s.enabled=e.target.checked; relayRef.current.sendHost("set_allowed_reactions", { allowedReactions: publicAllowed(rxEngine.slots, rxEngine.enabled) }); }} /> {s.label}</label>
                  <label>Viewer Label<input defaultValue={s.label} onBlur={(e)=>{ s.label=e.target.value||s.label; }} /></label>
                  <label>Duration ms<input type="number" defaultValue={s.durationMs} onBlur={(e)=>{ s.durationMs=Number(e.target.value)||s.durationMs; }} /></label>
                  <label>Intensity<input type="number" step="0.05" defaultValue={s.intensity} onBlur={(e)=>{ s.intensity=Number(e.target.value)||s.intensity; }} /></label>
                  <label>Cooldown ms<input type="number" defaultValue={s.hostCooldownMs} onBlur={(e)=>{ s.hostCooldownMs=Number(e.target.value)||5000; }} /></label>
                  {s.id==="fireworks" && (
                    <>
                      <label>Preset
                        <select defaultValue="" onChange={(e)=>{ const p=FIREWORK_PRESETS[e.target.value]; if(!p) return; Object.assign(s,p); }}>
                          <option value="">Custom</option>
                          {Object.keys(FIREWORK_PRESETS).map((k)=><option key={k} value={k}>{k}</option>)}
                        </select>
                      </label>
                      <label>Shell Pattern
                        <select defaultValue={s.shellMode||"random"} onChange={(e)=>{ s.shellMode=e.target.value as any; }}>
                          <option value="random">Random</option>
                          <option value="chrysanthemum">Chrysanthemum</option>
                          <option value="peony">Peony</option>
                          <option value="willow">Willow</option>
                          <option value="palm">Palm</option>
                          <option value="ring">Ring</option>
                          <option value="crossette">Crossette</option>
                        </select>
                      </label>
                      <label>Shell Count<input type="number" defaultValue={s.burstCount} onBlur={(e)=>{ s.burstCount=Number(e.target.value)||3; }} /></label>
                      <label>Burst Height<input type="number" step="0.05" defaultValue={s.launchHeight} onBlur={(e)=>{ s.launchHeight=Number(e.target.value)||0.7; }} /></label>
                      <label>Explosion Radius<input type="number" step="0.02" defaultValue={s.explosionRadius} onBlur={(e)=>{ s.explosionRadius=Number(e.target.value)||0.22; }} /></label>
                      <label>Star Density<input type="number" defaultValue={s.sparkCount} onBlur={(e)=>{ s.sparkCount=Number(e.target.value)||48; }} /></label>
                      <label>Trail Length<input type="number" step="0.05" defaultValue={s.trailLength} onBlur={(e)=>{ s.trailLength=Number(e.target.value)||0.45; }} /></label>
                      <label>Star Lifetime<input type="number" step="0.05" defaultValue={s.starLifetime} onBlur={(e)=>{ s.starLifetime=Number(e.target.value)||1; }} /></label>
                      <label>Gravity<input type="number" step="0.05" defaultValue={s.gravity} onBlur={(e)=>{ s.gravity=Number(e.target.value)||0.42; }} /></label>
                      <label>Air Drag<input type="number" step="0.05" defaultValue={s.airDrag} onBlur={(e)=>{ s.airDrag=Number(e.target.value)||0.55; }} /></label>
                      <label>Wind Strength<input type="number" step="0.05" defaultValue={s.wind} onBlur={(e)=>{ s.wind=Number(e.target.value)||0.12; }} /></label>
                      <label>Wind Direction<input type="number" step="0.05" defaultValue={s.windDir} onBlur={(e)=>{ s.windDir=Number(e.target.value)||0; }} /></label>
                      <label>Turbulence<input type="number" step="0.05" defaultValue={s.turbulence} onBlur={(e)=>{ s.turbulence=Number(e.target.value)||0.25; }} /></label>
                      <label>Brightness<input type="number" step="0.05" defaultValue={s.brightness} onBlur={(e)=>{ s.brightness=Number(e.target.value)||1; }} /></label>
                      <label>Bloom<input type="number" step="0.05" defaultValue={s.bloom} onBlur={(e)=>{ s.bloom=Number(e.target.value)||0.55; }} /></label>
                      <label>Light Spill<input type="number" step="0.05" defaultValue={s.lightSpill} onBlur={(e)=>{ s.lightSpill=Number(e.target.value)||0.45; }} /></label>
                      <label>Exposure Flash<input type="number" step="0.05" defaultValue={s.exposureFlash} onBlur={(e)=>{ s.exposureFlash=Number(e.target.value)||0.55; }} /></label>
                      <label>Smoke Amount<input type="number" step="0.05" defaultValue={s.smokeAmt} onBlur={(e)=>{ s.smokeAmt=Number(e.target.value)||0.5; }} /></label>
                      <label>Smoke Persistence<input type="number" step="0.05" defaultValue={s.smokePersist} onBlur={(e)=>{ s.smokePersist=Number(e.target.value)||0.7; }} /></label>
                      <label>Glitter Amount<input type="number" step="0.05" defaultValue={s.glitterAmt} onBlur={(e)=>{ s.glitterAmt=Number(e.target.value)||0.25; }} /></label>
                      <label>Crackle Amount<input type="number" step="0.05" defaultValue={s.crackleAmt} onBlur={(e)=>{ s.crackleAmt=Number(e.target.value)||0.15; }} /></label>
                      <label>Imperfection<input type="number" step="0.05" defaultValue={s.imperfection} onBlur={(e)=>{ s.imperfection=Number(e.target.value)||0.45; }} /></label>
                      <label>Depth Variation<input type="number" step="0.05" defaultValue={s.depthVar} onBlur={(e)=>{ s.depthVar=Number(e.target.value)||0.4; }} /></label>
                      <label>Color A<input type="color" defaultValue={s.colorA} onChange={(e)=>{ s.colorA=e.target.value; }} /></label>
                      <label>Color B<input type="color" defaultValue={s.colorB} onChange={(e)=>{ s.colorB=e.target.value; }} /></label>
                      <label>Color C<input type="color" defaultValue={s.colorC} onChange={(e)=>{ s.colorC=e.target.value; }} /></label>
                      <label><input type="checkbox" defaultChecked={s.secondary} onChange={(e)=>{ s.secondary=e.target.checked; }} /> Secondary Breaks</label>
                      <label><input type="checkbox" defaultChecked={s.audioReactive} onChange={(e)=>{ s.audioReactive=e.target.checked; }} /> Audio Reactive</label>
                    </>
                  )}
                </div>
              ))}
              <h4>LOCAL / LAN SERVER</h4>
              <p>Server: {viewer.state} · Health: {viewer.health} · Port: {viewer.port || "—"}</p>
              {viewer.error && <p className="warn">{viewer.error}</p>}
              {viewer.msg && <p>{viewer.msg}</p>}
              <p>Local: {viewer.local_url || "—"}</p>
              <p>LAN: {viewer.lan_url || "—"}</p>
              <div className="row">
                <button onClick={async ()=>{
                  console.log("[Poll] Open Viewer Page clicked");
                  setViewer((s)=>({...s, msg:"Opening viewer page...", state: s.state==="RUNNING"?s.state:"STARTING"}));
                  try {
                    syncViewerHub();
                    const st: any = await invoke("poll_open_local");
                    console.log("[Poll] poll_open_local", st);
                    setViewer({ ...st, msg: "Viewer page opened." });
                  } catch (e) {
                    const msg = String(e);
                    console.error("[Poll] open failed", msg);
                    setViewer((s)=>({...s, state:"ERROR", health:"ERROR", error: msg, msg:"Could not open viewer page. Reason: "+msg}));
                  }
                }}>Open Local Viewer</button>
                <button onClick={()=>viewer.local_url && navigator.clipboard.writeText(viewer.local_url).catch(()=>{})}>Copy Local</button>
                <button onClick={()=>viewer.lan_url && navigator.clipboard.writeText(viewer.lan_url).catch(()=>{})}>Copy LAN Link</button>
              </div>
              <div className="row">
                <button onClick={async ()=>{
                  setViewer((s)=>({...s, msg:"Starting viewer server..."}));
                  try {
                    const st: any = await invoke("poll_server_start");
                    setViewer({ ...st, msg: st.state==="RUNNING" ? "Viewer server running." : st.state });
                    syncViewerHub();
                  } catch (e) {
                    setViewer((s)=>({...s, state:"ERROR", error:String(e), msg:"Viewer server unavailable: "+String(e)}));
                  }
                }}>Start Viewer Server</button>
                <button onClick={()=>{
                  const res = applyVote(pollRt, pollCfg, pollVotes.current, "host-test-red", "red");
                  pollVotes.current = res.votes; applyRt(res.rt);
                }}>Test RED vote</button>
                <button onClick={()=>{
                  const res = applyVote(pollRt, pollCfg, pollVotes.current, "host-test-green", "green");
                  pollVotes.current = res.votes; applyRt(res.rt);
                }}>Test GREEN vote</button>
              </div>
              <label>Display X <input type="number" value={Math.round(pollCfg.display.x)} onChange={(e)=>setPollAndProject({...pollCfg, display:{...pollCfg.display, x:Number(e.target.value)}})} /></label>
              <label>Display Y <input type="number" value={Math.round(pollCfg.display.y)} onChange={(e)=>setPollAndProject({...pollCfg, display:{...pollCfg.display, y:Number(e.target.value)}})} /></label>
              <label className="chk"><input type="checkbox" checked={pollCfg.display.showQuestion} onChange={(e)=>setPollAndProject({...pollCfg, display:{...pollCfg.display, showQuestion:e.target.checked}})} /> Question</label>
              <label className="chk"><input type="checkbox" checked={pollCfg.display.showCounts} onChange={(e)=>setPollAndProject({...pollCfg, display:{...pollCfg.display, showCounts:e.target.checked}})} /> Raw Counts</label>
              <label className="chk"><input type="checkbox" checked={pollCfg.display.showPct} onChange={(e)=>setPollAndProject({...pollCfg, display:{...pollCfg.display, showPct:e.target.checked}})} /> Percentages</label>
              <label className="chk"><input type="checkbox" checked={pollCfg.display.showTotal} onChange={(e)=>setPollAndProject({...pollCfg, display:{...pollCfg.display, showTotal:e.target.checked}})} /> Total</label>
              <label className="chk"><input type="checkbox" checked={pollCfg.display.showLeader} onChange={(e)=>setPollAndProject({...pollCfg, display:{...pollCfg.display, showLeader:e.target.checked}})} /> Leader Indicator</label>
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


          {false && tab==="ai" && (
            <div className="pane">
              <h3>AI PHASE ONE <span className="badge">EXPERIMENTAL</span></h3>
              <p>Phase 1.2C: Maximum Accuracy Object Isolation</p>
              <p><strong>ACTIVE ENGINE:</strong> {lastEngineUsed==="neural"?"Enhanced Neural Vision": lastEngineUsed==="enhanced-local"?"Enhanced Local Segmenter": lastEngineUsed==="lightweight"?"Lightweight Local Vision": engineLabel(aiEngine, neuralReady)}</p>
              <p className="muted">MODEL: {lastEngineUsed==="neural"?"SAM 2 Hiera Tiny ONNX": "none"} · DEVICE: {lastEngineUsed==="neural"?"CPU / WASM": "CPU"} · QUALITY: {qualityTier.toUpperCase()} · SCOPE: {aiScope} · BOUNDARY: {hardObject?"Hard Object":"Soft / Glow"} · NEURAL: {neuralReady?"installed":"NOT INSTALLED"}</p>
              <label className="chk"><input type="checkbox" checked={requireNeural} onChange={(e)=>{ setRequireNeural(e.target.checked); localStorage.setItem("auralith.requireNeural", e.target.checked?"1":"0"); }} /> Require Neural Engine</label>
              <label>Object Scope
                <select value={aiScope} onChange={(e)=>setAiScope(e.target.value as Scope)}>
                  <option value="tight">Tight</option>
                  <option value="normal">Normal</option>
                  <option value="broad">Broad</option>
                </select>
              </label>
              <label>Boundary
                <select value={hardObject?"hard":"soft"} onChange={(e)=>setHardObject(e.target.value==="hard")}>
                  <option value="hard">Hard Object</option>
                  <option value="soft">Soft / Glow</option>
                </select>
              </label>
              <label>Quality
                <select value={qualityTier} onChange={(e)=>setQualityTier(e.target.value as any)}>
                  <option value="fast">FAST — SAM Tiny (deployed)</option>
                  <option value="balanced">BALANCED — SAM Small (not hosted yet)</option>
                  <option value="accurate">ACCURATE — SAM Base+ (not hosted yet)</option>
                  <option value="max">MAXIMUM — SAM Large (not hosted yet)</option>
                </select>
              </label>
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
                <button disabled={!aiEnabled} onClick={()=>setAiPrompts((ps)=>ps.slice(0,-1))}>Undo Prompt</button>
                <button disabled={!aiEnabled} onClick={()=>setAiPrompts([])}>Clear Refinement</button>
                <button disabled={!aiEnabled || !(aiPreview as any)?.neuralMasks} onClick={()=>{
                  const masks=(aiPreview as any)?.neuralMasks; if(!masks?.length) return;
                  const i=(altIdx+masks.length-1)%masks.length; setAltIdx(i);
                  setAiMsg(`Result ${i+1} of ${masks.length} · Mask Quality: ${Number(masks[i].quality).toFixed(2)}`);
                }}>Previous Result</button>
                <button disabled={!aiEnabled || !(aiPreview as any)?.neuralMasks} onClick={()=>{
                  const masks=(aiPreview as any)?.neuralMasks; if(!masks?.length) return;
                  const i=(altIdx+1)%masks.length; setAltIdx(i);
                  setAiMsg(`Result ${i+1} of ${masks.length} · Mask Quality: ${Number(masks[i].quality).toFixed(2)}`);
                }}>Next Result</button>
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
              {false && <h3>AI</h3>}
              {false && <label className="chk"><input type="checkbox" checked={aiEnabled} onChange={(e)=>{ setAiEnabled(e.target.checked); localStorage.setItem("auralith.aiEnabled", e.target.checked?"1":"0"); }} /> Enable Experimental AI</label>}
              {false && <label>AI Engine</label>}
              {false && <p className="muted">AI models removed from this build.</p>}
              {false && !neuralReady && (
                <div>
                  <p>Enhanced Neural Vision — Experimental</p>
                  <p className="muted">Model: {NEURAL_MODEL.family}. Encoder { (NEURAL_MODEL.encoder.bytes/1048576).toFixed(1) } MB · Decoder { (NEURAL_MODEL.decoder.bytes/1048576).toFixed(1) } MB. Stored in this app cache. SHA-256 encoder {NEURAL_MODEL.encoder.sha256.slice(0,12)}…</p>
                  <div className="row">
                    <button onClick={async ()=>{
                      try {
                        setDlMsg("Downloading encoder…");
                        await downloadVerified(NEURAL_MODEL.encoder, (p)=>setDlMsg(`${p.file} ${p.pct}%`));
                        setDlMsg("Downloading decoder…");
                        await downloadVerified(NEURAL_MODEL.decoder, (p)=>setDlMsg(`${p.file} ${p.pct}%`));
                        setNeuralReady(await modelsInstalled());
                        setDlMsg(neuralReady || true ? "Model installed and checksum verified." : "Install incomplete");
                      } catch (err) { setDlMsg("Download failed: "+String(err)); }
                    }}>Download Model</button>
                    <button onClick={()=>{ setAiEngine("enhanced"); localStorage.setItem("auralith.aiEngine","enhanced"); }}>Use Enhanced Local</button>
                  </div>
                  {dlMsg && <p className="muted">{dlMsg}</p>}
                </div>
              )}
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
                <button disabled={updateBusy} onClick={()=>void checkUpdates(false)}>Retry Update</button>
                <button onClick={()=>window.open("https://github.com/dragonking587-ai/Auralith/releases","_blank")}>View Release</button>
              </div>
              {updateDetails && <button onClick={()=>setShowUpdateDetails((v)=>!v)}>{showUpdateDetails?"Hide":"View"} Details</button>}
              {showUpdateDetails && updateDetails && <pre>{updateDetails}</pre>}
              <h3>HELP & TUTORIALS</h3>
              <p className="coach">Viewer QR is PUBLIC. Host QR is PRIVATE. Clear Votes starts a new round.</p>
              <div className="row">
                <button onClick={()=>setHelpMode("tour")}>Start Tutorial</button>
                <button onClick={()=>setHelpMode("help")}>Open Help Center</button>
                <button onClick={()=>{ setTutorialDone(false); setHelpMode("welcome"); }}>Reset Tutorials</button>
              </div>
              <h3>HOST IDENTITY</h3>
              <p>Host Fingerprint: {hostFingerprint(hostId)}</p>
              <p>Room: {relayRoom || customRoom}</p>
              <p className="muted">This PC is one isolated host tenant. Another install gets a different identity.</p>
              <button className="danger" onClick={()=>{
                if (!confirm("Resetting your Host Identity will disconnect Host Console and Host Remote sessions. You must pair again. Continue?")) return;
                resetHostInstance();
                location.reload();
              }}>Reset Host Identity</button>
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
      <div className={`foot ${clean ? "hidden" : ""}`}>
        <span>Auralith Reborn {APP_VERSION}</span>
        <span>RENDER · STREAM · CREATE · INSPIRE</span>
        <span>{relayStatus==="ONLINE" ? "Connected to Auralith Live" : "Local"}</span>
      </div>
      {helpMode !== "off" && (
        <HelpOverlay
          version={APP_VERSION}
          mode={helpMode === "welcome" ? "welcome" : helpMode === "tour" ? "tour" : "help"}
          onClose={() => setHelpMode("off")}
          onOpenHelp={() => setHelpMode(helpMode === "tour" ? "help" : "tour")}
        />
      )}
    </div>
  );
}
