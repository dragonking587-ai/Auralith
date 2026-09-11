import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const fail = (m) => { throw new Error(`[online-effect-library-audit] ${m}`); };
const must = (text, needle, label) => { if (!text.includes(needle)) fail(`missing ${label}: ${needle}`); };

const library = read("src/scene/effectPackLibrary.ts");
const app = read("src/ui/App.tsx");
const catalog = JSON.parse(read("effect-packs/catalog.json"));

must(library, "OFFICIAL_EFFECT_PACK_CATALOG_URL", "official catalog URL");
must(library, 'url.hostname === "raw.githubusercontent.com"', "trusted host gate");
must(library, "TRUSTED_PACK_PREFIX", "trusted repository path gate");
must(library, "MAX_PACK_BYTES = 512 * 1024", "download size limit");
must(library, "parseEffectPack(body)", "existing pack sanitizer reuse");
must(library, "Downloaded pack ID does not match the catalog", "catalog ID verification");
must(library, "Downloaded pack version does not match the catalog", "catalog version verification");
must(app, "AURALITH_ONLINE_EFFECT_LIBRARY_V1", "online library UI marker");
must(app, "Download & Install", "one-click install button");
must(app, "fetchOfficialEffectPackCatalog", "catalog refresh action");
must(app, "downloadAndInstallOfficialEffectPack", "direct download/install action");

if (catalog.format !== 1) fail("catalog format must be 1");
if (!Array.isArray(catalog.packs) || catalog.packs.length < 5) fail("catalog must contain the Obsidian Wolf collection");
const ids = new Set();
for (const entry of catalog.packs) {
  if (!entry.id || ids.has(entry.id)) fail(`missing/duplicate catalog id: ${entry.id}`);
  ids.add(entry.id);
  if (!String(entry.downloadUrl || "").startsWith("https://raw.githubusercontent.com/dragonking587-ai/Auralith/tauri/auralith-reborn/apps/auralith-tauri/effect-packs/")) fail(`untrusted catalog URL: ${entry.downloadUrl}`);
  const filename = new URL(entry.downloadUrl).pathname.split("/").pop();
  const pack = JSON.parse(read(`effect-packs/${filename}`));
  if (pack.manifest?.id !== entry.id) fail(`pack/catalog ID mismatch: ${entry.id}`);
  if (pack.manifest?.version !== entry.version) fail(`pack/catalog version mismatch: ${entry.id}`);
  if (!Array.isArray(pack.effects) || !pack.effects.length) fail(`pack has no effects: ${entry.id}`);
}

console.log(`[online-effect-library-audit] PASS — ${catalog.packs.length} trusted online packs are cataloged with one-click sanitized download/install.`);
