export function hostInstanceId(): string {
  const key = "auralith.hostInstanceId";
  let id = "";
  try { id = localStorage.getItem(key) || ""; } catch { /* */ }
  if (!id || id.length < 24) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    try { localStorage.setItem(key, id); } catch { /* */ }
  }
  return id;
}
