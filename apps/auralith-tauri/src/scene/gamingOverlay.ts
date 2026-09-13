export type GamingOverlayKind = "web" | "panel" | "text";

export type GamingOverlayItem = {
  id: string;
  kind: GamingOverlayKind;
  name: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  rotateX: number;
  rotateY: number;
  skewX: number;
  skewY: number;
  perspective: number;
  opacity: number;
  zIndex: number;
  borderRadius: number;
  url?: string;
  interactive?: boolean;
  hue?: number;
  saturation?: number;
  brightness?: number;
  contrast?: number;
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
  glow?: number;
  text?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: number;
  align?: "left" | "center" | "right";
};

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

const text = (value: unknown, fallback: string, max = 240) => {
  const v = typeof value === "string" ? value.trim() : "";
  return (v || fallback).slice(0, max);
};

const color = (value: unknown, fallback: string) => {
  const v = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
};

export function safeOverlayUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value.trim());
    if (u.protocol === "https:") return u.toString();
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")) return u.toString();
  } catch { /* invalid URL */ }
  return "";
}

export function createGamingOverlay(kind: GamingOverlayKind, projectWidth = 1920, projectHeight = 1080): GamingOverlayItem {
  const base: GamingOverlayItem = {
    id: crypto.randomUUID(),
    kind,
    name: kind === "web" ? "Web / Song Card" : kind === "panel" ? "Gaming Frame" : "Overlay Text",
    visible: true,
    x: projectWidth / 2,
    y: projectHeight / 2,
    width: kind === "text" ? 520 : kind === "web" ? 640 : 720,
    height: kind === "text" ? 110 : kind === "web" ? 360 : 420,
    rotation: 0,
    rotateX: 0,
    rotateY: 0,
    skewX: 0,
    skewY: 0,
    perspective: 900,
    opacity: 1,
    zIndex: 10,
    borderRadius: 18,
  };
  if (kind === "web") {
    return { ...base, url: "https://loudman.live/", interactive: false, hue: 0, saturation: 1, brightness: 1, contrast: 1 };
  }
  if (kind === "panel") {
    return { ...base, fillColor: "#0d0f14", borderColor: "#d4af37", borderWidth: 4, glow: 18, opacity: 0.72 };
  }
  return { ...base, text: "OBSIDIAN WOLF", textColor: "#f4d27a", fillColor: "#000000", borderColor: "#d4af37", borderWidth: 1, fontSize: 48, fontWeight: 800, align: "center", opacity: 0.95 };
}

export function normalizeGamingOverlay(raw: unknown, projectWidth = 1920, projectHeight = 1080): GamingOverlayItem {
  if (!raw || typeof raw !== "object") throw new Error("Invalid gaming overlay item.");
  const r = raw as Record<string, unknown>;
  const kind: GamingOverlayKind = r.kind === "web" || r.kind === "panel" || r.kind === "text" ? r.kind : "panel";
  const d = createGamingOverlay(kind, projectWidth, projectHeight);
  const align = r.align === "left" || r.align === "right" || r.align === "center" ? r.align : d.align;
  return {
    ...d,
    id: text(r.id, d.id, 96),
    kind,
    name: text(r.name, d.name, 80),
    visible: r.visible !== false,
    x: clamp(r.x, d.x, -projectWidth * 2, projectWidth * 3),
    y: clamp(r.y, d.y, -projectHeight * 2, projectHeight * 3),
    width: clamp(r.width, d.width, 40, projectWidth * 3),
    height: clamp(r.height, d.height, 30, projectHeight * 3),
    rotation: clamp(r.rotation, d.rotation, -180, 180),
    rotateX: clamp(r.rotateX, d.rotateX, -75, 75),
    rotateY: clamp(r.rotateY, d.rotateY, -75, 75),
    skewX: clamp(r.skewX, d.skewX, -60, 60),
    skewY: clamp(r.skewY, d.skewY, -60, 60),
    perspective: clamp(r.perspective, d.perspective, 120, 4000),
    opacity: clamp(r.opacity, d.opacity, 0, 1),
    zIndex: Math.round(clamp(r.zIndex, d.zIndex, 0, 200)),
    borderRadius: clamp(r.borderRadius, d.borderRadius, 0, 200),
    url: kind === "web" ? safeOverlayUrl(r.url) : undefined,
    interactive: kind === "web" ? r.interactive === true : undefined,
    hue: kind === "web" ? clamp(r.hue, d.hue ?? 0, -180, 180) : undefined,
    saturation: kind === "web" ? clamp(r.saturation, d.saturation ?? 1, 0, 3) : undefined,
    brightness: kind === "web" ? clamp(r.brightness, d.brightness ?? 1, 0.2, 3) : undefined,
    contrast: kind === "web" ? clamp(r.contrast, d.contrast ?? 1, 0.2, 3) : undefined,
    fillColor: kind !== "web" ? color(r.fillColor, d.fillColor || "#000000") : undefined,
    borderColor: kind !== "web" ? color(r.borderColor, d.borderColor || "#d4af37") : undefined,
    borderWidth: kind !== "web" ? clamp(r.borderWidth, d.borderWidth ?? 0, 0, 40) : undefined,
    glow: kind === "panel" ? clamp(r.glow, d.glow ?? 0, 0, 80) : undefined,
    text: kind === "text" ? text(r.text, d.text || "Overlay Text", 300) : undefined,
    textColor: kind === "text" ? color(r.textColor, d.textColor || "#ffffff") : undefined,
    fontSize: kind === "text" ? clamp(r.fontSize, d.fontSize ?? 48, 10, 240) : undefined,
    fontWeight: kind === "text" ? Math.round(clamp(r.fontWeight, d.fontWeight ?? 700, 100, 900) / 100) * 100 : undefined,
    align: kind === "text" ? align : undefined,
  };
}

export function normalizeGamingOverlays(raw: unknown, projectWidth = 1920, projectHeight = 1080): GamingOverlayItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 64).map((item) => {
    try { return normalizeGamingOverlay(item, projectWidth, projectHeight); }
    catch { return null; }
  }).filter((item): item is GamingOverlayItem => !!item);
}
