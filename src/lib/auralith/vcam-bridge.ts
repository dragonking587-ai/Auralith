/** Process-local flag so Stream Output can push frames without React context. */
let active = false;
let width = 1920;
let height = 1080;
let lastPush = 0;
let inflight = false;

export function setVcamCaptureActive(on: boolean, w = 1920, h = 1080) {
  active = on;
  width = w;
  height = h;
}

export function isVcamCaptureActive() {
  return active;
}

export function vcamCaptureSize() {
  return { width, height };
}

/**
 * Push canvas pixels to the virtual camera at most ~30 FPS to limit IPC load.
 * Softcam accepts RGB24; Rust converts from RGBA.
 */
export async function maybePushCanvas(canvas: HTMLCanvasElement, now: number) {
  if (!active || inflight) return;
  if (now - lastPush < 32) return;
  lastPush = now;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 16 || h < 16) return;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, w, h);
    inflight = true;
    const { vcamPushFrame } = await import("./vcam.ts");
    await vcamPushFrame(img.data, w, h);
  } catch {
    /* ignore frame drops */
  } finally {
    inflight = false;
  }
}
