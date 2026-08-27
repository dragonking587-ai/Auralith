import { clamp } from "./id.ts";
import type { BandId, Bands } from "./types.ts";

/** Fast attack + natural release, in seconds. */
export const ATTACK_S: Record<BandId, number> = {
  bass: 0.006,
  low: 0.01,
  mid: 0.008,
  high: 0.004,
};

export const RELEASE_S: Record<BandId, number> = {
  bass: 0.16,
  low: 0.14,
  mid: 0.11,
  high: 0.08,
};

export function stepEnvelope(current: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > current ? attack : release;
  const coeff = 1 - Math.exp(-dt / Math.max(0.0008, tau));
  return current + (target - current) * coeff;
}

export function applySensitivity(raw: number, sensitivity: number): number {
  const scaled = raw * sensitivity;
  if (scaled <= 1) return scaled;
  return 1 - Math.exp(-(scaled - 1));
}

export function perceptual(raw: number): number {
  if (raw <= 0) return 0;
  return Math.sqrt(clamp(raw, 0, 1));
}

export function stepBands(
  env: Bands,
  target: Bands,
  dt: number,
): Bands {
  return {
    bass: stepEnvelope(env.bass, target.bass, dt, ATTACK_S.bass, RELEASE_S.bass),
    low: stepEnvelope(env.low, target.low, dt, ATTACK_S.low, RELEASE_S.low),
    mid: stepEnvelope(env.mid, target.mid, dt, ATTACK_S.mid, RELEASE_S.mid),
    high: stepEnvelope(env.high, target.high, dt, ATTACK_S.high, RELEASE_S.high),
  };
}

export function bandLevel(bands: Bands, id: BandId): number {
  return bands[id];
}

export function overallEnergy(bands: Bands): number {
  return clamp(bands.bass * 0.4 + bands.low * 0.25 + bands.mid * 0.2 + bands.high * 0.15, 0, 1);
}
