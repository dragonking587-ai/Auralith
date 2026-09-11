import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { AudioSnapshot } from "../audio/engine";
import type { EffectKind, Project } from "../scene/types";
import { ThreeDistortionLayer } from "./threeDistortionLayer";
import { ThreeElectricalLayer } from "./threeElectricalLayer";
import { ThreeLightOpticalLayer } from "./threeLightOpticalLayer";
import { ThreeParticleLayer } from "./threeParticleLayer";
import { ThreeVolumetricLayer } from "./threeVolumetricLayer";

const FULLSCREEN_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CHROMATIC_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 0.0 },
    radial: { value: 1.0 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float radial;
    varying vec2 vUv;
    void main() {
      vec2 fromCenter = vUv - vec2(0.5);
      float edge = smoothstep(0.16, 0.72, length(fromCenter));
      vec2 direction = normalize(fromCenter + vec2(0.00001));
      vec2 shift = direction * amount * mix(0.25, edge, radial);
      vec4 base = texture2D(tDiffuse, vUv);
      float r = texture2D(tDiffuse, clamp(vUv + shift, 0.0, 1.0)).r;
      float b = texture2D(tDiffuse, clamp(vUv - shift, 0.0, 1.0)).b;
      gl_FragColor = vec4(r, base.g, b, base.a);
    }
  `,
};

const FINISH_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0.0 },
    grain: { value: 0.0 },
    vignette: { value: 0.0 },
    vignetteSoftness: { value: 0.45 },
    overlayMode: { value: 0.0 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grain;
    uniform float vignette;
    uniform float vignetteSoftness;
    uniform float overlayMode;
    varying vec2 vUv;

    float filmNoise(vec2 p) {
      return fract(sin(dot(p + time * 0.017, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      float v = smoothstep(0.34, 0.34 + max(vignetteSoftness, 0.08), d);
      c.rgb *= 1.0 - v * vignette;
      float n = filmNoise(vUv * vec2(1733.0, 941.0)) - 0.5;
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb += n * grain * mix(0.55, 0.16, clamp(luma, 0.0, 1.0));
      c.rgb = max(c.rgb, vec3(0.0));
      float glowAlpha = clamp(max(max(c.r, c.g), c.b) * 0.72, 0.0, 1.0);
      float outAlpha = mix(c.a, max(c.a, glowAlpha), overlayMode);
      gl_FragColor = vec4(c.rgb, outAlpha);
    }
  `,
};

const BLOOM_FRIENDLY = new Set<EffectKind>([
  "LightSurge", "GlowBloom", "Afterglow", "Halo", "LightRays", "GodRays", "LensFlare", "Starburst", "Spotlight",
  "MagicEnergy", "Plasma", "VoidEnergy", "Portal", "EnergyBeam", "EnergySparks", "SpectralAura",
  "LightningArc", "ElectricCrawl", "ThunderFlash", "Laser", "RealisticFlame", "Embers", "Sparks",
  "NeonGlow", "NeonChase", "Shimmer", "GlitterSparkle", "PrismaticLight", "Aurora", "IceShimmer", "Fireflies",
  "BioluminescentSpores", "RuneGlow", "SigilActivation", "Eclipse", "CelestialStars", "CosmicNebula", "SmartNeon",
  "Caustics", "WaterRipple", "WetReflection", "WaterReflection"
]);
const CHROMATIC_FRIENDLY = new Set<EffectKind>([
  "ChromaticPulse", "PrismaticLight", "HolographicDistortion", "GlitchLight", "RgbSplit", "Refraction", "SpatialWarp"
]);
const ATMOSPHERIC = new Set<EffectKind>([
  "SmokeFog", "Mist", "AtmosphericHaze", "Aurora", "CosmicNebula", "FilmBurn", "VoidEnergy", "Eclipse", "FrozenBreath", "HeatDistortion"
]);
const DARK_FOCUS = new Set<EffectKind>([
  "VoidEnergy", "Portal", "ShadowPulse", "RoomDim", "LocalDim", "Eclipse", "GravityWell", "CosmicNebula", "FilmBurn", "SpatialWarp"
]);

