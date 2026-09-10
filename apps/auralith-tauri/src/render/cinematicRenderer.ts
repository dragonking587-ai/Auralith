import type { AudioSnapshot } from "../audio/engine";
import type { Project } from "../scene/types";
import { sceneViewport } from "../scene/transform";
import { GlRenderer as LegacyGlRenderer } from "./renderer";
import { CinematicPipeline } from "./cinematicPipeline";

/**
 * Drop-in replacement for the original GlRenderer API used by rc.49's React UI.
 *
 * The existing renderer remains the compatibility/source pass so project files,
 * trace masks, effect IDs, reactions, props and existing UI behavior remain
 * intact. Three.js adds dedicated effect layers and cinematic post-processing on
 * the same WebGL2 context. Any failure falls back to the proven rc.49 renderer.
 */
export class GlRenderer {
  private legacy: LegacyGlRenderer;
  private pipeline: CinematicPipeline | null = null;
  private pipelineErrorLogged = false;

  fps = 0;
  lastW = 0;
  lastH = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.legacy = new LegacyGlRenderer(canvas);
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) {
      console.warn("CINEMATIC_PIPELINE_UNAVAILABLE reason=webgl2_missing fallback=legacy");
      return;
    }
    try {
      this.pipeline = new CinematicPipeline(canvas, gl);
    } catch (error) {
      this.pipeline = null;
      console.error("CINEMATIC_PIPELINE_INIT_FAILED fallback=legacy", error);
    }
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.floor(cssW * dpr));
    const height = Math.max(2, Math.floor(cssH * dpr));
    const viewport = viewCss
      ? { x: viewCss.x * dpr, y: viewCss.y * dpr, w: viewCss.w * dpr, h: viewCss.h * dpr }
      : sceneViewport(width, height, project.width, project.height, project.fit);

    if (this.pipeline?.enabled) {
      try {
        this.pipeline.prepareSize(width, height);
      } catch (error) {
        console.error("CINEMATIC_PIPELINE_RESIZE_FAILED fallback=legacy", error);
        this.pipeline.enabled = false;
      }
    }

    this.legacy.draw(project, snapshot, cssW, cssH, viewCss, colorOverrides, reactions);
    this.fps = this.legacy.fps;
    this.lastW = this.legacy.lastW;
    this.lastH = this.legacy.lastH;

    if (!this.pipeline?.enabled) return;

    try {
      this.pipeline.render(snapshot, project, viewport, colorOverrides);
      this.pipelineErrorLogged = false;
    } catch (error) {
      // A failed composer pass must never leave the user with a blank frame.
      if (!this.pipelineErrorLogged) {
        console.error("CINEMATIC_PIPELINE_FALLBACK_FRAME", error);
        this.pipelineErrorLogged = true;
      }
      this.legacy.draw(project, snapshot, cssW, cssH, viewCss, colorOverrides, reactions);
      this.fps = this.legacy.fps;
      this.lastW = this.legacy.lastW;
      this.lastH = this.legacy.lastH;
    }
  }

  readCleanRgba(): { width: number; height: number; pixels: Uint8Array } | null {
    if (this.pipeline?.enabled) {
      try { return this.pipeline.readRgba(); }
      catch (error) { console.error("CINEMATIC_PIPELINE_READBACK_FAILED fallback=legacy", error); }
    }
    return this.legacy.readCleanRgba();
  }

  dispose() {
    try { this.pipeline?.dispose(); } catch { /* keep shutdown safe */ }
  }
}
