/**
 * Low-latency audio analysis for Auralith.
 *
 * The public snapshot shape stays stable so existing scenes/presets continue to load,
 * but the analysis underneath is deliberately more physical than the old byte-bin
 * thresholding. It uses linear spectral energy, adaptive noise floors/ceilings,
 * attack/release envelopes, spectral-flux onset detection, an adaptive beat gate,
 * and a short refractory period so one kick does not fire several beats.
 */
export type AudioSnapshot = {
  raw: number; rms: number; bass: number; low: number; mid: number; high: number;
  fullMix: number; beat: number; transient: number;
};

const EMPTY: AudioSnapshot = {
  raw: 0, rms: 0, bass: 0, low: 0, mid: 0, high: 0,
  fullMix: 0, beat: 0, transient: 0,
};

const RANGES = {
  bass: [28, 90],
  low: [90, 280],
  mid: [280, 2600],
  high: [2600, 14000],
} as const;

const ATTACK = { bass: 0.010, low: 0.014, mid: 0.011, high: 0.007 };
const RELEASE = { bass: 0.24, low: 0.20, mid: 0.15, high: 0.105 };

type BandName = keyof typeof RANGES;
type BandDynamics = { env: number; floor: number; ceiling: number };

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function freqToBin(freq: number, sr: number, fft: number) {
  const ny = sr / 2;
  const bins = fft / 2;
  return clamp(Math.round((freq / ny) * bins), 0, bins - 1);
}

function dbToAmp(db: number) {
  if (!Number.isFinite(db) || db <= -150) return 0;
  return Math.pow(10, db / 20);
}

function step(cur: number, target: number, dt: number, atk: number, rel: number) {
  const tau = target > cur ? atk : rel;
  return cur + (target - cur) * (1 - Math.exp(-dt / Math.max(0.0008, tau)));
}

function bandEnergy(
  spectrumDb: Float32Array,
  sr: number,
  fft: number,
  loHz: number,
  hiHz: number,
) {
  const lo = freqToBin(loHz, sr, fft);
  const hi = Math.max(lo + 1, freqToBin(Math.min(hiHz, sr * 0.49), sr, fft));
  let power = 0;
  let peak = 0;
  let weightSum = 0;

  // A mild log-frequency weighting stops wide high-frequency bands from winning
  // only because they contain more FFT bins.
  for (let i = lo; i < hi; i++) {
    const amp = dbToAmp(spectrumDb[i] ?? -160);
    const hz = (i * sr) / fft;
    const weight = 1 / Math.sqrt(Math.max(35, hz));
    power += amp * amp * weight;
    weightSum += weight;
    if (amp > peak) peak = amp;
  }
  if (!weightSum) return 0;
  const rms = Math.sqrt(power / weightSum);
  return rms * 0.78 + peak * 0.22;
}

