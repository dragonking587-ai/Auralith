import type { AudioSnapshot } from "../audio/engine";
import type { EffectInstance, EffectKind, Project, Region } from "../scene/types";
import { sceneViewport } from "../scene/transform";
import { GlRenderer as LegacyGlRenderer } from "./renderer";
import { CinematicPipelineV2 } from "./cinematicPipelineV2";

const THREE_PARTICLE_KINDS = new Set<EffectKind>([
  "Sparks", "EnergySparks", "Embers", "Fireflies", "Snow", "Ash", "DustMotes", "BioluminescentSpores"
]);

const THREE_VOLUMETRIC_KINDS = new Set<EffectKind>([
  "MagicEnergy", "Plasma", "VoidEnergy", "Portal", "Vortex", "SmokeFog", "Mist",
  "AtmosphericHaze", "Aurora", "CosmicNebula", "FrozenBreath", "SpectralAura"
]);

function isThreeKind(kind: EffectKind) {
  return THREE_PARTICLE_KINDS.has(kind) || THREE_VOLUMETRIC_KINDS.has(kind);
}

function isThreeNativePlacement(region: Region, effect: EffectInstance) {
  if (!effect.enabled || !isThreeKind(effect.kind)) return false;
  if (effect.geomMode === "point") return true;
  return region.kind === "Emitter" || region.kind === "Stamp";
}

function nativeProject(project: Project): { project: Project; count: number } {
  let count = 0;
  const regions = project.regions
    .map((region) => {
      const effects = region.effects.filter((effect) => {
        const native = isThreeNativePlacement(region, effect);
        if (native) count++;
        return native;
      });
      return { ...region, effects };
    })
    .filter((region) => region.effects.length > 0);
  return { project: { ...project, regions }, count };
}

/**
 * Compatibility-first cinematic renderer for rc.49.3.1.
 *
 * The proven rc.49 WebGL renderer always owns the visible base canvas and draws
 * the backdrop, props and every effect. Three.js owns a completely separate
 * transparent WebGL2 canvas layered above it. Migrated particle/volumetric
 * effects therefore enhance the rc.49 rendering instead of replacing it.
 *
 * This isolation is intentional: sharing a WebGL context between raw WebGL and
 * THREE.WebGLRenderer lets either renderer invalidate the other's programs,
 * buffers, textures, framebuffer bindings and pixel-store state. Keeping the
 * contexts separate guarantees that a cinematic failure cannot blank the image
 * or remove an effect.
 */
export class GlRenderer {
  private legacy: LegacyGlRenderer;
  private pipeline: CinematicPipelineV2 | null = null;
  private overlayCanvas: HTMLCanvasElement;
  private overlayGl: WebGL2RenderingContext | null = null;
  private pipelineErrorLogged = false;
  private overlayHasContent = false;

  fps = 0;
  lastW = 0;
  lastH = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.legacy = new LegacyGlRenderer(canvas);