type SmoothedAudio = Pick<AudioSnapshot, "bass" | "low" | "mid" | "high" | "beat" | "transient">;
export type CinematicViewport = { x: number; y: number; w: number; h: number };

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function activeKinds(project: Project): Set<EffectKind> {
  const out = new Set<EffectKind>();
  for (const region of project.regions) for (const effect of region.effects) if (effect.enabled) out.add(effect.kind);
  return out;
}
function containsAny(source: Set<EffectKind>, candidates: Set<EffectKind>) {
  for (const value of source) if (candidates.has(value)) return true;
  return false;
}

/**
 * Auralith cinematic renderer generation 2.
 * rc.49 remains the compatibility/source pass, while migrated effect families
 * render as dedicated Three.js GPU layers before HDR bloom/post processing.
 * Distortion effects receive the legacy canvas only as a CanvasTexture source;
 * no WebGL state or GPU objects are shared with the base renderer.
 */
export class CinematicPipelineV2 {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene: THREE.Scene;
  private particleLayer: ThreeParticleLayer;
  private volumetricLayer: ThreeVolumetricLayer;
  private electricalLayer: ThreeElectricalLayer;
  private distortionLayer: ThreeDistortionLayer;
  private lightOpticalLayer: ThreeLightOpticalLayer;
  private frameTexture: THREE.FramebufferTexture;
  private sourceMaterial: THREE.MeshBasicMaterial;
  private bloomPass: UnrealBloomPass;
  private chromaticPass: ShaderPass;
  private finishPass: ShaderPass;
  private copyOrigin = new THREE.Vector2(0, 0);
  private width = 2;
  private height = 2;
  private lastAudioT = performance.now();
  private audio: SmoothedAudio = { bass: 0, low: 0, mid: 0, high: 0, beat: 0, transient: 0 };
  private failures = 0;
  enabled = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private gl: WebGL2RenderingContext,
    sourceCanvas: HTMLCanvasElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.info.autoReset = false;

