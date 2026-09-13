import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

export const ENVIRONMENT_FINAL_KINDS = new Set<EffectKind>([
  "RealisticFlame", "Rain", "CelestialStars"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  RealisticFlame: 1,
  Rain: 2,
  CelestialStars: 3,
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

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise21(p);
      p = p * 2.03 + vec2(4.1, 7.3);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 q = (vUv - 0.5) * 2.0;
    float r = length(q);
    float drive = clamp(uDrive, 0.0, 2.5);
    float p0 = clamp(uP0, 0.0, 2.0);
    float p1 = clamp(uP1, 0.0, 2.0);
    float p2 = clamp(uP2, 0.0, 2.0);
    float intensity = 0.0;
    float hot = 0.0;
    vec3 col = uColorA;

    if (uMode < 1.5) {
      vec2 p = q;
      p.y += 0.10;
      float rise = uTime * (0.48 + p0 * 1.05 + uBass * 0.12);
      float fire = 0.0;
      float core = 0.0;
      float tipWisps = 0.0;

      // Broad open-fire bed: dense near the fuel line rather than a single nozzle/jet.
      float bedNoise = fbm(vec2(p.x * (3.2 + p1), p.y * 4.0 - rise * 0.65));
      float bedX = 1.0 - smoothstep(0.58, 0.94, abs(p.x));
      float bedY = exp(-pow((p.y + 0.72) * 4.2, 2.0));
      float bed = bedX * bedY * (0.72 + bedNoise * 0.55);
      fire += bed * 0.92;
      core += bed * (0.46 + 0.28 * (1.0 - abs(p.x)));

      // Nine independently moving tongues. Each has its own base, height, curl and breakup.
      for (int i = 0; i < 9; i++) {
        float fi = float(i);
        float seed = hash21(vec2(fi * 7.13 + 2.1, fi * 3.71 + 9.4));
        float seed2 = hash21(vec2(fi * 2.37 + 5.8, fi * 8.19 + 1.2));
        float baseX = mix(-0.68, 0.68, fi / 8.0) + (seed - 0.5) * 0.10;
        float height = 0.72 + seed * 0.58 + p0 * 0.20 + uBass * 0.10;
        float localY = (p.y + 0.76) / max(height, 0.25);
        float alive = smoothstep(-0.03, 0.07, localY) * (1.0 - smoothstep(0.78, 1.04, localY));
        float turbulence = fbm(vec2(fi * 2.7 + p.y * (2.8 + p1), p.y * 4.4 - rise * (0.82 + seed * 0.44)));
        float curl = sin(uTime * (1.55 + seed * 1.55) + fi * 1.73 + p.y * (2.1 + p2 * 1.8));
        float center = baseX + curl * (0.025 + localY * 0.075) + (turbulence - 0.5) * (0.10 + localY * 0.15);
        float width = mix(0.145 + seed2 * 0.055, 0.018 + seed * 0.024, clamp(localY, 0.0, 1.0));
        float dist = abs(p.x - center);
        float body = 1.0 - smoothstep(width * 0.42, width, dist);
        float breakup = smoothstep(0.22, 0.82, turbulence + (1.0 - clamp(localY, 0.0, 1.0)) * 0.22);
        float tongue = body * alive * (0.48 + breakup * 0.78);
        fire += tongue * (0.66 + seed * 0.42);

        float coreWidth = width * mix(0.45, 0.20, clamp(localY, 0.0, 1.0));
        float coreBody = 1.0 - smoothstep(coreWidth * 0.35, coreWidth, dist);
        core += coreBody * alive * (1.0 - smoothstep(0.42, 0.86, localY)) * (0.46 + breakup * 0.30);

        float tipBand = smoothstep(0.62, 0.84, localY) * (1.0 - smoothstep(0.88, 1.05, localY));
        tipWisps += body * tipBand * smoothstep(0.48, 0.82, turbulence) * (0.12 + seed * 0.12);
      }

      fire = clamp(fire, 0.0, 1.55);
      core = clamp(core, 0.0, 1.20);
      float edgeFlicker = 0.88 + 0.12 * sin(uTime * (4.1 + p0 * 2.8) + bedNoise * 7.0) + uTransient * 0.07;
      float audioBody = 0.48 + drive * 0.62 + uBass * 0.12 + uLow * 0.07;
      float detail = 1.0 + uMid * 0.07 + uHigh * 0.04;
      intensity = (fire * 0.84 + core * 0.90 + tipWisps) * edgeFlicker * audioBody * detail;
      hot = clamp(core * 1.12 + bed * 0.28 + uTransient * 0.04, 0.0, 1.0);
      float bodyMix = clamp(fire * 0.72 + bed * 0.30, 0.0, 1.0);
      col = mix(uColorB, uColorA, bodyMix);
      col = mix(col, uColorC, hot);
    } else if (uMode < 2.5) {
      vec2 p = vUv;
      float slant = 0.10 + p2 * 0.20;
      float speed = 0.55 + p0 * 1.75 + uHigh * 0.20;
      p.x += p.y * slant;
      p.y += uTime * speed;
      vec2 cells = vec2(34.0 + p1 * 42.0, 18.0 + p1 * 28.0);
      vec2 id = floor(p * cells);
      vec2 f = fract(p * cells) - 0.5;
      float rnd = hash21(id);
      f.x += (rnd - 0.5) * 0.72;
      f.y += (hash21(id + 7.1) - 0.5) * 0.45;
      float streak = exp(-abs(f.x) * (46.0 + p1 * 38.0)) * exp(-abs(f.y) * (6.0 + p2 * 8.0));
      float depth = mix(0.35, 1.0, rnd);
      float drop = streak * depth;
      float splashBand = exp(-abs(q.y + 0.78) * 24.0) * pow(max(0.0, sin(q.x * (24.0 + p1 * 20.0) + uTime * 5.0)), 16.0) * 0.18;
      intensity = (drop * 0.72 + splashBand) * (0.16 + drive * 0.58 + uHigh * 0.22 + uTransient * 0.12);
      hot = clamp(drop * 0.24 + uTransient * 0.12, 0.0, 1.0);
      col = mix(uColorB, uColorA, depth);
      col = mix(col, uColorC, hot);
    } else {
      vec2 grid = floor((vUv + vec2(uTime * 0.002, 0.0)) * vec2(48.0 + p1 * 52.0, 27.0 + p1 * 31.0));
      vec2 cell = fract(vUv * vec2(48.0 + p1 * 52.0, 27.0 + p1 * 31.0)) - 0.5;
      float rnd = hash21(grid);
      float present = step(0.91 - p2 * 0.055, rnd);
      float dist = length(cell + vec2(hash21(grid + 3.7) - 0.5, hash21(grid + 9.2) - 0.5) * 0.42);
      float star = exp(-dist * (42.0 + p1 * 35.0)) * present;
      float twinkle = 0.40 + 0.60 * pow(max(0.0, sin(uTime * (0.8 + rnd * 4.0) + rnd * 18.0)), 8.0);
      float crossX = exp(-abs(cell.x) * 48.0) * exp(-abs(cell.y) * 7.0);
      float crossY = exp(-abs(cell.y) * 48.0) * exp(-abs(cell.x) * 7.0);
      float glint = (crossX + crossY) * present * step(0.975, rnd) * twinkle;
      intensity = (star * twinkle * 0.72 + glint * 0.36) * (0.14 + drive * 0.54 + uHigh * 0.22 + uBeat * 0.08);
      hot = clamp(glint * 0.25 + star * twinkle * 0.20, 0.0, 1.0);
      col = mix(uColorB, uColorA, rnd);
      col = mix(col, uColorC, hot);
    }

    float alphaCap = uMode < 1.5 ? 0.94 : 0.62;
    float alpha = clamp(intensity * uOpacity, 0.0, alphaCap);
    if (alpha < 0.002) discard;
    float emission = 1.0 + hot * 1.65 + min(intensity, 2.0) * 0.24;
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
      uOpacity: { value: kind === "RealisticFlame" ? 0.88 : 0.42 }, uColorA: { value: new THREE.Color("#ff9a24") }, uColorB: { value: new THREE.Color("#4c8cff") }, uColorC: { value: new THREE.Color("#ffffff") },
    },
    transparent: true,
    blending: kind === "RealisticFlame" ? THREE.NormalBlending : THREE.AdditiveBlending,
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
  entry.env.bass = step(entry.env.bass, Math.min(2, snapshot.bass), 0.020, 0.13);
  entry.env.low = step(entry.env.low, Math.min(2, snapshot.low), 0.022, 0.12);
  entry.env.mid = step(entry.env.mid, Math.min(2, snapshot.mid), 0.016, 0.09);
  entry.env.high = step(entry.env.high, Math.min(2, snapshot.high), 0.009, 0.06);
  entry.env.beat = step(entry.env.beat, Math.min(2, snapshot.beat), 0.007, 0.09);
  entry.env.transient = step(entry.env.transient, Math.min(2, snapshot.transient), 0.004, 0.05);
}

