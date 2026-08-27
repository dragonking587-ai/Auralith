import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Copy,
  Download,
  Eraser,
  Hand,
  ImagePlus,
  Layers,
  Mic,
  MonitorUp,
  Move,
  Redo2,
  ScanSearch,
  Spline,
  Trash2,
  Undo2,
  Volume2,
  Wand2,
  AppWindow,
} from "lucide-react";
import { APP_NAME, APP_VERSION } from "@/lib/auralith/version";
import { BAND_COLOR, BAND_LABEL, BANDS, EFFECT_LABEL, EFFECTS, type Scene, type ToolId } from "@/lib/auralith/types";
import { DETECT_MODE_LABEL, DETECT_MODES } from "@/lib/auralith/detect-lights";
import { getAudioEngine, hasMic, hasSystemAudio, listLoopbackDevices, type LoopbackDeviceInfo } from "@/lib/auralith/audio-engine";
import { groupedPresets } from "@/lib/auralith/presets";
import { ZERO_BANDS } from "@/lib/auralith/bands";
import { useAuralith } from "@/lib/auralith/store";
import { EditorCanvas } from "./EditorCanvas";
import type { LiveBands } from "@/lib/auralith/types";
import { DESKTOP_AUTO_UPDATE_KEY, DESKTOP_VERSION, desktopHttpOrigin, isDesktopApp } from "@/lib/auralith/platform";
import { applyDesktopUpdate, checkForUpdatesDetailed, resolveWindowsInstallerUrl, type UpdateCheckResult } from "@/lib/auralith/desktop-release";
import { vcamStart, vcamStop, vcamStatus, vcamInstall, type VcamStatus } from "@/lib/auralith/vcam";
import { setVcamCaptureActive } from "@/lib/auralith/vcam-bridge";
import { closeNativeBroadcast, openNativeBroadcast } from "@/lib/auralith/final-frame-provider";


const TOOLS: { id: ToolId; label: string; icon: typeof Circle }[] = [
  { id: "stamp", label: "Stamp", icon: Circle },
  { id: "trace", label: "Trace", icon: Spline },
  { id: "move", label: "Move", icon: Move },
  { id: "erase", label: "Erase", icon: Eraser },
  { id: "pan", label: "Frame", icon: Hand },
];

