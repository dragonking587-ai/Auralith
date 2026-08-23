/** Procedural 2-bar loop: kick-forward so reactivity is obvious. */
export function makeDemoBuffer(ctx: AudioContext): AudioBuffer {
  const bpm = 120;
  const beats = 8;
  const duration = (60 / bpm) * beats;
  const rate = ctx.sampleRate;
  const n = Math.floor(duration * rate);
  const buffer = ctx.createBuffer(2, n, rate);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);

  const beat = 60 / bpm;

  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const pos = t % duration;
    let s = 0;

    for (let k = 0; k < beats; k++) {
      const kt = pos - k * beat;
      if (kt >= 0 && kt < 0.18) {
        const env = Math.exp(-kt * 28);
        const f = 118 - kt * 420;
        s += Math.sin(2 * Math.PI * f * kt) * env * 0.95;
      }
    }

    for (let k = 1; k < beats; k += 2) {
      const kt = pos - k * beat;
      if (kt >= 0 && kt < 0.12) {
        const env = Math.exp(-kt * 22);
        s += Math.sin(2 * Math.PI * 180 * kt) * env * 0.28;
        s += (hash(i + k * 997) * 2 - 1) * env * 0.22;
      }
    }

    const hatStep = beat / 2;
    const hatIndex = Math.floor(pos / hatStep);
    const ht = pos - hatIndex * hatStep;
    if (ht < 0.04) {
      const env = Math.exp(-ht * 70);
      s += (hash(i * 13 + hatIndex) * 2 - 1) * env * (hatIndex % 2 === 0 ? 0.12 : 0.2);
    }

    const bassT = pos % (beat * 2);
    const note = bassT < beat ? 49 : 36.7;
    const bassEnv = 0.35 + 0.15 * Math.sin((pos / duration) * Math.PI * 2);
    s += Math.sin(2 * Math.PI * note * pos) * bassEnv * 0.22;
    s += Math.sin(2 * Math.PI * note * 2 * pos) * bassEnv * 0.05;

    const sparkle = Math.sin(2 * Math.PI * 3200 * pos) * Math.max(0, Math.sin(pos * Math.PI * 4)) * 0.03;
    s += sparkle;

    s = Math.tanh(s * 1.15);
    L[i] = s;
    R[i] = s * 0.96 + (hash(i + 3) - 0.5) * 0.01;
  }
  return buffer;
}

function hash(i: number): number {
  let x = (i | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}