    this.overlayCanvas = document.createElement("canvas");
    this.overlayCanvas.id = "auralith-cinematic-overlay";
    Object.assign(this.overlayCanvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      pointerEvents: "none",
      zIndex: "2",
      background: "transparent",
    });
    canvas.insertAdjacentElement("afterend", this.overlayCanvas);

    const gl = this.overlayCanvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    }) as WebGL2RenderingContext | null;
    this.overlayGl = gl;

    if (!gl) {
      this.overlayCanvas.style.display = "none";
      console.warn("CINEMATIC_PIPELINE_UNAVAILABLE reason=isolated_webgl2_missing fallback=rc49");
      return;
    }

    try {
      this.pipeline = new CinematicPipelineV2(this.overlayCanvas, gl);
      console.log("CINEMATIC_PIPELINE_ISOLATED_OK base=rc49 overlay=three.js");
    } catch (error) {
      this.pipeline = null;
      this.overlayCanvas.style.display = "none";
      console.error("CINEMATIC_PIPELINE_V2_INIT_FAILED fallback=rc49", error);
    }
  }

  private clearOverlay() {
    const gl = this.overlayGl;
    if (!gl) return;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, Math.max(2, this.overlayCanvas.width), Math.max(2, this.overlayCanvas.height));
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    } catch { /* legacy base remains authoritative */ }
    this.overlayHasContent = false;
  }

  setBackdrop(img: HTMLImageElement | null) { this.legacy.setBackdrop(img); }
  registerProp(id: string, img: HTMLImageElement) { this.legacy.registerProp(id, img); }
  setNeonMask(src: HTMLCanvasElement | null) { this.legacy.setNeonMask(src); }

  draw(
    project: Project,
    snapshot: AudioSnapshot,
    cssW: number,
    cssH: number,
    viewCss?: { x: number; y: number; w: number; h: number },
    colorOverrides?: Record<string, string>,
    reactions?: any[],
  ) {
    // Always draw the complete project through rc.49 first. This is the safety
    // underlay and guarantees backdrop/prop/effect visibility even if Three.js
    // cannot initialize, compile or render on a particular GPU.
    this.legacy.draw(project, snapshot, cssW, cssH, viewCss, colorOverrides, reactions);
    this.fps = this.legacy.fps;
    this.lastW = this.legacy.lastW;
    this.lastH = this.legacy.lastH;

    if (!this.pipeline?.enabled || !this.overlayGl) {
      this.clearOverlay();
      return;
    }

    const native = nativeProject(project);
    if (!native.count) {
      this.clearOverlay();
      return;
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.floor(cssW * dpr));
    const height = Math.max(2, Math.floor(cssH * dpr));
    const viewport = viewCss
      ? { x: viewCss.x * dpr, y: viewCss.y * dpr, w: viewCss.w * dpr, h: viewCss.h * dpr }
      : sceneViewport(width, height, project.width, project.height, project.fit);

    try {
      this.pipeline.prepareSize(width, height);
      // The cinematic context contains effects only. Clearing before the
      // pipeline's framebuffer copy prevents feedback/old-frame contamination.
      this.clearOverlay();
      this.pipeline.render(snapshot, project, viewport, colorOverrides, native.project);
      this.overlayCanvas.style.display = "block";
      this.overlayHasContent = true;
      this.pipelineErrorLogged = false;
    } catch (error) {
      this.clearOverlay();
      if (!this.pipelineErrorLogged) {
        console.error("CINEMATIC_PIPELINE_V2_FALLBACK_FRAME base=rc49", error);
        this.pipelineErrorLogged = true;
      }
    }
  }

  readCleanRgba(): { width: number; height: number; pixels: Uint8Array } | null {
    const base = this.legacy.readCleanRgba();
    if (!base || !this.pipeline?.enabled || !this.overlayHasContent) return base;

    try {
      const overlay = this.pipeline.readRgba();
      if (!overlay || overlay.width !== base.width || overlay.height !== base.height) return base;
      const b = base.pixels;
      const o = overlay.pixels;
      const n = Math.min(b.length, o.length);
      for (let i = 0; i + 3 < n; i += 4) {
        const oa = o[i + 3]! / 255;
        if (oa <= 0.001) continue;
        const ia = 1 - oa;
        b[i] = Math.round(o[i]! * oa + b[i]! * ia);
        b[i + 1] = Math.round(o[i + 1]! * oa + b[i + 1]! * ia);
        b[i + 2] = Math.round(o[i + 2]! * oa + b[i + 2]! * ia);
        const ba = b[i + 3]! / 255;
        b[i + 3] = Math.round((oa + ba * ia) * 255);
      }
      return base;
    } catch (error) {
      console.error("CINEMATIC_PIPELINE_V2_READBACK_FAILED fallback=rc49", error);
      return base;
    }
  }

  dispose() {
    try { this.pipeline?.dispose(); } catch { /* keep shutdown safe */ }
    try { this.overlayCanvas.remove(); } catch { /* ignore */ }
  }
}
