import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Copy,
  Eraser,
  Sparkles,
  Hand,
  ImagePlus,
  Layers,
  Mic,
  MonitorUp,
  Move,
  Redo2,
  Spline,
  Trash2,
  Undo2,
  Volume2,
  Wand2,
  AppWindow,
} from "lucide-react";
import { APP_NAME, APP_VERSION } from "@/lib/auralith/version";
import { BAND_COLOR, BAND_LABEL, BANDS, EFFECT_LABEL, EFFECTS, MAGIC_STYLES, MAGIC_STYLE_LABEL, type ToolId } from "@/lib/auralith/types";
import { getAudioEngine, hasMic, hasSystemAudio } from "@/lib/auralith/audio-engine";
import { groupedPresets } from "@/lib/auralith/presets";
import { ZERO_BANDS } from "@/lib/auralith/bands";
import { useAuralith } from "@/lib/auralith/store";
import { EditorCanvas } from "./EditorCanvas";
import type { LiveBands } from "@/lib/auralith/types";

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
  const sourceUrl = typeof window === "undefined" ? "" : `${window.location.origin}/source/${sessionId}`;

  const openOutput = () => {
    const w = scene.output.width;
    const h = scene.output.height;
    const maxW = Math.min(w, window.screen.availWidth * 0.9);
    const scale = maxW / w;
    window.open(
      `/output?session=${encodeURIComponent(sessionId)}`,
      "auralith-stream-output",
      `width=${Math.round(w * scale)},height=${Math.round(h * scale)},menubar=no,toolbar=no,location=no,status=no`,
    );
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
    <div className="flex h-dvh min-h-0 flex-col bg-bg text-fg">
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
          {APP_NAME} {APP_VERSION}
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
          One engine. Changing source disconnects the previous input. Mic and system audio are not monitored, to avoid feedback.
        </p>
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

      <Section title="Magic" icon={<Sparkles className="size-3.5" />}>
        <p className="mb-1 text-[11px] text-subtle">Style</p>
        <div className="flex flex-wrap gap-1">
          {MAGIC_STYLES.map((id) => (
            <Chip key={id} active={scene.magic.style === id} onClick={() => useAuralith.getState().setMagicStyle(id)}>
              {MAGIC_STYLE_LABEL[id]}
            </Chip>
          ))}
        </div>
        <Slider label="Intensity" value={scene.magic.intensity} min={0} max={1} onChange={(v) => useAuralith.getState().setMagic("intensity", v)} />
        <Slider label="Flow" value={scene.magic.flow} min={0} max={1} onChange={(v) => useAuralith.getState().setMagic("flow", v)} />
        <Slider label="Spread" value={scene.magic.spread} min={0} max={1} onChange={(v) => useAuralith.getState().setMagic("spread", v)} />
        <Slider label="Energy" value={scene.magic.energy} min={0} max={1} onChange={(v) => useAuralith.getState().setMagic("energy", v)} />
        {scene.magic.style === "dense" || scene.magic.style === "ribbons" ? (
          <Slider label="Density" value={scene.magic.density} min={0} max={1} onChange={(v) => useAuralith.getState().setMagic("density", v)} />
        ) : null}
        <p className="mb-1 mt-1 text-[11px] text-subtle">Distortion</p>
        <div className="flex flex-wrap gap-1">
          <Chip active={!scene.magic.distortion} onClick={() => useAuralith.getState().setMagicDistortion(false)}>
            Off
          </Chip>
          <Chip active={!!scene.magic.distortion} onClick={() => useAuralith.getState().setMagicDistortion(true)}>
            On
          </Chip>
        </div>
        <p className="text-[11px] leading-relaxed text-subtle">
          {scene.magic.distortion
            ? "Localized air-warp under Magic only. The rest of the photograph stays still."
            : scene.magic.style === "dense"
              ? "Dense Spell is a heavier volumetric look. Nearby stamps still share a field so they blend, not blow out."
              : scene.magic.style === "ribbons"
                ? "Ethereal Ribbons: broad silk-like volumes that rise, twist and fold. Fine motes orbit as a secondary layer."
                : "Nearby Magic stamps share an energy field so they blend, not blow out. The source image stays pixel-locked."}
        </p>
      </Section>

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
        </p>
      </Section>

      <Section title="Window Capture">
        <GhostBtn onClick={onWindow} className="w-full justify-center">
          <AppWindow className="size-3.5" />
          Open stream output
        </GhostBtn>
        <p className="text-[11px] leading-relaxed text-subtle">
          Opens “Auralith — Stream Output”. Capture that window. Editor marks never appear there.
        </p>
      </Section>

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

