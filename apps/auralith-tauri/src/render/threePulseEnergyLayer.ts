import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

export const PULSE_ENERGY_KINDS = new Set<EffectKind>([
  "Pulse", "Flicker", "LightSurge", "Strobe", "BreathingGlow", "Afterglow",
  "EchoPulse", "WaveSweep", "Shockwave", "EnergyFlow", "EnergyRipple"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  Pulse: 1,
  Flicker: 2,
  LightSurge: 3,
  Strobe: 4,
  BreathingGlow: 5,
  Afterglow: 6,
  EchoPulse: 7,
  WaveSweep: 8,
  Shockwave: 9,
  EnergyFlow: 10,
  EnergyRipple: 11,
};

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform float uMode;
  uniform float uP0;
  uniform float uP1;
  uniform float uP2;
  uniform float uDrive;
  uniform float uBass;
  uniform float uLow;
  uniform float uMid;
  uniform float uHigh;
  uniform float uBeat;
  uniform float uTransient;
  uniform float uMemory;
  uniform float uOpacity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise21(p);
      p = p * 2.03 + vec2(1.73, 9.21);
      a *= 0.5;
    }
    return v;
  }

  float ringShape(float r, float radius, float sharpness) {
    return exp(-abs(r - radius) * sharpness);
  }

  void main() {
    vec2 q = (vUv - vec2(0.5)) * 2.0;
    float r = length(q);
    float ang = atan(q.y, q.x);
    float p0 = clamp(uP0, 0.0, 2.0);
    float p1 = clamp(uP1, 0.0, 2.0);
    float p2 = clamp(uP2, 0.0, 2.0);
    float drive = clamp(uDrive, 0.0, 2.5);
    float t = uTime;
    float intensity = 0.0;
    float hot = 0.0;
    vec3 col = uColorA;

    if (uMode < 1.5) {
      float wave = 0.5 + 0.5 * sin(t * (2.2 + p0 * 5.6));
      float radius = 0.22 + wave * (0.30 + p1 * 0.12) + uBass * 0.035 + uBeat * 0.045;
      float core = exp(-r * (3.8 + p2 * 2.8));
      float ring = ringShape(r, radius, 18.0 + p1 * 24.0);
      float halo = exp(-abs(r - radius) * (5.2 + p2 * 5.0));
      intensity = (core * (0.22 + wave * 0.32) + ring * 0.86 + halo * 0.18) * (0.20 + drive * 0.72);
      hot = clamp(ring * 0.75 + uBeat * 0.18, 0.0, 1.0);
      col = mix(uColorB, uColorA, wave);
      col = mix(col, uColorC, hot);
    } else if (uMode < 2.5) {
      float rate = 7.0 + p0 * 31.0;
      float held = noise21(vec2(floor(t * rate), 3.7));
      float micro = noise21(vec2(t * (45.0 + p1 * 55.0), 8.9));
      float stability = mix(held, 0.72, clamp(p2 * 0.50, 0.0, 0.92));
      float flick = clamp(stability * 0.78 + micro * 0.22 + uHigh * 0.06 + uTransient * 0.12, 0.0, 1.35);
      float body = exp(-r * (2.4 + p1 * 1.6));
      float corona = exp(-r * (0.95 + p2 * 0.9));
      intensity = (body * (0.18 + flick * 0.92) + corona * flick * 0.12) * (0.16 + drive * 0.72);
      hot = clamp(micro * flick * 0.55 + uTransient * 0.25, 0.0, 1.0);
      col = mix(uColorB, uColorA, flick);
      col = mix(col, uColorC, hot);
    } else if (uMode < 3.5) {
      float phase = fract(t * (0.32 + p0 * 0.74));
      float attack = exp(-phase * (3.6 + p2 * 7.0));
      float radius = 0.05 + phase * (0.88 + p1 * 0.26);
      float front = ringShape(r, radius, 24.0 + p1 * 30.0);
      float fill = exp(-r * (2.5 + p2 * 1.8)) * attack;
      float flash = exp(-r * r * (10.0 + p1 * 8.0)) * (uTransient * 0.70 + uBeat * 0.42);
      intensity = (front * attack * 1.18 + fill * 0.58 + flash) * (0.20 + drive * 0.76);
      hot = clamp(front * attack + flash * 0.8, 0.0, 1.0);
      col = mix(uColorB, uColorA, attack);
      col = mix(col, uColorC, hot);
    } else if (uMode < 4.5) {
      float rate = 2.0 + p0 * 14.0;
      float duty = clamp(0.07 + p1 * 0.34, 0.04, 0.72);
      float phase = fract(t * rate);
      float gate = 1.0 - smoothstep(duty, min(0.98, duty + 0.035 + p2 * 0.025), phase);
      float flash = gate * (0.68 + uBeat * 0.24 + uTransient * 0.36);
      float body = exp(-r * (1.65 + p2 * 1.1));
      float core = exp(-r * r * 13.0);
      intensity = (body * flash * 0.82 + core * flash * 0.64) * (0.18 + drive * 0.82);
      hot = clamp(core * flash + uTransient * 0.28, 0.0, 1.0);
      col = mix(uColorA, uColorB, step(0.5, fract(t * rate * 0.5)));
      col = mix(col, uColorC, hot);
    } else if (uMode < 5.5) {
      float breath = 0.5 + 0.5 * sin(t * (0.55 + p0 * 2.2));
      breath = breath * breath * (3.0 - 2.0 * breath);
      float radius = 0.44 + breath * (0.22 + p1 * 0.10);
      float body = exp(-r * (1.5 + p2 * 1.3));
      float rim = ringShape(r, radius, 7.0 + p1 * 10.0);
      intensity = (body * (0.23 + breath * 0.52) + rim * breath * 0.22) * (0.18 + drive * 0.68 + uBass * 0.08);
      hot = clamp(rim * breath * 0.45, 0.0, 1.0);
      col = mix(uColorB, uColorA, breath);
      col = mix(col, uColorC, hot);
    } else if (uMode < 6.5) {
      float memory = clamp(uMemory, 0.0, 1.6);
      float inner = exp(-r * (2.2 + p1 * 1.5));
      float haze = exp(-r * (0.78 + p2 * 0.72));
      float ring = ringShape(r, 0.34 + memory * 0.22, 8.0 + p1 * 10.0);
      float drift = 0.92 + 0.08 * sin(t * (0.45 + p0 * 0.7) + ang * 2.0);
      intensity = (inner * 0.36 + haze * 0.34 + ring * 0.16) * memory * drift * (0.16 + drive * 0.62);
      hot = clamp(inner * memory * 0.36, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(inner + ring * 0.4, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 7.5) {
      float sum = 0.0;
      float shine = 0.0;
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float phase = fract(t * (0.24 + p0 * 0.52) - fi * (0.10 + p2 * 0.045));
        float radius = 0.10 + phase * (0.86 + p1 * 0.18);
        float ring = ringShape(r, radius, 18.0 + p1 * 22.0);
        float fade = exp(-phase * (1.4 + p2 * 1.8)) * exp(-fi * 0.26);
        sum += ring * fade;
        shine += ring * ring * fade;
      }
      intensity = sum * (0.16 + drive * 0.63 + uBeat * 0.10);
      hot = clamp(shine * 0.36 + uTransient * 0.12, 0.0, 1.0);
      col = mix(uColorA, uColorB, clamp(r, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 8.5) {
      float angle = (p2 - 0.5) * 3.14159265;
      vec2 dir = vec2(cos(angle), sin(angle));
      float along = dot(q, dir);
      float crossv = abs(q.x * dir.y - q.y * dir.x);
      float phase = fract(t * (0.20 + p0 * 0.58));
      float center = mix(-1.30, 1.30, phase);
      float band = exp(-abs(along - center) * (14.0 + p1 * 28.0));
      float soft = exp(-abs(along - center) * (4.0 + p1 * 6.0));
      float spatial = exp(-crossv * (0.40 + p2 * 0.34));
      intensity = (band * 0.90 + soft * 0.18) * spatial * (0.18 + drive * 0.72 + uMid * 0.10);
      hot = clamp(band * 0.68 + uTransient * 0.15, 0.0, 1.0);
      col = mix(uColorB, uColorA, phase);
      col = mix(col, uColorC, hot);
    } else if (uMode < 9.5) {
      float phase = fract(t * (0.36 + p0 * 0.86) + uBeat * 0.04);
      float radius = 0.06 + phase * (1.08 + p1 * 0.18);
      float ring = ringShape(r, radius, 25.0 + p2 * 38.0);
      float corona = ringShape(r, radius, 7.0 + p1 * 7.0);
      float tail = exp(-max(radius - r, 0.0) * (3.0 + p2 * 2.0)) * (1.0 - phase) * 0.13;
      float fade = exp(-phase * (1.65 + p2 * 1.15));
      intensity = (ring * 1.10 + corona * 0.22 + tail) * fade * (0.20 + drive * 0.78 + uBeat * 0.24);
      hot = clamp(ring * fade * 0.90 + uTransient * 0.18, 0.0, 1.0);
      col = mix(uColorA, uColorB, phase);
      col = mix(col, uColorC, hot);
    } else if (uMode < 10.5) {
      vec2 warp = q + vec2(
        fbm(q * (1.9 + p1) + vec2(t * 0.25, -t * 0.16)) - 0.5,
        fbm(q * (2.2 + p1) + vec2(-t * 0.18, t * 0.22) + 13.0) - 0.5
      ) * (0.20 + p2 * 0.24);
      float wr = length(warp);
      float wa = atan(warp.y, warp.x);
      float arms = 0.5 + 0.5 * sin(wa * (5.0 + floor(p1 * 4.0)) - t * (2.2 + p0 * 4.2) + fbm(warp * 3.0) * 3.2);
      arms = pow(arms, 6.0 + p1 * 5.0);
      float stream = pow(0.5 + 0.5 * sin((wr * (18.0 + p2 * 10.0)) - t * (5.0 + p0 * 5.0)), 8.0);
      float fall = exp(-wr * (1.18 + p2 * 0.65));
      intensity = (arms * 0.62 + stream * 0.38 + exp(-wr * 4.4) * 0.18) * fall * (0.18 + drive * 0.70 + uMid * 0.12 + uHigh * 0.06);
      hot = clamp(stream * arms * 0.72 + uTransient * 0.12, 0.0, 1.0);
      col = mix(uColorA, uColorB, clamp(arms + stream * 0.35, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else {
      float sum = 0.0;
      float shine = 0.0;
      float turbulence = (fbm(q * (3.2 + p1 * 1.8) + vec2(t * 0.16, -t * 0.11)) - 0.5) * (0.035 + p2 * 0.055);
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float phase = fract(t * (0.18 + p0 * 0.54) + fi * (0.14 + p2 * 0.025));
        float radius = 0.09 + phase * (0.86 + p1 * 0.22) + turbulence;
        float ring = ringShape(r, radius, 17.0 + p1 * 23.0);
        float fade = exp(-phase * (1.25 + p2 * 1.5));
        sum += ring * fade;
        shine += ring * ring * fade;
      }
      intensity = sum * (0.16 + drive * 0.60 + uLow * 0.08 + uMid * 0.12 + uBeat * 0.09);
      hot = clamp(shine * 0.34 + uTransient * 0.11, 0.0, 1.0);
      col = mix(uColorA, uColorB, clamp(r * 0.8 + 0.15, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    }

    float edgeFade = 1.0 - smoothstep(0.82, 1.42, r);
    intensity *= edgeFade;
    float emission = max(0.0, intensity) * (0.82 + drive * 1.22) + hot * (0.32 + drive * 0.72);
    float alpha = clamp(intensity * uOpacity + hot * uOpacity * 0.18, 0.0, 0.58);
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(max(col, vec3(0.0)) * emission, alpha);
  }
`;

type Envelope = {
  bass: number;
  low: number;
  mid: number;
  high: number;
  beat: number;
  transient: number;
  memory: number;
  last: number;
};

type Entry = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  env: Envelope;
  lastSeen: number;
};

function band(snapshot: AudioSnapshot, name: string) {
  switch (name) {
    case "Raw": return snapshot.raw;
    case "Bass": return snapshot.bass;
    case "Low": return snapshot.low;
    case "Mid": return snapshot.mid;
    case "High": return snapshot.high;
    case "FullMix": return snapshot.fullMix;
    case "Beat": return snapshot.beat;
    case "Transient": return snapshot.transient;
    default: return 1;
  }
}

function drive(effect: EffectInstance, snapshot: AudioSnapshot, project: Project) {
  const selected = effect.audio === "Manual" ? 1 : band(snapshot, effect.audio);
  const mod = effect.audio === "Manual"
    ? effect.intensity
    : effect.intensity * (1 - effect.audioInfluence + effect.audioInfluence * selected);
  return mod * project.masters.intensity;
}

function makeMaterial(kind: EffectKind) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uMode: { value: MODE[kind] || 1 },
      uP0: { value: 0.65 }, uP1: { value: 0.5 }, uP2: { value: 0.4 },
      uDrive: { value: 1 },
      uBass: { value: 0 }, uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 },
      uBeat: { value: 0 }, uTransient: { value: 0 }, uMemory: { value: 0 },
      uOpacity: { value: 0.40 },
      uColorA: { value: new THREE.Color("#66d9ff") },
      uColorB: { value: new THREE.Color("#735cff") },
      uColorC: { value: new THREE.Color("#ffffff") },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function smoothEnvelope(entry: Entry, snapshot: AudioSnapshot) {
  const now = performance.now() / 1000;
  const dt = Math.max(0.001, Math.min(0.05, now - entry.env.last));
  entry.env.last = now;
  const step = (current: number, target: number, attack: number, release: number) => {
    const tau = target > current ? attack : release;
    return current + (target - current) * (1 - Math.exp(-dt / Math.max(0.006, tau)));
  };
  entry.env.bass = step(entry.env.bass, Math.min(2, snapshot.bass), 0.018, 0.14);
  entry.env.low = step(entry.env.low, Math.min(2, snapshot.low), 0.022, 0.13);
  entry.env.mid = step(entry.env.mid, Math.min(2, snapshot.mid), 0.015, 0.095);
  entry.env.high = step(entry.env.high, Math.min(2, snapshot.high), 0.009, 0.065);
  entry.env.beat = step(entry.env.beat, Math.min(2, snapshot.beat), 0.006, 0.085);
  entry.env.transient = step(entry.env.transient, Math.min(2, snapshot.transient), 0.004, 0.055);
  const trigger = Math.min(1.6, snapshot.beat * 0.92 + snapshot.transient * 0.78 + snapshot.bass * 0.16);
  const decayed = entry.env.memory * Math.exp(-dt / 0.62);
  entry.env.memory = Math.max(trigger, decayed);
}

function radians(rotation: number | undefined) {
  const r = Number(rotation || 0);
  return Math.abs(r) > Math.PI * 2.05 ? r * Math.PI / 180 : r;
}

export class ThreePulseEnergyLayer {
  private entries = new Map<string, Entry>();
  private geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  private frame = 0;

  constructor(private scene: THREE.Scene) {}

  update(project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, colorOverrides?: Record<string, string>) {
    this.frame++;
    const time = performance.now() / 1000;
    for (const region of project.regions) {
      for (const effect of region.effects) {
        if (!effect.enabled || !PULSE_ENERGY_KINDS.has(effect.kind)) continue;
        this.updateEffect(region, effect, project, snapshot, width, height, viewport, time, colorOverrides);
      }
    }

    for (const [id, entry] of this.entries) {
      if (entry.lastSeen === this.frame) continue;
      this.scene.remove(entry.mesh);
      entry.material.dispose();
      this.entries.delete(id);
    }
  }

  private updateEffect(region: Region, effect: EffectInstance, project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, time: number, colorOverrides?: Record<string, string>) {
    let entry = this.entries.get(effect.id);
    if (!entry) {
      const material = makeMaterial(effect.kind);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 36;
      this.scene.add(mesh);
      entry = {
        mesh,
        material,
        env: { bass: 0, low: 0, mid: 0, high: 0, beat: 0, transient: 0, memory: 0, last: performance.now() / 1000 },
        lastSeen: this.frame,
      };
      this.entries.set(effect.id, entry);
    }
    entry.lastSeen = this.frame;
    smoothEnvelope(entry, snapshot);

    const x = viewport.x + ((region.x + (effect.offsetX || 0)) / project.width) * viewport.w;
    const y = viewport.y + ((region.y + (effect.offsetY || 0)) / project.height) * viewport.h;
    const baseRadius = Math.max(12, region.radius + (effect.expansion || 0) + (effect.spread || 0));
    const sx = Math.max(0.05, effect.fxScaleX || effect.scale || region.sx || 1);
    const sy = Math.max(0.05, effect.fxScaleY || effect.scale || region.sy || 1);
    const wide = effect.kind === "WaveSweep" || effect.kind === "EnergyFlow";
    const defaultW = baseRadius * (wide ? 3.4 : 2.45);
    const defaultH = baseRadius * (wide ? 2.7 : 2.45);
    const rx = Math.max(12, ((effect.fxW || region.width || defaultW) / 2) * (viewport.w / project.width) * sx);
    const ry = Math.max(12, ((effect.fxH || region.height || defaultH) / 2) * (viewport.h / project.height) * sy);

    entry.mesh.position.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.18);
    entry.mesh.scale.set((rx / width) * 2, (ry / height) * 2, 1);
    entry.mesh.rotation.z = -radians(region.rotation);

    const u = entry.material.uniforms;
    u.uTime.value = time * effect.speed * project.masters.motion;
    u.uMode.value = MODE[effect.kind] || 1;
    u.uP0.value = effect.p0 ?? 0.65;
    u.uP1.value = effect.p1 ?? 0.5;
    u.uP2.value = effect.p2 ?? 0.4;
    u.uDrive.value = drive(effect, snapshot, project);
    u.uBass.value = entry.env.bass;
    u.uLow.value = entry.env.low;
    u.uMid.value = entry.env.mid;
    u.uHigh.value = entry.env.high;
    u.uBeat.value = entry.env.beat;
    u.uTransient.value = entry.env.transient;
    u.uMemory.value = entry.env.memory;
    u.uOpacity.value = Math.max(0, Math.min(0.58, effect.opacity * effect.brightness * project.masters.brightness * 0.46));
    u.uColorA.value.set(colorOverrides?.[effect.id] || effect.color || "#66d9ff");
    u.uColorB.value.set(effect.color2 || "#735cff");
    u.uColorC.value.set(effect.color3 || "#ffffff");
  }

  dispose() {
    for (const entry of this.entries.values()) {
      this.scene.remove(entry.mesh);
      entry.material.dispose();
    }
    this.entries.clear();
    this.geometry.dispose();
  }
}
