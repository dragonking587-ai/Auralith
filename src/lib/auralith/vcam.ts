import { isDesktopApp } from "./platform.ts";

export interface VcamStatus {
  running: boolean;
  width: number;
  height: number;
  fps: number;
  backend: string;
  device_name: string;
  last_error: string | null;
  dll_loaded: boolean;
  state?: string;
  last_stage?: string | null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import("@tauri-apps/api/core");
  return inv<T>(cmd, args);
}

export async function vcamStatus(): Promise<VcamStatus | null> {
  if (!isDesktopApp()) return null;
  try {
    return await invoke<VcamStatus>("vcam_status");
  } catch {
    return null;
  }
}

export async function vcamStart(width: number, height: number, fps: number): Promise<VcamStatus> {
  // Conservative first-start: softcam receives fps=0 internally; UI still reports target fps.
  return invoke<VcamStatus>("vcam_start", { width, height, fps });
}

export async function vcamStop(): Promise<void> {
  await invoke("vcam_stop");
}

/**
 * Push one RGB24 (preferred) or RGBA frame. Failures never crash the UI — they reject.
 */
export async function vcamPushFrame(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<void> {
  // Cap transfer size: reject absurd buffers instead of serializing hundreds of MB.
  if (pixels.length > 3840 * 2160 * 4) {
    throw new Error("Frame too large");
  }
  // Tauri serde path expects a sequence for Vec<u8>.
  const body = Array.from(pixels);
  await invoke("vcam_push_frame", { rgba: body, width, height });
}
