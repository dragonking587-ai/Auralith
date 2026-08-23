import { isDesktopApp } from "./platform.ts";

export async function desktopWrite(name: string, data: string): Promise<void> {
  if (!isDesktopApp()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_app_file", { name, data });
  } catch {
    /* app-data write is best-effort */
  }
}

export async function desktopRead(name: string): Promise<string | null> {
  if (!isDesktopApp()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const value = await invoke<string | null>("load_app_file", { name });
    return value ?? null;
  } catch {
    return null;
  }
}

export async function loadDesktopLiveScene(): Promise<unknown | null> {
  if (!isDesktopApp()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<unknown | null>("load_live_scene")) ?? null;
  } catch {
    return null;
  }
}
