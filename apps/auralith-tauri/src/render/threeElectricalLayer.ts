import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";

export const ELECTRICAL_KINDS = new Set<EffectKind>([
  "EnergyBeam", "LightningArc", "ElectricCrawl", "ThunderFlash", "Laser"
]);

const MODE: Partial<Record<EffectKind, number>> = {
  LightningArc: 1,
  ElectricCrawl: 2,
  ThunderFlash: 3,
  Laser: 4,
  EnergyBeam: 5,
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

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
  }

  float fbm1(float x) {
    float v = 0.0;
    float a = 0.5;
    v += a * noise1(x); x = x * 2.07 + 11.3; a *= 0.5;
    v += a * noise1(x); x = x * 2.11 + 7.1; a *= 0.5;
    v += a * noise1(x); x = x * 2.03 + 3.7; a *= 0.5;
    v += a * noise1(x);
    return v;
  }

  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h);
  }

  float boltOffset(float y, float topology, float chaos) {
    float stepped = floor(y * 18.0) / 18.0;
    float coarse = (noise1(stepped * 7.0 + topology * 19.7) - 0.5) * 0.32;
    float medium = (noise1(y * 31.0 + topology * 13.1) - 0.5) * 0.13;
    float fine = sin(y * 71.0 + topology * 5.7) * 0.018;
    return (coarse + medium + fine) * (0.45 + chaos * 0.85);
  }

  void main() {
    vec2 q = (vUv - vec2(0.5)) * 2.0;
    float r = length(q);
    float p0 = clamp(uP0, 0.0, 2.0);
    float p1 = clamp(uP1, 0.0, 2.0);
    float p2 = clamp(uP2, 0.0, 2.0);
    float drive = clamp(uDrive, 0.0, 2.5);
    float t = uTime;
    float intensity = 0.0;
    float hot = 0.0;
    vec3 col = uColorA;

    if (uMode < 1.5) {
      // Natural lightning: stepped topology, descending leader, return stroke,
      // forks, hot white core and a broader ionized corona.
      float rate = 0.42 + p0 * 1.65;
      float topology = floor(t * rate + uBeat * 0.75);
      float cycle = fract(t * rate + topology * 0.013);
      float travel = (1.0 - q.y) * 0.5;
      float progress = clamp(cycle * 1.34, 0.0, 1.0);
      float leader = 1.0 - smoothstep(progress, progress + 0.055, travel);
      float x = boltOffset(q.y, topology, 0.45 + p2);
      float d = abs(q.x - x);
      float width = 58.0 + p1 * 62.0;
      float core = exp(-d * width);
      float corona = exp(-d * (10.0 + p1 * 10.0));
      float returnStroke = pow(smoothstep(0.72, 1.0, progress), 2.4) * (0.72 + uBeat * 0.75 + uTransient * 1.25);
      float flash = max(returnStroke, uTransient * 0.8);

      float branches = 0.0;
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float y0 = mix(0.68, -0.58, fi / 3.0) + (hash11(topology * 9.1 + fi) - 0.5) * 0.18;
        float bx = boltOffset(y0, topology, 0.45 + p2);
        float side = hash11(topology * 17.0 + fi * 5.3) > 0.5 ? 1.0 : -1.0;
        vec2 a = vec2(bx, y0);
        vec2 b = a + vec2(side * (0.24 + hash11(topology + fi * 2.7) * (0.22 + p2 * 0.16)), -0.20 - hash11(topology * 3.7 + fi) * 0.42);
        float bd = segDist(q, a, b);
        float visible = leader * (0.35 + p2 * 0.45) * (0.55 + uHigh * 0.55);
        branches += exp(-bd * (62.0 + p1 * 30.0)) * visible;
        branches += exp(-bd * 15.0) * visible * 0.16;
      }

      float leaderGlow = (core * 1.8 + corona * 0.42 + branches * 0.95) * leader;
      intensity = leaderGlow * (0.46 + drive * 0.76 + flash * 0.62);
      hot = clamp(core * 1.3 + branches * 0.65 + flash * 0.25, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(corona + branches * 0.25, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 2.5) {
      // Electric Crawl: several independent surface filaments that slither,
      // reconnect and spark instead of rotating as a single canned texture.
      float topology = floor(t * (0.7 + p0 * 1.4));
      float crawl = t * (1.2 + p0 * 2.3);
      float f1 = abs(q.x - 0.32 * sin(q.y * (4.2 + p1 * 3.0) + crawl + fbm1(q.y * 8.0 + topology) * 3.0));
      float f2 = abs(q.y - 0.27 * sin(q.x * (5.0 + p1 * 2.5) - crawl * 0.83 + fbm1(q.x * 9.0 + topology * 2.0) * 2.6));
      vec2 rq = vec2(q.x * 0.72 + q.y * 0.69, -q.x * 0.69 + q.y * 0.72);
      float f3 = abs(rq.x - 0.24 * sin(rq.y * 7.0 + crawl * 1.17 + topology));
      float filament = exp(-f1 * (38.0 + p1 * 36.0)) + exp(-f2 * (42.0 + p1 * 34.0)) + exp(-f3 * (48.0 + p1 * 28.0));
      float halo = exp(-min(f1, min(f2, f3)) * (8.0 + p2 * 7.0));
      float edgeFade = 1.0 - smoothstep(0.72, 1.38, r);
      float node = pow(max(0.0, sin((q.x + q.y) * 19.0 - crawl * 3.2)), 20.0) * filament;
      intensity = (filament * 0.82 + halo * 0.17 + node * 0.55) * edgeFade * (0.35 + drive * 0.62 + uHigh * 0.34 + uTransient * 0.45);
      hot = clamp(filament * 0.72 + node, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(filament, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else if (uMode < 3.5) {
      // Thunder Flash: a fast exposure bloom with a white-hot center and brief
      // radial spokes. It is driven strongly by beats/transients but remains
      // previewable in Manual mode.
      float autoPulse = pow(max(0.0, sin(t * (0.65 + p0 * 2.4))), 18.0);
      float hit = max(autoPulse * 0.72, max(uBeat * 0.92, uTransient * 1.22));
      float center = exp(-r * r * (3.8 + p2 * 3.5));
      float halo = exp(-r * (1.55 + p1 * 1.6));
      float ang = atan(q.y, q.x);
      float spokes = pow(abs(cos(ang * (3.0 + floor(p1 * 4.0)))), 18.0) * exp(-r * 2.5);
      intensity = (center * 1.3 + halo * 0.52 + spokes * 0.28) * (0.10 + drive * 0.25 + hit * 1.55);
      hot = clamp(center * 0.82 + hit * 0.55, 0.0, 1.0);
      col = mix(uColorA, uColorC, hot);
    } else if (uMode < 4.5) {
      // Laser: coherent narrow core, diffraction halo and subtle moving energy
      // modulation. The beam stays geometrically stable instead of wobbling.
      float x = abs(q.x);
      float lengthMask = 1.0 - smoothstep(0.90, 1.0, abs(q.y));
      float core = exp(-x * (125.0 + p1 * 145.0));
      float inner = exp(-x * (42.0 + p1 * 38.0));
      float halo = exp(-x * (9.0 + p2 * 12.0));
      float travel = 0.84 + 0.16 * sin(q.y * (18.0 + p0 * 12.0) - t * (5.0 + p0 * 7.0));
      float pulse = 0.86 + uBeat * 0.16 + uHigh * 0.14;
      intensity = (core * 1.85 + inner * 0.48 + halo * 0.12) * lengthMask * travel * (0.38 + drive * 0.74) * pulse;
      hot = clamp(core * 1.25, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(inner + core, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    } else {
      // Energy Beam: turbulent plasma sheath wrapped around a stable hot core,
      // with traveling compression nodes reacting to bass/mid/transients.
      float centerWave = (noise1(q.y * 8.0 + t * (1.2 + p0 * 2.1)) - 0.5) * (0.035 + p2 * 0.075);
      float x = abs(q.x - centerWave);
      float lengthMask = 1.0 - smoothstep(0.91, 1.0, abs(q.y));
      float core = exp(-x * (58.0 + p1 * 65.0));
      float plasma = exp(-x * (16.0 + p1 * 15.0));
      float sheath = exp(-x * (5.5 + p2 * 6.5));
      float bands = 0.68 + 0.32 * pow(0.5 + 0.5 * sin(q.y * (15.0 + p0 * 12.0) - t * (4.0 + p0 * 5.5)), 3.0);
      float turbulence = 0.72 + fbm1(q.y * 12.0 - t * 1.8) * 0.40;
      float surge = 1.0 + uBass * 0.16 + uMid * 0.20 + uTransient * 0.32;
      intensity = (core * 1.45 + plasma * 0.52 * bands + sheath * 0.15 * turbulence) * lengthMask * (0.34 + drive * 0.72) * surge;
      hot = clamp(core * 1.15 + bands * plasma * 0.22, 0.0, 1.0);
      col = mix(uColorB, uColorA, clamp(plasma + core, 0.0, 1.0));
      col = mix(col, uColorC, hot);
    }

    float alpha = clamp(intensity * uOpacity, 0.0, 1.0);
    if (alpha < 0.002) discard;
    float emission = 1.0 + hot * 1.9 + min(intensity, 2.2) * 0.34;
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
      uOpacity: { value: 0.45 },
      uColorA: { value: new THREE.Color("#78c8ff") }, uColorB: { value: new THREE.Color("#305dff") }, uColorC: { value: new THREE.Color("#ffffff") },
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
  entry.env.bass = step(entry.env.bass, Math.min(2, snapshot.bass), 0.020, 0.12);
  entry.env.low = step(entry.env.low, Math.min(2, snapshot.low), 0.024, 0.11);
  entry.env.mid = step(entry.env.mid, Math.min(2, snapshot.mid), 0.016, 0.085);
  entry.env.high = step(entry.env.high, Math.min(2, snapshot.high), 0.009, 0.060);
  entry.env.beat = step(entry.env.beat, Math.min(2, snapshot.beat), 0.006, 0.085);
  entry.env.transient = step(entry.env.transient, Math.min(2, snapshot.transient), 0.004, 0.050);
}

function radians(rotation: number | undefined) {
  const r = Number(rotation || 0);
  return Math.abs(r) > Math.PI * 2.05 ? r * Math.PI / 180 : r;
}

export class ThreeElectricalLayer {
  private entries = new Map<string, Entry>();
  private geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  private frame = 0;

  constructor(private scene: THREE.Scene) {}

  update(project: Project, snapshot: AudioSnapshot, width: number, height: number, viewport: { x: number; y: number; w: number; h: number }, colorOverrides?: Record<string, string>) {
    this.frame++;
    const time = performance.now() / 1000;
    for (const region of project.regions) {
      for (const effect of region.effects) {
        if (!effect.enabled || !ELECTRICAL_KINDS.has(effect.kind)) continue;
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
      mesh.renderOrder = 34;
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
    const beamLike = effect.kind === "LightningArc" || effect.kind === "Laser" || effect.kind === "EnergyBeam";
    const defaultW = beamLike ? baseRadius * 1.15 : baseRadius * 2.0;
    const defaultH = beamLike ? baseRadius * 3.2 : baseRadius * 2.0;
    const rx = Math.max(12, ((effect.fxW || region.width || defaultW) / 2) * (viewport.w / project.width) * sx);
    const ry = Math.max(12, ((effect.fxH || region.height || defaultH) / 2) * (viewport.h / project.height) * sy);

    entry.mesh.position.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.16);
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
    u.uOpacity.value = Math.max(0, Math.min(1, effect.opacity * effect.brightness * project.masters.brightness * 0.52));
    u.uColorA.value.set(colorOverrides?.[effect.id] || effect.color || "#78c8ff");
    u.uColorB.value.set(effect.color2 || "#305dff");
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
