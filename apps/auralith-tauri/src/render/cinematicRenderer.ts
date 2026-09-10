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

/**
 * Only point/emitter placements move completely off the rc.49 shader today.
 * Trace/Prop/Shape placements keep their legacy SDF/mask behavior until the
 * dedicated Three.js path-mask layer is migrated in a later engine family.
 */
function isThreeNativePlacement(region: Region, effect: EffectInstance) {
  if (!effect.enabled || !isThreeKind(effect.kind)) return false;
  if (effect.geomMode === "point") return true;
  return region.kind === "Emitter" || region.kind === "Stamp";
}

type SplitProject = { legacy: Project; native: Project; count: number };

/**
 * Drop-in replacement for the original GlRenderer API used by rc.49's React UI.
 * The UI, project schema, capture API and updater contract remain unchanged.
 * Migrated point effects render in dedicated Three.js GPU layers; everything not
 * yet migrated stays on the proven rc.49 renderer. Any failure redraws the full
 * project through rc.49 so the application never depends on the new engine to boot.
 */
export class GlRenderer {
  private legacy: LegacyGlRenderer;
  private pipeline: CinematicPipelineV2 | null = null;
  private pipelineErrorLogged = false;
  private splitSource: Project | null = null;
  private splitCache: SplitProject | null = null;

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
      this.pipeline = new CinematicPipelineV2(canvas, gl);
    } catch (error) {
      this.pipeline = null;
      console.error("CINEMATIC_PIPELINE_V2_INIT_FAILED fallback=legacy", error);
    }
  }

  private splitProject(project: Project): SplitProject {
    if (this.splitSource === project && this.splitCache) return this.splitCache;

    let count = 0;
    const legacyRegions = project.regions.map((region) => {
      const effects = region.effects.filter((effect) => {
        const migrated = isThreeNativePlacement(region, effect);
        if (migrated) count++;
        return !migrated;
      });
      return effects === region.effects ? region : { ...region, effects };
    });

    const nativeRegions = project.regions
      .map((region) => ({ ...region, effects: region.effects.filter((effect) => isThreeNativePlacement(region, effect)) }))
      .filter((region) => region.effects.length > 0);

    const split = {
      legacy: { ...project, regions: legacyRegions },
      native: { ...project, regions: nativeRegions },
      count,
    };
    this.splitSource = project;
    this.splitCache = split;
    console.log(`CINEMATIC_NATIVE_SPLIT migrated=${count} legacy=${project.regions.reduce((n, r) => n + r.effects.length, 0) - count}`);
    return split;
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
        console.error("CINEMATIC_PIPELINE_V2_RESIZE_FAILED fallback=legacy", error);
        this.pipeline.enabled = false;
      }
    }

    const split = this.pipeline?.enabled ? this.splitProject(project) : null;
    this.legacy.draw(split?.legacy ?? project, snapshot, cssW, cssH, viewCss, colorOverrides, reactions);
    this.fps = this.legacy.fps;
    this.lastW = this.legacy.lastW;
    this.lastH = this.legacy.lastH;

    if (!this.pipeline?.enabled || !split) return;

    try {
      this.pipeline.render(snapshot, project, viewport, colorOverrides, split.native);
      this.pipelineErrorLogged = false;
    } catch (error) {
      if (!this.pipelineErrorLogged) {
        console.error("CINEMATIC_PIPELINE_V2_FALLBACK_FRAME", error);
        this.pipelineErrorLogged = true;
      }
      // Restore every migrated effect through the original renderer if the new
      // engine fails during a frame. No project data or UI state is changed.
      this.legacy.draw(project, snapshot, cssW, cssH, viewCss, colorOverrides, reactions);
      this.fps = this.legacy.fps;
      this.lastW = this.legacy.lastW;
      this.lastH = this.legacy.lastH;
    }
  }

  readCleanRgba(): { width: number; height: number; pixels: Uint8Array } | null {
    if (this.pipeline?.enabled) {
      try { return this.pipeline.readRgba(); }
      catch (error) { console.error("CINEMATIC_PIPELINE_V2_READBACK_FAILED fallback=legacy", error); }
    }
    return this.legacy.readCleanRgba();
  }

  dispose() {
    try { this.pipeline?.dispose(); } catch { /* keep shutdown safe */ }
  }
}
