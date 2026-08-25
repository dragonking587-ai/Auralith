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
import { vcamStart, vcamStop, vcamStatus, type VcamStatus } from "@/lib/auralith/vcam";
import { setVcamCaptureActive } from "@/lib/auralith/vcam-bridge";


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

  const openOutput = () => {
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
    const popup = window.open(url ?? undefined, "auralith-stream-output", features);
    try {
      if (popup) popup.location.replace(url);
    } catch {
      /* popup just created */
    }
  };

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
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg">
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
                saveName={saveName}
                setSaveName={setSaveName}
              />
            )}
          </div>
        </aside>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-subtle">
        <span>
          {APP_NAME} {isDesktopApp() ? DESKTOP_VERSION : APP_VERSION}
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

function OutputPane({
  sourceUrl,
  copied,
  onCopy,
  onWindow,
  saveName,
  setSaveName,
}: {
  sourceUrl: string;
  copied: boolean;
  onCopy: () => void;
  onWindow: () => void;
  saveName: string;
  setSaveName: (v: string) => void;
}) {
  const scene = useAuralith((s) => s.scene);
  const library = useAuralith((s) => s.library);
  const groups = useMemo(() => groupedPresets(), []);
  return (
    <div className="flex flex-col gap-4">
      <Section title="Output method">
        <button
          type="button"
          onClick={() => useAuralith.getState().setOutputMethod("browser")}
          className={`flex min-h-12 w-full flex-col items-start rounded-[12px] border px-3 py-2 text-left ${
            scene.output.method === "browser" ? "border-accent bg-bg-subtle" : "border-border"
          }`}
        >
          <span className="text-sm font-medium">Browser Source</span>
          <span className="text-[11px] text-subtle">Lowest latency where supported</span>
        </button>
        <button
          type="button"
          onClick={() => useAuralith.getState().setOutputMethod("window")}
          className={`mt-2 flex min-h-12 w-full flex-col items-start rounded-[12px] border px-3 py-2 text-left ${
            scene.output.method === "window" ? "border-accent bg-bg-subtle" : "border-border"
          }`}
        >
          <span className="text-sm font-medium">Window Capture</span>
          <span className="text-[11px] text-subtle">Maximum compatibility</span>
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
          Opens “Auralith — Stream Output”. Capture that window. Editor marks never appear there.
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

  useEffect(() => {
    void vcamStatus().then(setStatus);
    return () => {
      setVcamCaptureActive(false);
    };
  }, []);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const st = await vcamStart(scene.output.width, scene.output.height, scene.output.fps || 30);
      setStatus(st);
      setVcamCaptureActive(true, scene.output.width, scene.output.height);
      // Stream Output runs the same final renderer that feeds the virtual camera.
      const sessionId = useAuralith.getState().sessionId;
      useAuralith.getState().getPublisher()?.pushSnapshot();
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("open_output", {
          session: sessionId,
          width: scene.output.width,
          height: scene.output.height,
        }).catch(() => undefined),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVcamCaptureActive(false);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError("");
    try {
      await vcamStop();
      setVcamCaptureActive(false);
      setStatus(await vcamStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Virtual Camera">
      <p className="text-[11px] leading-relaxed text-subtle">
        Preferred output. Appears in OBS / Streamlabs / TikTok LIVE Studio as a Video Capture Device named{" "}
        <span className="text-fg">Auralith Virtual Camera</span>. Feeds the same final stream as Window Capture (no editor UI).
      </p>
      {status?.running ? (
        <>
          <p className="mt-2 text-xs text-fg">
            Status: <span className="text-warm">Running</span> · {status.width}×{status.height} · {status.fps} fps
          </p>
          <GhostBtn onClick={() => void stop()} className="mt-2 w-full justify-center">
            Stop Virtual Camera
          </GhostBtn>
        </>
      ) : (
        <GhostBtn onClick={() => void start()} className="mt-2 w-full justify-center">
          {busy ? "Starting…" : "Start Virtual Camera"}
        </GhostBtn>
      )}
      {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
      {status && !status.dll_loaded && !status.running ? (
        <p className="mt-2 text-[11px] text-subtle">
          softcam.dll is not loaded. Reinstall Auralith (Virtual Camera component registers the DirectShow filter).
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-subtle">
        OBS / Streamlabs / TikTok LIVE Studio: Video Capture Device → Auralith Virtual Camera. Open Stream Output so final frames are fed to the camera. Audio is not sent through the camera — use System Audio / WASAPI in Auralith for effects only.
      </p>
    </Section>
  );
}

function DesktopUpdatesSection() {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [auto, setAuto] = useState(() => {
    try {
      return localStorage.getItem(DESKTOP_AUTO_UPDATE_KEY) !== "0";
    } catch {
      return true;
    }
  });

  const runCheck = async () => {
    setChecking(true);
    try {
      setResult(await checkForUpdatesDetailed());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(() => {
      void checkForUpdatesDetailed().then(setResult);
    }, 2500);
    return () => window.clearTimeout(t);
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
        setResult({ status: "error", message: out.message || "Update failed" });
      }
    } finally {
      setInstalling(false);
    }
  };

  let statusLine = "Not checked yet.";
  if (checking) statusLine = "Checking…";
  else if (installing) statusLine = "Downloading and installing update…";
  else if (result?.status === "up-to-date") statusLine = "Auralith is up to date.";
  else if (result?.status === "available") {
    statusLine = result.info.canAutoInstall
      ? `Update available: ${result.info.tag} (one-click install ready)`
      : `Update available: ${result.info.tag}`;
  } else if (result?.status === "offline") statusLine = "No internet connection.";
  else if (result?.status === "private-channel") statusLine = result.message;
  else if (result?.status === "error") statusLine = result.message;

  return (
    <Section title="Updates">
      <p className="text-xs text-muted">
        Auralith Desktop · Version {DESKTOP_VERSION}
      </p>
      <p className="mt-2 text-xs text-subtle">{statusLine}</p>
      {result?.status === "available" && result.info.notes ? (
        <p className="mt-2 max-h-24 overflow-y-auto text-[11px] leading-relaxed text-subtle whitespace-pre-wrap">
          {result.info.notes.slice(0, 800)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-10 rounded-[8px] border border-border bg-bg-elevated px-3 text-xs font-medium"
          disabled={checking || installing}
          onClick={() => void runCheck()}
        >
          {checking ? "Checking…" : "Check for Updates"}
        </button>
        {result?.status === "available" ? (
          <button
            type="button"
            className="min-h-10 rounded-[8px] border border-accent bg-accent px-3 text-xs font-medium text-accent-fg"
            disabled={installing}
            onClick={() => void onUpdate()}
          >
            {installing ? "Updating…" : "Update Auralith"}
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
        Updates never embed GitHub credentials. Core features work fully offline. Automatic install without your approval is disabled for test builds — click Update Auralith to proceed.
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-[12px] border border-border bg-bg-elevated px-3 text-sm font-medium text-fg transition-colors duration-150 hover:border-border-strong ${className}`}
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

