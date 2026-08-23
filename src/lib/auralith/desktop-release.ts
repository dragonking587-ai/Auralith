import {
  DESKTOP_RELEASE_PAGE,
  DESKTOP_RELEASE_TAG,
  DESKTOP_RELEASES_PAGE,
  DESKTOP_VERSION,
  DESKTOP_UPDATE_ENDPOINT,
} from "./platform.ts";

const REPO = "dragonking587-ai/Auralith";

export async function resolveWindowsInstallerUrl(): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${DESKTOP_RELEASE_TAG}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      const json = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] };
      const asset = json.assets?.find((a) => /\.exe$/i.test(a.name) && !/debug/i.test(a.name));
      if (asset?.browser_download_url) return asset.browser_download_url;
    }
  } catch {
    /* private repo or offline */
  }
  return DESKTOP_RELEASE_PAGE;
}

export function windowsDownloadFallback(): string {
  return DESKTOP_RELEASES_PAGE;
}

export interface DesktopUpdateInfo {
  tag: string;
  url: string;
  name: string;
  notes?: string;
  version?: string;
}

export type UpdateCheckResult =
  | { status: "up-to-date" }
  | { status: "available"; info: DesktopUpdateInfo }
  | { status: "offline" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

function parseDesktopTag(tag: string): number[] | null {
  // v1.0.0-desktop-test.N
  const m = tag.match(/desktop-test\.(\d+)/i);
  if (m) return [1, 0, 0, Number(m[1])];
  const sem = tag.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (sem) return [Number(sem[1]), Number(sem[2]), Number(sem[3]), 0];
  return null;
}

function isNewer(candidate: string, current: string): boolean {
  const a = parseDesktopTag(candidate);
  const b = parseDesktopTag(current.startsWith("v") ? current : `v${current}`);
  if (!a || !b) return candidate !== current && candidate !== `v${current}`;
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Quiet check used on startup. Never throws. Private repo → unavailable without credentials. */
export async function checkDesktopUpdate(current = DESKTOP_VERSION): Promise<DesktopUpdateInfo | null> {
  const result = await checkForUpdatesDetailed(current);
  return result.status === "available" ? result.info : null;
}

/**
 * Manual / settings update check.
 * No credentials embedded. Public endpoints only.
 * Private source repo cannot serve unauthenticated release downloads — see DESKTOP.md.
 */
export async function checkForUpdatesDetailed(current = DESKTOP_VERSION): Promise<UpdateCheckResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { status: "offline" };
  }

  // Preferred: Tauri updater latest.json on a public HTTPS endpoint
  if (DESKTOP_UPDATE_ENDPOINT) {
    try {
      const res = await fetch(DESKTOP_UPDATE_ENDPOINT, { cache: "no-store" });
      if (res.status === 204) return { status: "up-to-date" };
      if (res.ok) {
        const json = (await res.json()) as {
          version?: string;
          notes?: string;
          platforms?: Record<string, { url?: string }>;
        };
        const ver = json.version || "";
        if (ver && isNewer(ver.startsWith("v") ? ver : `v${ver}`, current)) {
          const url =
            json.platforms?.["windows-x86_64"]?.url ||
            json.platforms?.["windows-x86_64-nsis"]?.url ||
            DESKTOP_RELEASES_PAGE;
          return {
            status: "available",
            info: {
              tag: ver.startsWith("v") ? ver : `v${ver}`,
              url,
              name: `Auralith ${ver}`,
              notes: json.notes,
              version: ver,
            },
          };
        }
        return { status: "up-to-date" };
      }
    } catch {
      /* fall through to GitHub API */
    }
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) {
      return {
        status: "unavailable",
        message:
          "Release metadata is not publicly reachable (private repository). Use a public binary channel for in-app updates.",
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
    }[];
    const currentTag = current.startsWith("v") ? current : `v${current}`;
    const desktop = list.filter((r) => r.tag_name && !r.draft && /desktop/i.test(r.tag_name));
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
      },
    };
  } catch {
    return { status: "offline" };
  }
}

/** Open install page / download — does not embed credentials. */
export async function openUpdatePage(info: DesktopUpdateInfo): Promise<void> {
  if (typeof window !== "undefined") {
    window.open(info.url, "_blank", "noopener,noreferrer");
  }
}
