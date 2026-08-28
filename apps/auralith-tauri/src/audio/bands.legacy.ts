import { clamp } from "./id.ts";
import { perceptual } from "./envelope.ts";
import { BAND_RANGES, type BandId, type Bands } from "./types.ts";

export function freqToBin(freq: number, sampleRate: number, fftSize: number): number {
  const nyquist = sampleRate / 2;
  const bins = fftSize / 2;
  return clamp(Math.round((freq / nyquist) * bins), 0, bins - 1);
}

export function bandRms(
  bins: Uint8Array,
  sampleRate: number,
  fftSize: number,
  loHz: number,
  hiHz: number,
): number {
  const lo = freqToBin(loHz, sampleRate, fftSize);
  const hi = Math.max(lo + 1, freqToBin(hiHz, sampleRate, fftSize));
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let i = lo; i < hi; i++) {
    const v = (bins[i] ?? 0) / 255;
    sum += v * v;
    if (v > peak) peak = v;
    n++;
  }
  if (n === 0) return 0;
  const rms = Math.sqrt(sum / n);
  // Mix peak so kick transients are not averaged away.
  return clamp(rms * 0.55 + peak * 0.45, 0, 1);
}

export function analyzeBands(
  bins: Uint8Array,
  sampleRate: number,
  fftSize: number,
  sensitivity: number,
): Bands {
  const raw = {} as Bands;
  (Object.keys(BAND_RANGES) as BandId[]).forEach((id) => {
    const [lo, hi] = BAND_RANGES[id];
    const v = bandRms(bins, sampleRate, fftSize, lo, hi);
    raw[id] = perceptual(clamp(v * sensitivity, 0, 1));
  });
  return raw;
}

export const ZERO_BANDS: Bands = { bass: 0, low: 0, mid: 0, high: 0 };
