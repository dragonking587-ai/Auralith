import { create } from "zustand";
import { getAudioEngine } from "./audio-engine";
import { cloneRegions, RegionHistory } from "./history";
import { uid } from "./id";
import { LivePublisher } from "./live-client";
import { matchPhotoColors } from "./match-photo";
import { createDemoScene, emptyScene, parseScene } from "./schema";
import {
  deleteNamedScene,
  getOrCreateSessionId,
  loadImageBlob,
  loadLibrary,
  loadNamedScene,
  loadSceneFromStorage,
  saveImageBlob,
  saveNamedScene,
  saveSceneToStorage,
} from "./storage";
import type {
  AudioSourceId,
  BandId,
  EffectId,
  FitMode,
  OutputMethod,
  Region,
  SavedSceneMeta,
  Scene,
  StampRegion,
  ToolId,
  TraceRegion,
} from "./types";
import { presetById } from "./presets";
import { DEMO_STAGE_URL } from "./schema";

const history = new RegionHistory();
let publisher: LivePublisher | null = null;
let imageEl: HTMLImageElement | null = null;
let imageUrl: string | null = null;
let lastPublishedScene = "";
let saveTimer = 0;

export interface AuralithState {
  scene: Scene;
  sessionId: string;
  tool: ToolId;
  selectedId: string | null;
  hoverId: string | null;
  draftTrace: { x: number; y: number }[] | null;
  tracing: boolean;
  audioSource: AudioSourceId;
  audioError: string | null;
  imageReady: boolean;
  library: SavedSceneMeta[];
  status: string;
  canUndo: boolean;
  canRedo: boolean;
  hydrate: () => Promise<void>;
  setTool: (tool: ToolId) => void;
  select: (id: string | null) => void;
  setHover: (id: string | null) => void;
  setDefaultBand: (band: BandId) => void;
  setDefaultEffect: (effect: EffectId) => void;
  setDefaultColor: (color: string) => void;
  updateSelected: (patch: Partial<Pick<Region, "band" | "effect" | "color" | "intensity">>) => void;
  addStamp: (x: number, y: number) => void;
  startTrace: (x: number, y: number) => void;
  appendTrace: (x: number, y: number) => void;
  endTrace: () => void;
  moveRegion: (id: string, dx: number, dy: number) => void;
  resizeStamp: (id: string, r: number) => void;
  eraseAt: (x: number, y: number) => void;
  eraseSelected: () => void;
  undo: () => void;
  redo: () => void;
  clearRegions: () => void;
  setSensitivity: (v: number) => void;
  setMaster: (v: number) => void;
  setRoomDim: (v: number) => void;
  setFlame: (key: "density" | "speed" | "heat", v: number) => void;
  setFit: (fit: FitMode) => void;
  setPan: (x: number, y: number) => void;
  setOutputMethod: (method: OutputMethod) => void;
  setPreset: (id: string) => void;
  setCustomSize: (w: number, h: number) => void;
  setFps: (fps: 30 | 60) => void;
  setSource: (source: AudioSourceId, file?: File) => Promise<void>;
  loadDemoScene: () => Promise<void>;
  loadImageFile: (file: File) => Promise<void>;
  matchPhoto: () => void;
  saveScene: (name?: string) => Promise<void>;
  loadSaved: (id: string) => Promise<void>;
  deleteSaved: (id: string) => void;
  getImage: () => HTMLImageElement | null;
  getPublisher: () => LivePublisher | null;
  publishNow: () => void;
  beginEdit: () => void;
}

function snapshot(): void {
  history.snapshot(useAuralith.getState().scene.regions);
}

function persistScene(scene: Scene): void {
  saveSceneToStorage(scene);
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    publisher?.publishScene(scene);
  }, 80);
}

