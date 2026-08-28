import type { FitMode } from "./types";

export type Viewport = { x: number; y: number; w: number; h: number };

export function sceneViewport(canvasW: number, canvasH: number, sceneW: number, sceneH: number, fit: FitMode): Viewport {
  if (fit === "Stretch") return { x: 0, y: 0, w: canvasW, h: canvasH };
  const sx = canvasW / sceneW, sy = canvasH / sceneH;
  if (fit === "Center") {
    const w = sceneW, h = sceneH;
    return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
  }
  const s = fit === "Fill" ? Math.max(sx, sy) : Math.min(sx, sy);
  const w = sceneW * s, h = sceneH * s;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}

export function canvasToScene(px: number, py: number, vp: Viewport, sceneW: number, sceneH: number) {
  return { x: ((px - vp.x) / vp.w) * sceneW, y: ((py - vp.y) / vp.h) * sceneH };
}
export function sceneToCanvas(sx: number, sy: number, vp: Viewport, sceneW: number, sceneH: number) {
  return { x: vp.x + (sx / sceneW) * vp.w, y: vp.y + (sy / sceneH) * vp.h };
}
