/**
 * FinalFrameProvider — authoritative clean (no-editor-overlay) frames
 * for Native Broadcast Output and future consumers (VCam, Spout).
 *
 * Uses a dedicated offscreen canvas + the existing createRenderer({ stream: true }).
 * Does NOT reconstruct effects; reuses renderer.ts.
 */

import { createRenderer, type Renderer } from "./renderer";
import type { LiveBands, Scene } from "./types";
import { isDesktopApp } from "./platform";

let canvas: HTMLCanvasElement | null = null;
let renderer: Renderer | null = null;
let nativeOpen = false;
let lastPush = 0;
let inflight = false;
let width = 1920;
let height = 1080;
let rgbaBuf: Uint8ClampedArray | null = null;
let bgraBuf: Uint8Array | null = null;

export function isNativeBroadcastOpen() {
  return nativeOpen;
}

export async function openNativeBroadcast(w: number, h: number): Promise<void> {
  if (!isDesktopApp()) throw new Error("Native Broadcast Output requires desktop");
  width = Math.max(16, w | 0);
  height = Math.max(16, h | 0);
  ensureSurface(width, height);
  const { invoke } = await import("@tauri-apps/api/core");
  console.info("[NativeBroadcast UI] invoking broadcast_open", { width, height });
  await invoke("broadcast_open", { width, height });
  nativeOpen = true;
  console.info("[NativeBroadcast UI] broadcast_open OK — window should be visible");
}

export async function closeNativeBroadcast(): Promise<void> {
  nativeOpen = false;
  if (!isDesktopApp()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("broadcast_close");
  } catch {
    /* ignore */
  }
}

function ensureSurface(w: number, h: number) {
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    renderer = createRenderer(canvas, { stream: true });
  } else if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    renderer?.setSize(w, h);
  }
  width = w;
  height = h;
}

function rgbaToBgra(src: Uint8ClampedArray, out: Uint8Array) {
  for (let i = 0, j = 0; i < src.length; i += 4, j += 4) {
    out[j] = src[i + 2]!; // B
    out[j + 1] = src[i + 1]!; // G
    out[j + 2] = src[i]!; // R
    out[j + 3] = src[i + 3]!; // A
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Draw clean scene to offscreen surface and push newest frame to native output.
 * Call from the editor rAF loop. Drops frames if previous push still in flight.
 */
export function tickFinalFrame(args: {
  scene: Scene;
  image: CanvasImageSource | null;
  bands: LiveBands;
  now: number;
}): void {
  if (!nativeOpen || !isDesktopApp()) return;
  const w = args.scene.output.width;
  const h = args.scene.output.height;
  ensureSurface(w, h);
  if (!renderer || !canvas) return;

  const fps = args.scene.output.fps ?? 30;
  const minDt = fps === 60 ? 15 : 32;
  if (args.now - lastPush < minDt) return;
  if (inflight) return;

  renderer.drawFrame({
    scene: args.scene,
    image: args.image,
    bands: args.bands,
    now: args.now,
    guides: null, // SCENE ONLY — no editor overlays
  });

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const need = w * h * 4;
  if (!bgraBuf || bgraBuf.length !== need) bgraBuf = new Uint8Array(need);
  rgbaToBgra(img.data, bgraBuf);
  lastPush = args.now;
  inflight = true;
  const payload = bytesToBase64(bgraBuf);
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("broadcast_push_frame_b64", { data: payload, width: w, height: h }))
    .catch((e) => {
      console.warn("[FinalFrameProvider] push failed", e);
    })
    .finally(() => {
      inflight = false;
    });
}
