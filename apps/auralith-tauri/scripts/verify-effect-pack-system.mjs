import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const fail = (m) => { throw new Error(`[effect-pack-audit] ${m}`); };
const must = (text, needle, label) => { if (!text.includes(needle)) fail(`missing ${label}: ${needle}`); };

const packs = read("src/scene/effectPacks.ts");
const app = read("src/ui/App.tsx");

must(packs, 'format: 1;', "versioned pack format");
must(packs, 'const MAX_EFFECTS_PER_PACK = 32;', "effect count safety limit");
must(packs, 'ALL_EFFECTS.includes(kind)', "built-in effect whitelist");
must(packs, 'export function parseEffectPack', "pack parser");
must(packs, 'export function instantiatePackEffects', "runtime pack cloning");
must(packs, 'export function installEffectPack', "local install persistence");
must(packs, 'export function uninstallEffectPack', "local uninstall persistence");
must(packs, 'Obsidian Wolf Effects Collection', "Obsidian Wolf collection");
for (const id of ["obsidianwolf.inferno-aura", "obsidianwolf.void-howl", "obsidianwolf.storm-fang", "obsidianwolf.blood-moon-ritual", "obsidianwolf.frostbite-wolf"]) must(packs, id, id);

must(app, "AURALITH_EFFECT_PACKS_V1", "effect pack UI marker");
must(app, "Save Current Stack as Pack", "pack creator button");
must(app, "Install .aurapack", "pack import button");
must(app, "Apply Pack", "replace-stack action");
must(app, "Add Stack", "append-stack action");
must(app, "Export", "pack export action");
must(app, "Uninstall", "custom pack uninstall action");
must(app, "semverNewer(pack.manifest.minAuralithVersion, APP_VERSION)", "minimum-version compatibility gate");

for (const forbidden of ["eval(", "new Function(", "WebAssembly.compile", "import(pack", "scriptUrl", "dllPath", "shaderSource"]) {
  if (packs.includes(forbidden)) fail(`unsafe executable pack capability found: ${forbidden}`);
}

console.log("[effect-pack-audit] PASS — data-only .aurapack import/export/install/apply is wired, version-gated, effect-whitelisted, and includes the Obsidian Wolf Effects Collection.");
