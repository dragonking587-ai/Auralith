/* Port of auralith-tauri-final src/lib/auralith/bands.ts + envelope.ts + AnalyserNode settings. */
const FFT = 2048;
const RANGES = { bass: [20, 80], low: [80, 250], mid: [250, 2000], high: [2000, 12000] };
const ATTACK = { bass: 0.006, low: 0.01, mid: 0.008, high: 0.004 };
const RELEASE = { bass: 0.16, low: 0.14, mid: 0.11, high: 0.08 };
let ctx = null, analyser = null, source = null, stream = null, raf = 0;
let env = { bass: 0, low: 0, mid: 0, high: 0 };
let lastT = 0, lastBeat = 0;

function post(obj) {
  try { chrome.webview.postMessage(obj); } catch (e) { console.log(e); }
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function freqToBin(freq, sampleRate, fftSize) {
  const nyquist = sampleRate / 2;
  const bins = fftSize / 2;
  return clamp(Math.round((freq / nyquist) * bins), 0, bins - 1);
}
function bandRms(bins, sampleRate, fftSize, loHz, hiHz) {
  const lo = freqToBin(loHz, sampleRate, fftSize);
  const hi = Math.max(lo + 1, freqToBin(hiHz, sampleRate, fftSize));
  let sum = 0, peak = 0, n = 0;
  for (let i = lo; i < hi; i++) {
    const v = (bins[i] || 0) / 255;
    sum += v * v;
    if (v > peak) peak = v;
    n++;
  }
  if (!n) return 0;
  return clamp(Math.sqrt(sum / n) * 0.55 + peak * 0.45, 0, 1);
}
function perceptual(raw) { return raw <= 0 ? 0 : Math.sqrt(clamp(raw, 0, 1)); }
function stepEnv(cur, target, dt, atk, rel) {
  const tau = target > cur ? atk : rel;
  const coeff = 1 - Math.exp(-dt / Math.max(0.0008, tau));
  return cur + (target - cur) * coeff;
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("chooseAudioSource");
  if (btn) btn.addEventListener("click", onHtmlChoose);
  post({ type: "status", stage: "READY FOR SOURCE", htmlReady: true });
});

async function onHtmlChoose(ev) {
  const trusted = !!(ev && ev.isTrusted);
  const active = !!(navigator.userActivation && navigator.userActivation.isActive);
  post({ type: "click", trusted, userActivation: active });
  await startCapture(trusted, active);
}

async function startCapture(trusted, active) {
  stopCapture(false);
  post({ type: "status", stage: "REQUESTING PICKER", trusted: !!trusted, userActivation: !!active, getDisplayMediaCalled: true });
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      systemAudio: "include",
      preferCurrentTab: false
    });
  } catch (e) {
    post({ type: "error", message: "Capture permission was denied or getDisplayMedia failed: " + (e && e.message) });
    return;
  }
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();
  if (!audioTracks.length) {
    post({ type: "error", message: "The selected surface did not provide audio. Choose another window/screen/tab and enable audio sharing." });
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    return;
  }
  const track = audioTracks[0];
  track.onended = () => {
    post({ type: "status", stage: "SOURCE ENDED" });
    stopCapture(true);
  };
  ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  analyser = ctx.createAnalyser();
  analyser.fftSize = FFT;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -22;
  source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  post({
    type: "started",
    sampleRate: ctx.sampleRate,
    audioLabel: track.label || "audio",
    audioState: track.readyState,
    video: videoTracks.length > 0
  });
  lastT = performance.now();
  tick();
}

function tick() {
  if (!analyser || !ctx) return;
  const now = performance.now();
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
  lastT = now;
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const time = new Uint8Array(analyser.fftSize);
  analyser.getByteFrequencyData(freq);
  analyser.getByteTimeDomainData(time);
  let peak = 0, sum = 0;
  for (let i = 0; i < time.length; i++) {
    const v = (time[i] - 128) / 128;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / time.length);
  const rawBass = perceptual(bandRms(freq, ctx.sampleRate, analyser.fftSize, RANGES.bass[0], RANGES.bass[1]));
  const rawLow = perceptual(bandRms(freq, ctx.sampleRate, analyser.fftSize, RANGES.low[0], RANGES.low[1]));
  const rawMid = perceptual(bandRms(freq, ctx.sampleRate, analyser.fftSize, RANGES.mid[0], RANGES.mid[1]));
  const rawHigh = perceptual(bandRms(freq, ctx.sampleRate, analyser.fftSize, RANGES.high[0], RANGES.high[1]));
  env.bass = stepEnv(env.bass, rawBass, dt, ATTACK.bass, RELEASE.bass);
  env.low = stepEnv(env.low, rawLow, dt, ATTACK.low, RELEASE.low);
  env.mid = stepEnv(env.mid, rawMid, dt, ATTACK.mid, RELEASE.mid);
  env.high = stepEnv(env.high, rawHigh, dt, ATTACK.high, RELEASE.high);
  const full = clamp(env.bass * 0.4 + env.low * 0.25 + env.mid * 0.2 + env.high * 0.15, 0, 1);
  const flux = env.bass + env.low;
  const beat = flux > lastBeat * 1.25 + 0.12 ? 1 : Math.max(0, lastBeat * 0.82);
  const trans = Math.max(0, flux - lastBeat);
  lastBeat = flux;
  post({
    type: "audioSnapshot",
    timestamp: now,
    raw: peak,
    rms: rms,
    bass: env.bass,
    low: env.low,
    mid: env.mid,
    high: env.high,
    fullMix: full,
    beat: beat,
    transient: clamp(trans, 0, 1)
  });
  raf = requestAnimationFrame(tick);
}

function stopCapture(ended) {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  try { source && source.disconnect(); } catch (e) {}
  source = null;
  analyser = null;
  if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; }
  if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); stream = null; }
  env = { bass: 0, low: 0, mid: 0, high: 0 };
  if (!ended) post({ type: "status", stage: "STOPPED" });
}

window.startCapture = startCapture;
window.stopCapture = () => stopCapture(false);
post({ type: "status", stage: "READY" });
