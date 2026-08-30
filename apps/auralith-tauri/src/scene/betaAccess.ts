/** Temporary beta gate. BETA_ACCESS_REQUIRED=false for unrestricted public release. */
export const BETA_ACCESS_REQUIRED = true;
export const BETA_ACCESS_VERSION = 1;
export const BETA_STORAGE_KEY = "auralith.betaAccessApproved";
export const BETA_VERSION_KEY = "auralith.betaAccessVersion";

/** SHA-256 of normalized codes only. Never store plaintext codes here. */
const ALLOWED_SHA256 = new Set([
  "ce77999289ea521a1884808697a4d5b26e3e7f86b4b09e24e2113254dbb5053b",
  "595de5c3bc9663039b970d167a6807bc5b397853216aa5908e70df896d66a16f",
  "83d3cfebad4fc58eab77ebcb53c0dc4066824ebc89bf4a352207d487d4fff92e",
]);

const FORMAT = /^AUR-BETA-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;

export function isBetaApproved(): boolean {
  if (!BETA_ACCESS_REQUIRED) return true;
  try {
    return localStorage.getItem(BETA_STORAGE_KEY) === "true"
      && Number(localStorage.getItem(BETA_VERSION_KEY) || "0") >= BETA_ACCESS_VERSION;
  } catch {
    return false;
  }
}

export function persistBetaApproval() {
  try {
    localStorage.setItem(BETA_STORAGE_KEY, "true");
    localStorage.setItem(BETA_VERSION_KEY, String(BETA_ACCESS_VERSION));
  } catch { /* ignore */ }
}

export function normalizeBetaCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type BetaCheckResult =
  | { ok: true }
  | { ok: false; reason: "format" | "invalid" };

export async function validateBetaCode(raw: string): Promise<BetaCheckResult> {
  const code = normalizeBetaCode(raw);
  if (!FORMAT.test(code)) return { ok: false, reason: "format" };
  const digest = await sha256Hex(code);
  if (ALLOWED_SHA256.has(digest)) return { ok: true };
  return { ok: false, reason: "invalid" };
}
