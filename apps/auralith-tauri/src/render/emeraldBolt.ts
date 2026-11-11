import * as THREE from "three";
import type { AudioSnapshot } from "../audio/engine";
import { BOLT_BANDS, DEFAULT_BOLT_COLORS, type EffectInstance, type Project } from "../scene/types";
import coreUrl from "../assets/bolt-core-bass-low.webp";
import branchesUrl from "../assets/bolt-mid-high.webp";

let loaded = 0;
let atlases: [THREE.Texture, THREE.Texture] | undefined;
export const boltAtlasesReady = () => loaded === 2;

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
  return atlases = [load(coreUrl), load(branchesUrl)];
}

export function makeEmeraldBoltMaterial(vertexShader: string) {
  const [core, branches] = loadAtlases();
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uCore;
      uniform sampler2D uBranches;
      uniform float uFrame;
      uniform float uOpacity;
      uniform vec4 uSpread;
      uniform vec3 uCoreTint;
      uniform vec3 uTint[4];
      varying vec2 vUv;

      vec3 sampleBolt(sampler2D atlas, vec2 uv) {
        vec2 cell = vec2(mod(uFrame, 8.0), 6.0 - floor(uFrame / 8.0));
        vec2 inset = vec2(0.5 / 240.0, 0.5 / 360.0);
        return texture2D(atlas, (cell + mix(inset, 1.0 - inset, uv)) / vec2(8.0, 7.0)).rgb;
      }

      vec2 branchUv(float spread) {
        return vec2(0.5 + (vUv.x - 0.5) / spread, vUv.y);
      }

      vec3 lit(float energy, vec3 tint) {
        float whiteCore = smoothstep(0.54, 1.0, energy);
        return mix(tint, vec3(1.0), whiteCore * 0.72) * energy;
      }

      void main() {
        float core = sampleBolt(uCore, vUv).r;
        vec3 color = lit(core, uCoreTint);
        color += lit(sampleBolt(uCore, branchUv(uSpread.x)).g, uTint[0]);
        color += lit(sampleBolt(uCore, branchUv(uSpread.y)).b, uTint[1]);
        color += lit(sampleBolt(uBranches, branchUv(uSpread.z)).r, uTint[2]);
        color += lit(sampleBolt(uBranches, branchUv(uSpread.w)).g, uTint[3]);
        float light = max(color.r, max(color.g, color.b));
        float alpha = clamp(light * uOpacity, 0.0, 1.0);
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color / max(light, 0.001), alpha);
      }
    `,
    uniforms: {
      uCore: { value: core }, uBranches: { value: branches }, uFrame: { value: 0 },
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
  const level = selected >= 0 ? levels[selected]! : effect.audio === "Raw" ? snapshot.raw :
    effect.audio === "Beat" ? snapshot.beat : effect.audio === "Transient" ? snapshot.transient : 0;
  const reach = (energy: number) => 1 + 1.25 * spread * influence * Math.max(0, Math.min(1, energy));
  u.uSpread.value.set(...levels.map((energy) => reach(full ? energy : level)) as [number, number, number, number]);
  u.uCoreTint.value.set(full && !override ? "#c4e7ff" : single);
  for (let i = 0; i < 4; i++) u.uTint.value[i].set(full && !override ? palette[BOLT_BANDS[i]!] : single);
  const frame = Math.floor(Math.max(0, time * effect.speed * project.masters.motion) * 30);
  u.uFrame.value = frame % 52;
  u.uOpacity.value = boltAtlasesReady() ? Math.max(0, Math.min(2, effect.opacity * effect.brightness *
    effect.intensity * project.masters.intensity * project.masters.brightness)) : 0;
}
