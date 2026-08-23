import { DESKTOP_RELEASE_PAGE, DESKTOP_RELEASE_TAG, DESKTOP_RELEASES_PAGE, DESKTOP_VERSION } from "./platform.ts";

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
}

/** Quiet GitHub check. Never blocks launch. Fails closed when the repo is private or offline. */
export async function checkDesktopUpdate(current = DESKTOP_VERSION): Promise<DesktopUpdateInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=8`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const list = (await res.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      draft?: boolean;
      prerelease?: boolean;
    }[];
    const currentTag = current.startsWith("v") ? current : `v${current}`;
    const next = list.find((r) => r.tag_name && !r.draft && r.tag_name !== currentTag);
    if (!next?.tag_name || !next.html_url) return null;
    return { tag: next.tag_name, url: next.html_url, name: next.name || next.tag_name };
  } catch {
    return null;
  }
}
