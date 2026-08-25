import {
  DESKTOP_RELEASES_PAGE,
  DESKTOP_UPDATE_ENDPOINT,
  DESKTOP_VERSION,
  isDesktopApp,
} from "./platform";
import { isNewerVersion } from "./version-compare";

export type DesktopUpdateInfo = {
  tag: string;
  url: string;
  name: string;
  notes?: string;
  version?: string;
  date?: string;
  /** True when Tauri signed updater can download/install without browser */
  canAutoInstall?: boolean;
};

export type UpdateCheckResult =
  | { status: "up-to-date"; installed: string; latest: string }
  | { status: "available"; info: DesktopUpdateInfo; installed: string; latest: string }
  | { status: "offline"; message: string; installed: string }
  | { status: "error"; message: string; installed: string }
  | { status: "private-channel"; message: string; installed: string };

const CHECK_TIMEOUT_MS = 15_000;
const GITHUB_RELEASES_API =
  "https://api.github.com/repos/dragonking587-ai/Auralith/releases?per_page=20";

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.info("[Updater]", ...args);
}

function normalizeTag(v: string): string {
  const t = v.trim();
  return t.startsWith("v") ? t : `v${t}`;
}

function stripV(v: string): string {
  return v.trim().replace(/^v/i, "");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        // GitHub-friendly UA; no secrets
        "User-Agent": `Auralith-Desktop/${DESKTOP_VERSION}`,
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

type ManifestJson = {
  version?: string;
  tag?: string;
  downloadUrl?: string;
  url?: string;
  releaseNotes?: string;
  notes?: string;
  sha256?: string;
  date?: string;
};

/**
 * Check a public JSON manifest (no credentials).
 */
async function checkManifest(
  url: string,
  current: string,
): Promise<UpdateCheckResult | null> {
  log("Update source: manifest", url);
  log("Sending request");
  const res = await fetchWithTimeout(url);
  log("Response received", res.status);
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    log("Manifest not reachable (HTTP", res.status, ") — trying next source");
    return null;
  }
  if (!res.ok) {
    throw new Error(`Manifest HTTP ${res.status}`);
  }
  let data: ManifestJson;
  try {
    data = (await res.json()) as ManifestJson;
  } catch {
    throw new Error("Invalid update information received (malformed JSON)");
  }
  const remote = data.version || data.tag;
  if (!remote || typeof remote !== "string") {
    throw new Error("Invalid update information received (missing version field)");
  }
  const latest = stripV(remote);
  log("Latest version:", latest);
  log("Comparing versions", { installed: current, latest });
  if (!isNewerVersion(remote, current)) {
    log("Already up to date");
    return {
      status: "up-to-date",
      installed: current,
      latest,
    };
  }
  log("Update available");
  return {
    status: "available",
    installed: current,
    latest,
    info: {
      tag: normalizeTag(remote),
      version: latest,
      url: data.downloadUrl || data.url || DESKTOP_RELEASES_PAGE,
      name: remote,
      notes: data.releaseNotes || data.notes,
      date: data.date,
      // One-click install only when Tauri endpoints + signed artifacts are configured
      canAutoInstall: false,
    },
  };
}

/**
 * GitHub Releases API — only works when release metadata is public.
 * Private source repo returns HTTP 404 without credentials (we never embed tokens).
 */
