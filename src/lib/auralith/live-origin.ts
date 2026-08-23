import { desktopHttpOrigin, isDesktopApp } from "./platform.ts";

function onLocalHub(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "127.0.0.1" || host === "localhost";
}

/** HTTP origin for the live hub. Empty string = same-origin (web app or local hub page). */
export function liveHttpBase(): string {
  if (onLocalHub()) return "";
  if (isDesktopApp()) return desktopHttpOrigin();
  return "";
}

export function liveWsBase(): string {
  if (typeof window !== "undefined" && onLocalHub()) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
  }
  if (isDesktopApp()) {
    return desktopHttpOrigin().replace("http://", "ws://").replace("https://", "wss://");
  }
  if (typeof location === "undefined") return "";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}
