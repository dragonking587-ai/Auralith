import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

export const COLOR_DIGITAL_KINDS = new Set<EffectKind>([
  "HueShift", "ChromaticPulse", "GlitchLight", "Kaleidoscope", "MirrorFracture",
  "PixelDissolve", "ScanlinePulse", "RgbSplit", "FilmBurn"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  HueShift: 1,
  ChromaticPulse: 2,
  GlitchLight: 3,
  Kaleidoscope: 4,
  MirrorFracture: 5,
  PixelDissolve: 6,
  ScanlinePulse: 7,
  RgbSplit: 8,
  FilmBurn: 9,
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
    p = fract(p * vec2(123.34, 345.45));
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
      v += noise21(p) * a;
      p = p * 2.03 + vec2(2.7, 8.1);
      a *= 0.5;
    }
    return v;
  }

  vec3 sampleScene(vec2 uv) {
    return texture2D(uScene, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
  }

  vec3 hueRotate(vec3 color, float angle) {
    const mat3 toYiq = mat3(
      0.299, 0.587, 0.114,
      0.596, -0.274, -0.322,
      0.211, -0.523, 0.312
    );
    const mat3 toRgb = mat3(
      1.0, 0.956, 0.621,
      1.0, -0.272, -0.647,
      1.0, -1.106, 1.703
    );
    vec3 yiq = toYiq * color;
    float h = atan(yiq.z, yiq.y) + angle;
    float chroma = length(yiq.yz);
    yiq.y = chroma * cos(h);
    yiq.z = chroma * sin(h);
    return max(toRgb * yiq, vec3(0.0));
  }

  void main() {
    vec2 local = (vUv - 0.5) * 2.0;
    float d = length(local);
    float mask = 1.0 - smoothstep(0.72, 1.0, d);
    if (mask < 0.002) discard;

    vec2 sceneUv = gl_FragCoord.xy / max(uResolution, vec2(2.0));
    vec3 base = sampleScene(sceneUv);
    float drive = clamp(uDrive, 0.0, 2.5);
    float audio = clamp(uBass * 0.25 + uLow * 0.18 + uMid * 0.22 + uHigh * 0.20 + uBeat * 0.08 + uTransient * 0.07, 0.0, 1.8);
    float strength = 0.45 + drive * 0.45 + audio * 0.16;
    float p0 = clamp(uP0, 0.0, 2.0);
    float p1 = clamp(uP1, 0.0, 2.0);
    float p2 = clamp(uP2, 0.0, 2.0);
    vec3 outColor = base;
    float alpha = mask * uOpacity;

    if (uMode < 1.5) {
      float angle = (sin(uTime * (0.30 + p0 * 0.75)) * 0.65 + uMid * 0.35 + uBeat * 0.14) * (0.45 + p1 * 0.65);
      vec3 shifted = hueRotate(base, angle);
      outColor = mix(base, shifted, clamp(0.30 + strength * 0.32, 0.0, 0.88));
      alpha *= 0.42;
    } else if (uMode < 2.5) {
      vec2 dir = normalize(local + vec2(0.0001));
      float pulse = 0.5 + 0.5 * sin(uTime * (1.4 + p0 * 3.8));
      float amount = (0.0007 + p1 * 0.0036) * (0.55 + pulse * 0.65 + uHigh * 0.65 + uTransient * 0.35);
      float r = sampleScene(sceneUv + dir * amount).r;
      float g = sampleScene(sceneUv).g;
      float b = sampleScene(sceneUv - dir * amount).b;
      outColor = vec3(r, g, b) + mix(uColorA, uColorC, 0.55) * pulse * uBeat * 0.05;
      alpha *= 0.48;
    } else if (uMode < 3.5) {
      float rows = 45.0 + p1 * 120.0;
      float row = floor(vUv.y * rows);
      float tick = floor(uTime * (7.0 + p0 * 18.0));
      float gate = step(0.66, hash21(vec2(row, tick)));
      float block = step(0.74, hash21(floor(vUv * vec2(12.0 + p2 * 18.0, 8.0 + p1 * 12.0)) + tick));
      float jitter = (hash21(vec2(row * 1.71, tick + 9.0)) - 0.5) * gate * (0.004 + p2 * 0.018);
      jitter *= 0.65 + uHigh * 0.85 + uTransient * 0.55;
      vec2 uv = sceneUv + vec2(jitter, 0.0);
      float split = (0.0007 + p1 * 0.0022) * (0.7 + uHigh);
      outColor = vec3(sampleScene(uv + vec2(split, 0.0)).r, sampleScene(uv).g, sampleScene(uv - vec2(split, 0.0)).b);
      outColor += mix(uColorA, uColorB, block) * block * gate * (0.04 + uTransient * 0.08);
      alpha *= 0.38 + gate * 0.18;
    } else if (uMode < 4.5) {
      vec2 p = local;
      float r = length(p);
      float a = atan(p.y, p.x);
      float segments = 4.0 + floor(p1 * 5.0);
      float sector = 6.2831853 / segments;
      a = abs(mod(a + sector * 0.5, sector) - sector * 0.5);
      vec2 folded = vec2(cos(a), sin(a)) * r;
      vec2 uv = sceneUv + (folded - local) * (0.035 + p2 * 0.055) * strength;
      outColor = sampleScene(uv);
      outColor += uColorC * exp(-abs(sin(a * segments * 2.0)) * 10.0) * 0.025;
      alpha *= 0.50;
    } else if (uMode < 5.5) {
      float a = atan(local.y, local.x);
      float r = length(local);
      float wedges = 7.0 + floor(p1 * 8.0);
      float wedgeId = floor((a + 3.14159265) / 6.2831853 * wedges);
      float jitter = (hash21(vec2(wedgeId, 3.1)) - 0.5) * (0.006 + p2 * 0.018) * strength;
      vec2 tangent = normalize(vec2(-local.y, local.x) + vec2(0.0001));
      vec3 shard = sampleScene(sceneUv + tangent * jitter);
      float crack = pow(1.0 - abs(sin((a + 0.08 * noise21(local * 7.0)) * wedges)), 18.0);
      float radialCrack = pow(1.0 - abs(sin(r * (18.0 + p0 * 16.0))), 24.0) * 0.45;
      outColor = shard + uColorC * (crack + radialCrack) * (0.04 + uHigh * 0.05);
      alpha *= 0.44 + crack * 0.12;
    } else if (uMode < 6.5) {
      vec2 grid = floor(vUv * (vec2(24.0, 15.0) + p1 * vec2(40.0, 25.0)));
      float cell = hash21(grid);
      float threshold = 0.42 + 0.28 * sin(uTime * (0.35 + p0 * 1.1)) + uBeat * 0.08;
      float survive = smoothstep(threshold - 0.08, threshold + 0.08, cell);
      float edge = 1.0 - smoothstep(0.0, 0.10, abs(cell - threshold));
      outColor = mix(base * 0.25, base, survive) + mix(uColorA, uColorC, 0.65) * edge * (0.08 + uHigh * 0.10);
      alpha *= 0.32 + survive * 0.24 + edge * 0.12;
    } else if (uMode < 7.5) {
      float density = 120.0 + p1 * 260.0;
      float scan = 0.86 + 0.14 * sin(gl_FragCoord.y * (0.55 + p2 * 0.75));
      float sweepPos = fract(uTime * (0.12 + p0 * 0.42));
      float sweep = exp(-abs(vUv.y - sweepPos) * (22.0 + p1 * 35.0));
      outColor = base * scan + mix(uColorA, uColorC, 0.6) * sweep * (0.07 + uHigh * 0.09 + uBeat * 0.05);
      alpha *= 0.34 + sweep * 0.15 + density * 0.0;
    } else if (uMode < 8.5) {
      float angle = (p2 - 0.5) * 3.14159265;
      vec2 dir = vec2(cos(angle), sin(angle));
      float split = (0.0010 + p1 * 0.0046) * (0.55 + uHigh * 0.82 + uTransient * 0.45);
      float r = sampleScene(sceneUv + dir * split).r;
      float g = sampleScene(sceneUv).g;
      float b = sampleScene(sceneUv - dir * split).b;
      outColor = vec3(r, g, b);
      alpha *= 0.48;
    } else {
      vec2 burnP = local * (2.0 + p1 * 1.4);
      float n = fbm(burnP + vec2(uTime * 0.08, -uTime * 0.11));
      float radial = smoothstep(0.28, 1.0, d);
      float burn = smoothstep(0.48 - p2 * 0.10, 0.78, n + radial * 0.28 + uTransient * 0.08);
      float edge = 1.0 - smoothstep(0.03, 0.17, abs((n + radial * 0.28) - 0.62));
      vec3 ember = mix(vec3(0.35, 0.015, 0.0), uColorA, 0.55);
      ember = mix(ember, uColorC, edge * 0.55);
      outColor = mix(base, ember * (1.2 + uBeat * 0.25), burn * 0.72) + edge * uColorB * 0.12;
      alpha *= 0.40 + burn * 0.22;
    }

    alpha = clamp(alpha * (0.78 + strength * 0.22), 0.0, 0.70);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(max(outColor, vec3(0.0)), alpha);
  }
`;

type Envelope = { bass: number; low: number; mid: number; high: number; beat: number; transient: number; last: number };
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
      uOpacity: { value: 0.38 }, uColorA: { value: new THREE.Color("#d98cff") }, uColorB: { value: new THREE.Color("#55d8ff") }, uColorC: { value: new THREE.Color("#ffffff") },
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
  entry.env.bass = step(entry.env.bass, Math.min(2, snapshot.bass), 0.024, 0.14);
  entry.env.low = step(entry.env.low, Math.min(2, snapshot.low), 0.026, 0.13);
  entry.env.mid = step(entry.env.mid, Math.min(2, snapshot.mid), 0.020, 0.10);
  entry.env.high = step(entry.env.high, Math.min(2, snapshot.high), 0.012, 0.07);
  entry.env.beat = step(entry.env.beat, Math.min(2, snapshot.beat), 0.008, 0.10);
  entry.env.transient = step(entry.env.transient, Math.min(2, snapshot.transient), 0.006, 0.06);
}

function radians(rotation: number | undefined) {
  const r = Number(rotation || 0);
  return Math.abs(r) > Math.PI * 2.05 ? r * Math.PI / 180 : r;
}

export class ThreeColorDigitalLayer {
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
      if (!effect.enabled || !COLOR_DIGITAL_KINDS.has(effect.kind)) continue;
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
      mesh.renderOrder = 46;
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
    const defaultW = baseRadius * 3.0;
    const defaultH = baseRadius * 2.4;
    const rx = Math.max(14, ((effect.fxW || region.width || defaultW) / 2) * (viewport.w / project.width) * sx);
    const ry = Math.max(14, ((effect.fxH || region.height || defaultH) / 2) * (viewport.h / project.height) * sy);
    entry.mesh.position.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.26);
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
    u.uOpacity.value = Math.max(0, Math.min(0.68, effect.opacity * effect.brightness * project.masters.brightness * 0.50));
    u.uColorA.value.set(colorOverrides?.[effect.id] || effect.color || "#d98cff");
    u.uColorB.value.set(effect.color2 || "#55d8ff");
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
