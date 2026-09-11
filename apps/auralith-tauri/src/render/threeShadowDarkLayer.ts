import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

export const SHADOW_DARK_KINDS = new Set<EffectKind>([
  "ShadowPulse", "RoomDim", "LocalDim", "ContrastSurge", "ShadowTendrils", "Eclipse", "GravityWell"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  ShadowPulse: 1,
  RoomDim: 2,
  LocalDim: 3,
  ContrastSurge: 4,
  ShadowTendrils: 5,
  Eclipse: 6,
  GravityWell: 7,
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
  uniform sampler2D uScene;
  uniform vec2 uResolution;
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
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
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
      v += noise21(p) * a;
      p = p * 2.07 + vec2(5.1, 1.9);
      a *= 0.5;
    }
    return v;
  }

  vec3 sampleScene(vec2 uv) {
    return texture2D(uScene, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
  }

  void main() {
    vec2 local = (vUv - 0.5) * 2.0;
    float d = length(local);
    float mask = 1.0 - smoothstep(0.74, 1.0, d);
    if (mask < 0.002) discard;

    vec2 sceneUv = gl_FragCoord.xy / max(uResolution, vec2(2.0));
    vec3 base = sampleScene(sceneUv);
    float drive = clamp(uDrive, 0.0, 2.5);
    float p0 = clamp(uP0, 0.0, 2.0);
    float p1 = clamp(uP1, 0.0, 2.0);
    float p2 = clamp(uP2, 0.0, 2.0);
    float audio = clamp(uBass * 0.34 + uLow * 0.24 + uMid * 0.18 + uBeat * 0.14 + uTransient * 0.10, 0.0, 1.8);
    float strength = 0.48 + drive * 0.44 + audio * 0.16;
    vec3 outColor = vec3(0.0);
    float alpha = mask * uOpacity;

    if (uMode < 1.5) {
      float pulse = 0.5 + 0.5 * sin(uTime * (0.65 + p0 * 2.0) + uBass * 1.4);
      float inner = 1.0 - smoothstep(0.05, 0.72 + p1 * 0.12, d);
      float ring = exp(-abs(d - (0.34 + pulse * 0.24)) * (7.0 + p2 * 10.0));
      float dark = clamp(inner * (0.38 + pulse * 0.42) + ring * 0.22 + uBeat * 0.08, 0.0, 1.0);
      outColor = mix(base * 0.38, vec3(0.0), 0.72);
      alpha *= dark * (0.42 + strength * 0.26);
    } else if (uMode < 2.5) {
      float drift = fbm(local * (1.2 + p1) + vec2(uTime * 0.04, -uTime * 0.03));
      float dim = clamp(0.48 + p0 * 0.18 + drift * 0.12 + uBass * 0.08, 0.0, 0.92);
      outColor = vec3(0.0);
      alpha *= dim * (0.42 + strength * 0.20);
    } else if (uMode < 3.5) {
      float radial = 1.0 - smoothstep(0.05, 0.92, d);
      radial = pow(radial, 0.85 + p1 * 1.8);
      float breathe = 0.82 + 0.18 * sin(uTime * (0.45 + p0 * 1.2));
      outColor = vec3(0.0);
      alpha *= radial * breathe * (0.46 + strength * 0.28);
    } else if (uMode < 4.5) {
      float contrast = 1.0 + (0.28 + p0 * 0.70) * (0.65 + uBeat * 0.22 + uMid * 0.18) * strength;
      vec3 contrasted = clamp((base - 0.5) * contrast + 0.5, 0.0, 2.0);
      float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
      contrasted += uColorC * pow(max(luma - 0.62, 0.0), 2.0) * (0.08 + uHigh * 0.08);
      outColor = contrasted;
      alpha *= 0.36 + p1 * 0.10;
    } else if (uMode < 5.5) {
      float a = atan(local.y, local.x);
      float warp = fbm(vec2(a * (2.2 + p1 * 2.0), d * (4.0 + p2 * 4.0)) + vec2(uTime * 0.10, -uTime * 0.13));
      float tendrils = 0.5 + 0.5 * sin(a * (5.0 + floor(p1 * 5.0)) + warp * 5.5 - uTime * (0.55 + p0 * 1.5) + d * 8.0);
      tendrils = pow(tendrils, 9.0 + p2 * 8.0) * exp(-d * (0.65 + p2 * 0.55));
      float haze = fbm(local * 2.2 + vec2(0.0, uTime * 0.08)) * 0.20;
      outColor = mix(vec3(0.0), uColorA * 0.10, tendrils * 0.25);
      alpha *= clamp((tendrils * 0.88 + haze * 0.18) * (0.54 + strength * 0.30), 0.0, 0.76);
    } else if (uMode < 6.5) {
      float coreRadius = 0.30 + p0 * 0.10 + uBass * 0.025;
      float core = 1.0 - smoothstep(coreRadius - 0.03, coreRadius + 0.025, d);
      float corona = exp(-abs(d - coreRadius) * (12.0 + p1 * 10.0));
      float outer = exp(-abs(d - coreRadius) * (3.5 + p2 * 2.5));
      outColor = mix(vec3(0.0), mix(uColorA, uColorC, 0.65), clamp(corona * 0.48 + outer * 0.16, 0.0, 1.0));
      alpha *= clamp(core * 0.86 + corona * (0.28 + uBeat * 0.05) + outer * 0.08, 0.0, 0.82);
    } else {
      vec2 dir = normalize(local + vec2(0.0001));
      vec2 tangent = vec2(-dir.y, dir.x);
      float core = 1.0 - smoothstep(0.08, 0.72, d);
      float spiral = sin(atan(local.y, local.x) * (5.0 + p1 * 4.0) - log(d + 0.08) * (5.0 + p2 * 5.0) - uTime * (0.8 + p0 * 2.0));
      float pull = (0.004 + p1 * 0.014) * core * strength;
      vec2 uv = sceneUv - dir * pull + tangent * spiral * pull * 0.55;
      vec3 warped = sampleScene(uv);
      float horizon = exp(-abs(d - 0.28) * (14.0 + p2 * 12.0));
      float blackCore = 1.0 - smoothstep(0.06, 0.25, d);
      outColor = mix(warped, vec3(0.0), blackCore * 0.92);
      outColor += mix(uColorA, uColorC, 0.45) * horizon * (0.04 + uHigh * 0.06);
      alpha *= clamp(0.36 + core * 0.30 + horizon * 0.12, 0.0, 0.76);
    }

    alpha = clamp(alpha, 0.0, 0.82);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(max(outColor, vec3(0.0)), alpha);
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

function makeMaterial(kind: EffectKind, source: THREE.Texture) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uScene: { value: source }, uResolution: { value: new THREE.Vector2(2, 2) }, uTime: { value: 0 }, uMode: { value: MODE[kind] || 1 },
      uP0: { value: 0.65 }, uP1: { value: 0.5 }, uP2: { value: 0.4 }, uDrive: { value: 1 },
      uBass: { value: 0 }, uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uBeat: { value: 0 }, uTransient: { value: 0 },
      uOpacity: { value: 0.36 }, uColorA: { value: new THREE.Color("#4c3a72") }, uColorB: { value: new THREE.Color("#111422") }, uColorC: { value: new THREE.Color("#e3ddff") },
    },
    transparent: true,
    blending: THREE.NormalBlending,
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
  entry.env.bass = step(entry.env.bass, Math.min(2, snapshot.bass), 0.026, 0.16);
  entry.env.low = step(entry.env.low, Math.min(2, snapshot.low), 0.028, 0.15);
  entry.env.mid = step(entry.env.mid, Math.min(2, snapshot.mid), 0.022, 0.12);
  entry.env.high = step(entry.env.high, Math.min(2, snapshot.high), 0.014, 0.08);
  entry.env.beat = step(entry.env.beat, Math.min(2, snapshot.beat), 0.008, 0.11);
  entry.env.transient = step(entry.env.transient, Math.min(2, snapshot.transient), 0.006, 0.07);
}

