import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

export const DISTORTION_KINDS = new Set<EffectKind>([
  "HeatDistortion",
  "Refraction",
  "WaterRipple",
  "Caustics",
  "WetReflection",
  "WaterReflection",
  "SpatialWarp",
  "HolographicDistortion",
]);

const MODE: Partial<Record<EffectKind, number>> = {
  HeatDistortion: 1,
  Refraction: 2,
  WaterRipple: 3,
  Caustics: 4,
  WetReflection: 5,
  WaterReflection: 6,
  SpatialWarp: 7,
  HolographicDistortion: 8,
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
  uniform float uQuality;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    v += a * noise2(p); p = p * 2.03 + vec2(7.1, 3.7); a *= 0.5;
    v += a * noise2(p); p = p * 2.11 + vec2(1.7, 9.2); a *= 0.5;
    v += a * noise2(p); p = p * 2.07 + vec2(4.3, 2.1); a *= 0.5;
    v += a * noise2(p);
    return v;
  }

  vec3 sampleScene(vec2 uv) {
    return texture2D(uScene, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
  }

  void main() {
    vec2 local = (vUv - 0.5) * 2.0;
    float d = length(local);
    float mask = 1.0 - smoothstep(0.72, 1.0, d);
    if (mask <= 0.001) discard;

    vec2 sceneUv = gl_FragCoord.xy / max(uResolution, vec2(2.0));
    vec3 base = sampleScene(sceneUv);
    float drive = clamp(uDrive, 0.0, 2.4);
    float audio = clamp(uBass * 0.30 + uLow * 0.22 + uMid * 0.22 + uHigh * 0.12 + uBeat * 0.08 + uTransient * 0.06, 0.0, 1.8);
    float strength = (0.45 + drive * 0.55) * (0.72 + audio * 0.28);
    float q = clamp(uQuality, 0.55, 2.0);
    vec3 outColor = base;
    float alpha = mask * uOpacity;

    if (uMode < 1.5) {
      // Heat distortion: rising low-frequency turbulence plus fine shimmer.
      vec2 p = local * vec2(2.1, 3.2);
      float n1 = fbm(p + vec2(0.0, -uTime * (0.32 + uP0 * 0.35)));
      float n2 = fbm(p * 1.9 + vec2(13.4, -uTime * (0.61 + uP1 * 0.48)));
      float shimmer = (n1 - 0.5) * 0.68 + (n2 - 0.5) * 0.32;
      float rise = 0.45 + 0.55 * (1.0 - vUv.y);
      vec2 offset = vec2(shimmer, abs(shimmer) * 0.42) * (0.0035 + uP2 * 0.0070) * strength * rise;
      vec3 refracted = sampleScene(sceneUv + offset);
      float glint = max(0.0, n2 - 0.72) * (0.08 + uHigh * 0.08);
      outColor = refracted + uColorC * glint;
      alpha *= 0.34 + q * 0.08;
    } else if (uMode < 2.5) {
      // Refraction: radial lens normal, micro-ripples, and restrained dispersion.
      vec2 dir = normalize(local + vec2(0.0001));
      float lens = (1.0 - smoothstep(0.0, 0.95, d)) * (0.004 + uP0 * 0.014) * strength;
      float wave = sin(d * (17.0 + uP1 * 31.0) - uTime * (2.1 + uP2 * 3.2)) * (0.0015 + uMid * 0.0022);
      vec2 offset = dir * (lens + wave);
      float dispersion = (0.0004 + uHigh * 0.0011 + uTransient * 0.0006) * q;
      float r = sampleScene(sceneUv + offset + dir * dispersion).r;
      float g = sampleScene(sceneUv + offset).g;
      float b = sampleScene(sceneUv + offset - dir * dispersion).b;
      outColor = vec3(r, g, b);
      alpha *= 0.45;
    } else if (uMode < 3.5) {
      // Water ripple: multiple decaying ring fronts perturb the source scene.
      float phaseA = d * (20.0 + uP1 * 34.0) - uTime * (2.2 + uP0 * 3.6);
      float phaseB = d * (34.0 + uP2 * 24.0) - uTime * (1.4 + uP0 * 2.2) + 1.7;
      float rings = sin(phaseA) * 0.65 + sin(phaseB) * 0.35;
      float decay = exp(-d * (0.9 + uP2 * 1.3));
      vec2 dir = normalize(local + vec2(0.0001));
      vec2 offset = dir * rings * decay * (0.0025 + uP1 * 0.0070) * strength;
      vec3 refracted = sampleScene(sceneUv + offset);
      float crest = pow(max(0.0, 0.5 + 0.5 * sin(phaseA)), 12.0) * decay;
      outColor = refracted + mix(uColorA, uColorC, 0.65) * crest * (0.08 + uHigh * 0.10);
      alpha *= 0.48;
    } else if (uMode < 4.5) {
      // Caustics: intersecting warped wave cells create moving focused light.
      vec2 p = local * (3.2 + uP0 * 3.8);
      p += vec2(fbm(p * 0.75 + uTime * 0.18), fbm(p * 0.82 - uTime * 0.15)) * (0.55 + uP1 * 0.65);
      float a = abs(sin(p.x * 2.7 + sin(p.y * 1.9 + uTime * 0.7)));
      float b = abs(sin(p.y * 3.1 + sin(p.x * 2.2 - uTime * 0.55)));
      float cell = 1.0 - clamp(abs(a - b) * (3.4 + uP2 * 3.0), 0.0, 1.0);
      float caustic = pow(cell, 5.0 + q * 2.0) * (0.24 + strength * 0.34);
      outColor = base + mix(uColorA, uColorC, 0.58) * caustic;
      alpha *= 0.44 + caustic * 0.32;
    } else if (uMode < 5.5) {
      // Wet reflection: vertical drag, wavering highlights, broken surface sheen.
      float wave = sin(local.x * (8.0 + uP0 * 14.0) + uTime * (1.2 + uP1 * 2.2));
      wave += (fbm(local * vec2(4.0, 7.0) + vec2(0.0, uTime * 0.25)) - 0.5) * 1.2;
      vec2 offset = vec2(wave * (0.002 + uP2 * 0.004), -abs(wave) * 0.0015) * strength;
      vec3 reflected = sampleScene(sceneUv + offset);
      float streak = pow(max(0.0, sin((local.x + wave * 0.08) * 24.0)), 14.0) * (1.0 - smoothstep(0.25, 1.0, abs(local.y)));
      outColor = reflected + uColorC * streak * (0.05 + uHigh * 0.09);
      alpha *= 0.38;
    } else if (uMode < 6.5) {
      // Water reflection: coherent horizontal wave normals with depth variation.
      float w1 = sin(local.y * (10.0 + uP0 * 19.0) + uTime * (1.1 + uP1 * 2.6));
      float w2 = sin(local.y * (22.0 + uP2 * 21.0) - uTime * 1.7 + local.x * 4.0);
      float depth = 0.35 + 0.65 * vUv.y;
      vec2 offset = vec2((w1 * 0.68 + w2 * 0.32) * (0.003 + uP1 * 0.0065) * strength * depth, 0.0);
      vec3 reflected = sampleScene(sceneUv + offset);
      float highlight = pow(max(0.0, 0.5 + 0.5 * w1), 10.0) * 0.10;
      outColor = reflected + mix(uColorA, uColorC, 0.72) * highlight * (0.6 + uHigh);
      alpha *= 0.42;
    } else if (uMode < 7.5) {
      // Spatial warp: radial compression plus tangent swirl around the emitter.
      vec2 dir = normalize(local + vec2(0.0001));
      vec2 tangent = vec2(-dir.y, dir.x);
      float core = 1.0 - smoothstep(0.08, 0.92, d);
      float pulse = 0.65 + 0.35 * sin(uTime * (0.8 + uP0 * 1.8) + d * 8.0);
      vec2 offset = (-dir * (0.004 + uP1 * 0.014) + tangent * (0.002 + uP2 * 0.010) * pulse) * core * strength;
      vec3 warped = sampleScene(sceneUv + offset);
      float rim = 1.0 - smoothstep(0.0, 0.12, abs(d - 0.68));
      outColor = warped + mix(uColorB, uColorC, 0.7) * rim * (0.04 + uTransient * 0.10);
      alpha *= 0.46;
    } else {
      // Holographic distortion: scanline shear, intermittent strips, RGB separation.
      float lines = 70.0 + uP1 * 130.0;
      float row = floor(vUv.y * lines);
      float gate = step(0.72, hash21(vec2(row, floor(uTime * (5.0 + uP0 * 11.0)))));
      float jitter = (hash21(vec2(row * 1.31, floor(uTime * 17.0))) - 0.5) * gate;
      jitter += sin(vUv.y * 230.0 + uTime * 8.0) * 0.08;
      float amount = (0.0015 + uP2 * 0.0080) * (0.55 + uHigh * 0.75 + uTransient * 0.55);
      vec2 uv = sceneUv + vec2(jitter * amount, 0.0);
      float split = (0.0008 + uHigh * 0.0018) * q;
      float r = sampleScene(uv + vec2(split, 0.0)).r;
      float g = sampleScene(uv).g;
      float b = sampleScene(uv - vec2(split, 0.0)).b;
      float scan = 0.92 + 0.08 * sin(vUv.y * uResolution.y * 1.7);
      outColor = vec3(r, g, b) * scan + uColorA * gate * 0.035;
      alpha *= 0.40 + gate * 0.16;
    }

    alpha = clamp(alpha * (0.78 + strength * 0.22), 0.0, 0.68);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(max(outColor, vec3(0.0)), alpha);
  }
`;

type Entry = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
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
  const modulation = effect.audio === "Manual"
    ? effect.intensity
    : effect.intensity * (1 - effect.audioInfluence + effect.audioInfluence * selected);
  return modulation * project.masters.intensity;
}

function qualityValue(project: Project) {
  if (project.quality === "Ultra") return 2.0;
  if (project.quality === "High") return 1.45;
  if (project.quality === "Medium") return 1.0;
  return 0.72;
}

function makeMaterial(kind: EffectKind, source: THREE.Texture) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uScene: { value: source },
      uResolution: { value: new THREE.Vector2(2, 2) },
      uTime: { value: 0 },
      uMode: { value: MODE[kind] || 1 },
      uP0: { value: 0.65 },
      uP1: { value: 0.5 },
      uP2: { value: 0.4 },
      uDrive: { value: 1 },
      uBass: { value: 0 },
      uLow: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
      uBeat: { value: 0 },
      uTransient: { value: 0 },
      uOpacity: { value: 0.32 },
      uQuality: { value: 1 },
      uColorA: { value: new THREE.Color("#7ad8ff") },
      uColorB: { value: new THREE.Color("#4266a8") },
      uColorC: { value: new THREE.Color("#ffffff") },
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export class ThreeDistortionLayer {
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

  update(
    project: Project,
    snapshot: AudioSnapshot,
    width: number,
    height: number,
    viewport: { x: number; y: number; w: number; h: number },
    colorOverrides?: Record<string, string>,
  ) {
    this.frame++;
    // The rc.49 base canvas uses preserveDrawingBuffer. Marking this CanvasTexture
    // dirty copies the already-completed legacy frame into the isolated Three.js
    // context without sharing WebGL state or objects between contexts.
    this.sourceTexture.needsUpdate = true;
    const time = performance.now() / 1000;

    for (const region of project.regions) {
      for (const effect of region.effects) {
        if (!effect.enabled || !DISTORTION_KINDS.has(effect.kind)) continue;
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

  private updateEffect(
    region: Region,
    effect: EffectInstance,
    project: Project,
    snapshot: AudioSnapshot,
    width: number,
    height: number,
    viewport: { x: number; y: number; w: number; h: number },
    time: number,
    colorOverrides?: Record<string, string>,
  ) {
    let entry = this.entries.get(effect.id);
    if (!entry) {
      const material = makeMaterial(effect.kind, this.sourceTexture);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      this.scene.add(mesh);
      entry = { mesh, material, lastSeen: this.frame };
      this.entries.set(effect.id, entry);
    }
    entry.lastSeen = this.frame;

    const x = viewport.x + ((region.x + (effect.offsetX || 0)) / project.width) * viewport.w;
    const y = viewport.y + ((region.y + (effect.offsetY || 0)) / project.height) * viewport.h;
    const rx = Math.max(
      14,
      (effect.fxW || region.width || region.radius * 2) / 2 *
        (viewport.w / project.width) *
        Math.max(0.05, effect.fxScaleX || effect.scale || region.sx || 1),
    );
    const ry = Math.max(
      14,
      (effect.fxH || region.height || region.radius * 2) / 2 *
        (viewport.h / project.height) *
        Math.max(0.05, effect.fxScaleY || effect.scale || region.sy || 1),
    );

    entry.mesh.position.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.035);
    entry.mesh.scale.set((rx / width) * 2, (ry / height) * 2, 1);

    const u = entry.material.uniforms;
    u.uResolution.value.set(width, height);
    u.uTime.value = time * effect.speed * project.masters.motion;
    u.uMode.value = MODE[effect.kind] || 1;
    u.uP0.value = effect.p0 ?? 0.65;
    u.uP1.value = effect.p1 ?? 0.5;
    u.uP2.value = effect.p2 ?? 0.4;
    u.uDrive.value = drive(effect, snapshot, project);
    u.uBass.value = snapshot.bass;
    u.uLow.value = snapshot.low;
    u.uMid.value = snapshot.mid;
    u.uHigh.value = snapshot.high;
    u.uBeat.value = snapshot.beat;
    u.uTransient.value = snapshot.transient;
    u.uQuality.value = qualityValue(project);
    u.uOpacity.value = Math.max(0, Math.min(0.64, effect.opacity * effect.brightness * project.masters.brightness * 0.52));
    u.uColorA.value.set(colorOverrides?.[effect.id] || effect.color || "#7ad8ff");
    u.uColorB.value.set(effect.color2 || "#4266a8");
    u.uColorC.value.set(effect.color3 || "#ffffff");
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
