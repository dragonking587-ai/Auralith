# Auralith 1.0.0-rc.49.3.7 — Online Effect Pack Library

## Download & Install Effect Packs Inside Auralith
Auralith now includes an **Online Effect Pack Library** directly in the Editor. Official packs can be discovered from inside the app and installed with one **Download & Install** button — no browser download or manual file import is required.

The library refreshes from Auralith's official effect-pack catalog, so new official packs can be added to the catalog without redesigning the renderer or changing the project format.

## Obsidian Wolf Effects Collection
The first official downloadable collection includes:
- **Inferno Aura** — Realistic Flame + Heat Distortion + Embers + Glow Bloom + Sparks
- **Void Howl** — Void Energy + Spectral Aura + Shadow Pulse + Energy Sparks
- **Storm Fang** — Lightning Arc + Electric Crawl + Thunder Flash + Glow Bloom
- **Blood Moon Ritual** — Eclipse + Rune Glow + Atmospheric Haze + Shadow Tendrils
- **Frostbite Wolf** — Frost / Ice + Crystal Growth + Ice Shimmer + Frozen Breath

Each pack remains fully editable after installation because it expands into normal Auralith effect layers.

## Effect Pack Creator & Local Packs
The existing custom-pack workflow is retained:
- Save the selected region's current effect stack as a reusable pack
- Export `.aurapack` files
- Import/install local `.aurapack` files
- Apply a pack as a replacement stack or append it to an existing stack
- Uninstall custom packs without changing the original project image

## Download Safety
Online packs remain **data-only**. The official downloader:
- only accepts HTTPS pack files from the controlled `dragonking587-ai/Auralith` effect-pack catalog path;
- limits downloaded pack files to 512 KB;
- validates catalog ID and version against the downloaded pack;
- reuses Auralith's existing effect whitelist and parameter sanitizer;
- caps each pack at 32 effect layers;
- does not allow arbitrary JavaScript, DLLs, WebAssembly, executable shader source, or other executable plugin code.

## Quality & Compatibility
Low / Medium / High / Ultra quality selection remains intact. Packs can declare a recommended quality tier and a minimum Auralith version. Incompatible packs are blocked until the app is updated.

The renderer architecture, 2048-point audio analysis, project files, image loading, trace/stamp/emitter workflows, Clean Output, capture plumbing, updater identity, and the rc.49 compatibility renderer remain unchanged.

## Update Compatibility
Auralith Reborn **1.0.0-rc.49.3.6** can update directly to **1.0.0-rc.49.3.7** using **Check for Updates → Download & Install**.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation.

If the installer came from the official `dragonking587-ai/Auralith` GitHub release, use **More info → Run anyway**. Do not disable Windows SmartScreen or Windows Defender.
