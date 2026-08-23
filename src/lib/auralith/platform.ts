/** True when running inside the packaged Auralith desktop app. */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function desktopHttpOrigin(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:4317";
  const w = window as Window & { __AURALITH_PORT__?: number };
  const port = typeof w.__AURALITH_PORT__ === "number" ? w.__AURALITH_PORT__ : 4317;
  return `http://127.0.0.1:${port}`;
}

export const DESKTOP_VERSION = "1.0.0-desktop-test.1";
export const DESKTOP_RELEASE_TAG = "v1.0.0-desktop-test.1";
export const DESKTOP_RELEASE_PAGE = `https://github.com/dragonking587-ai/Auralith/releases/tag/${DESKTOP_RELEASE_TAG}`;
export const DESKTOP_RELEASES_PAGE = "https://github.com/dragonking587-ai/Auralith/releases";
