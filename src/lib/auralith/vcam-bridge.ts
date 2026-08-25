/** Process-local flag so Stream Output can push frames without React context. */
let active = false;
let width = 1920;
let height = 1080;
let lastPush = 0;
let inflight = false;
let rgbBuf: Uint8Array | null = null;
let consecutiveErrors = 0;

export function setVcamCaptureActive(on: boolean, w = 1920, h = 1080) {
  active = on;
  width = w;
  height = h;
  consecutiveErrors = 0;
  if (!on) rgbBuf = null;
}

export function isVcamCaptureActive() {
  return active;
}

export function vcamCaptureSize() {
  return { width, height };
}

function rgbaToRgb24(src: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const need = w * h * 3;
  if (!rgbBuf || rgbBuf.length !== need) rgbBuf = new Uint8Array(need);
  const out = rgbBuf;
  let j = 0;
  for (let i = 0; i < src.length; i += 4) {
    out[j++] = src[i]!;
    out[j++] = src[i + 1]!;
    out[j++] = src[i + 2]!;
  }
  return out;
}

/**
 * Push canvas pixels at most ~30 FPS. Never throws to the rAF loop.
 * Softcam expects RGB24 sized to the camera; Rust resizes if needed.
 */
export async function maybePushCanvas(canvas: HTMLCanvasElement, now: number) {
  if (!active || inflight) return;
  if (consecutiveErrors > 30) {
    // Stop hammering a broken sink.
    active = false;
    return;
  }
  if (now - lastPush < 33) return;
  lastPush = now;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 16 || h < 16) return;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, w, h);
    const rgb = rgbaToRgb24(img.data, w, h);
    inflight = true;
    const { vcamPushFrame } = await import("./vcam.ts");
    await vcamPushFrame(rgb, w, h);
    consecutiveErrors = 0;
  } catch {
    consecutiveErrors += 1;
  } finally {
    inflight = false;
  }
}
