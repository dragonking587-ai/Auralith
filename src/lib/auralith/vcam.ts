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

/** Push one RGBA frame (Uint8ClampedArray or Uint8Array) to the virtual camera. */
export async function vcamPushFrame(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<void> {
  // Tauri serializes Vec<u8> from number[]
  const arr = Array.from(rgba);
  await invoke("vcam_push_frame", { rgba: arr, width, height });
}
