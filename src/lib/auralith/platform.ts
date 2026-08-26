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

/**
 * Single source of truth for the installed desktop marketing version.
 * Bump this (and DESKTOP_RELEASE_TAG) for every desktop release build.
 */
export const DESKTOP_VERSION = "1.0.0-desktop-test.11";
export const DESKTOP_RELEASE_TAG = "v1.0.0-desktop-test.11";
export const DESKTOP_RELEASE_PAGE = `https://github.com/dragonking587-ai/Auralith/releases/tag/${DESKTOP_RELEASE_TAG}`;
export const DESKTOP_RELEASES_PAGE = "https://github.com/dragonking587-ai/Auralith/releases";

/**
 * Public HTTPS update manifest (no credentials).
 * Hosted on a public repo so private Auralith source can still advertise latest desktop builds.
 * Update this file on every desktop release: Auralith-desktop-updates/desktop-latest.json
 */
export const DESKTOP_UPDATE_ENDPOINT =
  "https://raw.githubusercontent.com/dragonking587-ai/Auralith-desktop-updates/main/desktop-latest.json";

/** localStorage key for auto-check preference (default OFF until manual check is proven). */
export const DESKTOP_AUTO_UPDATE_KEY = "auralith.desktop.autoUpdateCheck";
