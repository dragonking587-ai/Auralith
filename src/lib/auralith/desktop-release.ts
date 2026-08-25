import {
  DESKTOP_RELEASES_PAGE,
  DESKTOP_UPDATE_ENDPOINT,
  DESKTOP_VERSION,
  isDesktopApp,
} from "./platform";

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
  | { status: "up-to-date" }
  | { status: "available"; info: DesktopUpdateInfo }
  | { status: "offline" }
  | { status: "error"; message: string }
  | { status: "private-channel"; message: string };

function parseSemverish(tag: string): number[] {
  const cleaned = tag.replace(/^v/, "").replace(/-desktop-test\.?/i, ".");
  const parts = cleaned.split(/[.+-]/).map((p) => parseInt(p, 10)).filter((n) => !Number.isNaN(n));
  return parts.length ? parts : [0];
}

function isNewer(candidate: string, current: string): boolean {
  const a = parseSemverish(candidate);
  const b = parseSemverish(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * Prefer Tauri updater endpoints (public HTTPS + signed artifacts).
 * Never embeds credentials. Private GitHub source releases are not readable
 * without auth — update installs require a public binary channel.
 */
export async function checkForUpdatesDetailed(
  current = DESKTOP_VERSION,
): Promise<UpdateCheckResult> {
  if (typeof window === "undefined") {
    return { status: "error", message: "Not in browser" };
  }

  // 1) Signed Tauri updater (public endpoint only)
  if (isDesktopApp() && DESKTOP_UPDATE_ENDPOINT) {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) return { status: "up-to-date" };
      return {
        status: "available",
        info: {
          tag: update.version.startsWith("v") ? update.version : `v${update.version}`,
          version: update.version,
          url: DESKTOP_UPDATE_ENDPOINT,
          name: update.version,
          notes: update.body,
          date: update.date,
          canAutoInstall: true,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/network|fetch|offline|Failed to fetch/i.test(msg)) {
        return { status: "offline" };
      }
      // fall through to GitHub metadata probe
    }
  }

  // 2) Public GitHub Releases API (works only if release metadata is public)
  try {
    const res = await fetch(
      "https://api.github.com/repos/dragonking587-ai/Auralith/releases?per_page=20",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      return {
        status: "private-channel",
        message:
          "Update metadata is not public yet (private repository). Installers still work offline. For one-click in-app updates, publish binaries on a public releases channel (recommended) — never embed GitHub credentials in the app.",
      };
    }
    if (!res.ok) {
      return { status: "error", message: `Update check failed (${res.status})` };
    }
    const list = (await res.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
    }[];
    const currentTag = current.startsWith("v") ? current : `v${current}`;
    const desktop = list.filter((r) => r.tag_name && !r.draft && /desktop/i.test(r.tag_name || ""));
    const newer = desktop.find((r) => r.tag_name && isNewer(r.tag_name, currentTag));
    if (!newer?.tag_name || !newer.html_url) {
      return { status: "up-to-date" };
    }
    return {
      status: "available",
      info: {
        tag: newer.tag_name,
        url: newer.html_url,
        name: newer.name || newer.tag_name,
        notes: newer.body,
        version: newer.tag_name.replace(/^v/, ""),
        canAutoInstall: false,
      },
    };
  } catch {
    return { status: "offline" };
  }
}

export async function checkDesktopUpdate(current = DESKTOP_VERSION): Promise<DesktopUpdateInfo | null> {
  const r = await checkForUpdatesDetailed(current);
  return r.status === "available" ? r.info : null;
}

/** Download + install via Tauri updater when canAutoInstall; else open release page. */
export async function applyDesktopUpdate(info: DesktopUpdateInfo): Promise<{ mode: "installed" | "opened" | "error"; message?: string }> {
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
