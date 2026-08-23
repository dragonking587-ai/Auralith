import { clamp } from "./id.ts";
import { stepEnvelope } from "./envelope.ts";

/** Perceptual lift so mid-slider values are already useful. */
export function easeUp(v: number, p = 0.62): number {
  return Math.pow(clamp(v, 0, 1), p);
}

export interface SurgeDriveInput {
  level: number;
  env: number;
  swell: number;
  intensity: number;
  response: number;
  decay: number;
  strength: number;
  dt: number;
}

export interface SurgeDrive {
  env: number;
  swell: number;
  amount: number;
}

/**
 * Light Surge drive: fast-enough envelope + slower swell that builds only
 * while the band stays elevated. Detected strength boosts, never vetoes.
 */
export function stepSurgeDrive(input: SurgeDriveInput): SurgeDrive {
  const response = clamp(input.response, 0, 1);
  const attack = 0.032 + (1 - response) * 0.09;
  const release = 0.14 + clamp(input.decay, 0, 1) * 0.38;
  const level = clamp(input.level, 0, 1.4);
  const envTarget = level < 0.045 ? 0 : Math.pow(Math.min(1, level), 0.72);
  const env = clamp(stepEnvelope(input.env, envTarget, input.dt, attack, release), 0, 1);

  const swellTarget = level > 0.4 ? clamp((level - 0.26) / 0.74, 0, 1) : 0;
  const swell = clamp(stepEnvelope(input.swell, swellTarget, input.dt, 0.2, 0.24 + clamp(input.decay, 0, 1) * 0.32), 0, 1);

  const intensity = easeUp(input.intensity, 0.58);
  const respGain = 0.48 + easeUp(response, 0.66) * 1.12;
  const strengthGain = 0.82 + clamp(input.strength, 0.2, 1) * 0.38;
  const body = clamp(env * (0.68 + swell * 0.62), 0, 1.2);
  const amount = clamp(body * intensity * respGain * strengthGain, 0, 1.42);
  return { env, swell, amount };
}

export function surgeSpillScale(spread: number, amount: number): number {
  const s = easeUp(spread, 0.68);
  return 1.7 + s * (4.4 + amount * 2.6);
}

export function surgeBloomScale(bloom: number, amount: number): number {
  const b = easeUp(bloom, 0.62);
  return 1.4 + b * (3.5 + amount * 2.1);
}
