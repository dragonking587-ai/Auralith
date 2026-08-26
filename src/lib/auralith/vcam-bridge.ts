/**
 * Stream Output → Virtual Camera frame bridge.
 *
 * IMPORTANT: Stream Output runs in a separate Tauri webview. Module-local
 * `active` flags set in the main window do NOT apply there. StreamView must
 * enable capture in its own context (or poll Rust RUNNING state).
 */

import { isDesktopApp } from "./platform.ts";

export type VcamFrameSource = "idle" | "test_frame" | "live_renderer" | "fallback";

let active = false;
let width = 1920;
let height = 1080;
let lastPush = 0;
let inflight = false;
let rgbBuf: Uint8Array | null = null;
let consecutiveErrors = 0;
let liveFramesSubmitted = 0;
let loggedFirstLive = false;
let source: VcamFrameSource = "idle";

export function setVcamCaptureActive(on: boolean, w = 1920, h = 1080) {
  active = on;
  width = Math.max(16, w | 0);
  height = Math.max(16, h | 0);
  consecutiveErrors = 0;
  if (!on) {
    rgbBuf = null;
    liveFramesSubmitted = 0;
    loggedFirstLive = false;
    source = "idle";
    console.info("[VirtualCam] Capture inactive (JS)");
  } else {
    source = "live_renderer";
    console.info("[VirtualCam] Connecting live renderer", { width, height });
  }
}

export function isVcamCaptureActive() {
  return active;
}

export function vcamCaptureSize() {
  return { width, height };
}

export function vcamFrameSource(): VcamFrameSource {
  return source;
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

/** Base64 without spreading large typed arrays (avoids call-stack limits). */
function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Push canvas pixels at most ~30 FPS.
 * Softcam expects RGB24; conversion happens here once per frame.
 * Uses base64 IPC to avoid serializing millions of JSON numbers.
 */
export async function maybePushCanvas(canvas: HTMLCanvasElement, now: number) {
  if (!active || inflight) return;
  // Soft throttle: prefer newest frame, never queue
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
    const { vcamPushFrameB64 } = await import("./vcam.ts");
    await vcamPushFrameB64(bytesToBase64(rgb), w, h);

    consecutiveErrors = 0;
    liveFramesSubmitted += 1;
    source = "live_renderer";
    if (!loggedFirstLive) {
      loggedFirstLive = true;
      console.info("[VirtualCam] First live frame received");
      console.info("[VirtualCam] Live frame size:", `${w}x${h}`);
      console.info("[VirtualCam] Live pixel format: RGB24");
      console.info("[VirtualCam] Switching source TEST_FRAME -> LIVE_RENDERER");
      console.info("[VirtualCam] Live frame #1 submitted");
    } else if (liveFramesSubmitted % 30 === 0) {
      console.info(`[VirtualCam] Live frame #${liveFramesSubmitted} submitted`);
    }
  } catch (e) {
    consecutiveErrors += 1;
    const msg = e instanceof Error ? e.message : String(e);
    // "not running" is expected when camera is stopped — don't kill the bridge permanently
    if (/not running|phase is STOPPED/i.test(msg)) {
      consecutiveErrors = 0;
      return;
    }
    if (consecutiveErrors === 1 || consecutiveErrors === 10) {
      console.warn("[VirtualCam] Live frame submit failed:", msg);
    }
    if (consecutiveErrors > 60) {
      console.warn("[VirtualCam] Live renderer produced no frames (too many errors) — pausing pushes");
      active = false;
      source = "fallback";
    }
  } finally {
    inflight = false;
  }
}

/**
 * Enable capture from Stream Output webview when desktop + camera may be active.
 * Safe to call every mount; Rust rejects pushes while camera is STOPPED.
 */
export function enableStreamOutputCapture(w = 1920, h = 1080) {
  if (!isDesktopApp()) return;
  setVcamCaptureActive(true, w, h);
  console.info("[VirtualCam] Renderer connection established (Stream Output webview)");
}
