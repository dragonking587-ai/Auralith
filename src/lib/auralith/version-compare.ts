/**
 * Parse Auralith desktop versions including `1.0.0-desktop-test.9`.
 * Uses numeric components only — never string compare.
 */
export function parseVersionParts(tag: string): number[] {
  const raw = tag.trim().replace(/^v/i, "");
  const testMatch = raw.match(/desktop-test\.?(\d+)/i);
  const withoutTest = raw.replace(/-?desktop-test\.?\d*/i, "");
  const parts = withoutTest
    .split(/[.+-]/)
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n));
  if (testMatch) {
    parts.push(parseInt(testMatch[1]!, 10));
  }
  return parts.length ? parts : [0];
}

/** True when candidate is strictly newer than current (semver-ish). */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersionParts(candidate);
  const b = parseVersionParts(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
