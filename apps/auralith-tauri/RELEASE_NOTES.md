# Auralith 1.0.0-rc.49.3 — Cinematic Render Pipeline

## What’s New

Auralith Reborn keeps the established rc.49 interface and workflow while upgrading the rendering engine underneath it.

### Cinematic Rendering Pipeline
- Added a Three.js-managed cinematic compositor on the existing Reborn/Tauri application.
- Added HDR-capable intermediate rendering with bloom for brighter, more natural light bleed.
- Added subtle audio-reactive chromatic aberration, film grain, vignette, and final output/color processing.
- Preserved transparent output behavior for OBS-style overlay capture.
- Preserved automatic fallback to the proven rc.49 renderer if the cinematic pipeline cannot initialize or render safely.

### Dedicated GPU Particle Effects
The following point/emitter effects now use a dedicated Three.js GPU particle layer rather than the monolithic legacy effect shader:
- Sparks
- Energy Sparks
- Embers
- Fireflies
- Snow
- Ash
- Dust Motes
- Bioluminescent Spores

These effects now have effect-specific motion such as ballistic spark trajectories, buoyant embers, organic firefly wandering/blinking, depth-varied snow, and atmospheric drifting particles.

### Dedicated GPU Volumetric / Atmospheric Effects
The following point/emitter effects now use a dedicated GPU volumetric layer with distinct shader behavior:
- Magic Energy
- Plasma
- Void Energy
- Portal
- Vortex
- Smoke / Fog
- Mist
- Atmospheric Haze
- Frozen Breath
- Aurora
- Cosmic Nebula
- Spectral Aura

Magic Energy retains its existing realism quality, response/decay, color, and individual audio-band influence controls.

### Audio-Reactive Cinematic Response
The new rendering layers continue using Auralith’s existing audio system, including Bass, Low, Mid, High, Beat, and Transient data. The cinematic compositor smooths those values for organic movement while individual effects use the appropriate bands for their own physical or visual behavior.

### Compatibility
- The rc.49 UI, controls, layout, project schema, and workflow remain intact.
- Trace, Shape, and Prop/SDF placements continue using the existing rc.49 path renderer until those placement modes are migrated to the new engine.
- Existing project files remain compatible.
- Existing capture and virtual-camera plumbing remains in place.

## Update Compatibility
The existing Auralith Reborn updater identifier, public key, endpoints, and signing chain are preserved. Compatible rc.49 installations can update to **1.0.0-rc.49.3** through **Check for Updates → Download & Install** once the signed updater manifest is published.

## WINDOWS SMARTSCREEN NOTICE
Windows may show **“Windows protected your PC”** because Auralith does not yet have an established Windows code-signing reputation.

If the installer was downloaded from the official Auralith GitHub release, use:

**More info → Run anyway**

Do not disable Windows SmartScreen or Windows Defender.

## Installing on Windows
1. Download **Auralith-Reborn-1.0.0-rc.49.3-x64-Setup.exe** from the official release.
2. Double-click the installer.
3. If Windows shows “Windows protected your PC,” click **More info**.
4. Confirm the file came from the official `dragonking587-ai/Auralith` repository and click **Run anyway**.
5. Continue installation normally.
6. Launch Auralith Reborn.
