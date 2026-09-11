# Auralith 1.0.0-rc.49.3.2 — Electrical + Water / Distortion Pipeline Upgrade

## New Three.js Electrical Family
- Energy Beam — turbulent plasma sheath, stable bright core, and traveling compression waves.
- Lightning Arc — stepped leader structure, branch forks, return stroke, ionized corona, and beat/transient response.
- Electric Crawl — multiple independently moving electrical filaments.
- Thunder Flash — short exposure-style flash driven by transients and beat energy.
- Laser — coherent beam core, controlled diffraction glow, and traveling energy modulation.

## New Water / Distortion / Refraction Family
- Heat Distortion — rising multi-scale thermal turbulence and shimmer.
- Refraction — radial lens refraction, micro-ripples, and restrained spectral dispersion.
- Water Ripple — layered decaying ripple fronts that bend the already-rendered scene.
- Caustics — warped intersecting wave cells that create moving focused-light patterns.
- Wet Reflection — vertically dragged reflections, broken surface sheen, and wavering highlights.
- Water Reflection — coherent horizontal wave normals with depth variation.
- Spatial Warp — radial compression and tangent swirl around the selected emitter.
- Holographic Distortion — scanline shear, intermittent strip jitter, and controlled RGB separation.

## Renderer Integrity
The rc.49 renderer remains authoritative for the backdrop, props, project data, and complete effect library. The new Three.js effects run on a separate transparent WebGL2 canvas above the rc.49 canvas.

For the distortion family, the completed rc.49 canvas is copied into the isolated Three.js context only as a read-only CanvasTexture. No WebGL programs, textures, buffers, framebuffers, or state are shared between the two renderers.

If the cinematic layer fails to initialize or render, the rc.49 image and original effects remain visible underneath. Clean Output continues to fall back to the rc.49 frame if cinematic readback fails.

## Build Regression Guard
The runtime audit now checks that:
- the rc.49 WebGL context remains unchanged;
- the cinematic renderer uses its own WebGL2 context;
- the complete rc.49 project is always rendered first;
- all electrical and distortion effect kinds are correctly routed;
- the distortion layer cannot acquire a WebGL context itself;
- the read-only base-scene texture refreshes every frame;
- distortion overlay alpha remains capped;
- all new GPU layers are initialized, updated, and disposed correctly.

## UI / Project Compatibility
No rc.49 interface redesign is included. Existing controls, image loading, editor tools, project structure, trace/shape/prop rendering, marker behavior, capture plumbing, and audio engine remain on the established compatibility path.

Trace, Shape, and Prop/SDF placements continue to use the proven rc.49 renderer until those placement modes receive their own dedicated new-engine migration.

## Update Compatibility
Auralith Reborn **1.0.0-rc.49.3.1** can update directly to **1.0.0-rc.49.3.2** using **Check for Updates → Download & Install**. The application identifier, updater public key, updater endpoints, installer mode, and signing chain remain unchanged.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation.

If the installer came from the official `dragonking587-ai/Auralith` GitHub release, use **More info → Run anyway**. Do not disable Windows SmartScreen or Windows Defender.