export function EditorShell() {
  const hydrate = useAuralith((s) => s.hydrate);
  const scene = useAuralith((s) => s.scene);
  const tool = useAuralith((s) => s.tool);
  const setTool = useAuralith((s) => s.setTool);
  const status = useAuralith((s) => s.status);
  const audioError = useAuralith((s) => s.audioError);
  const selectedId = useAuralith((s) => s.selectedId);
  const selected = scene.regions.find((r) => r.id === selectedId) ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"audio" | "look" | "out">("audio");
  const [copied, setCopied] = useState(false);
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const s = useAuralith.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") s.eraseSelected();
      if (e.key === "s" || e.key === "S") s.setTool("stamp");
      if (e.key === "t" || e.key === "T") s.setTool("trace");
      if (e.key === "v" || e.key === "V") s.setTool("move");
      if (e.key === "e" || e.key === "E") s.setTool("erase");
      if (e.key === "h" || e.key === "H") s.setTool("pan");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sessionId = useAuralith((s) => s.sessionId);
  const sourceUrl =
    typeof window === "undefined"
      ? ""
      : `${isDesktopApp() ? desktopHttpOrigin() : window.location.origin}/source/${sessionId}`;

  const openNativeOutput = async () => {
    const w = scene.output.width;
    const h = scene.output.height;
    console.info("[NativeBroadcast UI] Open requested", { w, h, desktop: isDesktopApp() });
    if (!isDesktopApp()) {
      console.error("[NativeBroadcast UI] not desktop — button should be hidden");
      return;
    }
    try {
      console.info("[NativeBroadcast UI] invoking broadcast_open");
      await openNativeBroadcast(w, h);
      console.info("[NativeBroadcast UI] broadcast_open resolved");
    } catch (e) {
      console.error("[NativeBroadcast UI] open failed", e);
      throw e;
    }
  };

  const openOutput = () => {
    // Legacy WebView Broadcast Output (fallback)
    const w = scene.output.width;
    const h = scene.output.height;
    useAuralith.getState().getPublisher()?.pushSnapshot();
    if (isDesktopApp()) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("open_output", {
          session: sessionId,
          width: w,
          height: h,
        }).catch(() => undefined),
      );
      return;
    }
    const maxW = Math.min(w, window.screen.availWidth * 0.9);
    const scale = maxW / w;
    const rev = scene.image?.rev ?? 0;
    const url = `/output?session=${encodeURIComponent(sessionId)}&irev=${rev}&t=${Date.now()}`;
    const features = `width=${Math.round(w * scale)},height=${Math.round(h * scale)},menubar=no,toolbar=no,location=no,status=no`;
    const popup = window.open(url ?? undefined, "auralith-broadcast-output", features);
    try {
      if (popup) popup.location.replace(url);
    } catch {
      /* popup just created */
    }
  };


  useEffect(() => {
    if (!isDesktopApp()) return;
    if (window.localStorage.getItem("auralith.broadcast.keepOpen") !== "1") return;
    const id = window.setTimeout(() => openOutput(), 1200);
    return () => window.clearTimeout(id);
    // openOutput closes over latest scene/session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(sourceUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="auralith-shell flex h-full min-h-0 flex-col bg-bg text-fg">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="font-display text-xl italic leading-tight tracking-tight">Auralith</p>
          <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">Reactive backgrounds</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <GhostBtn onClick={() => void useAuralith.getState().loadDemoScene()}>Demo Scene</GhostBtn>
          <GhostBtn onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-3.5" />
            Image
          </GhostBtn>
          {!isDesktopApp() ? <DownloadWindowsBtn /> : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void useAuralith.getState().loadImageFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[76px_minmax(0,1fr)_320px]">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const on = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                className={`flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-[10px] px-2 text-[10px] font-medium tracking-wide transition-colors duration-150 ${
                  on ? "bg-accent text-accent-fg" : "text-muted hover:bg-bg-subtle hover:text-fg"
                }`}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {t.label}
              </button>
            );
          })}
          <div className="mx-1 hidden h-px bg-border lg:block" />
          <IconBtn label="Undo" disabled={!useAuralith((s) => s.canUndo)} onClick={() => useAuralith.getState().undo()}>
            <Undo2 className="size-4" />
          </IconBtn>
          <IconBtn label="Redo" disabled={!useAuralith((s) => s.canRedo)} onClick={() => useAuralith.getState().redo()}>
            <Redo2 className="size-4" />
          </IconBtn>
          <IconBtn label="Clear" onClick={() => useAuralith.getState().clearRegions()}>
            <Trash2 className="size-4" />
          </IconBtn>
          <IconBtn label="Match Photo" onClick={() => useAuralith.getState().matchPhoto()}>
            <Wand2 className="size-4" />
          </IconBtn>
        </nav>

        <main className="relative h-[46vh] min-h-0 overflow-hidden lg:h-auto lg:min-h-0">
          <EditorCanvas />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
            <p className="pointer-events-auto max-w-xl rounded-[12px] bg-bg/80 px-3 py-2 text-xs text-muted">
              {status}
              {audioError ? <span className="mt-1 block text-danger">{audioError}</span> : null}
            </p>
          </div>
        </main>

        <aside className="flex max-h-[46vh] min-h-0 flex-col border-t border-border lg:max-h-none lg:border-t-0 lg:border-l">
          <div className="flex gap-1 border-b border-border p-2">
            {(
              [
                ["audio", "Audio"],
                ["look", "Look"],
                ["out", "Output"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`min-h-10 flex-1 rounded-[8px] text-xs font-medium ${
                  tab === id ? "bg-bg-subtle text-fg" : "text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "audio" ? (
              <AudioPane trackRef={trackRef} />
            ) : tab === "look" ? (
              <LookPane selected={selected} />
            ) : (
              <OutputPane
                sourceUrl={sourceUrl}
                copied={copied}
                onCopy={copyUrl}
                onWindow={openOutput}
                onNative={openNativeOutput}
                saveName={saveName}
                setSaveName={setSaveName}
              />
            )}
          </div>
        </aside>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-subtle">
        <span>
          <span className="auralith-mark tracking-[0.18em]">{APP_NAME}</span>{" "}{isDesktopApp() ? DESKTOP_VERSION : APP_VERSION}
        </span>
        <span className="tabular-nums">
          {scene.output.width}×{scene.output.height} · {scene.output.fps} FPS
        </span>
      </footer>
    </div>
  );
}

function AudioPane({ trackRef }: { trackRef: React.RefObject<HTMLInputElement | null> }) {
  const source = useAuralith((s) => s.audioSource);
  const scene = useAuralith((s) => s.scene);
  const setSource = useAuralith((s) => s.setSource);
  const [caps, setCaps] = useState({ mic: true, system: true });
  useEffect(() => {
    setCaps({ mic: hasMic(), system: hasSystemAudio() });
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <Section title="Source" icon={<Volume2 className="size-3.5" />}>
        <div className="grid grid-cols-2 gap-2">
          <SourceBtn active={source === "demo"} onClick={() => void setSource("demo")}>
            Demo Audio
          </SourceBtn>
          <SourceBtn
            active={source === "track"}
            onClick={() => trackRef.current?.click()}
          >
            Track
          </SourceBtn>
          <SourceBtn active={source === "mic"} disabled={!caps.mic} onClick={() => void setSource("mic")}>
            <Mic className="size-3.5" /> Mic
          </SourceBtn>
          <SourceBtn
            active={source === "system"}
            disabled={!caps.system}
            onClick={() => void setSource("system")}
          >
            <MonitorUp className="size-3.5" /> System
          </SourceBtn>
        </div>
        <input
          ref={trackRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void setSource("track", f);
            e.target.value = "";
          }}
        />
        <p className="text-[11px] leading-relaxed text-subtle">
          {isDesktopApp()
            ? "One engine. System audio is WASAPI loopback of the selected Windows output — YouTube, Chrome, Spotify, and games. Nothing is uploaded."
            : "One engine. Changing source disconnects the previous input. Mic and system audio are not monitored, to avoid feedback."}
        </p>
        {isDesktopApp() ? <LoopbackDeviceSelect /> : null}
      </Section>
      <Meters />
      <Section title="Response">
        <Slider label="Sensitivity" value={scene.audio.sensitivity} min={0.2} max={3} onChange={(v) => useAuralith.getState().setSensitivity(v)} />
        <Slider label="Master Intensity" value={scene.audio.masterIntensity} min={0} max={1.2} onChange={(v) => useAuralith.getState().setMaster(v)} />
        <Slider label="Room Dim" value={scene.audio.roomDim} min={0} max={0.85} onChange={(v) => useAuralith.getState().setRoomDim(v)} />
      </Section>
    </div>
  );
}

