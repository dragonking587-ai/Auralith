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

/** Installed desktop marketing version (matches release tag without leading v when possible). */
export const DESKTOP_VERSION = "1.0.0-desktop-test.9";
export const DESKTOP_RELEASE_TAG = "v1.0.0-desktop-test.9";
export const DESKTOP_RELEASE_PAGE = `https://github.com/dragonking587-ai/Auralith/releases/tag/${DESKTOP_RELEASE_TAG}`;
export const DESKTOP_RELEASES_PAGE = "https://github.com/dragonking587-ai/Auralith/releases";

/**
 * Public HTTPS endpoint for Tauri updater JSON (latest.json).
 * Empty = rely on GitHub Releases API only (fails closed when the repo is private).
 * Recommended: host signed binaries + latest.json on a public releases channel — never embed PATs.
 */
export const DESKTOP_UPDATE_ENDPOINT = "";

/** localStorage key for auto-check preference */
export const DESKTOP_AUTO_UPDATE_KEY = "auralith.desktop.autoUpdateCheck";
