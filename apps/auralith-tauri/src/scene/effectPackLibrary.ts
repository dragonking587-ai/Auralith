import { installEffectPack, parseEffectPack, type EffectPack } from "./effectPacks";
import type { Project } from "./types";

export type OnlineEffectPackEntry = {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  collection?: string;
  minAuralithVersion?: string;
  recommendedQuality?: Project["quality"];
  downloadUrl: string;
};

export type OnlineEffectPackCatalog = {
  format: 1;
  title: string;
  updated: string;
  packs: OnlineEffectPackEntry[];
};

export const OFFICIAL_EFFECT_PACK_CATALOG_URL =
  "https://raw.githubusercontent.com/dragonking587-ai/Auralith/tauri/auralith-reborn/apps/auralith-tauri/effect-packs/catalog.json";

const TRUSTED_PACK_PREFIX =
  "/dragonking587-ai/Auralith/tauri/auralith-reborn/apps/auralith-tauri/effect-packs/";
const SAFE_QUALITY = new Set<Project["quality"]>(["Low", "Medium", "High", "Ultra"]);
const MAX_CATALOG_PACKS = 100;
const MAX_PACK_BYTES = 512 * 1024;

const text = (value: unknown, fallback: string, max: number) => {
  const s = typeof value === "string" ? value.trim() : fallback;
  return (s || fallback).slice(0, max);
};

export function isTrustedOfficialPackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "raw.githubusercontent.com" &&
      url.pathname.startsWith(TRUSTED_PACK_PREFIX) &&
      url.pathname.toLowerCase().endsWith(".aurapack");
  } catch {
    return false;
  }
}

function sanitizeCatalogEntry(raw: unknown): OnlineEffectPackEntry {
  if (!raw || typeof raw !== "object") throw new Error("Invalid online effect pack entry.");
  const p = raw as Record<string, unknown>;
  const downloadUrl = text(p.downloadUrl, "", 500);
  if (!isTrustedOfficialPackUrl(downloadUrl)) throw new Error("Effect pack uses an untrusted download location.");
  const quality = SAFE_QUALITY.has(p.recommendedQuality as Project["quality"])
    ? (p.recommendedQuality as Project["quality"])
    : "High";
  return {
    id: text(p.id, "", 120),
    name: text(p.name, "Untitled Effect Pack", 80),
    author: text(p.author, "Auralith Creator", 80),
    version: text(p.version, "1.0.0", 32),
    description: text(p.description, "Stacked Auralith effect pack.", 500),
    category: text(p.category, "Custom", 48),
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 12).map((x) => text(x, "", 32)).filter(Boolean) : [],
    collection: p.collection ? text(p.collection, "", 80) : undefined,
    minAuralithVersion: p.minAuralithVersion ? text(p.minAuralithVersion, "", 40) : undefined,
    recommendedQuality: quality,
    downloadUrl,
  };
}

export async function fetchOfficialEffectPackCatalog(fetcher: typeof fetch = fetch): Promise<OnlineEffectPackCatalog> {
  const response = await fetcher(OFFICIAL_EFFECT_PACK_CATALOG_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Effect Pack Library returned HTTP ${response.status}.`);
  const raw = await response.json() as Record<string, unknown>;
  if (Number(raw.format) !== 1) throw new Error("Unsupported Effect Pack Library format.");
  const items = Array.isArray(raw.packs) ? raw.packs : [];
  if (items.length > MAX_CATALOG_PACKS) throw new Error("Effect Pack Library exceeds the safety limit.");
  return {
    format: 1,
    title: text(raw.title, "Auralith Effect Pack Library", 100),
    updated: text(raw.updated, "", 40),
    packs: items.map(sanitizeCatalogEntry),
  };
}

export async function downloadOfficialEffectPack(entry: OnlineEffectPackEntry, fetcher: typeof fetch = fetch): Promise<EffectPack> {
  if (!isTrustedOfficialPackUrl(entry.downloadUrl)) throw new Error("Untrusted effect pack download URL.");
  const response = await fetcher(entry.downloadUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Pack download returned HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_PACK_BYTES) throw new Error("Effect pack is larger than the 512 KB safety limit.");
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_PACK_BYTES) throw new Error("Effect pack is larger than the 512 KB safety limit.");
  const pack = parseEffectPack(body);
  if (pack.manifest.id !== entry.id) throw new Error("Downloaded pack ID does not match the catalog.");
  if (pack.manifest.version !== entry.version) throw new Error("Downloaded pack version does not match the catalog.");
  return pack;
}

export async function downloadAndInstallOfficialEffectPack(entry: OnlineEffectPackEntry, fetcher: typeof fetch = fetch) {
  const pack = await downloadOfficialEffectPack(entry, fetcher);
  return { pack, installed: installEffectPack(pack) };
}