function normalizeBand(raw: number, d: BandDynamics, dt: number) {
  // Noise floor follows upward very slowly and drops faster when the source gets quiet.
  const floorTau = raw < d.floor ? 0.32 : 7.5;
  d.floor += (raw - d.floor) * (1 - Math.exp(-dt / floorTau));
  d.floor = Math.max(1e-6, d.floor);

  // Ceiling catches peaks quickly but relaxes slowly. This keeps quiet tracks reactive
  // without making a loud chorus pin every meter at 1.0.
  const targetCeil = Math.max(raw, d.floor * 2.4, 0.00008);
  const ceilTau = targetCeil > d.ceiling ? 0.055 : 3.2;
  d.ceiling += (targetCeil - d.ceiling) * (1 - Math.exp(-dt / ceilTau));
  d.ceiling = Math.max(d.floor + 0.00004, d.ceiling);

  const normalized = clamp((raw - d.floor * 1.08) / (d.ceiling - d.floor), 0, 1);
  // Slight compression gives usable motion in the middle of the range while keeping
  // real silence close to zero.
  return Math.pow(normalized, 0.72);
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
  private demoLfo: OscillatorNode | null = null;
  private raf = 0;
  private lastT = 0;

  private bands: Record<BandName, BandDynamics> = {
    bass: { env: 0, floor: 0.00002, ceiling: 0.012 },
    low: { env: 0, floor: 0.00002, ceiling: 0.010 },
    mid: { env: 0, floor: 0.00002, ceiling: 0.008 },
    high: { env: 0, floor: 0.00001, ceiling: 0.004 },
  };

  private spectrumDb = new Float32Array(0);
  private timeData = new Float32Array(0);
  private prevSpectrum = new Float32Array(0);

  private fluxMean = 0.004;
  private fluxVar = 0.00004;
  private beatEnv = 0;
  private transientEnv = 0;
  private lastBeatMs = -10_000;
  private prevPeak = 0;

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try { this.osc?.stop(); } catch { /* noop */ }
    try { this.demoLfo?.stop(); } catch { /* noop */ }
    this.osc = null;
    this.demoLfo = null;
    try { this.srcNode?.disconnect(); } catch { /* noop */ }
    this.srcNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.snapshot = { ...EMPTY };
    this.status = "STOPPED";
    this.sourceLabel = "";
    this.prevSpectrum = new Float32Array(0);
    this.beatEnv = 0;
    this.transientEnv = 0;
    this.prevPeak = 0;
  }

  async startDemo() {
    this.stop();
    const ctx = new AudioContext({ latencyHint: "interactive" });
    if (ctx.state === "suspended") await ctx.resume();

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 74;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 2.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 34;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.value = 0.13;
    osc.connect(gain);
    this.attach(ctx, gain, "Demo oscillator");
    osc.start();
    lfo.start();
    this.osc = osc;
    this.demoLfo = lfo;
    this.status = "CAPTURING";
  }

  async startMic() {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    const ctx = new AudioContext({ latencyHint: "interactive" });
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
    const ctx = new AudioContext({ latencyHint: "interactive" });
    if (ctx.state === "suspended") await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    this.stream = stream;
    tracks[0]!.onended = () => {
      this.status = "SOURCE ENDED";
      this.stop();
    };
    this.attach(ctx, src, tracks[0]!.label || "Shared audio");
    this.status = "CAPTURING";
  }

  private attach(ctx: AudioContext, node: AudioNode, label: string) {
    this.ctx = ctx;
    this.sourceLabel = label;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -18;
    node.connect(analyser);

    this.analyser = analyser;
    this.srcNode = node;
    this.spectrumDb = new Float32Array(analyser.frequencyBinCount);
    this.prevSpectrum = new Float32Array(analyser.frequencyBinCount);
    this.timeData = new Float32Array(analyser.fftSize);
    this.lastT = performance.now();

    const tick = () => {
      if (!this.analyser || !this.ctx) return;
      const now = performance.now();
      const dt = this.lastT ? clamp((now - this.lastT) / 1000, 0.001, 0.05) : 0.016;
      this.lastT = now;

      this.analyser.getFloatFrequencyData(this.spectrumDb);
      this.analyser.getFloatTimeDomainData(this.timeData);

      let peak = 0;
      let sumSq = 0;
      for (let i = 0; i < this.timeData.length; i++) {
        const v = this.timeData[i] ?? 0;
        peak = Math.max(peak, Math.abs(v));
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, this.timeData.length));
      const sr = this.ctx.sampleRate;
      const fft = this.analyser.fftSize;

      const target: Record<BandName, number> = {
        bass: 0, low: 0, mid: 0, high: 0,
      };
      (Object.keys(RANGES) as BandName[]).forEach((name) => {
        const [lo, hi] = RANGES[name];
        const rawBand = bandEnergy(this.spectrumDb, sr, fft, lo, hi);
        target[name] = normalizeBand(rawBand, this.bands[name], dt);
        this.bands[name].env = step(
          this.bands[name].env,
          target[name],
          dt,
          ATTACK[name],
          RELEASE[name],
        );
      });

      // Spectral flux: only count bins that increased this frame. Low-frequency flux
      // drives beat detection; full-band flux plus waveform crest movement drives
      // short transients such as snares, claps and pick attacks.
      const lowHi = freqToBin(280, sr, fft);
      const fullHi = freqToBin(Math.min(15000, sr * 0.47), sr, fft);
      let lowFlux = 0;
      let fullFlux = 0;
      let lowCount = 0;
      let fullCount = 0;
      for (let i = 1; i < fullHi; i++) {
        const amp = dbToAmp(this.spectrumDb[i] ?? -160);
        const prev = this.prevSpectrum[i] ?? 0;
        const delta = Math.max(0, amp - prev);
        this.prevSpectrum[i] = amp;
        fullFlux += delta;
        fullCount++;
        if (i <= lowHi) {
          lowFlux += delta;
          lowCount++;
        }
      }
      lowFlux /= Math.max(1, lowCount);
      fullFlux /= Math.max(1, fullCount);

      const adapt = 1 - Math.exp(-dt / 1.15);
      const fluxDelta = lowFlux - this.fluxMean;
      this.fluxMean += fluxDelta * adapt;
      this.fluxVar += (fluxDelta * fluxDelta - this.fluxVar) * adapt;
      const sigma = Math.sqrt(Math.max(1e-10, this.fluxVar));
      const threshold = this.fluxMean + sigma * 1.75 + 0.00003;
      const lowEnergy = this.bands.bass.env * 0.68 + this.bands.low.env * 0.32;
      const refractoryMs = 115;
      const beatHit = lowFlux > threshold && lowEnergy > 0.16 && now - this.lastBeatMs > refractoryMs;
      if (beatHit) {
        this.lastBeatMs = now;
        this.beatEnv = 1;
      } else {
        this.beatEnv *= Math.exp(-dt / 0.115);
      }

      const peakRise = Math.max(0, peak - this.prevPeak);
      this.prevPeak = peak;
      const fluxNorm = clamp(fullFlux / Math.max(0.00004, this.fluxMean * 1.8 + sigma), 0, 2);
      const transientTarget = clamp(fluxNorm * 0.58 + peakRise * 3.8 + this.bands.high.env * 0.12, 0, 1);
      this.transientEnv = step(this.transientEnv, transientTarget, dt, 0.004, 0.075);

      const bandMix =
        this.bands.bass.env * 0.34 +
        this.bands.low.env * 0.27 +
        this.bands.mid.env * 0.23 +
        this.bands.high.env * 0.16;
      const waveformEnergy = clamp(Math.sqrt(Math.max(0, rms)) * 1.85, 0, 1);
      const fullMix = clamp(bandMix * 0.78 + waveformEnergy * 0.22, 0, 1);

      this.snapshot = {
        raw: clamp(peak, 0, 1),
        rms: clamp(rms, 0, 1),
        bass: clamp(this.bands.bass.env, 0, 1),
        low: clamp(this.bands.low.env, 0, 1),
        mid: clamp(this.bands.mid.env, 0, 1),
        high: clamp(this.bands.high.env, 0, 1),
        fullMix,
        beat: clamp(this.beatEnv, 0, 1),
        transient: clamp(this.transientEnv, 0, 1),
      };

      this.raf = requestAnimationFrame(tick);
    };

    this.raf = requestAnimationFrame(tick);
  }
}
