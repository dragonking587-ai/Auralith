import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

export const LIGHT_OPTICAL_KINDS = new Set<EffectKind>([
  "GlowBloom", "Halo", "LightRays", "GodRays", "LensFlare", "Starburst", "Spotlight",
  "Shimmer", "GlitterSparkle", "NeonGlow", "NeonChase", "PrismaticLight"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  GlowBloom: 1,
  Halo: 2,
  LightRays: 3,
  GodRays: 4,
  LensFlare: 5,
  Starburst: 6,
  Spotlight: 7,
  Shimmer: 8,
  GlitterSparkle: 9,
  NeonGlow: 10,
  NeonChase: 11,
  PrismaticLight: 12,
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

  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  float starSpark(vec2 p, float sharpness) {
    float ax = exp(-abs(p.x) * sharpness) * exp(-abs(p.y) * 3.2);
    float ay = exp(-abs(p.y) * sharpness) * exp(-abs(p.x) * 3.2);
    vec2 d = vec2((p.x + p.y) * 0.7071, (p.y - p.x) * 0.7071);
    float diag = (exp(-abs(d.x) * sharpness * 1.15) * exp(-abs(d.y) * 5.0) +
                  exp(-abs(d.y) * sharpness * 1.15) * exp(-abs(d.x) * 5.0)) * 0.42;
    return ax + ay + diag;
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
      float pulse = 0.88 + uBass * 0.20 + uBeat * 0.20;
      float core = exp(-r * r * (10.0 + p1 * 9.0));
      float inner = exp(-r * (4.0 + p1 * 2.4));
      float outer = exp(-r * (1.45 + p2 * 1.7));
      intensity = (core * 1.25 + inner * 0.48 + outer * 0.20) * (0.30 + drive * 0.62) * pulse;
      hot = clamp(core * 1.3 + uTransient * 0.2, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(inner + core, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 2.5) {
      float radius = 0.43 + 0.09 * sin(t * (0.7 + p0 * 1.4)) + uBeat * 0.035;
      float d = abs(r - radius);
      float ring = exp(-d * (54.0 + p1 * 64.0));
      float corona = exp(-d * (10.0 + p2 * 11.0));
      intensity = (ring * 1.35 + corona * 0.28) * (0.28 + drive * 0.72 + uMid * 0.12);
      hot = clamp(ring * 1.1, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(corona + ring, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 3.5) {
      float rays = 0.0;
      for (int i = 0; i < 7; i++) {
        float fi = float(i);
        float a = -1.25 + fi * 0.42 + sin(t * (0.22 + fi * 0.018) + fi * 1.7) * 0.045 * (0.35 + p0);
        vec2 dir = vec2(cos(a), sin(a));
        float along = dot(q, dir);
        float across = abs(q.x * dir.y - q.y * dir.x);
        float beam = exp(-across * (12.0 + p1 * 11.0)) * smoothstep(-0.08, 0.12, along) * exp(-max(along, 0.0) * (0.72 + p2 * 0.55));
        rays += beam * (0.55 + hash21(vec2(fi, 4.7)) * 0.45);
      }
      float source = exp(-r * (8.0 + p1 * 5.0));
      intensity = (rays * 0.38 + source * 0.82) * (0.24 + drive * 0.66 + uMid * 0.16);
      hot = clamp(source * 1.1, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(rays * 0.45 + source, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 4.5) {
      float angular = ang / 6.2831853 + 0.5;
      float bands = noise21(vec2(angular * (16.0 + p1 * 18.0), floor(t * 0.18))) * 0.7 +
                    noise21(vec2(angular * (39.0 + p1 * 24.0), t * 0.08)) * 0.3;
      float shafts = smoothstep(0.54 - p2 * 0.08, 0.82, bands);
      float radial = exp(-r * (1.25 + p0 * 0.35)) * (1.0 - smoothstep(0.10, 1.35, r));
      float source = exp(-r * 8.0);
      intensity = (shafts * radial * 0.75 + source) * (0.22 + drive * 0.60 + uLow * 0.12 + uMid * 0.12);
      hot = clamp(source + shafts * 0.12, 0.0, 1.0);
      col = mix(uColorB, uColorA, shafts);
      col = mix(col, uColorC, hot);
    } else if (uMode < 5.5) {
      float source = exp(-r * r * (18.0 + p1 * 10.0));
      float streak = exp(-abs(q.y) * (72.0 + p1 * 60.0)) * exp(-abs(q.x) * (1.4 + p2));
      float ghosts = 0.0;
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float gx = mix(-0.72, 0.68, fi / 3.0);
        float gr = length(q - vec2(gx, 0.0));
        float rad = 0.07 + fi * 0.025;
        ghosts += exp(-abs(gr - rad) * (38.0 + p1 * 25.0)) * (0.22 - fi * 0.032);
      }
      float glint = starSpark(q, 38.0 + p1 * 22.0) * 0.35;
      intensity = (source * 1.35 + streak * 0.36 + ghosts + glint) * (0.20 + drive * 0.66 + uHigh * 0.10 + uTransient * 0.18);
      hot = clamp(source * 1.3 + glint * 0.25, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(source + streak * 0.3, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 6.5) {
      float spokes = starSpark(q, 28.0 + p1 * 38.0);
      float radial = exp(-r * (5.0 + p2 * 4.0));
      float core = exp(-r * r * 42.0);
      intensity = (spokes * radial * 0.72 + core * 1.25) * (0.22 + drive * 0.72 + uHigh * 0.14 + uTransient * 0.18);
      hot = clamp(core * 1.25 + spokes * 0.16, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(spokes * 0.5 + core, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 7.5) {
      float yy = (q.y + 1.0) * 0.5;
      float coneHalf = mix(0.10, 0.62, clamp(0.28 + p1 * 0.28, 0.0, 1.0)) * max(yy, 0.03);
      float edge = 1.0 - smoothstep(coneHalf * 0.64, coneHalf, abs(q.x));
      float vertical = smoothstep(0.0, 0.10, yy) * (1.0 - smoothstep(0.88, 1.08, yy));
      float falloff = 1.0 / (1.0 + yy * yy * (1.8 + p2 * 2.4));
      float cone = edge * vertical * falloff;
      float source = exp(-length(q - vec2(0.0, -0.90)) * (12.0 + p1 * 5.0));
      intensity = (cone * 0.58 + source) * (0.22 + drive * 0.58 + uLow * 0.10);
      hot = clamp(source * 1.2, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(cone + source, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 8.5) {
      float n = noise21(q * vec2(13.0 + p1 * 11.0, 19.0 + p1 * 9.0) + vec2(t * (0.7 + p0), -t * 0.43));
      float bands = pow(max(0.0, sin((q.x + q.y * 0.54) * (24.0 + p1 * 18.0) - t * (4.0 + p0 * 5.0))), 12.0);
      float spec = smoothstep(0.74 - p2 * 0.08, 0.95, n) * 0.65 + bands;
      float fade = 1.0 - smoothstep(0.68, 1.28, r);
      intensity = spec * fade * (0.16 + drive * 0.52 + uHigh * 0.28);
      hot = clamp(spec * 0.55 + uTransient * 0.18, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(spec, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 9.5) {
      float glitter = 0.0;
      float glow = 0.0;
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        vec2 seed = vec2(hash21(vec2(fi, 1.7)), hash21(vec2(fi, 9.3)));
        vec2 pos = seed * 1.68 - 0.84;
        float blink = pow(max(0.0, sin(t * (1.8 + hash21(seed) * 4.5) + fi * 2.13)), 10.0);
        vec2 d = q - pos;
        float sp = starSpark(d * (7.0 + p1 * 3.0), 22.0 + p2 * 22.0);
        glitter += sp * blink;
        glow += exp(-length(d) * 28.0) * blink;
      }
      float fade = 1.0 - smoothstep(0.78, 1.30, r);
      intensity = (glitter * 0.31 + glow * 0.20) * fade * (0.16 + drive * 0.60 + uHigh * 0.20 + uTransient * 0.22);
      hot = clamp(glitter * 0.16 + glow * 0.25, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(glow + glitter * 0.15, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 10.5) {
      float d = abs(sdBox(q, vec2(0.52, 0.30))) - 0.018;
      float tube = exp(-abs(d) * (78.0 + p1 * 52.0));
      float gas = exp(-abs(d) * (12.0 + p2 * 8.0));
      float hum = 0.91 + 0.09 * sin(t * (3.0 + p0 * 2.5)) + uHigh * 0.06;
      intensity = (tube * 1.28 + gas * 0.32) * (0.22 + drive * 0.70) * hum;
      hot = clamp(tube * 1.1, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(gas + tube, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 11.5) {
      float boxD = abs(sdBox(q, vec2(0.53, 0.31))) - 0.018;
      float tube = exp(-abs(boxD) * (72.0 + p1 * 45.0));
      float gas = exp(-abs(boxD) * (11.0 + p2 * 8.0));
      float perimeterPhase = (abs(q.x) > abs(q.y) ? q.x + q.y * 0.42 : q.y - q.x * 0.42);
      float chase = pow(0.5 + 0.5 * sin(perimeterPhase * (15.0 + p1 * 10.0) - t * (5.0 + p0 * 6.0)), 7.0);
      intensity = (tube * (0.42 + chase * 1.05) + gas * (0.12 + chase * 0.22)) * (0.20 + drive * 0.66 + uBeat * 0.12);
      hot = clamp(tube * chase * 1.25, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(chase * 0.85 + tube * 0.25, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else {
      float fan = 1.0 - smoothstep(0.18 + p1 * 0.08, 0.52 + p1 * 0.18, abs(q.y) / max(q.x + 1.0, 0.12));
      fan *= smoothstep(-0.86, -0.10, q.x) * (1.0 - smoothstep(0.62, 1.02, q.x));
      float spectral = clamp((q.y / max(q.x + 1.15, 0.25)) * 1.6 + 0.5, 0.0, 1.0);
      vec3 prism = mix(uColorB, uColorA, smoothstep(0.0, 0.58, spectral));
      prism = mix(prism, uColorC, smoothstep(0.54, 1.0, spectral));
      float shimmer = 0.84 + 0.16 * sin((q.x + spectral) * (18.0 + p2 * 12.0) - t * (2.0 + p0 * 3.0));
      float source = exp(-length(q - vec2(-0.72, 0.0)) * 13.0);
      intensity = (fan * 0.72 * shimmer + source * 1.15) * (0.18 + drive * 0.62 + uMid * 0.12 + uHigh * 0.14);
      hot = clamp(source * 1.2, 0.0, 1.0);
      col = mix(prism, uColorC, hot);
    }

    float alpha = clamp(intensity * uOpacity, 0.0, 0.62);
    if (alpha < 0.002) discard;
    float emission = 1.0 + hot * 1.75 + min(intensity, 2.0) * 0.30;
    gl_FragColor = vec4(max(col, vec3(0.0)) * emission, alpha);
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
      uTime: { value: 0 }, uMode: { value: MODE[kind] || 1 }, uP0: { value: 0.65 }, uP1: { value: 0.5 }, uP2: { value: 0.4 },
      uDrive: { value: 1 }, uBass: { value: 0 }, uLow: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uBeat: { value: 0 }, uTransient: { value: 0 },
      uOpacity: { value: 0.42 },
      uColorA: { value: new THREE.Color("#ffd98a") }, uColorB: { value: new THREE.Color("#7eb8ff") }, uColorC: { value: new THREE.Color("#ffffff") },
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
  entry.env.bass = step(entry.env.bass, Math.min(2, snapshot.bass), 0.022, 0.14);
  entry.env.low = step(entry.env.low, Math.min(2, snapshot.low), 0.024, 0.13);
  entry.env.mid = step(entry.env.mid, Math.min(2, snapshot.mid), 0.018, 0.10);
  entry.env.high = step(entry.env.high, Math.min(2, snapshot.high), 0.010, 0.070);
  entry.env.beat = step(entry.env.beat, Math.min(2, snapshot.beat), 0.007, 0.095);
  entry.env.transient = step(entry.env.transient, Math.min(2, snapshot.transient), 0.005, 0.060);
}

function radians(rotation: number | undefined) {
  const r = Number(rotation || 0);
  return Math.abs(r) > Math.PI * 2.05 ? r * Math.PI / 180 : r;
}

export class ThreeLightOpticalLayer {
  private entries = new Map<string, Entry>();
  private geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  private frame = 0;

  constructor(private scene: THREE.Scene) {}

  update(project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, colorOverrides?: Record<string, string>) {
    this.frame++;
    const time = performance.now() / 1000;
    for (const region of project.regions) {
      for (const effect of region.effects) {
        if (!effect.enabled || !LIGHT_OPTICAL_KINDS.has(effect.kind)) continue;
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
      mesh.renderOrder = 38;
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
    const wide = effect.kind === "LightRays" || effect.kind === "GodRays" || effect.kind === "LensFlare" || effect.kind === "PrismaticLight" || effect.kind === "Spotlight";
    const defaultW = baseRadius * (wide ? 3.5 : 2.2);
    const defaultH = baseRadius * (wide ? 3.0 : 2.2);
    const rx = Math.max(12, ((effect.fxW || region.width || defaultW) / 2) * (viewport.w / project.width) * sx);
    const ry = Math.max(12, ((effect.fxH || region.height || defaultH) / 2) * (viewport.h / project.height) * sy);

    entry.mesh.position.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.20);
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
    u.uOpacity.value = Math.max(0, Math.min(0.62, effect.opacity * effect.brightness * project.masters.brightness * 0.48));
    u.uColorA.value.set(colorOverrides?.[effect.id] || effect.color || "#ffd98a");
    u.uColorB.value.set(effect.color2 || "#7eb8ff");
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
