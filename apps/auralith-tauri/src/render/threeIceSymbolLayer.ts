import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

export const ICE_SYMBOL_KINDS = new Set<EffectKind>([
  "FrostIce", "CrystalGrowth", "IceShimmer", "RuneGlow", "SigilActivation"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  FrostIce: 1,
  CrystalGrowth: 2,
  IceShimmer: 3,
  RuneGlow: 4,
  SigilActivation: 5,
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
      p = p * 2.05 + vec2(4.2, 7.7);
      a *= 0.5;
    }
    return v;
  }

  float ring(float r, float radius, float sharpness) {
    return exp(-abs(r - radius) * sharpness);
  }

  void main() {
    vec2 q = (vUv - 0.5) * 2.0;
    float r = length(q);
    float a = atan(q.y, q.x);
    float drive = clamp(uDrive, 0.0, 2.5);
    float p0 = clamp(uP0, 0.0, 2.0);
    float p1 = clamp(uP1, 0.0, 2.0);
    float p2 = clamp(uP2, 0.0, 2.0);
    float intensity = 0.0;
    float hot = 0.0;
    vec3 col = mix(uColorB, uColorA, 0.55);

    if (uMode < 1.5) {
      float edge = smoothstep(0.22, 0.92, r);
      float n = fbm(q * (3.0 + p1 * 3.0) + vec2(uTime * 0.05, -uTime * 0.04));
      float crystal = pow(max(0.0, sin(a * (7.0 + floor(p2 * 8.0)) + n * 5.0 + r * 15.0)), 9.0);
      float frost = smoothstep(0.48 - p0 * 0.08, 0.78, n + edge * 0.24);
      intensity = (frost * 0.46 + crystal * 0.52) * edge * (0.22 + drive * 0.66 + uHigh * 0.16);
      hot = clamp(crystal * 0.45 + uTransient * 0.12, 0.0, 1.0);
      col = mix(uColorB, uColorA, frost);
      col = mix(col, uColorC, hot);
    } else if (uMode < 2.5) {
      float growth = fract(uTime * (0.10 + p0 * 0.28) + uBeat * 0.04);
      float arms = 6.0 + floor(p1 * 8.0);
      float angular = pow(abs(cos(a * arms * 0.5)), 16.0 + p2 * 16.0);
      float front = ring(r, 0.12 + growth * 0.82, 22.0 + p2 * 30.0);
      float branch = angular * exp(-r * (0.8 + p2 * 0.8)) * smoothstep(0.08, growth + 0.18, r);
      float facets = pow(max(0.0, sin(r * (18.0 + p1 * 16.0) - a * 2.0)), 12.0) * branch;
      intensity = (branch * 0.55 + front * 0.66 + facets * 0.30) * (0.20 + drive * 0.70 + uMid * 0.10);
      hot = clamp(front * 0.65 + facets * 0.35, 0.0, 1.0);
      col = mix(uColorB, uColorA, branch);
      col = mix(col, uColorC, hot);
    } else if (uMode < 3.5) {
      float bands = pow(max(0.0, sin((q.x + q.y * 0.62) * (20.0 + p1 * 28.0) - uTime * (2.0 + p0 * 3.5))), 14.0);
      float facets = pow(max(0.0, cos(a * (8.0 + floor(p2 * 8.0)) + r * 10.0)), 14.0);
      float sparkle = pow(max(0.0, noise21(q * 19.0 + uTime * 0.6) - 0.72), 2.0) * 8.0;
      float fade = 1.0 - smoothstep(0.66, 1.10, r);
      intensity = (bands * 0.60 + facets * 0.28 + sparkle * 0.36) * fade * (0.18 + drive * 0.62 + uHigh * 0.28 + uTransient * 0.16);
      hot = clamp(bands * 0.46 + sparkle * 0.35, 0.0, 1.0);
      col = mix(uColorA, uColorC, hot);
    } else if (uMode < 4.5) {
      float outer = ring(r, 0.62 + 0.03 * sin(uTime * (0.5 + p0)), 34.0 + p1 * 30.0);
      float inner = ring(r, 0.36, 26.0 + p2 * 28.0);
      float glyph = 0.0;
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float ga = fi * 0.5235988 + sin(fi * 2.1) * 0.06;
        vec2 dir = vec2(cos(ga), sin(ga));
        float along = dot(q, dir);
        float across = abs(q.x * dir.y - q.y * dir.x);
        float mark = exp(-abs(along - 0.50) * 32.0) * exp(-across * (38.0 + p1 * 18.0));
        glyph += mark * (0.65 + 0.35 * sin(uTime * (0.7 + p0) + fi));
      }
      intensity = (outer * 0.72 + inner * 0.40 + glyph * 0.34) * (0.20 + drive * 0.70 + uMid * 0.12 + uBeat * 0.08);
      hot = clamp(outer * 0.34 + glyph * 0.22, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(inner + glyph * 0.2, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else {
      float rot = uTime * (0.18 + p0 * 0.5);
      float outer = ring(r, 0.72, 28.0 + p1 * 24.0);
      float middle = ring(r, 0.48, 24.0 + p2 * 22.0);
      float inner = ring(r, 0.25 + uBeat * 0.025, 20.0 + p1 * 20.0);
      float spokes = pow(abs(cos((a + rot) * (4.0 + floor(p1 * 4.0)))), 20.0) * smoothstep(0.25, 0.34, r) * (1.0 - smoothstep(0.62, 0.74, r));
      float glyphBand = 0.5 + 0.5 * sin((a - rot * 0.6) * (14.0 + floor(p2 * 10.0)) + r * 7.0);
      glyphBand = pow(glyphBand, 12.0) * ring(r, 0.60, 9.0);
      intensity = (outer * 0.54 + middle * 0.38 + inner * 0.34 + spokes * 0.42 + glyphBand * 0.38) * (0.20 + drive * 0.72 + uBeat * 0.16);
      hot = clamp(outer * 0.25 + spokes * 0.20 + glyphBand * 0.22 + uTransient * 0.14, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(spokes + middle, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    }

    float alpha = clamp(intensity * uOpacity, 0.0, 0.62);
    if (alpha < 0.002) discard;
    float emission = 1.0 + hot * 1.55 + min(intensity, 2.0) * 0.22;
    gl_FragColor = vec4(max(col, vec3(0.0)) * emission, alpha);
  }
`;

type Envelope = { bass: number; low: number; mid: number; high: number; beat: number; transient: number; last: number };
type Entry = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; material: THREE.ShaderMaterial; env: Envelope; lastSeen: number };

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
  const mod = effect.audio === "Manual" ? effect.intensity : effect.intensity * (1 - effect.audioInfluence + effect.audioInfluence * selected);
  return mod * project.masters.intensity;
}

function makeMaterial(kind: EffectKind) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uMode: { value: MODE[kind] || 1 }, uP0: { value: 0.65 }, uP1: { value: 0.5 }, uP2: { value: 0.4 }, uDrive: { value: 1 },
      uBass: { value: 0 }, uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uBeat: { value: 0 }, uTransient: { value: 0 },
      uOpacity: { value: 0.42 }, uColorA: { value: new THREE.Color("#9feaff") }, uColorB: { value: new THREE.Color("#467aa8") }, uColorC: { value: new THREE.Color("#ffffff") },
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
  entry.env.bass = step(entry.env.bass, Math.min(2, snapshot.bass), 0.024, 0.14);
  entry.env.low = step(entry.env.low, Math.min(2, snapshot.low), 0.026, 0.13);
  entry.env.mid = step(entry.env.mid, Math.min(2, snapshot.mid), 0.018, 0.10);
  entry.env.high = step(entry.env.high, Math.min(2, snapshot.high), 0.010, 0.07);
  entry.env.beat = step(entry.env.beat, Math.min(2, snapshot.beat), 0.007, 0.095);
  entry.env.transient = step(entry.env.transient, Math.min(2, snapshot.transient), 0.005, 0.06);
}

function radians(rotation: number | undefined) {
  const r = Number(rotation || 0);
  return Math.abs(r) > Math.PI * 2.05 ? r * Math.PI / 180 : r;
}

export class ThreeIceSymbolLayer {
  private entries = new Map<string, Entry>();
  private geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  private frame = 0;
  constructor(private scene: THREE.Scene) {}

  update(project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, colorOverrides?: Record<string, string>) {
    this.frame++;
    const time = performance.now() / 1000;
    for (const region of project.regions) for (const effect of region.effects) {
      if (!effect.enabled || !ICE_SYMBOL_KINDS.has(effect.kind)) continue;
      this.updateEffect(region, effect, project, snapshot, width, height, viewport, time, colorOverrides);
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
      mesh.renderOrder = 42;
      this.scene.add(mesh);
      entry = { mesh, material, env: { bass: 0, low: 0, mid: 0, high: 0, beat: 0, transient: 0, last: performance.now() / 1000 }, lastSeen: this.frame };
      this.entries.set(effect.id, entry);
    }
    entry.lastSeen = this.frame;
    smoothEnvelope(entry, snapshot);

    const x = viewport.x + ((region.x + (effect.offsetX || 0)) / project.width) * viewport.w;
    const y = viewport.y + ((region.y + (effect.offsetY || 0)) / project.height) * viewport.h;
    const baseRadius = Math.max(12, region.radius + (effect.expansion || 0) + (effect.spread || 0));
    const sx = Math.max(0.05, effect.fxScaleX || effect.scale || region.sx || 1);
    const sy = Math.max(0.05, effect.fxScaleY || effect.scale || region.sy || 1);
    const defaultW = baseRadius * 2.7;
    const defaultH = baseRadius * 2.7;
    const rx = Math.max(12, ((effect.fxW || region.width || defaultW) / 2) * (viewport.w / project.width) * sx);
    const ry = Math.max(12, ((effect.fxH || region.height || defaultH) / 2) * (viewport.h / project.height) * sy);
    entry.mesh.position.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.22);
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
    u.uOpacity.value = Math.max(0, Math.min(0.60, effect.opacity * effect.brightness * project.masters.brightness * 0.48));
    u.uColorA.value.set(colorOverrides?.[effect.id] || effect.color || "#9feaff");
    u.uColorB.value.set(effect.color2 || "#467aa8");
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
