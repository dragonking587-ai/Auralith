export const APP_VERSION = "1.0.0-rc.3";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "verifying"
  | "installing"
  | "error";

export function semverNewer(remote: string, local: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-");
    const [a, b, c] = (core || "0.0.0").split(".").map((n) => Number(n) || 0);
    return { a, b, c, pre: pre || "" };
  };
  const r = parse(remote), l = parse(local);
  if (r.a !== l.a) return r.a > l.a;
  if (r.b !== l.b) return r.b > l.b;
  if (r.c !== l.c) return r.c > l.c;
  if (!r.pre && l.pre) return true;
  if (r.pre && !l.pre) return false;
  return r.pre > l.pre;
}

export function formatBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let x = n;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function persistPending(version: string) {
  try { localStorage.setItem("auralith.pendingUpdateVersion", version); } catch { /* ignore */ }
}
export function takePending(): string {
  try {
    const v = localStorage.getItem("auralith.pendingUpdateVersion") || "";
    if (v) localStorage.removeItem("auralith.pendingUpdateVersion");
    return v;
  } catch { return ""; }
}
export function autosaveProject(json: string) {
  try { localStorage.setItem("auralith.recoveryProject", json); } catch { /* ignore */ }
}