function setRegions(regions: Region[], scenePatch?: Partial<Scene>): void {
  useAuralith.setState((s) => {
    const scene = { ...s.scene, ...scenePatch, regions };
    persistScene(scene);
    return { scene, canUndo: history.canUndo, canRedo: history.canRedo };
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

export const useAuralith = create<AuralithState>((set, get) => ({
  scene: emptyScene(),
  sessionId: "",
  tool: "stamp",
  selectedId: null,
  hoverId: null,
  draftTrace: null,
  tracing: false,
  audioSource: "none",
  audioError: null,
  imageReady: false,
  library: [],
  status: "Load a background or start the demo scene.",
  canUndo: false,
  canRedo: false,

  hydrate: async () => {
    const sessionId = getOrCreateSessionId();
    publisher = new LivePublisher(sessionId);
    const stored = loadSceneFromStorage();
    const library = loadLibrary();
    if (stored?.image) {
      const blob = await loadImageBlob(stored.image.id);
      if (blob) {
        imageUrl = blob;
        imageEl = await loadHtmlImage(blob);
        set({ scene: stored, sessionId, library, imageReady: true, status: "Restored last scene." });
        publisher.publishScene(stored);
        await publisher.publishImage(blob, stored.image.id);
        return;
      }
    }
    set({ sessionId, library });
    await get().loadDemoScene();
  },

  setTool: (tool) => set({ tool, tracing: false, draftTrace: null }),
  select: (id) => set({ selectedId: id }),
  setHover: (id) => set({ hoverId: id }),
  setDefaultBand: (band) =>
    set((s) => {
      const scene = { ...s.scene, defaultBand: band };
      persistScene(scene);
      return { scene };
    }),
  setDefaultEffect: (effect) =>
    set((s) => {
      const scene = { ...s.scene, defaultEffect: effect };
      persistScene(scene);
      return { scene };
    }),
  setDefaultColor: (color) =>
    set((s) => {
      const scene = { ...s.scene, defaultColor: color };
      persistScene(scene);
      return { scene };
    }),

  updateSelected: (patch) => {
    const { scene, selectedId } = get();
    if (!selectedId) return;
    snapshot();
    setRegions(
      scene.regions.map((r) => (r.id === selectedId ? ({ ...r, ...patch } as Region) : r)),
    );
  },

  addStamp: (x, y) => {
    const { scene } = get();
    snapshot();
    const stamp: StampRegion = {
      id: uid("stamp"),
      kind: "stamp",
      x,
      y,
      r: 0.045,
      band: scene.defaultBand,
      effect: scene.defaultEffect,
      color: scene.defaultColor,
      intensity: 1,
    };
    setRegions([...scene.regions, stamp]);
    set({ selectedId: stamp.id });
  },

  startTrace: (x, y) => set({ tracing: true, draftTrace: [{ x, y }] }),
  appendTrace: (x, y) =>
    set((s) => {
      const pts = s.draftTrace;
      if (!pts || !s.tracing) return s;
      const last = pts[pts.length - 1]!;
      if (Math.hypot(x - last.x, y - last.y) < 0.006) return s;
      return { draftTrace: [...pts, { x, y }] };
    }),
  endTrace: () => {
    const { draftTrace, scene } = get();
    set({ tracing: false, draftTrace: null });
    if (!draftTrace || draftTrace.length < 2) return;
    snapshot();
    const trace: TraceRegion = {
      id: uid("trace"),
      kind: "trace",
      points: draftTrace,
      width: 0.028,
      band: scene.defaultBand,
      effect: scene.defaultEffect,
      color: scene.defaultColor,
      intensity: 1,
    };
    setRegions([...scene.regions, trace]);
    set({ selectedId: trace.id });
  },

  moveRegion: (id, dx, dy) => {
    const { scene } = get();
    setRegions(
      scene.regions.map((r) => {
        if (r.id !== id) return r;
        if (r.kind === "stamp") {
          return { ...r, x: r.x + dx, y: r.y + dy };
        }
        return { ...r, points: r.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      }),
    );
  },

  resizeStamp: (id, r) => {
    const { scene } = get();
    setRegions(
      scene.regions.map((reg) => (reg.id === id && reg.kind === "stamp" ? { ...reg, r } : reg)),
    );
  },

  eraseAt: (x, y) => {
    const { scene } = get();
    const hit = scene.regions.find((r) => {
      if (r.kind === "stamp") return Math.hypot(r.x - x, r.y - y) <= r.r;
      return false;
    });
    if (!hit) {
      const traces = [...scene.regions].reverse().find((r) => {
        if (r.kind !== "trace") return false;
        for (let i = 1; i < r.points.length; i++) {
          const a = r.points[i - 1]!;
          const b = r.points[i]!;
          const vx = b.x - a.x;
          const vy = b.y - a.y;
          const len2 = vx * vx + vy * vy || 1;
          let t = ((x - a.x) * vx + (y - a.y) * vy) / len2;
          t = Math.max(0, Math.min(1, t));
          if (Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy)) <= r.width) return true;
        }
        return false;
      });
      if (!traces) return;
      snapshot();
      setRegions(scene.regions.filter((r) => r.id !== traces.id));
      set({ selectedId: null });
      return;
    }
    snapshot();
    setRegions(scene.regions.filter((r) => r.id !== hit.id));
    set({ selectedId: null });
  },

  eraseSelected: () => {
    const { scene, selectedId } = get();
    if (!selectedId) return;
    snapshot();
    setRegions(scene.regions.filter((r) => r.id !== selectedId));
    set({ selectedId: null });
  },

  undo: () => {
    const { scene } = get();
    const prev = history.undo(scene.regions);
    if (!prev) return;
    setRegions(prev);
  },
  redo: () => {
    const { scene } = get();
    const next = history.redo(scene.regions);
    if (!next) return;
    setRegions(next);
  },
  clearRegions: () => {
    snapshot();
    setRegions([]);
    set({ selectedId: null, status: "Cleared regions." });
  },

  setSensitivity: (v) => {
    getAudioEngine().setSensitivity(v);
    set((s) => {
      const scene = { ...s.scene, audio: { ...s.scene.audio, sensitivity: v } };
      persistScene(scene);
      return { scene };
    });
  },
  setMaster: (v) =>
    set((s) => {
      const scene = { ...s.scene, audio: { ...s.scene.audio, masterIntensity: v } };
      persistScene(scene);
      return { scene };
    }),
  setRoomDim: (v) =>
    set((s) => {
      const scene = { ...s.scene, audio: { ...s.scene.audio, roomDim: v } };
      persistScene(scene);
      return { scene };
    }),
  setFlame: (key, v) =>
    set((s) => {
      const scene = { ...s.scene, flame: { ...s.scene.flame, [key]: v } };
      persistScene(scene);
      return { scene };
    }),
  setFit: (fit) =>
    set((s) => {
      const scene = { ...s.scene, framing: { ...s.scene.framing, fit } };
      persistScene(scene);
      return { scene };
    }),
  setPan: (x, y) =>
    set((s) => {
      const scene = {
        ...s.scene,
        framing: {
          ...s.scene.framing,
          panX: Math.max(0, Math.min(1, x)),
          panY: Math.max(0, Math.min(1, y)),
        },
      };
      persistScene(scene);
      return { scene };
    }),
  setOutputMethod: (method) =>
    set((s) => {
      const scene = { ...s.scene, output: { ...s.scene.output, method } };
      persistScene(scene);
      return { scene };
    }),
  setPreset: (id) =>
    set((s) => {
      const p = presetById(id);
      const scene = {
        ...s.scene,
        output: {
          ...s.scene.output,
          presetId: p.id,
          platform: p.platform,
          width: p.width,
          height: p.height,
        },
      };
      persistScene(scene);
      return { scene };
    }),
  setCustomSize: (w, h) =>
    set((s) => {
      const scene = {
        ...s.scene,
        output: {
          ...s.scene.output,
          width: Math.max(16, Math.min(7680, Math.round(w))),
          height: Math.max(16, Math.min(7680, Math.round(h))),
          presetId: "custom" as const,
          platform: "custom" as const,
        },
      };
      persistScene(scene);
      return { scene };
    }),
  setFps: (fps) =>
    set((s) => {
      const scene = { ...s.scene, output: { ...s.scene.output, fps } };
      persistScene(scene);
      return { scene };
    }),

  setSource: async (source, file) => {
    set({ audioError: null, status: source === "none" ? "Audio stopped." : `Starting ${source}…` });
    try {
      await getAudioEngine().setSource(source, file);
      set({ audioSource: source, status: source === "none" ? "Audio stopped." : `Audio: ${source}` });
    } catch (err) {
      set({
        audioSource: "none",
        audioError: err instanceof Error ? err.message : "Could not start audio source.",
        status: "Audio source failed.",
      });
    }
  },

  loadDemoScene: async () => {
    history.reset();
    const scene = createDemoScene();
    imageUrl = DEMO_STAGE_URL;
    imageEl = await loadHtmlImage(DEMO_STAGE_URL);
    scene.image = { id: "demo-stage", width: imageEl.naturalWidth, height: imageEl.naturalHeight, mime: "image/jpeg" };
    persistScene(scene);
    set({
      scene,
      imageReady: true,
      selectedId: null,
      status: "Demo scene loaded. Start Demo Audio, then stamp more lights.",
      canUndo: false,
      canRedo: false,
    });
    publisher?.publishScene(scene);
    const res = await fetch(DEMO_STAGE_URL);
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    await saveImageBlob("demo-stage", dataUrl);
    await publisher?.publishImage(dataUrl, "demo-stage");
  },

  loadImageFile: async (file) => {
    const dataUrl = await blobToDataUrl(file);
    const img = await loadHtmlImage(dataUrl);
    const id = uid("img");
    await saveImageBlob(id, dataUrl);
    history.reset();
    const scene: Scene = {
      ...get().scene,
      name: file.name.replace(/\.[^.]+$/, "") || "Untitled",
      image: { id, width: img.naturalWidth, height: img.naturalHeight, mime: file.type || "image/jpeg" },
      regions: [],
    };
    imageEl = img;
    imageUrl = dataUrl;
    persistScene(scene);
    set({
      scene,
      imageReady: true,
      selectedId: null,
      status: "Image loaded. Stamp or Trace the lights you want to react.",
      canUndo: false,
      canRedo: false,
    });
    publisher?.publishScene(scene);
    await publisher?.publishImage(dataUrl, id);
  },

  matchPhoto: () => {
    const img = imageEl;
    const { scene } = get();
    if (!img || !scene.image) return;
    snapshot();
    const regions = matchPhotoColors(img, scene.image.width, scene.image.height, cloneRegions(scene.regions));
    setRegions(regions);
    set({ status: "Matched region colors to the photo. Original image is unchanged." });
  },

  saveScene: async (name) => {
    const scene = { ...get().scene, name: name || get().scene.name || "Untitled" };
    const meta = await saveNamedScene(scene, imageUrl);
    set({ scene, library: [meta, ...get().library.filter((s) => s.id !== meta.id)], status: `Saved “${scene.name}”.` });
    persistScene(scene);
  },

  loadSaved: async (id) => {
    const packed = await loadNamedScene(id);
    if (!packed) {
      set({ status: "Could not load that scene." });
      return;
    }
    const scene = parseScene(packed.scene) ?? packed.scene;
    if (packed.image) {
      imageUrl = packed.image;
      imageEl = await loadHtmlImage(packed.image);
      await publisher?.publishImage(packed.image, scene.image?.id ?? id);
    }
    history.reset();
    persistScene(scene);
    set({
      scene,
      imageReady: !!packed.image,
      selectedId: null,
      status: `Loaded “${scene.name}”.`,
      canUndo: false,
      canRedo: false,
    });
    publisher?.publishScene(scene);
  },

  deleteSaved: (id) => {
    deleteNamedScene(id);
    set({ library: get().library.filter((s) => s.id !== id) });
  },

  getImage: () => imageEl,
  getPublisher: () => publisher,
  beginEdit: () => {
    history.snapshot(get().scene.regions);
    set({ canUndo: history.canUndo, canRedo: history.canRedo });
  },
  publishNow: () => {
    const { scene } = get();
    const json = JSON.stringify(scene);
    if (json !== lastPublishedScene) {
      lastPublishedScene = json;
      publisher?.publishScene(scene);
    }
  },
}));

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