function radians(rotation: number | undefined) {
  const r = Number(rotation || 0);
  return Math.abs(r) > Math.PI * 2.05 ? r * Math.PI / 180 : r;
}

export class ThreeShadowDarkLayer {
  private entries = new Map<string, Entry>();
  private geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  private sourceTexture: THREE.CanvasTexture;
  private frame = 0;

  constructor(private scene: THREE.Scene, sourceCanvas: HTMLCanvasElement) {
    this.sourceTexture = new THREE.CanvasTexture(sourceCanvas);
    this.sourceTexture.minFilter = THREE.LinearFilter;
    this.sourceTexture.magFilter = THREE.LinearFilter;
    this.sourceTexture.generateMipmaps = false;
    this.sourceTexture.colorSpace = THREE.SRGBColorSpace;
    this.sourceTexture.flipY = true;
  }

  update(project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, colorOverrides?: Record<string, string>) {
    this.frame++;
    this.sourceTexture.needsUpdate = true;
    const time = performance.now() / 1000;
    for (const region of project.regions) for (const effect of region.effects) {
      if (!effect.enabled || !SHADOW_DARK_KINDS.has(effect.kind)) continue;
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
      const material = makeMaterial(effect.kind, this.sourceTexture);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 44;
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
    const broad = effect.kind === "RoomDim" || effect.kind === "ContrastSurge";
    const defaultW = baseRadius * (broad ? 4.2 : 2.7);
    const defaultH = baseRadius * (broad ? 3.4 : 2.7);
    const rx = Math.max(14, ((effect.fxW || region.width || defaultW) / 2) * (viewport.w / project.width) * sx);
    const ry = Math.max(14, ((effect.fxH || region.height || defaultH) / 2) * (viewport.h / project.height) * sy);
    entry.mesh.position.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.24);
    entry.mesh.scale.set((rx / width) * 2, (ry / height) * 2, 1);
    entry.mesh.rotation.z = -radians(region.rotation);

    const u = entry.material.uniforms;
    u.uResolution.value.set(width, height);
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
    u.uOpacity.value = Math.max(0, Math.min(0.80, effect.opacity * effect.brightness * project.masters.brightness * 0.50));
    u.uColorA.value.set(colorOverrides?.[effect.id] || effect.color || "#4c3a72");
    u.uColorB.value.set(effect.color2 || "#111422");
    u.uColorC.value.set(effect.color3 || "#e3ddff");
  }

  dispose() {
    for (const entry of this.entries.values()) {
      this.scene.remove(entry.mesh);
      entry.material.dispose();
    }
    this.entries.clear();
    this.geometry.dispose();
    this.sourceTexture.dispose();
  }
}