    this.frameTexture = this.makeFrameTexture(2, 2);
    this.sourceMaterial = new THREE.MeshBasicMaterial({
      map: this.frameTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.sourceMaterial);
    quad.frustumCulled = false;
    quad.renderOrder = -100;
    this.scene.add(quad);

    this.distortionLayer = new ThreeDistortionLayer(this.scene, sourceCanvas);
    this.volumetricLayer = new ThreeVolumetricLayer(this.scene);
    this.particleLayer = new ThreeParticleLayer(this.scene);
    this.electricalLayer = new ThreeElectricalLayer(this.scene);
    this.lightOpticalLayer = new ThreeLightOpticalLayer(this.scene);

    const supportsHalfFloat = Boolean(gl.getExtension("EXT_color_buffer_float"));
    const target = new THREE.WebGLRenderTarget(2, 2, {
      type: supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(1);
    this.composer.addPass(new RenderPass(this.scene, camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.34, 0.62, 0.68);
    this.composer.addPass(this.bloomPass);
    this.chromaticPass = new ShaderPass(CHROMATIC_SHADER);
    this.composer.addPass(this.chromaticPass);
    this.finishPass = new ShaderPass(FINISH_SHADER);
    this.composer.addPass(this.finishPass);
    this.composer.addPass(new OutputPass());

    console.log("CINEMATIC_PIPELINE_V2_OK engine=three.js layers=distortion,volumetric,particle,electrical,light-optical passes=bloom,chromatic,vignette,grain,color-output");
  }

  private makeFrameTexture(w: number, h: number) {
    const texture = new THREE.FramebufferTexture(Math.max(2, w), Math.max(2, h));
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  prepareSize(width: number, height: number) {
    width = Math.max(2, Math.floor(width));
    height = Math.max(2, Math.floor(height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
    this.frameTexture.dispose();
    this.frameTexture = this.makeFrameTexture(width, height);
    this.sourceMaterial.map = this.frameTexture;
    this.sourceMaterial.needsUpdate = true;
  }

  private smoothAudio(snapshot: AudioSnapshot) {
    const now = performance.now();
    const dt = clamp((now - this.lastAudioT) / 1000, 0.001, 0.05);
    this.lastAudioT = now;
    const update = (current: number, target: number, attack: number, release: number) => {
      const tau = target > current ? attack : release;
      return current + (target - current) * (1 - Math.exp(-dt / Math.max(0.004, tau)));
    };
    this.audio.bass = update(this.audio.bass, snapshot.bass, 0.028, 0.15);
    this.audio.low = update(this.audio.low, snapshot.low, 0.032, 0.14);
    this.audio.mid = update(this.audio.mid, snapshot.mid, 0.025, 0.11);
    this.audio.high = update(this.audio.high, snapshot.high, 0.018, 0.085);
    this.audio.beat = update(this.audio.beat, snapshot.beat, 0.010, 0.12);
    this.audio.transient = update(this.audio.transient, snapshot.transient, 0.008, 0.075);
  }

  private tune(project: Project) {
    const kinds = activeKinds(project);
    const bloomRelevant = containsAny(kinds, BLOOM_FRIENDLY);
    const chromaticRelevant = containsAny(kinds, CHROMATIC_FRIENDLY);
    const atmospheric = containsAny(kinds, ATMOSPHERIC);
    const darkFocus = containsAny(kinds, DARK_FOCUS);
    const quality = project.quality === "Ultra" ? 1.0 : project.quality === "High" ? 0.82 : project.quality === "Medium" ? 0.62 : 0.42;
    const energy = clamp(this.audio.bass * 0.42 + this.audio.low * 0.22 + this.audio.mid * 0.16 + this.audio.high * 0.10 + this.audio.beat * 0.10, 0, 1.4);

    this.bloomPass.strength = (bloomRelevant ? 0.34 : 0.16) * quality + energy * (bloomRelevant ? 0.28 : 0.08);
    this.bloomPass.radius = clamp(0.46 + quality * 0.26 + this.audio.bass * 0.08, 0.35, 0.82);
    this.bloomPass.threshold = clamp(0.72 - this.audio.beat * 0.08 - (bloomRelevant ? 0.08 : 0), 0.48, 0.78);

    const chromaBase = chromaticRelevant ? 0.0012 : 0.00016;
    const chromaAudio = this.audio.high * (chromaticRelevant ? 0.0032 : 0.00075) + this.audio.transient * 0.0010;
    this.chromaticPass.uniforms.amount.value = clamp(chromaBase + chromaAudio, 0, 0.0065);
    this.chromaticPass.uniforms.radial.value = 1.0;

    this.finishPass.uniforms.time.value = performance.now() / 1000;
    this.finishPass.uniforms.grain.value = clamp((atmospheric ? 0.008 : 0.0025) * quality + this.audio.high * 0.0025, 0, 0.014);
    this.finishPass.uniforms.vignette.value = clamp((darkFocus ? 0.11 : 0.025) + this.audio.bass * (darkFocus ? 0.025 : 0.008), 0, 0.16);
    this.finishPass.uniforms.vignetteSoftness.value = darkFocus ? 0.42 : 0.50;
    this.finishPass.uniforms.overlayMode.value = project.backdropDataUrl ? 0.0 : 1.0;
  }

  render(
    snapshot: AudioSnapshot,
    fullProject: Project,
    viewport: CinematicViewport,
    colorOverrides?: Record<string, string>,
    nativeProject: Project = fullProject,
  ) {
    if (!this.enabled) return;
    this.smoothAudio(snapshot);
    this.tune(fullProject);

    this.distortionLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);
    this.volumetricLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);
    this.particleLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);
    this.electricalLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);
    this.lightOpticalLayer.update(nativeProject, snapshot, this.width, this.height, viewport, colorOverrides);

    try {
      this.renderer.resetState();
      this.renderer.copyFramebufferToTexture(this.frameTexture, this.copyOrigin);
      this.renderer.resetState();
      this.composer.render();
      this.renderer.info.reset();
      this.failures = 0;
    } catch (error) {
      this.failures++;
      console.error("CINEMATIC_PIPELINE_V2_FRAME_FAILED", error);
      if (this.failures >= 3) {
        this.enabled = false;
        console.error("CINEMATIC_PIPELINE_V2_DISABLED fallback=legacy-webgl");
      }
      throw error;
    }
  }

  readRgba(): { width: number; height: number; pixels: Uint8Array } | null {
    if (this.width < 2 || this.height < 2) return null;
    const pixels = new Uint8Array(this.width * this.height * 4);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.readPixels(0, 0, this.width, this.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
    return { width: this.width, height: this.height, pixels };
  }

  dispose() {
    this.distortionLayer.dispose();
    this.lightOpticalLayer.dispose();
    this.electricalLayer.dispose();
    this.volumetricLayer.dispose();
    this.particleLayer.dispose();
    this.frameTexture.dispose();
    this.sourceMaterial.map = null;
    this.sourceMaterial.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
