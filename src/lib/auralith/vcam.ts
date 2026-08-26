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
  filter_registered?: boolean;
  live_frames?: number;
  frame_source?: string;
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

export async function vcamInstall(): Promise<VcamStatus> {
  return invoke<VcamStatus>("vcam_install");
}

export async function vcamUninstall(): Promise<VcamStatus> {
  return invoke<VcamStatus>("vcam_uninstall");
}

export async function vcamStart(width: number, height: number, fps: number): Promise<VcamStatus> {
  return invoke<VcamStatus>("vcam_start", { width, height, fps });
}

export async function vcamStop(): Promise<void> {
  await invoke("vcam_stop");
}

/**
 * Push one RGB24 frame as base64 (avoids Array.from of millions of numbers).
 */
export async function vcamPushFrameB64(
  rgb24Base64: string,
  width: number,
  height: number,
): Promise<void> {
  await invoke("vcam_push_frame_b64", {
    data: rgb24Base64,
    width,
    height,
  });
}

/**
 * Legacy path: number[] IPC — only for small frames / tests.
 */
export async function vcamPushFrame(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<void> {
  if (pixels.length > 3840 * 2160 * 4) {
    throw new Error("Frame too large");
  }
  // Prefer base64 path for anything full-HD sized
  if (pixels.length >= 640 * 360 * 3) {
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < pixels.length; i += chunk) {
      const sub = pixels.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, sub as unknown as number[]);
    }
    await vcamPushFrameB64(btoa(binary), width, height);
    return;
  }
  const body = Array.from(pixels);
  await invoke("vcam_push_frame", { rgba: body, width, height });
}
