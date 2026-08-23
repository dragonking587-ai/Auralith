import { analyzeBands, ZERO_BANDS } from "./bands";
import { makeDemoBuffer } from "./demo-audio";
import { overallEnergy, stepBands } from "./envelope";
import { isDesktopApp } from "./platform";
import type { AudioSourceId, Bands, LiveBands } from "./types";

const FFT = 2048;

type Listener = (bands: LiveBands) => void;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private monitor: GainNode | null = null;
  private freq = new Uint8Array(FFT / 2);
  private sourceNode: AudioNode | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private stream: MediaStream | null = null;
  private element: HTMLAudioElement | null = null;
  private elementSource: MediaElementAudioSourceNode | null = null;
  private demoBuffer: AudioBuffer | null = null;
  private source: AudioSourceId = "none";
  private env: Bands = { ...ZERO_BANDS };
  private lastT = 0;
  private seq = 0;
  private listeners = new Set<Listener>();
  private sensitivity = 1;
  private monitorGain = 0.7;
  private muted = false;
  private owner = false;
  private nativeUnlisten: (() => void) | null = null;
  private nativeActive = false;

  getSource(): AudioSourceId {
    return this.source;
  }

  getBands(): LiveBands {
    return {
      ...this.env,
      t: this.ctx?.currentTime ?? 0,
      seq: this.seq,
      dim: 1 - overallEnergy(this.env),
      intensity: 1,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  }

  tick(now = performance.now()): LiveBands {
    if (this.nativeActive) {
      return this.getBands();
    }
    if (!this.analyser || !this.ctx) {
      return this.getBands();
    }
    const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    this.analyser.getByteFrequencyData(this.freq);
    const raw = analyzeBands(this.freq, this.ctx.sampleRate, this.analyser.fftSize, this.sensitivity);
    this.env = stepBands(this.env, raw, dt);
    this.seq += 1;
    const live: LiveBands = {
      ...this.env,
      t: now,
      seq: this.seq,
      dim: 1 - overallEnergy(this.env),
      intensity: 1,
    };
    for (const fn of this.listeners) fn(live);
    return live;
  }

  setSensitivity(v: number): void {
    this.sensitivity = v;
  }

  setMonitor(v: number): void {
    this.monitorGain = v;
    this.applyMonitor();
  }

  setMuted(v: boolean): void {
    this.muted = v;
    this.applyMonitor();
  }

  async setSource(next: AudioSourceId, file?: File): Promise<void> {
    await this.unlock();
    await this.disconnectSource();
    this.source = next;
    const ctx = this.ensureContext();

    if (next === "none") return;

    if (next === "demo") {
      if (!this.demoBuffer) this.demoBuffer = makeDemoBuffer(ctx);
      const src = ctx.createBufferSource();
      src.buffer = this.demoBuffer;
      src.loop = true;
      src.connect(this.analyser!);
      src.start();
      this.bufferSource = src;
      this.sourceNode = src;
      this.applyMonitor();
      return;
    }

    if (next === "track") {
      if (!file) return;
      const url = URL.createObjectURL(file);
      const el = new Audio();
      el.src = url;
      el.loop = true;
      el.crossOrigin = "anonymous";
      await el.play();
      const src = ctx.createMediaElementSource(el);
      src.connect(this.analyser!);
      this.element = el;
      this.elementSource = src;
      this.sourceNode = src;
      this.applyMonitor();
      return;
    }

    if (next === "mic") {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.attachStream(stream, false);
      return;
    }

    if (next === "system") {
      if (isDesktopApp()) {
        await this.startNativeLoopback();
        return;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      for (const track of stream.getVideoTracks()) track.stop();
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("System audio is not available in this browser. Use Window Capture or a Track instead.");
      }
      this.attachStream(stream, false);
    }
  }

  ingestNative(raw: Bands, now = performance.now()): void {
    const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    const s = this.sensitivity;
    const scaled: Bands = {
      bass: Math.min(1, raw.bass * s),
      low: Math.min(1, raw.low * s),
      mid: Math.min(1, raw.mid * s),
      high: Math.min(1, raw.high * s),
    };
    this.env = stepBands(this.env, scaled, dt);
    this.seq += 1;
    const live: LiveBands = {
      ...this.env,
      t: now,
      seq: this.seq,
      dim: 1 - overallEnergy(this.env),
      intensity: 1,
    };
    for (const fn of this.listeners) fn(live);
  }

  private nativeDeviceId: string | null = null;
  private nativeErrorUnlisten: (() => void) | null = null;

  setNativeDevice(id: string | null): void {
    this.nativeDeviceId = id && id !== "default" ? id : null;
    if (this.nativeActive) void this.startNativeLoopback();
  }

  private async startNativeLoopback(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    this.nativeUnlisten?.();
    this.nativeErrorUnlisten?.();
    await invoke("start_loopback", { deviceId: this.nativeDeviceId });
    this.nativeActive = true;
    this.nativeUnlisten = await listen<Bands>("loopback-bands", (ev) => {
      if (!this.nativeActive) return;
      this.ingestNative(ev.payload);
    });
    this.nativeErrorUnlisten = await listen<string>("loopback-error", (ev) => {
      this.nativeActive = false;
      console.warn("[auralith] loopback", ev.payload);
    });
  }

  private async stopNativeLoopback(): Promise<void> {
    this.nativeActive = false;
    this.nativeUnlisten?.();
    this.nativeUnlisten = null;
    this.nativeErrorUnlisten?.();
    this.nativeErrorUnlisten = null;
    if (!isDesktopApp()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_loopback");
    } catch {
      /* not running */
    }
  }

  dispose(): void {
    void this.disconnectSource();
    if (this.owner) {
      void this.ctx?.close();
      this.ctx = null;
    }
  }

  private attachStream(stream: MediaStream, monitor: boolean): void {
    const ctx = this.ensureContext();
    this.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(this.analyser!);
    this.mediaSource = src;
    this.sourceNode = src;
    this.muted = !monitor;
    this.applyMonitor();
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (this.stream === stream) void this.setSource("none");
    });
  }

  private async disconnectSource(): Promise<void> {
    await this.stopNativeLoopback();
    try {
      this.bufferSource?.stop();
    } catch {
      /* already stopped */
    }
    this.bufferSource?.disconnect();
    this.bufferSource = null;
    this.mediaSource?.disconnect();
    this.mediaSource = null;
    this.elementSource?.disconnect();
    this.elementSource = null;
    if (this.element) {
      this.element.pause();
      this.element.src = "";
      this.element = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.sourceNode = null;
    this.source = "none";
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const w = window as Window & { webkitAudioContext?: typeof AudioContext; __auralithAudio?: AudioEngine };
    const Ctx = window.AudioContext || w.webkitAudioContext;
    if (!Ctx) throw new Error("Web Audio is not supported in this browser.");
    const ctx = new Ctx({ latencyHint: "interactive" });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -22;
    const master = ctx.createGain();
    master.gain.value = 1;
    const monitor = ctx.createGain();
    monitor.gain.value = this.monitorGain;
    analyser.connect(monitor);
    monitor.connect(master);
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.analyser = analyser;
    this.master = master;
    this.monitor = monitor;
    this.owner = true;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.ctx?.resume();
    });
    return ctx;
  }

  private applyMonitor(): void {
    if (!this.monitor || !this.ctx) return;
    const hear = this.source === "demo" || this.source === "track";
    const g = this.muted || !hear ? 0 : this.monitorGain * this.monitorGain;
    this.monitor.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }
}

let engine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (engine) return engine;
  engine = new AudioEngine();
  return engine;
}

export function hasSystemAudio(): boolean {
  if (isDesktopApp()) return true;
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

export function hasMic(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export interface LoopbackDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export async function listLoopbackDevices(): Promise<LoopbackDeviceInfo[]> {
  if (!isDesktopApp()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<LoopbackDeviceInfo[]>("list_loopback_devices");
  } catch {
    return [];
  }
}

