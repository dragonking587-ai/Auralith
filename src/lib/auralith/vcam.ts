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
  return invoke<VcamStatus>("vcam_start", { width, height, fps });
}

export async function vcamStop(): Promise<void> {
  await invoke("vcam_stop");
}

/**
 * Push one RGB24 frame (or RGBA — Rust accepts both by length) to the virtual camera.
 * Prefer RGB24 from vcam-bridge for lower IPC cost.
 */
export async function vcamPushFrame(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<void> {
  // Tauri serializes typed arrays as number[]; avoid intermediate Array.from when possible
  // by spreading into a plain array only for the wire format expected by serde Vec<u8>.
  const body = pixels instanceof Uint8Array && pixels.buffer.byteLength === pixels.length
    ? Array.from(pixels)
    : Array.from(pixels);
  await invoke("vcam_push_frame", { rgba: body, width, height });
}
