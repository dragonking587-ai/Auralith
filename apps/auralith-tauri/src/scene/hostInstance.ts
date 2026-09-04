const KEY = "auralith.hostInstanceId";

export function hostInstanceId(): string {
  let id = "";
  try { id = localStorage.getItem(KEY) || ""; } catch { /* */ }
  if (!id || id.length < 32) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    try { localStorage.setItem(KEY, id); } catch { /* */ }
  }
  return id;
}

export function hostFingerprint(id = hostInstanceId()): string {
  const hex = id.replace(/[^a-f0-9]/gi, "").toUpperCase();
  return (hex.slice(0, 4) + "-" + hex.slice(4, 8)) || "----";
}

export function resetHostInstance(): string {
  try { localStorage.removeItem(KEY); } catch { /* */ }
  return hostInstanceId();
}

const NAME_KEY = "auralith.instanceDisplayName";

export function instanceDisplayName(): string {
  try {
    const n = (localStorage.getItem(NAME_KEY) || "").trim();
    if (n) return n.slice(0, 40);
  } catch { /* */ }
  return "Auralith Host";
}

export function setInstanceDisplayName(raw: string): string {
  const n = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 40) || "Auralith Host";
  try { localStorage.setItem(NAME_KEY, n); } catch { /* */ }
  return n;
}