function LookPane({ selected }: { selected: ReturnType<typeof useAuralith.getState>["scene"]["regions"][number] | null }) {
  const scene = useAuralith((s) => s.scene);
  const detectMode = useAuralith((s) => s.detectMode);
  const detectStatus = useAuralith((s) => s.detectStatus);
  const suggestions = useAuralith((s) => s.suggestions);
  const picked = suggestions.filter((s) => s.picked).length;
  const showSurge = scene.defaultEffect === "surge" || selected?.effect === "surge";
  return (
    <div className="flex flex-col gap-4">
      <Section title="Paint with">
        <div className="grid grid-cols-4 gap-1">
          {BANDS.map((b) => (
            <Chip key={b} active={scene.defaultBand === b} color={BAND_COLOR[b]} onClick={() => useAuralith.getState().setDefaultBand(b)}>
              {BAND_LABEL[b]}
            </Chip>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {EFFECTS.map((ef) => (
            <Chip key={ef} active={scene.defaultEffect === ef} onClick={() => useAuralith.getState().setDefaultEffect(ef)}>
              {EFFECT_LABEL[ef]}
            </Chip>
          ))}
        </div>
        <label className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
          Color
          <input
            type="color"
            value={scene.defaultColor}
            onChange={(e) => useAuralith.getState().setDefaultColor(e.target.value)}
            className="h-8 w-12 cursor-pointer rounded-[6px] border border-border bg-transparent"
          />
        </label>
      </Section>

      <Section title="Smart Detect" icon={<ScanSearch className="size-3.5" />}>
        <p className="mb-1 text-[11px] text-subtle">Find likely lamps and fixtures in the photo. Review before accepting.</p>
        <div className="flex flex-wrap gap-1">
          {DETECT_MODES.map((m) => (
            <Chip key={m} active={detectMode === m} onClick={() => useAuralith.getState().setDetectMode(m)}>
              {DETECT_MODE_LABEL[m]}
            </Chip>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 min-h-9 w-full rounded-[8px] bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
          disabled={detectStatus === "running"}
          onClick={() => void useAuralith.getState().runSmartDetect()}
        >
          {detectStatus === "running" ? "Detecting…" : "Detect lights"}
        </button>
        {suggestions.length ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="text-[11px] text-muted">
              {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} · {picked} selected. Click a ring to toggle.
            </p>
            <div className="flex flex-wrap gap-1">
              {BANDS.map((b) => {
                const n = suggestions.filter((s) => s.band === b).length;
                if (!n) return null;
                return (
                  <span key={b} className="rounded-[6px] px-1.5 py-0.5 text-[10px] text-fg" style={{ background: `${BAND_COLOR[b]}33` }}>
                    {n} {BAND_LABEL[b]}
                  </span>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-1">
              <GhostBtn onClick={() => useAuralith.getState().acceptSuggestions(false)}>Accept all</GhostBtn>
              <GhostBtn onClick={() => useAuralith.getState().acceptSuggestions(true)}>Accept selected</GhostBtn>
            </div>
            <GhostBtn onClick={() => useAuralith.getState().rejectSuggestions()}>Reject</GhostBtn>
          </div>
        ) : null}
      </Section>

      {showSurge ? (
        <Section title="Light Surge">
          <p className="mb-1 text-[11px] text-subtle">Sustained energy makes the real light bloom and spill. The photograph stays still.</p>
          <Slider label="Intensity" value={scene.surge.intensity} min={0} max={1} onChange={(v) => useAuralith.getState().setSurge("intensity", v)} />
          <Slider label="Spread" value={scene.surge.spread} min={0} max={1} onChange={(v) => useAuralith.getState().setSurge("spread", v)} />
          <Slider label="Bloom" value={scene.surge.bloom} min={0} max={1} onChange={(v) => useAuralith.getState().setSurge("bloom", v)} />
          <Slider label="Response" value={scene.surge.response} min={0} max={1} onChange={(v) => useAuralith.getState().setSurge("response", v)} />
          <Slider label="Decay" value={scene.surge.decay} min={0} max={1} onChange={(v) => useAuralith.getState().setSurge("decay", v)} />
        </Section>
      ) : null}

      {selected ? (
        <Section title="Selected region">
          <div className="grid grid-cols-4 gap-1">
            {BANDS.map((b) => (
              <Chip key={b} active={selected.band === b} color={BAND_COLOR[b]} onClick={() => useAuralith.getState().updateSelected({ band: b })}>
                {BAND_LABEL[b]}
              </Chip>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {EFFECTS.map((ef) => (
              <Chip key={ef} active={selected.effect === ef} onClick={() => useAuralith.getState().updateSelected({ effect: ef })}>
                {EFFECT_LABEL[ef]}
              </Chip>
            ))}
          </div>
          <label className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
            Color
            <input
              type="color"
              value={selected.color}
              onChange={(e) => useAuralith.getState().updateSelected({ color: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded-[6px] border border-border bg-transparent"
            />
          </label>
          <Slider
            label="Region intensity"
            value={selected.intensity}
            min={0.2}
            max={1.5}
            onChange={(v) => useAuralith.getState().updateSelected({ intensity: v })}
          />
        </Section>
      ) : (
        <p className="text-xs text-subtle">Stamp or Trace a light, then assign Bass / Low / Mid / High.</p>
      )}

      <Section title="Image fit">
        <div className="grid grid-cols-3 gap-1">
          {(["fill", "fit", "stretch"] as const).map((fit) => (
            <Chip key={fit} active={scene.framing.fit === fit} onClick={() => useAuralith.getState().setFit(fit)}>
              {fit[0]!.toUpperCase() + fit.slice(1)}
            </Chip>
          ))}
        </div>
        <p className="text-[11px] text-subtle">Fill is the default. Use Frame to reposition. Stretch only if you choose it.</p>
      </Section>
    </div>
  );
}



function NativeGpuTestCard({ scene }: { scene: ReturnType<typeof useAuralith.getState>["scene"] }) {
  const [phase, setPhase] = useState("CLOSED");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let stop = false;
    const poll = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const st = (await invoke("gpu_test_status")) as {
          state?: string;
          width?: number;
          height?: number;
          target_fps?: number;
          actual_fps?: number;
          adapter?: string;
          feature_level?: string;
          last_error?: string | null;
        };
        if (stop) return;
        setPhase((st.state || "CLOSED").toUpperCase());
        const bits = [
          st.width && st.height ? `${st.width}×${st.height}` : "",
          st.target_fps ? `target ${st.target_fps} FPS` : "",
          st.actual_fps != null ? `actual ${st.actual_fps} FPS` : "",
          st.adapter || "",
          st.feature_level ? `FL ${st.feature_level}` : "",
        ].filter(Boolean);
        setInfo(bits.join(" · "));
        if (st.last_error) setErr(st.last_error);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  const open = async () => {
    setBusy(true);
    setErr(null);
    console.info("[NativeGpuTest UI] Open requested");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      console.info("[NativeGpuTest UI] invoking gpu_test_open");
      await invoke("gpu_test_open", {
        width: scene.output.width,
        height: scene.output.height,
        fps: scene.output.fps,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("ERROR");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("gpu_test_close");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mb-3 rounded-[12px] border border-border px-3 py-3">
      <div className="text-sm font-medium text-fg">NATIVE GPU TEST OUTPUT</div>
      <div className="mt-0.5 text-[11px] text-subtle">Phase 1 diagnostic — D3D11 / DXGI (not live scene)</div>
      <p className="mt-1 text-[11px] leading-snug text-subtle">
        Standalone HWND <span className="text-fg">Auralith — Native GPU Test Output</span>. Animated gold orb + energy
        band. No WebView, no hub, no Softcam.
      </p>
      <div className="mt-2 text-[11px] text-muted">
        Status: <span className="text-fg">{phase}</span>
        {info ? <span> · {info}</span> : null}
      </div>
      {err ? (
        <p className="mt-1 text-[11px] text-red-400" role="alert">
          {err}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void open()}
        className="mt-3 min-h-11 w-full rounded-[10px] bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-60"
      >
        Open Native GPU Test Output
      </button>
      {phase === "RUNNING" || phase === "STARTING" ? (
        <button
          type="button"
          onClick={() => void close()}
          className="mt-2 min-h-9 w-full rounded-[10px] border border-border px-3 text-xs text-muted"
        >
          Close Native GPU Test
        </button>
      ) : null}
    </div>
  );
}

function NativeBroadcastCard({
  scene,
  onOpenNative,
}: {
  scene: ReturnType<typeof useAuralith.getState>["scene"];
  onOpenNative: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState("");

  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const st = (await invoke("broadcast_status")) as {
          state?: string;
          width?: number;
          height?: number;
          backend?: string;
          last_error?: string | null;
        };
        if (cancelled) return;
        const s = (st.state || "CLOSED").toUpperCase();
        if (s === "RUNNING") {
          setPhase("running");
          setStatusLine(
            `${st.width || scene.output.width}×${st.height || scene.output.height} · ${scene.output.fps} FPS`,
          );
          setErr(null);
        } else if (s === "STARTING") {
          setPhase("starting");
        } else if (s === "ERROR") {
          setPhase("error");
          setErr(st.last_error || "Native Broadcast Output failed");
        } else if (phase !== "starting") {
          setPhase("idle");
        }
      } catch {
        /* ignore poll errors */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [scene.output.width, scene.output.height, scene.output.fps, phase]);

  const onClick = async () => {
    setPhase("starting");
    setErr(null);
    console.info("[NativeBroadcast UI] Open Native Broadcast Output clicked");
    try {
      await onOpenNative();
      setPhase("running");
      setStatusLine(
        `${scene.output.width}×${scene.output.height} · ${scene.output.fps} FPS`,
      );
    } catch (e) {
      setPhase("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className={`rounded-[12px] border px-3 py-3 ${
        phase === "running" ? "border-accent bg-bg-subtle" : "border-border"
      }`}
    >
      <div className="text-sm font-medium text-fg">NATIVE BROADCAST OUTPUT</div>
      <div className="mt-0.5 text-[11px] font-medium text-accent">Recommended</div>
      <p className="mt-1 text-[11px] leading-snug text-subtle">
        Native window for OBS / Streamlabs / TikTok LIVE Studio → Window Capture →{" "}
        <span className="text-fg">Auralith — Native Broadcast Output</span>. Prefer OBS
        “Windows 10 (1903+)”.
      </p>
      <div className="mt-2 text-[11px] text-muted">
        Status:{" "}
        <span className="text-fg">
          {phase === "idle" && "Closed"}
          {phase === "starting" && "Starting…"}
          {phase === "running" && `Running${statusLine ? ` · ${statusLine}` : ""}`}
          {phase === "error" && "Error"}
        </span>
      </div>
      {err ? (
        <p className="mt-1 text-[11px] text-red-400" role="alert">
          Native Broadcast Output failed to start. {err}
        </p>
      ) : null}
      <button
        type="button"
        disabled={phase === "starting"}
        onClick={() => void onClick()}
        className="mt-3 min-h-11 w-full rounded-[10px] bg-accent px-3 text-sm font-medium text-white disabled:opacity-60"
      >
        {phase === "running" ? "Re-open Native Broadcast Output" : "Open Native Broadcast Output"}
      </button>
      {phase === "error" ? (
        <button
          type="button"
          onClick={() => void onClick()}
          className="mt-2 min-h-9 w-full rounded-[10px] border border-border px-3 text-xs text-muted"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}


function OutputPane({
  sourceUrl,
  copied,
  onCopy,
  onWindow,
  onNative,
  saveName,
  setSaveName,
}: {
  sourceUrl: string;
  copied: boolean;
  onCopy: () => void;
  onWindow: () => void;
  onNative?: () => void | Promise<void>;
  saveName: string;
  setSaveName: (v: string) => void;
}) {
  const scene = useAuralith((s) => s.scene);
  const library = useAuralith((s) => s.library);
  const groups = useMemo(() => groupedPresets(), []);
  return (
    <div className="flex flex-col gap-4">
      <Section title="Streaming outputs">
        {isDesktopApp() ? <NativeGpuTestCard scene={scene} /> : null}

        {isDesktopApp() ? (
          <NativeBroadcastCard
            scene={scene}
            onOpenNative={async () => {
              useAuralith.getState().setOutputMethod("window");
              if (onNative) await onNative();
              else onWindow();
            }}
          />
        ) : null}

        <div className="mt-3 rounded-[12px] border border-border px-3 py-3">
          <div className="text-sm font-medium text-fg">Legacy Broadcast Output</div>
          <div className="mt-0.5 text-[11px] text-subtle">Fallback / WebView</div>
          <p className="mt-1 text-[11px] leading-snug text-subtle">
            Second WebView path. Window title:{" "}
            <span className="text-fg">Auralith — Legacy Broadcast Output</span>.
          </p>
          <button
            type="button"
            onClick={() => {
              useAuralith.getState().setOutputMethod("window");
              onWindow();
            }}
            className="mt-3 min-h-11 w-full rounded-[10px] border border-border px-3 text-sm font-medium text-fg"
          >
            Open Legacy Broadcast Output
          </button>
        </div>

        <div className="mt-3 rounded-[12px] border border-border px-3 py-3">
          <div className="text-sm font-medium text-fg">Virtual Camera</div>
          <div className="mt-0.5 text-[11px] text-subtle">Experimental</div>
          <p className="mt-1 text-[11px] leading-snug text-subtle">
            Appears as a webcam device. Use Broadcast Output until the live-frame bridge is fully reliable.
          </p>
          <p className="mt-1 text-[11px] text-muted">Configure below under Virtual Camera.</p>
        </div>

        <button
          type="button"
          onClick={() => useAuralith.getState().setOutputMethod("browser")}
          className={`mt-3 flex min-h-12 w-full flex-col items-start rounded-[12px] border px-3 py-2 text-left ${
            scene.output.method === "browser" ? "border-accent bg-bg-subtle" : "border-border"
          }`}
        >
          <span className="text-sm font-medium">Browser Source</span>
          <span className="text-[11px] text-subtle">Alternative — local URL for OBS Browser Source</span>
        </button>
      </Section>

      <Section title="Resolution">
        <select
          className="min-h-11 w-full rounded-[10px] border border-border bg-bg-elevated px-3 text-sm"
          value={scene.output.presetId}
          onChange={(e) => useAuralith.getState().setPreset(e.target.value)}
        >
          {groups.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {scene.output.presetId === "custom" ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Num label="Width" value={scene.output.width} onChange={(v) => useAuralith.getState().setCustomSize(v, scene.output.height)} />
            <Num label="Height" value={scene.output.height} onChange={(v) => useAuralith.getState().setCustomSize(scene.output.width, v)} />
          </div>
        ) : null}
        <div className="mt-2 grid grid-cols-2 gap-1">
          <Chip active={scene.output.fps === 60} onClick={() => useAuralith.getState().setFps(60)}>
            60 FPS
          </Chip>
          <Chip active={scene.output.fps === 30} onClick={() => useAuralith.getState().setFps(30)}>
            30 FPS
          </Chip>
        </div>
      </Section>

      <Section title="Browser Source URL">
        <p className="break-all rounded-[10px] bg-bg-subtle px-3 py-2 font-mono text-[11px] text-muted">{sourceUrl || "…"}</p>
        <GhostBtn onClick={onCopy} className="mt-2 w-full justify-center">
          <Copy className="size-3.5" />
          {copied ? "Copied" : "Copy URL"}
        </GhostBtn>
        <p className="text-[11px] leading-relaxed text-subtle">
          OBS / Streamlabs / TikTok LIVE Studio: add a Browser Source, paste this URL, match the resolution above. The source renders locally — it never receives video frames.
          {isDesktopApp() ? " This desktop URL is bound to 127.0.0.1 and does not use the cloud." : ""}
        </p>
      </Section>

      {isDesktopApp() ? <VirtualCameraSection scene={scene} /> : null}

      <Section title="Window Capture">
        <GhostBtn onClick={onWindow} className="w-full justify-center">
          <AppWindow className="size-3.5" />
          Open stream output
        </GhostBtn>
        <p className="text-[11px] leading-relaxed text-subtle">
          Opens “Auralith — Broadcast Output”. Capture that window. Editor marks never appear there.
        </p>
      </Section>

      {isDesktopApp() ? <DesktopUpdatesSection /> : null}

      <Section title="Saved scenes" icon={<Layers className="size-3.5" />}>
        <div className="flex gap-2">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={scene.name}
            className="min-h-11 flex-1 rounded-[10px] border border-border bg-bg-elevated px-3 text-sm"
          />
          <GhostBtn onClick={() => void useAuralith.getState().saveScene(saveName || scene.name)}>Save</GhostBtn>
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          {library.length === 0 ? <li className="text-xs text-subtle">No saved scenes yet.</li> : null}
          {library.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-[10px] bg-bg-subtle px-2 py-1.5">
              <button type="button" className="min-h-10 flex-1 truncate text-left text-sm" onClick={() => void useAuralith.getState().loadSaved(item.id)}>
                {item.name}
              </button>
              <button type="button" className="text-subtle hover:text-danger" onClick={() => useAuralith.getState().deleteSaved(item.id)}>
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}


function VirtualCameraSection({ scene }: { scene: Scene }) {
  const [status, setStatus] = useState<VcamStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState("");

  useEffect(() => {
    void vcamStatus().then(setStatus);
    return () => {
      setVcamCaptureActive(false);
    };
  }, []);

  const needsInstall =
    status != null &&
    !status.running &&
    (status.filter_registered === false || status.dll_loaded === false);

  const install = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setDetails("");
    try {
      const st = await vcamInstall();
      setStatus(st);
      if (!st.filter_registered) {
        setError(st.last_error || "Virtual Camera installation did not complete registration");
        setDetails(st.last_stage || "");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setDetails(msg);
      setStatus(await vcamStatus());
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (busy || status?.running || status?.state === "STARTING") return;
    setBusy(true);
    setError("");
    setDetails("");
    setVcamCaptureActive(false);
    try {
      const w = scene.output.width || 1920;
      const h = scene.output.height || 1080;
      const st = await vcamStart(w, h, 30);
      setStatus(st);
      if (!st.running) {
        setError(st.last_error || "Failed to start Virtual Camera");
        setDetails(st.last_stage || st.state || "");
        setVcamCaptureActive(false);
        return;
      }
      setVcamCaptureActive(true, st.width || w, st.height || h);
      const sessionId = useAuralith.getState().sessionId;
      useAuralith.getState().getPublisher()?.pushSnapshot();
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("open_output", {
          session: sessionId,
          width: st.width || w,
          height: st.height || h,
        }).catch(() => undefined),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setDetails(msg);
      setVcamCaptureActive(false);
      setStatus(await vcamStatus());
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setVcamCaptureActive(false);
    try {
      await vcamStop();
      setStatus(await vcamStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(await vcamStatus());
    } finally {
      setBusy(false);
    }
  };

  const failed = Boolean(error) || status?.state === "ERROR";

  return (
    <Section title="Virtual Camera (Experimental)">
      <p className="text-[11px] leading-relaxed text-subtle">
        Preferred output. Appears in OBS / Streamlabs / TikTok LIVE Studio as a Video Capture Device named{" "}
        <span className="text-fg">Auralith Virtual Camera</span>. Experimental webcam device. Prefer Broadcast Output for reliable Window Capture.
      </p>
      {status?.running ? (
        <>
          <p className="mt-2 text-xs text-fg">
            Status: <span className="text-warm">Running</span> · {status.width}×{status.height} · ~30 fps
          </p>
          <GhostBtn onClick={() => void stop()} className="mt-2 w-full justify-center" disabled={busy}>
            {busy ? "Stopping…" : "Stop Virtual Camera"}
          </GhostBtn>
        </>
      ) : needsInstall ? (
        <>
          <p className="mt-2 text-xs text-subtle">
            Status: Not installed — Windows does not yet list Auralith Virtual Camera
          </p>
          <p className="mt-1 text-[11px] text-subtle">
            A one-time install registers the DirectShow filter (Windows may show a UAC prompt). Auralith itself does not stay elevated.
          </p>
          <GhostBtn onClick={() => void install()} className="mt-2 w-full justify-center" disabled={busy}>
            {busy ? "Installing…" : "Install Virtual Camera"}
          </GhostBtn>
        </>
      ) : (
        <>
          {failed ? (
            <p className="mt-2 text-xs text-danger">Status: Failed to Start</p>
          ) : (
            <p className="mt-2 text-xs text-subtle">
              Status: {status?.filter_registered ? "Installed — ready" : "Stopped"}
            </p>
          )}
          <GhostBtn onClick={() => void start()} className="mt-2 w-full justify-center" disabled={busy}>
            {busy ? "Starting Virtual Camera…" : failed ? "Retry" : "Start Virtual Camera"}
          </GhostBtn>
        </>
      )}
      {error ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] text-danger">Reason: {error}</p>
          {details && details !== error ? (
            <p className="text-[11px] text-subtle">Details: {details}</p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-subtle">
        OBS / Streamlabs / TikTok LIVE Studio: Video Capture Device → Auralith Virtual Camera. Audio is not sent through the camera.
      </p>
    </Section>
  );
}

function DesktopUpdatesSection() {
  type Phase = "idle" | "checking" | "up_to_date" | "update_available" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const checkingRef = useRef(false);
  const [auto, setAuto] = useState(() => {
    try {
      // Default OFF until manual check is proven; only run auto if user opted in.
      return localStorage.getItem(DESKTOP_AUTO_UPDATE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const runCheck = async () => {
    if (checkingRef.current) {
      console.info("[Updater] Ignoring concurrent check (already CHECKING)");
      return;
    }
    checkingRef.current = true;
    setPhase("checking");
    setResult(null);
    console.info("[Updater] UI → CHECKING");
    try {
      const r = await checkForUpdatesDetailed(DESKTOP_VERSION);
      setResult(r);
      if (r.status === "up-to-date") {
        setPhase("up_to_date");
        console.info("[Updater] UI → UP_TO_DATE");
      } else if (r.status === "available") {
        setPhase("update_available");
        console.info("[Updater] UI → UPDATE_AVAILABLE");
      } else {
        setPhase("error");
        console.info("[Updater] UI → ERROR", r.status);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setResult({ status: "error", message, installed: DESKTOP_VERSION });
      setPhase("error");
      console.info("[Updater] UI → ERROR (thrown)", message);
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    if (!auto) return;
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const toggleAuto = (on: boolean) => {
    setAuto(on);
    try {
      localStorage.setItem(DESKTOP_AUTO_UPDATE_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const onUpdate = async () => {
    if (!result || result.status !== "available") return;
    setInstalling(true);
    try {
      const out = await applyDesktopUpdate(result.info);
      if (out.mode === "error") {
        setResult({
          status: "error",
          message: out.message || "Update failed",
          installed: DESKTOP_VERSION,
        });
        setPhase("error");
      }
    } catch (e) {
      setResult({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
        installed: DESKTOP_VERSION,
      });
      setPhase("error");
    } finally {
      setInstalling(false);
    }
  };

  const installed =
    (result && "installed" in result && result.installed) || DESKTOP_VERSION;
  const latest =
    result?.status === "up-to-date" || result?.status === "available"
      ? result.latest
      : null;

  return (
    <Section title="Updates">
      <p className="text-xs text-muted">
        Auralith Desktop · Version {DESKTOP_VERSION}
      </p>

      {phase === "checking" ? (
        <p className="mt-2 text-xs text-subtle">Checking for updates…</p>
      ) : null}

      {phase === "up_to_date" ? (
        <div className="mt-2 space-y-1 text-xs text-fg">
          <p>Auralith is up to date.</p>
          <p className="text-subtle">Installed: {installed}</p>
          {latest ? <p className="text-subtle">Latest: {latest}</p> : null}
        </div>
      ) : null}

      {phase === "update_available" && result?.status === "available" ? (
        <div className="mt-2 space-y-1 text-xs text-fg">
          <p className="text-warm">Update available</p>
          <p className="text-subtle">Installed: {installed}</p>
          <p className="text-subtle">Available: {result.latest}</p>
          {result.info.notes ? (
            <p className="mt-2 max-h-24 overflow-y-auto text-[11px] leading-relaxed text-subtle whitespace-pre-wrap">
              {result.info.notes.slice(0, 800)}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === "error" && result ? (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-danger">Unable to check for updates.</p>
          <p className="text-subtle">
            Installed: {"installed" in result ? result.installed : DESKTOP_VERSION}
          </p>
          <p className="text-subtle">
            Reason:{" "}
            {"message" in result ? result.message : "Unknown error"}
          </p>
        </div>
      ) : null}

      {phase === "idle" ? (
        <p className="mt-2 text-xs text-subtle">Press Check for Updates to query the update source.</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-10 rounded-[8px] border border-border bg-bg-elevated px-3 text-xs font-medium disabled:opacity-50"
          disabled={phase === "checking" || installing}
          onClick={() => void runCheck()}
        >
          {phase === "checking"
            ? "Checking…"
            : phase === "error"
              ? "Retry"
              : phase === "up_to_date"
                ? "Check Again"
                : phase === "update_available"
                  ? "Check Again"
                  : "Check for Updates"}
        </button>
        {phase === "update_available" && result?.status === "available" ? (
          <button
            type="button"
            className="min-h-10 rounded-[8px] border border-accent bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-50"
            disabled={installing}
            onClick={() => void onUpdate()}
          >
            {installing
              ? "Updating…"
              : result.info.canAutoInstall
                ? "Download and Install Update"
                : "Open Download Page"}
          </button>
        ) : null}
        {phase === "error" ? (
          <button
            type="button"
            className="min-h-10 rounded-[8px] border border-border bg-bg-elevated px-3 text-xs font-medium"
            onClick={() =>
              window.open(
                "https://github.com/dragonking587-ai/Auralith/releases",
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            Open Releases
          </button>
        ) : null}
      </div>
      <label className="mt-3 flex items-center gap-2 text-[11px] text-subtle">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => toggleAuto(e.target.checked)}
        />
        Automatically check for updates on startup
      </label>
      <p className="mt-2 text-[11px] leading-relaxed text-subtle">
        Checks a public update manifest over HTTPS (no GitHub credentials in the app). One-click install requires signed Tauri updater artifacts; until then Open Download Page opens the release page. Core features work fully offline.
      </p>
    </Section>
  );
}

function LoopbackDeviceSelect() {
  const [devices, setDevices] = useState<LoopbackDeviceInfo[]>([]);
  const [selected, setSelected] = useState("default");
  useEffect(() => {
    void listLoopbackDevices().then((list) => {
      setDevices(list);
      const def = list.find((d) => d.isDefault);
      if (def) setSelected(def.id);
    });
  }, []);
  if (!devices.length) return null;
  return (
    <label className="mt-2 flex flex-col gap-1 text-[11px] text-muted">
      Output to monitor
      <select
        className="min-h-10 rounded-[8px] border border-border bg-bg-elevated px-2 text-sm text-fg"
        value={selected}
        onChange={(e) => {
          const id = e.target.value;
          setSelected(id);
          getAudioEngine().setNativeDevice(id);
        }}
      >
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
            {d.isDefault ? " (default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function Meters() {
  const [bands, setBands] = useState<LiveBands | typeof ZERO_BANDS>(ZERO_BANDS);
  useEffect(() => {
    let last = 0;
    return getAudioEngine().subscribe((b) => {
      if (b.t - last < 50) return;
      last = b.t;
      setBands(b);
    });
  }, []);
  return (
    <Section title="Bands">
      <div className="flex flex-col gap-2">
        {BANDS.map((id) => (
          <div key={id} className="flex items-center gap-2">
            <span className="w-10 text-[11px] font-medium tracking-wide text-muted uppercase">{BAND_LABEL[id]}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-subtle">
              <div
                className="meter-fill h-full rounded-full"
                style={{
                  width: `${Math.min(100, bands[id] * 100)}%`,
                  background: BAND_COLOR[id],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] bg-bg-elevated p-3">
      <h2 className="mb-3 flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function DownloadWindowsBtn() {
  const [busy, setBusy] = useState(false);
  return (
    <GhostBtn
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void resolveWindowsInstallerUrl()
          .then((url) => {
            window.open(url ?? undefined, "_blank", "noopener,noreferrer");
          })
          .finally(() => setBusy(false));
      }}
    >
      <Download className="size-3.5" />
      {busy ? "Opening…" : "Download for Windows"}
    </GhostBtn>
  );
}

function GhostBtn({
  children,
  onClick,
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center gap-2 rounded-[12px] border border-border bg-bg-elevated px-3 text-sm font-medium text-fg transition-colors duration-150 hover:border-border-strong disabled:pointer-events-none disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-[10px] text-[10px] text-muted hover:bg-bg-subtle hover:text-fg disabled:opacity-30"
    >
      {children}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function SourceBtn({
  active,
  onClick,
  children,
  disabled,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border text-xs font-medium ${
        active ? "border-accent bg-accent text-accent-fg" : "border-border text-fg hover:bg-bg-subtle"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-[8px] border px-2 text-[11px] font-medium ${
        active ? "border-accent bg-bg-subtle text-fg" : "border-transparent bg-bg-subtle/60 text-muted"
      }`}
      style={active && color ? { boxShadow: `inset 0 -2px 0 ${color}` } : undefined}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mt-2 block">
      <span className="mb-1 flex justify-between text-[11px] text-muted">
        {label}
        <span className="tabular-nums text-subtle">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-[11px] text-muted">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 min-h-11 w-full rounded-[10px] border border-border bg-bg-elevated px-2 text-sm text-fg"
      />
    </label>
  );
}

