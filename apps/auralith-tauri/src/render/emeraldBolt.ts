/// <reference types="vite/client" />
import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import { BOLT_BANDS, DEFAULT_BOLT_COLORS, normalizeBoltWispCount, type EffectInstance, type Project } from "../scene/types";
import coreUrl from "../assets/bolt-unreal-core.webp";
import wisp0 from "../assets/bolt-unreal-wisps-0.webp";
import wisp1 from "../assets/bolt-unreal-wisps-1.webp";
import wisp2 from "../assets/bolt-unreal-wisps-2.webp";
import wisp3 from "../assets/bolt-unreal-wisps-3.webp";

let loaded = 0;
const urls = [coreUrl, wisp0, wisp1, wisp2, wisp3];
let atlases: THREE.Texture[] | undefined;
const boltAtlasesReady = () => loaded === urls.length;

function loadAtlases() {
  if (atlases) return atlases;
  const loader = new THREE.TextureLoader();
  const load = (url: string) => {
    const texture = loader.load(url, () => { loaded++; });
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  };
  return atlases = urls.map(load);
}

export function makeEmeraldBoltMaterial(vertexShader: string) {
  const [core, ...wisps] = loadAtlases();
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uCore;
      uniform sampler2D uWisps[4];
      uniform float uFrame;
      uniform float uOpacity;
      uniform float uRise;
      uniform float uWispCount;
      uniform vec4 uSpread;
      uniform vec3 uCoreTint;
      uniform vec3 uTint[4];
      varying vec2 vUv;

      vec3 sampleBolt(sampler2D atlas, vec2 uv, float frame, float rows) {
        vec2 cell = vec2(mod(frame, 8.0), rows - 1.0 - floor(frame / 8.0));
        vec2 inset = vec2(0.5 / 192.0, 0.5 / 288.0);
        return texture2D(atlas, (cell + mix(inset, 1.0 - inset, uv)) / vec2(8.0, rows)).rgb;
      }

      vec2 branchUv(float spread) {
        return vec2(0.5 + (vUv.x - 0.5) / spread, vUv.y);
      }

      vec3 lit(float energy, vec3 tint) {
        float whiteCore = smoothstep(0.54, 0.93, energy);
        return mix(tint, vec3(1.0), whiteCore * 0.72) * energy;
      }

      vec3 wisps(sampler2D atlas, float offset, vec3 a, vec3 b, vec3 c) {
        vec3 energy = sampleBolt(atlas, vUv, floor(uFrame * 0.5), 4.0);
        energy *= step(offset + vec3(1.0, 2.0, 3.0), vec3(uWispCount));
        return energy.r * a + energy.g * b + energy.b * c;
      }

      void main() {
        float reveal = 1.0 - smoothstep(uRise - 0.09, uRise, vUv.y);
        if (uOpacity <= 0.0 || reveal <= 0.0 || vUv.y < 0.12) discard;
        vec3 base = sampleBolt(uCore, vUv, uFrame, 8.0);
        vec3 color = lit(base.r, uCoreTint) * 1.6 + lit(base.b, uTint[3]);
        vec4 weights = max(vec4(0.0), 1.0 - abs(vUv.y - vec4(0.13, 0.37, 0.63, 0.87)) * 4.0);
        weights /= max(dot(weights, vec4(1.0)), 0.01);
        color += lit(sampleBolt(uCore, branchUv(uSpread.x), uFrame, 8.0).g, uTint[0]) * weights.x;
        color += lit(sampleBolt(uCore, branchUv(uSpread.y), uFrame, 8.0).g, uTint[1]) * weights.y;
        color += lit(sampleBolt(uCore, branchUv(uSpread.z), uFrame, 8.0).g, uTint[2]) * weights.z;
        color += lit(sampleBolt(uCore, branchUv(uSpread.w), uFrame, 8.0).g, uTint[3]) * weights.w;
        if (uWispCount > 0.0) color += wisps(uWisps[0], 0.0, uTint[0], uTint[1], uTint[2]);
        if (uWispCount > 3.0) color += wisps(uWisps[1], 3.0, uTint[3], uTint[0], uTint[1]);
        if (uWispCount > 6.0) color += wisps(uWisps[2], 6.0, uTint[2], uTint[3], uTint[0]);
        if (uWispCount > 9.0) color += wisps(uWisps[3], 9.0, uTint[1], uTint[2], uTint[3]);
        float light = max(color.r, max(color.g, color.b));
        float alpha = clamp(light * uOpacity * reveal, 0.0, 1.0);
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color / max(light, 0.001), alpha);
      }
    `,
    uniforms: {
      uCore: { value: core }, uWisps: { value: wisps }, uFrame: { value: 0 },
      uRise: { value: 0.12 }, uWispCount: { value: 0 },
      uOpacity: { value: 0 }, uSpread: { value: new THREE.Vector4(1, 1, 1, 1) },
      uCoreTint: { value: new THREE.Color() }, uTint: { value: BOLT_BANDS.map(() => new THREE.Color()) },
    },
    transparent: true, blending: THREE.NormalBlending, depthTest: false, depthWrite: false, toneMapped: false,
  });
}

export function updateEmeraldBoltMaterial(material: THREE.ShaderMaterial, effect: EffectInstance, project: Project,
  snapshot: AudioSnapshot, levels: readonly [number, number, number, number], time: number, override?: string) {
  const u = material.uniforms;
  const selected = BOLT_BANDS.findIndex((band) => band === effect.audio);
  const full = effect.audio === "FullMix";
  const palette = effect.boltColors ?? DEFAULT_BOLT_COLORS;
  const single = override ?? (selected >= 0 ? palette[BOLT_BANDS[selected]!] : effect.color);
  const influence = Math.max(0, Math.min(1, effect.audioInfluence));
  const spread = Math.max(0, Math.min(2, effect.p2 ?? 1));
  const level = full ? snapshot.fullMix : selected >= 0 ? levels[selected]! : effect.audio === "Raw" ? snapshot.raw :
    effect.audio === "Beat" ? snapshot.beat : effect.audio === "Transient" ? snapshot.transient : 0;
  const reach = (energy: number) => 1 + 1.25 * spread * influence * Math.max(0, Math.min(1, energy));
  u.uSpread.value.set(...levels.map((energy) => reach(full ? energy : level)) as [number, number, number, number]);
  u.uCoreTint.value.set(full && !override ? "#c4e7ff" : single);
  for (let i = 0; i < 4; i++) u.uTint.value[i].set(full && !override ? palette[BOLT_BANDS[i]!] : single);
  const frame = Math.floor(Math.max(0, time * effect.speed * project.masters.motion) * 30);
  u.uFrame.value = frame % 63;
  const progress = Math.max(0, Math.min(1, time / 0.55));
  u.uRise.value = 0.12 + 0.97 * progress * (2 - progress);
  u.uWispCount.value = normalizeBoltWispCount(effect.boltWispCount);
  u.uOpacity.value = boltAtlasesReady() && time >= 0 ? Math.max(0, Math.min(2, effect.opacity * effect.brightness *
    effect.intensity * project.masters.intensity * project.masters.brightness * (1 + 0.3 * influence * level))) : 0;
}
