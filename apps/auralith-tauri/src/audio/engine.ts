/** Port of auralith-tauri-final bands.ts + envelope.ts + AnalyserNode settings. */
export type AudioSnapshot = {
  raw: number; rms: number; bass: number; low: number; mid: number; high: number;
  fullMix: number; beat: number; transient: number;
};
const EMPTY: AudioSnapshot = { raw: 0, rms: 0, bass: 0, low: 0, mid: 0, high: 0, fullMix: 0, beat: 0, transient: 0 };
const RANGES = { bass: [20, 80], low: [80, 250], mid: [250, 2000], high: [2000, 12000] } as const;
const ATTACK = { bass: 0.006, low: 0.01, mid: 0.008, high: 0.004 };
const RELEASE = { bass: 0.16, low: 0.14, mid: 0.11, high: 0.08 };

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function freqToBin(freq: number, sr: number, fft: number) {
  const ny = sr / 2, bins = fft / 2;
  return clamp(Math.round((freq / ny) * bins), 0, bins - 1);
}
function bandRms(bins: Uint8Array, sr: number, fft: number, loHz: number, hiHz: number) {
  const lo = freqToBin(loHz, sr, fft), hi = Math.max(lo + 1, freqToBin(hiHz, sr, fft));
  let sum = 0, peak = 0, n = 0;
  for (let i = lo; i < hi; i++) { const v = (bins[i] ?? 0) / 255; sum += v * v; if (v > peak) peak = v; n++; }
  return n ? clamp(Math.sqrt(sum / n) * 0.55 + peak * 0.45, 0, 1) : 0;
}
function perc(raw: number) { return raw <= 0 ? 0 : Math.sqrt(clamp(raw, 0, 1)); }
function step(cur: number, target: number, dt: number, atk: number, rel: number) {
  const tau = target > cur ? atk : rel;
  return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(0.0008, tau)));
}

export class AudioEngine {
  snapshot: AudioSnapshot = { ...EMPTY };
  status = "STOPPED";
  sourceLabel = "";
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private srcNode: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private osc: OscillatorNode | null = null;
  private raf = 0;
  private env = { bass: 0, low: 0, mid: 0, high: 0 };
  private lastT = 0;
  private lastFlux = 0;

  stop() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    try { this.osc?.stop(); } catch { /* */ }
    this.osc = null;
    try { this.srcNode?.disconnect(); } catch { /* */ }
    this.srcNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close(); this.ctx = null; this.analyser = null;
    this.snapshot = { ...EMPTY };
    this.status = "STOPPED";
    this.sourceLabel = "";
  }

  async startDemo() {
    this.stop();
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 80;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 2.2;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 40;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    const gain = ctx.createGain(); gain.gain.value = 0.12;
    osc.connect(gain);
    this.attach(ctx, gain, "Demo oscillator");
    osc.start(); lfo.start();
    this.osc = osc;
    this.status = "CAPTURING";
  }

  async startMic() {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    this.stream = stream;
    this.attach(ctx, src, stream.getAudioTracks()[0]?.label || "Microphone");
    this.status = "CAPTURING";
  }

  /** Must be called from a trusted click. */
  async startSystemAudio() {
    this.stop();
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const tracks = stream.getAudioTracks();
    if (!tracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      this.status = "NO AUDIO TRACK";
      throw new Error("The selected surface did not provide audio. Enable audio sharing.");
    }
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    this.stream = stream;
    tracks[0].onended = () => { this.status = "SOURCE ENDED"; this.stop(); };
    this.attach(ctx, src, tracks[0].label || "Shared audio");
    this.status = "CAPTURING";
  }

  private attach(ctx: AudioContext, node: AudioNode, label: string) {
    this.ctx = ctx;
    this.sourceLabel = label;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    an.minDecibels = -90;
    an.maxDecibels = -22;
    node.connect(an);
    this.analyser = an;
    this.srcNode = node;
    this.lastT = performance.now();
    const tick = () => {
      if (!this.analyser || !this.ctx) return;
      const now = performance.now();
      const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 0.016;
      this.lastT = now;
      const freq = new Uint8Array(this.analyser.frequencyBinCount);
      const time = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteFrequencyData(freq);
      this.analyser.getByteTimeDomainData(time);
      let peak = 0, sum = 0;
      for (let i = 0; i < time.length; i++) {
        const v = (time[i]! - 128) / 128;
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
      const rms = Math.sqrt(sum / time.length);
      const sr = this.ctx.sampleRate, fft = this.analyser.fftSize;
      this.env.bass = step(this.env.bass, perc(bandRms(freq, sr, fft, RANGES.bass[0], RANGES.bass[1])), dt, ATTACK.bass, RELEASE.bass);
      this.env.low = step(this.env.low, perc(bandRms(freq, sr, fft, RANGES.low[0], RANGES.low[1])), dt, ATTACK.low, RELEASE.low);
      this.env.mid = step(this.env.mid, perc(bandRms(freq, sr, fft, RANGES.mid[0], RANGES.mid[1])), dt, ATTACK.mid, RELEASE.mid);
      this.env.high = step(this.env.high, perc(bandRms(freq, sr, fft, RANGES.high[0], RANGES.high[1])), dt, ATTACK.high, RELEASE.high);
      const full = clamp(this.env.bass * 0.4 + this.env.low * 0.25 + this.env.mid * 0.2 + this.env.high * 0.15, 0, 1);
      const flux = this.env.bass + this.env.low;
      const beat = flux > this.lastFlux * 1.25 + 0.12 ? 1 : Math.max(0, this.lastFlux * 0.82);
      const trans = Math.max(0, flux - this.lastFlux);
      this.lastFlux = flux;
      this.snapshot = { raw: peak, rms, bass: this.env.bass, low: this.env.low, mid: this.env.mid, high: this.env.high, fullMix: full, beat, transient: clamp(trans, 0, 1) };
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}