async function checkGitHubReleases(current: string): Promise<UpdateCheckResult> {
  log("Update source: GitHub Releases API", GITHUB_RELEASES_API);
  log("Sending request");
  const res = await fetchWithTimeout(GITHUB_RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  log("Response received", res.status);

  if (res.status === 404 || res.status === 401 || res.status === 403) {
    log("Private or inaccessible repository (no public release metadata)");
    return {
      status: "private-channel",
      installed: current,
      message:
        `Cannot read GitHub Releases from the private repository (HTTP ${res.status}). ` +
        `Installed: ${current}. Use the public update manifest or Open Releases to update manually.`,
    };
  }
  if (!res.ok) {
    throw new Error(`GitHub Releases API failed (HTTP ${res.status})`);
  }

  let list: Array<{
    tag_name?: string;
    name?: string;
    html_url?: string;
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
    published_at?: string;
  }>;
  try {
    list = (await res.json()) as typeof list;
  } catch {
    throw new Error("Invalid update information received (malformed GitHub JSON)");
  }
  if (!Array.isArray(list)) {
    throw new Error("Invalid update information received (expected release list)");
  }

  const candidates = list.filter((r) => r && !r.draft && r.tag_name);
  if (candidates.length === 0) {
    return {
      status: "up-to-date",
      installed: current,
      latest: current,
    };
  }

  // Prefer newest by numeric version compare among desktop tags when present
  let best = candidates[0]!;
  for (const r of candidates.slice(1)) {
    if (r.tag_name && best.tag_name && isNewerVersion(r.tag_name, best.tag_name)) {
      best = r;
    }
  }
  const remote = best.tag_name!;
  const latest = stripV(remote);
  log("Latest version:", latest);
  log("Comparing versions", { installed: current, latest });
  if (!isNewerVersion(remote, current)) {
    log("Already up to date");
    return { status: "up-to-date", installed: current, latest };
  }
  log("Update available");
  return {
    status: "available",
    installed: current,
    latest,
    info: {
      tag: normalizeTag(remote),
      version: latest,
      url: best.html_url || DESKTOP_RELEASES_PAGE,
      name: best.name || remote,
      notes: best.body || undefined,
      date: best.published_at,
      canAutoInstall: false,
    },
  };
}

/**
 * Prefer public HTTPS manifest, then Tauri plugin (if endpoints configured),
 * then GitHub Releases API. Never embeds credentials.
 */
export async function checkForUpdatesDetailed(
  current = DESKTOP_VERSION,
): Promise<UpdateCheckResult> {
  log("Manual update check requested");
  log("Installed version:", current);

  if (typeof window === "undefined") {
    return { status: "error", message: "Not in browser", installed: current };
  }

  try {
    // 1) Public JSON manifest (works for private source repos)
    if (DESKTOP_UPDATE_ENDPOINT && /^https:\/\//i.test(DESKTOP_UPDATE_ENDPOINT)) {
      try {
        const fromManifest = await checkManifest(DESKTOP_UPDATE_ENDPOINT, current);
        if (fromManifest) return fromManifest;
      } catch (e) {
        log("Manifest check failed:", e);
        // Continue to other sources unless it is a hard validation error
        const msg = e instanceof Error ? e.message : String(e);
        if (/Invalid update information/i.test(msg)) {
          return { status: "error", installed: current, message: msg };
        }
      }
    }

    // 2) Signed Tauri updater when endpoints are configured in tauri.conf
    if (isDesktopApp()) {
      try {
        log("Update source: Tauri plugin");
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update) {
          log("Tauri plugin reported no update (or no endpoints)");
        } else {
          log("Latest version:", update.version);
          log("Update available (Tauri)");
          return {
            status: "available",
            installed: current,
            latest: stripV(update.version),
            info: {
              tag: normalizeTag(update.version),
              version: stripV(update.version),
              url: DESKTOP_RELEASES_PAGE,
              name: update.version,
              notes: update.body,
              date: update.date,
              canAutoInstall: true,
            },
          };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("Tauri updater check failed:", msg);
        // Empty endpoints often throw — continue to GitHub
      }
    }

    // 3) GitHub Releases API (public metadata only)
    return await checkGitHubReleases(current);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("Update check failed:", msg);
    if (
      /abort|timeout/i.test(msg) ||
      (e instanceof DOMException && e.name === "AbortError")
    ) {
      return {
        status: "error",
        installed: current,
        message: "Update check timed out. Check your connection and try again.",
      };
    }
    if (/network|fetch|Failed to fetch|Load failed|offline/i.test(msg)) {
      return {
        status: "offline",
        installed: current,
        message: "No internet connection (or the update server is unreachable).",
      };
    }
    return {
      status: "error",
      installed: current,
      message: msg || "Unable to check for updates.",
    };
  }
}

export async function checkDesktopUpdate(
  current = DESKTOP_VERSION,
): Promise<DesktopUpdateInfo | null> {
  const r = await checkForUpdatesDetailed(current);
  return r.status === "available" ? r.info : null;
}

/** Download + install via Tauri updater when canAutoInstall; else open release page. */
export async function applyDesktopUpdate(
  info: DesktopUpdateInfo,
): Promise<{ mode: "installed" | "opened" | "error"; message?: string }> {
  if (info.canAutoInstall && isDesktopApp()) {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) return { mode: "error", message: "Update no longer available" };
      await update.downloadAndInstall();
      await relaunch();
      return { mode: "installed" };
    } catch (e) {
      return { mode: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
  if (typeof window !== "undefined") {
    window.open(info.url || DESKTOP_RELEASES_PAGE, "_blank", "noopener,noreferrer");
  }
  return { mode: "opened" };
}

export async function openUpdatePage(info: DesktopUpdateInfo): Promise<void> {
  await applyDesktopUpdate(info);
}

export async function resolveWindowsInstallerUrl(): Promise<string | null> {
  return DESKTOP_RELEASES_PAGE;
}