function radians(rotation: number | undefined) {
  const r = Number(rotation || 0);
  return Math.abs(r) > Math.PI * 2.05 ? r * Math.PI / 180 : r;
}

export class ThreeEnvironmentFinalLayer {
  private entries = new Map<string, Entry>();
  private geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  private frame = 0;
  constructor(private scene: THREE.Scene) {}

  update(project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, colorOverrides?: Record<string, string>) {
    this.frame++;
    const time = performance.now() / 1000;
    for (const region of project.regions) for (const effect of region.effects) {
      if (!effect.enabled || !ENVIRONMENT_FINAL_KINDS.has(effect.kind)) continue;
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
      mesh.renderOrder = 40;
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
    const tall = effect.kind === "RealisticFlame" || effect.kind === "Rain";
    const wide = effect.kind === "CelestialStars" || effect.kind === "Rain";
    const defaultW = baseRadius * (wide ? 3.8 : 2.2);
    const defaultH = baseRadius * (tall ? 3.8 : 2.6);
    const rx = Math.max(12, ((effect.fxW || region.width || defaultW) / 2) * (viewport.w / project.width) * sx);
    const ry = Math.max(12, ((effect.fxH || region.height || defaultH) / 2) * (viewport.h / project.height) * sy);
    entry.mesh.position.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.21);
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
    u.uOpacity.value = effect.kind === "RealisticFlame"
      ? Math.max(0, Math.min(0.92, effect.opacity * effect.brightness * project.masters.brightness * 0.88))
      : Math.max(0, Math.min(0.60, effect.opacity * effect.brightness * project.masters.brightness * 0.48));
    u.uColorA.value.set(colorOverrides?.[effect.id] || effect.color || (effect.kind === "RealisticFlame" ? "#ff9a24" : "#c6e7ff"));
    u.uColorB.value.set(effect.color2 || (effect.kind === "RealisticFlame" ? "#ff3a00" : "#4c8cff"));
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
