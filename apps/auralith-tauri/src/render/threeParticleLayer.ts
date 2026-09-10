import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";
import { bandOf } from "./renderer";

const PARTICLE_KINDS = new Set<EffectKind>([
  "Sparks", "EnergySparks", "Embers", "Fireflies", "Snow", "Ash", "DustMotes", "BioluminescentSpores"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  Sparks: 1,
  EnergySparks: 2,
  Embers: 3,
  Fireflies: 4,
  Snow: 5,
  Ash: 6,
  DustMotes: 7,
  BioluminescentSpores: 8,
};

const VERT = /* glsl */`
  precision highp float;
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uMode;
  uniform float uP0;
  uniform float uP1;
  uniform float uP2;
  uniform float uBass;
  uniform float uLow;
  uniform float uMid;
  uniform float uHigh;
  uniform float uBeat;
  uniform float uTransient;
  uniform float uDrive;
  uniform float uPointScale;
  varying float vLife;
  varying float vHeat;
  varying float vTwinkle;

  void main() {
    float rate = 0.16 + uP0 * 0.85;
    float age = fract(uTime * rate * (0.55 + aSeed.z * 0.9) + aSeed.w);
    float life = sin(3.14159265 * age);
    vec2 pos = vec2(0.0);
    float heat = 0.0;
    float twinkle = 1.0;
    float size = 2.0;

    if (uMode < 1.5) {
      float side = aSeed.x < 0.5 ? -1.0 : 1.0;
      float theta = mix(0.32, 1.30, aSeed.y);
      float speed = mix(0.46, 1.15, aSeed.z) * (0.8 + uP1 * 0.75 + uTransient * 0.28);
      vec2 velocity = vec2(cos(theta) * side, sin(theta)) * speed;
      pos = velocity * age + vec2(0.0, -0.82 * age * age);
      pos.x += sin(age * 8.0 + aSeed.w * 31.0) * 0.025 * uP2;
      life = (1.0 - age) * (1.0 - age);
      heat = 1.0 - age;
      size = mix(1.7, 4.0, aSeed.y) * (0.8 + uHigh * 0.25);
    } else if (uMode < 2.5) {
      float angle = aSeed.x * 6.2831853;
      float speed = mix(0.38, 1.15, aSeed.y) * (0.75 + uTransient * 0.45 + uBeat * 0.22);
      vec2 dir = vec2(cos(angle), sin(angle));
      pos = dir * age * speed;
      pos += vec2(sin(age * 13.0 + aSeed.z * 19.0), cos(age * 11.0 + aSeed.x * 17.0)) * 0.035 * uP2;
      life = (1.0 - age) * (1.0 - age);
      heat = 0.9 - age * 0.5;
      size = mix(1.8, 3.8, aSeed.z) * (0.9 + uHigh * 0.35);
    } else if (uMode < 3.5) {
      pos.x = (aSeed.x - 0.5) * 1.35 + sin(age * 8.0 + aSeed.z * 25.0) * (0.07 + uP2 * 0.07);
      pos.y = -0.88 + age * (1.55 + uP1 * 0.75);
      pos.x += sin(uTime * (0.4 + aSeed.y) + aSeed.w * 41.0) * 0.05;
      heat = 1.0 - age * 0.72;
      size = mix(2.2, 5.2, aSeed.y);
    } else if (uMode < 4.5) {
      float phase = aSeed.w * 31.0;
      float wander = 0.18 + uP1 * 0.22;
      pos.x = (aSeed.x - 0.5) * 1.55 + sin(uTime * (0.20 + aSeed.z * 0.34) + phase) * wander;
      pos.y = (aSeed.y - 0.5) * 1.35 + cos(uTime * (0.17 + aSeed.x * 0.27) + phase * 0.71) * wander * 0.72;
      pos += vec2(sin(uTime * 0.63 + phase * 1.7), cos(uTime * 0.51 + phase * 1.3)) * 0.035 * uMid;
      float blink = pow(0.5 + 0.5 * sin(uTime * mix(1.1, 3.4, aSeed.z) + phase), 6.0);
      twinkle = 0.12 + blink * 1.38;
      life = 1.0;
      heat = blink;
      size = mix(3.0, 6.6, aSeed.y) * (0.9 + blink * 0.35);
    } else if (uMode < 5.5) {
      float depth = 0.35 + aSeed.z * 0.65;
      pos.y = 1.18 - age * 2.36;
      pos.x = (aSeed.x - 0.5) * 1.85 + sin(uTime * (0.16 + depth * 0.24) + aSeed.w * 29.0) * (0.07 + uP2 * 0.15);
      life = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.90, 1.0, age));
      heat = depth;
      size = mix(1.8, 5.8, depth);
    } else if (uMode < 6.5) {
      pos.y = 1.12 - age * 2.24;
      pos.x = (aSeed.x - 0.5) * 1.85 + sin(uTime * (0.26 + aSeed.z * 0.30) + aSeed.w * 37.0) * (0.10 + uP1 * 0.14);
      pos.x += sin(age * 19.0 + aSeed.y * 20.0) * 0.045;
      twinkle = 0.55 + 0.45 * sin(uTime * 1.2 + aSeed.w * 47.0);
      heat = 0.12;
      size = mix(2.0, 5.0, aSeed.y);
    } else if (uMode < 7.5) {
      float phase = aSeed.w * 39.0;
      pos.x = (aSeed.x - 0.5) * 1.85 + sin(uTime * (0.07 + aSeed.z * 0.08) + phase) * 0.13;
      pos.y = (aSeed.y - 0.5) * 1.65 + cos(uTime * (0.05 + aSeed.x * 0.07) + phase) * 0.09;
      twinkle = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * 1.1 + phase), 5.0);
      life = 1.0;
      heat = 0.25;
      size = mix(1.4, 4.1, aSeed.z);
    } else {
      float phase = aSeed.w * 35.0;
      pos.y = -1.0 + age * 2.0;
      pos.x = (aSeed.x - 0.5) * 1.55 + sin(age * 9.0 + phase + uTime * 0.35) * (0.08 + uP2 * 0.10);
      twinkle = 0.50 + 0.50 * sin(uTime * (0.7 + aSeed.z) + phase);
      heat = twinkle;
      size = mix(2.4, 5.4, aSeed.y) * (0.85 + twinkle * 0.24);
    }

    float audioSize = 1.0 + clamp(uBass * 0.14 + uBeat * 0.10, 0.0, 0.32);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    gl_PointSize = max(1.0, size * uPointScale * audioSize);
    vLife = clamp(life, 0.0, 1.0);
    vHeat = clamp(heat, 0.0, 1.0);
    vTwinkle = max(0.0, twinkle);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uOpacity;
  uniform float uDrive;
  uniform float uMode;
  varying float vLife;
  varying float vHeat;
  varying float vTwinkle;

  void main() {
    vec2 q = gl_PointCoord - vec2(0.5);
    float d = length(q) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 18.0);
    float halo = exp(-d * d * 4.2);
    float edge = smoothstep(1.0, 0.52, d);
    vec3 color = mix(uColorB, uColorA, vHeat);
    color = mix(color, uColorC, core * (0.45 + vHeat * 0.55));
    float emission = 1.0 + core * (uMode < 2.5 ? 2.1 : 1.15) + vHeat * 0.55;
    float alpha = (core * 0.88 + halo * 0.32) * edge * vLife * vTwinkle * uOpacity;
    alpha *= 0.45 + clamp(uDrive, 0.0, 2.0) * 0.55;
    gl_FragColor = vec4(color * emission, clamp(alpha, 0.0, 1.0));
  }
`;

type Entry = {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  lastSeen: number;
};

function color(value: string | undefined, fallback: string) {
  return new THREE.Color(value || fallback);
}

function qualityCount(project: Project) {
  if (project.quality === "Ultra") return 192;
  if (project.quality === "High") return 128;
  if (project.quality === "Medium") return 80;
  return 48;
}

function createSeedGeometry(max = 192) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(max * 3);
  const seeds = new Float32Array(max * 4);
  for (let i = 0; i < max; i++) {
    const h = (n: number) => {
      const x = Math.sin((i + 1) * n * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    seeds[i * 4] = h(1.17);
    seeds[i * 4 + 1] = h(2.43);
    seeds[i * 4 + 2] = h(4.91);
    seeds[i * 4 + 3] = h(8.37);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  geometry.setDrawRange(0, max);
  return geometry;
}

function makeMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uMode: { value: 1 }, uP0: { value: 0.65 }, uP1: { value: 0.5 }, uP2: { value: 0.4 },
      uBass: { value: 0 }, uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uBeat: { value: 0 }, uTransient: { value: 0 },
      uDrive: { value: 1 }, uPointScale: { value: 1 },
      uColorA: { value: new THREE.Color("#ffd27a") }, uColorB: { value: new THREE.Color("#ff6a2a") }, uColorC: { value: new THREE.Color("#ffffff") },
      uOpacity: { value: 0.55 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function effectDrive(effect: EffectInstance, snapshot: AudioSnapshot, project: Project) {
  const selected = effect.audio === "Manual" ? 1 : bandOf(snapshot, effect.audio);
  const modulation = effect.audio === "Manual" ? effect.intensity : effect.intensity * (1 - effect.audioInfluence + effect.audioInfluence * selected);
  return modulation * project.masters.intensity;
}

export class ThreeParticleLayer {
  private entries = new Map<string, Entry>();
  private geometry = createSeedGeometry(192);
  private frame = 0;

  constructor(private scene: THREE.Scene) {}

  update(project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, colorOverrides?: Record<string, string>) {
    this.frame++;
    const count = qualityCount(project);
    this.geometry.setDrawRange(0, count);
    const pointScale = Math.max(0.72, Math.min(2.2, height / 1080));
    const time = performance.now() / 1000;

    for (const region of project.regions) {
      for (const effect of region.effects) {
        if (!effect.enabled || !PARTICLE_KINDS.has(effect.kind)) continue;
        this.updateEffect(region, effect, project, snapshot, width, height, viewport, time, pointScale, colorOverrides);
      }
    }

    for (const [id, entry] of this.entries) {
      if (entry.lastSeen === this.frame) continue;
      this.scene.remove(entry.points);
      entry.material.dispose();
      this.entries.delete(id);
    }
  }

  private updateEffect(region: Region, effect: EffectInstance, project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, time: number, pointScale: number, colorOverrides?: Record<string, string>) {
    let entry = this.entries.get(effect.id);
    if (!entry) {
      const material = makeMaterial();
      const points = new THREE.Points(this.geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 25;
      this.scene.add(points);
      entry = { points, material, lastSeen: this.frame };
      this.entries.set(effect.id, entry);
    }
    entry.lastSeen = this.frame;

    const xPx = viewport.x + ((region.x + (effect.offsetX || 0)) / project.width) * viewport.w;
    const yPx = viewport.y + ((region.y + (effect.offsetY || 0)) / project.height) * viewport.h;
    const radiusPx = Math.max(8, (region.radius + (effect.expansion || 0) + (effect.spread || 0)) * (viewport.w / project.width) * Math.max(0.05, effect.fxScaleX || effect.scale || region.sx || 1));

    entry.points.position.set((xPx / width) * 2 - 1, 1 - (yPx / height) * 2, 0.12);
    entry.points.scale.set((radiusPx / width) * 2, (radiusPx / height) * 2, 1);

    const u = entry.material.uniforms;
    u.uTime.value = time * effect.speed * project.masters.motion;
    u.uMode.value = MODE[effect.kind] || 1;
    u.uP0.value = effect.p0 ?? 0.65;
    u.uP1.value = effect.p1 ?? 0.5;
    u.uP2.value = effect.p2 ?? 0.4;
    u.uBass.value = snapshot.bass;
    u.uLow.value = snapshot.low;
    u.uMid.value = snapshot.mid;
    u.uHigh.value = snapshot.high;
    u.uBeat.value = snapshot.beat;
    u.uTransient.value = snapshot.transient;
    u.uDrive.value = effectDrive(effect, snapshot, project);
    u.uPointScale.value = pointScale * Math.max(0.55, Math.min(1.8, effect.scale || 1));
    u.uColorA.value.copy(color(colorOverrides?.[effect.id] || effect.color, "#ffd27a"));
    u.uColorB.value.copy(color(effect.color2, "#ff6a2a"));
    u.uColorC.value.copy(color(effect.color3, "#ffffff"));
    u.uOpacity.value = Math.max(0, Math.min(1, effect.opacity * effect.brightness * 0.62));
  }

  dispose() {
    for (const entry of this.entries.values()) entry.material.dispose();
    this.entries.clear();
    this.geometry.dispose();
  }
}
